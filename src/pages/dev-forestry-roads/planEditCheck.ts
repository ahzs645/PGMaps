/**
 * Whether a plan edit (a point drag, a bend, a typed coordinate, pegs) leaves a road that can be
 * built. An edit is refused when it makes the road cross itself, leaves a corner that could not take
 * a curve even at the project's minimum radius (a corner entered with no curve included), brings the
 * road's running surface back onto itself, or takes the road into an area marked Excluded. Only what
 * the edit makes worse is refused: anything the road already had never blocks another edit.
 * Crossings are read on the control line; the other three on the fitted centreline. Free of DOM
 * access. Guide: docs/forestry-road-design/plan-edit-limits.md.
 */
import { resolveConstraint } from './constraints'
import {
  centrelineSamples,
  effectiveWidths,
  horizontalCurveFits,
  horizontalGeometry,
  type HorizontalCurveFit,
} from './engine'
import type { Alignment, ContextFeature, Coordinate } from './types'

export interface PlanEditRefusal {
  kind: 'crossing' | 'curve' | 'clearance' | 'excluded'
  /** One sentence for the notice line: what was refused and why, with the remedy. */
  message: string
  /** A short form for the label beside the dragged handle. */
  label: string
  /** Where to mark it on the plan: the crossing, the corner, the overlap or the area entry. */
  at: Coordinate
}

export interface PlanEditOptions {
  /** The project's context: avoid polygons whose treatment is Excluded refuse an edit that enters them. */
  context?: readonly ContextFeature[]
}

/**
 * Sampling of the fitted centreline for the surface and area checks: at least every
 * `MAX_PLAN_CHECK_STEP_M`, and no more than `MAX_PLAN_CHECK_SAMPLES` samples, so a drag preview on
 * a long road stays a few milliseconds.
 */
export const MIN_PLAN_CHECK_STEP_M = 1
export const MAX_PLAN_CHECK_STEP_M = 5
export const MAX_PLAN_CHECK_SAMPLES = 6000
/**
 * Overlap or area length an edit may add before it is refused, in samples: chainages move a little
 * whenever any point moves, so a length measured on samples changes by up to a sample without
 * anything changing on the ground.
 */
const LENGTH_TOLERANCE_SAMPLES = 2

/** Fits the engine cannot round. `sharp` and `straight` have no curve to fit. */
const UNFITTED = new Set<HorizontalCurveFit['status']>(['tangent', 'overlap', 'reversal'])

const metres = (value: number) => value.toLocaleString('en-CA', { maximumFractionDigits: 1 })

/** Proper crossings of two segments, endpoints included, in longitude/latitude (an affine frame). */
function segmentsCross(a: Coordinate, b: Coordinate, c: Coordinate, d: Coordinate): Coordinate | null {
  const rx = b[0] - a[0],
    ry = b[1] - a[1],
    sx = d[0] - c[0],
    sy = d[1] - c[1]
  const denom = rx * sy - ry * sx
  const qx = c[0] - a[0],
    qy = c[1] - a[1]
  const scale = Math.max(Math.hypot(rx, ry), Math.hypot(sx, sy))
  if (scale === 0) return null
  if (Math.abs(denom) <= 1e-12 * scale * scale) {
    // Parallel: a crossing only when collinear and overlapping, which is the road running back
    // along itself.
    if (Math.abs(qx * ry - qy * rx) > 1e-12 * scale * scale) return null
    const len = rx * rx + ry * ry
    if (len === 0) return null
    const t0 = (qx * rx + qy * ry) / len,
      t1 = t0 + (sx * rx + sy * ry) / len
    const lo = Math.max(0, Math.min(t0, t1)),
      hi = Math.min(1, Math.max(t0, t1))
    if (hi < lo) return null
    const t = (lo + hi) / 2
    return [a[0] + rx * t, a[1] + ry * t]
  }
  const t = (qx * sy - qy * sx) / denom,
    u = (qx * ry - qy * rx) / denom
  if (t < 0 || t > 1 || u < 0 || u > 1) return null
  return [a[0] + rx * t, a[1] + ry * t]
}

export interface SelfCrossing {
  /** 1-based point numbers of each crossing leg's start, the way points are numbered on the plan. */
  legs: [number, number]
  at: Coordinate
  /** The ids at each leg's ends, so the same crossing can be recognised before and after an edit. */
  key: string
}

/**
 * Every place the road's control line crosses itself. Neighbouring legs share a point and never
 * count. A sweep along longitude keeps it near-linear for the 2,000-point limit.
 */
export function selfCrossings(points: Alignment['points']): SelfCrossing[] {
  type Leg = { i: number; minX: number; maxX: number; minY: number; maxY: number }
  const legs: Leg[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i].coordinate, points[i + 1].coordinate]
    legs.push({
      i,
      minX: Math.min(a[0], b[0]),
      maxX: Math.max(a[0], b[0]),
      minY: Math.min(a[1], b[1]),
      maxY: Math.max(a[1], b[1]),
    })
  }
  legs.sort((p, q) => p.minX - q.minX)
  const found: SelfCrossing[] = []
  for (let m = 0; m < legs.length; m++) {
    const p = legs[m]
    for (let n = m + 1; n < legs.length && legs[n].minX <= p.maxX; n++) {
      const q = legs[n]
      if (Math.abs(p.i - q.i) < 2 || q.minY > p.maxY || q.maxY < p.minY) continue
      const [i, j] = p.i < q.i ? [p.i, q.i] : [q.i, p.i]
      const at = segmentsCross(
        points[i].coordinate,
        points[i + 1].coordinate,
        points[j].coordinate,
        points[j + 1].coordinate,
      )
      if (at)
        found.push({
          legs: [i + 1, j + 1],
          at,
          key: [points[i].id, points[i + 1].id, points[j].id, points[j + 1].id].join('|'),
        })
    }
  }
  return found.sort((p, q) => p.legs[0] - q.legs[0] || p.legs[1] - q.legs[1])
}

function fitsOf(alignment: Alignment): HorizontalCurveFit[] | null {
  try {
    return horizontalCurveFits(alignment)
  } catch {
    // An alignment the engine cannot compile is reported by the workspace's own validation.
    return null
  }
}

const interior = (alignment: Alignment, index: number) => index > 0 && index < alignment.points.length - 1

/**
 * The road as it would be built at the minimum radius: every corner, those entered with no curve
 * included, gets the smaller of its own radius and the minimum. A corner that fails here cannot be
 * rounded at any radius the project allows.
 */
function atMinimumRadius(alignment: Alignment, minRadiusM: number): Alignment {
  const min = Math.max(0, minRadiusM)
  return {
    ...alignment,
    points: alignment.points.map((point, i) =>
      interior(alignment, i) ? { ...point, radiusM: point.radiusM > 0 ? Math.min(point.radiusM, min) : min } : point,
    ),
  }
}

/** The road the surface and area checks read: corners entered with no curve take the minimum radius. */
function asBuilt(alignment: Alignment, minRadiusM: number): Alignment {
  const min = Math.max(0, minRadiusM)
  if (!(min > 0)) return alignment
  return {
    ...alignment,
    points: alignment.points.map((point, i) =>
      interior(alignment, i) && !(point.radiusM > 0) ? { ...point, radiusM: min } : point,
    ),
  }
}

function curveRefusal(
  fit: HorizontalCurveFit,
  trial: Alignment,
  entered: Alignment,
  minRadiusM: number,
): PlanEditRefusal {
  const point = trial.points[fit.point - 1]
  // A corner entered without a curve still needs one to be driven, so the notice says so.
  const sharp = !(entered.points[fit.point - 1]?.radiusM > 0)
  const hairpin = ' For a hairpin, use Design → Add a switchback.'
  if (fit.status === 'reversal')
    return {
      kind: 'curve',
      at: point.coordinate,
      label: 'Turns back on itself',
      message: `Not applied: the road would turn back on itself at point ${fit.point}, where no curve can join the legs.${hairpin}`,
    }
  const radius = Math.min(fit.radiusM, minRadiusM)
  const room = Math.min(fit.backM, fit.aheadM)
  const remedy = ` Keep the points farther apart or the angle smaller.${fit.deflectionDegrees > 90 ? hairpin : ''}`
  if (fit.status === 'overlap')
    return {
      kind: 'curve',
      at: point.coordinate,
      label: `Curves at ${fit.point} and ${fit.neighbourPoint} overlap`,
      message: `Not applied: at R ${metres(radius)} m the curves ${sharp ? 'the road needs ' : ''}at points ${fit.point} and ${fit.neighbourPoint} would overlap on the ${metres(room)} m left between them.${remedy}`,
    }
  return {
    kind: 'curve',
    at: point.coordinate,
    label: `Curve at ${fit.point} needs ${metres(fit.tangentM)} m`,
    message: sharp
      ? `Not applied: point ${fit.point} has no curve, and the R ${metres(radius)} m curve the road needs there takes ${metres(fit.tangentM)} m of straight each side; the shorter leg has ${metres(room)} m.${remedy}`
      : `Not applied: at point ${fit.point} an R ${metres(radius)} m curve needs ${metres(fit.tangentM)} m of straight each side, and the shorter leg has ${metres(room)} m.${remedy}`,
  }
}

type FittedSample = { s: number; x: number; y: number; coordinate: Coordinate }

function sampled(alignment: Alignment): { step: number; samples: FittedSample[] } | null {
  try {
    const first = centrelineSamples(alignment, MAX_PLAN_CHECK_STEP_M)
    const step = Math.min(MAX_PLAN_CHECK_STEP_M, Math.max(MIN_PLAN_CHECK_STEP_M, first.length / MAX_PLAN_CHECK_SAMPLES))
    const line = step === MAX_PLAN_CHECK_STEP_M ? first : centrelineSamples(alignment, step)
    return {
      step: line.samples.length > 1 ? line.length / (line.samples.length - 1) : step,
      samples: line.samples.map((p) => ({ ...p, coordinate: line.toCoordinate(p.x, p.y) })),
    }
  } catch {
    return null
  }
}

export interface SurfaceOverlap {
  /** Fitted-centreline length, both parts counted, whose running surface lies on another part's. */
  lengthM: number
  /** The deepest overlap: its two places, centreline gap and the room their surfaces need. */
  worst: { a: FittedSample; b: FittedSample; gapM: number; neededM: number } | null
  /** Every sample in an overlap, so a later edit can tell an overlap it adds from one already there. */
  hits: Coordinate[]
}

/**
 * Where the fitted road's running surface (formation half-widths, widening included; ditches and
 * slopes left out) comes back onto itself. Two places on the road are only compared when the road
 * between them is longer than half a turn round a circle of their combined half-widths: closer
 * along the road than that, their surfaces touch on any curve the road can drive. The two legs
 * either side of a corner left without a curve are not compared either: that fold is the corner,
 * which the curve rule judges.
 */
export function surfaceOverlap(
  alignment: Alignment,
  line = sampled(alignment),
  known: (at: Coordinate) => boolean = () => false,
): SurfaceOverlap {
  if (!line || line.samples.length < 3) return { lengthM: 0, worst: null, hits: [] }
  const { samples, step } = line
  const n = samples.length
  const left = new Float64Array(n),
    right = new Float64Array(n),
    hx = new Float64Array(n),
    hy = new Float64Array(n)
  let widest = 0
  for (let i = 0; i < n; i++) {
    const w = effectiveWidths(alignment, samples[i].s)
    left[i] = Math.max(0, w.leftWidth)
    right[i] = Math.max(0, w.rightWidth)
    widest = Math.max(widest, left[i], right[i])
    const a = samples[Math.max(0, i - 1)],
      b = samples[Math.min(n - 1, i + 1)]
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
    hx[i] = (b.x - a.x) / len
    hy[i] = (b.y - a.y) / len
  }
  if (!(widest > 0)) return { lengthM: 0, worst: null, hits: [] }
  // Which piece of the fitted road each sample is on, and whether a piece starts at a sharp corner.
  let pieces: ReturnType<typeof horizontalGeometry> = []
  try {
    pieces = horizontalGeometry(alignment)
  } catch {
    // Sampling succeeded, so this cannot fail on its own; without pieces every pair is compared.
  }
  const piece = new Int32Array(n)
  for (let i = 0, k = 0; i < n; i++) {
    while (k + 1 < pieces.length && pieces[k + 1].station <= samples[i].s) k++
    piece[i] = k
  }
  const sharpStart = pieces.map((p, k) => k > 0 && p.kind === 'line' && pieces[k - 1].kind === 'line')
  const cell = 2 * widest
  const grid = new Map<string, number[]>()
  const keyOf = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`
  for (let i = 0; i < n; i++) {
    const key = keyOf(samples[i].x, samples[i].y)
    const list = grid.get(key)
    if (list) list.push(i)
    else grid.set(key, [i])
  }
  const hit = new Uint8Array(n)
  let worst: SurfaceOverlap['worst'] = null
  // Half-width of the surface at i on the side facing (x, y): left is positive cross product.
  const facing = (i: number, x: number, y: number) =>
    hx[i] * (y - samples[i].y) - hy[i] * (x - samples[i].x) > 0 ? left[i] : right[i]
  for (let i = 0; i < n; i++) {
    const p = samples[i]
    const cx = Math.floor(p.x / cell),
      cy = Math.floor(p.y / cell)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++) {
        const list = grid.get(`${cx + dx},${cy + dy}`)
        if (!list) continue
        for (const j of list) {
          if (j <= i) continue
          const q = samples[j]
          const reach = Math.max(left[i], right[i]) + Math.max(left[j], right[j])
          if (q.s - p.s < (Math.PI / 2) * reach) continue
          if (piece[j] === piece[i] + 1 && sharpStart[piece[j]]) continue
          const gap = Math.hypot(q.x - p.x, q.y - p.y)
          const needed = facing(i, q.x, q.y) + facing(j, p.x, p.y)
          if (!(gap < needed)) continue
          hit[i] = 1
          hit[j] = 1
          // The deepest overlap the road did not already have, else the deepest of all.
          const fresh = !known(p.coordinate) || !known(q.coordinate)
          const worstFresh = !!worst && (!known(worst.a.coordinate) || !known(worst.b.coordinate))
          if (!worst || (fresh && !worstFresh) || (fresh === worstFresh && needed - gap > worst.neededM - worst.gapM))
            worst = { a: p, b: q, gapM: gap, neededM: needed }
        }
      }
  }
  const hits: Coordinate[] = []
  for (let i = 0; i < n; i++) if (hit[i]) hits.push(samples[i].coordinate)
  return { lengthM: hits.length * step, worst, hits }
}

/** Longitude/latitude ring containment, even-odd. */
function ringContains(ring: GeoJSON.Position[], [x, y]: Coordinate): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i],
      [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

type ExcludedArea = { name: string; rings: GeoJSON.Position[][]; box: [number, number, number, number] }

/** Avoid polygons whose treatment is Excluded, explicitly or by the legacy no-price convention. */
export function excludedAreas(context: readonly ContextFeature[] = []): ExcludedArea[] {
  return context.flatMap((feature) => {
    if (feature.kind !== 'avoid' || feature.geometry.type !== 'Polygon') return []
    if (resolveConstraint(feature).policy.treatment !== 'excluded') return []
    const rings = feature.geometry.coordinates
    if (!rings[0]?.length) return []
    const xs = rings[0].map((p) => p[0]),
      ys = rings[0].map((p) => p[1])
    return [
      {
        name: feature.name,
        rings,
        box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as [number, number, number, number],
      },
    ]
  })
}

/** Fitted-centreline length inside each excluded area, by area index, and the first sample inside. */
function insideExcluded(areas: ExcludedArea[], line: ReturnType<typeof sampled>) {
  const lengths = areas.map(() => 0)
  const first: (FittedSample | null)[] = areas.map(() => null)
  if (!line) return { lengths, first }
  for (const sample of line.samples) {
    const [x, y] = sample.coordinate
    areas.forEach((area, k) => {
      const [x0, y0, x1, y1] = area.box
      if (x < x0 || x > x1 || y < y0 || y > y1) return
      if (!ringContains(area.rings[0], sample.coordinate)) return
      if (area.rings.slice(1).some((hole) => ringContains(hole, sample.coordinate))) return
      lengths[k] += line.step
      first[k] ??= sample
    })
  }
  return { lengths, first }
}

/** 1-based number of the control-line leg's start nearest a coordinate, as legs are named on the plan. */
function nearestLeg(points: Alignment['points'], at: Coordinate): number {
  const k = Math.cos((at[1] * Math.PI) / 180)
  let best = 0,
    bestDistance = Infinity
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i].coordinate,
      [bx, by] = points[i + 1].coordinate
    const vx = (bx - ax) * k,
      vy = by - ay,
      px = (at[0] - ax) * k,
      py = at[1] - ay
    const t = Math.max(0, Math.min(1, (px * vx + py * vy) / (vx * vx + vy * vy || 1)))
    const d = Math.hypot(px - t * vx, py - t * vy)
    if (d < bestDistance) [best, bestDistance] = [i, d]
  }
  return best + 1
}

/** What an alignment already has, cached by identity: the road before an edit is checked on every drag frame. */
type Baseline = {
  crossings: SelfCrossing[]
  minimumFits: HorizontalCurveFit[] | null
  overlap: SurfaceOverlap
  excludedM: number[]
}
const baselines = new WeakMap<Alignment, { minRadiusM: number; context: readonly ContextFeature[]; value: Baseline }>()

function baseline(alignment: Alignment, minRadiusM: number, areas: ExcludedArea[], context: readonly ContextFeature[]) {
  const cached = baselines.get(alignment)
  if (cached && cached.minRadiusM === minRadiusM && cached.context === context) return cached.value
  const line = sampled(asBuilt(alignment, minRadiusM))
  const value: Baseline = {
    crossings: selfCrossings(alignment.points),
    minimumFits: fitsOf(atMinimumRadius(alignment, minRadiusM)),
    overlap: surfaceOverlap(asBuilt(alignment, minRadiusM), line),
    excludedM: insideExcluded(areas, line).lengths,
  }
  baselines.set(alignment, { minRadiusM, context, value })
  return value
}

const NO_CONTEXT: readonly ContextFeature[] = []

/** Whether a coordinate lies within `radiusM` of any of `points`, by a grid of that size. */
function near(points: Coordinate[], radiusM: number): (at: Coordinate) => boolean {
  if (!points.length) return () => false
  const lat = (points[0][1] * Math.PI) / 180
  const sy = 111_320,
    sx = sy * Math.cos(lat)
  const grid = new Map<string, Coordinate[]>()
  const cell = ([x, y]: Coordinate) => [Math.floor((x * sx) / radiusM), Math.floor((y * sy) / radiusM)]
  for (const p of points) {
    const [i, j] = cell(p)
    const key = `${i},${j}`
    const list = grid.get(key)
    if (list) list.push(p)
    else grid.set(key, [p])
  }
  return (at) => {
    const [i, j] = cell(at)
    for (let di = -1; di <= 1; di++)
      for (let dj = -1; dj <= 1; dj++)
        for (const p of grid.get(`${i + di},${j + dj}`) ?? [])
          if (Math.hypot((p[0] - at[0]) * sx, (p[1] - at[1]) * sy) <= radiusM) return true
    return false
  }
}

/**
 * Null when `after` may replace `before`. `minRadiusM` is the project's minimum radius: every corner
 * must be able to take a curve at it, but one whose entered radius no longer fits is allowed when the
 * minimum would, and the point's own note then gives the largest radius that fits.
 */
export function checkPlanEdit(
  before: Alignment,
  after: Alignment,
  minRadiusM: number,
  options: PlanEditOptions = {},
): PlanEditRefusal | null {
  const context = options.context ?? NO_CONTEXT
  const areas = excludedAreas(context)
  const was = baseline(before, minRadiusM, areas, context)

  // Counted, not matched: a bend added to a leg that already crosses splits it, which renames the
  // crossing without adding one.
  const afterCrossings = selfCrossings(after.points)
  const known = new Set(was.crossings.map((c) => c.key))
  const crossing =
    afterCrossings.length > was.crossings.length
      ? (afterCrossings.find((c) => !known.has(c.key)) ?? afterCrossings[0])
      : undefined
  if (crossing)
    return {
      kind: 'crossing',
      at: crossing.at,
      label: 'Crosses the road',
      message: `Not applied: the road would cross itself between points ${crossing.legs[0]}–${crossing.legs[0] + 1} and ${crossing.legs[1]}–${crossing.legs[1] + 1}. A road that meets itself is two roads joined at a junction.`,
    }

  // Every corner, sharp ones included, must take a curve at the minimum radius. Only corners that
  // could before (or are new) and cannot now are refused.
  const trial = atMinimumRadius(after, minRadiusM)
  const trialFits = fitsOf(trial)
  if (!trialFits) return null
  const couldBefore = new Map((was.minimumFits ?? []).map((fit) => [fit.pointId, !UNFITTED.has(fit.status)]))
  const failing = trialFits.find((fit) => UNFITTED.has(fit.status) && couldBefore.get(fit.pointId) !== false)
  if (failing) return curveRefusal(failing, trial, after, minRadiusM)

  const built = asBuilt(after, minRadiusM)
  const line = sampled(built)
  if (!line) return null
  const tolerance = LENGTH_TOLERANCE_SAMPLES * line.step

  const overlap = surfaceOverlap(built, line, near(was.overlap.hits, 2 * tolerance))
  if (overlap.worst && overlap.lengthM > was.overlap.lengthM + tolerance) {
    const { a, b, gapM, neededM } = overlap.worst
    const [legA, legB] = [nearestLeg(after.points, a.coordinate), nearestLeg(after.points, b.coordinate)].sort(
      (p, q) => p - q,
    )
    const where =
      legA === legB
        ? `on the leg from point ${legA} to ${legA + 1}`
        : `between points ${legA}–${legA + 1} and ${legB}–${legB + 1}`
    return {
      kind: 'clearance',
      at: [(a.coordinate[0] + b.coordinate[0]) / 2, (a.coordinate[1] + b.coordinate[1]) / 2],
      label: `Road ${metres(gapM)} m from itself`,
      message: `Not applied: the road would run onto itself ${where}: the centrelines would be ${metres(gapM)} m apart where the running surfaces need ${metres(neededM)} m. Keep the legs farther apart.${legB - legA <= 2 ? ' For a hairpin, use Design → Add a switchback.' : ''}`,
    }
  }

  if (areas.length) {
    const inside = insideExcluded(areas, line)
    const entered = areas.findIndex((_, k) => inside.lengths[k] > (was.excludedM[k] ?? 0) + tolerance)
    if (entered >= 0) {
      const at = inside.first[entered]!.coordinate
      return {
        kind: 'excluded',
        at,
        label: `Enters ${areas[entered].name}`,
        message: `Not applied: the road would enter ${areas[entered].name}, an area marked Excluded, near point ${nearestLeg(after.points, at)}. Keep the road outside it, or change the area's treatment under Constraints.`,
      }
    }
  }
  return null
}
