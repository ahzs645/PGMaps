/**
 * Low-speed vehicle kinematics shared by the road swept path (`sweptPath.ts`) and the junction
 * turn check (`junctionTurn.ts`). Pure: no DOM, no terrain. Positions are in a local metric frame.
 *
 * The steer-axle centre follows a supplied path; each later unit's front pivot (hitch, kingpin or
 * bunk) is carried by the unit ahead, and every axle group trails its front pivot without lateral
 * slip. Steering geometry follows the single-track (bicycle) model.
 */
import type { DesignVehicle, LoadSpan } from './types'

export type XY = [number, number]
export type PathPoint = { x: number; y: number }
export type Sample = { s: number; x: number; y: number }

const RAD = Math.PI / 180
/** Steering angles within this of the lock are not reported as beyond it (sampling noise). */
export const STEERING_LOCK_TOLERANCE_DEG = 0.1

/**
 * How a trailing axle group is moved for each step of its front pivot:
 * - `follow`: the axle is pulled along the line to the new pivot position until it is one wheelbase
 *   away. About 0.05 m conservative on offtracking at 0.25 m steps.
 * - `tractrix`: the exact no-slip solution for a pivot moving along a straight step. The relative
 *   angle θ between the unit and the step direction decays as tan(θ'/2) = tan(θ/2)·exp(−s/L), so
 *   the result does not depend on the step size.
 */
export type TrailingRule = 'follow' | 'tractrix'

export interface VehiclePose {
  /** Index of the steer-path point the steer axle is on. */
  k: number
  /** Front pivot of each unit: the steer-axle centre for the first. */
  fronts: XY[]
  /** Rear axle-group centre of each unit. */
  rears: XY[]
  /** Unit axis, rear → front, unit length. */
  axes: XY[]
  /** Angle between the first unit's axis and the steer path's tangent: the steering angle, degrees. */
  steerDegrees: number
}

/** Steering geometry of a single unit at a fixed steering angle (single-track model). */
export interface SteeringGeometry {
  lockDeg: number
  /** Radius of the path of the steer-axle centre. */
  steerRadiusM: number
  /** Radius of the path of the rear axle-group centre. */
  rearAxleRadiusM: number
  innerRearWheelM: number
  innerFrontWheelM: number
  outerFrontWheelM: number
}

export type SteeringGiven =
  | { lockDeg: number }
  | { steerRadiusM: number }
  | { innerRearM: number }
  | { outerFrontM: number }

/**
 * Turning geometry from the wheelbase, the out-to-out width and any one of the steering lock, the
 * steer-axle radius, the inner rear wheel radius or the outer front wheel radius. With the rear
 * axle-group centre on radius D: D = L / tan(lock), steer-axle radius √(D² + L²), inner rear wheel
 * D − W/2, front wheels √((D ∓ W/2)² + L²).
 */
export function steeringGeometry(wheelbaseM: number, widthM: number, given: SteeringGiven): SteeringGeometry {
  if (!(wheelbaseM > 0) || !(widthM > 0) || !Number.isFinite(wheelbaseM) || !Number.isFinite(widthM))
    throw Error('Turning geometry needs a positive wheelbase and width.')
  const L = wheelbaseM,
    half = widthM / 2
  let rear: number
  if ('lockDeg' in given) {
    if (!(given.lockDeg > 0 && given.lockDeg < 90)) throw Error('The steering lock must be between 0° and 90°.')
    rear = L / Math.tan(given.lockDeg * RAD)
  } else if ('steerRadiusM' in given) {
    if (!(given.steerRadiusM > L)) throw Error('The steer-axle radius must be longer than the wheelbase.')
    rear = Math.sqrt(given.steerRadiusM ** 2 - L ** 2)
  } else if ('innerRearM' in given) {
    if (!(given.innerRearM >= 0) || !Number.isFinite(given.innerRearM))
      throw Error('The inner rear wheel radius cannot be negative.')
    rear = given.innerRearM + half
  } else {
    if (!(given.outerFrontM > Math.hypot(L, half)) || !Number.isFinite(given.outerFrontM))
      throw Error('The outer front wheel radius is too short for this wheelbase and width.')
    rear = Math.sqrt(given.outerFrontM ** 2 - L ** 2) - half
  }
  if (!(rear > 0) || !Number.isFinite(rear)) throw Error('That turn is tighter than the vehicle can steer.')
  return {
    lockDeg: Math.atan2(L, rear) / RAD,
    steerRadiusM: Math.hypot(rear, L),
    rearAxleRadiusM: rear,
    innerRearWheelM: rear - half,
    innerFrontWheelM: Math.hypot(rear - half, L),
    outerFrontWheelM: Math.hypot(rear + half, L),
  }
}

/** Steady minimum radius of the steer-axle path, or null when the vehicle has no lock entered. */
export const minimumSteerRadius = (vehicle: DesignVehicle): number | null =>
  vehicle.steeringLockDeg === undefined
    ? null
    : steeringGeometry(vehicle.units[0].wheelbaseM, vehicle.widthM, { lockDeg: vehicle.steeringLockDeg }).steerRadiusM

/** Total length from the front of the first unit to the back of the last, travelling straight. */
export function vehicleLength(vehicle: DesignVehicle): number {
  const units = vehicle.units
  // Distances behind the steer axle, travelling straight.
  let pivot = 0
  const pivots = units.map((u, i) => {
    const at = pivot
    pivot += u.wheelbaseM + (i < units.length - 1 ? u.hitchOffsetM : 0)
    return at
  })
  let front = -units[0].frontOverhangM,
    rear = pivot + units.at(-1)!.rearOverhangM
  // A load's ends can reach past the units (logs ahead of the bunk, or behind the last axle).
  for (const load of vehicle.loads ?? []) {
    front = Math.min(front, pivots[load.front.unit] + load.front.behindPivotM - load.aheadOfFrontBunkM)
    rear = Math.max(rear, pivots[load.rear.unit] + load.rear.behindPivotM + load.behindRearBunkM)
  }
  return rear - front
}

/**
 * Moves the vehicle along `count` steer-path points in travel order, calling `onPose` at each.
 * The vehicle starts straight, every unit trailing along the first step's direction.
 */
export function trackVehicle(
  count: number,
  at: (k: number) => PathPoint,
  vehicle: DesignVehicle,
  rule: TrailingRule,
  onPose: (pose: VehiclePose) => void,
): void {
  if (count < 2) return
  const first = at(0),
    second = at(1)
  const len0 = Math.hypot(second.x - first.x, second.y - first.y) || 1
  const ux = (second.x - first.x) / len0,
    uy = (second.y - first.y) / len0
  const units = vehicle.units
  const fronts: XY[] = [],
    rears: XY[] = [],
    axes: XY[] = []
  let fx = first.x,
    fy = first.y
  for (const u of units) {
    fronts.push([fx, fy])
    const rx = fx - ux * u.wheelbaseM,
      ry = fy - uy * u.wheelbaseM
    rears.push([rx, ry])
    axes.push([ux, uy])
    fx = rx - ux * u.hitchOffsetM
    fy = ry - uy * u.hitchOffsetM
  }
  for (let k = 0; k < count; k++) {
    const steer = at(k)
    let nextFront: XY = [steer.x, steer.y]
    for (let i = 0; i < units.length; i++) {
      const u = units[i]
      const [px, py] = fronts[i]
      const [Fx, Fy] = nextFront
      if (rule === 'tractrix') {
        const sx = Fx - px,
          sy = Fy - py,
          step = Math.hypot(sx, sy)
        if (step > 1e-12) {
          const hx = sx / step,
            hy = sy / step
          const [ax, ay] = axes[i]
          // Signed angle from the step direction to the unit axis, then its no-slip decay.
          const theta = Math.atan2(hx * ay - hy * ax, hx * ax + hy * ay)
          const decayed = 2 * Math.atan(Math.tan(theta / 2) * Math.exp(-step / u.wheelbaseM))
          const c = Math.cos(decayed),
            s = Math.sin(decayed)
          axes[i] = [hx * c - hy * s, hx * s + hy * c]
        }
      } else {
        const [Rx, Ry] = rears[i]
        const d = Math.hypot(Fx - Rx, Fy - Ry) || 1
        axes[i] = [(Fx - Rx) / d, (Fy - Ry) / d]
      }
      fronts[i] = [Fx, Fy]
      rears[i] = [Fx - axes[i][0] * u.wheelbaseM, Fy - axes[i][1] * u.wheelbaseM]
      if (i + 1 < units.length)
        nextFront = [rears[i][0] - axes[i][0] * u.hitchOffsetM, rears[i][1] - axes[i][1] * u.hitchOffsetM]
    }
    // Path tangent at the steer point, from its neighbours.
    const a = at(Math.max(0, k - 1)),
      b = at(Math.min(count - 1, k + 1))
    const tx = b.x - a.x,
      ty = b.y - a.y
    const [ax, ay] = axes[0]
    const steerDegrees =
      Math.hypot(tx, ty) > 1e-12 ? Math.abs(Math.atan2(ax * ty - ay * tx, ax * tx + ay * ty)) / RAD : 0
    onPose({ k, fronts, rears, axes, steerDegrees })
  }
}

/** Wheel extents: both ends of the steer axle and of every axle group, at the out-to-out width. */
export function wheelPoints(pose: VehiclePose, vehicle: DesignVehicle): XY[] {
  const half = vehicle.widthM / 2
  const points: XY[] = []
  vehicle.units.forEach((_, i) => {
    const [ax, ay] = pose.axes[i],
      nx = -ay,
      ny = ax
    const axles = i === 0 ? [pose.fronts[i], pose.rears[i]] : [pose.rears[i]]
    for (const [x, y] of axles) points.push([x + nx * half, y + ny * half], [x - nx * half, y - ny * half])
  })
  return points
}

/** The line a load lies along: from its front bunk to its rear bunk, extended by its overhangs. */
export function loadLine(pose: VehiclePose, load: LoadSpan): { front: XY; rear: XY; axis: XY } {
  const bunk = (end: LoadSpan['front']): XY => {
    const [fx, fy] = pose.fronts[end.unit],
      [ax, ay] = pose.axes[end.unit]
    return [fx - ax * end.behindPivotM, fy - ay * end.behindPivotM]
  }
  const b1 = bunk(load.front),
    b2 = bunk(load.rear)
  const dx = b1[0] - b2[0],
    dy = b1[1] - b2[1],
    d = Math.hypot(dx, dy)
  // Bunks that coincide leave the load on the front unit's axis.
  const axis: XY = d > 1e-9 ? [dx / d, dy / d] : pose.axes[load.front.unit]
  return {
    front: [b1[0] + axis[0] * load.aheadOfFrontBunkM, b1[1] + axis[1] * load.aheadOfFrontBunkM],
    rear: [b2[0] - axis[0] * load.behindRearBunkM, b2[1] - axis[1] * load.behindRearBunkM],
    axis,
  }
}

/**
 * Outline points of every unit body and every load, at least every metre along each side, at the
 * vehicle width (or the load's own width).
 */
export function bodyPoints(pose: VehiclePose, vehicle: DesignVehicle): XY[] {
  const points: XY[] = []
  const side = (front: XY, rear: XY, axis: XY, half: number, length: number) => {
    const pieces = Math.max(1, Math.ceil(length))
    const nx = -axis[1],
      ny = axis[0]
    for (let j = 0; j <= pieces; j++) {
      const t = j / pieces
      const x = front[0] + (rear[0] - front[0]) * t,
        y = front[1] + (rear[1] - front[1]) * t
      points.push([x + nx * half, y + ny * half], [x - nx * half, y - ny * half])
    }
  }
  vehicle.units.forEach((u, i) => {
    const [Fx, Fy] = pose.fronts[i],
      axis = pose.axes[i]
    side(
      [Fx + axis[0] * u.frontOverhangM, Fy + axis[1] * u.frontOverhangM],
      [Fx - axis[0] * (u.wheelbaseM + u.rearOverhangM), Fy - axis[1] * (u.wheelbaseM + u.rearOverhangM)],
      axis,
      vehicle.widthM / 2,
      u.frontOverhangM + u.wheelbaseM + u.rearOverhangM,
    )
  })
  for (const load of vehicle.loads ?? []) {
    const line = loadLine(pose, load)
    const length = Math.hypot(line.front[0] - line.rear[0], line.front[1] - line.rear[1])
    side(line.front, line.rear, line.axis, (load.widthM ?? vehicle.widthM) / 2, length)
  }
  return points
}

/** Signed lateral offset (left positive) and station of a point, searched within an index window. */
export function locate(samples: readonly Sample[], px: number, py: number, lo: number, hi: number) {
  lo = Math.max(0, lo)
  hi = Math.min(samples.length - 1, hi)
  let best = lo,
    bestD = Infinity
  for (let i = lo; i <= hi; i += 4) {
    const d = (samples[i].x - px) ** 2 + (samples[i].y - py) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  for (let i = Math.max(lo, best - 4); i <= Math.min(hi, best + 4); i++) {
    const d = (samples[i].x - px) ** 2 + (samples[i].y - py) ** 2
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  let result = { s: samples[best].s, offset: 0, distance: Infinity }
  for (const [a, b] of [
    [best - 1, best],
    [best, best + 1],
  ]) {
    if (a < 0 || b >= samples.length) continue
    const A = samples[a],
      B = samples[b]
    const dx = B.x - A.x,
      dy = B.y - A.y,
      len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    const t = Math.max(0, Math.min(1, ((px - A.x) * dx + (py - A.y) * dy) / len ** 2))
    const cx = A.x + dx * t,
      cy = A.y + dy * t
    const distance = Math.hypot(px - cx, py - cy)
    if (distance < result.distance)
      result = { s: A.s + (B.s - A.s) * t, offset: (dx * (py - A.y) - dy * (px - A.x)) / len, distance }
  }
  return result
}
