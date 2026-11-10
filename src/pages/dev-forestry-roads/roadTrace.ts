/**
 * Tracing a road by clicking along it. Each click is moved to the most road-like ground within
 * ROAD_TRACE_SNAP_M, and the road between two clicks is the cheapest path over the road-likeness
 * grid (`roadLikeness.ts`) inside a capsule around the chord. Where the ground does not show a
 * road (no terrain, terrain too coarse, or a path that is not road-like on average) the segment
 * falls back to the straight chord and is marked `straight`, so a trace from imagery alone still
 * works and says which parts the terrain confirmed. Pure: no DOM or network access.
 */
import {
  boundsOfLine,
  cumulativeLength,
  distanceField,
  frameFor,
  groundOnFrameSteps,
  isSurfaceGrid,
  leastCostPathSteps,
  simplifyLine,
  smoothLine,
  type GroundInput,
  type XY,
} from './roadGrid'
import {
  ROAD_FIND_SAMPLE_CELL_M,
  ROAD_LIKENESS_REACH_CELLS,
  roadFindingTerrainProblem,
  roadLikenessSteps,
} from './roadLikeness'
import { measureRoadSlices, ROAD_SLICE_HALF_WIDTH_M } from './roadSlices'
import type { SurfaceGrid } from './surfaceGrid'

/** A click moves to the most road-like cell within this distance, m. */
export const ROAD_TRACE_SNAP_M = 5
/** A click moves only onto ground at least this road-like. */
export const ROAD_TRACE_SNAP_MIN_LIKENESS = 0.3
/** The search capsule's half-width: this share of the chord, within these bounds, m. */
export const ROAD_TRACE_HALF_WIDTH_SHARE = 0.3
export const ROAD_TRACE_MIN_HALF_WIDTH_M = 20
export const ROAD_TRACE_MAX_HALF_WIDTH_M = 60
/** Clicks further apart than this are joined straight: click more often, m. */
export const ROAD_TRACE_MAX_CHORD_M = 800
/** A traced segment must average at least this road-likeness, or it falls back to the chord. */
export const ROAD_TRACE_MIN_LIKENESS = 0.5
/** Off-road lead-ins this long or shorter between a click and the road are dropped, m. */
export const ROAD_TRACE_MAX_LEAD_M = 15
/** A snapped segment needs a bench in at least this share of its cross-sections. */
export const ROAD_TRACE_MIN_BENCH_SHARE = 0.5
/** Path vertices in the smoothing window (1 m cells: about 7 m). */
export const ROAD_TRACE_SMOOTH_VERTICES = 7
export const ROAD_TRACE_SIMPLIFY_M = 0.5

export interface SnappedClick {
  at: XY
  likeness: number
  movedM: number
  /** The click moved onto road-like ground. */
  onRoad: boolean
}

/** Moves a click onto the most road-like ground within `radiusM`; null where there is no terrain at the click. */
export function snapToRoad(likeness: SurfaceGrid, at: XY, radiusM = ROAD_TRACE_SNAP_M): SnappedClick | null {
  const { origin, cellM, width, height, values } = likeness
  const col = Math.round((at[0] - origin[0]) / cellM),
    row = Math.round((origin[1] - at[1]) / cellM)
  if (col < 0 || row < 0 || col >= width || row >= height || Number.isNaN(values[row * width + col])) return null
  const reach = Math.ceil(radiusM / cellM)
  let best: { at: XY; likeness: number; movedM: number } | null = null
  for (let r = Math.max(0, row - reach); r <= Math.min(height - 1, row + reach); r++)
    for (let c = Math.max(0, col - reach); c <= Math.min(width - 1, col + reach); c++) {
      const v = values[r * width + c]
      if (Number.isNaN(v)) continue
      const p: XY = [origin[0] + c * cellM, origin[1] - r * cellM]
      const d = Math.hypot(p[0] - at[0], p[1] - at[1])
      if (d > radiusM) continue
      if (!best || v > best.likeness + 1e-9 || (Math.abs(v - best.likeness) <= 1e-9 && d < best.movedM))
        best = { at: p, likeness: v, movedM: d }
    }
  if (!best || best.likeness < ROAD_TRACE_SNAP_MIN_LIKENESS) {
    const v = values[row * width + col]
    return { at: [at[0], at[1]], likeness: v, movedM: 0, onRoad: false }
  }
  return { ...best, onRoad: true }
}

export interface TraceSegment {
  /** The segment's line, from near the first click to near the second. */
  path: XY[]
  status: 'snapped' | 'straight'
  /** Mean road-likeness along a snapped path. */
  meanLikeness: number | null
  /** Why a segment fell back to the chord. */
  reason?: string
  explored: number
}

const straight = (from: XY, to: XY, reason: string, explored = 0): TraceSegment => ({
  path: [
    [from[0], from[1]],
    [to[0], to[1]],
  ],
  status: 'straight',
  meanLikeness: null,
  reason,
  explored,
})

export const traceHalfWidthM = (chordM: number) =>
  Math.min(ROAD_TRACE_MAX_HALF_WIDTH_M, Math.max(ROAD_TRACE_MIN_HALF_WIDTH_M, ROAD_TRACE_HALF_WIDTH_SHARE * chordM))

/**
 * The road between two clicks on a road-likeness grid. The search keeps to the capsule around
 * the chord; off-road lead-ins of up to ROAD_TRACE_MAX_LEAD_M at either click are dropped, so a
 * click beside the road still gives a line on it.
 */
export function* traceRoadSteps(
  likeness: SurfaceGrid,
  from: XY,
  to: XY,
  /** The ground the score was read from: when given, a snapped segment must also show a bench in cross-section. */
  dtm?: SurfaceGrid,
): Generator<{ explored: number }, TraceSegment> {
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1])
  if (chord > ROAD_TRACE_MAX_CHORD_M)
    return straight(from, to, `Clicks over ${ROAD_TRACE_MAX_CHORD_M} m apart are joined straight; click more often.`)
  if (chord < likeness.cellM) return straight(from, to, 'The clicks are on the same cell.')
  const a = snapToRoad(likeness, from),
    b = snapToRoad(likeness, to)
  if (!a || !b) return straight(from, to, 'No terrain at a click.')
  const { origin, cellM, width, height, values } = likeness
  const halfWidth = traceHalfWidthM(chord)
  const dist = distanceField(likeness, [a.at, b.at], halfWidth)
  const conductance = new Float32Array(width * height)
  for (let i = 0; i < conductance.length; i++) if (dist[i] <= halfWidth && values[i] > 0) conductance[i] = values[i]
  const cellOf = (p: XY) => Math.round((origin[1] - p[1]) / cellM) * width + Math.round((p[0] - origin[0]) / cellM)
  const target = new Uint8Array(width * height)
  target[cellOf(b.at)] = 1
  const search = leastCostPathSteps({
    width,
    height,
    cellM,
    conductance,
    sources: [cellOf(a.at)],
    targets: target,
    heuristic: (i) => {
      const r = Math.floor(i / width)
      return Math.hypot(origin[0] + (i - r * width) * cellM - b.at[0], origin[1] - r * cellM - b.at[1])
    },
  })
  let step = search.next()
  while (!step.done) {
    yield step.value
    step = search.next()
  }
  const { path: cells, explored } = step.value
  if (!cells) return straight(from, to, 'Missing terrain between the clicks.', explored)
  const xy = cells.map((i) => {
    const r = Math.floor(i / width)
    return [origin[0] + (i - r * width) * cellM, origin[1] - r * cellM] as XY
  })
  const sigma = cells.map((i) => values[i])
  // Drop short off-road lead-ins at each click.
  const lead = (order: number[]) => {
    let walked = 0
    for (let k = 0; k < order.length; k++) {
      if (sigma[order[k]] >= ROAD_TRACE_MIN_LIKENESS) return walked <= ROAD_TRACE_MAX_LEAD_M ? k : 0
      if (k > 0) walked += Math.hypot(xy[order[k]][0] - xy[order[k - 1]][0], xy[order[k]][1] - xy[order[k - 1]][1])
    }
    return 0
  }
  const indices = cells.map((_, k) => k)
  const first = lead(indices),
    last = cells.length - 1 - lead([...indices].reverse())
  const kept = last - first >= 1 ? indices.slice(first, last + 1) : indices
  const mean = kept.reduce((s, k) => s + sigma[k], 0) / kept.length
  if (mean < ROAD_TRACE_MIN_LIKENESS)
    return straight(
      from,
      to,
      `The ground between these clicks does not look like a road (mean road-likeness ${mean.toFixed(2)}).`,
      explored,
    )
  const line = simplifyLine(
    smoothLine(
      kept.map((k) => xy[k]),
      ROAD_TRACE_SMOOTH_VERTICES,
    ),
    ROAD_TRACE_SIMPLIFY_M,
  )
  // Smooth gentle ground scores as road-like everywhere; only a bench between batters says a road is there.
  if (dtm) {
    const slices = measureRoadSlices(dtm, line)
    if (slices.complete > 0 && slices.benchShare < ROAD_TRACE_MIN_BENCH_SHARE)
      return straight(
        from,
        to,
        `No road bench in cross-section between these clicks (bench in ${Math.round(slices.benchShare * 100)}% of sections).`,
        explored,
      )
  }
  return { path: line, status: 'snapped', meanLikeness: mean, explored }
}

/**
 * The road between two clicks, reading the ground itself: samples the capsule around the chord,
 * scores it and traces it. `terrainCellM` is the terrain's own resolution; coarser than
 * ROAD_FIND_MAX_CELL_M gives a straight segment that says why.
 */
export function* traceSegmentOnTerrainSteps(
  ground: GroundInput,
  terrainCellM: number,
  from: XY,
  to: XY,
): Generator<{ explored: number }, TraceSegment> {
  const coarse = roadFindingTerrainProblem(terrainCellM)
  if (coarse) return straight(from, to, coarse)
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1])
  if (chord > ROAD_TRACE_MAX_CHORD_M)
    return straight(from, to, `Clicks over ${ROAD_TRACE_MAX_CHORD_M} m apart are joined straight; click more often.`)
  const cellM = isSurfaceGrid(ground) ? ground.cellM : ground.cellM || ROAD_FIND_SAMPLE_CELL_M
  const halfWidth = traceHalfWidthM(chord)
  const reach =
    halfWidth + Math.max(ROAD_TRACE_SNAP_M, ROAD_SLICE_HALF_WIDTH_M) + (ROAD_LIKENESS_REACH_CELLS + 1) * cellM
  const frame = frameFor(boundsOfLine([from, to], reach), cellM, isSurfaceGrid(ground) ? ground : undefined)
  if (!frame.width || !frame.height) return straight(from, to, 'No terrain at the clicks.')
  const dist = distanceField(frame, [from, to], reach)
  const sampling = groundOnFrameSteps(ground, frame, (i) => dist[i] <= reach)
  let s = sampling.next()
  while (!s.done) {
    yield { explored: 0 }
    s = sampling.next()
  }
  const scoring = roadLikenessSteps(s.value)
  let l = scoring.next()
  while (!l.done) {
    yield { explored: 0 }
    l = scoring.next()
  }
  return yield* traceRoadSteps(l.value, from, to, s.value)
}

/** Consecutive segments as one line, and how many of them followed the terrain. */
export function joinTrace(segments: readonly TraceSegment[]): { line: XY[]; snapped: number; straight: number } {
  const line: XY[] = []
  for (const segment of segments)
    for (const p of segment.path) {
      const prev = line.at(-1)
      if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.01) line.push(p)
    }
  return {
    line,
    snapped: segments.filter((s) => s.status === 'snapped').length,
    straight: segments.filter((s) => s.status === 'straight').length,
  }
}

export const traceLengthM = (line: readonly XY[]) => cumulativeLength(line).at(-1) ?? 0
