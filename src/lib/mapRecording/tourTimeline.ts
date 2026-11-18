/**
 * A camera tour for a recording: ordered stops, each a pose held for a while and then eased to
 * the next, plus a "drive" timeline that travels along a road at a speed. DOM-free.
 *
 * Nothing here moves a camera. A caller reads `timeline.poseAt(elapsedMs)` once per frame and
 * places its own camera: `map.jumpTo` for a plan map, or the road view's drive camera, which
 * sleeps when nothing moves and must be woken for each new pose (AGENTS.md, road view frame
 * loops). Never put the per-frame pose in React state; keep it in a ref and round what reaches
 * page state. A pitch handed to the eye-level map still goes through `horizonSafePitch`.
 *
 * The pose is generic so both fit: `zoom` for a map camera, `eyeHeightMeters` and
 * `fieldOfViewDegrees` for an eye-level one. A field set on only one of two stops is held at
 * that stop's value through the transition.
 *
 * The stop model (hold, then transition out; the last stop's transition unused), the total
 * duration rule and the clamped save/load are adapted from GeoLibre (MIT),
 * `apps/geolibre-desktop/src/lib/tour-recorder.ts` (`TourKeyframe`, `estimateTourDurationMs`,
 * `serializeTourConfig`, `parseTourConfig`, `normalizeBearing`).
 */

export type TourPose = {
  /** Longitude, degrees. */
  lng: number
  /** Latitude, degrees. */
  lat: number
  /** Compass bearing the camera faces, degrees clockwise from north, (-180, 180]. */
  bearing: number
  /** Map pitch, degrees: 0 looks straight down, 90 at the horizon. */
  pitch: number
  /** Map zoom, for a map camera. */
  zoom?: number
  /** Eye height above the ground, metres, for an eye-level camera. */
  eyeHeightMeters?: number
  /** Vertical field of view, degrees. */
  fieldOfViewDegrees?: number
}

export type TourStop = {
  pose: TourPose
  /** How long the camera stands still on this pose, ms. The first stop's hold opens the video; the last's closes it. */
  holdMs: number
  /** How long the move from this stop to the next takes, ms; 0 cuts straight to it. Unused on the last stop. */
  transitionMs: number
  /** A name to show in a list, e.g. the viewpoint's. */
  label?: string
}

export type Tour = { name?: string; stops: readonly TourStop[] }

/** Anything that gives a pose for an elapsed time: a tour, a drive, or a sequence of them. */
export type PoseTimeline = {
  readonly durationMs: number
  /** The pose at `timeMs` after the start; held at the first pose before 0 and the last after the end. */
  poseAt(timeMs: number): TourPose
}

/** Bounds every control and the file parser hold a tour to. */
export const TOUR_LIMITS = {
  maxStops: 200,
  minHoldMs: 0,
  maxHoldMs: 60_000,
  minTransitionMs: 0,
  maxTransitionMs: 60_000,
  defaultHoldMs: 1000,
  defaultTransitionMs: 4000,
  minPitch: 0,
  /** MapLibre's own ceiling; the eye-level map raises `maxPitch` past 85. */
  maxPitch: 180,
  minZoom: 0,
  maxZoom: 24,
  minEyeHeightMeters: 0,
  maxEyeHeightMeters: 5000,
  minFieldOfViewDegrees: 5,
  maxFieldOfViewDegrees: 120,
  maxLabelLength: 120,
  /** Longest tour file read, characters; a real tour is far smaller. */
  maxFileLength: 1_000_000,
} as const

/** Bounds a drive timeline is held to. */
export const DRIVE_LIMITS = {
  minSpeedMetersPerSecond: 0.5,
  maxSpeedMetersPerSecond: 50,
  defaultLookAheadMeters: 25,
  maxPathPoints: 50_000,
} as const

export const TOUR_FILE_TYPE = 'pgmaps-tour'
export const TOUR_FILE_VERSION = 1

const EARTH_RADIUS_METERS = 6_371_008.8
const METERS_PER_DEGREE = (EARTH_RADIUS_METERS * Math.PI) / 180

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))
const round = (value: number, digits: number) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** A bearing on (-180, 180], so 270 reads as -90 rather than being clipped. */
export function normalizeBearing(bearing: number): number {
  // Already in range: return it untouched, so a stop's own value survives without rounding error.
  if (bearing > -180 && bearing <= 180) return bearing
  const mod = ((bearing % 360) + 360) % 360
  return mod > 180 ? mod - 360 : mod
}

const normalizeLongitude = normalizeBearing

/** Ease in and out (cubic): the camera leaves a stop and reaches the next at rest. */
export function easeInOut(t: number): number {
  const x = clamp(t, 0, 1)
  return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2
}

function lerpOptional(a: number | undefined, b: number | undefined, t: number): number | undefined {
  if (a === undefined) return b
  if (b === undefined) return a
  return a + (b - a) * t
}

/**
 * The pose a fraction `t` (0–1, no easing applied) of the way from `a` to `b`: longitude and
 * bearing along the shorter way round, the rest linearly.
 */
export function interpolatePose(a: TourPose, b: TourPose, t: number): TourPose {
  const f = clamp(t, 0, 1)
  const pose: TourPose = {
    lng: normalizeLongitude(a.lng + normalizeLongitude(b.lng - a.lng) * f),
    lat: a.lat + (b.lat - a.lat) * f,
    bearing: normalizeBearing(a.bearing + normalizeBearing(b.bearing - a.bearing) * f),
    pitch: a.pitch + (b.pitch - a.pitch) * f,
  }
  const zoom = lerpOptional(a.zoom, b.zoom, f)
  const eye = lerpOptional(a.eyeHeightMeters, b.eyeHeightMeters, f)
  const fov = lerpOptional(a.fieldOfViewDegrees, b.fieldOfViewDegrees, f)
  if (zoom !== undefined) pose.zoom = zoom
  if (eye !== undefined) pose.eyeHeightMeters = eye
  if (fov !== undefined) pose.fieldOfViewDegrees = fov
  return pose
}

/** Every stop's hold plus the transitions out of every stop but the last, ms. */
export function tourDurationMs(tour: Tour): number {
  const { stops } = tour
  let total = 0
  stops.forEach((stop, index) => {
    total += Math.max(0, stop.holdMs)
    if (index < stops.length - 1) total += Math.max(0, stop.transitionMs)
  })
  return total
}

export type TourPhase = {
  /** The stop held, or the stop the transition leaves. */
  stopIndex: number
  phase: 'hold' | 'transition'
  /** 0–1 through the phase, before easing. */
  progress: number
}

/** Which stop and phase an elapsed time falls in; null for a tour with no stops. */
export function tourPhaseAt(tour: Tour, timeMs: number): TourPhase | null {
  const { stops } = tour
  if (!stops.length) return null
  if (!(timeMs > 0)) return { stopIndex: 0, phase: 'hold', progress: 0 }
  let start = 0
  for (let index = 0; index < stops.length; index++) {
    const hold = Math.max(0, stops[index].holdMs)
    if (timeMs < start + hold) return { stopIndex: index, phase: 'hold', progress: (timeMs - start) / hold }
    start += hold
    if (index === stops.length - 1) break
    const transition = Math.max(0, stops[index].transitionMs)
    if (timeMs < start + transition)
      return { stopIndex: index, phase: 'transition', progress: (timeMs - start) / transition }
    start += transition
  }
  return { stopIndex: stops.length - 1, phase: 'hold', progress: 1 }
}

/** The pose at an elapsed time: a hold is the stop's pose exactly, a transition eased. Null for an empty tour. */
export function tourPoseAt(tour: Tour, timeMs: number): TourPose | null {
  const phase = tourPhaseAt(tour, timeMs)
  if (!phase) return null
  const from = tour.stops[phase.stopIndex].pose
  if (phase.phase === 'hold') return { ...from }
  return interpolatePose(from, tour.stops[phase.stopIndex + 1].pose, easeInOut(phase.progress))
}

/** A tour as a timeline. Throws for a tour with no stops. */
export function tourTimeline(tour: Tour): PoseTimeline {
  if (!tour.stops.length) throw new Error('A tour needs at least one stop.')
  const durationMs = tourDurationMs(tour)
  return { durationMs, poseAt: (timeMs) => tourPoseAt(tour, timeMs)! }
}

/** Timelines played one after another, e.g. a fly-in, a drive along the road, a fly-out. */
export function sequenceTimelines(parts: readonly PoseTimeline[]): PoseTimeline {
  if (!parts.length) throw new Error('A sequence needs at least one timeline.')
  const durationMs = parts.reduce((sum, part) => sum + Math.max(0, part.durationMs), 0)
  return {
    durationMs,
    poseAt(timeMs) {
      let start = 0
      for (const part of parts) {
        const length = Math.max(0, part.durationMs)
        if (timeMs < start + length) return part.poseAt(timeMs - start)
        start += length
      }
      const last = parts[parts.length - 1]
      return last.poseAt(Math.max(0, last.durationMs))
    },
  }
}

// --- Drive along a road ---------------------------------------------------------------------

/** A position along a road, `[lng, lat]`. */
export type PathPoint = readonly [number, number]

function segmentMeters(a: PathPoint, b: PathPoint): number {
  const cosLat = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  const dx = normalizeLongitude(b[0] - a[0]) * cosLat * METERS_PER_DEGREE
  const dy = (b[1] - a[1]) * METERS_PER_DEGREE
  return Math.hypot(dx, dy)
}

function bearingBetween(a: PathPoint, b: PathPoint): number {
  const cosLat = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180)
  const dx = normalizeLongitude(b[0] - a[0]) * cosLat
  const dy = b[1] - a[1]
  return normalizeBearing((Math.atan2(dx, dy) * 180) / Math.PI)
}

/** A road's length, metres (local flat approximation per segment; good to a fraction of a percent over a road). */
export function pathLengthMeters(path: readonly PathPoint[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) total += segmentMeters(path[i - 1], path[i])
  return total
}

function measuredPath(path: readonly PathPoint[]) {
  const points: PathPoint[] = []
  const along: number[] = []
  let total = 0
  for (const point of path) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1]) || Math.abs(point[1]) > 90) continue
    if (points.length) {
      const step = segmentMeters(points[points.length - 1], point)
      if (step === 0) continue
      total += step
    }
    points.push(point)
    along.push(total)
  }
  const at = (meters: number): PathPoint => {
    const d = clamp(meters, 0, total)
    let low = 0
    let high = along.length - 1
    while (high - low > 1) {
      const mid = (low + high) >> 1
      if (along[mid] <= d) low = mid
      else high = mid
    }
    const span = along[high] - along[low]
    const t = span > 0 ? (d - along[low]) / span : 0
    const a = points[low]
    const b = points[high]
    return [normalizeLongitude(a[0] + normalizeLongitude(b[0] - a[0]) * t), a[1] + (b[1] - a[1]) * t]
  }
  return { points, total, at }
}

export type DriveTimelineOptions = {
  speedMetersPerSecond: number
  /** Map pitch held through the drive. */
  pitch: number
  zoom?: number
  eyeHeightMeters?: number
  fieldOfViewDegrees?: number
  /**
   * The camera faces the point this far ahead on the road rather than the segment it is on,
   * so a bend turns the view smoothly instead of snapping at each vertex. Default 25 m.
   */
  lookAheadMeters?: number
  /** Drive only part of the road: metres along it to start and end. Default the whole road. */
  startMeters?: number
  endMeters?: number
}

/**
 * A timeline that travels along `path` at a steady speed, facing along the road. Throws when
 * the path has fewer than two distinct points or the stretch to drive is empty.
 */
export function driveTimeline(path: readonly PathPoint[], options: DriveTimelineOptions): PoseTimeline {
  if (path.length > DRIVE_LIMITS.maxPathPoints)
    throw new Error(`The road has too many points to drive (${path.length}; at most ${DRIVE_LIMITS.maxPathPoints}).`)
  const road = measuredPath(path)
  if (road.points.length < 2) throw new Error('The road needs at least two distinct points to drive along.')
  const speed = clamp(
    Number.isFinite(options.speedMetersPerSecond) ? options.speedMetersPerSecond : 0,
    DRIVE_LIMITS.minSpeedMetersPerSecond,
    DRIVE_LIMITS.maxSpeedMetersPerSecond,
  )
  const start = clamp(options.startMeters ?? 0, 0, road.total)
  const end = clamp(options.endMeters ?? road.total, 0, road.total)
  if (!(end > start)) throw new Error('The stretch of road to drive is empty.')
  const lookAhead = Math.max(1, options.lookAheadMeters ?? DRIVE_LIMITS.defaultLookAheadMeters)
  const pitch = clamp(options.pitch, TOUR_LIMITS.minPitch, TOUR_LIMITS.maxPitch)
  const durationMs = ((end - start) / speed) * 1000
  return {
    durationMs,
    poseAt(timeMs) {
      const along = start + clamp(timeMs, 0, durationMs) * (speed / 1000)
      const ahead = Math.min(road.total, along + lookAhead)
      const behind = Math.max(0, ahead - lookAhead)
      const [lng, lat] = road.at(along)
      const pose: TourPose = { lng, lat, bearing: bearingBetween(road.at(behind), road.at(ahead)), pitch }
      if (options.zoom !== undefined) pose.zoom = options.zoom
      if (options.eyeHeightMeters !== undefined) pose.eyeHeightMeters = options.eyeHeightMeters
      if (options.fieldOfViewDegrees !== undefined) pose.fieldOfViewDegrees = options.fieldOfViewDegrees
      return pose
    },
  }
}

// --- Save and open --------------------------------------------------------------------------

/** A tour file that cannot be read; the message says why. */
export class TourFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TourFileError'
  }
}

/** Hold a stop's timing within `TOUR_LIMITS`; NaN takes the default. */
export function clampHoldMs(ms: number): number {
  return Math.round(
    clamp(Number.isFinite(ms) ? ms : TOUR_LIMITS.defaultHoldMs, TOUR_LIMITS.minHoldMs, TOUR_LIMITS.maxHoldMs),
  )
}

export function clampTransitionMs(ms: number): number {
  return Math.round(
    clamp(
      Number.isFinite(ms) ? ms : TOUR_LIMITS.defaultTransitionMs,
      TOUR_LIMITS.minTransitionMs,
      TOUR_LIMITS.maxTransitionMs,
    ),
  )
}

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

function readPose(raw: unknown, label: string): TourPose {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TourFileError(`${label} has no pose.`)
  const pose = raw as Record<string, unknown>
  if (!finite(pose.lng) || !finite(pose.lat) || Math.abs(pose.lat) > 90)
    throw new TourFileError(`${label} has no valid position.`)
  const result: TourPose = {
    lng: round(normalizeLongitude(pose.lng), 7),
    lat: round(pose.lat, 7),
    bearing: round(normalizeBearing(finite(pose.bearing) ? pose.bearing : 0), 2),
    pitch: round(clamp(finite(pose.pitch) ? pose.pitch : 0, TOUR_LIMITS.minPitch, TOUR_LIMITS.maxPitch), 2),
  }
  if (finite(pose.zoom)) result.zoom = round(clamp(pose.zoom, TOUR_LIMITS.minZoom, TOUR_LIMITS.maxZoom), 3)
  if (finite(pose.eyeHeightMeters))
    result.eyeHeightMeters = round(
      clamp(pose.eyeHeightMeters, TOUR_LIMITS.minEyeHeightMeters, TOUR_LIMITS.maxEyeHeightMeters),
      2,
    )
  if (finite(pose.fieldOfViewDegrees))
    result.fieldOfViewDegrees = round(
      clamp(pose.fieldOfViewDegrees, TOUR_LIMITS.minFieldOfViewDegrees, TOUR_LIMITS.maxFieldOfViewDegrees),
      2,
    )
  return result
}

function readLabel(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const label = value.replace(/\s+/g, ' ').trim().slice(0, TOUR_LIMITS.maxLabelLength)
  return label || undefined
}

function readStop(raw: unknown, index: number): TourStop {
  const label = `Stop ${index + 1}`
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TourFileError(`${label} is not a stop.`)
  const stop = raw as Record<string, unknown>
  const result: TourStop = {
    pose: readPose(stop.pose, label),
    holdMs: clampHoldMs(finite(stop.holdMs) ? stop.holdMs : NaN),
    transitionMs: clampTransitionMs(finite(stop.transitionMs) ? stop.transitionMs : NaN),
  }
  const name = readLabel(stop.label)
  if (name) result.label = name
  return result
}

/**
 * A tour held to `TOUR_LIMITS`: positions rounded, bearings wrapped, pitch, zoom, eye height,
 * field of view and timings clamped. Throws `TourFileError` for a stop with no valid position
 * or more than `maxStops` stops. What `serializeTour` writes and `parseTour` returns.
 */
export function normalizeTour(tour: Tour): Tour {
  if (tour.stops.length > TOUR_LIMITS.maxStops)
    throw new TourFileError(`The tour has too many stops (${tour.stops.length}; at most ${TOUR_LIMITS.maxStops}).`)
  const result: { name?: string; stops: TourStop[] } = { stops: tour.stops.map(readStop) }
  const name = readLabel(tour.name)
  if (name) result.name = name
  return result
}

/** The tour as a JSON file's text, held to the same limits `parseTour` reads it back with. */
export function serializeTour(tour: Tour): string {
  const normalized = normalizeTour(tour)
  return `${JSON.stringify({ type: TOUR_FILE_TYPE, version: TOUR_FILE_VERSION, ...normalized }, null, 2)}\n`
}

/** Read a tour file. Throws `TourFileError` naming what is wrong; out-of-range values are clamped, not refused. */
export function parseTour(text: string): Tour {
  if (text.length > TOUR_LIMITS.maxFileLength) throw new TourFileError('The tour file is too large.')
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new TourFileError('The tour file is not valid JSON.')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TourFileError('The file is not a tour.')
  const file = raw as Record<string, unknown>
  if (file.type !== TOUR_FILE_TYPE) throw new TourFileError('The file is not a PGMaps tour.')
  if (typeof file.version !== 'number' || !Number.isInteger(file.version) || file.version < 1)
    throw new TourFileError('The tour file has no valid version.')
  if (file.version > TOUR_FILE_VERSION)
    throw new TourFileError(
      `The tour file is version ${file.version}, made by a newer PGMaps; this one reads version ${TOUR_FILE_VERSION}.`,
    )
  if (!Array.isArray(file.stops) || !file.stops.length) throw new TourFileError('The tour has no stops.')
  if (file.stops.length > TOUR_LIMITS.maxStops)
    throw new TourFileError(`The tour has too many stops (${file.stops.length}; at most ${TOUR_LIMITS.maxStops}).`)
  return normalizeTour({ name: typeof file.name === 'string' ? file.name : undefined, stops: file.stops as TourStop[] })
}
