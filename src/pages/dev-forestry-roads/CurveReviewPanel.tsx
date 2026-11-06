import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ColumnHeader, EngineeringTable } from '@/components/ui/engineering-table'
import { downloadText } from '@/lib/download'
import { formatRoadStation } from './Charts'
import {
  buildCurveReview,
  curveReviewCsv,
  CURVE_REVIEW_BASIS,
  INNER_EDGE_GRADE_BASIS,
  type CurveReviewRange,
} from './curveReview'
import type { SweptPathResult } from './sweptPath'
import type { Alignment, RoadAnalysis, TerrainMetadata } from './types'

const number = (value: number | null | undefined, digits = 2) =>
  value == null || !Number.isFinite(value) ? '—' : value.toLocaleString('en-CA', { maximumFractionDigits: digits })
const span = (value: CurveReviewRange | null, unit: string) =>
  value
    ? `${number(value.min)}${value.max - value.min > 1e-5 ? ` to ${number(value.max)}` : ''} ${unit}`
    : 'Unavailable'

/** A shared-station review of the geometry actually fitted, including qualified tight-turn screens. */
export function CurveReviewPanel({
  alignment,
  analysis,
  station,
  onStation,
  terrain,
  swept = null,
  onOpenSwept,
}: {
  alignment: Alignment
  analysis: RoadAnalysis
  station: number
  onStation: (chainage: number) => void
  terrain?: TerrainMetadata
  swept?: SweptPathResult | null
  onOpenSwept?: () => void
}) {
  const [selectedId, setSelectedId] = useState<string>()
  const [expanded, setExpanded] = useState(true)
  const review = useMemo(() => {
    try {
      return { rows: buildCurveReview(alignment, analysis), error: '' }
    } catch (cause) {
      return {
        rows: [],
        error: cause instanceof Error ? cause.message : 'Curve review is unavailable until the alignment is valid.',
      }
    }
  }, [alignment, analysis])
  const rows = review.rows
  const active =
    rows.find((c) => station >= c.fullStart - 1e-6 && station <= c.fullEnd + 1e-6) ??
    rows.find((c) => c.id === selectedId) ??
    rows[0]
  return (
    <div className="h-full space-y-2 overflow-auto" data-testid="road-curve-review">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span>Fitted curves · linked station review</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!rows.length}
          onClick={() => downloadText(curveReviewCsv(alignment, rows, terrain), 'road-curve-review.csv', 'text/csv')}
        >
          Curve CSV
        </Button>
      </div>
      {/* The table scrolls in its own box so its sticky header stays visible above the review. */}
      <div className="max-h-48 overflow-auto rounded-md border" data-testid="road-curve-table-scroll">
        <EngineeringTable data-testid="road-horizontal-curve-table">
          <thead className="sticky top-0 z-10">
            <tr>
              {[
                ['Curve', ''],
                ['Turn', 'direction / full Δ'],
                ['Radius', 'm'],
                ['Start', 'BC or TS'],
                ['End', 'EC or ST'],
                ['Review', ''],
              ].map(([label, unit]) => (
                <ColumnHeader key={label} label={label} unit={unit} />
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} aria-selected={active?.id === c.id}>
                <td>
                  <button
                    className="underline"
                    onClick={() => {
                      setSelectedId(c.id)
                      setExpanded(true)
                      onStation((c.start + c.end) / 2)
                    }}
                    aria-label={`Review curve ${c.id}`}
                  >
                    {c.id}
                  </button>
                </td>
                <td>
                  {c.direction === 'left' ? 'L' : 'R'} · {number(c.deflectionDegrees, 1)}°
                </td>
                <td>{number(c.radius)}</td>
                <td>
                  <button className="underline" onClick={() => onStation(c.fullStart)}>
                    {c.events[0].label} {formatRoadStation(c.fullStart)}
                  </button>
                </td>
                <td>
                  <button className="underline" onClick={() => onStation(c.fullEnd)}>
                    {c.events.at(-1)!.label} {formatRoadStation(c.fullEnd)}
                  </button>
                </td>
                <td className={c.warnings.length ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}>
                  {c.warnings.length
                    ? `${c.warnings.length} review flag${c.warnings.length === 1 ? '' : 's'}`
                    : 'Screen only'}
                </td>
              </tr>
            ))}
          </tbody>
        </EngineeringTable>
      </div>
      {review.error && (
        <p role="alert" className="text-xs text-destructive">
          {review.error}
        </p>
      )}
      {!rows.length && !review.error && (
        <p className="p-2 text-xs text-muted-foreground">
          No fitted horizontal curves. Add an interior PI radius in Design; it must fit its neighbouring tangents.
        </p>
      )}
      {active && (
        <section className="rounded-md border" aria-label={`Curve ${active.id} review`}>
          <button
            className="flex w-full items-center justify-between gap-2 p-2 text-left text-xs font-medium"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <span>
              {active.id} · {active.direction} turn · {number(active.deflectionDegrees, 1)}° full deflection
            </span>
            <span>{expanded ? 'Hide −' : 'Details +'}</span>
          </button>
          {expanded && (
            <div className="space-y-3 border-t p-2 text-xs" data-testid="road-selected-curve-review">
              <div className="flex flex-wrap gap-1" aria-label="Curve geometry stations">
                {active.events.map((event) => (
                  <Button
                    key={event.label}
                    size="sm"
                    variant="outline"
                    aria-label={`${active.id} ${event.label} station`}
                    onClick={() => onStation(event.chainage)}
                  >
                    {event.label} {formatRoadStation(event.chainage)}
                  </Button>
                ))}
              </div>
              <p className="text-2xs text-muted-foreground">
                {active.events.length === 4
                  ? 'TS/ST bound the full curve; SC/CS bound the circular arc. Full deflection includes both spirals.'
                  : 'BC/EC bound the circular curve. No spirals are fitted.'}{' '}
                Arc {number(active.length)} m · entry/exit spirals {number(active.spiralInLengthM)} /{' '}
                {number(active.spiralOutLengthM)} m · total {number(active.fullLength)} m.
              </p>
              <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2">
                {[
                  ['Inside formation width', span(active.insideWidthM, 'm')],
                  ['Outside formation width', span(active.outsideWidthM, 'm')],
                  ['Inside formation radius', span(active.innerFormationRadiusM, 'm')],
                  [
                    'Minimum inside daylight radius',
                    active.minimumInnerDaylightRadiusM === null
                      ? 'Unresolved'
                      : `${number(active.minimumInnerDaylightRadiusM)} m`,
                  ],
                  ['Centreline design grade', span(active.centrelineGradePercent, '%')],
                  ['Inner-edge grade screen', span(active.innerEdgeGradePercent, '%')],
                  [
                    'Required e · speed/friction',
                    active.requiredSuperelevationPercent === null
                      ? 'Not entered'
                      : `${number(active.requiredSuperelevationPercent)}%`,
                  ],
                  [
                    'Capped rotation target',
                    active.cappedSuperelevationPercent === null
                      ? 'Not entered'
                      : `${number(active.cappedSuperelevationPercent)}%`,
                  ],
                  ['Actual inside crossfall', span(active.insideCrossfallPercent, '%')],
                  ['Actual outside crossfall', span(active.outsideCrossfallPercent, '%')],
                  [
                    'Criteria widening · inside/outside',
                    active.insideWideningM === null
                      ? 'Not entered'
                      : `${number(active.insideWideningM)} / ${number(active.outsideWideningM)} m`,
                  ],
                  ['Complete calculated sections', `${active.completeSampleCount} of ${active.sampleCount}`],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-3xs text-muted-foreground">{label}</dt>
                    <dd className="break-words font-mono">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-2xs text-muted-foreground">
                Widths, radii, grades and crossfalls use {active.circularSampleCount} calculated sections on the
                circular arc. Crossfall is positive falling away from the centreline. The capped target can differ from
                actual crossfall because the section retains its template crown. Entered widening is additional to the
                resolved template and local widening ranges.
              </p>
              <div className="space-y-1 text-2xs">
                {active.warnings.map((warning) => (
                  <p key={warning} className="border-l-2 border-amber-500 pl-2 text-amber-800 dark:text-amber-300">
                    {warning}
                  </p>
                ))}
                {active.innerEdgeGradeReason && (
                  <p className="text-muted-foreground">Inner-edge screen unavailable: {active.innerEdgeGradeReason}</p>
                )}
              </div>
              <details className="text-2xs text-muted-foreground">
                <summary className="cursor-pointer">Calculation basis and switchback limits</summary>
                <p className="mt-1">{INNER_EDGE_GRADE_BASIS}</p>
                <p className="mt-1">{CURVE_REVIEW_BASIS}</p>
                <p className="mt-1">
                  Criteria: {alignment.curveDesign?.criteriaName || 'Not named'} ·{' '}
                  {alignment.curveDesign?.criteriaSource || 'No source recorded'}.
                </p>
              </details>
              {(() => {
                // The turn this curve belongs to; a switchback's two curves share one.
                const runs = swept?.maneuvers.filter((t) => t.curveIds.includes(active.id)) ?? []
                const widen = Math.max(
                  0,
                  ...runs.map((t) => Math.max(t.requiredLeftWideningM, t.requiredRightWideningM)),
                )
                return (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-2xs">
                    <p
                      className={runs.length && widen > 0 ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'}
                      data-testid="road-curve-swept-status"
                    >
                      {!runs.length
                        ? 'Vehicle swept path not checked.'
                        : `${runs[0].id} with ${swept!.check.vehicle.name}: ${
                            widen > 0
                              ? `wheels need ${widen.toFixed(2)} m more formation.`
                              : 'wheels stay on the formation.'
                          }`}
                    </p>
                    {onOpenSwept && (
                      <Button size="sm" variant="outline" onClick={onOpenSwept}>
                        {runs.length ? 'Swept path' : 'Check a vehicle'}
                      </Button>
                    )}
                  </div>
                )
              })()}
            </div>
          )}
        </section>
      )}
      {analysis.warnings
        .filter((warning) => /curve|radius|horizontal PI/i.test(warning))
        .map((warning) => (
          <p key={warning} className="text-xs text-amber-700 dark:text-amber-400">
            {warning}
          </p>
        ))}
    </div>
  )
}
