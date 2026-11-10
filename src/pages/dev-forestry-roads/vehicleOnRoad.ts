/**
 * The design vehicle at one station of the road, and traces of chosen points on it along the
 * road. Both follow the road check (`sweptPath.ts`): the steer-axle centre on the fitted
 * centreline, the vehicle starting straight at the road's start (or end, travelling
 * down-station), each axle group trailing by the follow-the-leader step. Pure: no DOM or network
 * access.
 *
 * Provenance: showing the vehicle at a position and tracing any point on it follow the functional
 * specification of QuickTurn (clean-specs/quickturn.md §3.1 "Move", "Copy" and "Trace", gaps G3,
 * G5, G13). Written from a functional specification; no code from QuickTurn (GNU GPL v2) was used.
 */
import { centrelineSamples, effectiveWidths } from './engine'
import type { Alignment, Coordinate, DesignVehicle } from './types'
import { tracePosition, type TracePoint } from './vehiclePath'
import {
  articulationDegrees,
  clonePose,
  locate,
  trackVehicleSteps,
  vehicleLength,
  vehicleOutline,
  type Sample,
  type VehicleOutline,
  type VehiclePose,
  type XY,
} from './vehicleKinematics'

/** The road check's steer step. */
export const ROAD_VEHICLE_STEP_M = 0.25
/** Trace points are kept every this many metres of steer travel. */
export const ROAD_TRACE_RECORD_M = 0.5

export interface VehicleAtStation {
  station: number
  direction: 'up' | 'down'
  pose: VehiclePose
  outline: VehicleOutline
  /** Signed, positive left. */
  steerSignedDegrees: number
  articulation: number[]
  toCoordinate: (x: number, y: number) => Coordinate
}

function orderedSamples(alignment: Alignment, direction: 'up' | 'down') {
  const centre = centrelineSamples(alignment, ROAD_VEHICLE_STEP_M)
  const samples = direction === 'up' ? centre.samples : [...centre.samples].reverse()
  return { ...centre, ordered: samples }
}

/**
 * The vehicle with its steer-axle centre exactly at `station`, having driven from the road's
 * start (`up`) or end (`down`). The station is evaluated where it is given, not snapped to a step.
 */
export function vehicleAtStation(
  alignment: Alignment,
  vehicle: DesignVehicle,
  station: number,
  direction: 'up' | 'down',
): VehicleAtStation {
  const { ordered, length, toCoordinate } = orderedSamples(alignment, direction)
  if (!Number.isFinite(station)) throw Error('Enter a station.')
  const at = Math.max(0, Math.min(length, station))
  const before = direction === 'up' ? (p: Sample) => p.s < at - 1e-9 : (p: Sample) => p.s > at + 1e-9
  const path = ordered.filter(before)
  // The exact point at the station, interpolated between its neighbours.
  const i = Math.min(ordered.length - 2, Math.max(0, path.length - 1))
  const A = ordered[i],
    B = ordered[i + 1]
  const t = Math.abs(B.s - A.s) > 1e-12 ? (at - A.s) / (B.s - A.s) : 0
  path.push({ s: at, x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t })
  const target = path.length - 1
  // Two points are the least that sets a heading; at the very start the vehicle sits on the first step.
  if (path.length < 2) path.push(ordered[1])
  let last: VehiclePose | null = null
  for (const pose of trackVehicleSteps(path.length, (k) => path[k], vehicle, 'follow'))
    if (pose.k === target) last = clonePose(pose)
  if (!last) throw Error('The road is too short to place the vehicle.')
  const pose = last
  return {
    station: at,
    direction,
    pose,
    outline: vehicleOutline(pose, vehicle),
    steerSignedDegrees: pose.steerSignedDegrees,
    articulation: articulationDegrees(pose),
    toCoordinate,
  }
}

export interface RoadTrace {
  label: string
  direction: 'up' | 'down'
  coordinates: Coordinate[]
  /** Widest offset of the point left of the centreline (negative when it never goes left), and its station. */
  leftM: number
  leftStation: number
  rightM: number
  rightStation: number
  /** How far the point passes beyond the formation edge on each side; 0 when it stays inside. */
  beyondLeftM: number
  beyondRightM: number
  /** Station where it passes furthest beyond an edge, or null when it stays inside. */
  beyondStation: number | null
}

/**
 * Traces of chosen points on the vehicle along the whole road, as a generator for
 * `runCooperatively`. Each trace's widest offset each side is compared with the formation
 * half-width at that station.
 */
export function* roadTraceSteps(
  alignment: Alignment,
  vehicle: DesignVehicle,
  direction: 'up' | 'down',
  points: readonly TracePoint[],
): Generator<{ done: number; total: number }, RoadTrace[]> {
  const { ordered, samples, length, toCoordinate } = orderedSamples(alignment, direction)
  const n = ordered.length
  const traces = points.map((p) => ({
    label: p.label,
    direction,
    xy: [] as XY[],
    leftM: -Infinity,
    leftStation: 0,
    rightM: -Infinity,
    rightStation: 0,
    beyondLeftM: 0,
    beyondRightM: 0,
    beyondStation: null as number | null,
    beyondWorst: 0,
  }))
  if (n < 3 || !points.length) return []
  const vlength = vehicleLength(vehicle)
  const back = Math.ceil((vlength + vehicle.widthM + 10) / ROAD_VEHICLE_STEP_M),
    ahead = Math.ceil((vehicle.units[0].frontOverhangM + vehicle.widthM + 10) / ROAD_VEHICLE_STEP_M)
  const recordEvery = Math.max(1, Math.round(ROAD_TRACE_RECORD_M / ROAD_VEHICLE_STEP_M))
  const widths = new Map<number, { leftWidth: number; rightWidth: number }>()
  const widthAt = (s: number) => {
    const key = Math.min(Math.floor(s), Math.floor(length))
    let w = widths.get(key)
    if (!w) widths.set(key, (w = effectiveWidths(alignment, Math.min(length, key + 0.5))))
    return w
  }
  for (const pose of trackVehicleSteps(n, (k) => ordered[k], vehicle, 'follow')) {
    if (pose.k % recordEvery && pose.k !== n - 1) continue
    // Samples are searched in station order, so the steer index is mapped back for down-station travel.
    const index = direction === 'up' ? pose.k : n - 1 - pose.k
    const [lo, hi] = direction === 'up' ? [index - back, index + ahead] : [index - ahead, index + back]
    points.forEach((point, i) => {
      const p = tracePosition(pose, vehicle, point)
      const trace = traces[i]
      trace.xy.push(p)
      const hit = locate(samples, p[0], p[1], lo, hi)
      const w = widthAt(hit.s)
      if (hit.offset > trace.leftM) {
        trace.leftM = hit.offset
        trace.leftStation = hit.s
      }
      if (-hit.offset > trace.rightM) {
        trace.rightM = -hit.offset
        trace.rightStation = hit.s
      }
      const beyondLeft = hit.offset - w.leftWidth,
        beyondRight = -hit.offset - w.rightWidth
      trace.beyondLeftM = Math.max(trace.beyondLeftM, beyondLeft)
      trace.beyondRightM = Math.max(trace.beyondRightM, beyondRight)
      const worst = Math.max(beyondLeft, beyondRight)
      if (worst > 1e-3 && worst > trace.beyondWorst) {
        trace.beyondWorst = worst
        trace.beyondStation = hit.s
      }
    })
    if (pose.k % 2000 === 0) yield { done: pose.k, total: n }
  }
  const round = (v: number) => Math.round(v * 1000) / 1000
  return traces.map((t) => ({
    label: t.label,
    direction: t.direction,
    coordinates: t.xy.map(([x, y]) => toCoordinate(x, y)),
    leftM: round(t.leftM),
    leftStation: round(t.leftStation),
    rightM: round(t.rightM),
    rightStation: round(t.rightStation),
    beyondLeftM: round(Math.max(0, t.beyondLeftM)),
    beyondRightM: round(Math.max(0, t.beyondRightM)),
    beyondStation: t.beyondStation === null ? null : round(t.beyondStation),
  }))
}
