/**
 * Swept path of a design vehicle turning between two roads at a junction: from the road it is on
 * into a branch road ("in"), or out of the branch onto the other road ("out"), turning left or
 * right. Pure: no DOM, no terrain, no network.
 *
 * The junction is modelled in a local metric frame centred on the junction point. Each road leaving
 * the junction is an arm: a straight strip along the road's direction near the junction, with its
 * own left and right formation half-widths. The steer-axle centre runs in along one arm's
 * centreline, around a circular arc tangent to both centrelines, and out along the other's. The
 * formation is the union of the arm strips, a disc at the junction point and a circular flare in
 * each corner between neighbouring arms.
 */
import { centrelineSamples, distance, effectiveWidths } from './engine'
import type { Alignment, ContextFeature, Coordinate, DesignVehicle } from './types'
import {
  bodyPoints,
  locate,
  minimumSteerRadius,
  STEERING_LOCK_TOLERANCE_DEG,
  trackVehicle,
  vehicleLength,
  wheelPoints,
  type Sample,
  type XY,
} from './vehicleKinematics'

export const JUNCTION_TURN_BASIS =
  'Low-speed kinematic tracking with no tyre slip: the steer-axle centre follows the centreline in, a circular ' +
  'arc of the entered radius tangent to both centrelines, and the centreline out, as on a single-lane road. ' +
  'Each axle group trails its hitch by the exact no-slip step. Roads are straight near the junction, along ' +
  'their direction over the first 15 m. The formation is both roads’ strips plus a circular flare in each ' +
  'corner. Log and load swing is included only where a load is entered on the vehicle. Excludes tandem scrub, ' +
  'speed, grade, reversing, mirrors, and drivers using the full width of a wider road.'

export const JUNCTION_LIMITS = {
  steerRadiusM: [3, 200] as const,
  flareRadiusM: [0, 100] as const,
  halfWidthM: [0.5, 30] as const,
  clearanceM: [0, 5] as const,
  leadM: [5, 300] as const,
}
/** Steer-path step. */
export const JUNCTION_STEP_M = 0.25
/** A road end within this distance of another road is taken to meet it. */
export const JUNCTION_SNAP_M = 5
/** An arm's direction is taken from the road's line this far from the junction. */
export const JUNCTION_TANGENT_REACH_M = 15
/** Junctions listed per road; further ones are left out and counted. */
export const MAX_JUNCTIONS = 12
/** Corners between arms narrower than this are not flared; wider ones (nearly straight) need no flare. */
export const MIN_FLARED_CORNER_DEG = 5
export const MAX_FLARED_CORNER_DEG = 170
/** The flare search reports the smallest fitting radius in steps of this. */
export const FLARE_SEARCH_STEP_M = 0.5
/** A turn sharper than this is a reversing manoeuvre, which the model does not cover. */
export const MAX_TURN_DEG = 175

const RAD = Math.PI / 180
const BIN_M = 0.5
const RECORD_EVERY = 2

/** One road leaving the junction point, looking outward from it. */
export interface JunctionArm {
  id: string
  label: string
  roadId: string
  /** Unit vector pointing away from the junction, local east/north metres. */
  direction: XY
  /** Formation half-widths looking outward along the arm. */
  leftHalfWidthM: number
  rightHalfWidthM: number
  /** Road length along this arm from the junction; limits the room for the turn's tangent. */
  lengthM: number
  /** True when the widths were not known and the entered host width was used. */
  widthAssumed?: boolean
}

export interface JunctionLayout {
  arms: JunctionArm[]
  /** Radius of the flare rounding each corner between neighbouring arms' formation edges; 0 is a sharp corner. */
  flareRadiusM: number
}

export interface JunctionTurnOptions {
  vehicle: DesignVehicle
  /** Radius of the steer-axle path through the turn. */
  steerRadiusM: number
  /** Wheel clearance kept inside the formation edge. */
  clearanceM: number
  /** Straight run on each side of the turn; defaults to twice the vehicle length, at least 30 m. */
  leadM?: number
}

export interface JunctionTurn {
  from: string
  to: string
  side: 'left' | 'right' | 'straight'
  /** Signed change of heading, positive left. */
  deflectionDegrees: number
  steerRadiusM: number
  /** Tangent length R·tan(Δ/2) the arc takes from each arm. */
  tangentM: number
  /** Largest distance from the steer path to the last axle group. */
  maxOfftrackingM: number
  maxSteerDegrees: number
  maxArticulationDegrees: number
  /** Steady minimum steer-axle radius at the vehicle's lock; null without a lock. */
  minSteerRadiusM: number | null
  lockExceeded: boolean | null
  /**
   * How far the worst wheel point is beyond the formation less the clearance (each edge moved in by
   * the clearance, each corner rounded by it); 0 when the wheels fit.
   */
  wheelShortfallM: number
  /** How far the body or load passes beyond the formation edge; reported, not required to fit. */
  bodyBeyondM: number
  fits: boolean
  /**
   * Smallest corner flare radius, in `FLARE_SEARCH_STEP_M` steps, at which the wheels fit; 0 when they
   * fit without a flare, null when no flare up to the limit makes them fit (the wheels leave an
   * edge a flare does not widen).
   */
  requiredFlareRadiusM: number | null
  /**
   * How far that flare cuts back the turn's inside corner, from the corner of the two formation
   * edges to the middle of the flare's arc: R·(1/sin(α/2) − 1) for a corner of α. Flare radii are
   * not comparable across corner angles (an obtuse corner needs a large radius to gain little), so
   * this is the figure to compare. Null when `requiredFlareRadiusM` is.
   */
  requiredFlareSetbackM: number | null
  steerPath: XY[]
  /** Closed rings, local metres. */
  wheelEnvelope: XY[]
  bodyEnvelope: XY[]
  /** Runs of the wheel envelope outside the formation less the clearance. */
  deficits: XY[][]
}

export type JunctionTurnOutcome = JunctionTurn | { from: string; to: string; error: string }

export const isJunctionError = (outcome: JunctionTurnOutcome): outcome is { from: string; to: string; error: string } =>
  'error' in outcome

const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1]
const cross = (a: XY, b: XY) => a[0] * b[1] - a[1] * b[0]
const left = (a: XY): XY => [-a[1], a[0]]
const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]]
const add = (a: XY, b: XY, k = 1): XY => [a[0] + b[0] * k, a[1] + b[1] * k]
const norm = (a: XY) => Math.hypot(a[0], a[1])

/** Where two lines p + t·a and q + u·b meet, as p + t·a; null when parallel. */
function meet(p: XY, a: XY, q: XY, b: XY): XY | null {
  const det = cross(a, b)
  if (Math.abs(det) < 1e-12) return null
  const t = cross(sub(q, p), b) / det
  return add(p, a, t)
}

interface Corner {
  centre: XY
  /** Rays from the centre to the two tangent points; the flare lies between them. */
  e1: XY
  e2: XY
  /** Distance from the centre to the edges' intersection. */
  reach: number
  radius: number
}

function validateLayout(layout: JunctionLayout) {
  if (!Array.isArray(layout.arms) || layout.arms.length < 2) throw Error('A junction needs at least two road arms.')
  const [lo, hi] = JUNCTION_LIMITS.flareRadiusM
  if (!Number.isFinite(layout.flareRadiusM) || layout.flareRadiusM < lo || layout.flareRadiusM > hi)
    throw Error(`The flare radius must be ${lo}–${hi} m.`)
  for (const arm of layout.arms) {
    const [wlo, whi] = JUNCTION_LIMITS.halfWidthM
    if (Math.abs(norm(arm.direction) - 1) > 1e-6) throw Error('A junction arm needs a unit direction.')
    for (const w of [arm.leftHalfWidthM, arm.rightHalfWidthM])
      if (!Number.isFinite(w) || w < wlo || w > whi) throw Error(`Road half-widths must be ${wlo}–${whi} m.`)
    if (!(arm.lengthM > 0)) throw Error('A junction arm needs a positive length.')
  }
}

/** Flares in every corner between neighbouring arms, going anticlockwise. */
function corners(arms: JunctionArm[], radius: number): Corner[] {
  if (radius <= 0) return []
  const sorted = [...arms].sort(
    (a, b) => Math.atan2(a.direction[1], a.direction[0]) - Math.atan2(b.direction[1], b.direction[0]),
  )
  const result: Corner[] = []
  sorted.forEach((a, i) => {
    const b = sorted[(i + 1) % sorted.length]
    let gap = Math.atan2(cross(a.direction, b.direction), dot(a.direction, b.direction)) / RAD
    if (gap <= 0) gap += 360
    if (gap < MIN_FLARED_CORNER_DEG || gap > MAX_FLARED_CORNER_DEG) return
    // a's left edge and b's right edge face this corner.
    const na = left(a.direction),
      nb = left(b.direction)
    const edgeA: XY = [na[0] * a.leftHalfWidthM, na[1] * a.leftHalfWidthM]
    const edgeB: XY = [-nb[0] * b.rightHalfWidthM, -nb[1] * b.rightHalfWidthM]
    const q = meet(edgeA, a.direction, edgeB, b.direction)
    const centre = meet(add(edgeA, na, radius), a.direction, add(edgeB, nb, -radius), b.direction)
    if (!q || !centre) return
    const t1 = add(centre, na, -radius),
      t2 = add(centre, nb, radius)
    result.push({ centre, e1: sub(t1, centre), e2: sub(t2, centre), reach: norm(sub(q, centre)), radius })
  })
  return result
}

/**
 * How far a point is outside the formation: positive outside, negative inside (the depth inside the
 * piece of formation that holds it best). Conservative where pieces overlap.
 */
function excess(arms: JunctionArm[], flares: Corner[], disc: number, p: XY): number {
  let best = norm(p) - disc
  for (const arm of arms) {
    const t = dot(p, arm.direction)
    if (t < 0) continue
    const l = dot(p, left(arm.direction))
    best = Math.min(best, l >= 0 ? l - arm.leftHalfWidthM : -l - arm.rightHalfWidthM)
  }
  for (const c of flares) {
    const v = sub(p, c.centre)
    const span = cross(c.e1, c.e2)
    if (Math.abs(span) < 1e-12) continue
    const alpha = cross(v, c.e2) / span,
      beta = cross(c.e1, v) / span
    const r = norm(v)
    if (alpha >= 0 && beta >= 0 && r <= c.reach) best = Math.min(best, c.radius - r)
  }
  return best
}

/** The steer-axle path for a turn from one arm into another, sampled at `JUNCTION_STEP_M`. */
export function junctionSteerPath(
  from: JunctionArm,
  to: JunctionArm,
  radiusM: number,
  leadM: number,
): { samples: Sample[]; deflectionDegrees: number; tangentM: number } | { error: string } {
  const u: XY = [-from.direction[0], -from.direction[1]]
  const v = to.direction
  const deflection = Math.atan2(cross(u, v), dot(u, v))
  const deflectionDegrees = deflection / RAD
  if (Math.abs(deflectionDegrees) > MAX_TURN_DEG)
    return {
      error: `This is a ${Math.abs(deflectionDegrees).toFixed(0)}° turn back on itself: it needs reversing, which is not modelled.`,
    }
  const sweep = Math.abs(deflection)
  const tangentM = sweep < 1e-3 ? 0 : radiusM * Math.tan(sweep / 2)
  for (const arm of [from, to])
    if (tangentM > arm.lengthM)
      return {
        error: `Not enough road for an R${radiusM} turn: it needs ${tangentM.toFixed(1)} m of ${arm.label} from the junction, which has ${arm.lengthM.toFixed(1)} m.`,
      }
  const points: XY[] = []
  const line = (a: XY, b: XY) => {
    const length = norm(sub(b, a))
    const n = Math.max(1, Math.round(length / JUNCTION_STEP_M))
    for (let i = points.length ? 1 : 0; i <= n; i++) points.push(add(a, sub(b, a), i / n))
  }
  const start = add([0, 0], from.direction, tangentM + leadM)
  const enter = add([0, 0], from.direction, tangentM)
  const leave = add([0, 0], to.direction, tangentM)
  line(start, enter)
  if (tangentM > 0) {
    const sign = Math.sign(deflection)
    const centre = add(enter, sign > 0 ? left(u) : [-left(u)[0], -left(u)[1]], radiusM)
    const r0 = sub(enter, centre)
    const n = Math.max(1, Math.round((radiusM * sweep) / JUNCTION_STEP_M))
    for (let i = 1; i <= n; i++) {
      const a = (sign * sweep * i) / n
      points.push(add(centre, [r0[0] * Math.cos(a) - r0[1] * Math.sin(a), r0[0] * Math.sin(a) + r0[1] * Math.cos(a)]))
    }
  }
  line(points.at(-1) ?? leave, add([0, 0], to.direction, tangentM + leadM))
  let s = 0
  const samples = points.map((p, i) => {
    if (i) s += norm(sub(p, points[i - 1]))
    return { s, x: p[0], y: p[1] }
  })
  return { samples, deflectionDegrees, tangentM }
}

function validateOptions(options: JunctionTurnOptions) {
  const check = (value: number, [lo, hi]: readonly [number, number], label: string) => {
    if (!Number.isFinite(value) || value < lo || value > hi) throw Error(`${label} must be ${lo}–${hi} m.`)
  }
  check(options.steerRadiusM, JUNCTION_LIMITS.steerRadiusM, 'The turn radius')
  check(options.clearanceM, JUNCTION_LIMITS.clearanceM, 'The wheel clearance')
  if (options.leadM !== undefined) check(options.leadM, JUNCTION_LIMITS.leadM, 'The straight run')
}

/** Tracks the vehicle from arm `fromId` into arm `toId` and compares its wheels with the formation. */
export function analyzeJunctionTurn(
  layout: JunctionLayout,
  fromId: string,
  toId: string,
  options: JunctionTurnOptions,
): JunctionTurnOutcome {
  validateLayout(layout)
  validateOptions(options)
  const from = layout.arms.find((a) => a.id === fromId),
    to = layout.arms.find((a) => a.id === toId)
  if (!from || !to) throw Error('Choose two arms of this junction.')
  if (from === to) return { from: fromId, to: toId, error: 'A turn needs two different roads.' }
  const { vehicle } = options
  const length = vehicleLength(vehicle)
  const leadM = options.leadM ?? Math.max(30, 2 * length)
  const path = junctionSteerPath(from, to, options.steerRadiusM, leadM)
  if ('error' in path) return { from: fromId, to: toId, error: path.error }
  const { samples } = path
  const n = samples.length
  const bins = Math.max(1, Math.ceil(samples[n - 1].s / BIN_M) + 1)
  const wheelL = new Float64Array(bins).fill(-Infinity),
    wheelR = new Float64Array(bins).fill(-Infinity),
    bodyL = new Float64Array(bins).fill(-Infinity),
    bodyR = new Float64Array(bins).fill(-Infinity)
  const wheels: XY[] = [],
    bodies: XY[] = []
  let offtracking = 0,
    steer = 0,
    articulation = 0
  const back = Math.ceil((length + vehicle.widthM + 10) / JUNCTION_STEP_M),
    ahead = Math.ceil((vehicle.units[0].frontOverhangM + vehicle.widthM + 10) / JUNCTION_STEP_M)
  const binOf = (s: number) => Math.min(bins - 1, Math.max(0, Math.floor(s / BIN_M)))
  trackVehicle(
    n,
    (k) => samples[k],
    vehicle,
    'tractrix',
    (pose) => {
      steer = Math.max(steer, pose.steerDegrees)
      for (let i = 1; i < pose.axes.length; i++) {
        const a = pose.axes[i - 1],
          b = pose.axes[i]
        articulation = Math.max(articulation, Math.abs(Math.atan2(cross(a, b), dot(a, b))) / RAD)
      }
      const tail = pose.rears.at(-1)!
      const tailHit = locate(samples, tail[0], tail[1], pose.k - back, pose.k + ahead)
      offtracking = Math.max(offtracking, Math.abs(tailHit.offset))
      if (pose.k % RECORD_EVERY && pose.k !== n - 1) return
      const keep = (points: XY[], all: XY[], l: Float64Array, r: Float64Array) => {
        for (const p of points) {
          all.push(p)
          const hit = locate(samples, p[0], p[1], pose.k - back, pose.k + ahead)
          const b = binOf(hit.s)
          if (hit.offset > l[b]) l[b] = hit.offset
          if (-hit.offset > r[b]) r[b] = -hit.offset
        }
      }
      keep(wheelPoints(pose, vehicle), wheels, wheelL, wheelR)
      keep(bodyPoints(pose, vehicle), bodies, bodyL, bodyR)
    },
  )
  // The formation less the clearance: every edge moved in by it. The flares' centres stay put and
  // their radii grow by it, so a sharp corner becomes a round of the clearance's radius.
  const shrunk = (flare: number, clearance: number) => {
    const arms = layout.arms.map((a) => ({
      ...a,
      leftHalfWidthM: a.leftHalfWidthM - clearance,
      rightHalfWidthM: a.rightHalfWidthM - clearance,
    }))
    const flares = corners(arms, flare + clearance)
    const disc = Math.min(...arms.flatMap((a) => [a.leftHalfWidthM, a.rightHalfWidthM]))
    return (p: XY) => excess(arms, flares, disc, p)
  }
  const worst = (points: XY[], flare: number, clearance: number) => {
    const outside = shrunk(flare, clearance)
    let value = -Infinity
    for (const p of points) value = Math.max(value, outside(p))
    return value
  }
  const fitsWith = (flare: number) => worst(wheels, flare, options.clearanceM) <= 1e-3
  const wheelWorst = worst(wheels, layout.flareRadiusM, options.clearanceM)
  const fits = wheelWorst <= 1e-3
  let requiredFlareRadiusM: number | null
  const maxSteps = Math.floor(JUNCTION_LIMITS.flareRadiusM[1] / FLARE_SEARCH_STEP_M)
  if (fitsWith(0)) requiredFlareRadiusM = 0
  else if (!fitsWith(maxSteps * FLARE_SEARCH_STEP_M)) requiredFlareRadiusM = null
  else {
    // A larger flare only adds formation, so the fitting radii form one interval to the limit.
    let lo = 0,
      hi = maxSteps
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2)
      if (fitsWith(mid * FLARE_SEARCH_STEP_M)) hi = mid
      else lo = mid
    }
    requiredFlareRadiusM = hi * FLARE_SEARCH_STEP_M
  }

  // Envelopes: the widest offset each side of the steer path, every half metre along it.
  const pointAt = (s: number, offset: number): XY => {
    let i = 0
    while (i < n - 2 && samples[i + 1].s < s) i++
    const A = samples[i],
      B = samples[i + 1]
    const dx = B.x - A.x,
      dy = B.y - A.y,
      d = Math.hypot(dx, dy) || 1
    const t = Math.max(0, Math.min(1, (s - A.s) / (B.s - A.s || 1)))
    return [A.x + dx * t - (dy / d) * offset, A.y + dy * t + (dx / d) * offset]
  }
  const ring = (l: Float64Array, r: Float64Array) => {
    const leftSide: XY[] = [],
      rightSide: XY[] = []
    for (let b = 0; b < bins; b++) {
      if (!Number.isFinite(l[b]) || !Number.isFinite(r[b])) continue
      const s = Math.min(samples[n - 1].s, (b + 0.5) * BIN_M)
      leftSide.push(pointAt(s, l[b]))
      rightSide.push(pointAt(s, -r[b]))
    }
    const closed = [...leftSide, ...rightSide.reverse()]
    if (closed.length) closed.push(closed[0])
    return { closed, leftSide, rightSide: rightSide.reverse() }
  }
  const wheelRing = ring(wheelL, wheelR)
  const outsideClear = shrunk(layout.flareRadiusM, options.clearanceM)
  const deficits: XY[][] = []
  for (const trace of [wheelRing.leftSide, wheelRing.rightSide]) {
    let run: XY[] = []
    for (const p of trace) {
      if (outsideClear(p) > 1e-3) run.push(p)
      else {
        if (run.length) deficits.push(run)
        run = []
      }
    }
    if (run.length) deficits.push(run)
  }
  const round = (value: number) => Math.round(value * 1000) / 1000
  const deflectionDegrees = round(path.deflectionDegrees)
  const insideCorner = (Math.PI - Math.abs(path.deflectionDegrees) * RAD) / 2
  return {
    from: fromId,
    to: toId,
    side: Math.abs(deflectionDegrees) < 1 ? 'straight' : deflectionDegrees > 0 ? 'left' : 'right',
    deflectionDegrees,
    steerRadiusM: options.steerRadiusM,
    tangentM: round(path.tangentM),
    maxOfftrackingM: round(offtracking),
    maxSteerDegrees: round(steer),
    maxArticulationDegrees: round(articulation),
    minSteerRadiusM: minimumSteerRadius(vehicle),
    lockExceeded:
      vehicle.steeringLockDeg === undefined ? null : steer > vehicle.steeringLockDeg + STEERING_LOCK_TOLERANCE_DEG,
    wheelShortfallM: round(Math.max(0, wheelWorst)),
    bodyBeyondM: round(Math.max(0, worst(bodies, layout.flareRadiusM, 0))),
    fits,
    requiredFlareRadiusM,
    requiredFlareSetbackM:
      requiredFlareRadiusM === null || Math.abs(deflectionDegrees) < 1
        ? null
        : round(requiredFlareRadiusM * (1 / Math.sin(insideCorner) - 1)),
    steerPath: samples.map((p) => [p.x, p.y]),
    wheelEnvelope: wheelRing.closed,
    bodyEnvelope: ring(bodyL, bodyR).closed,
    deficits,
  }
}

/** How sharp a turn reads to a driver, from its change of heading. */
export function turnSeverity(deflectionDegrees: number): 'mild' | 'moderate' | 'sharp' | 'hairpin' {
  const d = Math.abs(deflectionDegrees)
  return d < 45 ? 'mild' : d < 90 ? 'moderate' : d < 135 ? 'sharp' : 'hairpin'
}

// ---------------------------------------------------------------------------------------------
// Junctions of a road with the other roads in the project.

/** A road line to look for junctions on. */
export interface JunctionRoad {
  id: string
  name: string
  coordinates: Coordinate[]
  /** Distance along the road at each coordinate, metres; measured from the coordinates when absent. */
  chainages?: number[]
  /** Formation half-widths at a chainage, left and right looking up-station; absent when unknown. */
  widthsAt?: (chainage: number) => { leftWidth: number; rightWidth: number }
  /** True for a design road in the project, false or absent for a mapped road. */
  design?: boolean
}

/** A design road as a junction road: its fitted centreline every 2 m and its formation widths. */
export function alignmentJunctionRoad(alignment: Alignment): JunctionRoad {
  const centre = centrelineSamples(alignment, 2)
  return {
    id: alignment.id,
    name: alignment.name,
    coordinates: centre.samples.map((p) => centre.toCoordinate(p.x, p.y)),
    chainages: centre.samples.map((p) => p.s),
    widthsAt: (chainage) => effectiveWidths(alignment, chainage),
    design: true,
  }
}

/** A mapped existing road from the context layers, whose formation width is not known. */
export function contextJunctionRoad(feature: ContextFeature): JunctionRoad | null {
  if (feature.kind !== 'existing-road' || feature.geometry.type !== 'LineString') return null
  const coordinates = feature.geometry.coordinates
    .filter((c) => Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map((c) => [c[0], c[1]] as Coordinate)
  return coordinates.length > 1 ? { id: feature.id, name: feature.name, coordinates } : null
}

export interface RoadJunction {
  id: string
  coordinate: Coordinate
  /** Station on the checked road nearest the junction. */
  chainage: number
  otherRoadId: string
  otherRoadName: string
  /** Which road ends at the junction and so is the branch: turning into it is "in", out of it "out". */
  branchRoadId: string
  arms: JunctionArm[]
  movements: { from: string; to: string; kind: 'in' | 'out' }[]
  /** True when the other road's width was not known and the entered width was used. */
  widthAssumed: boolean
  toLocal: (c: Coordinate) => XY
  fromLocal: (p: XY) => Coordinate
}

const M_PER_DEG = 111195.0802335329

function localFrame(origin: Coordinate) {
  const kx = M_PER_DEG * Math.cos(origin[1] * RAD),
    ky = M_PER_DEG
  return {
    toLocal: (c: Coordinate): XY => [(c[0] - origin[0]) * kx, (c[1] - origin[1]) * ky],
    fromLocal: (p: XY): Coordinate => [origin[0] + p[0] / kx, origin[1] + p[1] / ky],
  }
}

interface MeasuredRoad extends JunctionRoad {
  along: number[]
  length: number
}

function measure(road: JunctionRoad): MeasuredRoad {
  const along =
    road.chainages && road.chainages.length === road.coordinates.length
      ? road.chainages
      : road.coordinates.reduce<number[]>(
          (acc, c, i) => [...acc, i ? acc[i - 1] + distance(road.coordinates[i - 1], c) : 0],
          [],
        )
  return { ...road, along, length: along.at(-1) ?? 0 }
}

/** Nearest point of a road to a coordinate, with its distance along the road. */
function nearestOn(road: MeasuredRoad, p: Coordinate) {
  const { toLocal } = localFrame(p)
  let best = { distanceM: Infinity, along: 0, coordinate: p }
  for (let i = 1; i < road.coordinates.length; i++) {
    const a = toLocal(road.coordinates[i - 1]),
      b = toLocal(road.coordinates[i])
    const d = sub(b, a),
      len2 = dot(d, d)
    const t = len2 ? Math.max(0, Math.min(1, -dot(a, d) / len2)) : 0
    const q = add(a, d, t)
    const dist = norm(q)
    if (dist < best.distanceM) {
      const c0 = road.coordinates[i - 1],
        c1 = road.coordinates[i]
      best = {
        distanceM: dist,
        along: road.along[i - 1] + (road.along[i] - road.along[i - 1]) * t,
        coordinate: [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t],
      }
    }
  }
  return best
}

function coordinateAt(road: MeasuredRoad, along: number): Coordinate {
  const x = Math.max(0, Math.min(road.length, along))
  let i = 1
  while (i < road.along.length - 1 && road.along[i] < x) i++
  const a = road.along[i - 1],
    b = road.along[i]
  const t = b > a ? (x - a) / (b - a) : 0
  const c0 = road.coordinates[i - 1],
    c1 = road.coordinates[i]
  return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t]
}

/** The arms a road makes at a junction: toward its start and toward its end, where it has length. */
function armsOf(
  road: MeasuredRoad,
  along: number,
  toLocal: (c: Coordinate) => XY,
  assumedHalfWidthM: number,
  checked: boolean,
): JunctionArm[] {
  const widths = road.widthsAt?.(Math.max(0, Math.min(road.length, along)))
  const clampWidth = (w: number) => Math.max(JUNCTION_LIMITS.halfWidthM[0], Math.min(JUNCTION_LIMITS.halfWidthM[1], w))
  const arms: JunctionArm[] = []
  const name = checked ? road.name : road.name || 'Other road'
  const both = along > 1 && road.length - along > 1
  for (const [end, length, target] of [
    ['start', along, along - JUNCTION_TANGENT_REACH_M],
    ['end', road.length - along, along + JUNCTION_TANGENT_REACH_M],
  ] as const) {
    if (length <= 1) continue
    const tip = toLocal(coordinateAt(road, target))
    const d = norm(tip)
    if (d < 0.5) continue
    // Looking outward toward the road's end, its left is the road's left; toward its start, its right.
    const l = widths ? (end === 'end' ? widths.leftWidth : widths.rightWidth) : assumedHalfWidthM
    const r = widths ? (end === 'end' ? widths.rightWidth : widths.leftWidth) : assumedHalfWidthM
    arms.push({
      id: `${road.id}:${end}`,
      label: both ? `${name} toward its ${end}` : name,
      roadId: road.id,
      direction: [tip[0] / d, tip[1] / d],
      leftHalfWidthM: clampWidth(l),
      rightHalfWidthM: clampWidth(r),
      lengthM: length,
      ...(widths ? {} : { widthAssumed: true }),
    })
  }
  return arms
}

/**
 * Junctions of `road` with the other roads: where one of its ends lies within `JUNCTION_SNAP_M` of
 * another road, or another road's end lies on it. Crossings with no road ending there are not
 * junctions here. Roads of unknown width take `assumedHalfWidthM` each side.
 *
 * Two design roads that both start at the same point are alternatives drawn from one start (a
 * route comparison or a contour variant), not a junction a truck turns through, so they are counted
 * in `alternatives` and left out. A mapped road meeting the start is still a junction.
 */
export function findRoadJunctions(
  road: JunctionRoad,
  others: JunctionRoad[],
  assumedHalfWidthM: number,
): { junctions: RoadJunction[]; leftOut: number; alternatives: number } {
  const active = measure(road)
  if (active.coordinates.length < 2 || active.length < 2) return { junctions: [], leftOut: 0, alternatives: 0 }
  const found: RoadJunction[] = []
  let alternatives = 0
  const ends = (r: MeasuredRoad) => [r.coordinates[0], r.coordinates.at(-1)!]
  for (const raw of others) {
    if (raw.id === road.id || raw.coordinates.length < 2) continue
    const other = measure(raw)
    if (other.length < 2) continue
    if (road.design && raw.design && distance(active.coordinates[0], other.coordinates[0]) <= JUNCTION_SNAP_M) {
      alternatives++
      continue
    }
    const candidates: { coordinate: Coordinate; activeAlong: number; otherAlong: number; branch: string }[] = []
    for (const end of ends(active)) {
      const hit = nearestOn(other, end)
      if (hit.distanceM <= JUNCTION_SNAP_M) {
        const own = nearestOn(active, end)
        candidates.push({
          coordinate: hit.coordinate,
          activeAlong: own.along,
          otherAlong: hit.along,
          branch: active.id,
        })
      }
    }
    for (const end of ends(other)) {
      const hit = nearestOn(active, end)
      if (hit.distanceM <= JUNCTION_SNAP_M) {
        const own = nearestOn(other, end)
        // An end meeting an end is found from both roads; keep the first.
        if (candidates.some((c) => distance(c.coordinate, hit.coordinate) < 2 * JUNCTION_SNAP_M)) continue
        candidates.push({ coordinate: hit.coordinate, activeAlong: hit.along, otherAlong: own.along, branch: other.id })
      }
    }
    for (const c of candidates) {
      const { toLocal, fromLocal } = localFrame(c.coordinate)
      const activeArms = armsOf(active, c.activeAlong, toLocal, assumedHalfWidthM, true)
      const otherArms = armsOf(other, c.otherAlong, toLocal, assumedHalfWidthM, false)
      if (!activeArms.length || !otherArms.length) continue
      const branchArms = c.branch === active.id ? activeArms : otherArms
      const mainArms = c.branch === active.id ? otherArms : activeArms
      // A branch road that runs on past the junction is a crossing; only its ends make a branch.
      const movements = [
        ...mainArms.flatMap((m) => branchArms.map((b) => ({ from: m.id, to: b.id, kind: 'in' as const }))),
        ...branchArms.flatMap((b) => mainArms.map((m) => ({ from: b.id, to: m.id, kind: 'out' as const }))),
      ]
      found.push({
        id: `${other.id}@${Math.round(c.activeAlong)}`,
        coordinate: c.coordinate,
        chainage: c.activeAlong,
        otherRoadId: other.id,
        otherRoadName: other.name,
        branchRoadId: c.branch,
        arms: [...activeArms, ...otherArms],
        movements,
        widthAssumed: [...activeArms, ...otherArms].some((a) => a.widthAssumed),
        toLocal,
        fromLocal,
      })
    }
  }
  found.sort((a, b) => a.chainage - b.chainage || a.otherRoadId.localeCompare(b.otherRoadId))
  return {
    junctions: found.slice(0, MAX_JUNCTIONS),
    leftOut: Math.max(0, found.length - MAX_JUNCTIONS),
    alternatives,
  }
}

/** Plan lines for one junction turn, in the swept-path roles the plan already draws. */
export function junctionTurnOverlay(junction: RoadJunction, turn: JunctionTurn): GeoJSON.FeatureCollection {
  const line = (points: XY[], properties: GeoJSON.GeoJsonProperties): GeoJSON.Feature[] =>
    points.length > 1
      ? [
          {
            type: 'Feature',
            geometry: { type: 'LineString', coordinates: points.map((p) => junction.fromLocal(p)) },
            properties,
          },
        ]
      : []
  return {
    type: 'FeatureCollection',
    features: [
      ...line(turn.bodyEnvelope, { role: 'swept-body', color: '#7c3aed', label: 'Junction turn: body and load' }),
      ...line(turn.wheelEnvelope, { role: 'swept-wheels', color: '#ea580c', label: 'Junction turn: wheel paths' }),
      ...turn.deficits.flatMap((run) =>
        line(run, { role: 'swept-deficit', color: '#dc2626', selected: true, label: 'Wheels outside formation' }),
      ),
    ],
  }
}

/** The road's swept-path plan lines plus a junction turn's, keeping the road's object when there is none. */
export function withJunctionOverlay(
  swept: GeoJSON.FeatureCollection | undefined,
  junction: GeoJSON.FeatureCollection | null,
): GeoJSON.FeatureCollection | undefined {
  if (!junction?.features.length) return swept
  return { type: 'FeatureCollection', features: [...(swept?.features ?? []), ...junction.features] }
}
