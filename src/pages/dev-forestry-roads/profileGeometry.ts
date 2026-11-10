/**
 * Geometry read from a road's own surface: the crossfall of an existing road at its edges, the
 * least-squares vertical curves (K) of its profile, and whether a long low vehicle (a lowbed, or a
 * rigid long load) clears its crests and sags.
 *
 * Implements:
 * - crossfall from the ground at entered edge offsets, as one plane across or a crown with separate
 *   sides; negative falls away from the centre. Smoothed by a least-squares quadratic in station over
 *   a window of N stations centred on each one, leaving missing samples out of the fit;
 * - the ordinary least-squares parabola z = a·s² + b·s + c through a run of profile points, giving
 *   the grades at its ends, A = 100·(g₂ − g₁), K = L/|A|, and the BVC–PVI–EVC of the symmetric curve
 *   (AASHTO 2018 §3.4.6; TAC 2017 ch. 3), and K along the road from that fit over a moving window;
 * - vehicle clearance on a profile by plain geometry: a rigid underside between two axles standing on
 *   the road hangs up where the road rises above the line joining the axles raised by the underside
 *   clearance; an overhang past an axle scrapes where the road rises above that line extended. On a
 *   parabolic crest of rate r = A/L per metre the first is the textbook W²·r/8 > c.
 *
 * Missing elevation is reported as unknown, never as clear.
 *
 * Pure: no DOM, terrain or network access.
 *
 * Written from a functional specification (RFLTools §4.8, §6.2, §10); no code from RFLTools
 * (GPL-3.0) was used.
 */
import { sectionSampleAt } from './sectionGeometry'
import type { RoadStation } from './types'

const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)

// ---- Crossfall ----------------------------------------------------------------------------------

export interface CrossfallOptions {
  /** Left edge offset, m (negative). */
  leftOffsetM: number
  /** Right edge offset, m (positive). */
  rightOffsetM: number
  /** Crown offset, m; null reads one plane across from edge to edge. */
  centreOffsetM: number | null
  /** Stations in the smoothing window; odd, 1 for none. */
  window: number
}
export const DEFAULT_CROSSFALL: CrossfallOptions = { leftOffsetM: -3, rightOffsetM: 3, centreOffsetM: 0, window: 9 }
export const MAX_CROSSFALL_WINDOW = 51

export interface StationCrossfall {
  chainage: number
  /** Percent; negative falls away from the centre. Null where the ground is missing. */
  leftPercent: number | null
  rightPercent: number | null
}

/** Least-squares quadratic through (x, y) pairs, evaluated at x0; the mean for one point, a line for two. */
function quadraticAt(points: readonly [number, number][], x0: number): number | null {
  const n = points.length
  if (!n) return null
  if (n === 1) return points[0][1]
  // Centre on x0 so the fitted value is the constant term.
  const degree = n === 2 ? 1 : 2
  const size = degree + 1
  const m = Array.from({ length: size }, () => new Array<number>(size + 1).fill(0))
  for (const [x, y] of points) {
    const u = x - x0
    const powers = [1, u, u * u]
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size; j++) m[i][j] += powers[i] * powers[j]
      m[i][size] += powers[i] * y
    }
  }
  // Gaussian elimination with partial pivoting.
  for (let col = 0; col < size; col++) {
    let pivot = col
    for (let row = col + 1; row < size; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    if (Math.abs(m[pivot][col]) < 1e-12) return points.reduce((sum, p) => sum + p[1], 0) / n
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let row = 0; row < size; row++) {
      if (row === col) continue
      const factor = m[row][col] / m[col][col]
      for (let k = col; k <= size; k++) m[row][k] -= factor * m[col][k]
    }
  }
  return m[0][size] / m[0][0]
}

/** Crossfall at every station from the ground at the edges (and crown), smoothed along the road. */
export function existingCrossfall(stations: readonly RoadStation[], options: CrossfallOptions): StationCrossfall[] {
  const { leftOffsetM: lo, rightOffsetM: ro, centreOffsetM: co } = options
  if (!(lo < 0 && ro > 0) || (co !== null && !(co > lo && co < ro)))
    throw Error('Crossfall needs a left edge left of the crown and a right edge right of it.')
  const window = Math.max(1, Math.min(MAX_CROSSFALL_WINDOW, Math.round(options.window)))
  if (window % 2 === 0) throw Error('The smoothing window is an odd number of stations.')
  const ground = (s: RoadStation, offset: number) => sectionSampleAt(s, offset).ground
  const raw = stations.map((s) => {
    const zl = ground(s, lo),
      zr = ground(s, ro)
    if (co === null) {
      if (!finite(zl) || !finite(zr)) return { left: null, right: null }
      const left = (-100 * (zr - zl)) / (ro - lo)
      return { left, right: -left }
    }
    const zc = ground(s, co)
    return {
      left: finite(zl) && finite(zc) ? (-100 * (zc - zl)) / (co - lo) : null,
      right: finite(zr) && finite(zc) ? (100 * (zr - zc)) / (ro - co) : null,
    }
  })
  const half = (window - 1) / 2
  return stations.map((s, i) => {
    const smooth = (key: 'left' | 'right') => {
      const points: [number, number][] = []
      for (let j = Math.max(0, i - half); j <= Math.min(stations.length - 1, i + half); j++) {
        const value = raw[j][key]
        if (finite(value)) points.push([stations[j].chainage, value])
      }
      // Without the station's own sample the fit would fill a gap: keep it unknown.
      return finite(raw[i][key]) ? quadraticAt(points, s.chainage) : null
    }
    return { chainage: s.chainage, leftPercent: smooth('left'), rightPercent: smooth('right') }
  })
}

// ---- Vertical curves ----------------------------------------------------------------------------

export interface VerticalCurveFit {
  /** z = a·s² + b·s + c with s measured from the first point's station. */
  a: number
  b: number
  c: number
  /** Grades at the ends, percent. */
  g1Percent: number
  g2Percent: number
  /** Algebraic grade change, percent; negative is a crest. */
  gradeChangePercent: number
  /** Length per percent of grade change; Infinity on a straight grade. */
  k: number
  lengthM: number
  bvc: [number, number]
  pvi: [number, number]
  evc: [number, number]
  maxResidualM: number
}

/** The least-squares parabola through profile points (station, elevation): BESTVCURVE-style. */
export function fitVerticalCurve(points: readonly [number, number][]): VerticalCurveFit | null {
  const clean = points.filter(([s, z]) => Number.isFinite(s) && Number.isFinite(z))
  if (clean.length < 3) return null
  const s0 = clean[0][0]
  const sum = [0, 0, 0, 0, 0],
    moments = [0, 0, 0]
  for (const [s, z] of clean) {
    const u = s - s0
    let p = 1
    for (let k = 0; k < 5; k++) {
      sum[k] += p
      if (k < 3) moments[k] += p * z
      p *= u
    }
  }
  // Normal equations for (c, b, a).
  const m = [
    [sum[0], sum[1], sum[2], moments[0]],
    [sum[1], sum[2], sum[3], moments[1]],
    [sum[2], sum[3], sum[4], moments[2]],
  ]
  for (let col = 0; col < 3; col++) {
    let pivot = col
    for (let row = col + 1; row < 3; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row
    if (Math.abs(m[pivot][col]) < 1e-12) return null
    ;[m[col], m[pivot]] = [m[pivot], m[col]]
    for (let row = 0; row < 3; row++) {
      if (row === col) continue
      const factor = m[row][col] / m[col][col]
      for (let k = col; k < 4; k++) m[row][k] -= factor * m[col][k]
    }
  }
  const [c, b, a] = [0, 1, 2].map((i) => m[i][3] / m[i][i])
  const lengthM = clean[clean.length - 1][0] - s0
  if (!(lengthM > 0)) return null
  const g1 = b,
    g2 = 2 * a * lengthM + b
  const change = 100 * (g2 - g1)
  const zAt = (u: number) => a * u * u + b * u + c
  let maxResidualM = 0
  for (const [s, z] of clean) maxResidualM = Math.max(maxResidualM, Math.abs(z - zAt(s - s0)))
  return {
    a,
    b,
    c,
    g1Percent: 100 * g1,
    g2Percent: 100 * g2,
    gradeChangePercent: change,
    k: Math.abs(change) > 1e-9 ? lengthM / Math.abs(change) : Infinity,
    lengthM,
    bvc: [s0, c],
    // The PVI of the symmetric curve: mid-station, on the BVC tangent extended.
    pvi: [s0 + lengthM / 2, c + (b * lengthM) / 2],
    evc: [s0 + lengthM, zAt(lengthM)],
    maxResidualM,
  }
}

export interface ProfileK {
  chainage: number
  /** Null where the window has missing elevation. */
  k: number | null
  kind: 'crest' | 'sag' | 'straight' | null
}

/**
 * K along a profile from a least-squares parabola over `windowM` centred on each station. Read as the
 * existing road's vertical curvature: the smallest K over a crest or a sag is its tightest curve.
 * A grade change under `straightPercent` over the window is straight.
 */
export function profileK(
  points: readonly { chainage: number; elevation: number | null }[],
  windowM: number,
  straightPercent = 0.5,
): ProfileK[] {
  return points.map((p, i) => {
    const run: [number, number][] = []
    let missing = false
    for (let j = i; j >= 0 && points[j].chainage >= p.chainage - windowM / 2 - 1e-9; j--)
      if (finite(points[j].elevation)) run.unshift([points[j].chainage, points[j].elevation!])
      else missing = true
    for (let j = i + 1; j < points.length && points[j].chainage <= p.chainage + windowM / 2 + 1e-9; j++)
      if (finite(points[j].elevation)) run.push([points[j].chainage, points[j].elevation!])
      else missing = true
    const fit = missing ? null : fitVerticalCurve(run)
    if (!fit || fit.lengthM < windowM * 0.75) return { chainage: p.chainage, k: null, kind: null }
    const kind = Math.abs(fit.gradeChangePercent) < straightPercent ? 'straight' : fit.a < 0 ? 'crest' : 'sag'
    return { chainage: p.chainage, k: kind === 'straight' ? null : fit.k, kind }
  })
}

// ---- Vehicle clearance --------------------------------------------------------------------------

export interface LowVehicle {
  name: string
  /** Distance between the axle groups the underside spans, m. */
  wheelbaseM: number
  /** Underside clearance midway between them, above the line joining the tyre contacts, m. */
  clearanceM: number
  /** Body or deck past the front and rear axle groups, m. */
  frontOverhangM: number
  rearOverhangM: number
  /** Clearance of the overhang's end above the line joining the tyre contacts, m. */
  overhangClearanceM: number
}

/** Starting values for a lowbed: a 12 m deck between the gooseneck and the rear axles. Enter your own. */
export const LOWBED_EXAMPLE: LowVehicle = {
  name: 'Lowbed (example)',
  wheelbaseM: 12,
  clearanceM: 0.3,
  frontOverhangM: 0,
  rearOverhangM: 2,
  overhangClearanceM: 0.45,
}
export const VEHICLE_CLEARANCE_STEP_M = 0.5

export interface ClearanceResult {
  /** Positions of the rear axle where the underside or an overhang touches the road. */
  conflicts: { chainage: number; kind: 'hang-up' | 'front-overhang' | 'rear-overhang'; depthM: number }[]
  /** Rear-axle positions that could not be judged because elevation is missing under the vehicle. */
  unknownM: number
  checkedM: number
}

/**
 * Drives the vehicle along a profile every `stepM` (rear axle position) and reports where its
 * underside hangs up or an overhang scrapes. Chainage stands in for distance along the slope,
 * which on road grades differs by under 1 %.
 */
export function vehicleClearance(
  elevationAt: (chainage: number) => number | null,
  lengthM: number,
  vehicle: LowVehicle,
  stepM = VEHICLE_CLEARANCE_STEP_M,
): ClearanceResult {
  const { wheelbaseM: w, clearanceM: c, frontOverhangM: f, rearOverhangM: r, overhangClearanceM: oc } = vehicle
  if (!(w > 0) || !(c >= 0) || !(f >= 0) || !(r >= 0) || !(oc >= 0))
    throw Error('Enter a positive wheelbase and clearances of 0 or more.')
  const conflicts: ClearanceResult['conflicts'] = []
  let unknownM = 0,
    checkedM = 0
  const sample = Math.min(stepM, 0.5)
  for (let s = r; s + w + f <= lengthM + 1e-9; s += stepM) {
    const z1 = elevationAt(s),
      z2 = elevationAt(s + w)
    if (!finite(z1) || !finite(z2)) {
      unknownM += stepM
      continue
    }
    const line = (x: number) => z1 + ((z2 - z1) * (x - s)) / w
    let unknown = false,
      worst: ClearanceResult['conflicts'][number] | null = null
    const test = (x: number, allowance: number, kind: ClearanceResult['conflicts'][number]['kind']) => {
      const z = elevationAt(x)
      if (!finite(z)) {
        unknown = true
        return
      }
      const depth = z - (line(x) + allowance)
      if (depth > 1e-6 && (!worst || depth > worst.depthM)) worst = { chainage: s, kind, depthM: depth }
    }
    // Between the axles the underside is lowest at mid-wheelbase: a flat deck at clearance c.
    for (let x = s + sample; x < s + w - 1e-9; x += sample) test(x, c, 'hang-up')
    // Overhangs: the clearance grows from 0 at the axle to `oc` at the end.
    for (let x = s + w + sample; x <= s + w + f + 1e-9; x += sample) test(x, (oc * (x - s - w)) / f, 'front-overhang')
    for (let x = s - sample; x >= s - r - 1e-9; x -= sample) test(x, (oc * (s - x)) / r, 'rear-overhang')
    if (unknown && !worst) unknownM += stepM
    else checkedM += stepM
    if (worst) conflicts.push(worst)
  }
  return { conflicts, unknownM, checkedM }
}
