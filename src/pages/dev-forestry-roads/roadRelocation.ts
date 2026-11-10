/**
 * Finds a mapped or traced road on bare-earth terrain. Inside a corridor around the line, the
 * cheapest path between the line's two ends is searched over the road-likeness grid
 * (`roadLikeness.ts`), with a weak pull towards the line; cross-sections along that path
 * (`roadSlices.ts`) then decide, stretch by stretch, whether a road bench is really there.
 *
 * The result is a **candidate copy**: the found path where a bench was found, and the original
 * line, flagged, where none was. Nothing here edits the source record. Adapted in our own terms
 * from the ground-only part of Roussel et al. (2022); see
 * docs/forestry-road-design/road-relocation-and-tracing.md for the method, limits and failure
 * modes. Long work is a generator for `cooperative.ts`. Pure: no DOM or network access.
 */
import {
  boundsOfLine,
  cumulativeLength,
  distanceField,
  frameFor,
  groundOnFrameSteps,
  isSurfaceGrid,
  leastCostPathSteps,
  nearestOnLine,
  pointAlong,
  resampleLine,
  simplifyLine,
  smoothLine,
  spreadOf,
  subLine,
  type GroundInput,
  type XY,
} from './roadGrid'
import {
  ROAD_FIND_SAMPLE_CELL_M,
  ROAD_LIKENESS_REACH_CELLS,
  roadFindingTerrainProblem,
  roadLikenessSteps,
  type RoadLikenessOptions,
} from './roadLikeness'
import {
  ROAD_SLICE_HALF_WIDTH_M,
  ROAD_SLICE_SPACING_M,
  measureRoadSlices,
  summarizeSlices,
  type RoadSlice,
  type RoadSliceSummary,
} from './roadSlices'
import { sampleBilinear, type SurfaceGrid } from './surfaceGrid'

/** Default search half-width either side of the line, m. */
export const ROAD_FIND_CORRIDOR_M = 40
export const MIN_ROAD_FIND_CORRIDOR_M = 10
export const MAX_ROAD_FIND_CORRIDOR_M = 80
/** How strongly the search keeps to the line: the pull falls from 1 on it to 1 − this at the corridor edge. */
export const ROAD_FIND_CONFIDENCE = 0.1
/** Lines are searched in pieces of at most this length, each with its own end caps, m. */
export const ROAD_FIND_CHUNK_M = 1000
/** Cells one piece's search window may hold. */
export const ROAD_FIND_MAX_CELLS = 2_000_000
export const ROAD_FIND_MIN_LENGTH_M = 30
export const ROAD_FIND_MAX_LENGTH_M = 20_000
/** A section needs at least this mean road-likeness along the path, as well as a bench, to count as found. */
export const ROAD_FIND_MIN_LIKENESS = 0.5
/** Found or not-found stretches shorter than this are absorbed by their neighbours, m. */
export const ROAD_FIND_MIN_RUN_M = 30
/** Share of the line found for a "found" verdict, and below which nothing is offered. */
export const ROAD_FIND_FOUND_SHARE = 0.8
export const ROAD_FIND_PARTIAL_SHARE = 0.2
/** Path vertices in the smoothing window (1 m cells: about 7 m). */
export const ROAD_FIND_SMOOTH_VERTICES = 7
/** The candidate is thinned at this tolerance, m. */
export const ROAD_FIND_SIMPLIFY_M = 0.5
/** Shifts are measured from points this far apart along the original line, m. */
export const ROAD_FIND_SHIFT_STEP_M = 5

export type RoadFindStatus = 'found' | 'partial' | 'not-found' | 'incomplete-terrain' | 'too-coarse' | 'refused'

/** A stretch of the original line, by its own chainage. */
export interface RoadFindRange {
  from: number
  to: number
  kind: 'found' | 'not-found' | 'no-terrain'
}

export interface RoadFindInput {
  /** The mapped or traced line, projected metres. */
  line: XY[]
  ground: GroundInput
  /** The terrain's own cell size, m; coarser than ROAD_FIND_MAX_CELL_M is refused. */
  terrainCellM: number
  corridorHalfWidthM?: number
  confidence?: number
  likeness?: Partial<RoadLikenessOptions>
}

export interface RoadFindResult {
  status: RoadFindStatus
  /** One or two sentences naming what was found, or the limit and the place that stopped it. */
  reason: string
  /** A new line: the found road where a bench was found, the original elsewhere. Never the record itself. */
  candidate: XY[]
  /** The whole searched path, smoothed; null when no path was searched or found. */
  foundLine: XY[] | null
  /** Stretches of the original line by what was found there. */
  ranges: RoadFindRange[]
  /** Distance from each original vertex to the candidate, m. */
  vertexShiftM: number[]
  /** Original → candidate distance over the found stretches, sampled every ROAD_FIND_SHIFT_STEP_M. */
  shiftM: { p50: number; p90: number; max: number } | null
  /** Share of the original line's length found, 0–1. */
  foundShare: number
  /** Road-likeness along the searched path. */
  likenessAlong: { mean: number; shareAbove05: number } | null
  /** Cross-sections along the searched path. */
  slices: RoadSliceSummary | null
  /** Share of corridor cells with terrain. */
  corridorCoverage: number
  explored: number
  lengthM: number
  corridorHalfWidthM: number
}

export interface RoadFindProgress {
  phase: 'terrain' | 'likeness' | 'search' | 'slices'
  piece: number
  pieces: number
  explored: number
}

interface PieceResult {
  path: XY[] | null
  slices: RoadSlice[]
  sliceLikeness: number[]
  likeness: number[]
  inside: number
  known: number
  explored: number
  /** Chainages along the piece's own line with no ground under it. */
  missing: number[]
}

const fmt = (m: number) => `${Math.round(m)} m`

/** Splits a list of chainages into contiguous ranges at gaps over `gapM`. */
function rangesOf(chainages: number[], gapM: number): [number, number][] {
  const out: [number, number][] = []
  for (const s of chainages) {
    const last = out.at(-1)
    if (last && s - last[1] <= gapM) last[1] = s
    else out.push([s, s])
  }
  return out
}

function* searchPieceSteps(
  line: XY[],
  ground: GroundInput,
  halfWidthM: number,
  confidence: number,
  likenessOptions: Partial<RoadLikenessOptions>,
  piece: number,
  pieces: number,
  explored0: number,
): Generator<RoadFindProgress, PieceResult> {
  const cellM = isSurfaceGrid(ground) ? ground.cellM : ground.cellM || ROAD_FIND_SAMPLE_CELL_M
  const reach = halfWidthM + ROAD_SLICE_HALF_WIDTH_M + (ROAD_LIKENESS_REACH_CELLS + 1) * cellM
  const frame = frameFor(boundsOfLine(line, reach), cellM, isSurfaceGrid(ground) ? ground : undefined)
  const n = frame.width * frame.height
  const dist = distanceField(frame, line, reach)
  const sampling = groundOnFrameSteps(ground, frame, (i) => dist[i] <= reach)
  let s = sampling.next()
  while (!s.done) {
    yield { phase: 'terrain', piece, pieces, explored: explored0 }
    s = sampling.next()
  }
  const dtm = s.value
  const lineCum = cumulativeLength(line)
  const missing: number[] = []
  for (let c = 0; c <= (lineCum.at(-1) ?? 0); c += 1) {
    const { at } = pointAlong(line, lineCum, c)
    if (Number.isNaN(sampleBilinear(dtm, at[0], at[1]))) missing.push(c)
  }
  const likenessSteps = roadLikenessSteps(dtm, likenessOptions)
  let l = likenessSteps.next()
  while (!l.done) {
    yield { phase: 'likeness', piece, pieces, explored: explored0 }
    l = likenessSteps.next()
  }
  const like = l.value
  const conductance = new Float32Array(n)
  let inside = 0,
    known = 0
  for (let i = 0; i < n; i++) {
    if (dist[i] > halfWidthM) continue
    inside++
    const v = like.values[i]
    if (Number.isNaN(v)) continue
    known++
    conductance[i] = v * (1 - (confidence * dist[i]) / halfWidthM)
  }
  // End caps: half-discs behind each end, free to cross, so the path can join the road wherever it
  // passes the end rather than at the record's end point.
  const total = lineCum.at(-1) ?? 0
  const tangentSpan = Math.min(20, total / 2)
  const a = line[0],
    aInto = pointAlong(line, lineCum, tangentSpan).at
  const b = line.at(-1)!,
    bInto = pointAlong(line, lineCum, total - tangentSpan).at
  const ta: XY = [aInto[0] - a[0], aInto[1] - a[1]],
    tb: XY = [bInto[0] - b[0], bInto[1] - b[1]]
  const startCap = new Uint8Array(n),
    endCap = new Uint8Array(n)
  const sources: number[] = []
  const capR = halfWidthM
  for (let r = 0; r < frame.height; r++) {
    const y = frame.origin[1] - r * cellM
    for (let c = 0; c < frame.width; c++) {
      const i = r * frame.width + c
      if (!(conductance[i] > 0)) continue
      const x = frame.origin[0] + c * cellM
      if (Math.hypot(x - a[0], y - a[1]) <= capR && (x - a[0]) * ta[0] + (y - a[1]) * ta[1] < 0) {
        startCap[i] = 1
        conductance[i] = 1
        sources.push(i)
      } else if (Math.hypot(x - b[0], y - b[1]) <= capR && (x - b[0]) * tb[0] + (y - b[1]) * tb[1] < 0) {
        endCap[i] = 1
        conductance[i] = 1
      }
    }
  }
  const search = leastCostPathSteps({
    width: frame.width,
    height: frame.height,
    cellM,
    conductance,
    sources,
    targets: endCap,
    heuristic: (i) => {
      const r = Math.floor(i / frame.width)
      const x = frame.origin[0] + (i - r * frame.width) * cellM,
        y = frame.origin[1] - r * cellM
      return Math.max(0, Math.hypot(x - b[0], y - b[1]) - capR)
    },
  })
  let found = search.next()
  while (!found.done) {
    yield { phase: 'search', piece, pieces, explored: explored0 + found.value.explored }
    found = search.next()
  }
  const { path: cells, explored } = found.value
  const base = { inside, known, explored, missing }
  if (!cells) return { ...base, path: null, slices: [], sliceLikeness: [], likeness: [] }
  let first = 0,
    last = cells.length - 1
  for (let k = 0; k < cells.length; k++) if (startCap[cells[k]]) first = k
  for (let k = cells.length - 1; k >= first; k--) if (endCap[cells[k]]) last = k
  const raw = cells.slice(first, last + 1).map((i) => {
    const r = Math.floor(i / frame.width)
    return [frame.origin[0] + (i - r * frame.width) * cellM, frame.origin[1] - r * cellM] as XY
  })
  const path = raw.length >= 2 ? smoothLine(raw, ROAD_FIND_SMOOTH_VERTICES) : raw
  yield { phase: 'slices', piece, pieces, explored: explored0 + explored }
  const likeAt = (p: XY) => sampleNearest(like, p)
  const along = path.length >= 2 ? resampleLine(path, cellM) : path
  const likeness = along.map(likeAt).filter((v) => !Number.isNaN(v))
  const slices = path.length >= 2 ? measureRoadSlices(dtm, path).slices : []
  const pathCum = cumulativeLength(path)
  const sliceLikeness = slices.map((slice) => {
    const values: number[] = []
    for (let d = -ROAD_SLICE_SPACING_M / 2; d <= ROAD_SLICE_SPACING_M / 2; d += cellM) {
      const v = likeAt(pointAlong(path, pathCum, slice.chainage + d).at)
      if (!Number.isNaN(v)) values.push(v)
    }
    return values.length ? values.reduce((x, y) => x + y, 0) / values.length : NaN
  })
  return { ...base, path, slices, sliceLikeness, likeness }
}

function sampleNearest(grid: SurfaceGrid, p: XY): number {
  const c = Math.round((p[0] - grid.origin[0]) / grid.cellM),
    r = Math.round((grid.origin[1] - p[1]) / grid.cellM)
  if (c < 0 || r < 0 || c >= grid.width || r >= grid.height) return NaN
  return grid.values[r * grid.width + c]
}

function unchanged(
  input: { line: XY[] },
  status: RoadFindStatus,
  reason: string,
  extra: Partial<RoadFindResult> = {},
): RoadFindResult {
  const lengthM = cumulativeLength(input.line).at(-1) ?? 0
  return {
    status,
    reason,
    candidate: input.line.map((p) => [p[0], p[1]] as XY),
    foundLine: null,
    ranges: lengthM > 0 ? [{ from: 0, to: lengthM, kind: 'not-found' }] : [],
    vertexShiftM: input.line.map(() => 0),
    shiftM: null,
    foundShare: 0,
    likenessAlong: null,
    slices: null,
    corridorCoverage: 0,
    explored: 0,
    lengthM,
    corridorHalfWidthM: ROAD_FIND_CORRIDOR_M,
    ...extra,
  }
}

/** Finds the line's road on the terrain, in slices. See the module comment. */
export function* findRoadOnTerrainSteps(input: RoadFindInput): Generator<RoadFindProgress, RoadFindResult> {
  const line = input.line.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - input.line[i - 1][0], p[1] - input.line[i - 1][1]) > 1e-6,
  )
  const halfWidthM = Math.min(
    MAX_ROAD_FIND_CORRIDOR_M,
    Math.max(MIN_ROAD_FIND_CORRIDOR_M, input.corridorHalfWidthM ?? ROAD_FIND_CORRIDOR_M),
  )
  const confidence = Math.min(1, Math.max(0, input.confidence ?? ROAD_FIND_CONFIDENCE))
  const lengthM = cumulativeLength(line).at(-1) ?? 0
  const coarse = roadFindingTerrainProblem(input.terrainCellM)
  if (coarse) return unchanged({ line }, 'too-coarse', coarse, { corridorHalfWidthM: halfWidthM })
  if (line.length < 2 || lengthM < ROAD_FIND_MIN_LENGTH_M)
    return unchanged(
      { line },
      'refused',
      `The line is shorter than ${ROAD_FIND_MIN_LENGTH_M} m; there is no road to follow.`,
    )
  if (lengthM > ROAD_FIND_MAX_LENGTH_M)
    return unchanged(
      { line },
      'refused',
      `The line is ${(lengthM / 1000).toFixed(1)} km; road finding takes at most ${ROAD_FIND_MAX_LENGTH_M / 1000} km at a time. Split the road first.`,
    )
  if (confidence >= 1)
    return unchanged({ line }, 'refused', 'Confidence 1 keeps the line as it is; nothing was searched.')
  const cellM = isSurfaceGrid(input.ground) ? input.ground.cellM : input.ground.cellM || ROAD_FIND_SAMPLE_CELL_M
  const reach = halfWidthM + ROAD_SLICE_HALF_WIDTH_M + (ROAD_LIKENESS_REACH_CELLS + 1) * cellM
  const pieceM = Math.max(
    100,
    Math.min(ROAD_FIND_CHUNK_M, Math.sqrt(ROAD_FIND_MAX_CELLS) * cellM - 2 * reach - 2 * cellM),
  )
  const pieces = Math.max(1, Math.ceil(lengthM / pieceM))
  const cum = cumulativeLength(line)
  const results: PieceResult[] = []
  let explored = 0
  for (let k = 0; k < pieces; k++) {
    const from = (lengthM * k) / pieces,
      to = (lengthM * (k + 1)) / pieces
    const piece = searchPieceSteps(
      subLine(line, cum, from, to),
      input.ground,
      halfWidthM,
      confidence,
      input.likeness ?? {},
      k + 1,
      pieces,
      explored,
    )
    let step = piece.next()
    while (!step.done) {
      yield step.value
      step = piece.next()
    }
    const result = step.value
    explored += result.explored
    results.push({ ...result, missing: result.missing.map((c) => c + from) })
  }
  const inside = results.reduce((s, r) => s + r.inside, 0),
    known = results.reduce((s, r) => s + r.known, 0)
  const corridorCoverage = inside ? known / inside : 0
  const missing = rangesOf(
    results.flatMap((r) => r.missing),
    2,
  )
  const common = { corridorCoverage, explored, corridorHalfWidthM: halfWidthM, lengthM }
  if (results.some((r) => !r.path)) {
    const places = missing.length
      ? missing
          .slice(0, 3)
          .map(([a, b]) => (b - a < 1 ? `at ${fmt(a)}` : `${fmt(a)}–${fmt(b)}`))
          .join(', ')
      : 'beside the line'
    return unchanged(
      { line },
      'incomplete-terrain',
      `No path could be followed: the terrain has gaps across the ${halfWidthM} m search corridor (${places} along the line). Missing ground is never crossed. Load terrain that covers the whole road.`,
      {
        ...common,
        ranges: missing.length
          ? missing.map(([a, b]) => ({ from: a, to: Math.max(b, a + 1), kind: 'no-terrain' as const }))
          : [{ from: 0, to: lengthM, kind: 'no-terrain' as const }],
      },
    )
  }
  // Join the pieces' paths and their slices into one run along the found line.
  const path: XY[] = []
  const slices: RoadSlice[] = []
  const sliceLikeness: number[] = []
  for (const r of results) {
    const offset = path.length ? (cumulativeLength(path).at(-1) ?? 0) : 0
    const start = path.length ? Math.hypot(r.path![0][0] - path.at(-1)![0], r.path![0][1] - path.at(-1)![1]) : 0
    for (const p of r.path!) path.push(p)
    for (const s of r.slices) slices.push({ ...s, chainage: s.chainage + offset + start })
    sliceLikeness.push(...r.sliceLikeness)
  }
  const pathCum = cumulativeLength(path)
  const pathLength = pathCum.at(-1) ?? 0
  const likeness = results.flatMap((r) => r.likeness)
  const likenessAlong = likeness.length
    ? {
        mean: likeness.reduce((s, v) => s + v, 0) / likeness.length,
        shareAbove05: likeness.filter((v) => v >= 0.5).length / likeness.length,
      }
    : null
  const summary = summarizeSlices(slices)
  type Kind = RoadFindRange['kind']
  const kinds: Kind[] = slices.map((s, i) =>
    !s.complete ? 'no-terrain' : s.bench && sliceLikeness[i] >= ROAD_FIND_MIN_LIKENESS ? 'found' : 'not-found',
  )
  // Runs along the found path; a short run takes its neighbours' kind.
  const minSlices = Math.max(1, Math.ceil(ROAD_FIND_MIN_RUN_M / ROAD_SLICE_SPACING_M))
  const runsOf = () => {
    const runs: { kind: Kind; first: number; last: number }[] = []
    kinds.forEach((kind, i) => {
      const last = runs.at(-1)
      if (last && last.kind === kind) last.last = i
      else runs.push({ kind, first: i, last: i })
    })
    return runs
  }
  // A short gap between found stretches, or at an end beside one, is a culvert, a landing or a
  // noisy section rather than the road leaving its bench.
  for (const run of runsOf()) {
    if (run.kind === 'found' || run.last - run.first + 1 >= minSlices) continue
    const before = run.first > 0 ? kinds[run.first - 1] : null,
      after = run.last < kinds.length - 1 ? kinds[run.last + 1] : null
    if ((before ?? after) === 'found' && (after ?? before) === 'found')
      for (let i = run.first; i <= run.last; i++) kinds[i] = 'found'
  }
  for (const run of runsOf())
    if (run.kind === 'found' && run.last - run.first + 1 < minSlices)
      for (let i = run.first; i <= run.last; i++) kinds[i] = 'not-found'
  const runs = runsOf()
  const half = ROAD_SLICE_SPACING_M / 2
  const onOriginal = (s: number) => nearestOnLine(line, cum, pointAlong(path, pathCum, s).at).chainage
  const ranges: RoadFindRange[] = []
  const pieceLines: XY[][] = []
  runs.forEach((run, i) => {
    const p0 = i === 0 ? 0 : slices[run.first].chainage - half,
      p1 = i === runs.length - 1 ? pathLength : slices[run.last].chainage + half
    const o0 = i === 0 ? 0 : Math.max(ranges.at(-1)?.to ?? 0, onOriginal(p0))
    const o1 = i === runs.length - 1 ? lengthM : Math.max(o0, onOriginal(p1))
    ranges.push({ from: o0, to: o1, kind: run.kind })
    pieceLines.push(run.kind === 'found' ? subLine(path, pathCum, p0, p1) : subLine(line, cum, o0, o1))
  })
  if (!runs.length) ranges.push({ from: 0, to: lengthM, kind: 'not-found' })
  const foundLength = ranges.filter((r) => r.kind === 'found').reduce((s, r) => s + (r.to - r.from), 0)
  const foundShare = lengthM ? Math.min(1, foundLength / lengthM) : 0
  const evidence = `bench in ${Math.round(summary.benchShare * 100)}% of sections, mean road-likeness ${likenessAlong ? likenessAlong.mean.toFixed(2) : '—'}`
  if (foundShare < ROAD_FIND_PARTIAL_SHARE)
    return unchanged(
      { line },
      'not-found',
      `No road bench was found within ${halfWidthM} m of this line (${evidence}). The line is kept as it is.`,
      { ...common, foundLine: path, likenessAlong, slices: summary },
    )
  const joined: XY[] = []
  for (const piece of pieceLines)
    for (const p of piece) {
      const prev = joined.at(-1)
      if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 0.01) joined.push(p)
    }
  const candidate = simplifyLine(joined, ROAD_FIND_SIMPLIFY_M)
  const candidateCum = cumulativeLength(candidate)
  const shifts: number[] = []
  for (let c = 0; c <= lengthM + 1e-9; c += ROAD_FIND_SHIFT_STEP_M)
    if (ranges.some((r) => r.kind === 'found' && c >= r.from && c <= r.to))
      shifts.push(nearestOnLine(candidate, candidateCum, pointAlong(line, cum, c).at).distance)
  const shiftM = spreadOf(shifts)
  const vertexShiftM = line.map((p) => nearestOnLine(candidate, candidateCum, p).distance)
  const kept = ranges.filter((r) => r.kind !== 'found')
  const status: RoadFindStatus = foundShare >= ROAD_FIND_FOUND_SHARE ? 'found' : 'partial'
  const reason =
    `Found a road bench along ${Math.round(foundShare * 100)}% of the line` +
    (shiftM ? `, a median ${shiftM.p50.toFixed(1)} m from it (P90 ${shiftM.p90.toFixed(1)} m)` : '') +
    `. ` +
    (kept.length
      ? `${kept.length} stretch${kept.length === 1 ? '' : 'es'} with no bench ${kept.length === 1 ? 'is' : 'are'} kept as the original line.`
      : 'Every stretch had a bench.')
  return {
    status,
    reason,
    candidate,
    foundLine: path,
    ranges,
    vertexShiftM,
    shiftM,
    foundShare,
    likenessAlong,
    slices: summary,
    ...common,
  }
}

/** Runs the search to the end in one go. */
export function findRoadOnTerrain(input: RoadFindInput): RoadFindResult {
  const steps = findRoadOnTerrainSteps(input)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}
