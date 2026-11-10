/**
 * Steady-state turning template and the loop-turnaround check for landings and road ends. On a
 * circle driven long enough, every axle group moves square to its own radius about one centre: the
 * vehicle's pose stops changing, and its outline sweeps an annulus from the innermost wheel (or
 * load) to the outermost corner of the body. A loop turnaround fits where a disc of the outer
 * radius plus the clearance fits inside the footprint. Pure: no DOM or network access. Positions
 * are local metres, x east and y north.
 *
 * Provenance: the steady pose ("maximum in-swing") and the turning template follow the functional
 * specification of QuickTurn (clean-specs/quickturn.md §3.3, gap G2). The radii are SAE J695's
 * steady-state offtracking relation R_rear = √(R² − L²), with a hitch h behind the axle on
 * √(R_rear² + h²); single-track steering geometry as in Gillespie (1992), Fundamentals of Vehicle
 * Dynamics, ch. 6. The largest disc inside a polygon is found by the cell-subdivision search for
 * a polygon's pole of inaccessibility (Garcia-Castellanos & Lombardo 2007, Scottish Geographical
 * Journal 123(3):227–233). Written from a functional specification; no code from QuickTurn
 * (GNU GPL v2) was used.
 */
import type { DesignVehicle } from './types'
import {
  bodyPoints,
  STEERING_LOCK_TOLERANCE_DEG,
  steadyStateTurn,
  steeringGeometry,
  vehicleOutline,
  wheelPoints,
  type VehicleOutline,
  type VehiclePose,
  type XY,
} from './vehicleKinematics'
import { signedDistance, type MultiPolygon } from './vehiclePath'

export const TEMPLATE_LIMITS = {
  steerRadiusM: [3, 200] as const,
  clearanceM: [0, 5] as const,
}
/** The inscribed-disc search stops once a better disc could gain no more than this. */
export const INSCRIBED_PRECISION_M = 0.05
/** Largest footprint searched for a loop turnaround, across. */
export const MAX_TURNAROUND_FOOTPRINT_M = 2000

export interface TurningTemplate {
  side: 'left' | 'right'
  /** Radius of the steer-axle centre's circle. */
  steerRadiusM: number
  /** The single-track steering angle that circle needs. */
  steerDegrees: number
  /** Steady radius of each unit's rear axle-group centre. */
  rearAxleRadiiM: number[]
  /** Steer radius less the last axle group's radius. */
  offtrackingM: number
  /** Outermost point of any body or load. */
  outerBodyRadiusM: number
  /** Innermost wheel extent. */
  innerWheelRadiusM: number
  /** Innermost point the vehicle sweeps: the inner wheels, or a load cutting inside them. */
  innerSweptRadiusM: number
  /** Width of the swept annulus: outer body radius less the innermost swept radius. */
  annulusWidthM: number
  /** Diameter of a loop turnaround: the outer body diameter plus the clearance each side. */
  turnaroundDiameterM: number
  clearanceM: number
  /** The vehicle in its steady pose, the circle's centre at the origin. */
  pose: VehiclePose
  outline: VehicleOutline
  lockExceeded: boolean | null
}

const RAD = Math.PI / 180
const rotate = (p: XY, a: number): XY => [
  p[0] * Math.cos(a) - p[1] * Math.sin(a),
  p[0] * Math.sin(a) + p[1] * Math.cos(a),
]
const norm = (p: XY) => Math.hypot(p[0], p[1])

/**
 * The vehicle in its steady pose on a circle of steer radius `steerRadiusM` about the origin,
 * turning `side`. The steer-axle centre sits due east of the centre for a left turn (heading north)
 * and due west for a right turn.
 */
export function steadyPose(vehicle: DesignVehicle, steerRadiusM: number, side: 'left' | 'right'): VehiclePose {
  const { units } = steadyStateTurn(vehicle, steerRadiusM)
  // Travel is anticlockwise about the centre for a left turn; a unit's axle sits behind its pivot.
  const sign = side === 'left' ? 1 : -1
  const fronts: XY[] = [],
    rears: XY[] = [],
    axes: XY[] = []
  let front: XY = side === 'left' ? [steerRadiusM, 0] : [-steerRadiusM, 0]
  vehicle.units.forEach((u, i) => {
    const { rearRadiusM } = units[i]
    const behind = Math.atan2(u.wheelbaseM, rearRadiusM)
    const rear = rotate(
      [(front[0] / norm(front)) * rearRadiusM, (front[1] / norm(front)) * rearRadiusM],
      -sign * behind,
    )
    const axis: XY = [(front[0] - rear[0]) / u.wheelbaseM, (front[1] - rear[1]) / u.wheelbaseM]
    fronts.push(front)
    rears.push(rear)
    axes.push(axis)
    front = [rear[0] - axis[0] * u.hitchOffsetM, rear[1] - axis[1] * u.hitchOffsetM]
  })
  const steerDegrees = Math.asin(Math.min(1, vehicle.units[0].wheelbaseM / steerRadiusM)) / RAD
  return { k: 0, fronts, rears, axes, steerDegrees, steerSignedDegrees: side === 'left' ? steerDegrees : -steerDegrees }
}

/**
 * The steady-state template at `steerRadiusM`, or at the vehicle's lock when it is null. Throws
 * when no lock is entered and no radius is given, or when a unit cannot settle on that circle.
 */
export function turningTemplate(
  vehicle: DesignVehicle,
  options: { steerRadiusM?: number | null; side?: 'left' | 'right'; clearanceM?: number } = {},
): TurningTemplate {
  const side = options.side ?? 'left'
  const clearanceM = options.clearanceM ?? 0
  if (
    !Number.isFinite(clearanceM) ||
    clearanceM < TEMPLATE_LIMITS.clearanceM[0] ||
    clearanceM > TEMPLATE_LIMITS.clearanceM[1]
  )
    throw Error('The clearance must be 0–5 m.')
  let steerRadiusM = options.steerRadiusM ?? null
  if (steerRadiusM === null) {
    if (vehicle.steeringLockDeg === undefined)
      throw Error('Enter a steering lock or a steer radius to draw the turning template.')
    steerRadiusM = steeringGeometry(vehicle.units[0].wheelbaseM, vehicle.widthM, {
      lockDeg: vehicle.steeringLockDeg,
    }).steerRadiusM
  } else if (
    !Number.isFinite(steerRadiusM) ||
    steerRadiusM < TEMPLATE_LIMITS.steerRadiusM[0] ||
    steerRadiusM > TEMPLATE_LIMITS.steerRadiusM[1]
  )
    throw Error('The steer radius must be 3–200 m.')
  const pose = steadyPose(vehicle, steerRadiusM, side)
  const steady = steadyStateTurn(vehicle, steerRadiusM)
  const radii = (points: XY[]) => points.map(norm)
  const body = radii(bodyPoints(pose, vehicle)),
    wheels = radii(wheelPoints(pose, vehicle))
  const outerBodyRadiusM = Math.max(...body, ...wheels)
  const innerWheelRadiusM = Math.min(...wheels)
  const innerSweptRadiusM = Math.min(innerWheelRadiusM, ...body)
  const round = (v: number) => Math.round(v * 1000) / 1000
  return {
    side,
    steerRadiusM: round(steerRadiusM),
    steerDegrees: round(pose.steerDegrees),
    rearAxleRadiiM: steady.units.map((u) => round(u.rearRadiusM)),
    offtrackingM: round(steady.offtrackingM),
    outerBodyRadiusM: round(outerBodyRadiusM),
    innerWheelRadiusM: round(innerWheelRadiusM),
    innerSweptRadiusM: round(innerSweptRadiusM),
    // From the rounded radii, so the figures shown add up.
    annulusWidthM: round(round(outerBodyRadiusM) - round(innerSweptRadiusM)),
    turnaroundDiameterM: round(2 * (round(outerBodyRadiusM) + clearanceM)),
    clearanceM,
    pose,
    outline: vehicleOutline(pose, vehicle),
    lockExceeded:
      vehicle.steeringLockDeg === undefined
        ? null
        : pose.steerDegrees > vehicle.steeringLockDeg + STEERING_LOCK_TOLERANCE_DEG,
  }
}

/** The template moved so the circle's centre is at `centre`. */
export function placeTemplate(template: TurningTemplate, centre: XY) {
  const move = (p: XY): XY => [p[0] + centre[0], p[1] + centre[1]]
  return {
    centre,
    bodies: template.outline.bodies.map((b) => ({ label: b.label, ring: b.ring.map(move) })),
    loads: template.outline.loads.map((b) => ({ label: b.label, ring: b.ring.map(move) })),
    axles: template.outline.axles.map(([a, b]) => [move(a), move(b)] as [XY, XY]),
    circle: (radius: number, pieces = 96): XY[] =>
      Array.from({ length: pieces + 1 }, (_, i) => {
        const a = (2 * Math.PI * i) / pieces
        return [centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a)] as XY
      }),
  }
}

/**
 * Centre and radius of the largest disc inside a footprint, holes excluded: the pole of
 * inaccessibility, found by subdividing square cells and dropping those that cannot hold a larger
 * disc than the best found, to within `INSCRIBED_PRECISION_M`.
 */
export function largestInscribedDisc(input: MultiPolygon): { centre: XY; radiusM: number } | null {
  // Rings may arrive open; the distance search walks closed ones.
  const shape: MultiPolygon = input.map((polygon) =>
    polygon.map((ring) =>
      ring.length && (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1]) ? [...ring, ring[0]] : ring,
    ),
  )
  const points = shape.flatMap((polygon) => polygon.flat())
  if (points.length < 3) return null
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  const width = maxX - minX,
    height = maxY - minY
  if (!(Math.min(width, height) > 0)) return null
  if (Math.max(width, height) > MAX_TURNAROUND_FOOTPRINT_M)
    throw Error(`A footprint for a turnaround is at most ${MAX_TURNAROUND_FOOTPRINT_M} m across.`)
  const depth = (p: XY) => -signedDistance(shape, p)
  type Cell = { x: number; y: number; h: number; d: number; max: number }
  const cell = (x: number, y: number, h: number): Cell => {
    const d = depth([x, y])
    return { x, y, h, d, max: d + h * Math.SQRT2 }
  }
  const size = Math.min(width, height)
  const queue: Cell[] = []
  for (let x = minX; x < maxX; x += size)
    for (let y = minY; y < maxY; y += size) queue.push(cell(x + size / 2, y + size / 2, size / 2))
  let best = cell(minX + width / 2, minY + height / 2, 0)
  for (const c of queue) if (c.d > best.d) best = c
  let guard = 0
  while (queue.length && guard++ < 200_000) {
    // Most promising cell first.
    let index = 0
    for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[index].max) index = i
    const c = queue.splice(index, 1)[0]
    if (c.d > best.d) best = c
    if (c.max - best.d <= INSCRIBED_PRECISION_M) continue
    const h = c.h / 2
    queue.push(
      cell(c.x - h, c.y - h, h),
      cell(c.x + h, c.y - h, h),
      cell(c.x - h, c.y + h, h),
      cell(c.x + h, c.y + h, h),
    )
  }
  return best.d > 0 ? { centre: [best.x, best.y], radiusM: Math.round(best.d * 1000) / 1000 } : null
}

export interface TurnaroundFit {
  /** Largest disc the footprint holds; null when it holds none. */
  disc: { centre: XY; radiusM: number } | null
  /** Radius the loop needs: outer body radius plus clearance. */
  neededRadiusM: number
  fits: boolean
  /** How much more radius the footprint would need; 0 when it fits. */
  shortM: number
}

/** Whether a loop turnaround at the template's radius fits inside a footprint. */
export function loopTurnaroundFit(template: TurningTemplate, footprint: MultiPolygon): TurnaroundFit {
  const disc = largestInscribedDisc(footprint)
  const neededRadiusM = Math.round((template.outerBodyRadiusM + template.clearanceM) * 1000) / 1000
  const have = disc?.radiusM ?? 0
  return {
    disc,
    neededRadiusM,
    fits: have + 1e-6 >= neededRadiusM,
    shortM: Math.round(Math.max(0, neededRadiusM - have) * 1000) / 1000,
  }
}
