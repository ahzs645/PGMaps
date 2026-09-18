/**
 * The parts of FS1252 a desk run can fill in.
 *
 * *Visual Quality Effectiveness Evaluation* (FS1252, 2008/04) is the Forest and
 * Range Evaluation Program's monitoring form: a field crew stands at a
 * viewpoint, photographs an alteration that already exists, judges it by eye,
 * and the office half of the form turns that into a rating. Most of it
 * therefore cannot be computed, and this module does not pretend otherwise.
 *
 * Some of it can. Where the form asks for something a viewshed run already
 * knows — the direction you look to see the alteration, how long you see it
 * for, how far away it is — computing it is better than leaving a blank,
 * because those are the fields a person is least able to estimate standing at
 * the roadside with a clipboard.
 *
 * Everything here is stated as the form states it, so a figure can be carried
 * straight across to the paper version.
 */

import type { AnalysisResult, TargetVisibility } from './types'
import { bearingDegrees, haversineMeters, type GeoPoint } from './visibility'

/** Speed assumed when turning an exposed length of road into a viewing time. */
export const DEFAULT_TRAVEL_SPEED_KMH = 80

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']

/** Sixteen-point compass name for a bearing, for the form's "Viewing Direction". */
export function compassPoint(degrees: number): string {
  if (!Number.isFinite(degrees)) return '—'
  const normalised = ((degrees % 360) + 360) % 360
  return COMPASS[Math.round(normalised / 22.5) % 16]
}

/** Smallest angle between two bearings, 0–180. */
export function bearingDifference(a: number, b: number): number {
  const difference = Math.abs(((a - b) % 360) + 360) % 360
  return difference > 180 ? 360 - difference : difference
}

/**
 * Centre of the parts of a polygon that can be seen from anywhere on the
 * corridor — the point you are actually looking at, which on a partly screened
 * block is not its centroid.
 */
export function visibleCentre(target: TargetVisibility): GeoPoint | null {
  let lng = 0
  let lat = 0
  let count = 0
  for (let index = 0; index < target.sampleCount; index += 1) {
    if (!target.anyVisible[index]) continue
    lng += target.positions[index * 2]
    lat += target.positions[index * 2 + 1]
    count += 1
  }
  return count > 0 ? { lng: lng / count, lat: lat / count } : null
}

/**
 * Centre of everything proposed that can be seen, weighted by how much of each
 * block is visible. With one block it is that block; with several it is the
 * direction a viewer would say the harvesting is in.
 */
export function visibleProposalCentre(result: AnalysisResult): GeoPoint | null {
  let lng = 0
  let lat = 0
  let weight = 0
  for (const target of result.targets) {
    if (target.role !== 'block') continue
    const centre = visibleCentre(target)
    if (!centre) continue
    const share = target.visibleAreaMeters
    if (share <= 0) continue
    lng += centre.lng * share
    lat += centre.lat * share
    weight += share
  }
  return weight > 0 ? { lng: lng / weight, lat: lat / weight } : null
}

/**
 * FS1252 Table 2, design element 4 — "Distance between Alteration and
 * Viewpoint". The only one of the five design observations that is a
 * measurement rather than a judgement, so the only one this can supply.
 *
 * The form's bands leave 1 km and 8 km exactly unassigned ("> 8", "> 1 and
 * < 8", "< 1"); each boundary is taken as the more conservative side, since a
 * viewer at exactly 1 km is not meaningfully better off than one at 999 m.
 */
export type DesignScore = { score: -1 | 0 | 1; grade: 'Good' | 'Moderate' | 'Poor'; band: string }

export function designDistanceScore(distanceMeters: number | null): DesignScore | null {
  if (distanceMeters === null || !Number.isFinite(distanceMeters)) return null
  if (distanceMeters > 8000) return { score: -1, grade: 'Good', band: '> 8 km' }
  if (distanceMeters > 1000) return { score: 0, grade: 'Moderate', band: '> 1 and < 8 km' }
  return { score: 1, grade: 'Poor', band: '< 1 km' }
}

/**
 * FS1252 2.3.3 — the adjusted percent alteration, `X * (1 + 0.14 * Y)`.
 *
 * `X` is the initial alteration from 2.3.2 and `Y` the total of the three
 * adjustments: roads and side cast (0 to 3), tree retention (-2 to 0), and the
 * design total (-5 to +5). Y therefore runs -7 to +8, which scales the
 * alteration by anywhere from 0.02 to 2.12 — the adjustment dominates the
 * measurement, which is why this module will not guess at it.
 */
export function adjustedAlterationPercent(alterationPercent: number, totalAdjustment: number): number {
  return alterationPercent * (1 + 0.14 * totalAdjustment)
}

export type ViewpointImportance = {
  /** The form's 1–5 scale, or null when nothing proposed is ever in view. */
  rating: 1 | 2 | 3 | null
  label: string
  /** Length of corridor from which any proposed block can be seen. */
  exposedLengthMeters: number
  /** That length at the assumed travel speed. */
  exposedSeconds: number
  /** Share of the seeing stations that are travelling towards the alteration. */
  towardFraction: number
  assumedSpeedKmh: number
}

/**
 * FS1252 2.2.2 viewpoint importance, as far as a viewshed run can take it.
 *
 * The form's scale mixes two different things: how long you see the alteration
 * for (1–3), and what the viewpoint *is* (4 for a rest stop or campsite, 5 for
 * a community or tourism operation). The second pair are land-use facts no
 * terrain model holds, so a computed rating is a floor and never the answer —
 * a ten-second glimpse from a campground is still a 4.
 *
 * Levels 1 to 3 turn on duration and on whether you are travelling towards the
 * alteration, both of which fall out of the corridor run. Duration needs a
 * speed, which is an assumption, so it is returned alongside the rating rather
 * than buried in it.
 */
export function viewpointImportance(
  result: AnalysisResult,
  { speedKmh = DEFAULT_TRAVEL_SPEED_KMH }: { speedKmh?: number } = {},
): ViewpointImportance {
  const blocks = result.targets.filter((target) => target.role === 'block')
  const stations = result.stations
  const empty: ViewpointImportance = {
    rating: null,
    label: 'Nothing proposed is visible from the corridor',
    exposedLengthMeters: 0,
    exposedSeconds: 0,
    towardFraction: 0,
    assumedSpeedKmh: speedKmh,
  }
  if (blocks.length === 0 || stations.length < 2) return empty

  const sees = stations.map((_, index) => blocks.some((block) => (block.stations[index]?.visiblePercent ?? 0) > 0))
  if (!sees.some(Boolean)) return empty

  // A stretch counts as exposed when either end of it sees something, which is
  // the same convention the map's graded corridor is drawn on.
  let exposedLengthMeters = 0
  for (let index = 1; index < stations.length; index += 1) {
    if (!sees[index - 1] && !sees[index]) continue
    exposedLengthMeters += haversineMeters(stations[index - 1], stations[index])
  }

  const centre = visibleProposalCentre(result)
  let toward = 0
  let seeing = 0
  for (let index = 0; index < stations.length; index += 1) {
    if (!sees[index]) continue
    seeing += 1
    if (!centre) continue
    // Heading along the corridor here, taken from the next station, or the
    // previous one at the far end where there is no next.
    const ahead = index + 1 < stations.length ? stations[index + 1] : null
    const behind = index > 0 ? stations[index - 1] : null
    const heading = ahead
      ? bearingDegrees(stations[index], ahead)
      : behind
        ? bearingDegrees(behind, stations[index])
        : null
    if (heading === null) continue
    if (bearingDifference(heading, bearingDegrees(stations[index], centre)) <= 45) toward += 1
  }

  const towardFraction = seeing > 0 ? toward / seeing : 0
  const exposedSeconds = exposedLengthMeters / ((speedKmh * 1000) / 3600)

  if (exposedSeconds < 10) {
    return {
      rating: 1,
      label: 'Glimpse view, less than 10 seconds',
      exposedLengthMeters,
      exposedSeconds,
      towardFraction,
      assumedSpeedKmh: speedKmh,
    }
  }
  if (exposedSeconds > 60 && towardFraction >= 0.5) {
    return {
      rating: 3,
      label: 'Sustained focal view, travelling toward the alteration for more than one minute',
      exposedLengthMeters,
      exposedSeconds,
      towardFraction,
      assumedSpeedKmh: speedKmh,
    }
  }
  return {
    rating: 2,
    label: 'Sustained side view',
    exposedLengthMeters,
    exposedSeconds,
    towardFraction,
    assumedSpeedKmh: speedKmh,
  }
}
