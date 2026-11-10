/**
 * Route search with switchbacks: a best-first (A*) search over straight graded pieces between the
 * cells of a grid, where a sharp change of heading is a switchback that has to pass a platform,
 * spacing and sharpest-turn test, and is then drawn as a loop of curves round the outside of the
 * turn (`hairpinLoop.ts`). It is the search PGMaps uses where a road has to turn back on itself to
 * climb a face: the corridor search, which follows the ground metre by metre, cannot.
 *
 * Each piece joins two cells up to the neighbourhood radius apart (long-chord neighbourhoods,
 * Anderson and Nelson 2004, Can. J. For. Res. 34(7): 1444–1457, DOI 10.1139/x04-030) and has to:
 * keep its grade, end to end on the 12 m ground trend, between the minimum and the grade limit
 * (directional limits included); hold that grade with no more than the straight-grade cut or fill;
 * stay on the terrain, in the corridor and out of blocked areas; keep within the side-hill budget;
 * leave room for the curve at each end; and not cross the route already drawn. The search is A*
 * (Hart, Nilsson and Raphael 1968, IEEE Trans. SSC 4(2): 100–107, DOI 10.1109/TSSC.1968.300136)
 * with an estimate that counts both the distance and the climb left at the grade limit, so a steep
 * end is known to be far away.
 *
 * The rules and defaults follow SylvaRoaD 2.2 (S. Dupire, SylvaLab / ONF, 2021) as stated in a
 * functional specification of its options; its hairpin rules are its own empirical figures and no
 * SylvaRoaD publication was found. Departures from it: labels are kept per cell and heading rather
 * than per cell, grades come from the ground trend, missing terrain is never passable, every curve
 * is fitted at the road's minimum radius, and each switchback's drawn turn is checked for grade,
 * ground and (optionally) cut or fill during the search. Written from a functional specification;
 * no code from SylvaRoaD or its QGIS port (GPL-3.0) was used.
 *
 * Pure: takes terrain and constraints as arguments and touches neither the DOM nor the network.
 */
import { runCooperatively, runToCompletion, type CooperativeControl } from './cooperative'
import {
  corridorFrame,
  MAX_SEARCH_RADIUS_M,
  MIN_SEARCH_RADIUS_M,
  type CorridorMetrics,
  type CorridorProgress,
  type RoadOptimizationObjective,
  type RoadOptimizationResult,
} from './corridorOptimizer'
import { centrelineSamples, horizontalCurveSummary } from './engine'
import { groundTrendTerrain, MAX_GROUND_WINDOW_M } from './groundTrend'
import { hairpinLoop, sampleLoop, wrapAngle, type HairpinLoop, type XY } from './hairpinLoop'
import { blockedRouteEndMessage, routingContext } from './riparian'
import { directionalGradeLimit, type HaulGradeLimits } from './routing'
import {
  chordTolerance,
  CHORD_REFERENCE_M,
  PLATFORM_COST_M,
  PLATFORM_RADIUS_FACTOR,
  sharpestSwitchbackDegrees,
  switchbackRadius,
  type SwitchbackRouteOptions,
} from './switchbackOptions'
import type { Alignment, ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

export interface SwitchbackSearchOptions {
  objective: RoadOptimizationObjective
  corridorHalfWidthM: number
  rules: SwitchbackRouteOptions
  /** Read grades on this moving window of the ground; see `groundTrend.ts`. */
  groundWindowM?: number
  /** Centreline clearance to supplied exclusions. */
  avoidanceClearanceM?: number
  /** Ground steeper than this counts against the side-hill budget; null sets no side-hill limit. */
  sideHillSlopePercent?: number | null
  haulGrades?: HaulGradeLimits | null
  /** Degrees clockwise from north; the first and last pieces stay within ±45°. */
  startHeading?: number | null
  endHeading?: number | null
  /** Metres of road a mapped stream contact is worth. Default 150, as in the corridor search. */
  streamContactCostM?: number
  /** Converts CAD/m zone costs to metres of road; default 100 CAD/m. */
  constraintCostBasePerM?: number
  /** Extra metres of road per metre travelled here. Never negative. */
  groundPenalty?: (coordinate: Coordinate) => number
  /** Metres of road a turn as sharp as the switchback angle is worth; defaults by objective. */
  turnPenaltyM?: number
  /** Grid cell; by default the larger of 5 m and the search area's longer side ÷ 240. */
  cellM?: number
  /** Longest straight piece; by default the larger of 42 m and eight cells. */
  neighbourhoodM?: number
  /** Positions taken from the queue before the search gives up. Default 300,000. */
  maxExpansions?: number
}

/** What stops a trial piece or switchback. One trial is stopped once, by the first rule it fails. */
export type SwitchbackStop =
  | 'grade'
  | 'minGrade'
  | 'terrain'
  | 'exclusion'
  | 'corridor'
  | 'chord'
  | 'sideHill'
  | 'crossing'
  | 'curveFit'
  | 'heading'
  | 'hairpinOff'
  | 'sharp'
  | 'platform'
  | 'spacing'
  | 'turnRoom'
  | 'turnGrade'
  | 'turnGround'
  | 'turnCutFill'
const STOPS: SwitchbackStop[] = [
  'grade',
  'minGrade',
  'terrain',
  'exclusion',
  'corridor',
  'chord',
  'sideHill',
  'crossing',
  'curveFit',
  'heading',
  'hairpinOff',
  'sharp',
  'platform',
  'spacing',
  'turnRoom',
  'turnGrade',
  'turnGround',
  'turnCutFill',
]
/** The switchback rules, in the order a try meets them. */
const HAIRPIN_ORDER: SwitchbackStop[] = [
  'sharp',
  'platform',
  'spacing',
  'turnRoom',
  'turnGrade',
  'turnGround',
  'turnCutFill',
]
const HAIRPIN_STOPS = new Set<SwitchbackStop>(HAIRPIN_ORDER)

export interface SwitchbackPlace {
  at: Coordinate
  xy: XY
  /** Straight-line distance from the trial's starting point to the end. */
  remainingM: number
  /** The measured value the rule refused: a steep share, a turn in degrees, metres of cut or fill. */
  value?: number
}
export interface SwitchbackFailure {
  reason: 'budget' | 'no-candidate'
  directM: number
  riseM: number
  closestRemainingM: number
  closest: Coordinate
  /** The labelled line that got nearest the end, from the start to `closest`, for drawing. */
  reached?: Coordinate[]
  /** Trials stopped by each rule. */
  stopped: Record<SwitchbackStop, number>
  /** Trials stopped by each rule from the positions nearest the end, within one neighbourhood of the closest. */
  frontier: Record<SwitchbackStop, number>
  /** For each rule, the refused trial nearest the end. */
  places: Partial<Record<SwitchbackStop, SwitchbackPlace>>
  /** Switchbacks that passed every rule at least once during the search. */
  hairpinsAccepted: number
  /** The end in the search's plane frame, metres from the start. */
  end: XY
}
export class SwitchbackSearchError extends Error {
  readonly failure: SwitchbackFailure
  constructor(message: string, failure: SwitchbackFailure) {
    super(message)
    this.name = 'SwitchbackSearchError'
    this.failure = failure
  }
}

export interface FoundSwitchback {
  coordinate: Coordinate
  /** Change of heading at the vertex, degrees. */
  turnDegrees: number
  platformSteepShare: number
  /** Grade along the drawn turn, signed in the direction of travel. */
  turnGradePercent: number
  /** Largest centreline cut or fill on the drawn turn, on the ground trend. */
  turnCutFillM: number
  /** Length the drawn turn adds to the straight legs it replaces. */
  addedLengthM: number
}
export interface SwitchbackRouteResult extends RoadOptimizationResult {
  switchbacks: FoundSwitchback[]
  radiusM: number
  /** Length of the straight pieces before the turns were drawn as curves. */
  pieceLengthM: number
  /** Length of road on ground steeper than the side-hill limit. */
  sideHillM: number
  /** Length of pieces under the minimum grade, when it only charges. */
  underMinimumGradeM: number
  pieces: { from: Coordinate; to: Coordinate; lengthM: number; gradePercent: number }[]
}

export const SWITCHBACK_SEARCH_BUDGET = { maxExpansions: 300_000, maxLabels: 3_000_000, maxCells: 60_000 }
/** Finest grid; a finer one only adds work on the 12 m ground trend. */
const MIN_CELL_M = 5
const MAX_CELLS_PER_SIDE = 240
const NEIGHBOURHOOD_CELLS = 8
const MAX_NEIGHBOURHOOD_M = 250
const BINS = 16
/** Straight kept between two curves, and between a curve and the road's end. */
const CURVE_GAP_M = 0.5
/** Turns smaller than this, degrees, get no curve: the pieces either side are one straight. */
const STRAIGHT_TURN_DEG = 0.005
const FINE_STEP_M = 1
/** Refusals are tallied by the trying position's distance to the end, in bands this wide. */
const BAND_M = 10
const FINE_ATTEMPTS = 4
const MAX_SPACING_CHECKS = 200
const EPS = 1e-9
const DEG = Math.PI / 180
const PROFILES: Record<
  RoadOptimizationObjective,
  { grade: number; vertical: number; turnM: number; gradeChangeM: number }
> = {
  shortest: { grade: 0.05, vertical: 0.5, turnM: 50, gradeChangeM: 0 },
  balanced: { grade: 1.5, vertical: 12, turnM: 150, gradeChangeM: 80 },
  contour: { grade: 4, vertical: 45, turnM: 150, gradeChangeM: 160 },
}

type Segment = { a: XY; b: XY; stream: string | null }
const pointSegment = (p: XY, a: XY, b: XY) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    size = dx * dx + dy * dy
  const t = size ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / size)) : 0
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
const orient = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
/** True when the closed segments ab and cd share a point. */
export function segmentsMeet(a: XY, b: XY, c: XY, d: XY) {
  const x = orient(a, b, c),
    y = orient(a, b, d),
    u = orient(c, d, a),
    v = orient(c, d, b)
  if (((x > EPS && y < -EPS) || (x < -EPS && y > EPS)) && ((u > EPS && v < -EPS) || (u < -EPS && v > EPS))) return true
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b)) < 1e-7
}
const segmentGap = (a: XY, b: XY, c: XY, d: XY) =>
  segmentsMeet(a, b, c, d)
    ? 0
    : Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b))
function inRing(p: XY, ring: XY[]) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j],
      b = ring[i]
    if (pointSegment(p, a, b) <= 1e-7) return true
    if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside
  }
  return inside
}
const azimuth = (angle: number) => (((90 - angle / DEG) % 360) + 360) % 360
const COMPASS = [
  'north',
  'north-north-east',
  'north-east',
  'east-north-east',
  'east',
  'east-south-east',
  'south-east',
  'south-south-east',
  'south',
  'south-south-west',
  'south-west',
  'west-south-west',
  'west',
  'west-north-west',
  'north-west',
  'north-north-west',
]
const whole = (n: number) => Math.round(n).toLocaleString('en-CA')

/** "290 m west-north-west of the road's start": a place in the search's frame, from the nearer end. */
export function switchbackPlaceText(xy: XY, end: XY) {
  const toStart = Math.hypot(...xy),
    toEnd = Math.hypot(xy[0] - end[0], xy[1] - end[1])
  const [name, d, v] = toStart <= toEnd ? ['start', toStart, xy] : ['end', toEnd, [xy[0] - end[0], xy[1] - end[1]]]
  if (d < 15) return `at the road's ${name}`
  const rounded = d < 100 ? Math.round(d / 5) * 5 : Math.round(d / 10) * 10
  return `${whole(rounded)} m ${COMPASS[Math.round(azimuth(Math.atan2(v[1], v[0])) / 22.5) % 16]} of the road's ${name}`
}

/** Growable struct-of-arrays store for search labels. */
class Labels {
  size = 0
  cell = new Int32Array(1024)
  leg = new Int32Array(1024)
  parent = new Int32Array(1024)
  hairpin = new Int32Array(1024)
  contacts = new Int32Array(1024)
  flags = new Uint8Array(1024)
  num = Array.from({ length: 16 }, () => new Float64Array(1024))
  grow() {
    const next = this.cell.length * 2
    const resizeInt = (a: Int32Array) => {
      const b = new Int32Array(next)
      b.set(a)
      return b
    }
    this.cell = resizeInt(this.cell)
    this.leg = resizeInt(this.leg)
    this.parent = resizeInt(this.parent)
    this.hairpin = resizeInt(this.hairpin)
    this.contacts = resizeInt(this.contacts)
    const flags = new Uint8Array(next)
    flags.set(this.flags)
    this.flags = flags
    // In place: the search holds this array.
    for (let i = 0; i < this.num.length; i++) {
      const b = new Float64Array(next)
      b.set(this.num[i])
      this.num[i] = b
    }
  }
}
// Indices into `Labels.num`.
const X = 0,
  Y = 1,
  Z = 2,
  COST = 3,
  F = 4,
  H = 5,
  HEAD = 6,
  GRADE = 7,
  LEN = 8,
  TAN = 9,
  SIDE = 10,
  TURNING = 11,
  BX0 = 12,
  BY0 = 13,
  BX1 = 14,
  BY1 = 15
const GOAL = 1,
  HAIRPIN_AT_START = 2

function* search(
  guide: Coordinate[],
  sourceTerrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[],
  options: SwitchbackSearchOptions,
): Generator<CorridorProgress, SwitchbackRouteResult> {
  const rules = options.rules
  const groundWindowM = options.groundWindowM ?? 0
  if (!Number.isFinite(groundWindowM) || groundWindowM < 0 || groundWindowM > MAX_GROUND_WINDOW_M)
    throw Error(`Ground window must be 0–${MAX_GROUND_WINDOW_M} m.`)
  const terrain = groundTrendTerrain(sourceTerrain, groundWindowM)
  const valid = (p: unknown): p is Coordinate =>
    Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) < 85
  if (!Array.isArray(guide) || guide.length < 2 || guide.length > 100 || !guide.every(valid))
    throw Error('Sketch between 2 and 100 valid road points.')
  const width = options.corridorHalfWidthM,
    clearance = options.avoidanceClearanceM ?? 0
  if (!Number.isFinite(width) || width < 25 || width > 1000) throw Error('Corridor half-width must be 25–1,000 m.')
  if (!Number.isFinite(clearance) || clearance < 0 || clearance >= width)
    throw Error('Exclusion clearance must be non-negative and smaller than the corridor half-width.')
  const maxGrade = settings.maxGradePercent
  if (!Number.isFinite(maxGrade) || maxGrade < 1 || maxGrade > 30)
    throw Error('The switchback search takes a grade limit of 1–30%. Set the grade limit in that range to search.')
  if (!Number.isFinite(settings.minRadius) || settings.minRadius < 0 || settings.minRadius > MAX_SEARCH_RADIUS_M)
    throw Error(`The switchback search takes a minimum radius of up to ${whole(MAX_SEARCH_RADIUS_M)} m.`)
  const minGrade = rules.minGradePercent
  if (minGrade >= maxGrade) throw Error('The minimum grade must be below the grade limit.')
  const curveRadius = Math.max(settings.minRadius, MIN_SEARCH_RADIUS_M)
  const R = switchbackRadius(rules, settings.minRadius)
  const hairpinAngle = rules.hairpinAngleDeg
  const sharpest = sharpestSwitchbackDegrees(maxGrade, R)
  const spacing = rules.spacingFactor * R
  const sideHillLimit = options.sideHillSlopePercent ?? null
  const streamCost = options.streamContactCostM ?? 150
  if (!Number.isFinite(streamCost) || streamCost < 0) throw Error('Stream contact cost must not be negative.')
  const costBase = options.constraintCostBasePerM ?? 100
  if (!Number.isFinite(costBase) || costBase <= 0)
    throw Error('Constraint cost conversion needs a positive base cost per metre.')
  const weights = PROFILES[options.objective]
  if (!weights) throw Error('Choose a valid optimization preference.')
  const turnPenalty = options.turnPenaltyM ?? weights.turnM
  const gradeChangePenalty = rules.gradeChangePenaltyM ?? weights.gradeChangeM
  const maxExpansions = options.maxExpansions ?? SWITCHBACK_SEARCH_BUDGET.maxExpansions
  if (!Number.isInteger(maxExpansions) || maxExpansions < 1 || maxExpansions > 2_000_000)
    throw Error('Invalid search budget.')

  const frame = corridorFrame(guide[0])
  const sketch = guide.map(frame.toXY),
    end = sketch[sketch.length - 1]
  const direct = Math.hypot(...end)
  if (direct < 10 || direct > 5000 || sketch.some((p) => Math.hypot(...p) > 7000))
    throw Error('Use distinct endpoints 10 m–5 km apart and keep the entire sketch within a 7 km planning area.')
  const box = [
    Math.min(...sketch.map((p) => p[0])) - width,
    Math.min(...sketch.map((p) => p[1])) - width,
    Math.max(...sketch.map((p) => p[0])) + width,
    Math.max(...sketch.map((p) => p[1])) + width,
  ]
  const cell =
    options.cellM ??
    Math.max(MIN_CELL_M, (box[2] - box[0]) / MAX_CELLS_PER_SIDE, (box[3] - box[1]) / MAX_CELLS_PER_SIDE)
  if (!Number.isFinite(cell) || cell < 1 || cell > 100) throw Error('Use a search cell of 1–100 m.')
  const reach =
    options.neighbourhoodM ?? Math.min(MAX_NEIGHBOURHOOD_M, Math.max(CHORD_REFERENCE_M, NEIGHBOURHOOD_CELLS * cell))
  if (!Number.isFinite(reach) || reach < cell * 1.5 || reach > 500)
    throw Error('Use a neighbourhood of at least 1.5 cells and at most 500 m.')
  const i0 = Math.floor(box[0] / cell),
    j0 = Math.floor(box[1] / cell)
  const columns = Math.ceil(box[2] / cell) - i0 + 1,
    rows = Math.ceil(box[3] / cell) - j0 + 1
  const cells = columns * rows
  if (cells > SWITCHBACK_SEARCH_BUDGET.maxCells)
    throw Error(
      `The switchback search covers at most ${whole(SWITCHBACK_SEARCH_BUDGET.maxCells)} cells; narrow the corridor or use larger cells.`,
    )
  const cx = (c: number) => (i0 + (c % columns)) * cell,
    cy = (c: number) => (j0 + Math.floor(c / columns)) * cell
  const cellAt = (x: number, y: number) => {
    const col = Math.round(x / cell) - i0,
      row = Math.round(y / cell) - j0
    return col < 0 || row < 0 || col >= columns || row >= rows ? -1 : row * columns + col
  }
  const startCell = cellAt(0, 0)

  let reads = 0
  const read = (p: XY) => {
    reads++
    return terrain.elevationAt(...frame.fromXY(p))
  }
  const progress = (explored: number, share: number): CorridorProgress => ({
    explored,
    terrainSamples: reads,
    budgetUsed: Math.min(1, share),
  })

  // Constraints, as in the corridor search: blocked polygons and lines, priced zones and streams.
  const segments: Segment[] = []
  const blockedPolygons: XY[][][] = []
  const zones: { rings: XY[][]; costPerM: number }[] = []
  let vertices = 0
  for (const feature of routingContext(context)) {
    if (feature.kind !== 'stream' && feature.kind !== 'avoid') continue
    const raw = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates : [feature.geometry.coordinates]
    const paths = raw.map((path) => path.map((p) => frame.toXY([p[0], p[1]])))
    vertices += paths.reduce((s, p) => s + p.length, 0)
    if (vertices > 20000) throw Error('Crop stream/exclusion inputs to 20,000 vertices or fewer.')
    if (feature.geometry.type === 'Polygon' && feature.kind === 'avoid') {
      if (feature.routeCostPerM !== undefined) {
        zones.push({ rings: paths, costPerM: feature.routeCostPerM / costBase })
        continue
      }
      blockedPolygons.push(paths)
    }
    if (feature.kind === 'avoid' && feature.routeCostPerM !== undefined) continue
    for (const path of paths)
      for (let i = 1; i < path.length; i++)
        segments.push({ a: path[i - 1], b: path[i], stream: feature.kind === 'stream' ? feature.id : null })
  }
  const insidePolygon = (p: XY, rings: XY[][]) => inRing(p, rings[0]) && !rings.slice(1).some((r) => inRing(p, r))
  const guideOffset = (p: XY) => {
    let min = Infinity
    for (let i = 1; i < sketch.length; i++) min = Math.min(min, pointSegment(p, sketch[i - 1], sketch[i]))
    return min
  }
  /** What keeps an exact point out: the corridor, an exclusion, or nothing. Corridor `slack` for points between cells. */
  const pointBlock = (p: XY, slack = 0): 'corridor' | 'exclusion' | null => {
    if (guideOffset(p) > width + slack) return 'corridor'
    if (blockedPolygons.some((rings) => insidePolygon(p, rings))) return 'exclusion'
    for (const s of segments) if (s.stream === null && pointSegment(p, s.a, s.b) <= clearance + 1e-7) return 'exclusion'
    return null
  }

  // Rasters on the cell grid.
  const z = new Float64Array(cells)
  /** 0 free, 1 missing terrain, 2 outside the corridor, 3 blocked. */
  const blocked = new Uint8Array(cells)
  const near = new Uint8Array(cells)
  const penalty = zones.length || options.groundPenalty ? new Float64Array(cells) : null
  for (let c = 0; c < cells; c++) {
    if (c % 512 === 0) yield progress(0, 0)
    const p: XY = [cx(c), cy(c)]
    // Ground outside the corridor is read too: a platform circle may reach it.
    z[c] = read(p)
    if (guideOffset(p) > width + 1e-9) {
      blocked[c] = 2
      continue
    }
    if (!Number.isFinite(z[c])) blocked[c] = 1
    else if (blockedPolygons.some((rings) => insidePolygon(p, rings))) blocked[c] = 3
    if (penalty) {
      let sum = 0
      for (const zone of zones) if (insidePolygon(p, zone.rings)) sum += zone.costPerM
      if (options.groundPenalty) sum += Math.max(0, options.groundPenalty(frame.fromXY(p)) || 0)
      penalty[c] = sum
    }
  }
  for (const s of segments) {
    const pad = clearance + cell
    const lo = [Math.min(s.a[0], s.b[0]) - pad, Math.min(s.a[1], s.b[1]) - pad],
      hi = [Math.max(s.a[0], s.b[0]) + pad, Math.max(s.a[1], s.b[1]) + pad]
    for (
      let col = Math.max(0, Math.floor(lo[0] / cell) - i0);
      col <= Math.min(columns - 1, Math.ceil(hi[0] / cell) - i0);
      col++
    )
      for (
        let row = Math.max(0, Math.floor(lo[1] / cell) - j0);
        row <= Math.min(rows - 1, Math.ceil(hi[1] / cell) - j0);
        row++
      ) {
        const c = row * columns + col
        const d = pointSegment([cx(c), cy(c)], s.a, s.b)
        if (d <= clearance + cell) near[c] = 1
        if (s.stream === null && d <= clearance + 1e-7 && blocked[c] === 0) blocked[c] = 3
      }
  }
  // Terrain slope from the trend grid, %; unknown where a whole axis is missing.
  const slope = new Float64Array(cells)
  for (let c = 0; c < cells; c++) {
    const col = c % columns,
      row = Math.floor(c / columns)
    const at = (dc: number, dr: number) => {
      const cc = col + dc,
        rr = row + dr
      return cc < 0 || rr < 0 || cc >= columns || rr >= rows ? NaN : z[rr * columns + cc]
    }
    const axis = (minus: number, plus: number) =>
      Number.isFinite(minus) && Number.isFinite(plus)
        ? (plus - minus) / (2 * cell)
        : Number.isFinite(plus)
          ? (plus - z[c]) / cell
          : Number.isFinite(minus)
            ? (z[c] - minus) / cell
            : NaN
    slope[c] = Number.isFinite(z[c]) ? Math.hypot(axis(at(-1, 0), at(1, 0)), axis(at(0, -1), at(0, 1))) * 100 : NaN
  }
  /** Bilinear trend elevation from the grid; NaN when any corner is missing. */
  const zAt = (x: number, y: number) => {
    const fx = x / cell - i0,
      fy = y / cell - j0
    const col = Math.floor(fx),
      row = Math.floor(fy)
    if (col < 0 || row < 0 || col + 1 >= columns || row + 1 >= rows) return NaN
    const tx = fx - col,
      ty = fy - row,
      k = row * columns + col
    return (
      z[k] * (1 - tx) * (1 - ty) +
      z[k + 1] * tx * (1 - ty) +
      z[k + columns] * (1 - tx) * ty +
      z[k + columns + 1] * tx * ty
    )
  }

  // Ends: on the terrain, inside the corridor and outside blocked areas.
  const startZ = z[startCell],
    endZ = read(end)
  if (!Number.isFinite(startZ) || !Number.isFinite(endZ))
    throw Error('Both road endpoints need valid terrain elevations.')
  const closed = (
    [
      ['start', [0, 0]],
      ['end', end],
    ] as [string, XY][]
  ).filter(([, p]) => pointBlock(p) !== null)
  if (closed.length) {
    const one = closed.length === 1
    throw Error(
      blockedRouteEndMessage(
        guide[0],
        guide[guide.length - 1],
        context,
        { excludedM: clearance },
        `The road's ${closed.map(([name]) => name).join(' and ')} ${one ? 'is' : 'are'} inside or too close to a blocked area. Move ${one ? 'that end' : 'the ends'}, or change the treatment of the area beside ${one ? 'it' : 'them'}.`,
      ),
    )
  }

  // Compulsory points: the guide's interior points, each to be passed within its tolerance.
  const waypoints: XY[] = rules.passPointsWithinM === null ? [] : sketch.slice(1, -1)
  const tolerance = Math.max(rules.passPointsWithinM ?? 0, cell * 0.75)
  const legs = waypoints.length
  /** Least metres of road from a point on leg `leg` to the end. */
  const lowerAfter: number[] = []
  const targets = [...waypoints, end]
  lowerAfter[legs] = 0
  for (let k = legs - 1; k >= 0; k--) {
    const a = targets[k],
      b = targets[k + 1]
    const run = Math.max(0, Math.hypot(b[0] - a[0], b[1] - a[1]) - tolerance * (k + 1 < legs ? 2 : 1))
    lowerAfter[k] = lowerAfter[k + 1] + run
  }
  const lowerBound = (x: number, y: number, zz: number, leg: number) => {
    if (leg < legs) {
      const w = waypoints[leg]
      return Math.max(0, Math.hypot(w[0] - x, w[1] - y) - tolerance) + lowerAfter[leg]
    }
    return Math.max(Math.hypot(end[0] - x, end[1] - y), (Math.abs(endZ - zz) * 100) / maxGrade)
  }

  // The neighbourhood: every cell offset within reach, with the cells its piece passes over.
  type Offset = {
    di: number
    dj: number
    delta: number
    length: number
    heading: number
    path: Int32Array
    along: Float64Array
  }
  const offsets: Offset[] = []
  const span = Math.floor(reach / cell)
  for (let di = -span; di <= span; di++)
    for (let dj = -span; dj <= span; dj++) {
      const length = Math.hypot(di, dj) * cell
      if (!length || length > reach + 1e-9) continue
      const steps = Math.max(1, Math.ceil(length / (cell / 2)))
      const path: number[] = [],
        along: number[] = []
      let last = 0
      for (let k = 1; k <= steps; k++) {
        const t = k / steps
        const oc = Math.round(di * t),
          or = Math.round(dj * t)
        const key = or * 100_000 + oc
        if ((oc === 0 && or === 0) || key === last) continue
        last = key
        path.push(oc, or)
        along.push(((oc * di + or * dj) / Math.hypot(di, dj)) * cell)
      }
      offsets.push({
        di,
        dj,
        delta: dj * columns + di,
        length,
        heading: Math.atan2(dj, di),
        path: Int32Array.from(path),
        along: Float64Array.from(along),
      })
    }

  // Platform shares, computed when a switchback is first tried at a cell.
  const platformRadius = PLATFORM_RADIUS_FACTOR * R
  const disc: [number, number][] = []
  const discSpan = Math.floor(platformRadius / cell)
  for (let di = -discSpan; di <= discSpan; di++)
    for (let dj = -discSpan; dj <= discSpan; dj++)
      if (Math.hypot(di, dj) * cell <= platformRadius + 1e-9) disc.push([di, dj])
  const shares = new Float32Array(cells).fill(-1)
  const platformShare = (c: number) => {
    if (shares[c] >= 0) return shares[c]
    const col = c % columns,
      row = Math.floor(c / columns)
    let steep = 0
    for (const [di, dj] of disc) {
      const cc = col + di,
        rr = row + dj
      const s = cc < 0 || rr < 0 || cc >= columns || rr >= rows ? NaN : slope[rr * columns + cc]
      // Unknown ground cannot carry a platform.
      if (!(s <= rules.platformSlopePercent)) steep++
    }
    return (shares[c] = steep / disc.length)
  }

  const stopped = Object.fromEntries(STOPS.map((stop) => [stop, 0])) as Record<SwitchbackStop, number>
  const bands = Math.ceil((direct + 2 * width + 2 * reach) / BAND_M) + 1
  const banded = Object.fromEntries(STOPS.map((stop) => [stop, new Float64Array(bands)])) as Record<
    SwitchbackStop,
    Float64Array
  >
  const places: SwitchbackFailure['places'] = {}
  let hairpinsAccepted = 0
  let closestRemaining = direct,
    closestAt: XY = [0, 0],
    closestId = -1
  const failure = (reason: SwitchbackFailure['reason'], reached?: XY[]): SwitchbackFailure => ({
    reason,
    directM: direct,
    riseM: endZ - startZ,
    closestRemainingM: closestRemaining,
    closest: frame.fromXY(closestAt),
    ...(reached ? { reached: reached.map(frame.fromXY) } : {}),
    stopped: { ...stopped },
    frontier: Object.fromEntries(
      STOPS.map((stop) => {
        let sum = 0
        const lo = Math.floor(closestRemaining / BAND_M),
          hi = Math.min(bands - 1, Math.floor((closestRemaining + reach) / BAND_M))
        for (let b = lo; b <= hi; b++) sum += banded[stop][b]
        return [stop, sum]
      }),
    ) as Record<SwitchbackStop, number>,
    places: { ...places },
    hairpinsAccepted,
    end,
  })

  // Hairpins accepted so far: their vertices and how they were judged.
  const hx: number[] = [],
    hy: number[] = [],
    hprev: number[] = [],
    hshare: number[] = [],
    hgrade: number[] = [],
    hcut: number[] = [],
    hturn: number[] = []

  const fineBlocked = new Set<string>()
  let explored = 0
  for (let attempt = 0; attempt < FINE_ATTEMPTS; attempt++) {
    const labels = new Labels()
    const best = new Map<number, number>()
    const heap: number[] = []
    const less = (a: number, b: number) => {
      const fa = labels.num[F][a],
        fb = labels.num[F][b]
      return fa < fb || (fa === fb && labels.num[H][a] < labels.num[H][b])
    }
    const heapPush = (id: number) => {
      let i = heap.length
      heap.push(id)
      while (i > 0) {
        const parent = (i - 1) >> 1
        if (!less(id, heap[parent])) break
        heap[i] = heap[parent]
        i = parent
      }
      heap[i] = id
    }
    const heapPop = () => {
      const first = heap[0],
        last = heap.pop()!
      if (heap.length) {
        let i = 0
        while (2 * i + 1 < heap.length) {
          let child = 2 * i + 1
          if (child + 1 < heap.length && less(heap[child + 1], heap[child])) child++
          if (!less(heap[child], last)) break
          heap[i] = heap[child]
          i = child
        }
        heap[i] = last
      }
      return first
    }
    const keyOf = (c: number, leg: number, heading: number) =>
      (c * (legs + 1) + leg) * BINS + (Math.round(((heading / (2 * Math.PI)) * BINS + BINS) % BINS) % BINS)
    const GOAL_KEY = -1
    let goal = -1
    const n = labels.num
    const add = (
      values: {
        cell: number
        leg: number
        parent: number
        x: number
        y: number
        z: number
        cost: number
        heading: number
        grade: number
        length: number
        tangent: number
        sideHill: number
        turning: number
        hairpin: number
        contacts: number
        flags: number
      },
      key: number,
    ) => {
      if (labels.size >= SWITCHBACK_SEARCH_BUDGET.maxLabels) return -1
      if (labels.size >= labels.cell.length) labels.grow()
      const id = labels.size++
      labels.cell[id] = values.cell
      labels.leg[id] = values.leg
      labels.parent[id] = values.parent
      labels.hairpin[id] = values.hairpin
      labels.contacts[id] = values.contacts
      labels.flags[id] = values.flags
      const h = values.flags & GOAL ? 0 : lowerBound(values.x, values.y, values.z, values.leg)
      n[X][id] = values.x
      n[Y][id] = values.y
      n[Z][id] = values.z
      n[COST][id] = values.cost
      n[H][id] = h
      n[F][id] = values.cost + h
      n[HEAD][id] = values.heading
      n[GRADE][id] = values.grade
      n[LEN][id] = values.length
      n[TAN][id] = values.tangent
      n[SIDE][id] = values.sideHill
      n[TURNING][id] = values.turning
      const p = values.parent
      n[BX0][id] = p < 0 ? values.x : Math.min(n[BX0][p], values.x)
      n[BY0][id] = p < 0 ? values.y : Math.min(n[BY0][p], values.y)
      n[BX1][id] = p < 0 ? values.x : Math.max(n[BX1][p], values.x)
      n[BY1][id] = p < 0 ? values.y : Math.max(n[BY1][p], values.y)
      best.set(key, id)
      heapPush(id)
      return id
    }
    add(
      {
        cell: startCell,
        leg: 0,
        parent: -1,
        x: 0,
        y: 0,
        z: startZ,
        cost: 0,
        heading: NaN,
        grade: 0,
        length: 0,
        tangent: 0,
        sideHill: 0,
        turning: 0,
        hairpin: -1,
        contacts: 0,
        flags: 0,
      },
      keyOf(startCell, 0, 0) + 0.5,
    )

    const stop = (rule: SwitchbackStop, from: number, xy: XY, value?: number) => {
      stopped[rule]++
      const remaining = Math.hypot(end[0] - n[X][from], end[1] - n[Y][from])
      banded[rule][Math.min(bands - 1, Math.floor(remaining / BAND_M))]++
      const known = places[rule]
      // A turn too sharp is reported at its least sharp: that is the one a larger radius has to meet.
      const better =
        !known ||
        (rule === 'sharp' && value !== undefined && known.value !== undefined
          ? value < known.value - 1e-9 || (value <= known.value + 1e-9 && remaining < known.remainingM)
          : remaining < known.remainingM)
      if (better)
        places[rule] = { at: frame.fromXY(xy), xy, remainingM: remaining, ...(value === undefined ? {} : { value }) }
    }
    /** Whether the piece a→b crosses the route already drawn up to label `from`. */
    const crossesRoute = (from: number, a: XY, b: XY) => {
      const lo = [Math.min(a[0], b[0]), Math.min(a[1], b[1])],
        hi = [Math.max(a[0], b[0]), Math.max(a[1], b[1])]
      for (let q = labels.parent[from]; q >= 0 && labels.parent[q] >= 0; q = labels.parent[q]) {
        if (n[BX0][q] > hi[0] || n[BX1][q] < lo[0] || n[BY0][q] > hi[1] || n[BY1][q] < lo[1]) return false
        const p = labels.parent[q]
        if (segmentsMeet(a, b, [n[X][p], n[Y][p]], [n[X][q], n[Y][q]])) return true
      }
      return false
    }
    const streamContacts = (a: XY, b: XY) => {
      const crossed = new Set<string>()
      for (const s of segments) {
        const gap = segmentGap(a, b, s.a, s.b)
        if (s.stream === null) {
          if (gap <= clearance + 1e-7) return -1
        } else if (gap <= 1e-7) crossed.add(s.stream)
      }
      return crossed.size
    }

    const tryPiece = (from: number, target: number, offset: Offset | null) => {
      const px = n[X][from],
        py = n[Y][from],
        pz = n[Z][from]
      const toEnd = target < 0
      const tx = toEnd ? end[0] : px + offset!.di * cell,
        ty = toEnd ? end[1] : py + offset!.dj * cell
      const tz = toEnd ? endZ : z[target]
      const length = toEnd ? Math.hypot(tx - px, ty - py) : offset!.length
      if (length < 1e-6) return
      const heading = toEnd ? Math.atan2(ty - py, tx - px) : offset!.heading
      const leg = labels.leg[from]
      const key = toEnd ? GOAL_KEY : keyOf(target, leg, heading)
      const known = toEnd ? goal : best.get(key)
      if (known !== undefined && known >= 0 && n[COST][known] <= n[COST][from] + length) return
      const fromCell = labels.cell[from]
      if (fineBlocked.has(`${fromCell}>${target}`)) return
      if (!toEnd && blocked[target]) {
        stop((['terrain', 'terrain', 'corridor', 'exclusion'] as const)[blocked[target]], from, [tx, ty])
        return
      }
      const grade = ((tz - pz) / length) * 100,
        limit = directionalGradeLimit(grade, maxGrade, options.haulGrades ?? null)
      if (Math.abs(grade) > limit + EPS) return stop('grade', from, [px, py])
      if (rules.minGradeHard && minGrade > 0 && Math.abs(grade) < minGrade - EPS)
        return stop('minGrade', from, [px, py])
      const first = labels.parent[from] < 0
      const previous = n[HEAD][from]
      const theta = first ? 0 : Math.abs(wrapAngle(heading - previous)) / DEG
      const vertex: XY = [px, py]
      // Each curve needs its tangent on the straight run either side, net of the curve at the run's other end.
      let tangent = 0,
        run = length,
        hairpinCost = 0,
        loop: HairpinLoop | null = null,
        share = 0,
        turnGrade = 0,
        turnCut = 0
      if (first) {
        if (options.startHeading !== null && options.startHeading !== undefined) {
          const off = Math.abs(((azimuth(heading) - options.startHeading + 540) % 360) - 180)
          if (off > 45 + 1e-6) return stop('heading', from, vertex)
        }
      } else if (theta > hairpinAngle) {
        if (!rules.allow) return stop('hairpinOff', from, vertex, theta)
        if (theta > sharpest + EPS) return stop('sharp', from, vertex, theta)
        share = platformShare(fromCell)
        if (share > rules.platformSteepShare + EPS) return stop('platform', from, vertex, share)
        let checks = 0
        for (let h = labels.hairpin[from]; h >= 0 && checks < MAX_SPACING_CHECKS; h = hprev[h], checks++)
          if (Math.hypot(hx[h] - px, hy[h] - py) < spacing - EPS) return stop('spacing', from, vertex)
        loop = hairpinLoop(vertex, previous, heading, R, rules.middleStraightM)
        if (!loop) return stop('turnRoom', from, vertex)
        const trim = loop.trimM
        if (trim + n[TAN][from] + CURVE_GAP_M > n[LEN][from]) return stop('turnRoom', from, vertex)
        // The drawn turn runs at a constant grade between the two legs' grade lines.
        const zIn = pz - (n[GRADE][from] * trim) / 100,
          zOut = pz + (grade * trim) / 100
        turnGrade = ((zOut - zIn) / loop.lengthM) * 100
        if (Math.abs(turnGrade) > directionalGradeLimit(turnGrade, maxGrade, options.haulGrades ?? null) + EPS)
          return stop('turnGrade', from, vertex, turnGrade)
        for (const sample of sampleLoop(loop, cell / 2)) {
          const c = cellAt(sample.at[0], sample.at[1])
          const ground = zAt(sample.at[0], sample.at[1])
          if (c < 0 || blocked[c] || !Number.isFinite(ground)) return stop('turnGround', from, vertex)
          turnCut = Math.max(turnCut, Math.abs(ground - (zIn + (turnGrade * sample.s) / 100)))
        }
        if (rules.turnCutFillM !== null && turnCut > rules.turnCutFillM + EPS)
          return stop('turnCutFill', from, vertex, turnCut)
        hairpinCost =
          rules.penaltyM +
          (rules.platformSteepShare > 0 ? PLATFORM_COST_M * (share / rules.platformSteepShare) ** 2 : 0)
        tangent = trim
      } else if (theta > STRAIGHT_TURN_DEG) {
        tangent = curveRadius * Math.tan((theta * DEG) / 2)
        if (tangent + n[TAN][from] + CURVE_GAP_M > n[LEN][from]) return stop('curveFit', from, vertex)
        // The curve cuts the corner: its grade is the two legs' rise over the shorter arc.
        const curveGrade = ((n[GRADE][from] + grade) * tangent) / (curveRadius * theta * DEG)
        if (Math.abs(curveGrade) > directionalGradeLimit(curveGrade, maxGrade, options.haulGrades ?? null) + EPS)
          return stop('grade', from, vertex)
      } else if (!first) {
        // Straight on: the run goes on, with the tangent its first curve took.
        run = n[LEN][from] + length
        tangent = n[TAN][from]
      }
      if (toEnd) {
        if (tangent > 0 && tangent + CURVE_GAP_M > run) return stop('curveFit', from, vertex)
        if (options.endHeading !== null && options.endHeading !== undefined) {
          const off = Math.abs(((azimuth(heading) - options.endHeading + 540) % 360) - 180)
          if (off > 45 + 1e-6) return stop('heading', from, vertex)
        }
      }
      // The ground under the piece.
      const allowed = chordTolerance(rules.chordCutFillM, length)
      let steep = 0,
        nearby = false,
        charge = 0,
        samples = 0
      const visit = (c: number, along: number, ground: number): SwitchbackStop | null => {
        if (c < 0) return 'corridor'
        if (blocked[c]) return (['terrain', 'terrain', 'corridor', 'exclusion'] as const)[blocked[c]]
        if (!Number.isFinite(ground)) return 'terrain'
        if (Math.abs(ground - (pz + (grade * along) / 100)) > allowed + EPS) return 'chord'
        if (sideHillLimit !== null && !(slope[c] <= sideHillLimit)) steep++
        if (near[c]) nearby = true
        if (penalty) charge += penalty[c]
        samples++
        return null
      }
      const col = fromCell % columns,
        row = Math.floor(fromCell / columns)
      if (offset) {
        for (let k = 0; k < offset.along.length; k++) {
          const cc = col + offset.path[2 * k],
            rr = row + offset.path[2 * k + 1]
          const c = cc < 0 || rr < 0 || cc >= columns || rr >= rows ? -1 : rr * columns + cc
          const rule = visit(c, offset.along[k], c < 0 ? NaN : z[c])
          if (rule) return stop(rule, from, [tx, ty])
        }
      } else {
        const count = Math.max(1, Math.ceil(length / (cell / 2)))
        for (let k = 1; k <= count; k++) {
          const t = k / count
          const x = px + (tx - px) * t,
            y = py + (ty - py) * t
          const rule = visit(cellAt(x, y), length * t, k === count ? endZ : zAt(x, y))
          if (rule) return stop(rule, from, [tx, ty])
        }
      }
      const step = samples ? length / samples : 0
      const sideHill = Math.min(steep * step, length)
      if (sideHillLimit !== null && n[SIDE][from] + sideHill > rules.sideHillBudgetM + EPS)
        return stop('sideHill', from, [tx, ty])
      let contacts = 0
      if (nearby && segments.length) {
        contacts = streamContacts(vertex, [tx, ty])
        if (contacts < 0) return stop('exclusion', from, [tx, ty])
      }
      const turning = n[TURNING][from] + theta
      if (turning >= 180 - 1e-6 && crossesRoute(from, vertex, [tx, ty])) return stop('crossing', from, [tx, ty])
      const gradeChange = first
        ? 0
        : gradeChangePenalty * (Math.abs(grade - n[GRADE][from]) / (2 * Math.max(minGrade, maxGrade))) ** 2
      const underMinimum =
        !rules.minGradeHard && minGrade > 0 && Math.abs(grade) < minGrade
          ? length * (1 - Math.abs(grade) / minGrade) ** 2
          : 0
      const cost =
        n[COST][from] +
        length * (1 + weights.grade * (grade / limit) ** 2) +
        weights.vertical * Math.abs(tz - pz) +
        (first ? 0 : turnPenalty * (theta / hairpinAngle) ** 2) +
        gradeChange +
        sideHill +
        hairpinCost +
        underMinimum +
        charge * step +
        contacts * streamCost
      const again = toEnd ? goal : best.get(key)
      if (again !== undefined && again >= 0 && n[COST][again] <= cost) return
      let hairpin = labels.hairpin[from]
      if (loop) {
        hx.push(px)
        hy.push(py)
        hprev.push(hairpin)
        hshare.push(share)
        hgrade.push(turnGrade)
        hcut.push(turnCut)
        hturn.push(theta)
        hairpin = hx.length - 1
        hairpinsAccepted++
      }
      const id = add(
        {
          cell: toEnd ? -1 : target,
          leg,
          parent: from,
          x: tx,
          y: ty,
          z: tz,
          cost,
          heading,
          grade,
          length: run,
          tangent,
          sideHill: n[SIDE][from] + sideHill,
          turning,
          hairpin,
          contacts: labels.contacts[from] + contacts,
          flags: (toEnd ? GOAL : 0) | (loop ? HAIRPIN_AT_START : 0),
        },
        key,
      )
      if (toEnd && id >= 0) goal = id
    }

    let found = -1
    let budgetOut = false
    while (heap.length) {
      const id = heapPop()
      if (labels.flags[id] & GOAL) {
        if (id === goal) {
          found = id
          break
        }
        continue
      }
      const c = labels.cell[id],
        leg = labels.leg[id]
      const key = labels.parent[id] < 0 ? keyOf(startCell, leg, 0) + 0.5 : keyOf(c, leg, n[HEAD][id])
      if (best.get(key) !== id) continue
      if (++explored > maxExpansions || labels.size >= SWITCHBACK_SEARCH_BUDGET.maxLabels) {
        budgetOut = true
        break
      }
      if (explored % 32 === 0) yield progress(explored, explored / maxExpansions)
      const x = n[X][id],
        y = n[Y][id]
      const remaining = Math.hypot(end[0] - x, end[1] - y)
      if (remaining < closestRemaining) {
        closestRemaining = remaining
        closestAt = [x, y]
        closestId = id
      }
      if (leg < legs && Math.hypot(waypoints[leg][0] - x, waypoints[leg][1] - y) <= tolerance) {
        const nextKey = labels.parent[id] < 0 ? keyOf(startCell, leg + 1, 0) + 0.5 : keyOf(c, leg + 1, n[HEAD][id])
        const known = best.get(nextKey)
        if (known === undefined || n[COST][known] > n[COST][id])
          add(
            {
              cell: c,
              leg: leg + 1,
              parent: labels.parent[id],
              x,
              y,
              z: n[Z][id],
              cost: n[COST][id],
              heading: n[HEAD][id],
              grade: n[GRADE][id],
              length: n[LEN][id],
              tangent: n[TAN][id],
              sideHill: n[SIDE][id],
              turning: n[TURNING][id],
              hairpin: labels.hairpin[id],
              contacts: labels.contacts[id],
              flags: labels.flags[id],
            },
            nextKey,
          )
      }
      if (leg === legs && remaining <= reach) tryPiece(id, -1, null)
      const col = c % columns,
        row = Math.floor(c / columns)
      for (const offset of offsets) {
        const cc = col + offset.di,
          rr = row + offset.dj
        if (cc < 0 || rr < 0 || cc >= columns || rr >= rows) continue
        tryPiece(id, c + offset.delta, offset)
      }
    }
    /** The start, then each labelled position to `id`: where the search stood when it got nearest the end. */
    const reachedChain = (id: number): XY[] => {
      const chain: XY[] = []
      for (let at = id, count = 0; at >= 0 && count < 100_000; at = labels.parent[at], count++)
        chain.push([n[X][at], n[Y][at]])
      chain.push([0, 0])
      return chain.reverse()
    }
    if (found < 0) {
      const reason = budgetOut ? 'budget' : 'no-candidate'
      throw new SwitchbackSearchError(
        budgetOut
          ? 'The switchback search reached its budget without a route; narrow the corridor or shorten the road.'
          : 'No route with these switchback and grade rules reaches the end in this corridor. This is not proof that a field-designed road is impossible.',
        failure(reason, reachedChain(closestId)),
      )
    }

    // The route, from the start.
    const chain: number[] = []
    for (let id = found; id >= 0; id = labels.parent[id]) chain.push(id)
    chain.reverse()
    const nodes = chain.map((id) => ({
      id,
      cell: labels.cell[id],
      xy: [n[X][id], n[Y][id]] as XY,
      z: n[Z][id],
      heading: n[HEAD][id],
      grade: n[GRADE][id],
      length:
        labels.parent[id] < 0 ? 0 : Math.hypot(n[X][id] - n[X][labels.parent[id]], n[Y][id] - n[Y][labels.parent[id]]),
      hairpinAtStart: (labels.flags[id] & HAIRPIN_AT_START) !== 0,
    }))
    // An independent check of every piece and turn at ≤1 m on fresh terrain readings. A piece that
    // fails is taken out and the search runs again; an unchecked route is never returned.
    let rejected = false
    for (let k = 1; k < nodes.length; k++) {
      const a = nodes[k - 1],
        b = nodes[k]
      const count = Math.max(1, Math.ceil(b.length / FINE_STEP_M))
      const allowed = chordTolerance(rules.chordCutFillM, b.length)
      let bad = false
      for (let i = 1; i < count && !bad; i++) {
        const t = i / count
        const p: XY = [a.xy[0] + (b.xy[0] - a.xy[0]) * t, a.xy[1] + (b.xy[1] - a.xy[1]) * t]
        const ground = read(p)
        if (
          !Number.isFinite(ground) ||
          pointBlock(p, cell * 0.75) !== null ||
          Math.abs(ground - (a.z + (b.grade * b.length * t) / 100)) > allowed + 1e-6
        )
          bad = true
      }
      if (!bad && b.hairpinAtStart) {
        const loop = hairpinLoop(a.xy, a.heading, b.heading, R, rules.middleStraightM)!
        const zIn = a.z - (a.grade * loop.trimM) / 100,
          zOut = a.z + (b.grade * loop.trimM) / 100
        const turnGrade = ((zOut - zIn) / loop.lengthM) * 100
        for (const sample of sampleLoop(loop, FINE_STEP_M)) {
          const ground = read(sample.at)
          if (
            !Number.isFinite(ground) ||
            pointBlock(sample.at, cell * 0.75) !== null ||
            (rules.turnCutFillM !== null &&
              Math.abs(ground - (zIn + (turnGrade * sample.s) / 100)) > rules.turnCutFillM + 1e-6)
          ) {
            bad = true
            break
          }
        }
      }
      if (bad) {
        fineBlocked.add(`${a.cell}>${b.cell}`)
        rejected = true
      }
      if (k % 8 === 0) yield progress(explored, 1)
    }
    if (rejected) continue

    // Draw it: curves at the road's minimum radius, and each switchback as a loop of R.
    const points: { at: XY; radiusM: number }[] = [{ at: [0, 0], radiusM: 0 }]
    const turns: FoundSwitchback[] = []
    let underMinimumGradeM = 0
    for (let k = 1; k < nodes.length - 1; k++) {
      const v = nodes[k],
        next = nodes[k + 1]
      const theta = Math.abs(wrapAngle(next.heading - v.heading)) / DEG
      if (next.hairpinAtStart) {
        const loop = hairpinLoop(v.xy, v.heading, next.heading, R, rules.middleStraightM)!
        points.push(...loop.points)
        const zIn = v.z - (v.grade * loop.trimM) / 100,
          zOut = v.z + (next.grade * loop.trimM) / 100
        const turnGrade = ((zOut - zIn) / loop.lengthM) * 100
        let cut = 0
        for (const sample of sampleLoop(loop, FINE_STEP_M))
          cut = Math.max(cut, Math.abs(read(sample.at) - (zIn + (turnGrade * sample.s) / 100)))
        turns.push({
          coordinate: frame.fromXY(v.xy),
          turnDegrees: theta,
          platformSteepShare: platformShare(v.cell),
          turnGradePercent: turnGrade,
          turnCutFillM: cut,
          addedLengthM: loop.lengthM - 2 * loop.trimM,
        })
      } else if (theta > STRAIGHT_TURN_DEG) points.push({ at: v.xy, radiusM: curveRadius })
    }
    points.push({ at: end, radiusM: 0 })
    for (let k = 1; k < nodes.length; k++)
      if (minGrade > 0 && Math.abs(nodes[k].grade) < minGrade) underMinimumGradeM += nodes[k].length
    const controlPoints = points.map((p, i) => ({
      coordinate:
        i === 0
          ? ([...guide[0]] as Coordinate)
          : i === points.length - 1
            ? ([...guide[guide.length - 1]] as Coordinate)
            : frame.fromXY(p.at),
      radiusM: p.radiusM,
    }))
    const drawn = {
      id: 'switchback-search',
      name: 'Switchback search',
      color: '#000000',
      points: controlPoints.map((p, i) => ({ id: `p${i}`, coordinate: p.coordinate, radiusM: p.radiusM })),
      vertical: [],
      overrides: [],
    } as unknown as Alignment
    const curves = horizontalCurveSummary(drawn)
    const expected = controlPoints.filter((p) => p.radiusM > 0)
    if (curves.length !== expected.length || curves.some((c, i) => Math.abs(c.radius - expected[i].radiusM) > 0.001))
      throw Error('The switchback route does not keep its curves in the road engine; no road was changed.')
    const centreline = centrelineSamples(drawn, FINE_STEP_M)
    const coordinates = centreline.samples.map((s) => centreline.toCoordinate(s.x, s.y))
    coordinates[0] = [...guide[0]]
    coordinates[coordinates.length - 1] = [...guide[guide.length - 1]]
    const profile = centreline.samples.map((s, i) => ({
      stationM: s.s,
      elevationM: terrain.elevationAt(...coordinates[i]),
    }))
    const metricsOf = (samples: { s: number; elevationM: number }[]): CorridorMetrics => {
      let rise = 0,
        fall = 0,
        peak = 0,
        complete = true
      for (let i = 1; i < samples.length; i++) {
        const dz = samples[i].elevationM - samples[i - 1].elevationM,
          ds = samples[i].s - samples[i - 1].s
        if (!Number.isFinite(dz)) {
          complete = false
          continue
        }
        rise += Math.max(0, dz)
        fall += Math.max(0, -dz)
        if (ds > 0) peak = Math.max(peak, (Math.abs(dz) / ds) * 100)
      }
      const first = samples[0].elevationM,
        last = samples[samples.length - 1].elevationM
      return {
        lengthM: samples[samples.length - 1].s,
        maxSampledGroundPitchPercent: peak,
        groundAscentM: rise,
        groundDescentM: fall,
        excessVerticalM: complete ? Math.max(0, rise + fall - Math.abs(last - first)) : NaN,
        streamContacts: 0,
        complete,
      }
    }
    const metrics = {
      ...metricsOf(profile.map((p) => ({ s: p.stationM, elevationM: p.elevationM }))),
      streamContacts: labels.contacts[found],
    }
    const baselineSamples: { s: number; elevationM: number }[] = []
    let along = 0
    for (let i = 1; i < sketch.length; i++) {
      const a = sketch[i - 1],
        b = sketch[i],
        size = Math.hypot(b[0] - a[0], b[1] - a[1])
      const count = Math.max(1, Math.ceil(size / FINE_STEP_M))
      for (let k = i === 1 ? 0 : 1; k <= count; k++) {
        const t = k / count
        baselineSamples.push({
          s: along + size * t,
          elevationM: read([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]),
        })
      }
      along += size
    }
    const pieceLengthM = nodes.slice(1).reduce((sum, node) => sum + node.length, 0)
    const radii = expected.map((p) => p.radiusM)
    const warnings = [
      'Reconnaissance line only. Each switchback is drawn as a loop round the outside of its turn; its platform, cut and fill, drainage and the vehicle swept path need design and review.',
      groundWindowM
        ? `Grades are held on a ${groundWindowM} m ground trend, end to end over pieces up to ${whole(reach)} m, with the ground at most ${rules.chordCutFillM} m off a straight grade over ${CHORD_REFERENCE_M} m.`
        : `Grades are held end to end over pieces up to ${whole(reach)} m, with the ground at most ${rules.chordCutFillM} m off a straight grade over ${CHORD_REFERENCE_M} m.`,
    ]
    if (waypoints.length)
      warnings.push(`The road passes within ${whole(tolerance)} m of each of its ${waypoints.length} interior points.`)
    const result: SwitchbackRouteResult = {
      ...metrics,
      coordinates,
      controlPoints,
      profile,
      baseline: metricsOf(baselineSamples),
      directM: direct,
      explored,
      terrainSamples: reads,
      minimumRadiusM: radii.length ? Math.min(...radii) : null,
      nominalTurnRadiusM: curveRadius,
      sampleStepM: FINE_STEP_M,
      searchCellM: cell,
      objectiveCost: n[COST][found],
      searchStatus: 'complete',
      warnings,
      message: `${options.objective} switchback route: ${metrics.lengthM.toFixed(1)} m with ${turns.length} switchback${turns.length === 1 ? '' : 's'}. ${warnings[0]}`,
      switchbacks: turns,
      radiusM: R,
      pieceLengthM,
      sideHillM: n[SIDE][found],
      underMinimumGradeM,
      pieces: nodes.slice(1).map((node, i) => ({
        from: frame.fromXY(nodes[i].xy),
        to: frame.fromXY(node.xy),
        lengthM: node.length,
        gradePercent: node.grade,
      })),
    }
    return result
  }
  throw new SwitchbackSearchError(
    'Candidate switchback routes failed the finer terrain check. Inspect the terrain gaps and blocked areas; no unverified route was returned.',
    failure('no-candidate'),
  )
}

export function searchSwitchbackRoute(
  guide: Coordinate[],
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[],
  options: SwitchbackSearchOptions,
): SwitchbackRouteResult {
  return runToCompletion(search(guide, terrain, settings, context, options))
}
/** Cooperative execution keeps Cancel and the map responsive. */
export function searchSwitchbackRouteAsync(
  guide: Coordinate[],
  terrain: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[],
  options: SwitchbackSearchOptions,
  control: CooperativeControl<CorridorProgress> = {},
): Promise<SwitchbackRouteResult> {
  return runCooperatively(search(guide, terrain, settings, context, options), control, 'Switchback search cancelled.')
}

const percent = (share: number) => `${Math.round(share * 100)}%`

export interface SwitchbackFailureLimits {
  maxGradePercent: number
  minRadiusM: number
  halfWidthM: number
  rules: SwitchbackRouteOptions
  radiusM: number
  sideHillSlopePercent: number | null
}

/**
 * "Every switchback it tried was refused, 12 of them because the platform is too steep …": the
 * switchback rule that refused the most tries, at the try nearest the end, with what to change.
 * Null unless switchbacks were allowed and none passed.
 */
export function switchbackRefusal(failure: SwitchbackFailure, limits: SwitchbackFailureLimits): string | null {
  const { stopped, places } = failure,
    rules = limits.rules,
    g = limits.maxGradePercent
  // The rule latest in the order a try meets them: those tries passed every rule before it.
  const refusals = HAIRPIN_ORDER.filter((stop) => stopped[stop] > 0 && places[stop])
  if (!rules.allow || failure.hairpinsAccepted > 0 || !refusals.length) return null
  const rule = refusals[refusals.length - 1],
    place = places[rule]!
  const where = switchbackPlaceText(place.xy, failure.end)
  const radius = `R ${whole(limits.radiusM)} m`
  const text: Record<string, () => string> = {
    platform: () =>
      `the platform is too steep ${where}: ${percent(place.value ?? 1)} of the ground within ${(PLATFORM_RADIUS_FACTOR * limits.radiusM).toFixed(1)} m is steeper than ${rules.platformSlopePercent}%, and at most ${percent(rules.platformSteepShare)} may be. Raise the platform slope limit or its steep share under Search settings → Switchbacks, or move an end onto ground with a bench`,
    sharp: () =>
      `a switchback ${where} would turn ${(place.value ?? 0).toFixed(1)}°, sharper than the ${sharpestSwitchbackDegrees(g, limits.radiusM).toFixed(1)}° a ${g}% road can stack at ${radius}. Use a larger switchback radius`,
    spacing: () =>
      `switchbacks would be closer than ${whole(rules.spacingFactor * limits.radiusM)} m apart ${where}. Lower the spacing or widen the corridor`,
    turnRoom: () =>
      `the legs ${where} are too short to draw a switchback of ${radius}. Use a smaller switchback radius`,
    turnGrade: () =>
      `the drawn turn ${where} would run at ${Math.abs(place.value ?? 0).toFixed(1)}%, over the ${g}% limit. Use a larger switchback radius`,
    turnGround: () =>
      `the drawn turn ${where} would leave the terrain or the corridor, or enter a blocked area. Widen the corridor or move the ends`,
    turnCutFill: () =>
      `the drawn turn ${where} needs ${(place.value ?? 0).toFixed(1)} m of cut or fill, over the ${rules.turnCutFillM} m allowed. Raise that limit or use a smaller switchback radius`,
  }
  return `every switchback it tried was refused, ${stopped[rule].toLocaleString('en-CA')} of them because ${text[rule]()}.`
}

/** The general rule that stopped most pieces where the search got furthest, and how many pieces were stopped there. */
function frontierStop(failure: SwitchbackFailure) {
  // Judged where the search got furthest: refusals far behind it say little about what stopped it.
  const { frontier, stopped } = failure
  const general = STOPS.filter((stop) => stop !== 'hairpinOff' && !HAIRPIN_STOPS.has(stop))
  const total = general.reduce((sum, stop) => sum + frontier[stop], 0)
  const main = general.sort((a, b) => frontier[b] - frontier[a] || stopped[b] - stopped[a])[0]
  return { total, main }
}

/**
 * The rule `describeSwitchbackFailure` names and the place it names it at, for marking that place on
 * the plan. Null when the description names no place. Follows the description's own order.
 */
export function switchbackFailureFocus(
  failure: SwitchbackFailure,
  limits: SwitchbackFailureLimits,
): { stop: SwitchbackStop; place: SwitchbackPlace } | null {
  const { stopped, places } = failure
  if (!limits.rules.allow && stopped.hairpinOff > 0 && failure.hairpinsAccepted === 0 && places.hairpinOff)
    return { stop: 'hairpinOff', place: places.hairpinOff }
  if (switchbackRefusal(failure, limits)) {
    const refusals = HAIRPIN_ORDER.filter((stop) => stopped[stop] > 0 && places[stop])
    const stop = refusals[refusals.length - 1]
    return { stop, place: places[stop]! }
  }
  const { total, main } = frontierStop(failure)
  return total && places[main] ? { stop: main, place: places[main]! } : null
}

/**
 * Why a switchback search ended with no road, where, and what to change. A rule that refused every
 * switchback the search tried is named first, at the try nearest the end; otherwise the rule that
 * stopped most trial pieces.
 */
export function describeSwitchbackFailure(failure: SwitchbackFailure, limits: SwitchbackFailureLimits) {
  const { stopped, places } = failure,
    rules = limits.rules
  const g = limits.maxGradePercent
  const parts: string[] = []
  const needed = (Math.abs(failure.riseM) * 100) / g
  const average = (Math.abs(failure.riseM) / Math.max(1, failure.directM)) * 100
  if (average > g)
    parts.push(
      `The ends are ${whole(failure.directM)} m apart and ${whole(Math.abs(failure.riseM))} m apart in height (${Math.round(average)}%): at ${g}% the road is at least ${whole(needed)} m long.`,
    )
  const reached =
    failure.closestRemainingM > failure.directM - 5
      ? 'made no headway toward the end'
      : `got to within ${whole(failure.closestRemainingM)} m of the end`
  const ended = failure.reason === 'budget' ? ', then ran out of its search budget' : ' and had no line left to try'
  const where = (stop: SwitchbackStop) => switchbackPlaceText(places[stop]!.xy, failure.end)
  const refusal = switchbackRefusal(failure, limits)
  if (!rules.allow && stopped.hairpinOff > 0 && failure.hairpinsAccepted === 0 && places.hairpinOff)
    parts.push(
      `No line within ${g}% reaches the end without a switchback: the search ${reached}${ended}. It needs a switchback, and none are allowed: it would have turned back ${where('hairpinOff')}. Turn on Allow switchbacks under Search settings → Switchbacks.`,
    )
  else if (refusal)
    parts.push(
      `No line within ${g}% reaches the end: the search ${reached}${ended}. ${refusal[0].toUpperCase()}${refusal.slice(1)}`,
    )
  else {
    const { frontier } = failure
    const { total, main } = frontierStop(failure)
    const cause: Partial<Record<SwitchbackStop, string>> = {
      grade: `ground steeper than the ${g}% grade limit`,
      minGrade: `the ${rules.minGradePercent}% minimum grade`,
      terrain: 'gaps in the terrain',
      exclusion: 'blocked areas',
      corridor: `the edge of the ±${whole(limits.halfWidthM)} m corridor`,
      chord: `ground more than ${rules.chordCutFillM} m off a straight grade over ${CHORD_REFERENCE_M} m`,
      sideHill: `the ${whole(rules.sideHillBudgetM)} m allowed on ground steeper than ${limits.sideHillSlopePercent}%`,
      crossing: 'the road crossing itself',
      curveFit: `no room for curves of the ${whole(limits.minRadiusM)} m minimum radius`,
      heading: 'the end headings',
    }
    const remedy: Partial<Record<SwitchbackStop, string>> = {
      grade: rules.allow
        ? 'Raise the grade limit or widen the corridor under Search settings.'
        : 'Raise the grade limit, widen the corridor, or allow switchbacks under Search settings → Switchbacks.',
      minGrade: 'Lower the minimum grade, or let it only charge.',
      terrain: 'Move the ends onto mapped ground, or add terrain between them.',
      exclusion: 'Change the treatment of the areas between the ends, or widen the corridor under Search settings.',
      corridor: 'Widen the corridor under Search settings.',
      chord: 'Raise the straight-grade cut or fill under Search settings → Switchbacks.',
      sideHill: 'Raise the side-hill length or its slope limit.',
      crossing: 'Widen the corridor or move the ends.',
      curveFit: 'Lower the minimum radius, or widen the corridor.',
      heading: 'Clear or change the end headings.',
    }
    parts.push(
      total
        ? `No line within ${g}% reaches the end: the search ${reached}${ended}. ${whole((100 * frontier[main]) / total)}% of the pieces it tried from there were stopped by ${cause[main]}${places[main] ? `, the nearest ${where(main)}` : ''}. ${remedy[main]}`
        : `The switchback search ${reached}${ended}. Move an end or widen the corridor under Search settings.`,
    )
  }
  return parts.join(' ')
}
