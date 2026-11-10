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
  /** The same angle signed: positive steers left, negative right. */
  steerSignedDegrees: number
}

export interface TrackOptions {
  /**
   * Heading the vehicle starts on, as a unit vector rear → front. Every unit starts straight along
   * it, trailing the steer point. Absent: along the path's first step.
   */
  startAxis?: XY
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
  const pivots = straightPivots(vehicle)
  let front = -units[0].frontOverhangM,
    rear = pivots.at(-1)! + units.at(-1)!.wheelbaseM + units.at(-1)!.rearOverhangM
  // A load's ends can reach past the units (logs ahead of the bunk, or behind the last axle).
  for (const load of vehicle.loads ?? []) {
    front = Math.min(front, pivots[load.front.unit] + load.front.behindPivotM - load.aheadOfFrontBunkM)
    rear = Math.max(rear, pivots[load.rear.unit] + load.rear.behindPivotM + load.behindRearBunkM)
  }
  return rear - front
}

/**
 * Moves the vehicle along `count` steer-path points in travel order, calling `onPose` at each.
 * The vehicle starts straight, every unit trailing along the first step's direction, or along
 * `options.startAxis` when it is parked at another heading.
 */
export function trackVehicle(
  count: number,
  at: (k: number) => PathPoint,
  vehicle: DesignVehicle,
  rule: TrailingRule,
  onPose: (pose: VehiclePose) => void,
  options: TrackOptions = {},
): void {
  for (const pose of trackVehicleSteps(count, at, vehicle, rule, options)) onPose(pose)
}

/**
 * `trackVehicle` as a generator, one pose per steer-path point, so a long run can be sliced with
 * `cooperative.ts`. The pose's arrays are reused between steps: copy (`clonePose`) to keep one.
 */
export function* trackVehicleSteps(
  count: number,
  at: (k: number) => PathPoint,
  vehicle: DesignVehicle,
  rule: TrailingRule,
  options: TrackOptions = {},
): Generator<VehiclePose, void> {
  if (count < 2) return
  const first = at(0),
    second = at(1)
  const start = options.startAxis
  const len0 = start ? Math.hypot(start[0], start[1]) : Math.hypot(second.x - first.x, second.y - first.y)
  if (start && !(len0 > 1e-9)) throw Error('The starting heading needs a direction.')
  const ux = (start ? start[0] : second.x - first.x) / (len0 || 1),
    uy = (start ? start[1] : second.y - first.y) / (len0 || 1)
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
    const steerSignedDegrees = Math.hypot(tx, ty) > 1e-12 ? Math.atan2(ax * ty - ay * tx, ax * tx + ay * ty) / RAD : 0
    yield { k, fronts, rears, axes, steerDegrees: Math.abs(steerSignedDegrees), steerSignedDegrees }
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

/** Distance of each unit's front pivot behind the steer axle, travelling straight. */
export function straightPivots(vehicle: DesignVehicle): number[] {
  let pivot = 0
  return vehicle.units.map((u) => {
    const at = pivot
    pivot += u.wheelbaseM + u.hitchOffsetM
    return at
  })
}

/** Distance between a load's two bunks when the vehicle travels straight. */
export function straightBunkSpacing(vehicle: DesignVehicle, load: LoadSpan): number {
  const pivots = straightPivots(vehicle)
  return pivots[load.rear.unit] + load.rear.behindPivotM - pivots[load.front.unit] - load.front.behindPivotM
}

/**
 * The line a load lies along: from its front bunk toward its rear bunk. With overhangs from each
 * bunk (the default) it reaches the entered distances past both bunks. A rigid load keeps its
 * straight-travel length: it ends that far behind its front end whatever the bunk spacing, so
 * `vehicle` is needed to know that length.
 */
export function loadLine(
  pose: VehiclePose,
  load: LoadSpan,
  vehicle?: DesignVehicle,
): { front: XY; rear: XY; axis: XY; frontBunk: XY; rearBunk: XY } {
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
  const front: XY = [b1[0] + axis[0] * load.aheadOfFrontBunkM, b1[1] + axis[1] * load.aheadOfFrontBunkM]
  const rear: XY =
    load.lengthMode === 'rigid' && vehicle
      ? (() => {
          const length = load.aheadOfFrontBunkM + straightBunkSpacing(vehicle, load) + load.behindRearBunkM
          return [front[0] - axis[0] * length, front[1] - axis[1] * length]
        })()
      : [b2[0] - axis[0] * load.behindRearBunkM, b2[1] - axis[1] * load.behindRearBunkM]
  return { front, rear, axis, frontBunk: b1, rearBunk: b2 }
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
    const line = loadLine(pose, load, vehicle)
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

/** One unit in a steady turn: the radii of its front pivot, its rear axle-group centre and its hitch. */
export interface SteadyUnit {
  frontRadiusM: number
  rearRadiusM: number
  /** Radius of the point the next unit is hitched to; absent for the last unit. */
  hitchRadiusM?: number
}

/**
 * Steady-state turn (the vehicle has driven long enough on a circle that nothing changes): every
 * rear axle-group centre moves square to its radius, so a unit whose front pivot is on radius Rf
 * has its axle on √(Rf² − L²), and a hitch h behind the axle is on √(Rr² + h²). For a whole chain
 * this is SAE J695's R_n² = R² − ΣLᵢ² + Σhᵢ². Offtracking is the steer radius less the last axle's.
 * Throws when a unit's front pivot is not farther from the centre than its wheelbase.
 */
export function steadyStateTurn(
  vehicle: Pick<DesignVehicle, 'units'>,
  steerRadiusM: number,
): { units: SteadyUnit[]; offtrackingM: number } {
  if (!(steerRadiusM > 0) || !Number.isFinite(steerRadiusM)) throw Error('The steer radius must be positive.')
  const units: SteadyUnit[] = []
  let front = steerRadiusM
  vehicle.units.forEach((u, i) => {
    if (!(front > u.wheelbaseM))
      throw Error(
        `${u.name || `Unit ${i + 1}`} cannot settle on an R${round3(steerRadiusM)} turn: its pivot would be no farther from the centre than its wheelbase.`,
      )
    const rear = Math.sqrt(front ** 2 - u.wheelbaseM ** 2)
    const last = i === vehicle.units.length - 1
    units.push({
      frontRadiusM: front,
      rearRadiusM: rear,
      ...(last ? {} : { hitchRadiusM: Math.hypot(rear, u.hitchOffsetM) }),
    })
    front = Math.hypot(rear, u.hitchOffsetM)
  })
  return { units, offtrackingM: steerRadiusM - units.at(-1)!.rearRadiusM }
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

/** A point fixed to a unit: metres ahead of its front pivot (negative behind) and to its left (negative right). */
export function unitPoint(pose: VehiclePose, unit: number, aheadM: number, leftM: number): XY {
  const [fx, fy] = pose.fronts[unit],
    [ax, ay] = pose.axes[unit]
  return [fx + ax * aheadM - ay * leftM, fy + ay * aheadM + ax * leftM]
}

/** Plan outlines of a vehicle at one pose: each unit's body, each load and each axle, local metres. */
export interface VehicleOutline {
  /** Closed rings (first point repeated last). */
  bodies: { label: string; ring: XY[] }[]
  loads: { label: string; ring: XY[] }[]
  /** Each axle as a line between its wheel extents; the first unit's steer axle first. */
  axles: [XY, XY][]
}

function rectangle(front: XY, rear: XY, axis: XY, half: number): XY[] {
  const nx = -axis[1] * half,
    ny = axis[0] * half
  return [
    [front[0] + nx, front[1] + ny],
    [rear[0] + nx, rear[1] + ny],
    [rear[0] - nx, rear[1] - ny],
    [front[0] - nx, front[1] - ny],
    [front[0] + nx, front[1] + ny],
  ]
}

export function vehicleOutline(pose: VehiclePose, vehicle: DesignVehicle): VehicleOutline {
  const half = vehicle.widthM / 2
  const bodies = vehicle.units.map((u, i) => ({
    label: u.name || `Unit ${i + 1}`,
    ring: rectangle(
      unitPoint(pose, i, u.frontOverhangM, 0),
      unitPoint(pose, i, -(u.wheelbaseM + u.rearOverhangM), 0),
      pose.axes[i],
      half,
    ),
  }))
  const loads = (vehicle.loads ?? []).map((load, i) => {
    const line = loadLine(pose, load, vehicle)
    return {
      label: load.name || `Load ${i + 1}`,
      ring: rectangle(line.front, line.rear, line.axis, (load.widthM ?? vehicle.widthM) / 2),
    }
  })
  const axles: [XY, XY][] = []
  vehicle.units.forEach((u, i) => {
    for (const ahead of i === 0 ? [0, -u.wheelbaseM] : [-u.wheelbaseM])
      axles.push([unitPoint(pose, i, ahead, half), unitPoint(pose, i, ahead, -half)])
  })
  return { bodies, loads, axles }
}

/** Articulation between each pair of coupled units, degrees, signed positive when the trailer swings left. */
export function articulationDegrees(pose: VehiclePose): number[] {
  const angles: number[] = []
  for (let i = 1; i < pose.axes.length; i++) {
    const a = pose.axes[i - 1],
      b = pose.axes[i]
    angles.push(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]) / RAD)
  }
  return angles
}

/** "23.6° L": a steering angle with its side; "0.0°" when straight. */
export const steerText = (signedDegrees: number) =>
  `${Math.abs(signedDegrees).toFixed(1)}°${Math.abs(signedDegrees) < 0.05 ? '' : signedDegrees > 0 ? ' L' : ' R'}`

/** A copy of a pose that later tracking steps cannot change. */
export const clonePose = (pose: VehiclePose): VehiclePose => ({
  ...pose,
  fronts: pose.fronts.map((p) => [p[0], p[1]]),
  rears: pose.rears.map((p) => [p[0], p[1]]),
  axes: pose.axes.map((p) => [p[0], p[1]]),
})

/**
 * Truck specifications usually quote the inner front wheel's cut angle, not the single-track
 * (bicycle-model) angle. With kingpin track T, the rear axle-group centre turns on
 * D = L / tan(inner) + T/2, and the single-track lock is atan(L / D) (Ackermann geometry,
 * Gillespie 1992 ch. 6). Returns the single-track lock and the outer wheel's angle.
 */
export function lockFromInnerWheelCut(
  wheelbaseM: number,
  kingpinTrackM: number,
  innerWheelDeg: number,
): { lockDeg: number; outerWheelDeg: number } {
  if (!(wheelbaseM > 0) || !(kingpinTrackM > 0) || !(innerWheelDeg > 0 && innerWheelDeg < 90))
    throw Error('Enter a positive wheelbase and kingpin track, and an inner wheel cut between 0° and 90°.')
  const D = wheelbaseM / Math.tan(innerWheelDeg * RAD) + kingpinTrackM / 2
  return {
    lockDeg: Math.atan2(wheelbaseM, D) / RAD,
    outerWheelDeg: Math.atan2(wheelbaseM, D + kingpinTrackM / 2) / RAD,
  }
}

/** Inner and outer front wheel angles for a single-track steering angle (Ackermann). */
export function ackermannWheelAngles(
  wheelbaseM: number,
  kingpinTrackM: number,
  singleTrackDeg: number,
): { innerDeg: number; outerDeg: number } {
  if (!(wheelbaseM > 0) || !(kingpinTrackM > 0) || !(singleTrackDeg > 0 && singleTrackDeg < 90))
    throw Error('Enter a positive wheelbase and kingpin track, and a steering angle between 0° and 90°.')
  const D = wheelbaseM / Math.tan(singleTrackDeg * RAD)
  if (!(D > kingpinTrackM / 2)) throw Error('The inner wheel would turn past the rear axle’s line.')
  return {
    innerDeg: Math.atan2(wheelbaseM, D - kingpinTrackM / 2) / RAD,
    outerDeg: Math.atan2(wheelbaseM, D + kingpinTrackM / 2) / RAD,
  }
}
