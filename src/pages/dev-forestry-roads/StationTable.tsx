import { RoadSelect } from './Controls'
import { Columns3, ListFilter } from 'lucide-react'
import { FormField, NumberField } from '@/components/ui/form-field'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { ActiveFilterChip, ToolbarPopover } from '@/components/ui/toolbar-popover'
import { formatRoadStation, useChartHeaderControls } from './Charts'
import { nearestStation } from './engine'
import type { RoadAnalysis, RoadStation } from './types'

const number = (v: number | null | undefined, decimals = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: decimals })
const fixed = (v: number | null | undefined, decimals: number) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

/**
 * Quantities that belong to the interval ending at a calculation station. A reporting row sums each
 * over the intervals since the previous row; null is an interval where it is unknown.
 */
const INTERVAL_QUANTITIES = {
  cutVolume: (analysis, index) => analysis.stations[index].cutVolumeM3,
  fillVolume: (analysis, index) => analysis.stations[index].fillVolumeM3,
} satisfies Record<string, (analysis: RoadAnalysis, index: number) => number | null>
type IntervalQuantity = keyof typeof INTERVAL_QUANTITIES
const QUANTITIES = Object.keys(INTERVAL_QUANTITIES) as IntervalQuantity[]

/**
 * One table row. Each quantity is the known part since the previous row, and null only when none of
 * that road has a value, so the rows always add up to the totals. `unknownM` is the road length
 * since the previous row whose earthwork is unknown and left out.
 */
export type StationRow = { station: RoadStation; span: number; unknownM: number } & Record<
  IntervalQuantity,
  number | null
>
type Row = StationRow
type Column = {
  id: string
  label: string
  unit: string
  title?: string
  road?: boolean
  terrain?: boolean
  value: (row: Row, analysis: RoadAnalysis) => number | null
  /** A quantity summed down the table into the totals row. */
  sum?: IntervalQuantity
  decimals: number
}
const COLUMNS: Column[] = [
  {
    id: 'ground',
    label: 'Ground',
    unit: 'm',
    road: true,
    terrain: true,
    decimals: 2,
    value: (r) => r.station.groundElevation,
  },
  { id: 'formation', label: 'Formation', unit: 'm', road: true, decimals: 2, value: (r) => r.station.designElevation },
  { id: 'grade', label: 'Grade', unit: '%', road: true, decimals: 1, value: (r) => r.station.gradePercent },
  {
    id: 'groundGrade',
    label: 'Gnd grade',
    unit: '%',
    terrain: true,
    decimals: 1,
    value: (r) => r.station.groundGradePercent,
  },
  { id: 'interval', label: 'Interval', unit: 'm', terrain: true, decimals: 1, value: (r) => r.span },
  { id: 'cutArea', label: 'Cut A', unit: 'm²', road: true, decimals: 1, value: (r) => r.station.cutAreaM2 },
  { id: 'fillArea', label: 'Fill A', unit: 'm²', road: true, decimals: 1, value: (r) => r.station.fillAreaM2 },
  {
    id: 'cutVolume',
    label: 'Cut vol',
    unit: 'm³',
    road: true,
    decimals: 1,
    title: 'Volume since the previous row',
    value: (r) => r.cutVolume,
    sum: 'cutVolume',
  },
  {
    id: 'fillVolume',
    label: 'Fill vol',
    unit: 'm³',
    road: true,
    decimals: 1,
    title: 'Volume since the previous row',
    value: (r) => r.fillVolume,
    sum: 'fillVolume',
  },
  {
    id: 'mass',
    label: 'Mass',
    unit: 'm³',
    road: true,
    decimals: 0,
    title: 'Cumulative mass ordinate: the known earthwork so far',
    value: (r) => r.station.massM3,
  },
  {
    id: 'width',
    label: 'Width L+R',
    unit: 'm',
    road: true,
    decimals: 1,
    value: (r) => r.station.leftWidth + r.station.rightWidth,
  },
  {
    id: 'longitude',
    label: 'Longitude',
    unit: '°',
    road: true,
    terrain: true,
    decimals: 6,
    value: (r) => r.station.coordinate[0],
  },
  {
    id: 'latitude',
    label: 'Latitude',
    unit: '°',
    road: true,
    terrain: true,
    decimals: 6,
    value: (r) => r.station.coordinate[1],
  },
]
const DEFAULT_HIDDEN = ['mass', 'width', 'longitude', 'latitude']
const STORAGE = 'pgmaps-road-station-columns'
const INTERVALS = [0, 20, 50, 100, 200, 500]

function readHidden(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE) ?? 'null')
    return Array.isArray(value) && value.every((v) => typeof v === 'string') ? value : DEFAULT_HIDDEN
  } catch {
    return DEFAULT_HIDDEN
  }
}

/**
 * Rows at the chosen reporting interval: the calculated station nearest each multiple, with each
 * quantity summed since the previous reported row. An interval with unknown earthwork adds nothing
 * and is counted in the row's `unknownM`, so a row that holds a gap still reports its known part.
 * The first row starts the table: nothing precedes it, so it sums nothing.
 */
export function reportingRows(analysis: RoadAnalysis, stations: RoadStation[], every: number): Row[] {
  const picked = every > 0 ? new Set<number>() : null
  if (picked && stations.length) {
    const first = stations[0].chainage,
      last = stations[stations.length - 1].chainage
    for (let chainage = Math.ceil(first / every) * every; chainage <= last + 1e-6; chainage += every)
      picked.add(nearestStation(stations, chainage)!.index)
    picked.add(stations[0].index)
    picked.add(stations[stations.length - 1].index)
  }
  const rows: Row[] = []
  let previous: RoadStation | null = null
  for (const s of stations) {
    if (picked && !picked.has(s.index)) continue
    const row: Row = {
      station: s,
      span: previous
        ? s.chainage - previous.chainage
        : s.index
          ? s.chainage - analysis.stations[s.index - 1].chainage
          : 0,
      unknownM: 0,
      cutVolume: null,
      fillVolume: null,
    }
    for (const key of QUANTITIES) {
      const value = INTERVAL_QUANTITIES[key]
      if (!previous) {
        row[key] = value(analysis, s.index) === null ? null : 0
        continue
      }
      for (let i = previous.index + 1; i <= s.index; i++) {
        const volume = value(analysis, i)
        if (volume !== null) row[key] = (row[key] ?? 0) + volume
      }
    }
    if (previous)
      for (let i = previous.index + 1; i <= s.index; i++) {
        const x = analysis.stations[i]
        if (x.cutVolumeM3 === null || x.fillVolumeM3 === null)
          row.unknownM += x.chainage - analysis.stations[i - 1].chainage
      }
    rows.push(row)
    previous = s
  }
  return rows
}

/** The totals row: each quantity summed down the rows, and the road length they leave out. */
export function tableTotals(rows: Row[]): Record<IntervalQuantity, number | null> & { unknownM: number } {
  const totals = { unknownM: rows.reduce((sum, row) => sum + row.unknownM, 0) } as ReturnType<typeof tableTotals>
  for (const key of QUANTITIES)
    totals[key] = rows.some((row) => row[key] !== null) ? rows.reduce((sum, row) => sum + (row[key] ?? 0), 0) : null
  return totals
}

const metres = (value: number) => Number(value.toFixed(1)).toLocaleString('en-CA')

/** What a row says about itself besides its station's own flags. */
function rowFlags(row: Row): string[] {
  if (row.unknownM <= 1e-6) return row.station.flags
  return [
    row.unknownM >= row.span - 1e-6
      ? 'Earthwork unknown since the previous row'
      : `Partial: leaves out ${metres(row.unknownM)} m with unknown earthwork`,
    ...row.station.flags,
  ]
}

export function StationTable({
  analysis,
  station,
  onStation,
  terrainOnly = false,
}: {
  analysis: RoadAnalysis
  station: number
  onStation: (value: number) => void
  terrainOnly?: boolean
}) {
  const active = nearestStation(analysis.stations, station)
  const [flagged, setFlagged] = useState(false)
  const [range, setRange] = useState<{ start: number; end: number | null }>({ start: 0, end: null })
  const [every, setEvery] = useState(0)
  const [hidden, setHidden] = useState<string[]>(readHidden)
  const scroller = useRef<HTMLDivElement>(null)
  // Keep the selected row in view inside the table's own scroll port, never scrolling the page.
  useEffect(() => {
    const port = scroller.current
    const row = port?.querySelector<HTMLElement>('tbody tr[aria-selected="true"]')
    if (!port || !row) return
    const box = port.getBoundingClientRect(),
      target = row.getBoundingClientRect()
    const header = port.querySelector('thead')?.getBoundingClientRect().height ?? 0
    if (target.top < box.top + header) port.scrollTop -= box.top + header - target.top
    else if (target.bottom > box.bottom) port.scrollTop += target.bottom - box.bottom
  }, [active?.index])
  const toggle = (id: string) => {
    const next = hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id]
    setHidden(next)
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next))
    } catch {
      /* Column choice is a convenience. */
    }
  }
  const end = Math.min(analysis.length, range.end ?? analysis.length)
  const inRange = analysis.stations.filter((s) => s.chainage >= range.start - 0.001 && s.chainage <= end + 0.001)
  const reported = reportingRows(analysis, inRange, every)
  const rows = reported.filter((r) => !flagged || r.station.flags.length || (!terrainOnly && r.unknownM > 1e-6))
  // Totals are the sum of the reported rows, whether or not the flag filter is showing them all.
  const totals = tableTotals(reported)
  const available = COLUMNS.filter((c) => (terrainOnly ? c.terrain : c.road))
  const columns = available.filter((c) => !hidden.includes(c.id))
  const narrowed = range.start > 0.001 || end < analysis.length - 0.001
  const clearRange = () => setRange({ start: 0, end: null })
  const field = 'w-full min-w-0 rounded border bg-background px-1.5 py-1 text-base text-foreground md:text-xs'
  // In a panel the two buttons join its header; only active filters take a row above the table.
  const headerControls = useChartHeaderControls()
  const popover = headerControls
    ? ({ variant: 'ghost', buttonClassName: 'size-8', align: 'end' } as const)
    : ({} as const)
  const toolbarButtons = (
    <>
      <ToolbarPopover
        {...popover}
        label="Filter stations"
        icon={<ListFilter />}
        count={Number(flagged) + Number(every > 0) + Number(narrowed)}
      >
        <div className="grid gap-2.5 p-2.5 text-xs">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
            Flagged only
          </label>
          <FormField label="Report every">
            <RoadSelect
              ariaLabel="Station table reporting interval"
              className={field}
              value={String(every)}
              onValueChange={(value) => setEvery(Number(value))}
            >
              {INTERVALS.map((v) => (
                <option key={v} value={v}>
                  {v ? `${v} m` : 'Every station'}
                </option>
              ))}
            </RoadSelect>
          </FormField>
          <div className="grid grid-cols-2 gap-2">
            {/* These commit on blur or Enter: clamping each keystroke would rewrite a half-typed number. */}
            <NumberField
              label="From (m)"
              aria-label="Station table range start"
              inputClassName={field}
              updateOn="commit"
              precision={1}
              min={0}
              max={end}
              value={range.start}
              onValueChange={(n) => setRange((r) => ({ ...r, start: Math.max(0, Math.min(end, n)) }))}
            />
            <NumberField
              label="To (m)"
              aria-label="Station table range end"
              inputClassName={field}
              updateOn="commit"
              precision={1}
              min={range.start}
              max={analysis.length}
              value={end}
              onValueChange={(n) =>
                setRange((r) => ({ ...r, end: Math.max(range.start, Math.min(analysis.length, n)) }))
              }
            />
          </div>
        </div>
      </ToolbarPopover>
      <ToolbarPopover {...popover} label="Choose columns" icon={<Columns3 />} width={176}>
        <div className="grid gap-1 p-2.5 text-xs">
          {available.map((c) => (
            <label key={c.id} className="flex items-center gap-2 whitespace-nowrap">
              <input type="checkbox" checked={!hidden.includes(c.id)} onChange={() => toggle(c.id)} />
              {c.label}
            </label>
          ))}
        </div>
      </ToolbarPopover>
    </>
  )
  const filtered = flagged || every > 0 || narrowed
  return (
    <div className="flex h-full min-h-0 flex-col">
      {headerControls ? createPortal(toolbarButtons, headerControls) : null}
      {(!headerControls || filtered) && (
        <div className="mb-2 flex min-w-0 items-center gap-1.5">
          {!headerControls && toolbarButtons}
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
            {flagged && (
              <ActiveFilterChip label="Flagged" clearLabel="Show all stations" onClear={() => setFlagged(false)} />
            )}
            {every > 0 && (
              <ActiveFilterChip
                label={`Every ${every} m`}
                clearLabel="Report every station"
                onClear={() => setEvery(0)}
              />
            )}
            {narrowed && (
              <ActiveFilterChip
                label={`${formatRoadStation(range.start)} – ${formatRoadStation(end)}`}
                clearLabel="Show the full range"
                onClear={clearRange}
              />
            )}
          </div>
        </div>
      )}
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <EngineeringTable data-testid="road-station-table">
          <thead className="sticky top-0 z-10">
            <tr>
              <ColumnHeader label="L-Stn" unit="m" />
              {columns.map((c) => (
                <ColumnHeader key={c.id} label={c.label} unit={c.unit} title={c.title} />
              ))}
              <ColumnHeader label="Flags" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const s = row.station
              const flags = terrainOnly ? s.flags : rowFlags(row)
              const partial = !terrainOnly && row.unknownM > 1e-6
              return (
                <tr key={s.index} aria-selected={active?.index === s.index}>
                  <td>
                    <button
                      className="font-mono underline decoration-dotted"
                      aria-label={`Select station ${s.chainage.toFixed(1)}`}
                      onClick={() => onStation(s.chainage)}
                    >
                      {formatRoadStation(s.chainage)}
                    </button>
                  </td>
                  {columns.map((c) => (
                    <td
                      key={c.id}
                      className={partial && c.sum ? 'text-amber-700 dark:text-amber-400' : undefined}
                      title={partial && c.sum ? flags[0] : undefined}
                    >
                      {fixed(c.value(row, analysis), c.decimals)}
                    </td>
                  ))}
                  <td
                    className="max-w-64 truncate text-left text-amber-700 dark:text-amber-400"
                    title={flags.join('; ')}
                    data-partial={partial || undefined}
                  >
                    {flags.join('; ') || '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {!terrainOnly && (
            <tfoot>
              <tr className="font-semibold">
                <td className="text-left">Cum. tot.</td>
                {columns.map((c) => (
                  <td key={c.id}>{c.sum ? number(totals[c.sum]) : ''}</td>
                ))}
                <td className="text-left font-normal text-amber-700 dark:text-amber-400">
                  {totals.unknownM > 1e-6 ? `Leaves out ${metres(totals.unknownM)} m with unknown earthwork` : ''}
                </td>
              </tr>
            </tfoot>
          )}
        </EngineeringTable>
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">
        {rows.length === reported.length ? `${rows.length} rows` : `${rows.length} of ${reported.length} rows shown`}
        {every ? ` every ${every} m; volumes are summed since the previous row` : ''}
        {terrainOnly
          ? ' · Ground elevations and sampled interval slopes only; no road quantities assigned.'
          : ` · totals are the sum of ${rows.length === reported.length ? 'the' : 'all'} rows.`}
      </p>
    </div>
  )
}
