/**
 * The camera's heading, pitch and roll from the photo's skyline, searched over every heading: the browser form of the
 * photo-matching bench's `orient.ts` (`scripts/forestry/photo-matching/`). From an aircraft a phone's recorded heading
 * can be 50–140° out (`docs/research/landscape-photo-matching-2026-11-14.md`), so a search round it finds nothing or a
 * false match; this one looks everywhere and says when a second heading fits about as well.
 *
 * A coarse search in angles first: each skyline column is a ray, scored against the terrain's horizon at the ray's
 * azimuth (sky below the bare ridge weighted 3×, each column's loss capped at 1°). Turning the camera about the
 * vertical changes a ray's azimuth but never its elevation angle, so for each pitch and roll the rays are worked out
 * once and every heading is then a shift along the horizon table. Then `fitSkyline`, unchanged, refines heading and
 * pitch at rolls a quarter degree apart round the coarse roll, given only the horizon round the frame.
 *
 * Free of DOM and network access: the horizon profile and the photo's skyline are passed in.
 */
import { cameraAxes, type PhotoPose } from './photoPose'
import { fitSkyline, type ProfilePoint, type SkylineFit } from './skylineFit'

const RAD = Math.PI / 180
/** Horizon table spacing, degrees of azimuth. */
export const HORIZON_STEP = 0.1
const SLOTS = Math.round(360 / HORIZON_STEP)
/**
 * A runner-up heading this close in mean loss per column (degrees) fits about as well: the camera is ambiguous.
 * Provisional, as in the bench, from four cases (November 2026): right cameras had gaps of 0.138° and 0.144°.
 */
export const AMBIGUOUS_LOSS_GAP = 0.1
/** A runner-up must be at least this far round to count as a different heading. */
export const RUNNER_UP_MIN_DEGREES = 15
/** The fewest skyline columns worth searching with. */
export const MIN_SKYLINE_COLUMNS = 12

export type Range = readonly [number, number]

export interface WideSearchInput {
  /** The camera to start from: position, altitude, frame and lens. Its heading only centres a narrower search. */
  pose: PhotoPose
  /** The terrain horizon round the camera, from `terrainProfile` over 0–360°. */
  profile: readonly ProfilePoint[]
  /** The photo's skyline, in `pose`'s pixels. */
  skyline: ReadonlyArray<{ x: number; y: number } | null>
  /** Degrees; default −50° to +10° (an aircraft looks down; a tilt sensor narrows it). */
  pitchRange?: Range
  /** Degrees; default ±15°. */
  rollRange?: Range
  /** Half-width of the heading search round `pose.bearing`, degrees; 180 searches every heading. */
  headingSpan?: number
  /**
   * Keep each angle near a value within a tolerance, degrees: from a landmark clicked at the photo's centre, a flight
   * track, or the tilt sensor. A prior narrows the search, so a runner-up outside it is never considered.
   */
  priors?: Partial<Record<'heading' | 'pitch' | 'roll', { value: number; tolerance: number }>>
  /**
   * The field of view across the photo, degrees, when its lens is not known: a photo cropped after it was taken has
   * at most the tagged lens (`lensCheck`, `photoFlight.ts`). The search then tries lenses across the range
   * (`LENS_STEP_DEGREES` apart, at most `MAX_LENS_STEPS`) and keeps the one whose skyline fits best; `pose.focalPx`
   * is not used.
   */
  hfovRange?: Range
  /** Called with the share of the coarse search done, 0–1. */
  onProgress?: (done: number) => void
  /** Returns true to stop early (cancelled); the search then returns null. */
  cancelled?: () => boolean
}

export interface WideSearchResult {
  bearing: number
  pitch: number
  roll: number
  fit: SkylineFit
  columns: number
  /** Coarse loss per column (degrees) of the best pose. */
  meanLoss: number
  /** The best heading at least `RUNNER_UP_MIN_DEGREES` away, with its pitch and roll. */
  runnerUp: { bearing: number; pitch: number; roll: number; meanLoss: number } | null
  /** Another heading fits about as well: check both before trusting either. */
  ambiguous: boolean
  /** `fitSkyline` trusts the fit and no clearly different heading fits about as well. */
  trustworthy: boolean
  /** The lens the fit was found at, degrees across: only when `hfovRange` was searched. */
  hfov?: number
}

/** Lenses tried across an `hfovRange`, this many degrees apart … */
export const LENS_STEP_DEGREES = 3
/** … and never more than this many: each is a whole search. */
export const MAX_LENS_STEPS = 7

const wrap = (degrees: number) => ((degrees % 360) + 360) % 360

/** The horizon's elevation angle per `HORIZON_STEP` of azimuth; NaN where the profile has no terrain. */
export function horizonTable(profile: readonly ProfilePoint[]): Float64Array {
  const table = new Float64Array(SLOTS).fill(Number.NaN)
  for (const point of profile) table[Math.round(wrap(point.azimuth) / HORIZON_STEP) % SLOTS] = point.elevation
  return table
}

/** Horizon beyond the frame's half-diagonal kept for the fine fit, degrees: past fitSkyline's ±3° nudge and roll. */
export const FINE_MARGIN_DEGREES = 10

/** Half the frame's diagonal field of view, degrees. */
export function frameHalfDiagonal(pose: Pick<PhotoPose, 'width' | 'height' | 'focalPx'>): number {
  return Math.atan(Math.hypot(pose.width, pose.height) / 2 / pose.focalPx) / RAD
}

/** The horizon within `half` degrees of `bearing`, its azimuths kept continuous across north. */
export function horizonSlice(profile: readonly ProfilePoint[], bearing: number, half: number): ProfilePoint[] {
  if (half >= 180) return [...profile]
  return profile.flatMap((point) => {
    const delta = ((point.azimuth - bearing + 540) % 360) - 180
    return Math.abs(delta) <= half ? [{ ...point, azimuth: bearing + delta }] : []
  })
}

/**
 * Searches every heading in `headingSpan` for the pose whose terrain horizon lies on the photo's skyline; across a
 * range of lenses too when `hfovRange` is given.
 */
export function searchOrientation(input: WideSearchInput): WideSearchResult | null {
  const range = input.hfovRange
  if (!range) return searchAtLens(input)
  const lo = Math.max(3, Math.min(range[0], range[1])),
    hi = Math.min(150, Math.max(range[0], range[1]))
  const steps = hi - lo < 1e-6 ? 1 : Math.min(MAX_LENS_STEPS, Math.ceil((hi - lo) / LENS_STEP_DEGREES) + 1)
  let best: WideSearchResult | null = null
  for (let k = 0; k < steps; k++) {
    const hfov = steps === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * k) / (steps - 1)
    const focalPx = input.pose.width / (2 * Math.tan((hfov * RAD) / 2))
    const found = searchAtLens({
      ...input,
      pose: { ...input.pose, focalPx },
      onProgress: input.onProgress && ((done) => input.onProgress!((k + done) / steps)),
    })
    if (input.cancelled?.()) return null
    // The lens whose skyline the fine fit holds best, as the fine fit itself chooses a roll; then the coarser loss.
    const score = (result: WideSearchResult) => result.fit.agreeing * result.fit.agreement
    if (
      found &&
      (!best || score(found) > score(best) || (score(found) === score(best) && found.meanLoss < best.meanLoss))
    )
      best = { ...found, hfov }
  }
  return best
}

function searchAtLens(input: WideSearchInput): WideSearchResult | null {
  const { profile, onProgress, cancelled, priors } = input
  const narrow = (range: Range, prior?: { value: number; tolerance: number }): Range => {
    if (!prior) return range
    const low = Math.max(range[0], prior.value - prior.tolerance),
      high = Math.min(range[1], prior.value + prior.tolerance)
    // A prior outside the range wins: the person's evidence over the default bounds.
    return low <= high ? [low, high] : [prior.value - prior.tolerance, prior.value + prior.tolerance]
  }
  const pitchRange = narrow(input.pitchRange ?? [-50, 10], priors?.pitch)
  const rollRange = narrow(input.rollRange ?? [-15, 15], priors?.roll)
  const pose = priors?.heading ? { ...input.pose, bearing: priors.heading.value } : input.pose
  const span = Math.min(180, Math.max(0, priors?.heading ? priors.heading.tolerance : (input.headingSpan ?? 180)))
  const skyline = input.skyline.filter((point): point is { x: number; y: number } => !!point)
  if (skyline.length < MIN_SKYLINE_COLUMNS) return null
  const horizon = horizonTable(profile)
  const n = skyline.length
  // Each column's direction in camera space: right and down offsets on a unit focal plane.
  const nx = skyline.map((point) => (point.x - pose.width / 2) / pose.focalPx)
  const ny = skyline.map((point) => (point.y - pose.height / 2) / pose.focalPx)
  const offset = new Float64Array(n),
    elevation = new Float64Array(n)
  const headings = Math.max(1, Math.round((2 * span) / 0.5))
  const sectors = Array.from({ length: 36 }, () => ({ bearing: Number.NaN, pitch: 0, roll: 0, loss: Infinity }))
  let coarse = { bearing: pose.bearing, pitch: 0, roll: 0, loss: Infinity }
  const rolls = Math.floor(rollRange[1] - rollRange[0]) + 1
  for (let r = 0; r < rolls; r++) {
    const roll = rollRange[0] + r
    for (let pitch = pitchRange[0]; pitch <= pitchRange[1] + 1e-9; pitch += 0.5) {
      if (cancelled?.()) return null
      // The rays at heading 0: azimuth offset and elevation angle per column, independent of heading.
      const { right, down, forward } = cameraAxes({ bearing: 0, pitch, roll })
      for (let i = 0; i < n; i++) {
        const e = forward[0] + nx[i] * right[0] + ny[i] * down[0],
          north = forward[1] + nx[i] * right[1] + ny[i] * down[1],
          up = forward[2] + nx[i] * right[2] + ny[i] * down[2]
        offset[i] = Math.atan2(e, north) / RAD
        elevation[i] = Math.atan2(up, Math.hypot(e, north)) / RAD
      }
      for (let h = 0; h < headings; h++) {
        const bearing = pose.bearing - span + h * 0.5
        const heading = wrap(bearing)
        const sector = sectors[Math.floor(heading / 10) % 36]
        let loss = 0
        for (let i = 0; i < n; i++) {
          const t = horizon[Math.round(wrap(heading + offset[i]) / HORIZON_STEP) % SLOTS]
          if (Number.isNaN(t)) loss += 1
          else {
            const d = elevation[i] - t
            loss += Math.min(1, d < 0 ? -3 * d : d)
          }
          if (loss >= sector.loss) break
        }
        if (loss < sector.loss) Object.assign(sector, { bearing: heading, pitch, roll, loss })
        if (loss < coarse.loss) coarse = { bearing, pitch, roll, loss }
      }
    }
    onProgress?.((r + 1) / rolls)
  }
  if (!Number.isFinite(coarse.loss)) return null
  const best = wrap(coarse.bearing)
  const apart = (bearing: number) => Math.abs(((bearing - best + 540) % 360) - 180) >= RUNNER_UP_MIN_DEGREES
  const runner = sectors.filter((s) => Number.isFinite(s.loss) && apart(s.bearing)).sort((a, b) => a.loss - b.loss)[0]
  const meanLoss = coarse.loss / n
  const runnerUp = runner
    ? { bearing: runner.bearing, pitch: runner.pitch, roll: runner.roll, meanLoss: runner.loss / n }
    : null
  // Fine: fitSkyline (heading and pitch) at quarter-degree rolls round the coarse roll. It projects every horizon
  // point it is given, so it gets the slice round the frame: its ±3° nudge never reaches past the margin.
  const slice = horizonSlice(profile, coarse.bearing, frameHalfDiagonal(pose) + FINE_MARGIN_DEGREES)
  let found: { bearing: number; pitch: number; roll: number; fit: SkylineFit } | null = null
  for (let roll = coarse.roll - 1; roll <= coarse.roll + 1 + 1e-9; roll += 0.25) {
    if (cancelled?.()) return null
    const fit = fitSkyline({ ...pose, bearing: coarse.bearing, pitch: coarse.pitch, roll }, slice, input.skyline)
    if (!fit) continue
    const score = fit.agreeing * fit.agreement
    const bestScore = found ? found.fit.agreeing * found.fit.agreement : -Infinity
    if (!found || score > bestScore || (score === bestScore && fit.medianErrorPx < found.fit.medianErrorPx))
      found = {
        bearing: wrap(coarse.bearing + fit.nudge.bearing),
        pitch: coarse.pitch + fit.nudge.pitch,
        roll,
        fit,
      }
  }
  if (!found) return null
  const ambiguous = !!runnerUp && runnerUp.meanLoss - meanLoss < AMBIGUOUS_LOSS_GAP
  return { ...found, columns: n, meanLoss, runnerUp, ambiguous, trustworthy: found.fit.trustworthy && !ambiguous }
}

/** Sun azimuth (degrees from true north) and elevation at a UTC instant; NOAA's low-precision formulae. */
export function sunPosition(lng: number, lat: number, utc: Date): { azimuth: number; elevation: number } {
  const n = utc.getTime() / 86400000 + 2440587.5 - 2451545.0
  const L = (280.46 + 0.9856474 * n) % 360
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const eps = (23.439 - 0.0000004 * n) * RAD
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda))
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda))
  const gmst = (280.46061837 + 360.98564736629 * n) % 360
  const H = ((gmst + lng) % 360) * RAD - ra
  const la = lat * RAD
  const el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(H))
  const az = Math.atan2(-Math.sin(H), Math.tan(dec) * Math.cos(la) - Math.sin(la) * Math.cos(H))
  return { azimuth: wrap(az / RAD), elevation: el / RAD }
}

export interface SunCheck {
  azimuth: number
  elevation: number
  /** Where the sun falls in the photo for this camera, or null behind it. */
  pixel: { x: number; y: number } | null
  /** The sun's bearing relative to the camera's heading: negative to the left. */
  relativeBearing: number
  inFrame: boolean
}

/**
 * Where the sun should be for a camera: independent evidence for its heading. Sun-lit cloud, a bright sky on one side,
 * a backlit hillside or the way shadows fall can confirm one candidate and rule out another.
 */
export function sunCheck(pose: PhotoPose, utc: Date): SunCheck {
  const sun = sunPosition(pose.lng, pose.lat, utc)
  const sx = Math.sin(sun.azimuth * RAD) * Math.cos(sun.elevation * RAD),
    sy = Math.cos(sun.azimuth * RAD) * Math.cos(sun.elevation * RAD),
    sz = Math.sin(sun.elevation * RAD)
  const { right, down, forward } = cameraAxes(pose)
  const z = sx * forward[0] + sy * forward[1] + sz * forward[2]
  const pixel =
    z > 0
      ? {
          x: pose.width / 2 + (pose.focalPx * (sx * right[0] + sy * right[1] + sz * right[2])) / z,
          y: pose.height / 2 + (pose.focalPx * (sx * down[0] + sy * down[1] + sz * down[2])) / z,
        }
      : null
  return {
    ...sun,
    pixel,
    relativeBearing: ((sun.azimuth - pose.bearing + 540) % 360) - 180,
    inFrame: !!pixel && pixel.x >= 0 && pixel.x <= pose.width && pixel.y >= 0 && pixel.y <= pose.height,
  }
}
