/**
 * Stopping sight distance along a road, on its profile and on the surface the road leaves behind.
 *
 * Implements:
 * - required stopping sight distance SSD = V·t/3.6 + V² / (254.28·(f + G)) (TAC Geometric Design
 *   Guide for Canadian Roads, 2017, ch. 2; AASHTO Green Book, 7th ed., 2018, §3.2), with G the mean
 *   grade over the stopping distance, signed for the direction of travel;
 * - wet-pavement braking friction by design speed from the same TAC chapter, taking the next higher
 *   tabulated speed when a speed falls between two (the conservative side);
 * - a single-lane meeting check: two opposing vehicles must both stop, so the required distance is
 *   the sum of their stopping distances, seen to an oncoming vehicle's height (AASHTO *Guidelines for
 *   Geometric Design of Low-Volume Roads*, 2019; BC *Forest Road Engineering Guidebook*, 2002);
 * - available distance on a profile, by the line of sight from eye to target clearing every profile
 *   sample between them, kept as a running "horizon" slope so each target costs O(1);
 * - available distance on the road's own surface in 3D: sightlines across the inside of curves and
 *   over crests are tested against the designed section (formation, ditches, batters) and the ground
 *   beyond the catch points, rebuilt from the calculated stations, with an optional vegetation wall
 *   beyond the clearing edge;
 * - the horizontal sightline offset M = R·(1 − cos(S/2R)), and its continuation when the sightline is
 *   longer than the curve (AASHTO §3.3.5; TAC ch. 3).
 *
 * Distances are measured along the road (the difference in chainage), never as the straight chord
 * between eye and target. A sightline that crosses missing elevation is unknown, never clear.
 *
 * Pure: no DOM, terrain or network access.
 *
 * Written from a functional specification; no code from RFLTools (GPL-3.0) was used.
 */
import { designProfileAt } from './engine'
import type { Alignment, RoadAnalysis, RoadStation, SectionSample } from './types'

export interface SightDistanceSettings {
  /** Perception–reaction time, s. */
  reactionTimeS: number
  /** Braking friction; null takes TAC's wet-pavement value for the design speed. */
  friction: number | null
  /** Driver's eye above the road, m. */
  eyeHeightM: number
  /** Object to stop for, above the road, m. */
  objectHeightM: number
  /** Two vehicles must both stop in the sight distance. Null decides from the running-surface width. */
  singleLane: boolean | null
  /** Height seen on the oncoming vehicle in the single-lane meeting check, m. */
  oncomingHeightM: number
  /** Standing trees beyond the clearing edge, m; null leaves vegetation out. */
  vegetationHeightM: number | null
}

/** Passenger-car eye 1.05 m and a 0.38 m object (TAC 2017); a 1.30 m oncoming vehicle. */
export const DEFAULT_SIGHT_SETTINGS: SightDistanceSettings = {
  reactionTimeS: 2.5,
  friction: null,
  eyeHeightM: 1.05,
  objectHeightM: 0.38,
  singleLane: null,
  oncomingHeightM: 1.3,
  vegetationHeightM: null,
}
/** A logging-truck driver's eye (AASHTO §3.2.6 truck eye height). */
export const TRUCK_EYE_HEIGHT_M = 2.33

export const SIGHT_LIMITS = {
  reactionTimeS: [0.5, 5] as const,
  friction: [0.05, 0.8] as const,
  eyeHeightM: [0.3, 5] as const,
  objectHeightM: [0, 5] as const,
  oncomingHeightM: [0, 5] as const,
  vegetationHeightM: [0, 80] as const,
}
/** A running surface narrower than this is read as single-lane when `singleLane` is null. */
export const SINGLE_LANE_MAX_WIDTH_M = 6
/** Targets are stepped along the road by this much; it is the resolution of an available distance. */
export const SIGHT_TARGET_STEP_M = 1
/**
 * Targets are first tried this far apart, then every `SIGHT_TARGET_STEP_M` past the last one seen.
 * A stretch of road hidden for less than this between two seen targets can be missed.
 */
export const SIGHT_COARSE_STEP_M = 4
/** Spacing of the surface samples tested along each 3D sightline. */
export const SIGHT_LINE_SAMPLE_M = 1
/** Eyes stand at calculated stations no closer than this. */
export const MIN_SIGHT_EYE_SPACING_M = 10
/** Most surface samples one road's 3D review may test; past it the eyes are spaced further apart. */
export const MAX_SIGHT_LINE_SAMPLES = 4_000_000
/** A line of sight passes a sample this far below it. */
const CLEAR_TOLERANCE_M = 1e-6
const G = 9.81

/** TAC wet-pavement braking friction by design speed (km/h). */
export const BRAKING_FRICTION: readonly (readonly [speedKmh: number, friction: number])[] = [
  [30, 0.4],
  [40, 0.38],
  [50, 0.35],
  [60, 0.33],
  [70, 0.31],
  [80, 0.3],
  [90, 0.3],
  [100, 0.29],
  [110, 0.28],
]

/** Braking friction for a design speed: the next higher tabulated speed's value, 0.40 at or below 30 km/h. */
export function brakingFriction(speedKmh: number): number {
  for (const [speed, friction] of BRAKING_FRICTION) if (speedKmh <= speed + 1e-9) return friction
  return BRAKING_FRICTION[BRAKING_FRICTION.length - 1][1]
}

/**
 * Stopping sight distance, m: reaction distance plus braking distance on grade `grade` (decimal,
 * positive uphill in the direction of travel). Null when the grade cancels the friction, since no
 * stop is possible then.
 */
export function stoppingSightDistance(speedKmh: number, reactionS: number, friction: number, grade = 0): number | null {
  if (![speedKmh, reactionS, friction, grade].every(Number.isFinite) || speedKmh <= 0) return null
  const braking = friction + grade
  if (braking <= 1e-6) return null
  return (speedKmh * reactionS) / 3.6 + speedKmh ** 2 / (2 * G * 3.6 ** 2 * braking)
}

/**
 * Closed-form available sight distance over a symmetric parabolic crest of length L and grade
 * change A (percent), for eye h1 and object h2 (AASHTO §3.4.6). For checking the scan.
 */
export function crestSightDistance(lengthM: number, gradeChangePercent: number, eyeM: number, objectM: number) {
  const C = 200 * (Math.sqrt(eyeM) + Math.sqrt(objectM)) ** 2
  const A = Math.abs(gradeChangePercent)
  if (!(A > 0)) return Infinity
  const short = Math.sqrt((C * lengthM) / A)
  return short <= lengthM ? short : (lengthM + C / A) / 2
}

/**
 * Clearance needed from the driver's path to the inside of a curve of path radius R for a sight
 * distance S, m. Inside the curve M = R(1 − cos θ), θ = S/2R; when the sightline is longer than the
 * curve length L, the rest runs on the tangents and M = R(1 − cos θL) + ((S − L)/2)·sin θL, θL = L/2R.
 */
export function sightlineOffset(radiusM: number, sightM: number, curveLengthM = Infinity): number {
  if (!(radiusM > 0) || !(sightM > 0)) return 0
  if (sightM <= curveLengthM) return radiusM * (1 - Math.cos(sightM / (2 * radiusM)))
  const theta = curveLengthM / (2 * radiusM)
  return radiusM * (1 - Math.cos(theta)) + ((sightM - curveLengthM) / 2) * Math.sin(theta)
}

/** Sight distance around a long curve of path radius R with clearance M to the inside: S = 2R·acos((R − M)/R). */
export function sightAroundCurve(radiusM: number, clearanceM: number): number {
  if (!(radiusM > 0) || !(clearanceM > 0)) return 0
  if (clearanceM >= radiusM) return Math.PI * radiusM
  return 2 * radiusM * Math.acos((radiusM - clearanceM) / radiusM)
}

// ---- Profile (2D) -----------------------------------------------------------------------------

export type SightLimiter = 'surface' | 'vegetation' | 'unknown' | 'road-end' | 'clear'

export interface ProfileSight {
  /** Last clear target's distance along the profile, m. */
  availableM: number
  /** `clear` when the cap was reached with nothing in the way. */
  limitedBy: Exclude<SightLimiter, 'vegetation'>
}

/**
 * Available sight distance from one eye on a profile sampled every `stepM` from station 0. Targets
 * stand on every sample; one is seen when the straight line from the eye clears every sample between
 * them. A missing elevation stops the search as unknown rather than being bridged.
 */
export function profileSightDistance(
  elevations: readonly (number | null)[],
  stepM: number,
  eyeIndex: number,
  direction: 1 | -1,
  options: { eyeHeightM: number; objectHeightM: number; maxM: number },
): ProfileSight {
  const eye = elevations[eyeIndex]
  if (eye == null || !Number.isFinite(eye)) return { availableM: 0, limitedBy: 'unknown' }
  const eyeZ = eye + options.eyeHeightM
  // The steepest rise from the eye to any sample passed so far: a target is seen when its own
  // sightline rises at least as steeply.
  let horizon = -Infinity
  for (let k = 1; ; k++) {
    const d = k * stepM
    if (d > options.maxM + 1e-9) return { availableM: (k - 1) * stepM, limitedBy: 'clear' }
    const j = eyeIndex + direction * k
    if (j < 0 || j >= elevations.length) return { availableM: (k - 1) * stepM, limitedBy: 'road-end' }
    const z = elevations[j]
    if (z == null || !Number.isFinite(z)) return { availableM: (k - 1) * stepM, limitedBy: 'unknown' }
    if ((z + options.objectHeightM - eyeZ) / d < horizon - 1e-12)
      return { availableM: (k - 1) * stepM, limitedBy: 'surface' }
    horizon = Math.max(horizon, (z - eyeZ) / d)
  }
}

/** A profile function sampled every `stepM` from 0 to `lengthM`, for `profileSightDistance`. */
export function sampleProfile(at: (chainage: number) => number | null, lengthM: number, stepM: number) {
  const count = Math.floor(lengthM / stepM + 1e-9)
  return Array.from({ length: count + 1 }, (_, i) => {
    const z = at(i * stepM)
    return z != null && Number.isFinite(z) ? z : null
  })
}

/**
 * The road's design profile as a function, sampled once every `stepM` and joined linearly; null for
 * a road without a profile. The parabola's departure from its chords is r·step²/8, about 25 µm at
 * K = 12.5 and 0.5 m.
 */
export function designProfileSampler(
  alignment: Pick<Alignment, 'vertical'>,
  lengthM: number,
  stepM = 0.5,
): ((chainage: number) => number | null) | undefined {
  if (alignment.vertical.length < 2 || !(lengthM > 0)) return undefined
  // A whole number of steps, so the last sample is the road end.
  const count = Math.max(1, Math.ceil(lengthM / stepM - 1e-9)),
    step = lengthM / count
  const values = sampleProfile((s) => designProfileAt(alignment as Alignment, s)?.elevation ?? null, lengthM, step)
  return (s) => {
    if (!(s >= -1e-6) || s > lengthM + 1e-6) return null
    const f = Math.min(count, Math.max(0, s / step)),
      i = Math.min(count - 1, Math.floor(f))
    const a = values[i],
      b = values[i + 1]
    return a === null || a === undefined || b === null || b === undefined ? null : a + (b - a) * (f - i)
  }
}

// ---- Road surface (3D) ------------------------------------------------------------------------

const RAD = Math.PI / 180
const EARTH_RADIUS_M = 6371008.8
const finite = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)

/**
 * One station's surface at an offset: design inside the catch points, ground beyond. `onDesign`
 * says which it is, and `design` keeps the design value either way.
 */
function sectionValue(station: RoadStation, offset: number): { z: number; onDesign: boolean } | null {
  const section = station.section
  if (!section.length || offset < section[0].offset - 1e-9 || offset > section[section.length - 1].offset + 1e-9)
    return null
  let lo = 0,
    hi = section.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (section[mid].offset <= offset) lo = mid
    else hi = mid
  }
  const a = section[lo],
    b = section[hi]
  const t = b.offset > a.offset ? Math.max(0, Math.min(1, (offset - a.offset) / (b.offset - a.offset))) : 0
  const pick = (key: 'design' | 'ground') => {
    const va = (a as SectionSample)[key],
      vb = (b as SectionSample)[key]
    return finite(va) && finite(vb) ? va + (vb - va) * t : null
  }
  const design = pick('design'),
    ground = pick('ground')
  const d = Math.abs(offset)
  const daylight = offset < 0 ? station.leftDaylightM : station.rightDaylightM
  const width = offset < 0 ? station.leftWidth : station.rightWidth
  // Without a catch point the batter's extension is trusted only where the ground beside it is
  // known (the batter then ran past the section's reach) or on the formation itself.
  if (design !== null && (finite(daylight) || ground !== null || d <= width + 1e-6))
    return { z: design, onDesign: true }
  return ground === null ? null : { z: ground, onDesign: false }
}

export interface StationSurface {
  /** Station polyline in local metres (x east, y north). */
  x: Float64Array
  y: Float64Array
  chainage: Float64Array
  /** Index of the station segment holding a chainage. */
  segmentAt(chainage: number): number
  /** Plan position of a chainage and offset (negative left). */
  position(chainage: number, offset: number): [number, number]
  /** Nearest point on the station polyline between two chainages: chainage and signed offset. */
  locate(
    x: number,
    y: number,
    fromChainage: number,
    toChainage: number,
    /** The segment the previous nearby point fell on; updated in place. */
    hint?: { segment: number },
  ): { chainage: number; offset: number }
  /** Surface elevation at a chainage and offset, with vegetation where asked; null when unknown. */
  elevation(chainage: number, offset: number, vegetation: boolean): { z: number; vegetation: boolean } | null
}

/**
 * The surface a road leaves, rebuilt from its calculated stations: each section's design between
 * the catch points and ground beyond, joined linearly between stations at equal offset. With
 * `profileAt`, the road prism follows the design profile exactly between stations rather than the
 * chord between them, which matters over a crest when stations are far apart.
 */
export function stationSurface(
  stations: readonly RoadStation[],
  options: { vegetationHeightM?: number | null; profileAt?: (chainage: number) => number | null } = {},
): StationSurface {
  const n = stations.length
  const x = new Float64Array(n),
    y = new Float64Array(n),
    chainage = new Float64Array(n)
  const [lng0, lat0] = stations[0]?.coordinate ?? [0, 0]
  const scaleX = Math.cos(lat0 * RAD) * EARTH_RADIUS_M * RAD,
    scaleY = EARTH_RADIUS_M * RAD
  stations.forEach((s, i) => {
    x[i] = (s.coordinate[0] - lng0) * scaleX
    y[i] = (s.coordinate[1] - lat0) * scaleY
    chainage[i] = s.chainage
  })
  const segmentAt = (s: number) => {
    let lo = 0,
      hi = n - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (chainage[mid] <= s) lo = mid
      else hi = mid
    }
    return Math.max(0, Math.min(n - 2, lo))
  }
  const direction = (i: number): [number, number] => {
    const dx = x[i + 1] - x[i],
      dy = y[i + 1] - y[i],
      length = Math.hypot(dx, dy) || 1
    return [dx / length, dy / length]
  }
  const vegetationHeight = options.vegetationHeightM ?? null
  const edgeOf = (station: RoadStation, offset: number) =>
    offset < 0
      ? (station.leftClearingM ?? station.leftDaylightM ?? null)
      : (station.rightClearingM ?? station.rightDaylightM ?? null)
  return {
    x,
    y,
    chainage,
    segmentAt,
    position(s, offset) {
      if (n < 2) return [x[0] ?? 0, y[0] ?? 0]
      const i = segmentAt(s)
      const span = chainage[i + 1] - chainage[i]
      const t = span > 1e-9 ? Math.max(0, Math.min(1, (s - chainage[i]) / span)) : 0
      let [dx, dy] = direction(i)
      // At a station between two segments, offset along the bisector so both segments agree.
      const atVertex = t <= 1e-9 && i > 0 ? i : t >= 1 - 1e-9 && i + 2 < n ? i + 1 : -1
      if (atVertex >= 0) {
        const [ax, ay] = direction(atVertex - 1),
          [bx, by] = direction(atVertex)
        const length = Math.hypot(ax + bx, ay + by) || 1
        dx = (ax + bx) / length
        dy = (ay + by) / length
      }
      const px = x[i] + (x[i + 1] - x[i]) * t,
        py = y[i] + (y[i + 1] - y[i]) * t
      // Right of the direction of travel is (dy, −dx) with x east and y north.
      return [px + dy * offset, py - dx * offset]
    },
    locate(px, py, from, to, hint) {
      const first = Math.max(0, segmentAt(Math.min(from, to)) - 1),
        last = Math.min(n - 2, segmentAt(Math.max(from, to)) + 1)
      const distance2 = (i: number) => {
        const sx = x[i + 1] - x[i],
          sy = y[i + 1] - y[i],
          length2 = sx * sx + sy * sy
        const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((px - x[i]) * sx + (py - y[i]) * sy) / length2)) : 0
        return (px - x[i] - sx * t) ** 2 + (py - y[i] - sy * t) ** 2
      }
      let best: number
      if (hint !== undefined && hint.segment >= first && hint.segment <= last) {
        // Walk from the last sample's segment while the distance falls: consecutive samples along
        // a sightline move by a fraction of a segment, so this is one or two steps.
        best = hint.segment
        let d = distance2(best)
        for (const step of [1, -1]) {
          while (best + step >= first && best + step <= last) {
            const next = distance2(best + step)
            if (next >= d) break
            best += step
            d = next
          }
        }
      } else {
        best = first
        let d = Infinity
        for (let i = first; i <= last; i++) {
          const next = distance2(i)
          if (next < d) {
            d = next
            best = i
          }
        }
      }
      if (hint) hint.segment = best
      const i = best
      const sx = x[i + 1] - x[i],
        sy = y[i + 1] - y[i],
        length2 = sx * sx + sy * sy
      const t = length2 > 1e-12 ? Math.max(0, Math.min(1, ((px - x[i]) * sx + (py - y[i]) * sy) / length2)) : 0
      const length = Math.sqrt(length2) || 1
      return {
        chainage: chainage[i] + (chainage[i + 1] - chainage[i]) * t,
        // Positive to the right of the direction of travel.
        offset: ((px - x[i]) * sy - (py - y[i]) * sx) / length,
      }
    },
    elevation(s, offset, vegetation) {
      if (n < 2) return null
      const i = segmentAt(s)
      const a = stations[i],
        b = stations[i + 1]
      const span = b.chainage - a.chainage
      const t = span > 1e-9 ? Math.max(0, Math.min(1, (s - a.chainage) / span)) : 0
      const va = sectionValue(a, offset),
        vb = sectionValue(b, offset)
      if (va === null || vb === null) return null
      let z = va.z + (vb.z - va.z) * t
      const centre = va.onDesign && vb.onDesign ? options.profileAt?.(s) : null
      if (finite(centre) && finite(a.designElevation) && finite(b.designElevation)) {
        // On the road prism, hold the section's shape relative to the centreline and let the
        // centreline follow the profile.
        const ra = va.z - a.designElevation,
          rb = vb.z - b.designElevation
        z = centre + ra + (rb - ra) * t
      }
      if (!vegetation || vegetationHeight === null || vegetationHeight <= 0) return { z, vegetation: false }
      const ea = edgeOf(a, offset),
        eb = edgeOf(b, offset)
      const width = offset < 0 ? Math.min(a.leftWidth, b.leftWidth) : Math.min(a.rightWidth, b.rightWidth)
      if (!finite(ea) || !finite(eb)) return Math.abs(offset) <= width ? { z, vegetation: false } : null
      const edge = ea + (eb - ea) * t
      return Math.abs(offset) > edge + 1e-6 ? { z: z + vegetationHeight, vegetation: true } : { z, vegetation: false }
    },
  }
}

/** Whether the straight line between two 3D points clears the surface, sampled every `sampleM` in plan. */
export function sightlineState(
  surface: StationSurface,
  eye: { x: number; y: number; z: number; chainage: number },
  target: { x: number; y: number; z: number; chainage: number },
  sampleM = SIGHT_LINE_SAMPLE_M,
): Exclude<SightLimiter, 'road-end'> {
  const plan = Math.hypot(target.x - eye.x, target.y - eye.y)
  const count = Math.max(1, Math.ceil(plan / sampleM))
  let unknown = false
  const hint = { segment: -1 }
  for (let i = 1; i < count; i++) {
    const t = i / count
    const px = eye.x + (target.x - eye.x) * t,
      py = eye.y + (target.y - eye.y) * t
    const at = surface.locate(px, py, eye.chainage, target.chainage, hint.segment < 0 ? undefined : hint)
    if (hint.segment < 0) hint.segment = Math.max(0, surface.segmentAt(at.chainage))
    const ground = surface.elevation(at.chainage, at.offset, true)
    if (!ground) {
      unknown = true
      continue
    }
    if (ground.z > eye.z + (target.z - eye.z) * t + CLEAR_TOLERANCE_M)
      return ground.vegetation ? 'vegetation' : 'surface'
  }
  return unknown ? 'unknown' : 'clear'
}

export interface RoadSightEye {
  chainage: number
  direction: 'ahead' | 'back'
  /** Grade over the stopping distance in the direction of travel, percent; null when unknown. */
  gradePercent: number | null
  /** Distance needed here, m; null when no stop is possible on this grade. */
  requiredM: number | null
  /**
   * Distance seen along the road, m. With `limitedBy: 'clear'` it is at least the required
   * distance (the search stops there); otherwise it is the last clear target before the limit.
   */
  availableM: number
  limitedBy: SightLimiter
}

export interface RoadSightReview {
  status: 'checked' | 'no-speed' | 'no-stations'
  speedKmh: number | null
  friction: number | null
  singleLane: boolean
  settings: SightDistanceSettings
  /** Required on level ground, m: the stopping distance, or both vehicles' on a single-lane road. */
  levelRequiredM: number | null
  /** Height of what the driver must see, m. */
  targetHeightM: number
  eyeSpacingM: number
  eyes: RoadSightEye[]
  /** Eyes that see less than they need, limited by the surface or vegetation. */
  short: RoadSightEye[]
  /** Eyes whose sightlines meet missing elevation before the required distance. */
  unknown: RoadSightEye[]
  /** Eyes closer to the road end than the required distance, not judged. */
  nearEnd: RoadSightEye[]
}

/** The road's sight settings with defaults for anything not entered. */
export const sightSettingsOf = (alignment: Pick<Alignment, 'sightDistance'>): SightDistanceSettings => ({
  ...DEFAULT_SIGHT_SETTINGS,
  ...alignment.sightDistance,
})

/** The design speed sight distance is judged at: the road's curve design, else the project's standards. */
export const sightDesignSpeed = (
  alignment: Pick<Alignment, 'curveDesign'>,
  standards?: { designSpeedKmh: number | null } | null,
): number | null => {
  const speed = alignment.curveDesign?.designSpeedKmh ?? standards?.designSpeedKmh ?? null
  return speed !== null && speed > 0 ? speed : null
}

/** Whether the road is checked as single-lane: as entered, else from its running-surface width. */
export const isSingleLane = (alignment: Pick<Alignment, 'template'>, settings: SightDistanceSettings) =>
  settings.singleLane ?? alignment.template.leftWidth + alignment.template.rightWidth < SINGLE_LANE_MAX_WIDTH_M

const cache = new WeakMap<RoadAnalysis, { key: string; review: RoadSightReview }>()

/**
 * Sight distance at stations along the road, both ways, on the surface rebuilt from the analysis.
 * Each eye's search stops at the distance it needs, so `availableM` past that reads "at least".
 * Results are cached per analysis and inputs.
 */
export function reviewRoadSight(input: {
  analysis: RoadAnalysis
  alignment: Pick<Alignment, 'curveDesign' | 'template' | 'sightDistance'> & Partial<Pick<Alignment, 'vertical'>>
  standards?: { designSpeedKmh: number | null } | null
  /**
   * The design profile's elevation at a chainage. Omitted, it is sampled from `alignment.vertical`
   * when the road has a profile (`designProfileSampler`).
   */
  profileAt?: (chainage: number) => number | null
  stationIntervalM?: number
}): RoadSightReview {
  const { analysis, alignment } = input
  const basis = sightBasis(alignment, input.standards)
  const key = JSON.stringify([
    basis,
    input.profileAt ? 'given' : (alignment.vertical ?? []),
    input.stationIntervalM ?? null,
  ])
  const cached = cache.get(analysis)
  if (cached?.key === key) return cached.review
  const base: RoadSightReview = {
    status: 'checked',
    ...basis,
    eyeSpacingM: MIN_SIGHT_EYE_SPACING_M,
    eyes: [],
    short: [],
    unknown: [],
    nearEnd: [],
  }
  const stations = analysis.stations
  let review: RoadSightReview
  if (basis.speedKmh === null) review = { ...base, status: 'no-speed' }
  else if (stations.length < 2) review = { ...base, status: 'no-stations' }
  else
    review = checkRoad(
      analysis,
      {
        profileAt:
          input.profileAt ??
          (alignment.vertical ? designProfileSampler({ vertical: alignment.vertical }, analysis.length) : undefined),
        stationIntervalM: input.stationIntervalM,
      },
      base,
      (grade) => requiredSight(basis, grade),
    )
  cache.set(analysis, { key, review })
  return review
}

/** What a road's sight check is judged on, without looking along it: cheap enough for a summary line. */
export function sightBasis(
  alignment: Pick<Alignment, 'curveDesign' | 'template' | 'sightDistance'>,
  standards?: { designSpeedKmh: number | null } | null,
) {
  const settings = sightSettingsOf(alignment)
  const speedKmh = sightDesignSpeed(alignment, standards)
  const singleLane = isSingleLane(alignment, settings)
  const friction = speedKmh === null ? null : (settings.friction ?? brakingFriction(speedKmh))
  const basis = {
    speedKmh,
    friction,
    singleLane,
    settings,
    targetHeightM: singleLane ? settings.oncomingHeightM : settings.objectHeightM,
    levelRequiredM: null as number | null,
  }
  basis.levelRequiredM = requiredSight(basis, 0)
  return basis
}

/** Distance needed on a grade (decimal, in the direction of travel); on a single lane, both vehicles'. */
function requiredSight(
  basis: { speedKmh: number | null; friction: number | null; singleLane: boolean; settings: SightDistanceSettings },
  grade: number,
): number | null {
  const { speedKmh, friction, settings } = basis
  if (speedKmh === null || friction === null) return null
  const own = stoppingSightDistance(speedKmh, settings.reactionTimeS, friction, grade)
  if (!basis.singleLane || own === null) return own
  // The oncoming vehicle travels the other way, on the opposite grade.
  const other = stoppingSightDistance(speedKmh, settings.reactionTimeS, friction, -grade)
  return other === null ? null : own + other
}

function checkRoad(
  analysis: RoadAnalysis,
  input: { profileAt?: (chainage: number) => number | null; stationIntervalM?: number },
  base: RoadSightReview,
  required: (grade: number) => number | null,
): RoadSightReview {
  const { settings, targetHeightM } = base
  const stations = analysis.stations
  const length = stations[stations.length - 1].chainage
  const surface = stationSurface(stations, {
    vegetationHeightM: settings.vegetationHeightM,
    profileAt: input.profileAt,
  })
  const levelRequired = base.levelRequiredM ?? 0
  // Each eye marches about `levelRequired` m of targets, testing on average half that of line.
  const perEye = 2 * (levelRequired / SIGHT_COARSE_STEP_M) * (levelRequired / 2 / SIGHT_LINE_SAMPLE_M) * 1.5
  let spacing = Math.max(MIN_SIGHT_EYE_SPACING_M, input.stationIntervalM ?? 0)
  if (perEye > 0 && (length / spacing) * perEye > MAX_SIGHT_LINE_SAMPLES)
    spacing = Math.ceil((length * perEye) / MAX_SIGHT_LINE_SAMPLES)
  // Eyes at calculated stations, at least `spacing` apart, and always the first and last.
  const eyesAt: number[] = []
  for (const s of stations)
    if (!eyesAt.length || s.chainage - eyesAt[eyesAt.length - 1] >= spacing - 1e-6) eyesAt.push(s.chainage)
  if (eyesAt[eyesAt.length - 1] < length - 1e-6) eyesAt.push(length)

  // Elevation of the driver's path, for the mean grade over a stopping distance.
  const pathElevation = (s: number) => {
    const centre = input.profileAt?.(s)
    if (finite(centre)) return centre
    return surface.elevation(s, 0, false)?.z ?? null
  }
  const laneOffset = (s: number, direction: 1 | -1) => {
    if (base.singleLane) return 0
    const i = Math.min(
      stations.length - 1,
      Math.max(
        0,
        stations.findIndex((x) => x.chainage >= s - 1e-6),
      ),
    )
    return direction > 0 ? stations[i].rightWidth / 2 : -stations[i].leftWidth / 2
  }
  const eyes: RoadSightEye[] = []
  for (const s of eyesAt)
    for (const direction of [1, -1] as const) {
      // No look off either end of the road.
      if ((direction > 0 && s >= length - 1e-6) || (direction < 0 && s <= 1e-6)) continue
      const here = pathElevation(s)
      // Grade at the eye, then the mean over the stopping distance it gives (AASHTO §3.2).
      const meanGrade = (distance: number) => {
        const end = Math.max(0, Math.min(length, s + direction * distance))
        const there = pathElevation(end)
        const run = Math.abs(end - s)
        return here !== null && there !== null && run > 1e-6 ? (there - here) / run : null
      }
      const g0 = meanGrade(Math.min(10, length))
      const first = g0 === null ? null : required(g0)
      const grade = first === null ? g0 : (meanGrade(first) ?? g0)
      const need = grade === null ? null : required(grade)
      const eye: RoadSightEye = {
        chainage: s,
        direction: direction > 0 ? 'ahead' : 'back',
        gradePercent: grade === null ? null : grade * 100,
        requiredM: need,
        availableM: 0,
        limitedBy: 'unknown',
      }
      eyes.push(eye)
      if (need === null) continue
      const offset = laneOffset(s, direction)
      const eyeGround = surface.elevation(s, offset, false)
      if (!eyeGround) continue
      const [ex, ey] = surface.position(s, offset)
      const eyePoint = { x: ex, y: ey, z: eyeGround.z + settings.eyeHeightM, chainage: s }
      const look = (d: number): Exclude<SightLimiter, 'clear'> | 'clear' => {
        const at = s + direction * d
        if (at < -1e-6 || at > length + 1e-6) return 'road-end'
        const targetOffset = laneOffset(at, direction)
        const targetGround = surface.elevation(at, targetOffset, false)
        if (!targetGround) return 'unknown'
        const [tx, ty] = surface.position(at, targetOffset)
        return sightlineState(surface, eyePoint, { x: tx, y: ty, z: targetGround.z + targetHeightM, chainage: at })
      }
      // Targets every SIGHT_COARSE_STEP_M first; past the first one not seen, every
      // SIGHT_TARGET_STEP_M back from the last one seen, so the distance keeps the fine resolution.
      const cap = Math.ceil(need / SIGHT_TARGET_STEP_M - 1e-9) * SIGHT_TARGET_STEP_M
      let available = 0
      let limitedBy: SightLimiter = 'clear'
      for (let d = Math.min(SIGHT_COARSE_STEP_M, cap); ; d = Math.min(d + SIGHT_COARSE_STEP_M, cap)) {
        const state = look(d)
        if (state === 'clear') {
          available = d
          if (d >= cap - 1e-9) break
          continue
        }
        for (let fine = available + SIGHT_TARGET_STEP_M; fine <= d + 1e-9; fine += SIGHT_TARGET_STEP_M) {
          const at = fine >= d - 1e-9 ? state : look(fine)
          if (at !== 'clear') {
            limitedBy = at
            break
          }
          available = fine
        }
        break
      }
      eye.availableM = limitedBy === 'clear' ? Math.max(available, need) : available
      eye.limitedBy = limitedBy
    }
  const shortfall = (eye: RoadSightEye) => eye.requiredM !== null && eye.availableM < eye.requiredM - 1e-6
  return {
    ...base,
    eyeSpacingM: spacing,
    eyes,
    short: eyes.filter((eye) => shortfall(eye) && (eye.limitedBy === 'surface' || eye.limitedBy === 'vegetation')),
    unknown: eyes.filter((eye) => eye.limitedBy === 'unknown' || (eye.requiredM === null && eye.gradePercent === null)),
    nearEnd: eyes.filter((eye) => shortfall(eye) && eye.limitedBy === 'road-end'),
  }
}

// ---- Clearing on the inside of curves ---------------------------------------------------------

export interface CurveSightClearing {
  /** Index of the curve in `horizontalCurveSummary`. */
  curve: number
  start: number
  end: number
  radiusM: number
  inside: 'left' | 'right'
  /** Radius of the driver's path on the inside lane, m. */
  pathRadiusM: number
  requiredSightM: number
  /** Clearance needed from the driver's path, m. */
  offsetFromPathM: number
  /** The same measured from the centreline, m: what the clearing on the inside must reach. */
  neededFromCentreM: number
  /** Narrowest clearing on the inside over the curve, from the centreline; null when unknown. */
  clearedFromCentreM: number | null
  /** Null when the clearing is unknown. */
  short: boolean | null
}

/**
 * Clearing needed on the inside of each horizontal curve for the level-ground sight distance, from
 * the horizontal sightline offset alone (no surface): a check that the clearing reaches it.
 */
export function curveSightClearings(
  curves: readonly { start: number; end: number; length: number; radius: number; direction: 'left' | 'right' }[],
  stations: readonly RoadStation[],
  review: Pick<RoadSightReview, 'levelRequiredM' | 'singleLane'>,
): CurveSightClearing[] {
  const sight = review.levelRequiredM
  if (sight === null) return []
  return curves.map((curve, index) => {
    const inStations = stations.filter((s) => s.chainage >= curve.start - 1e-6 && s.chainage <= curve.end + 1e-6)
    const laneInside = review.singleLane
      ? 0
      : Math.min(
          ...(inStations.length ? inStations : stations).map((s) =>
            curve.direction === 'left' ? s.leftWidth : s.rightWidth,
          ),
        ) / 2
    const pathRadiusM = Math.max(1e-3, curve.radius - laneInside)
    const offsetFromPathM = sightlineOffset(pathRadiusM, sight, curve.length)
    const cleared = inStations.map((s) =>
      curve.direction === 'left' ? (s.leftClearingM ?? s.leftDaylightM) : (s.rightClearingM ?? s.rightDaylightM),
    )
    const clearedFromCentreM =
      cleared.length && cleared.every((value) => finite(value)) ? Math.min(...(cleared as number[])) : null
    const neededFromCentreM = offsetFromPathM + laneInside
    return {
      curve: index,
      start: curve.start,
      end: curve.end,
      radiusM: curve.radius,
      inside: curve.direction,
      pathRadiusM,
      requiredSightM: sight,
      offsetFromPathM,
      neededFromCentreM,
      clearedFromCentreM,
      short: clearedFromCentreM === null ? null : clearedFromCentreM < neededFromCentreM - 1e-6,
    }
  })
}

// ---- Settings ----------------------------------------------------------------------------------

/** Reads saved sight-distance settings; anything out of range is refused rather than read. */
export function parseSightSettings(raw: unknown): Partial<SightDistanceSettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Sight distance settings must be an object.')
  const r = raw as Record<string, unknown>
  const out: Partial<SightDistanceSettings> = {}
  const numberIn = (key: keyof typeof SIGHT_LIMITS, label: string, nullable: boolean) => {
    const value = r[key]
    if (value === undefined) return
    if (value === null && nullable) {
      ;(out as Record<string, unknown>)[key] = null
      return
    }
    const [min, max] = SIGHT_LIMITS[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw Error(`${label} must be between ${min} and ${max}.`)
    ;(out as Record<string, unknown>)[key] = value
  }
  numberIn('reactionTimeS', 'Reaction time', false)
  numberIn('friction', 'Braking friction', true)
  numberIn('eyeHeightM', 'Eye height', false)
  numberIn('objectHeightM', 'Object height', false)
  numberIn('oncomingHeightM', 'Oncoming vehicle height', false)
  numberIn('vegetationHeightM', 'Vegetation height', true)
  if (r.singleLane !== undefined) {
    if (r.singleLane !== null && typeof r.singleLane !== 'boolean')
      throw Error('Single-lane must be true, false or null.')
    out.singleLane = r.singleLane
  }
  return out
}
