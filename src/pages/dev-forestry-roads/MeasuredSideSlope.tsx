import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { insetBox } from '@/components/ui/inset-box'
import { cn } from '@/lib/utils'
import { OptionalNumberField } from './Controls'
import { ReferenceHeading } from './CostReferenceControls'
import { INTERIOR_SIDESLOPE_LIMIT_PERCENT } from './bcInteriorCost'
import { FULL_BENCH_SIDESLOPE_PERCENT } from './sectionFixes'
import {
  roadSidehill,
  SIDE_SLOPE_REACH_M,
  sidehillShareAtLeast,
  sidehillSummary,
  type SidehillSummary,
} from './sectionSideSlope'
import type { RoadStation } from './types'
import { formatStation } from './verticalStandards'

/** The road the cost dialog was opened for: what a measured side slope is read from. */
export interface SideSlopeRoad {
  name: string
  length: number
  stations: ReadonlyArray<Pick<RoadStation, 'chainage' | 'section'>>
}

/** What a measured suggestion records beside the side slope it filled. */
export interface MeasuredSideSlopeRecord extends SidehillSummary {
  roadName: string
  /** The figure put in the field: the median, rounded to the nearest integer as IAM 4.3.2.2 records it. */
  percent: number
  method: string
}

export const MEASURED_SIDE_SLOPE_METHOD = `Length-weighted median of each calculated station's ground cross slope: one least-squares line over ${SIDE_SLOPE_REACH_M} m each side of the centreline, read from the road's terrain sections. A suggestion from the terrain model, not a field measurement.`

const percentOf = (share: number) => `${Math.round(share * 100)}%`

/** Said only when terrain misses part of the range; full coverage needs no words. */
const coverageNote = (knownLengthM: number, lengthM: number) => {
  const share = knownLengthM / Math.max(lengthM, 1e-9)
  return share < 0.995 ? ` Terrain covers ${percentOf(share)} of it.` : null
}

/**
 * The road's measured sidehill over a station range, offered as the appraisal's uphill side slope.
 * Nothing is written until **Use**, and then only into the comparison's own inputs, never the project.
 */
export function MeasuredSideSlope({
  road,
  inUse,
  onUse,
}: {
  road: SideSlopeRoad
  /** The suggestion the side slope field holds now, if it holds one. */
  inUse: MeasuredSideSlopeRecord | null
  onUse: (record: MeasuredSideSlopeRecord) => void
}) {
  const rows = useMemo(() => roadSidehill(road.stations), [road.stations])
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const start = from ?? 0,
    end = to ?? road.length
  const summary = end > start ? sidehillSummary(rows, start, end) : null
  const percent = summary ? Math.round(summary.medianPercent) : null
  return (
    <div className={cn(insetBox({ padding: 'md' }), 'space-y-2')} data-testid="road-iam-measured-side-slope">
      <ReferenceHeading info={MEASURED_SIDE_SLOPE_METHOD}>Side slope measured on {road.name}</ReferenceHeading>
      <div className="grid grid-cols-2 gap-2">
        <OptionalNumberField
          label="From station (m)"
          value={from}
          onChange={setFrom}
          min={0}
          max={road.length}
          step={1}
          placeholder="Road start"
        />
        <OptionalNumberField
          label="To station (m)"
          value={to}
          onChange={setTo}
          min={0}
          max={road.length}
          step={1}
          placeholder="Road end"
        />
      </div>
      {!(end > start) ? (
        <p className="text-2xs leading-4 text-warning">The range must end after it starts.</p>
      ) : summary ? (
        <p className="text-2xs leading-4 text-muted-foreground" data-testid="road-iam-measured-side-slope-summary">
          Median <span className="font-semibold text-foreground tabular-nums">{percent}%</span> over{' '}
          {formatStation(summary.from)}–{formatStation(summary.to)}.
          {coverageNote(summary.knownLengthM, summary.lengthM)}
          {summary.pastAppraisalShare > 0 && (
            <span className="text-warning">
              {' '}
              {percentOf(summary.pastAppraisalShare)} is steeper than {INTERIOR_SIDESLOPE_LIMIT_PERCENT}%,{' '}
              {percentOf(summary.fullBenchShare)} at {FULL_BENCH_SIDESLOPE_PERCENT}% or more.
            </span>
          )}
        </p>
      ) : (
        <p className="text-2xs leading-4 text-muted-foreground">
          No station in this range has terrain on both sides of the road.
        </p>
      )}
      <Button
        size="xs"
        variant="outline"
        disabled={!summary || percent === null}
        onClick={() =>
          summary &&
          percent !== null &&
          onUse({ ...summary, roadName: road.name, percent, method: MEASURED_SIDE_SLOPE_METHOD })
        }
      >
        {percent === null ? 'Use the measured side slope' : `Use ${percent}% as the side slope`}
      </Button>
      {inUse && (
        <p className="text-2xs leading-4 text-warning" role="status" data-testid="road-iam-side-slope-measured-note">
          Side slope set to the measured {inUse.percent}% from the terrain model. Confirm it in the field; typing a
          value replaces it.
        </p>
      )}
    </div>
  )
}

/** What a sidehill screen records in a comparison's download. */
export interface MeasuredSidehillScreenRecord {
  roadName: string
  from: number
  to: number
  medianPercent: number
  maxPercent: number
  limitPercent: number
  /** Share of the known length at or past the limit. */
  shareAtOrPastLimit: number
  knownLengthM: number
  lengthM: number
  method: string
}

/** The whole road's measured sidehill against a manual's side-slope limit; null without terrain. */
export function measuredSidehillScreen(road: SideSlopeRoad, limitPercent: number): MeasuredSidehillScreenRecord | null {
  const rows = roadSidehill(road.stations)
  const summary = sidehillSummary(rows, 0, road.length)
  const share = sidehillShareAtLeast(rows, 0, road.length, limitPercent)
  if (!summary || share === null) return null
  return {
    roadName: road.name,
    from: summary.from,
    to: summary.to,
    medianPercent: summary.medianPercent,
    maxPercent: summary.maxPercent,
    limitPercent,
    shareAtOrPastLimit: share,
    knownLengthM: summary.knownLengthM,
    lengthM: summary.lengthM,
    method: MEASURED_SIDE_SLOPE_METHOD,
  }
}

/**
 * Read-only: the road's measured sidehill set against an eligibility limit that has no input field
 * (the Coast manual's tabular-road side slope). It informs the reviewer's own confirmation and
 * never sets it.
 */
export function MeasuredSidehillScreen({
  screen,
  roadName,
  limitPercent,
}: {
  screen: MeasuredSidehillScreenRecord | null
  roadName: string
  limitPercent: number
}) {
  const past = screen !== null && screen.shareAtOrPastLimit > 0
  return (
    <div className={cn(insetBox({ padding: 'md' }), 'space-y-1')} data-testid="road-measured-sidehill-screen">
      <ReferenceHeading info={`${MEASURED_SIDE_SLOPE_METHOD} It does not confirm eligibility.`}>
        Side slope measured on {roadName}
      </ReferenceHeading>
      {screen ? (
        <p
          className={cn('text-2xs leading-4', past ? 'text-warning' : 'text-muted-foreground')}
          data-testid="road-measured-sidehill-screen-summary"
        >
          Median <span className="font-semibold text-foreground tabular-nums">{Math.round(screen.medianPercent)}%</span>
          , steepest <span className="tabular-nums">{Math.round(screen.maxPercent)}%</span>.
          {coverageNote(screen.knownLengthM, screen.lengthM)}{' '}
          {past
            ? `${percentOf(screen.shareAtOrPastLimit)} is at ${limitPercent}% or steeper and needs engineering review.`
            : `None past ${limitPercent}%.`}
        </p>
      ) : (
        <p className="text-2xs leading-4 text-muted-foreground">
          No station on this road has terrain on both sides, so no side slope is measured.
        </p>
      )}
    </div>
  )
}
