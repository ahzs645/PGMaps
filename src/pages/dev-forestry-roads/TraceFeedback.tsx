import { InfoTip } from '@/components/ui/info-tip'
import { ROAD_FIND_MAX_CELL_M } from './roadLikeness'
import { ROAD_TRACE_MAX_CHORD_M, ROAD_TRACE_SNAP_M } from './roadTrace'
import { TRACE_SNAPPED_COLOR, TRACE_STRAIGHT_COLOR, type RoadTraceState } from './useRoadTrace'

/** The Trace road mode's line in the drawing bar: what the terrain confirmed so far. */
export function TraceFeedback({ trace }: { trace: RoadTraceState }) {
  const done = trace.segments.filter((s) => s !== null)
  const snapped = done.filter((s) => s.status === 'snapped').length
  return (
    <span className="flex items-center gap-1" data-testid="trace-feedback">
      {trace.problem ? (
        <span>Terrain too coarse to follow the road: clicks are joined straight.</span>
      ) : (
        <span>
          <span style={{ color: TRACE_SNAPPED_COLOR }}>{snapped} on the road bench</span>
          {' · '}
          <span style={{ color: TRACE_STRAIGHT_COLOR }}>{done.length - snapped} straight</span>
          {trace.pending ? ` · tracing ${trace.pending}…` : ''}
        </span>
      )}
      <InfoTip label="About tracing a road">
        {trace.problem ? (
          <>{trace.problem} The traced road is kept as clicked and marked as not checked against terrain.</>
        ) : (
          <>
            Click along a road you can see on imagery. Each click moves to the most road-like ground within{' '}
            {ROAD_TRACE_SNAP_M} m, and the line between clicks follows the flattest, smoothest ground between batter
            breaks on bare-earth terrain of {ROAD_FIND_MAX_CELL_M} m or finer. Where the terrain shows no road the
            segment is joined straight (amber). Keep clicks under {ROAD_TRACE_MAX_CHORD_M} m apart, and click at
            junctions so the line takes the right branch. Finish adds it as an existing road you can connect to.
          </>
        )}
      </InfoTip>
    </span>
  )
}
