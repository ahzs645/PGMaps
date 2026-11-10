/**
 * Finds a mapped or traced road on bare-earth terrain. Inside a corridor around the line, the
 * cheapest path between the line's two ends is searched over the road-likeness grid
 * (`roadLikeness.ts`), with a weak pull towards the line; cross-sections along that path
 * (`roadSlices.ts`) then decide, stretch by stretch, whether a road bench is really there.
 *
 * The result is a **candidate copy**: the found path where a bench was found, and the original
 * line, flagged, where none was. Nothing here edits the source record.
 *
 * With point-cloud evidence covering the corridor (`vegetationEvidence.ts`), the search runs on the
 * full conductivity of equation 1 and the sections also measure the drivable width and the
 * vegetation over the bed, which with the shoulders found and the path's harmonic-mean conductivity
 * give the road's state score and class (`roadState.ts`). The found/not-found verdict stays a
 * terrain question in both modes: a bench, and terrain road-likeness of 0.5 along the path, so an
 * overgrown road is still found and then graded rather than lost. Water polygons are impassable,
 * except within 5 m of where the record crosses them, which is a presumed structure, never found road.
 *
 * Follows Roussel, Bourdon, Morley, Coops & Achim (2022), doi:10.1016/j.jag.2022.103020; see
 * docs/forestry-road-design/road-relocation-and-tracing.md for the method, limits and failure
 * modes. Written from the paper and a functional specification of ALSroads 0.2.0; no code from
 * ALSroads (GPL-3) was used. Long work is a generator for `cooperative.ts`. Pure: no DOM or network
 * access.
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
  type GridFrame,
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
  type RoadSliceOptions,
  type RoadSliceSummary,
} from './roadSlices'
import {
  DEFAULT_ROAD_FIND_SETTINGS,
  harmonicConductivity,
  lineDifference,
  roadState,
  sinuosity,
  type RoadFindSettings,
  type RoadState,
  type RoadStateClass,
} from './roadState'
import { sampleBilinear, type SurfaceGrid } from './surfaceGrid'
import { evidenceCoverage, evidenceOnFrame, type VegetationEvidence } from './vegetationEvidence'

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
/** Point-cloud evidence is used only when it covers this share of the search corridor. */
export const ROAD_FIND_EVIDENCE_MIN_COVER = 0.8
/** Where the record crosses water, a structure is presumed within this distance of the crossing, m. */
export const ROAD_FIND_BRIDGE_M = 5
/**
 * A line whose ends are this close is a loop: its end caps would overlap and the search would
 * join them at once, so it is searched as two halves, each with its own caps, m.
 */
export const ROAD_FIND_LOOP_M = 2
/** The record is checked for water crossings every this many metres. */
const WATER_STEP_M = 0.5

export type RoadFindStatus = 'found' | 'partial' | 'not-found' | 'incomplete-terrain' | 'too-coarse' | 'refused'
/** What the search scored the ground with. */
export type RoadFindMode = 'terrain' | 'terrain+vegetation'

/** A stretch of the original line, by its own chainage. */
export interface RoadFindRange {
  from: number
  to: number
  kind: 'found' | 'not-found' | 'no-terrain' | 'presumed-structure'
}

/** A stretch of the original line graded with one state class. */
export interface RoadStateRange {
  from: number
  to: number
  stateClass: RoadStateClass
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
  /** Point-cloud evidence on the same projected metres; used when it covers the corridor. */
  evidence?: VegetationEvidence | null
  /** Water polygons (rings of projected points, outer first): impassable but for presumed structures. */
  water?: XY[][][]
  /**
   * The parameter set. Its corridor and pull apply unless `corridorHalfWidthM` or `confidence` are
   * given; the rest set the sections and the state thresholds.
   */
  settings?: Partial<RoadFindSettings>
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
  /** What the ground was scored with, and in words why (and with which point-cloud terms). */
  mode: RoadFindMode
  modeNote: string
  /** Share of the corridor the point-cloud evidence covers; null without evidence. */
  evidenceCoverage: number | null
  /** Length-weighted harmonic mean of the search's score along the whole path (no pull); null without a path. */
  conductivity: number | null
  /** Found path length over its end-to-end distance. */
  sinuosity: number | null
  /** The larger gap between the record's ends and the candidate's, m; null without a candidate. */
  endShiftM: number | null
  /** The road's state over its found stretches; null in terrain-only mode or with nothing found. */
  state: RoadState | null
  /** Why there is no state, or what it describes. */
  stateNote: string
  /** Found stretches of the original line by state class, with a point cloud. */
  stateRanges: RoadStateRange[]
  /** Water polygons applied, and where the record crosses them (presumed structures). */
  water: { polygons: number; crossings: number }
  /** The parameter set the search ran with. */
  settings: RoadFindSettings
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
  /** The search score (no pull) every cell along each slice's stretch of path. */
  sliceScores: number[][]
  /** Slices where the record crosses water: a presumed structure. */
  slicePresumed: boolean[]
  likeness: number[]
  /** The search score (no pull) every cell along the path. */
  scores: number[]
  inside: number
  known: number
  explored: number
  /** Chainages along the piece's own line with no ground under it. */
  missing: number[]
  crossings: number
  waterCells: number
  /** The path was followed on terrain road-likeness because the full conductivity found too little bench. */
  terrainPath: boolean
}

interface PieceOptions {
  halfWidthM: number
  confidence: number
  likeness: Partial<RoadLikenessOptions>
  evidence: VegetationEvidence | null
  water: XY[][][]
  slices: Partial<RoadSliceOptions>
}

/**
 * Cells of `frame` inside any polygon, by even-odd scanlines through each row's cell centres
 * (holes are rings like any other, so they come out).
 */
export function rasterizePolygons(frame: GridFrame, polygons: readonly XY[][][]): Uint8Array {
  const { origin, cellM, width, height } = frame
  const mask = new Uint8Array(width * height)
  const edges: [XY, XY][] = []
  for (const polygon of polygons)
    for (const ring of polygon)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length]
        if (a[1] !== b[1]) edges.push([a, b])
      }
  if (!edges.length) return mask
  for (let r = 0; r < height; r++) {
    const y = origin[1] - r * cellM
    const xs: number[] = []
    for (const [a, b] of edges)
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))
        xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
    xs.sort((p, q) => p - q)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - origin[0]) / cellM)),
        c1 = Math.min(width - 1, Math.floor((xs[k + 1] - origin[0]) / cellM))
      for (let c = c0; c <= c1; c++) mask[r * width + c] = 1
    }
  }
  return mask
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
  options: PieceOptions,
  piece: number,
  pieces: number,
  explored0: number,
): Generator<RoadFindProgress, PieceResult> {
  const { halfWidthM, confidence } = options
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
  const likenessSteps = roadLikenessSteps(dtm, options.likeness)
  let l = likenessSteps.next()
  while (!l.done) {
    yield { phase: 'likeness', piece, pieces, explored: explored0 }
    l = likenessSteps.next()
  }
  // The terrain road-likeness decides found or not; with a point cloud, the full conductivity
  // steers the search and grades the road.
  const like = l.value
  let score = like
  if (options.evidence) {
    const population = new Uint8Array(n)
    for (let i = 0; i < n; i++) if (dist[i] <= halfWidthM) population[i] = 1
    const conductivitySteps = roadLikenessSteps(dtm, options.likeness, {
      layers: evidenceOnFrame(options.evidence, frame),
      population,
    })
    let k = conductivitySteps.next()
    while (!k.done) {
      yield { phase: 'likeness', piece, pieces, explored: explored0 }
      k = conductivitySteps.next()
    }
    score = k.value
  }
  // Water: impassable, but for a presumed structure within ROAD_FIND_BRIDGE_M of each place the
  // record crosses it.
  const water = options.water.length ? rasterizePolygons(frame, options.water) : null
  const bridge = new Uint8Array(n)
  let crossings = 0,
    waterCells = 0
  if (water) {
    for (let i = 0; i < n; i++) if (water[i] && dist[i] <= halfWidthM) waterCells++
    let wasIn = false
    const span = Math.ceil(ROAD_FIND_BRIDGE_M / cellM)
    for (let c = 0; c <= (lineCum.at(-1) ?? 0); c += WATER_STEP_M) {
      const { at } = pointAlong(line, lineCum, c)
      const col = Math.round((at[0] - frame.origin[0]) / cellM),
        row = Math.round((frame.origin[1] - at[1]) / cellM)
      const isIn = col >= 0 && row >= 0 && col < frame.width && row < frame.height && !!water[row * frame.width + col]
      if (isIn && !wasIn) crossings++
      wasIn = isIn
      if (!isIn) continue
      for (let dr = -span; dr <= span; dr++)
        for (let dc = -span; dc <= span; dc++) {
          const rr = row + dr,
            cc = col + dc
          if (rr < 0 || cc < 0 || rr >= frame.height || cc >= frame.width) continue
          if (Math.hypot(dr, dc) * cellM <= ROAD_FIND_BRIDGE_M) bridge[rr * frame.width + cc] = 1
        }
    }
  }
  // Follows the cheapest path over `grid` and measures the sections along it.
  function* follow(grid: SurfaceGrid, explored1: number): Generator<RoadFindProgress, PieceResult> {
    const conductance = new Float32Array(n)
    let inside = 0,
      known = 0
    for (let i = 0; i < n; i++) {
      if (dist[i] > halfWidthM) continue
      inside++
      if (bridge[i]) {
        conductance[i] = 1
        if (!Number.isNaN(grid.values[i])) known++
        continue
      }
      const v = grid.values[i]
      if (Number.isNaN(v)) continue
      known++
      if (water?.[i]) continue
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
      yield { phase: 'search', piece, pieces, explored: explored1 + found.value.explored }
      found = search.next()
    }
    const { path: cells, explored } = found.value
    const base = { inside, known, explored, missing, crossings, waterCells, terrainPath: false }
    if (!cells)
      return {
        ...base,
        path: null,
        slices: [],
        sliceLikeness: [],
        sliceScores: [],
        slicePresumed: [],
        likeness: [],
        scores: [],
      }
    let first = 0,
      last = cells.length - 1
    for (let k = 0; k < cells.length; k++) if (startCap[cells[k]]) first = k
    for (let k = cells.length - 1; k >= first; k--) if (endCap[cells[k]]) last = k
    const raw = cells.slice(first, last + 1).map((i) => {
      const r = Math.floor(i / frame.width)
      return [frame.origin[0] + (i - r * frame.width) * cellM, frame.origin[1] - r * cellM] as XY
    })
    const path = raw.length >= 2 ? smoothLine(raw, ROAD_FIND_SMOOTH_VERTICES) : raw
    yield { phase: 'slices', piece, pieces, explored: explored1 + explored }
    const likeAt = (p: XY) => sampleNearest(like, p)
    const scoreAt = (p: XY) => sampleNearest(score, p)
    const along = path.length >= 2 ? resampleLine(path, cellM) : path
    const likeness = along.map(likeAt).filter((v) => !Number.isNaN(v))
    const scores = along.map(scoreAt).filter((v) => !Number.isNaN(v))
    const slices = path.length >= 2 ? measureRoadSlices(dtm, path, options.slices, options.evidence).slices : []
    const pathCum = cumulativeLength(path)
    const sliceLikeness: number[] = [],
      sliceScores: number[][] = [],
      slicePresumed: boolean[] = []
    const flagged = (p: XY) => {
      const col = Math.round((p[0] - frame.origin[0]) / cellM),
        row = Math.round((frame.origin[1] - p[1]) / cellM)
      if (col < 0 || row < 0 || col >= frame.width || row >= frame.height) return false
      const i = row * frame.width + col
      return !!bridge[i] || !!water?.[i]
    }
    for (const slice of slices) {
      const values: number[] = [],
        own: number[] = []
      let presumed = false
      for (let d = -ROAD_SLICE_SPACING_M / 2; d <= ROAD_SLICE_SPACING_M / 2; d += cellM) {
        const p = pointAlong(path, pathCum, slice.chainage + d).at
        const v = likeAt(p),
          k = scoreAt(p)
        if (!Number.isNaN(v)) values.push(v)
        if (!Number.isNaN(k)) own.push(k)
        if (water && flagged(p)) presumed = true
      }
      sliceLikeness.push(values.length ? values.reduce((x, y) => x + y, 0) / values.length : NaN)
      sliceScores.push(own)
      slicePresumed.push(presumed)
    }
    return { ...base, path, slices, sliceLikeness, sliceScores, slicePresumed, likeness, scores }
  }
  // The point-cloud gates close a brushed-in bed as firmly as a forest floor, so where the full
  // conductivity's path finds too little bench the road is followed on terrain alone and then graded.
  const first = yield* follow(score, explored0)
  if (!options.evidence || !first.path || benchShare(first) >= ROAD_FIND_FOUND_SHARE) return first
  const second = yield* follow(like, explored0 + first.explored)
  return second.path && benchShare(second) > benchShare(first)
    ? { ...second, explored: first.explored + second.explored, terrainPath: true }
    : { ...first, explored: first.explored + second.explored }
}

/** Share of a piece's complete sections that are a bench with terrain road-likeness of at least 0.5. */
function benchShare(result: PieceResult): number {
  const complete = result.slices.filter((s) => s.complete)
  if (!complete.length) return 0
  return (
    result.slices.filter((s, i) => s.complete && s.bench && result.sliceLikeness[i] >= ROAD_FIND_MIN_LIKENESS).length /
    complete.length
  )
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
  const foundLine = extra.foundLine ?? null
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
    mode: 'terrain',
    modeNote: 'Terrain only.',
    evidenceCoverage: null,
    conductivity: null,
    sinuosity: foundLine ? sinuosity(foundLine) : null,
    endShiftM: null,
    state: null,
    stateNote: 'No road was found to grade.',
    stateRanges: [],
    water: { polygons: 0, crossings: 0 },
    settings: DEFAULT_ROAD_FIND_SETTINGS,
    ...extra,
  }
}

/** Which form of the score a search will use, and why, before it runs. */
export function roadFindMode(
  line: readonly XY[],
  evidence: VegetationEvidence | null | undefined,
  halfWidthM: number,
): { mode: RoadFindMode; coverage: number | null; note: string } {
  if (!evidence)
    return {
      mode: 'terrain',
      coverage: null,
      note: 'Terrain only: no point-cloud vegetation evidence is loaded for this terrain.',
    }
  // Sample the corridor every 2 m along and across the line.
  const samples: XY[] = []
  const cum = cumulativeLength(line)
  const total = cum.at(-1) ?? 0
  for (let s = 0; s <= total; s += 2) {
    const { at, dir } = pointAlong(line, cum, s)
    for (let o = -halfWidthM; o <= halfWidthM; o += 2) samples.push([at[0] + dir[1] * o, at[1] - dir[0] * o])
  }
  const coverage = evidenceCoverage(evidence, samples)
  if (coverage < ROAD_FIND_EVIDENCE_MIN_COVER)
    return {
      mode: 'terrain',
      coverage,
      note: `Terrain only: the point cloud covers ${Math.round(coverage * 100)}% of the search corridor, below the ${Math.round(ROAD_FIND_EVIDENCE_MIN_COVER * 100)}% needed to use it.`,
    }
  const info = evidence.info
  const terms = [
    'canopy',
    'low vegetation',
    'ground density',
    ...(info.intensity === 'none' ? [] : ['intensity']),
  ].join(', ')
  return {
    mode: 'terrain+vegetation',
    coverage,
    note:
      `Terrain + vegetation (${terms}) from ${info.pointsPerM2.toFixed(1)} returns per m²` +
      (info.intensity === 'none' ? '; the cloud has no intensity' : '') +
      (info.lowDensity ? '; below 5 per m², so the vegetation figures are unreliable' : '') +
      '.',
  }
}

/** Finds the line's road on the terrain, in slices. See the module comment. */
export function* findRoadOnTerrainSteps(input: RoadFindInput): Generator<RoadFindProgress, RoadFindResult> {
  const line = input.line.filter(
    (p, i) => i === 0 || Math.hypot(p[0] - input.line[i - 1][0], p[1] - input.line[i - 1][1]) > 1e-6,
  )
  const settings: RoadFindSettings = {
    ...DEFAULT_ROAD_FIND_SETTINGS,
    ...input.settings,
    state: { ...DEFAULT_ROAD_FIND_SETTINGS.state, ...input.settings?.state },
  }
  const halfWidthM = Math.min(
    MAX_ROAD_FIND_CORRIDOR_M,
    Math.max(MIN_ROAD_FIND_CORRIDOR_M, input.corridorHalfWidthM ?? input.settings?.corridorM ?? ROAD_FIND_CORRIDOR_M),
  )
  const confidence = Math.min(1, Math.max(0, input.confidence ?? input.settings?.confidence ?? ROAD_FIND_CONFIDENCE))
  settings.corridorM = halfWidthM
  settings.confidence = confidence
  const lengthM = cumulativeLength(line).at(-1) ?? 0
  const coarse = roadFindingTerrainProblem(input.terrainCellM)
  if (coarse) return unchanged({ line }, 'too-coarse', coarse, { corridorHalfWidthM: halfWidthM, settings })
  if (line.length < 2 || lengthM < ROAD_FIND_MIN_LENGTH_M)
    return unchanged(
      { line },
      'refused',
      `The line is shorter than ${ROAD_FIND_MIN_LENGTH_M} m; there is no road to follow.`,
      { settings },
    )
  if (lengthM > ROAD_FIND_MAX_LENGTH_M)
    return unchanged(
      { line },
      'refused',
      `The line is ${(lengthM / 1000).toFixed(1)} km; road finding takes at most ${ROAD_FIND_MAX_LENGTH_M / 1000} km at a time. Split the road first.`,
      { settings },
    )
  if (confidence >= 1)
    return unchanged({ line }, 'refused', 'Confidence 1 keeps the line as it is; nothing was searched.', { settings })
  const modeChoice = roadFindMode(line, input.evidence, halfWidthM)
  const pieceOptions: PieceOptions = {
    halfWidthM,
    confidence,
    likeness: input.likeness ?? {},
    evidence: modeChoice.mode === 'terrain+vegetation' ? input.evidence! : null,
    water: input.water ?? [],
    slices: {
      flatToleranceM: settings.flatToleranceM,
      maxGroundSdM: settings.maxGroundSdM,
      maxBrushShare: settings.maxBrushShare,
    },
  }
  const cellM = isSurfaceGrid(input.ground) ? input.ground.cellM : input.ground.cellM || ROAD_FIND_SAMPLE_CELL_M
  const reach = halfWidthM + ROAD_SLICE_HALF_WIDTH_M + (ROAD_LIKENESS_REACH_CELLS + 1) * cellM
  const pieceM = Math.max(
    100,
    Math.min(ROAD_FIND_CHUNK_M, Math.sqrt(ROAD_FIND_MAX_CELLS) * cellM - 2 * reach - 2 * cellM),
  )
  const loop = Math.hypot(line[0][0] - line.at(-1)![0], line[0][1] - line.at(-1)![1]) <= ROAD_FIND_LOOP_M
  const pieces = Math.max(loop ? 2 : 1, Math.ceil(lengthM / pieceM))
  const cum = cumulativeLength(line)
  const results: PieceResult[] = []
  let explored = 0
  for (let k = 0; k < pieces; k++) {
    const from = (lengthM * k) / pieces,
      to = (lengthM * (k + 1)) / pieces
    const piece = searchPieceSteps(subLine(line, cum, from, to), input.ground, pieceOptions, k + 1, pieces, explored)
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
  const terrainPieces = results.filter((r) => r.terrainPath).length
  const waterSummary = {
    polygons: input.water?.length ?? 0,
    crossings: results.reduce((s, r) => s + r.crossings, 0),
  }
  const common = {
    corridorCoverage,
    explored,
    corridorHalfWidthM: halfWidthM,
    lengthM,
    mode: modeChoice.mode,
    modeNote:
      modeChoice.note +
      (terrainPieces
        ? ` The vegetation closed the bed along ${terrainPieces === pieces ? (pieces === 1 ? 'the road' : 'every piece') : `${terrainPieces} of ${pieces} pieces`}, so there the road was followed on the terrain alone and then graded.`
        : ''),
    evidenceCoverage: modeChoice.coverage,
    water: waterSummary,
    settings,
  }
  if (results.some((r) => !r.path)) {
    if (results.some((r) => r.waterCells > 0) && !missing.length)
      return unchanged(
        { line },
        'not-found',
        `No path could be followed: water crosses the ${halfWidthM} m search corridor away from where the record crosses it. Water is never crossed except within ${ROAD_FIND_BRIDGE_M} m of the record's own crossing.`,
        common,
      )
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
  const sliceScores: number[][] = []
  const slicePresumed: boolean[] = []
  for (const r of results) {
    const offset = path.length ? (cumulativeLength(path).at(-1) ?? 0) : 0
    const start = path.length ? Math.hypot(r.path![0][0] - path.at(-1)![0], r.path![0][1] - path.at(-1)![1]) : 0
    for (const p of r.path!) path.push(p)
    for (const s of r.slices) slices.push({ ...s, chainage: s.chainage + offset + start })
    sliceLikeness.push(...r.sliceLikeness)
    sliceScores.push(...r.sliceScores)
    slicePresumed.push(...r.slicePresumed)
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
    slicePresumed[i]
      ? 'presumed-structure'
      : !s.complete
        ? 'no-terrain'
        : s.bench && sliceLikeness[i] >= ROAD_FIND_MIN_LIKENESS
          ? 'found'
          : 'not-found',
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
    if (run.kind === 'found' || run.kind === 'presumed-structure' || run.last - run.first + 1 >= minSlices) continue
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
  const scores = results.flatMap((r) => r.scores)
  const conductivity = harmonicConductivity(scores.map((value) => ({ lengthM: 1, value })))
  const pathFigures = { conductivity, sinuosity: sinuosity(path) }
  if (foundShare < ROAD_FIND_PARTIAL_SHARE)
    return unchanged(
      { line },
      'not-found',
      `No road bench was found within ${halfWidthM} m of this line (${evidence}). The line is kept as it is.`,
      { ...common, ...pathFigures, foundLine: path, likenessAlong, slices: summary },
    )
  // State: over the complete sections of the found stretches, with a point cloud only.
  const graded = slices
    .map((slice, i) => ({ slice, i }))
    .filter(({ slice, i }) => kinds[i] === 'found' && slice.complete && slice.drivableWidthM !== undefined)
  let state: RoadState | null = null
  let stateNote: string
  const stateRanges: RoadStateRange[] = []
  if (modeChoice.mode !== 'terrain+vegetation')
    stateNote =
      'Not graded: the state needs point-cloud vegetation evidence (drivable width and vegetation over the bed).'
  else if (!graded.length) stateNote = 'Not graded: no found section had a vegetation profile.'
  else {
    const found = summarizeSlices(graded.map(({ slice }) => slice))
    const foundConductivity = harmonicConductivity(
      graded.flatMap(({ i }) => sliceScores[i].map((value) => ({ lengthM: 1, value }))),
    )
    const round1 = (v: number) => Math.round(v * 10) / 10
    state = roadState(
      {
        vegetationPercent: round1(found.vegetationPercent ?? 0),
        drivableWidthM: round1(found.drivableWidthM?.mean ?? 0),
        conductivity: foundConductivity ?? 0,
        shoulderPercent: round1(found.shoulderPercent),
      },
      settings.state,
    )
    stateNote = `Over the ${graded.length} found section${graded.length === 1 ? '' : 's'} with a vegetation profile; describes the bed on the LiDAR acquisition date, not the road's condition.`
    for (const { slice, i } of graded) {
      const own = roadState(
        {
          vegetationPercent: slice.vegetationPercent ?? 0,
          drivableWidthM: slice.drivableWidthM ?? 0,
          conductivity: harmonicConductivity(sliceScores[i].map((value) => ({ lengthM: 1, value }))) ?? 0,
          shoulderPercent: slice.shoulders * 50,
        },
        settings.state,
      ).stateClass
      const from = onOriginal(Math.max(0, slice.chainage - half)),
        to = onOriginal(Math.min(pathLength, slice.chainage + half))
      const last = stateRanges.at(-1)
      if (last && last.stateClass === own && from - last.to <= ROAD_SLICE_SPACING_M) last.to = Math.max(last.to, to)
      else stateRanges.push({ from: Math.min(from, to), to: Math.max(from, to), stateClass: own })
    }
  }
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
  const endShiftM = lineDifference(line, candidate)?.endMaxM ?? null
  const kept = ranges.filter((r) => r.kind !== 'found' && r.kind !== 'presumed-structure')
  const status: RoadFindStatus = foundShare >= ROAD_FIND_FOUND_SHARE ? 'found' : 'partial'
  const reason =
    `Found a road bench along ${Math.round(foundShare * 100)}% of the line` +
    (shiftM ? `, a median ${shiftM.p50.toFixed(1)} m from it (P90 ${shiftM.p90.toFixed(1)} m)` : '') +
    `. ` +
    (kept.length
      ? `${kept.length} stretch${kept.length === 1 ? '' : 'es'} with no bench ${kept.length === 1 ? 'is' : 'are'} kept as the original line.`
      : 'Every stretch had a bench.') +
    (waterSummary.crossings
      ? ` ${waterSummary.crossings} water crossing${waterSummary.crossings === 1 ? ' is a presumed structure' : 's are presumed structures'}, kept as the record.`
      : '')
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
    ...pathFigures,
    endShiftM,
    state,
    stateNote,
    stateRanges,
  }
}

/** Runs the search to the end in one go. */
export function findRoadOnTerrain(input: RoadFindInput): RoadFindResult {
  const steps = findRoadOnTerrainSteps(input)
  let next = steps.next()
  while (!next.done) next = steps.next()
  return next.value
}
