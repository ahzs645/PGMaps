import { RoadSelect } from './Controls'
import { Columns3, Download, ListFilter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadText } from '@/lib/download'
import { FormField, NumberField } from '@/components/ui/form-field'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { ActiveFilterChip, ToolbarPopover } from '@/components/ui/toolbar-popover'
import { formatRoadStation, useChartHeaderControls } from './Charts'
import { nearestStation } from './engine'
import { useScheduleToolbar } from './scheduleToolbar'
import {
  availableStationColumns,
  reportingRows,
  rowFlags,
  stationReportCsv,
  STATION_COLUMNS,
  tableTotals,
  totalsNote,
} from './stationReport'
import type { RoadAnalysis } from './types'

const number = (v: number | null | undefined, decimals = 1) =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-CA', { maximumFractionDigits: decimals })
const fixed = (v: number | null | undefined, decimals: number) =>
  v == null || !Number.isFinite(v)
    ? '—'
    : v.toLocaleString('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })

const DEFAULT_HIDDEN = STATION_COLUMNS.filter((c) => c.hidden).map((c) => c.id)
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

export function StationTable({
  analysis,
  station,
  onStation,
  terrainOnly = false,
  roadName,
}: {
  analysis: RoadAnalysis
  station: number
  onStation: (value: number) => void
  terrainOnly?: boolean
  /** Names the CSV file. */
  roadName?: string
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
  const available = availableStationColumns(analysis, terrainOnly)
  const columns = available.filter((c) => !hidden.includes(c.id))
  const narrowed = range.start > 0.001 || end < analysis.length - 0.001
  const clearRange = () => setRange({ start: 0, end: null })
  const field = 'w-full min-w-0 rounded border bg-background px-1.5 py-1 text-base text-foreground md:text-xs'
  // In a panel the two buttons join its header; only active filters take a row above the table.
  // Inside the road data schedule they join its tab row instead.
  const panelHeader = useChartHeaderControls()
  const scheduleRow = useScheduleToolbar()
  const headerControls = panelHeader ?? scheduleRow
  const popover = panelHeader
    ? ({ variant: 'ghost', buttonClassName: 'size-8', align: 'end' } as const)
    : scheduleRow
      ? ({ buttonClassName: 'size-8', align: 'end' } as const)
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
          <FormField label="Report every" hint={every ? 'Volumes are summed since the previous row.' : undefined}>
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
          {!terrainOnly && !analysis.engineering?.haul.enabled && (
            <p className="mt-1 whitespace-normal text-2xs text-muted-foreground">
              Borrow and waste columns appear when haul allocation is on.
            </p>
          )}
        </div>
      </ToolbarPopover>
      <Button
        size="icon"
        variant={panelHeader ? 'ghost' : 'outline'}
        className="size-8 shrink-0"
        aria-label="Download table as CSV"
        title={
          analysis.invalidInput
            ? 'Correct the invalid input first: this table leaves it out, and a CSV cannot say so'
            : `Download these ${reported.length} rows as CSV, with every column and the totals`
        }
        disabled={!reported.length || !!analysis.invalidInput}
        onClick={() =>
          downloadText(
            stationReportCsv(analysis, reported, terrainOnly),
            `${
              (roadName ?? '')
                .replace(/[^a-z0-9]+/gi, '-')
                .replace(/^-|-$/g, '')
                .slice(0, 70) || 'road'
            }-${terrainOnly ? 'profile' : 'volumes'}${every ? `-${every}m` : ''}.csv`,
            'text/csv;charset=utf-8',
          )
        }
      >
        <Download className="size-3.5" />
      </Button>
    </>
  )
  const filtered = flagged || every > 0 || narrowed
  return (
    <div className="flex h-full min-h-0 flex-col">
      {headerControls ? createPortal(toolbarButtons, headerControls) : null}
      {(!headerControls || filtered) && (
        <div className="mb-2 flex min-w-0 items-center gap-1.5">
          {!headerControls && toolbarButtons}
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-none [scrollbar-width:none]">
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
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto overscroll-none">
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
                      className={partial && c.sum ? 'text-warning' : undefined}
                      title={partial && c.sum ? flags[0] : undefined}
                    >
                      {fixed(c.value(row), c.decimals)}
                    </td>
                  ))}
                  <td
                    className="max-w-64 truncate text-left text-warning"
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
                <td className="text-left font-normal text-warning">{totalsNote(totals)}</td>
              </tr>
            </tfoot>
          )}
        </EngineeringTable>
      </div>
    </div>
  )
}
