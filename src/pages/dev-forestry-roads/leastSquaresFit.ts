/**
 * Least-squares geometry of a mapped or traced road: straight tangents, the circle through a bend,
 * and a tangent–curve (optionally spiral–curve–spiral) alignment between fitted tangents that a
 * designer can adopt as intersection points with radii.
 *
 * Implements:
 * - the algebraic circle fit of Kåsa (1976) in its centred normal-equation form (Bullock 2006),
 *   solved as a general 2×2 system, so points symmetric about an axis are fitted like any others;
 * - the geometric (orthogonal-distance) circle fit, minimising Σ(dᵢ − R)² by damped Gauss–Newton
 *   (Levenberg–Marquardt) from the Kåsa start (Gander, Golub & Strebel 1994; Chernov & Lesort 2005),
 *   with the radius's standard error from the fit's covariance σ²(JᵀJ)⁻¹;
 * - the total-least-squares line: the principal axis of the centred points (Golub & Van Loan 2013);
 * - tangents found by growing a line one point at a time while its largest residual stays within a
 *   tolerance, longest first;
 * - between two fitted tangents, the radius (and, if asked, the spiral length of a symmetric
 *   spiral–curve–spiral) minimising the sum of squared perpendicular offsets of the road's points,
 *   with the tangents held fixed (clothoid geometry after Meyer & Gibson 1980; TAC 2017 §3.2;
 *   AASHTO 2018 §3.3.8).
 *
 * Every fit reports its RMS and largest residual. A radius whose standard error is a large share of
 * itself is flagged as poorly determined: a short arc measured with noise does not fix its radius.
 *
 * Pure: no DOM, terrain or network access.
 *
 * Written from a functional specification; no code from RFLTools (GPL-3.0) was used.
 */
import { corridorFrame } from './corridorOptimizer'
import { spiralTangent } from './engine'
import type { Coordinate, RoadPoint } from './types'

export type XY = [number, number]

export interface CircleFit {
  centre: XY
  radiusM: number
  rmsM: number
  maxResidualM: number
  /** Standard error of the radius, m; null with three points (no redundancy) or a singular fit. */
  radiusSigmaM: number | null
}

/** A radius whose standard error is more than this share of itself is poorly determined. */
export const POORLY_DETERMINED_SHARE = 0.1
/** Most points one geometry fit reads; a denser line is resampled. */
export const MAX_FIT_POINTS = 4000
/** The road is resampled at this spacing so the fits weigh length, not vertex density. */
export const FIT_SAMPLE_M = 2
/** Tangent tolerance and shortest tangent the fit accepts. */
export const FIT_TOLERANCE_LIMITS = [0.05, 20] as const
export const FIT_MIN_TANGENT_LIMITS = [5, 1000] as const
/** A corner turning less than this is read as straight. */
export const MIN_FITTED_DEFLECTION_DEG = 0.5
/** Radii a fitted curve may take, m. */
export const FIT_RADIUS_RANGE_M: readonly [number, number] = [5, 10000]

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0]
const norm = (a: XY) => Math.hypot(a[0], a[1])

function residuals(points: readonly XY[], centre: XY, radius: number) {
  let sum = 0,
    max = 0
  for (const p of points) {
    const r = Math.hypot(p[0] - centre[0], p[1] - centre[1]) - radius
    sum += r * r
    max = Math.max(max, Math.abs(r))
  }
  return { sum, max }
}

/**
 * Kåsa's algebraic circle: with u, v the points about their centroid, solve
 * [Σu² Σuv; Σuv Σv²]·(uc, vc) = ½(Σu³ + Σuv², Σv³ + Σu²v), then R² = uc² + vc² + (Σu² + Σv²)/n.
 * Minimises Σ(dᵢ² − R²)². Null for fewer than three points or points on a line.
 */
export function kasaCircle(points: readonly XY[]): CircleFit | null {
  const n = points.length
  if (n < 3) return null
  let mx = 0,
    my = 0
  for (const p of points) {
    mx += p[0] / n
    my += p[1] / n
  }
  let suu = 0,
    svv = 0,
    suv = 0,
    suuu = 0,
    svvv = 0,
    suvv = 0,
    svuu = 0
  for (const p of points) {
    const u = p[0] - mx,
      v = p[1] - my
    suu += u * u
    svv += v * v
    suv += u * v
    suuu += u * u * u
    svvv += v * v * v
    suvv += u * v * v
    svuu += v * u * u
  }
  const det = suu * svv - suv * suv
  // Collinear points: the normal matrix is singular relative to its own scale.
  if (!(Math.abs(det) > 1e-12 * Math.max(1, suu * svv))) return null
  const bu = (suuu + suvv) / 2,
    bv = (svvv + svuu) / 2
  const uc = (bu * svv - bv * suv) / det,
    vc = (suu * bv - suv * bu) / det
  const centre: XY = [mx + uc, my + vc]
  const radiusM = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n)
  const { sum, max } = residuals(points, centre, radiusM)
  return { centre, radiusM, rmsM: Math.sqrt(sum / n), maxResidualM: max, radiusSigmaM: null }
}

/** Inverse of a symmetric 3×3 matrix, or null when singular. */
function inverse3(m: number[][]): number[][] | null {
  const [[a, b, c], [d, e, f], [g, h, i]] = m
  const A = e * i - f * h,
    B = -(d * i - f * g),
    C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!(Math.abs(det) > 1e-300)) return null
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ]
}

/**
 * The geometric circle: centre and radius minimising Σ(|pᵢ − c| − R)², by Levenberg–Marquardt from
 * the Kåsa circle. Null when no circle fits (fewer than three points, or a straight line).
 */
export function geometricCircle(points: readonly XY[], start: CircleFit | null = kasaCircle(points)): CircleFit | null {
  if (!start) return null
  const n = points.length
  let [a, b] = start.centre,
    r = start.radiusM
  let cost = residuals(points, [a, b], r).sum
  let lambda = 1e-3
  for (let iteration = 0; iteration < 200; iteration++) {
    // Normal equations JᵀJ δ = −Jᵀe with e = d − R and J = [−(x−a)/d, −(y−b)/d, −1].
    const jtj = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    const jte = [0, 0, 0]
    for (const p of points) {
      const dx = p[0] - a,
        dy = p[1] - b,
        d = Math.hypot(dx, dy) || 1e-12
      const row = [-dx / d, -dy / d, -1],
        e = d - r
      for (let i = 0; i < 3; i++) {
        jte[i] += row[i] * e
        for (let j = 0; j < 3; j++) jtj[i][j] += row[i] * row[j]
      }
    }
    let improved = false
    for (let attempt = 0; attempt < 20 && !improved; attempt++) {
      const damped = jtj.map((row, i) => row.map((value, j) => (i === j ? value * (1 + lambda) : value)))
      const inv = inverse3(damped)
      if (!inv) break
      const step = inv.map((row) => -(row[0] * jte[0] + row[1] * jte[1] + row[2] * jte[2]))
      const next = residuals(points, [a + step[0], b + step[1]], r + step[2]).sum
      if (next <= cost) {
        a += step[0]
        b += step[1]
        r += step[2]
        const change = Math.hypot(step[0], step[1], step[2])
        const settled = cost - next <= 1e-15 * Math.max(1, cost) || change < 1e-10 * Math.max(1, r)
        cost = next
        lambda = Math.max(1e-12, lambda / 10)
        improved = true
        if (settled) iteration = 200
      } else lambda *= 10
    }
    if (!improved) break
  }
  if (!(r > 0) || !Number.isFinite(r)) return null
  const { sum, max } = residuals(points, [a, b], r)
  let radiusSigmaM: number | null = null
  if (n > 3) {
    const jtj = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]
    for (const p of points) {
      const dx = p[0] - a,
        dy = p[1] - b,
        d = Math.hypot(dx, dy) || 1e-12
      const row = [-dx / d, -dy / d, -1]
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) jtj[i][j] += row[i] * row[j]
    }
    const inv = inverse3(jtj)
    if (inv && inv[2][2] >= 0) radiusSigmaM = Math.sqrt((sum / (n - 3)) * inv[2][2])
  }
  return { centre: [a, b], radiusM: r, rmsM: Math.sqrt(sum / n), maxResidualM: max, radiusSigmaM }
}

export interface LineFit {
  centroid: XY
  /** Unit direction, pointing from the first point toward the last. */
  direction: XY
  rmsM: number
  maxResidualM: number
}

/** The total-least-squares line through the points: the principal axis of their scatter. */
export function fitLine(points: readonly XY[]): LineFit | null {
  const n = points.length
  if (n < 2) return null
  let mx = 0,
    my = 0
  for (const p of points) {
    mx += p[0] / n
    my += p[1] / n
  }
  let sxx = 0,
    syy = 0,
    sxy = 0
  for (const p of points) {
    sxx += (p[0] - mx) ** 2
    syy += (p[1] - my) ** 2
    sxy += (p[0] - mx) * (p[1] - my)
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  let direction: XY = [Math.cos(angle), Math.sin(angle)]
  if (dot(direction, sub(points[n - 1], points[0])) < 0) direction = [-direction[0], -direction[1]]
  let sum = 0,
    max = 0
  for (const p of points) {
    const e = cross(direction, sub(p, [mx, my]))
    sum += e * e
    max = Math.max(max, Math.abs(e))
  }
  return { centroid: [mx, my], direction, rmsM: Math.sqrt(sum / n), maxResidualM: max }
}

export interface FittedTangent extends LineFit {
  /** First and last resampled point index the tangent covers. */
  from: number
  to: number
  lengthM: number
}

/**
 * Straight runs of a line: grow a fitted line one point at a time from each seed while its largest
 * residual stays within `toleranceM`, keep the longest, and repeat on what is left either side.
 * Runs shorter than `minLengthM` are not tangents; the gaps between tangents are where bends go.
 */
export function findTangents(
  points: readonly XY[],
  options: { toleranceM: number; minLengthM: number },
): FittedTangent[] {
  const found: FittedTangent[] = []
  const span = (from: number, to: number) => norm(sub(points[to], points[from]))
  const grow = (seed: number, lo: number, hi: number) => {
    let from = seed,
      to = Math.min(hi, seed + 1)
    if (to === from) return null
    let fit = fitLine(points.slice(from, to + 1))!
    for (;;) {
      // Add whichever neighbour keeps the line tighter.
      const moves: [number, number][] = []
      if (from > lo) moves.push([from - 1, to])
      if (to < hi) moves.push([from, to + 1])
      let best: { from: number; to: number; fit: LineFit } | null = null
      for (const [f, t] of moves) {
        const next = fitLine(points.slice(f, t + 1))!
        if (next.maxResidualM <= options.toleranceM && (!best || next.maxResidualM < best.fit.maxResidualM))
          best = { from: f, to: t, fit: next }
      }
      if (!best) break
      from = best.from
      to = best.to
      fit = best.fit
    }
    return { ...fit, from, to, lengthM: span(from, to) }
  }
  const work: [number, number][] = [[0, points.length - 1]]
  while (work.length) {
    const [lo, hi] = work.pop()!
    if (hi - lo < 1 || span(lo, hi) < options.minLengthM) continue
    // Seeds every few points; the longest grown line wins.
    const stride = Math.max(1, Math.floor((hi - lo) / 40))
    let best: FittedTangent | null = null
    for (let seed = lo; seed < hi; seed += stride) {
      const tangent = grow(seed, lo, hi)
      if (tangent && (!best || tangent.lengthM > best.lengthM)) best = tangent
    }
    if (!best || best.lengthM < options.minLengthM) continue
    found.push(best)
    work.push([lo, best.from - 1], [best.to + 1, hi])
  }
  return found.sort((a, b) => a.from - b.from)
}

/** Where two lines meet, as distances along each from its centroid; null when parallel. */
function intersect(a: LineFit, b: LineFit): XY | null {
  const denominator = cross(a.direction, b.direction)
  if (Math.abs(denominator) < 1e-9) return null
  const t = cross(sub(b.centroid, a.centroid), b.direction) / denominator
  return [a.centroid[0] + a.direction[0] * t, a.centroid[1] + a.direction[1] * t]
}

/** Closely sampled tangent–spiral–arc–spiral–tangent through a PI, for distances to it. */
function cornerPolyline(pi: XY, inDir: XY, deflection: number, radius: number, spiral: number, reach: number) {
  const side = Math.sign(deflection),
    turn = Math.abs(deflection)
  const tangent = spiralTangent(radius, turn, spiral).trim
  const start: XY = [pi[0] - inDir[0] * tangent, pi[1] - inDir[1] * tangent]
  const line: XY[] = [[start[0] - inDir[0] * reach, start[1] - inDir[1] * reach], start]
  const psi0 = Math.atan2(inDir[1], inDir[0])
  const arc = radius * (turn - spiral / radius)
  const total = 2 * spiral + arc
  // Heading along the curve: the clothoid's curvature rises linearly over each spiral.
  const heading = (s: number) => {
    if (spiral > 0 && s <= spiral) return psi0 + (side * s * s) / (2 * radius * spiral)
    if (s <= spiral + arc || !(spiral > 0)) return psi0 + side * (spiral / (2 * radius) + (s - spiral) / radius)
    const u = total - s
    return psi0 + side * (turn - (u * u) / (2 * radius * spiral))
  }
  const steps = Math.max(8, Math.ceil(total / 0.5))
  let [x, y] = start
  for (let k = 0; k < steps; k++) {
    const mid = heading(((k + 0.5) * total) / steps)
    x += (Math.cos(mid) * total) / steps
    y += (Math.sin(mid) * total) / steps
    line.push([x, y])
  }
  const outDir: XY = [Math.cos(psi0 + deflection), Math.sin(psi0 + deflection)]
  line.push([x + outDir[0] * reach, y + outDir[1] * reach])
  return line
}

function distanceToPolyline(p: XY, line: readonly XY[]) {
  let best = Infinity
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      ab = sub(line[i], a),
      length2 = dot(ab, ab)
    const t = length2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / length2)) : 0
    best = Math.min(best, Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t))
  }
  return best
}

/** Distance from a point to a simple curve tangent to both lines: the nearer of the two rays and the arc. */
function simpleCornerDistance(p: XY, pi: XY, inDir: XY, outDir: XY, deflection: number, radius: number) {
  const tangent = radius * Math.tan(Math.abs(deflection) / 2)
  const tc: XY = [pi[0] - inDir[0] * tangent, pi[1] - inDir[1] * tangent],
    ct: XY = [pi[0] + outDir[0] * tangent, pi[1] + outDir[1] * tangent]
  const side = Math.sign(deflection)
  const centre: XY = [tc[0] - inDir[1] * radius * side, tc[1] + inDir[0] * radius * side]
  const before = dot(sub(p, tc), inDir),
    after = dot(sub(p, ct), outDir)
  let best = before <= 0 ? Math.abs(cross(inDir, sub(p, tc))) : norm(sub(p, tc))
  best = Math.min(best, after >= 0 ? Math.abs(cross(outDir, sub(p, ct))) : norm(sub(p, ct)))
  // On the arc when the point lies within the arc's sweep as seen from the centre.
  const from = sub(tc, centre),
    to = sub(ct, centre),
    at = sub(p, centre)
  const sweep = Math.atan2(cross(from, to), dot(from, to)),
    angle = Math.atan2(cross(from, at), dot(from, at))
  if (sweep * angle >= 0 && Math.abs(angle) <= Math.abs(sweep)) best = Math.min(best, Math.abs(norm(at) - radius))
  return best
}

/** Golden-section minimum of f on [lo, hi] in log space, after a coarse scan to find the right basin. */
function minimiseLog(f: (x: number) => number, lo: number, hi: number) {
  const scan = 48
  let bestK = 0,
    bestValue = Infinity
  const at = (k: number) => lo * (hi / lo) ** (k / scan)
  for (let k = 0; k <= scan; k++) {
    const value = f(at(k))
    if (value < bestValue) {
      bestValue = value
      bestK = k
    }
  }
  let a = Math.log(at(Math.max(0, bestK - 1))),
    b = Math.log(at(Math.min(scan, bestK + 1)))
  const g = (Math.sqrt(5) - 1) / 2
  let c = b - g * (b - a),
    d = a + g * (b - a)
  let fc = f(Math.exp(c)),
    fd = f(Math.exp(d))
  for (let i = 0; i < 80 && b - a > 1e-10; i++) {
    if (fc < fd) {
      b = d
      d = c
      fd = fc
      c = b - g * (b - a)
      fc = f(Math.exp(c))
    } else {
      a = c
      c = d
      fc = fd
      d = a + g * (b - a)
      fd = f(Math.exp(d))
    }
  }
  const x = Math.exp((a + b) / 2)
  return { x, value: f(x) }
}

export interface FittedCorner {
  pi: XY
  /** Signed deflection, radians; positive turns left. */
  deflection: number
  radiusM: number
  /** Spiral length each side, m; 0 for a simple curve. */
  spiralM: number
  /** Tangent length from the PI to the TC (TS), m. */
  tangentM: number
  rmsM: number
  maxResidualM: number
  points: number
  /** Standard error of the radius from the fit's curvature, m; null when it cannot be estimated. */
  radiusSigmaM: number | null
  poorlyDetermined: boolean
}

/**
 * The curve between two fixed tangents that best follows the points between them: the radius (and
 * with `spirals`, a symmetric spiral length) minimising Σ offset². `maxTangentM` bounds the curve to
 * the room the tangents leave. Null when the tangents do not meet ahead of both.
 */
export function fitCorner(
  before: LineFit,
  after: LineFit,
  points: readonly XY[],
  options: { spirals?: boolean; maxTangentM?: number; minRadiusM?: number } = {},
): FittedCorner | null {
  const pi = intersect(before, after)
  if (!pi || points.length < 3) return null
  const inDir = before.direction,
    outDir = after.direction
  const deflection = Math.atan2(cross(inDir, outDir), dot(inDir, outDir))
  if (Math.abs(deflection) < (MIN_FITTED_DEFLECTION_DEG * Math.PI) / 180 || Math.abs(deflection) > Math.PI - 1e-3)
    return null
  const half = Math.tan(Math.abs(deflection) / 2)
  const maxTangent = options.maxTangentM ?? Infinity
  const lo = Math.max(FIT_RADIUS_RANGE_M[0], options.minRadiusM ?? 0)
  const hi = Math.min(FIT_RADIUS_RANGE_M[1], maxTangent / half)
  if (!(hi > lo)) return null
  const simple = (radius: number) =>
    points.reduce((sum, p) => sum + simpleCornerDistance(p, pi, inDir, outDir, deflection, radius) ** 2, 0)
  const simpleFit = minimiseLog(simple, lo, hi)
  let best = { radiusM: simpleFit.x, spiralM: 0, value: simpleFit.value }
  if (options.spirals) {
    // Pattern search over (R, Ls) from the simple curve, moving either way on both, halving the step.
    const reach = 1000
    const cost = (radius: number, spiral: number) => {
      if (!(radius >= lo && radius <= hi) || spiral < 0 || spiral / radius >= Math.abs(deflection) - 1e-6)
        return Infinity
      if (spiralTangent(radius, Math.abs(deflection), spiral).trim > maxTangent) return Infinity
      const line = cornerPolyline(pi, inDir, deflection, radius, spiral, reach)
      return points.reduce((sum, p) => sum + distanceToPolyline(p, line) ** 2, 0)
    }
    let radius = best.radiusM,
      spiral = 0,
      value = cost(radius, spiral)
    let step = Math.max(1, radius * 0.25)
    while (step > 1e-3) {
      let moved = false
      for (const [dr, ds] of [
        [step, 0],
        [-step, 0],
        [0, step],
        [0, -step],
        [step, step],
        [-step, -step],
        [step, -step],
        [-step, step],
      ]) {
        const next = cost(radius + dr, spiral + ds)
        if (next < value - 1e-12) {
          radius += dr
          spiral += ds
          value = next
          moved = true
          break
        }
      }
      if (!moved) step /= 2
    }
    if (spiral > 1e-3 && value < best.value) best = { radiusM: radius, spiralM: spiral, value }
  }
  const { radiusM, spiralM } = best
  const distanceOf = (p: XY) =>
    spiralM > 0
      ? distanceToPolyline(p, cornerPolyline(pi, inDir, deflection, radiusM, spiralM, 1000))
      : simpleCornerDistance(p, pi, inDir, outDir, deflection, radiusM)
  let sum = 0,
    max = 0
  for (const p of points) {
    const d = distanceOf(p)
    sum += d * d
    max = Math.max(max, d)
  }
  // σ_R² ≈ 2σ²/f''(R) for one parameter, with σ² the residual variance and f the sum of squares.
  let radiusSigmaM: number | null = null
  const h = Math.max(1e-3, radiusM * 1e-3)
  if (radiusM - h > lo && radiusM + h < hi && points.length > 1) {
    const second = (simple(radiusM + h) - 2 * simple(radiusM) + simple(radiusM - h)) / (h * h)
    if (second > 0) radiusSigmaM = Math.sqrt((2 * (sum / Math.max(1, points.length - 1))) / second)
  }
  return {
    pi,
    deflection,
    radiusM,
    spiralM,
    tangentM: spiralTangent(radiusM, Math.abs(deflection), spiralM).trim,
    rmsM: Math.sqrt(sum / points.length),
    maxResidualM: max,
    points: points.length,
    radiusSigmaM,
    poorlyDetermined: radiusSigmaM === null || radiusSigmaM > POORLY_DETERMINED_SHARE * radiusM,
  }
}

export interface RoadGeometryFitOptions {
  /** Largest residual a tangent may have, m. */
  toleranceM: number
  /** Shortest straight run read as a tangent, m. */
  minTangentM: number
  /** Fit a symmetric spiral each side of every curve. */
  spirals: boolean
  /** Smallest radius a fitted curve may take, m. */
  minRadiusM?: number
}

export interface RoadGeometryBend {
  /** Chainage along the source line of the bend's middle, m. */
  chainage: number
  status: 'fitted' | 'not-fitted'
  /** Why a bend was not fitted. */
  reason?: string
  corner?: FittedCorner
  /** The free circle through the bend's points, for comparison. */
  circle?: CircleFit | null
}

export interface RoadGeometryFit {
  tangents: (FittedTangent & { startChainage: number; endChainage: number })[]
  bends: RoadGeometryBend[]
  /** Intersection points with radii and spirals, start and end included, ready to adopt. */
  points: Pick<RoadPoint, 'coordinate' | 'radiusM' | 'spiralM'>[]
  /** Largest distance from the source line's samples to the fitted centreline, m. */
  maxDeviationM: number
  sourceLengthM: number
}

/** Resamples a polyline every `step` (and keeps its ends), returning the samples and their chainages. */
function resample(line: readonly XY[], step: number) {
  const out: XY[] = [line[0]],
    chainages = [0]
  let total = 0
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1],
      b = line[i],
      length = norm(sub(b, a))
    const count = Math.max(1, Math.round(length / step))
    for (let k = 1; k <= count; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / count, a[1] + ((b[1] - a[1]) * k) / count])
      chainages.push(total + (length * k) / count)
    }
    total += length
  }
  return { points: out, chainages, length: total }
}

/**
 * Tangents and curves of a mapped or traced road by least squares. Bends whose tangents do not meet
 * ahead of both, or which leave no room for a curve, are reported and kept as the source's own
 * vertices rather than forced.
 */
export function fitRoadGeometry(coordinates: readonly Coordinate[], options: RoadGeometryFitOptions): RoadGeometryFit {
  const [tolLo, tolHi] = FIT_TOLERANCE_LIMITS,
    [minLo, minHi] = FIT_MIN_TANGENT_LIMITS
  if (!(options.toleranceM >= tolLo && options.toleranceM <= tolHi))
    throw Error(`Use a tangent tolerance of ${tolLo}–${tolHi} m.`)
  if (!(options.minTangentM >= minLo && options.minTangentM <= minHi))
    throw Error(`Use a shortest tangent of ${minLo}–${minHi} m.`)
  if (coordinates.length < 2) throw Error('A line needs at least two points.')
  const frame = corridorFrame(coordinates[0])
  const source = coordinates.map((c) => frame.toXY(c) as XY)
  const lengthM = source.slice(1).reduce((sum, p, i) => sum + norm(sub(p, source[i])), 0)
  const step = Math.max(FIT_SAMPLE_M, lengthM / MAX_FIT_POINTS)
  const { points, chainages } = resample(source, step)
  const tangents = findTangents(points, { toleranceM: options.toleranceM, minLengthM: options.minTangentM })
  const bends: RoadGeometryBend[] = []
  const ips: { xy: XY; radiusM: number; spiralM: number }[] = []
  const first = tangents[0],
    last = tangents[tangents.length - 1]
  // The road's ends, moved onto their tangents when they lie on them.
  const onto = (p: XY, line: LineFit | undefined): XY => {
    if (!line) return p
    const along = dot(sub(p, line.centroid), line.direction)
    const foot: XY = [line.centroid[0] + line.direction[0] * along, line.centroid[1] + line.direction[1] * along]
    return norm(sub(foot, p)) <= options.toleranceM ? foot : p
  }
  ips.push({ xy: onto(points[0], first?.from === 0 ? first : undefined), radiusM: 0, spiralM: 0 })
  const leadIn = first && first.from > 0 ? points.slice(0, first.from + 1) : []
  if (leadIn.length) {
    bends.push({
      chainage: chainages[Math.floor(first.from / 2)],
      status: 'not-fitted',
      reason: 'The road starts in a bend: no tangent before it',
      circle: geometricCircle(leadIn),
    })
    for (const p of douglasPeucker(leadIn, options.toleranceM).slice(1, -1)) ips.push({ xy: p, radiusM: 0, spiralM: 0 })
    ips.push({ xy: onto(points[first.from], first), radiusM: 0, spiralM: 0 })
  }
  for (let k = 0; k + 1 < tangents.length; k++) {
    const a = tangents[k],
      b = tangents[k + 1]
    // Points from the middle of one tangent to the middle of the next: the bend and the tangent
    // points that pin where it may start and end.
    const lo = Math.floor((a.from + a.to) / 2),
      hi = Math.ceil((b.from + b.to) / 2)
    const around = points.slice(lo, hi + 1)
    const between = points.slice(a.to, b.from + 1)
    const middle = chainages[Math.round((a.to + b.from) / 2)]
    const pi = intersect(a, b)
    // Room for the curve: from the PI back to the middle of the previous tangent and on to the next.
    const roomBack = pi ? dot(sub(pi, points[lo]), a.direction) : -1
    const roomAhead = pi ? dot(sub(points[hi], pi), b.direction) : -1
    const corner =
      pi && roomBack > 0 && roomAhead > 0
        ? fitCorner(a, b, around, {
            spirals: options.spirals,
            maxTangentM: Math.min(roomBack, roomAhead),
            minRadiusM: options.minRadiusM,
          })
        : null
    const circle = between.length >= 3 ? geometricCircle(between) : null
    if (corner) {
      bends.push({ chainage: middle, status: 'fitted', corner, circle })
      ips.push({ xy: corner.pi, radiusM: corner.radiusM, spiralM: corner.spiralM })
    } else {
      bends.push({
        chainage: middle,
        status: 'not-fitted',
        reason: !pi
          ? 'The tangents are parallel: a reverse bend with no tangent between its curves'
          : roomBack <= 0 || roomAhead <= 0
            ? 'The tangents meet behind one of them'
            : 'No curve fits between these tangents',
        circle,
      })
      for (const p of douglasPeucker(between, options.toleranceM)) ips.push({ xy: p, radiusM: 0, spiralM: 0 })
    }
  }
  const tail = last && last.to < points.length - 1 ? points.slice(last.to) : []
  if (tail.length) {
    bends.push({
      chainage: chainages[Math.floor((last.to + points.length - 1) / 2)],
      status: 'not-fitted',
      reason: 'The road ends in a bend: no tangent after it',
      circle: geometricCircle(tail),
    })
    ips.push({ xy: onto(points[last.to], last), radiusM: 0, spiralM: 0 })
    for (const p of douglasPeucker(tail, options.toleranceM).slice(1, -1)) ips.push({ xy: p, radiusM: 0, spiralM: 0 })
  }
  ips.push({
    xy: onto(points[points.length - 1], last?.to === points.length - 1 ? last : undefined),
    radiusM: 0,
    spiralM: 0,
  })
  // Neighbouring vertices closer than a centimetre are one point.
  const kept = ips.filter((p, i) => i === 0 || norm(sub(p.xy, ips[i - 1].xy)) > 0.01)
  const fitted = fittedCentreline(kept)
  let maxDeviationM = 0
  for (const p of points) maxDeviationM = Math.max(maxDeviationM, distanceToPolyline(p, fitted))
  return {
    tangents: tangents.map((t) => ({ ...t, startChainage: chainages[t.from], endChainage: chainages[t.to] })),
    bends,
    points: kept.map((p, i) => ({
      coordinate:
        i === 0
          ? ([...coordinates[0]] as Coordinate)
          : i === kept.length - 1
            ? ([...coordinates[coordinates.length - 1]] as Coordinate)
            : frame.fromXY(p.xy),
      radiusM: Math.round(p.radiusM * 10) / 10,
      ...(p.spiralM > 0 ? { spiralM: Math.round(p.spiralM * 10) / 10 } : {}),
    })),
    maxDeviationM,
    sourceLengthM: lengthM,
  }
}

/** The fitted alignment as a closely sampled line, for measuring how far it strays from the source. */
function fittedCentreline(ips: readonly { xy: XY; radiusM: number; spiralM: number }[]): XY[] {
  const line: XY[] = [ips[0].xy]
  for (let i = 1; i < ips.length - 1; i++) {
    const inDir = sub(ips[i].xy, ips[i - 1].xy),
      outDir = sub(ips[i + 1].xy, ips[i].xy)
    const a = norm(inDir),
      b = norm(outDir)
    if (!(ips[i].radiusM > 0) || a === 0 || b === 0) {
      line.push(ips[i].xy)
      continue
    }
    const u: XY = [inDir[0] / a, inDir[1] / a],
      v: XY = [outDir[0] / b, outDir[1] / b]
    const deflection = Math.atan2(cross(u, v), dot(u, v))
    const corner = cornerPolyline(ips[i].xy, u, deflection, ips[i].radiusM, ips[i].spiralM, 0)
    line.push(...corner.slice(1, -1))
  }
  line.push(ips[ips.length - 1].xy)
  return line
}

/** Douglas–Peucker reduction of a short run to the vertices within `tolerance` of it. */
function douglasPeucker(line: readonly XY[], tolerance: number): XY[] {
  if (line.length <= 2) return [...line]
  const keep = new Uint8Array(line.length)
  keep[0] = keep[line.length - 1] = 1
  const stack: [number, number][] = [[0, line.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    let worst = -1,
      far = tolerance
    const ab = sub(line[b], line[a]),
      length = norm(ab) || 1
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(cross(ab, sub(line[i], line[a]))) / length
      if (d > far) {
        far = d
        worst = i
      }
    }
    if (worst < 0) continue
    keep[worst] = 1
    stack.push([a, worst], [worst, b])
  }
  return line.filter((_, i) => keep[i])
}
