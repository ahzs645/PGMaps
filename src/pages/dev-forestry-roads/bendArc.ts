/**
 * Bending a leg into an arc (guide `plan-edit-limits.md`, **Bending a leg into an arc**).
 *
 * A + handle dragged off a leg adds one intersection point with a circular curve. `bendThrough`
 * places that point and chooses its radius so the fitted road passes through the place the handle
 * was dragged to: the point goes beyond the handle, on the corner's bisector, by the curve's
 * external distance E = R (sec(Δ/2) − 1), and the radius takes `BEND_TANGENT_SHARE` of the straight
 * the two new legs have left once the neighbouring curves have taken theirs. Dragged a little, the
 * leg becomes a long flat arc; dragged far, the arc tightens down to the minimum radius.
 *
 * `curveThrough` is the same reading for a curve that is already there: the radius whose arc passes
 * through a place on its corner's bisector, the points left where they are. `curveGrip` is where
 * the plan puts the handle that asks for it.
 *
 * Both return what the engine will fit: the result is checked with `horizontalCurveFits`. Pure: no
 * DOM, network or terrain access.
 */
import { horizontalCurveFits, MAX_HORIZONTAL_RADIUS_M, planFrame, spiralTangent } from './engine'
import type { Alignment, Coordinate, RoadPoint } from './types'

type XY = [number, number]

/**
 * The share of the shorter leg's free straight a new bend's tangent takes. The rest stays straight,
 * so the point can still be moved, and its neighbours bent, without the curve losing its fit.
 */
export const BEND_TANGENT_SHARE = 0.5
/** A tangent may use this share of what a leg has left, as in `horizontalTools.ts`, so the engine's own fit accepts it. */
const FIT = 0.98
/** Nearer the leg than this, a bend has no turn to round: the point is added as it was before. */
export const MIN_BEND_OFFSET_M = 0.05
/** How far the fitted arc may pass from the dragged place and still count as through it, m. */
export const BEND_THROUGH_TOLERANCE_M = 0.05
/** Radii are kept to this step, m, rounded down so the curve still fits. */
export const BEND_RADIUS_STEP_M = 0.1

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]]
const mul = (a: XY, k: number): XY => [a[0] * k, a[1] * k]
const norm = (a: XY) => Math.hypot(a[0], a[1])
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const angleBetween = (u: XY, v: XY) => Math.acos(clamp(dot(u, v), -1, 1))
// The second rounding takes off the binary tail a multiple of 0.1 carries, so a project file reads 137.4.
const roundedDown = (radius: number) =>
  Math.round(Math.floor(radius / BEND_RADIUS_STEP_M + 1e-9) * BEND_RADIUS_STEP_M * 1e6) / 1e6

const BEND_TRIAL_ID = 'bend-arc-trial'

export interface PlanBend {
  /** Where the new intersection point goes. */
  coordinate: Coordinate
  radiusM: number
  /** Whether the fitted curve passes through the place the handle was dragged to. */
  through: boolean
}

/** The tangent a neighbouring point's own curve takes from a leg leaving it in direction `out`. */
function neighbourTrim(point: RoadPoint, into: XY | null, out: XY, legM: number): number {
  if (!into || !(point.radiusM > 0)) return 0
  const turn = angleBetween(into, out)
  if (turn < 1e-5 || turn > Math.PI - 1e-4) return 0
  let spiral = Math.max(0, point.spiralM ?? 0)
  // The engine drops spirals that would turn the whole deflection.
  if (spiral > 0 && spiral / point.radiusM >= turn - 1e-6) spiral = 0
  const { trim } = spiralTangent(point.radiusM, turn, spiral)
  // A curve that no longer fits its leg is left sharp by the engine and takes nothing from it.
  return trim < legM ? trim : 0
}

/**
 * The point and radius a bend dragged to `cursor` adds after `afterId`. `minRadiusM` is the
 * project's minimum radius: the curve is never tighter. Where no curve through the place fits, the
 * point goes at the place itself with the minimum radius, as a bend always did, and the plan-edit
 * check judges it.
 */
export function bendThrough(alignment: Alignment, afterId: string, cursor: Coordinate, minRadiusM: number): PlanBend {
  const floor = Number.isFinite(minRadiusM) ? clamp(minRadiusM, 0, MAX_HORIZONTAL_RADIUS_M) : 0
  const plain: PlanBend = { coordinate: cursor, radiusM: floor, through: false }
  const points = alignment.points
  const index = points.findIndex((point) => point.id === afterId)
  if (index < 0 || index >= points.length - 1) return plain
  const frame = planFrame(points[0].coordinate)
  const start = frame.toXY(points[index].coordinate),
    end = frame.toXY(points[index + 1].coordinate),
    place = frame.toXY(cursor)
  const chord = norm(sub(end, start))
  if (!(chord > 1e-6)) return plain
  const across = sub(end, start),
    to = sub(place, start)
  if (Math.abs(across[0] * to[1] - across[1] * to[0]) / chord < MIN_BEND_OFFSET_M) return plain
  const unitTo = (from: XY, target: XY): XY | null => {
    const d = sub(target, from),
      size = norm(d)
    return size > 1e-9 ? mul(d, 1 / size) : null
  }
  const into = index > 0 ? unitTo(frame.toXY(points[index - 1].coordinate), start) : null
  const onward = index + 2 < points.length ? unitTo(end, frame.toXY(points[index + 2].coordinate)) : null

  /** The curve a point at `at` would carry: its radius, external distance and the way to its centre. */
  const cornerAt = (at: XY) => {
    const back = sub(at, start),
      ahead = sub(end, at)
    const backM = norm(back),
      aheadM = norm(ahead)
    if (backM < 1e-6 || aheadM < 1e-6) return null
    const u = mul(back, 1 / backM),
      v = mul(ahead, 1 / aheadM)
    const turn = angleBetween(u, v)
    if (turn < 1e-5 || turn > Math.PI - 1e-4) return null
    const free = Math.min(
      backM - neighbourTrim(points[index], into, u, backM),
      aheadM - (onward ? neighbourTrim(points[index + 1], v, onward, aheadM) : 0),
    )
    const half = Math.tan(turn / 2)
    const radius = clamp((BEND_TANGENT_SHARE * Math.max(0, free)) / half, floor, MAX_HORIZONTAL_RADIUS_M)
    const inward = sub(v, u),
      size = norm(inward)
    return {
      radius,
      fits: radius > 0 && radius * half <= FIT * free,
      external: radius * (1 / Math.cos(turn / 2) - 1),
      inward: mul(inward, 1 / size),
    }
  }

  // The point lies beyond the place, against the bisector, by the external distance of the curve it
  // would carry there. Solve that distance along the bisector, then turn the bisector to the point
  // found; it barely moves, so a few rounds settle it.
  let corner = cornerAt(place)
  if (!corner) return plain
  let inward = corner.inward,
    at = place
  const reach = 2 * (norm(sub(place, start)) + norm(sub(place, end))) + 10
  for (let round = 0; round < 12; round++) {
    const gap = (t: number) => {
      const c = cornerAt(sub(place, mul(inward, t)))
      return c ? c.external - t : -t
    }
    let low = 0,
      high = reach
    if (gap(high) > 0) return plain
    for (let step = 0; step < 60; step++) {
      const middle = (low + high) / 2
      if (gap(middle) > 0) low = middle
      else high = middle
    }
    at = sub(place, mul(inward, (low + high) / 2))
    corner = cornerAt(at)
    if (!corner) return plain
    const turned = norm(sub(corner.inward, inward))
    inward = corner.inward
    if (turned < 1e-9) break
  }
  if (!corner.fits) return plain
  const through = norm(sub(add(at, mul(corner.inward, corner.external)), place)) <= BEND_THROUGH_TOLERANCE_M
  if (!through) return plain
  const radiusM = Math.max(floor, roundedDown(corner.radius))
  const coordinate = frame.fromXY(at)
  // The engine has the last word on what fits.
  try {
    const trial: Alignment = {
      ...alignment,
      points: [...points.slice(0, index + 1), { id: BEND_TRIAL_ID, coordinate, radiusM }, ...points.slice(index + 1)],
    }
    if (horizontalCurveFits(trial).find((fit) => fit.pointId === BEND_TRIAL_ID)?.status !== 'fitted') return plain
  } catch {
    return plain
  }
  return { coordinate, radiusM, through }
}

export interface CurveThrough {
  radiusM: number
  /** `min` or `max` when the place asked for a radius outside what the corner can carry. */
  limitedBy: 'min' | 'max' | null
}

/**
 * The radius at point `pointId` whose arc passes through `cursor`, read on the corner's bisector:
 * R = E / (sec(Δ/2) − 1), with E the distance from the point to the place along the bisector. Held
 * between the minimum radius and the largest the legs carry as the neighbours stand. Null where the
 * point has no corner to round, or its legs carry no curve at all.
 */
export function curveThrough(
  alignment: Alignment,
  pointId: string,
  cursor: Coordinate,
  minRadiusM: number,
): CurveThrough | null {
  const points = alignment.points
  const index = points.findIndex((point) => point.id === pointId)
  // A curve with spirals keeps its typed radius: the bisector reading is a simple curve's.
  if (index <= 0 || index >= points.length - 1 || (points[index].spiralM ?? 0) > 0) return null
  const frame = planFrame(points[0].coordinate)
  const at = frame.toXY(points[index].coordinate),
    back = sub(at, frame.toXY(points[index - 1].coordinate)),
    ahead = sub(frame.toXY(points[index + 1].coordinate), at)
  const backM = norm(back),
    aheadM = norm(ahead)
  if (backM < 1e-6 || aheadM < 1e-6) return null
  const u = mul(back, 1 / backM),
    v = mul(ahead, 1 / aheadM)
  const turn = angleBetween(u, v)
  if (turn < 1e-5 || turn > Math.PI - 1e-4) return null
  let fit
  try {
    fit = horizontalCurveFits(alignment).find((candidate) => candidate.pointId === pointId)
  } catch {
    return null
  }
  if (!fit) return null
  // What the legs have left for this curve, by the engine's own count of the neighbours' tangents.
  const free = Math.min(fit.backM, fit.aheadM)
  const largest = Math.min(MAX_HORIZONTAL_RADIUS_M, roundedDown((FIT * free) / Math.tan(turn / 2)))
  const floor = Number.isFinite(minRadiusM) ? clamp(minRadiusM, 0, MAX_HORIZONTAL_RADIUS_M) : 0
  if (!(largest > 0) || largest < floor) return null
  const inward = sub(v, u)
  const external = Math.max(0, dot(sub(frame.toXY(cursor), at), mul(inward, 1 / norm(inward))))
  const asked = external / (1 / Math.cos(turn / 2) - 1)
  if (asked < floor) return { radiusM: floor, limitedBy: 'min' }
  if (asked > largest) return { radiusM: largest, limitedBy: 'max' }
  return { radiusM: Math.max(floor, roundedDown(asked)), limitedBy: null }
}

export interface CurveGrip {
  /** The middle of the fitted arc; the point itself where the corner carries no fitted curve. */
  coordinate: Coordinate
  /** The way to the curve's centre, degrees clockwise from north: pulling this way widens the curve. */
  inwardBearing: number
  /** The radius the engine fitted, or 0 for a corner left sharp. */
  radiusM: number
}

/**
 * Where a corner's curve is taken hold of: the middle of its arc, on the bisector. Null at an end,
 * a straight point, a reversal and a curve with spirals, where `curveThrough` has nothing to read.
 */
export function curveGrip(alignment: Alignment, pointId: string): CurveGrip | null {
  const points = alignment.points
  const index = points.findIndex((point) => point.id === pointId)
  if (index <= 0 || index >= points.length - 1 || (points[index].spiralM ?? 0) > 0) return null
  const frame = planFrame(points[0].coordinate)
  const at = frame.toXY(points[index].coordinate),
    back = sub(at, frame.toXY(points[index - 1].coordinate)),
    ahead = sub(frame.toXY(points[index + 1].coordinate), at)
  const backM = norm(back),
    aheadM = norm(ahead)
  if (backM < 1e-6 || aheadM < 1e-6) return null
  const u = mul(back, 1 / backM),
    v = mul(ahead, 1 / aheadM)
  const turn = angleBetween(u, v)
  if (turn < 1e-5 || turn > Math.PI - 1e-4) return null
  let fitted = false
  try {
    fitted = horizontalCurveFits(alignment).find((fit) => fit.pointId === pointId)?.status === 'fitted'
  } catch {
    return null
  }
  const inward = sub(v, u),
    size = norm(inward)
  const radiusM = fitted ? points[index].radiusM : 0
  const external = radiusM * (1 / Math.cos(turn / 2) - 1)
  return {
    coordinate: fitted ? frame.fromXY(add(at, mul(inward, external / size))) : points[index].coordinate,
    inwardBearing: ((Math.atan2(inward[0], inward[1]) * 180) / Math.PI + 360) % 360,
    radiusM,
  }
}
