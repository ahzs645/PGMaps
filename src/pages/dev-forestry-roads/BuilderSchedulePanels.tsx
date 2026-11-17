import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable, engineeringPinnedColumnClass } from '@/components/ui/engineering-table'
import { downloadText } from '@/lib/download'
import { RoadSelect } from './Controls'
import { formatRoadStation } from './Charts'
import { nearestStation } from './engine'
import { activeStationing } from './roadStationing'
import { ScheduleToolbar } from './scheduleToolbar'
import { STAKE_REASON_TEXT, stationExtras } from './stationExtras'
import { clearingCsv, clearingSchedule, slopeStakeBook, slopeStakeCsv, stakeText } from './builderSchedules'
import { exportGrid } from './terrain'
import type { Alignment, RoadAnalysis, TerrainMetadata } from './types'

const formats = new Map<number, Intl.NumberFormat>()
const fixed = (v: number | null | undefined, decimals = 2) => {
  if (v == null || !Number.isFinite(v)) return '—'
  let f = formats.get(decimals)
  if (!f)
    formats.set(
      decimals,
      (f = new Intl.NumberFormat('en-CA', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })),
    )
  return f.format(v)
}
const signed = (v: number | null | undefined, decimals = 2) =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${fixed(v, decimals)}`
const pinned = engineeringPinnedColumnClass
const fileName = (name: string | undefined, what: string) =>
  `${
    (name ?? '')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 70) || 'road'
  }-${what}.csv`

interface Props {
  alignment: Alignment
  analysis: RoadAnalysis
  terrain?: TerrainMetadata
  station: number
  onStation: (value: number) => void
}

function useExtras(alignment: Alignment, analysis: RoadAnalysis, terrain?: TerrainMetadata) {
  return useMemo(() => {
    if (!analysis.stations.length) return null
    try {
      const grid = terrain ? exportGrid(terrain, alignment.points[0].coordinate) : null
      return { extras: stationExtras(alignment, analysis, grid?.toGrid), epsg: grid?.epsg ?? null }
    } catch {
      return null
    }
  }, [alignment, analysis, terrain])
}

function CsvButton({ title, disabled, onClick }: { title: string; disabled: boolean; onClick: () => void }) {
  return (
    <Button
      size="icon"
      variant="outline"
      className="size-8 shrink-0"
      aria-label={title}
      title={title}
      disabled={disabled}
      onClick={onClick}
    >
      <Download className="size-3.5" />
    </Button>
  )
}

const STAKE_INTERVALS = [10, 20, 25, 50]

/**
 * The slope-stake book: each station the Engineering Manual's Table 5-10 stakes (every 20 m, curve
 * points, culverts, cuts and fills over 3 m), with the stake each side as written on the lath.
 */
export function SlopeStakePanel({ alignment, analysis, terrain, station, onStation }: Props) {
  const [every, setEvery] = useState(20)
  const data = useExtras(alignment, analysis, terrain)
  const rows = useMemo(
    () => (data ? slopeStakeBook(alignment, analysis, data.extras, every) : []),
    [alignment, analysis, data, every],
  )
  const active = nearestStation(analysis.stations, station)
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ScheduleToolbar>
        <RoadSelect
          ariaLabel="Slope stake interval"
          className="h-8 rounded-md border bg-background px-1.5 text-xs"
          value={String(every)}
          onValueChange={(v) => setEvery(Number(v))}
        >
          {STAKE_INTERVALS.map((v) => (
            <option key={v} value={v}>
              Every {v} m
            </option>
          ))}
        </RoadSelect>
        <CsvButton
          title={
            analysis.invalidInput
              ? 'Correct the invalid input first'
              : `Download the ${rows.length} stake stations as CSV, with hinge, catch and grid coordinates`
          }
          disabled={!rows.length || !!analysis.invalidInput}
          onClick={() =>
            downloadText(
              slopeStakeCsv(analysis, rows, activeStationing(), data?.epsg),
              fileName(alignment.name, 'slope-stakes'),
              'text/csv;charset=utf-8',
            )
          }
        />
      </ScheduleToolbar>
      <p className="text-2xs text-muted-foreground">
        A stake reads cut (C) or fill (F) from the catch to the hinge (the ditch bottom in cut, else the formation
        edge), then its distance from the centreline. A guide only: stake from the field survey (Engineering Manual
        §5.6.5).
      </p>
      <div className="min-h-0 flex-1 overflow-auto overscroll-none">
        <EngineeringTable data-testid="road-slope-stake-table">
          <thead className="sticky top-0 z-10">
            <tr>
              <ColumnHeader label="L-Stn" unit="m" className={`${pinned} z-20 text-left`} />
              <ColumnHeader label="Why" className="text-left" />
              <ColumnHeader label="Left stake" unit="C/F m / out m" />
              <ColumnHeader label="Hinge L" unit="m out" />
              <ColumnHeader label="CL C/F" unit="m" />
              <ColumnHeader label="Formation" unit="m" />
              <ColumnHeader label="Hinge R" unit="m out" />
              <ColumnHeader label="Right stake" unit="C/F m / out m" />
              <ColumnHeader label="Grd last" unit="%" />
              <ColumnHeader label="Grd next" unit="%" />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ station: s, extra: e, reasons }) => (
              <tr key={s.index} aria-selected={active?.index === s.index} className="group">
                <td className={`${pinned} bg-background text-left`}>
                  <button
                    className="font-mono underline decoration-dotted"
                    aria-label={`Select station ${s.chainage.toFixed(1)}`}
                    onClick={() => onStation(s.chainage)}
                  >
                    {formatRoadStation(s.chainage)}
                  </button>
                </td>
                <td className="text-left text-muted-foreground">
                  {reasons
                    .filter((r) => r !== 'interval')
                    .map((r) => STAKE_REASON_TEXT[r])
                    .join(', ')}
                </td>
                <td className="font-mono">{stakeText(e.catch.left)}</td>
                <td>
                  {e.catch.left
                    ? `${e.catch.left.hinge === 'ditch' ? 'D ' : ''}${fixed(e.catch.left.hingeOffsetM, 1)}`
                    : '—'}
                </td>
                <td>{signed(e.centreDepthM)}</td>
                <td>{fixed(s.designElevation)}</td>
                <td>
                  {e.catch.right
                    ? `${e.catch.right.hinge === 'ditch' ? 'D ' : ''}${fixed(e.catch.right.hingeOffsetM, 1)}`
                    : '—'}
                </td>
                <td className="font-mono">{stakeText(e.catch.right)}</td>
                <td>{signed(e.gradeLastPercent)}</td>
                <td>{signed(e.gradeNextPercent)}</td>
              </tr>
            ))}
          </tbody>
        </EngineeringTable>
      </div>
    </div>
  )
}

const CLEARING_INTERVALS = [0, 10, 20, 50, 100]

/** Clearing widths station by station, with the area since the previous row and the job's limit. */
export function ClearingPanel({
  alignment,
  analysis,
  terrain,
  station,
  onStation,
  limitM,
}: Props & { limitM: number | null }) {
  const [every, setEvery] = useState(20)
  const data = useExtras(alignment, analysis, terrain)
  const rows = useMemo(
    () => (data ? clearingSchedule(analysis, data.extras, every, limitM) : []),
    [analysis, data, every, limitM],
  )
  const active = nearestStation(analysis.stations, station)
  const total = rows.reduce((sum, r) => sum + (r.areaM2 ?? 0), 0)
  const widest = rows.reduce<number | null>(
    (best, r) =>
      r.extra.clearingWidthM !== null && (best === null || r.extra.clearingWidthM > best)
        ? r.extra.clearingWidthM
        : best,
    null,
  )
  const over = rows.filter((r) => r.over).length
  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <ScheduleToolbar>
        <RoadSelect
          ariaLabel="Clearing schedule interval"
          className="h-8 rounded-md border bg-background px-1.5 text-xs"
          value={String(every)}
          onValueChange={(v) => setEvery(Number(v))}
        >
          {CLEARING_INTERVALS.map((v) => (
            <option key={v} value={v}>
              {v ? `Every ${v} m` : 'Every station'}
            </option>
          ))}
        </RoadSelect>
        <CsvButton
          title={analysis.invalidInput ? 'Correct the invalid input first' : 'Download the clearing schedule as CSV'}
          disabled={!rows.length || !!analysis.invalidInput}
          onClick={() =>
            downloadText(
              clearingCsv(analysis, rows, activeStationing()),
              fileName(alignment.name, 'clearing'),
              'text/csv;charset=utf-8',
            )
          }
        />
      </ScheduleToolbar>
      <p className="text-2xs text-muted-foreground" data-testid="road-clearing-summary">
        {fixed(total / 10000, 2)} ha cleared · widest {fixed(widest, 1)} m
        {limitM !== null
          ? ` · limit ${fixed(limitM, 1)} m${over ? `, over at ${over} row${over === 1 ? '' : 's'}` : ''}`
          : ' · no clearing limit entered'}
        . Clearing runs to each catch point plus the preparation margins.
      </p>
      <div className="min-h-0 flex-1 overflow-auto overscroll-none">
        <EngineeringTable data-testid="road-clearing-table">
          <thead className="sticky top-0 z-10">
            <tr>
              <ColumnHeader label="L-Stn" unit="m" className={`${pinned} z-20 text-left`} />
              <ColumnHeader label="Sidehill" unit="%" />
              <ColumnHeader label="Uphill" />
              <ColumnHeader label="Subgrade W" unit="m" />
              <ColumnHeader label="Catch L" unit="m" />
              <ColumnHeader label="Catch R" unit="m" />
              <ColumnHeader label="Clear L" unit="m" />
              <ColumnHeader label="Clear R" unit="m" />
              <ColumnHeader label="Clear W" unit="m" />
              <ColumnHeader label="Area" unit="m² since prev." />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ station: s, extra: e, areaM2, over: wide }) => (
              <tr key={s.index} aria-selected={active?.index === s.index}>
                <td className={`${pinned} bg-background text-left`}>
                  <button
                    className="font-mono underline decoration-dotted"
                    aria-label={`Select station ${s.chainage.toFixed(1)}`}
                    onClick={() => onStation(s.chainage)}
                  >
                    {formatRoadStation(s.chainage)}
                  </button>
                </td>
                <td>{fixed(e.sidehillPercent, 0)}</td>
                <td>{e.uphill === 'left' ? 'L' : e.uphill === 'right' ? 'R' : '—'}</td>
                <td>{fixed(s.leftWidth + s.rightWidth, 1)}</td>
                <td>{fixed(e.catch.left?.offsetM, 1)}</td>
                <td>{fixed(e.catch.right?.offsetM, 1)}</td>
                <td>{fixed(e.clearingM.left, 1)}</td>
                <td>{fixed(e.clearingM.right, 1)}</td>
                <td className={wide ? 'font-semibold text-destructive' : undefined}>{fixed(e.clearingWidthM, 1)}</td>
                <td>{fixed(areaM2, 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td className="text-left" colSpan={9}>
                Total
              </td>
              <td>{fixed(total, 0)}</td>
            </tr>
          </tfoot>
        </EngineeringTable>
      </div>
    </div>
  )
}
