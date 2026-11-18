/**
 * The camera's heading, pitch and roll from the photo's skyline, searched over every heading: the browser form of the
 * photo-matching bench's `orient.ts` (`scripts/forestry/photo-matching/`). From an aircraft a phone's recorded heading
 * can be 50–140° out (`docs/research/landscape-photo-matching-2026-11-14.md`), so a search round it finds nothing or a
 * false match; this one looks everywhere and says when a second heading fits about as well.
 *
 * A coarse search in angles first: each skyline column is a ray, scored against the terrain's horizon at the ray's
 * azimuth (sky below the bare ridge weighted 3×, each column's loss capped at 1°). Turning the camera about the
 * vertical changes a ray's azimuth but never its elevation angle, so for each pitch and roll the rays are worked out
 * once and every heading is then a shift along the horizon table. The strongest distinct headings are refined
 * equally, then checked against the bare-terrain and canopy band in the image.
 *
 * Free of DOM and network access: the horizon profile and the photo's skyline are passed in.
 */
import { cameraAxes, type PhotoPose } from './photoPose'
import { fitSkyline, type ProfilePoint, type SkylineFit } from './skylineFit'

const RAD = Math.PI / 180
/** Horizon table spacing, degrees of azimuth. */
export const HORIZON_STEP = 0.1
const SLOTS = Math.round(360 / HORIZON_STEP)
const HEADING_STEP = 0.5
const HEADING_SLOTS = HEADING_STEP / HORIZON_STEP
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

type SkylineCandidate = {
  bearing: number
  pitch: number
  roll: number
  /** Refined angular loss per column, in degrees. */
  meanLoss: number
  hfov?: number
}

export interface WideSearchResult extends SkylineCandidate {
  fit: SkylineFit
  columns: number
  /** The best heading at least `RUNNER_UP_MIN_DEGREES` away, with its pitch and roll. */
  runnerUp: SkylineCandidate | null
  /** Another heading fits about as well: check both before trusting either. */
  ambiguous: boolean
  /** `fitSkyline` trusts the fit and no clearly different heading fits about as well. */
  trustworthy: boolean
  /** The lens the fit was found at, degrees across: only when `hfovRange` was searched. */
  hfov?: number
}

/**
 * How well a search's result fits, to choose between the results of two skyline readers: a fit `fitSkyline` trusts
 * before one it does not, then the more agreeing columns at the higher agreement (the bench's rule, `orient.ts`).
 */
export const searchRank = (result: Pick<WideSearchResult, 'fit'>): number =>
  (result.fit.trustworthy ? 1e6 : 0) + result.fit.agreeing * result.fit.agreement

/** A fit this good by one reader needs no other reader tried. */
export const READER_SETTLED_AGREEMENT = 0.95

/** Lenses tried across an `hfovRange`, this many degrees apart … */
export const LENS_STEP_DEGREES = 3
/** … and never more than this many: each is a whole search. */
export const MAX_LENS_STEPS = 7

const wrap = (degrees: number) => ((degrees % 360) + 360) % 360
const headingGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)

function withRunnerUp(best: WideSearchResult, runnerUp: SkylineCandidate | null): WideSearchResult {
  const ambiguous = !!runnerUp && runnerUp.meanLoss - best.meanLoss < AMBIGUOUS_LOSS_GAP
  return { ...best, runnerUp, ambiguous, trustworthy: best.fit.trustworthy && !ambiguous }
}

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
  const results: WideSearchResult[] = []
  for (let k = 0; k < steps; k++) {
    const hfov = steps === 1 ? (lo + hi) / 2 : lo + ((hi - lo) * k) / (steps - 1)
    const focalPx = input.pose.width / (2 * Math.tan((hfov * RAD) / 2))
    const found = searchAtLens({
      ...input,
      pose: { ...input.pose, focalPx },
      onProgress: input.onProgress && ((done) => input.onProgress!((k + done) / steps)),
    })
    if (input.cancelled?.()) return null
    if (found)
      results.push({
        ...found,
        hfov,
        runnerUp: found.runnerUp && { ...found.runnerUp, hfov },
      })
  }
  // Each lens has its own competitors. Keep a different heading even when it
  // comes from a lens other than the winner's.
  const best = results.sort((a, b) => a.meanLoss - b.meanLoss)[0]
  if (!best) return null
  const runnerUp =
    results
      .flatMap(({ bearing, pitch, roll, meanLoss, hfov, runnerUp }) => [
        { bearing, pitch, roll, meanLoss, hfov },
        ...(runnerUp ? [runnerUp] : []),
      ])
      .filter((candidate) => headingGap(candidate.bearing, best.bearing) >= RUNNER_UP_MIN_DEGREES)
      .sort((a, b) => a.meanLoss - b.meanLoss)[0] ?? null
  return withRunnerUp(best, runnerUp)
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
  const offset = new Float64Array(n)
  const elevation = new Float64Array(n)
  const slots = new Int32Array(n)
  const halfSteps = Math.floor(span / HEADING_STEP)
  const headings = Array.from({ length: 2 * halfSteps + (span < 180 ? 1 : 0) }, (_, i) => ({
    bearing: wrap(pose.bearing + (i - halfSteps) * HEADING_STEP),
    pitch: 0,
    roll: 0,
    meanLoss: Infinity,
  }))
  const rays = (pitch: number, roll: number) => {
    // At heading zero, so every heading uses the same rays shifted round the horizon.
    const { right, down, forward } = cameraAxes({ bearing: 0, pitch, roll })
    for (let i = 0; i < n; i++) {
      const east = forward[0] + nx[i] * right[0] + ny[i] * down[0]
      const north = forward[1] + nx[i] * right[1] + ny[i] * down[1]
      const up = forward[2] + nx[i] * right[2] + ny[i] * down[2]
      offset[i] = Math.atan2(east, north) / RAD
      elevation[i] = Math.atan2(up, Math.hypot(east, north)) / RAD
    }
  }
  const columnLoss = (i: number, slot: number) => {
    const d = elevation[i] - horizon[slot % SLOTS]
    return Number.isNaN(d) ? 1 : Math.min(1, d < 0 ? -3 * d : d)
  }
  const regularSteps = (range: Range, step: number) =>
    Array.from({ length: Math.ceil((range[1] - range[0]) / step) + 1 }, (_, i) =>
      Math.min(range[1], range[0] + i * step),
    )
  const rolls = regularSteps(rollRange, 1)
  const pitches = regularSteps(pitchRange, 0.5)
  for (const [r, roll] of rolls.entries()) {
    for (const pitch of pitches) {
      if (cancelled?.()) return null
      rays(pitch, roll)
      for (let i = 0; i < n; i++) slots[i] = Math.round((headings[0].bearing + offset[i]) / HORIZON_STEP) + SLOTS
      headings.forEach((heading, h) => {
        let loss = 0
        for (let i = 0; i < n && loss < heading.meanLoss; i++) loss += columnLoss(i, slots[i] + h * HEADING_SLOTS)
        if (loss < heading.meanLoss) Object.assign(heading, { pitch, roll, meanLoss: loss })
      })
    }
    onProgress?.((r + 1) / rolls.length)
  }
  headings.forEach((heading) => {
    heading.meanLoss /= n
  })
  headings.sort((a, b) => a.meanLoss - b.meanLoss)
  if (!Number.isFinite(headings[0].meanLoss)) return null

  const refine = (candidate: SkylineCandidate, allowed: (bearing: number) => boolean): SkylineCandidate => {
    let best = candidate
    const near = (value: number, range: Range, margin: number, step: number) =>
      regularSteps([Math.max(range[0], value - margin), Math.min(range[1], value + margin)], step)
    const bearings = regularSteps([candidate.bearing - 0.5, candidate.bearing + 0.5], HORIZON_STEP).filter(
      (bearing) => headingGap(wrap(bearing), wrap(pose.bearing)) <= span + 1e-9 && allowed(wrap(bearing)),
    )
    for (const roll of near(candidate.roll, rollRange, 0.75, 0.25)) {
      for (const pitch of near(candidate.pitch, pitchRange, 0.4, 0.1)) {
        rays(pitch, roll)
        for (const bearing of bearings) {
          let loss = 0
          for (let i = 0; i < n; i++) loss += columnLoss(i, Math.round((bearing + offset[i]) / HORIZON_STEP) + SLOTS)
          const meanLoss = loss / n
          if (meanLoss < best.meanLoss) best = { bearing: wrap(bearing), pitch, roll, meanLoss }
        }
      }
    }
    return best
  }
  let best = refine(headings[0], () => true)
  const apart = (bearing: number) => headingGap(bearing, best.bearing) >= RUNNER_UP_MIN_DEGREES
  const runner = headings.find((heading) => apart(heading.bearing))
  let runnerUp = runner ? refine(runner, apart) : null
  if (runnerUp && runnerUp.meanLoss < best.meanLoss) [best, runnerUp] = [runnerUp, best]
  if (cancelled?.()) return null
  const slice = horizonSlice(profile, best.bearing, frameHalfDiagonal(pose) + FINE_MARGIN_DEGREES)
  const fit = fitSkyline({ ...pose, ...best }, slice, input.skyline, { bearingRange: 0, pitchRange: 0 })
  if (!fit) return null
  return withRunnerUp(
    {
      ...best,
      fit,
      columns: n,
      runnerUp: null,
      ambiguous: false,
      trustworthy: false,
    },
    runnerUp,
  )
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
