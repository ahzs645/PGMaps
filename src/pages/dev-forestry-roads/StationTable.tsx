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

type Row = { station: RoadStation; cutVolume: number | null; fillVolume: number | null; span: number }
type Column = {
  id: string
  label: string
  unit: string
  title?: string
  road?: boolean
  terrain?: boolean
  value: (row: Row, analysis: RoadAnalysis) => number | null
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
  },
  {
    id: 'fillVolume',
    label: 'Fill vol',
    unit: 'm³',
    road: true,
    decimals: 1,
    title: 'Volume since the previous row',
    value: (r) => r.fillVolume,
  },
  {
    id: 'mass',
    label: 'Mass',
    unit: 'm³',
    road: true,
    decimals: 0,
    title: 'Cumulative mass ordinate',
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
 * Rows at the chosen reporting interval: the calculated station nearest each multiple, with cut and
 * fill summed since the previous reported row (unknown when any interval in between is incomplete).
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
    let cut: number | null = 0,
      fill: number | null = 0
    const from = previous ? previous.index + 1 : s.index
    for (let i = from; i <= s.index; i++) {
      const x = analysis.stations[i]
      cut = cut === null || x.cutVolumeM3 === null ? null : cut + x.cutVolumeM3
      fill = fill === null || x.fillVolumeM3 === null ? null : fill + x.fillVolumeM3
    }
    const span = previous
      ? s.chainage - previous.chainage
      : s.index
        ? s.chainage - analysis.stations[s.index - 1].chainage
        : 0
    rows.push({ station: s, cutVolume: cut, fillVolume: fill, span })
    previous = s
  }
  return rows
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
  const rows = reportingRows(analysis, inRange, every).filter((r) => !flagged || r.station.flags.length)
  const available = COLUMNS.filter((c) => (terrainOnly ? c.terrain : c.road))
  const columns = available.filter((c) => !hidden.includes(c.id))
  const intervals = inRange.filter(
    (s) =>
      s.index > 0 &&
      analysis.stations[s.index - 1]?.chainage >= range.start - 0.001 &&
      s.cutVolumeM3 !== null &&
      s.fillVolumeM3 !== null,
  )
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
                    <td key={c.id}>{fixed(c.value(row, analysis), c.decimals)}</td>
                  ))}
                  <td
                    className="max-w-64 truncate text-left text-amber-700 dark:text-amber-400"
                    title={s.flags.join('; ')}
                  >
                    {s.flags.join('; ') || '—'}
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
                  <td key={c.id}>
                    {c.id === 'cutVolume'
                      ? number(intervals.reduce((sum, s) => sum + (s.cutVolumeM3 ?? 0), 0))
                      : c.id === 'fillVolume'
                        ? number(intervals.reduce((sum, s) => sum + (s.fillVolumeM3 ?? 0), 0))
                        : ''}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          )}
        </EngineeringTable>
      </div>
      <p className="mt-1 text-2xs text-muted-foreground">
        {rows.length} rows
        {every ? ` every ${every} m; volumes are summed since the previous row` : ''}
        {terrainOnly
          ? ' · Ground elevations and sampled interval slopes only; no road quantities assigned.'
          : ' · totals cover fully supported intervals only.'}
      </p>
    </div>
  )
}
