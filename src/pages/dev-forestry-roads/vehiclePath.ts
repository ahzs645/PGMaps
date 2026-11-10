/**
 * Drive a design vehicle along any path: a line sketched on the plan, a loop through a landing, a
 * junction turn. The steer-axle centre follows the path (its corners rounded by an entered fillet
 * radius) and every axle group trails its pivot by the exact no-slip step. The run reports the
 * steering the path demands (with its side), where it passes the lock, offtracking and
 * articulation, the swept area as a closed polygon with its area, the wheels' swept area, traces of
 * chosen points on the vehicle, and how much of the swept area falls outside an entered footprint.
 * Pure: no DOM, terrain or network access. Positions are local metres, x east and y north.
 *
 * Provenance: the free-path command, the vehicle footprint at a position, the swept envelope,
 * point traces and the starting heading follow the functional specification of QuickTurn
 * (clean-specs/quickturn.md §3.1, §4, gaps G1, G3, G4, G5, G10). The trailing step is the
 * straight-move tractrix of Prince & Dubois (2009), Mathematical and Computer Modelling 49:2049–2060,
 * p. 2052, applied by `trackVehicle`; the no-slip trailing equation is Sayers (1986), TRR 1052.
 * Written from a functional specification; no code from QuickTurn (GNU GPL v2) was used.
 */
import clipping from 'polygon-clipping'
import type { DesignVehicle } from './types'
import {
  articulationDegrees,
  clonePose,
  loadLine,
  locate,
  minimumSteerRadius,
  STEERING_LOCK_TOLERANCE_DEG,
  trackVehicleSteps,
  unitPoint,
  vehicleLength,
  vehicleOutline,
  type Sample,
  type VehicleOutline,
  type VehiclePose,
  type XY,
} from './vehicleKinematics'

/** Steer-path step: the exact trailing step makes the result independent of it; the path's own sampling is what matters. */
export const DRIVE_STEP_M = 0.25
/** Positions are kept, and the swept area built, every this many metres of steer travel. */
export const DRIVE_RECORD_M = 0.5
export const DRIVE_LIMITS = {
  filletRadiusM: [0, 200] as const,
  /** Longest path driven: landings, turnarounds and junctions, not whole roads. */
  pathLengthM: [1, 1000] as const,
  vertices: 500,
  traces: 6,
  clearanceM: [0, 5] as const,
  startBearingDeg: [0, 360] as const,
}
/** A path vertex turning more than this would need the vehicle to reverse, which is not modelled. */
export const MAX_VERTEX_TURN_DEG = 175
/** Swept pieces joined per union call; the run yields to the page between calls. */
export const DRIVE_UNION_BATCH = 64
/** Footprint edges are checked at points at most this far apart. */
const EDGE_SAMPLE_M = 0.25

export const DRIVE_PATH_BASIS =
  'Low-speed kinematic tracking with no tyre slip: the steer-axle centre follows the drawn path, its ' +
  'corners rounded by the fillet radius, and each axle group trails its pivot by the exact no-slip step. ' +
  'The swept area joins every unit and load outline at every quarter metre of travel. Excludes reversing, ' +
  'speed, steering rate, tandem scrub, grade, mirrors and vertical clearance.'

const RAD = Math.PI / 180

/**
 * A point fixed to the vehicle to trace: on a unit, metres ahead of its front pivot (negative
 * behind) and to its left (negative right); or at one end of a load, metres to the load's left.
 */
export type TracePoint =
  | { label: string; unit: number; aheadM: number; leftM: number }
  | { label: string; load: number; end: 'front' | 'rear'; leftM: number }

export function tracePosition(pose: VehiclePose, vehicle: DesignVehicle, point: TracePoint): XY {
  if ('unit' in point) return unitPoint(pose, point.unit, point.aheadM, point.leftM)
  const line = loadLine(pose, vehicle.loads![point.load], vehicle)
  const [x, y] = point.end === 'front' ? line.front : line.rear
  return [x - line.axis[1] * point.leftM, y + line.axis[0] * point.leftM]
}

/** The usual points to trace: each unit's four corners and each load's two tips. */
export function tracePresets(vehicle: DesignVehicle): TracePoint[] {
  const half = vehicle.widthM / 2
  const presets: TracePoint[] = []
  vehicle.units.forEach((u, unit) => {
    const name = u.name || `Unit ${unit + 1}`
    const front = u.frontOverhangM,
      rear = -(u.wheelbaseM + u.rearOverhangM)
    presets.push(
      { label: `${name} front-left corner`, unit, aheadM: front, leftM: half },
      { label: `${name} front-right corner`, unit, aheadM: front, leftM: -half },
      { label: `${name} rear-left corner`, unit, aheadM: rear, leftM: half },
      { label: `${name} rear-right corner`, unit, aheadM: rear, leftM: -half },
    )
  })
  ;(vehicle.loads ?? []).forEach((l, load) => {
    const name = l.name || `Load ${load + 1}`
    presets.push(
      { label: `${name} front tip`, load, end: 'front', leftM: 0 },
      { label: `${name} rear tip`, load, end: 'rear', leftM: 0 },
    )
  })
  return presets
}

export function validateTracePoint(vehicle: DesignVehicle, point: TracePoint): void {
  const finite = (v: number, lo: number, hi: number) => Number.isFinite(v) && v >= lo && v <= hi
  if (typeof point.label !== 'string' || point.label.length > 120) throw Error('Name the traced point.')
  if ('unit' in point) {
    if (!Number.isInteger(point.unit) || point.unit < 0 || point.unit >= vehicle.units.length)
      throw Error('Trace a point on one of the vehicle’s units.')
    if (!finite(point.aheadM, -60, 30) || !finite(point.leftM, -10, 10))
      throw Error('A traced point is 30 m ahead to 60 m behind its pivot and within 10 m of the axis.')
  } else {
    if (!Number.isInteger(point.load) || point.load < 0 || point.load >= (vehicle.loads?.length ?? 0))
      throw Error('Trace the tip of one of the vehicle’s loads.')
    if ((point.end !== 'front' && point.end !== 'rear') || !finite(point.leftM, -10, 10))
      throw Error('A load tip is its front or rear, within 10 m of its axis.')
  }
}

// ---------------------------------------------------------------------------------------------
// The steer path

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const norm = (a: XY) => Math.hypot(a[0], a[1])
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0]
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]

/**
 * The steer path through `points`, each interior corner rounded by a circular arc of
 * `filletRadiusM` tangent to both legs (tangent length R·tan(Δ/2) for a turn of Δ), sampled every
 * `DRIVE_STEP_M`. A radius of 0 keeps the corners sharp, where the steering jumps.
 */
export function filletPath(points: readonly XY[], filletRadiusM: number): { samples: Sample[]; lengthM: number } {
  const R = filletRadiusM
  if (!Number.isFinite(R) || R < DRIVE_LIMITS.filletRadiusM[0] || R > DRIVE_LIMITS.filletRadiusM[1])
    throw Error(`The fillet radius must be ${DRIVE_LIMITS.filletRadiusM[0]}–${DRIVE_LIMITS.filletRadiusM[1]} m.`)
  if (points.length > DRIVE_LIMITS.vertices) throw Error(`A path has at most ${DRIVE_LIMITS.vertices} vertices.`)
  const p: XY[] = []
  for (const point of points) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) throw Error('A path vertex is not a number.')
    if (!p.length || norm(sub(point, p.at(-1)!)) > 1e-6) p.push([point[0], point[1]])
  }
  if (p.length < 2) throw Error('A path needs at least two distinct points.')
  const legs = p.slice(1).map((q, i) => {
    const d = sub(q, p[i]),
      length = norm(d)
    return { length, dir: [d[0] / length, d[1] / length] as XY }
  })
  // Tangent length taken from each leg at each interior vertex.
  const tangents = p.map((_, i) => {
    if (i === 0 || i === p.length - 1) return { t: 0, turn: 0 }
    const turn = Math.atan2(cross(legs[i - 1].dir, legs[i].dir), dot(legs[i - 1].dir, legs[i].dir))
    if (Math.abs(turn) / RAD > MAX_VERTEX_TURN_DEG)
      throw Error(
        `Vertex ${i + 1} turns ${(Math.abs(turn) / RAD).toFixed(0)}°: the vehicle would need to reverse, which is not modelled.`,
      )
    return { t: R > 0 && Math.abs(turn) > 1e-6 ? R * Math.tan(Math.abs(turn) / 2) : 0, turn }
  })
  legs.forEach((leg, i) => {
    const needed = tangents[i].t + tangents[i + 1].t
    if (needed > leg.length + 1e-9)
      throw Error(
        `An R${R} fillet does not fit between vertices ${i + 1} and ${i + 2}: the arcs need ${needed.toFixed(1)} m of a ${leg.length.toFixed(1)} m leg.`,
      )
  })
  const out: XY[] = [p[0]]
  const lineTo = (b: XY) => {
    const a = out.at(-1)!,
      length = norm(sub(b, a))
    const n = Math.max(1, Math.round(length / DRIVE_STEP_M))
    if (length < 1e-9) return
    for (let j = 1; j <= n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n])
  }
  for (let i = 1; i < p.length - 1; i++) {
    const { t, turn } = tangents[i]
    const u = legs[i - 1].dir
    if (t <= 0) {
      lineTo(p[i])
      continue
    }
    const enter: XY = [p[i][0] - u[0] * t, p[i][1] - u[1] * t]
    lineTo(enter)
    const sign = Math.sign(turn)
    const centre: XY = [enter[0] - u[1] * R * sign, enter[1] + u[0] * R * sign]
    const r0 = sub(enter, centre)
    const n = Math.max(1, Math.round((R * Math.abs(turn)) / DRIVE_STEP_M))
    for (let j = 1; j <= n; j++) {
      const a = (turn * j) / n
      out.push([
        centre[0] + r0[0] * Math.cos(a) - r0[1] * Math.sin(a),
        centre[1] + r0[0] * Math.sin(a) + r0[1] * Math.cos(a),
      ])
    }
  }
  lineTo(p.at(-1)!)
  let s = 0
  const samples = out.map((q, i) => {
    if (i) s += norm(sub(q, out[i - 1]))
    return { s, x: q[0], y: q[1] }
  })
  return { samples, lengthM: s }
}

// ---------------------------------------------------------------------------------------------
// Polygons

type Ring = XY[]
type Polygon = Ring[]
export type MultiPolygon = Polygon[]

/** Shoelace area of a ring, positive anticlockwise. */
export function ringArea(ring: readonly XY[]): number {
  let sum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
  return sum / 2
}

/** Area of a multipolygon: outer rings less their holes. */
export function multiPolygonArea(shape: MultiPolygon): number {
  let area = 0
  for (const polygon of shape)
    polygon.forEach((ring, i) => {
      area += i === 0 ? Math.abs(ringArea(ring)) : -Math.abs(ringArea(ring))
    })
  return area
}

/** Convex hull, anticlockwise and closed (monotone chain). */
function hull(points: XY[]): Ring {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const turn = (o: XY, a: XY, b: XY) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: XY[] = [],
    upper: XY[] = []
  for (const p of sorted) {
    while (lower.length >= 2 && turn(lower.at(-2)!, lower.at(-1)!, p) <= 0) lower.pop()
    lower.push(p)
  }
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && turn(upper.at(-2)!, upper.at(-1)!, p) <= 0) upper.pop()
    upper.push(p)
  }
  const ring = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  if (ring.length) ring.push(ring[0])
  return ring
}

/** Snaps coordinates to a grid (1 mm by default), which keeps the clipper away from near-coincident edges. */
const snap = (ring: Ring, grid = 1000): Ring =>
  ring.map((p) => [Math.round(p[0] * grid) / grid, Math.round(p[1] * grid) / grid])

type ClipGeom = Parameters<typeof clipping.union>[0]
const clip = (shape: MultiPolygon) => shape as unknown as ClipGeom

/**
 * Union of many pieces. polygon-clipping occasionally throws on near-coincident edges; the batch
 * is then retried on a 1 cm grid, and as a last resort piece by piece, leaving out (and counting)
 * any piece that still cannot be joined.
 */
function unionAll(parts: MultiPolygon[], skipped = { count: 0 }): MultiPolygon {
  const shapes = parts.filter((p) => p.length)
  if (!shapes.length) return []
  try {
    return clipping.union(clip(shapes[0]), ...shapes.slice(1).map(clip)) as unknown as MultiPolygon
  } catch {
    try {
      const coarse = shapes.map((shape) => shape.map((polygon) => polygon.map((ring) => snap(ring, 100))))
      return clipping.union(clip(coarse[0]), ...coarse.slice(1).map(clip)) as unknown as MultiPolygon
    } catch {
      let result: MultiPolygon = []
      for (const shape of shapes)
        try {
          result = (result.length
            ? clipping.union(clip(result), clip(shape))
            : clipping.union(clip(shape))) as unknown as MultiPolygon
        } catch {
          skipped.count++
        }
      return result
    }
  }
}

/** The part of `shape` outside `area`. */
export function difference(shape: MultiPolygon, area: MultiPolygon): MultiPolygon {
  if (!shape.length) return []
  if (!area.length) return shape
  return clipping.difference(clip(shape), clip(area)) as unknown as MultiPolygon
}

/** Joins pieces in batches, yielding between them so a long union never holds the page. */
function* unionInBatches(
  pieces: Polygon[],
  skipped: { count: number },
): Generator<{ phase: 'union'; done: number; total: number }, MultiPolygon> {
  let level: MultiPolygon[] = pieces.map((p) => [p])
  const total = Math.max(1, level.length)
  let done = 0
  while (level.length > 1) {
    const next: MultiPolygon[] = []
    for (let i = 0; i < level.length; i += DRIVE_UNION_BATCH) {
      next.push(unionAll(level.slice(i, i + DRIVE_UNION_BATCH), skipped))
      done += Math.min(DRIVE_UNION_BATCH, level.length - i)
      yield { phase: 'union', done: Math.min(done, total), total }
    }
    level = next
  }
  return level.length ? unionAll(level, skipped) : []
}

/** Whether a point is inside a multipolygon (even–odd over every ring, so holes count as outside). */
function inside(shape: MultiPolygon, p: XY): boolean {
  let hit = false
  for (const polygon of shape)
    for (const ring of polygon)
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i],
          b = ring[j]
        if (a[1] > p[1] !== b[1] > p[1] && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit
      }
  return hit
}

/** Distance from a point to a multipolygon's boundary, positive outside it and negative inside. */
export function signedDistance(shape: MultiPolygon, p: XY): number {
  let best = Infinity
  for (const polygon of shape)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          d = sub(ring[i], a),
          len2 = dot(d, d)
        const t = len2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), d) / len2)) : 0
        best = Math.min(best, Math.hypot(p[0] - a[0] - d[0] * t, p[1] - a[1] - d[1] * t))
      }
  return inside(shape, p) ? -best : best
}

/** Points along every ring of a shape, at least every `EDGE_SAMPLE_M`. */
function boundaryPoints(shape: MultiPolygon): XY[] {
  const points: XY[] = []
  for (const polygon of shape)
    for (const ring of polygon)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i],
          n = Math.max(1, Math.ceil(norm(sub(b, a)) / EDGE_SAMPLE_M))
        for (let j = 0; j < n; j++) points.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n])
      }
  return points
}

// ---------------------------------------------------------------------------------------------
// The run

export interface DriveInput {
  /** Path vertices for the steer-axle centre, in travel order, local metres. */
  path: XY[]
  /** Radius of the arc rounding each corner of the path; 0 keeps the corners sharp. */
  filletRadiusM: number
  vehicle: DesignVehicle
  /** Heading the vehicle is parked on at the start, degrees clockwise from north; absent: along the path. */
  startBearingDeg?: number | null
  traces?: TracePoint[]
  /** Area the vehicle should stay on (a landing, the road formations), as polygons of rings. */
  footprint?: MultiPolygon
  /** Wheel clearance kept inside the footprint edge. */
  clearanceM?: number
}

export interface DrivePosition {
  /** Steer-path distance. */
  s: number
  pose: VehiclePose
  /** Articulation at each coupling, signed. */
  articulation: number[]
}

export interface LockRun {
  startS: number
  endS: number
  /** Largest steering angle in the run, signed (positive left). */
  maxSteerDeg: number
}

export interface DriveFootprintCheck {
  /** Swept body and load area outside the footprint, m². */
  bodyOutsideM2: number
  /** Area the wheels sweep outside the footprint, m². */
  wheelOutsideM2: number
  /**
   * How far the worst wheel point is beyond the footprint less the clearance (every edge moved in
   * by it); 0 when the wheels fit.
   */
  wheelShortfallM: number
  /** How far the body or load passes beyond the footprint edge; reported, not required to fit. */
  bodyBeyondM: number
  wheelsFit: boolean
}

export interface DriveResult {
  lengthM: number
  steerPath: XY[]
  positions: DrivePosition[]
  /** Largest steering angle the path demands, signed (positive left), and where. */
  maxSteer: { degrees: number; s: number }
  lockExceeded: boolean | null
  /** Stretches of the path that need more than the lock. */
  lockRuns: LockRun[]
  maxOfftrackingM: number
  offtrackingS: number
  maxArticulationDeg: number
  /** Swept body and load area: its outer boundary and any unswept islands as holes. */
  swept: MultiPolygon
  sweptAreaM2: number
  /** Swept area of the axles between their wheel extents. */
  wheels: MultiPolygon
  wheelAreaM2: number
  traces: { label: string; points: XY[] }[]
  footprint: DriveFootprintCheck | null
  minSteerRadiusM: number | null
  warnings: string[]
}

export type DriveProgress = { phase: 'track' | 'union' | 'footprint'; done: number; total: number }

function validateDrive(input: DriveInput) {
  if (input.clearanceM !== undefined) {
    const [lo, hi] = DRIVE_LIMITS.clearanceM
    if (!Number.isFinite(input.clearanceM) || input.clearanceM < lo || input.clearanceM > hi)
      throw Error(`Wheel clearance must be ${lo}–${hi} m.`)
  }
  if (input.startBearingDeg !== undefined && input.startBearingDeg !== null) {
    const [lo, hi] = DRIVE_LIMITS.startBearingDeg
    if (!Number.isFinite(input.startBearingDeg) || input.startBearingDeg < lo || input.startBearingDeg > hi)
      throw Error(`The starting bearing must be ${lo}–${hi}°.`)
  }
  if ((input.traces?.length ?? 0) > DRIVE_LIMITS.traces) throw Error(`Trace at most ${DRIVE_LIMITS.traces} points.`)
  for (const t of input.traces ?? []) validateTracePoint(input.vehicle, t)
}

/** The drive as a generator for `runCooperatively`: tracking, then the swept-area union, then the footprint check. */
export function* driveSteps(input: DriveInput): Generator<DriveProgress, DriveResult> {
  validateDrive(input)
  const { vehicle } = input
  const { samples, lengthM } = filletPath(input.path, input.filletRadiusM)
  if (lengthM < DRIVE_LIMITS.pathLengthM[0]) throw Error('The path is shorter than 1 m.')
  if (lengthM > DRIVE_LIMITS.pathLengthM[1])
    throw Error(`The path is ${lengthM.toFixed(0)} m long; drive at most ${DRIVE_LIMITS.pathLengthM[1]} m at a time.`)
  const warnings: string[] = []
  const length = vehicleLength(vehicle)
  if (lengthM < length)
    warnings.push(
      `The path (${lengthM.toFixed(1)} m) is shorter than the vehicle (${length.toFixed(1)} m): the rear units have not finished the manoeuvre.`,
    )
  const bearing = input.startBearingDeg
  const startAxis: XY | undefined =
    bearing === undefined || bearing === null ? undefined : [Math.sin(bearing * RAD), Math.cos(bearing * RAD)]
  // Offtracking is measured against the path extended back along the starting heading, where the
  // trailing units sit before the steer axle has moved.
  const back: XY =
    startAxis ??
    (() => {
      const d = sub([samples[1].x, samples[1].y], [samples[0].x, samples[0].y])
      return [d[0] / (norm(d) || 1), d[1] / (norm(d) || 1)] as XY
    })()
  const extensionSteps = Math.ceil((length + vehicle.widthM) / DRIVE_STEP_M)
  const reference: Sample[] = []
  for (let j = extensionSteps; j > 0; j--)
    reference.push({
      s: -j * DRIVE_STEP_M,
      x: samples[0].x - back[0] * j * DRIVE_STEP_M,
      y: samples[0].y - back[1] * j * DRIVE_STEP_M,
    })
  reference.push(...samples)
  const behind = Math.ceil((length + vehicle.widthM + 10) / DRIVE_STEP_M),
    ahead = Math.ceil((vehicle.units[0].frontOverhangM + vehicle.widthM + 10) / DRIVE_STEP_M)

  const recordEvery = Math.max(1, Math.round(DRIVE_RECORD_M / DRIVE_STEP_M))
  const n = samples.length
  const lock = vehicle.steeringLockDeg
  const positions: DrivePosition[] = []
  const traces = (input.traces ?? []).map((t) => ({ label: t.label, points: [] as XY[] }))
  const outlines: VehicleOutline[] = []
  const lockRuns: LockRun[] = []
  let run: LockRun | null = null
  let maxSteer = { degrees: 0, s: 0 },
    maxOfftracking = 0,
    offtrackingS = 0,
    maxArticulation = 0
  for (const pose of trackVehicleSteps(n, (k) => samples[k], vehicle, 'tractrix', startAxis ? { startAxis } : {})) {
    const s = samples[pose.k].s
    // The steering angle is undefined at the last position (no next point to take a tangent from).
    if (pose.k < n - 1) {
      if (Math.abs(pose.steerSignedDegrees) > Math.abs(maxSteer.degrees))
        maxSteer = { degrees: pose.steerSignedDegrees, s }
      const beyond = lock !== undefined && pose.steerDegrees > lock + STEERING_LOCK_TOLERANCE_DEG
      if (!beyond) run = null
      else if (!run) lockRuns.push((run = { startS: s, endS: s, maxSteerDeg: pose.steerSignedDegrees }))
      else {
        run.endS = s
        if (Math.abs(pose.steerSignedDegrees) > Math.abs(run.maxSteerDeg)) run.maxSteerDeg = pose.steerSignedDegrees
      }
    }
    const tail = pose.rears.at(-1)!
    const index = pose.k + extensionSteps
    const hit = locate(reference, tail[0], tail[1], index - behind, index + ahead)
    if (Math.abs(hit.offset) > maxOfftracking) {
      maxOfftracking = Math.abs(hit.offset)
      offtrackingS = s
    }
    const articulation = articulationDegrees(pose)
    for (const a of articulation) maxArticulation = Math.max(maxArticulation, Math.abs(a))
    ;(input.traces ?? []).forEach((t, i) => traces[i].points.push(tracePosition(pose, vehicle, t)))
    outlines.push(vehicleOutline(pose, vehicle))
    if (pose.k % recordEvery === 0 || pose.k === n - 1) positions.push({ s, pose: clonePose(pose), articulation })
    if (pose.k % 400 === 399) yield { phase: 'track', done: pose.k, total: n }
  }
  yield { phase: 'track', done: n, total: n }

  // Swept pieces: the hull of each outline at consecutive steps, and the same for each axle
  // between its wheel extents. On the inside of a turn a hull spans the slight concavity between the
  // two positions of a side, so the area is over-stated by about a centimetre or two in tight turns.
  const bodyPieces: Polygon[] = [],
    wheelPieces: Polygon[] = []
  const add = (list: Polygon[], ring: Ring) => {
    if (ring.length > 3 && Math.abs(ringArea(ring)) > 1e-6) list.push([snap(ring)])
  }
  for (let i = 0; i < outlines.length; i++) {
    const outline = outlines[i],
      previous = outlines[i - 1]
    const rings = [...outline.bodies, ...outline.loads].map((b) => b.ring.slice(0, -1))
    if (!previous) {
      for (const ring of rings) add(bodyPieces, hull(ring))
      continue
    }
    const before = [...previous.bodies, ...previous.loads].map((b) => b.ring.slice(0, -1))
    rings.forEach((ring, j) => add(bodyPieces, hull([...ring, ...before[j]])))
    outline.axles.forEach((axle, j) => add(wheelPieces, hull([...axle, ...previous.axles[j]])))
    if (i % 400 === 399) yield { phase: 'union', done: 0, total: 1 }
  }
  const skipped = { count: 0 }
  const swept = yield* unionInBatches(bodyPieces, skipped)
  const wheels = yield* unionInBatches(wheelPieces, skipped)
  if (skipped.count)
    warnings.push(
      `${skipped.count} of ${bodyPieces.length + wheelPieces.length} swept pieces could not be joined and are left out of the swept area.`,
    )

  let footprint: DriveFootprintCheck | null = null
  if (input.footprint?.length) {
    const area = unionAll(input.footprint.map((polygon) => [polygon.map((ring) => snap(ring))]))
    const clearance = input.clearanceM ?? 0
    const outsideArea = (shape: MultiPolygon) => multiPolygonArea(difference(shape, area))
    let wheelWorst = -Infinity,
      bodyWorst = -Infinity
    const wheelPoints = boundaryPoints(wheels),
      bodyPoints = boundaryPoints(swept)
    for (let i = 0; i < wheelPoints.length; i++) {
      wheelWorst = Math.max(wheelWorst, signedDistance(area, wheelPoints[i]) + clearance)
      if (i % 2000 === 1999) yield { phase: 'footprint', done: i, total: wheelPoints.length + bodyPoints.length }
    }
    for (let i = 0; i < bodyPoints.length; i++) {
      bodyWorst = Math.max(bodyWorst, signedDistance(area, bodyPoints[i]))
      if (i % 2000 === 1999)
        yield { phase: 'footprint', done: wheelPoints.length + i, total: wheelPoints.length + bodyPoints.length }
    }
    footprint = {
      bodyOutsideM2: round3(Math.max(0, outsideArea(swept))),
      wheelOutsideM2: round3(Math.max(0, outsideArea(wheels))),
      wheelShortfallM: round3(Math.max(0, wheelWorst)),
      bodyBeyondM: round3(Math.max(0, bodyWorst)),
      wheelsFit: wheelWorst <= 1e-3,
    }
  }
  if (maxArticulation > 80)
    warnings.push('Articulation exceeds 80°; check the vehicle can make the manoeuvre without jackknifing.')
  return {
    lengthM: round3(lengthM),
    steerPath: samples.map((p) => [p.x, p.y]),
    positions,
    maxSteer: { degrees: round3(maxSteer.degrees), s: round3(maxSteer.s) },
    lockExceeded: lock === undefined ? null : lockRuns.length > 0,
    lockRuns: lockRuns.map((r) => ({
      startS: round3(r.startS),
      endS: round3(r.endS),
      maxSteerDeg: round3(r.maxSteerDeg),
    })),
    maxOfftrackingM: round3(maxOfftracking),
    offtrackingS: round3(offtrackingS),
    maxArticulationDeg: round3(maxArticulation),
    swept,
    sweptAreaM2: round3(multiPolygonArea(swept)),
    wheels,
    wheelAreaM2: round3(multiPolygonArea(wheels)),
    traces,
    footprint,
    minSteerRadiusM: minimumSteerRadius(vehicle),
    warnings,
  }
}

const round3 = (value: number) => Math.round(value * 1000) / 1000

/** The steer-axle fillet a path starts with: the vehicle's steady minimum at its lock rounded up to 0.5 m, or 15 m without a lock. */
export const defaultFilletRadius = (vehicle: DesignVehicle) => {
  const minimum = minimumSteerRadius(vehicle)
  return minimum === null ? 15 : Math.ceil(minimum * 2) / 2
}

/** The kept position nearest a steer-path distance. */
export function positionAt(result: Pick<DriveResult, 'positions'>, s: number): DrivePosition | null {
  let best: DrivePosition | null = null
  for (const p of result.positions) if (!best || Math.abs(p.s - s) < Math.abs(best.s - s)) best = p
  return best
}
