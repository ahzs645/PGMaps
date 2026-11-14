/**
 * Where the eye stands at a stood-at viewpoint, and the reviewer's surveyed eye elevation there.
 *
 * A stood-at viewpoint is a spot, or a pullout no longer than twice `PULLOUT_METERS` (what *Stand
 * here* lays through an inventory viewpoint, and what the road view's bar already treats as a spot).
 * The terrain model is a smoothed regional DEM: at a lookout on a bluff or a dam crest it can read
 * metres off the surveyed ground, so the reviewer may enter the eye's own elevation. It is a run
 * input — every station's eye stands there — and the road view and its captures stand there too.
 *
 * Kept free of DOM and network access.
 */
import type { SurveyedEye, Viewpoint } from './types'
import { haversineMeters, lineLengthMeters } from './visibility'
import { roadPath, roadPlacement } from './driveMath'

/**
 * The longest viewpoint still stood at rather than driven: twice `PULLOUT_METERS`, the road view's
 * own `spot` test (a test pins the two together; importing it here would pull the inventory reader
 * into the analysis worker).
 */
export const STOOD_AT_MAX_LENGTH_METERS = 60

/** A surveyed elevation lapses once the viewpoint's standing point moves further than this from where it was entered. */
export const SURVEYED_EYE_MATCH_METERS = 5

/**
 * In the road view, the eye stands at the surveyed elevation within this distance of its point and
 * on the terrain model further out: a pullout is 30 m long, and walking further leaves the lookout.
 */
export const SURVEYED_EYE_REACH_METERS = 20

/** Plausible eye elevations, metres above sea level. */
const MIN_ELEVATION = -500
const MAX_ELEVATION = 9000

type Placed = Pick<Viewpoint, 'mode' | 'coordinates'>

/** The point the eye stands at for a stood-at viewpoint (a spot, or a short pullout's middle); null for a road. */
export function standingPoint(viewpoint: Placed): { lng: number; lat: number } | null {
  const coordinates = viewpoint.coordinates
  if (!coordinates.length) return null
  if (viewpoint.mode === 'spot' || coordinates.length === 1) return { lng: coordinates[0][0], lat: coordinates[0][1] }
  const length = lineLengthMeters(coordinates)
  if (!(length <= STOOD_AT_MAX_LENGTH_METERS)) return null
  try {
    const middle = roadPlacement(roadPath(coordinates), length / 2)
    return middle ? { lng: middle.lng, lat: middle.lat } : null
  } catch {
    return null
  }
}

/** The surveyed eye elevation that applies to this viewpoint now, or null (none, a road, or entered for another point). */
export function surveyedEyeElevation(viewpoint: Placed & { surveyedEye?: SurveyedEye }): number | null {
  const surveyed = viewpoint.surveyedEye
  if (!surveyed) return null
  const stand = standingPoint(viewpoint)
  if (!stand || haversineMeters(stand, surveyed) > SURVEYED_EYE_MATCH_METERS) return null
  return surveyed.elevationMeters
}

/** The record to keep for an elevation typed at this viewpoint; undefined clears it (blank, a road, or out of range). */
export function surveyedEyeFor(viewpoint: Placed, elevationMeters: number | null): SurveyedEye | undefined {
  const stand = standingPoint(viewpoint)
  if (!stand || elevationMeters === null || !isElevation(elevationMeters)) return undefined
  return { elevationMeters, lng: stand.lng, lat: stand.lat }
}

/** The road view's eye elevation at `point`: the surveyed one near its point, else null for the terrain model's. */
export function surveyedEyeAt(surveyed: SurveyedEye | null | undefined, point: { lng: number; lat: number }) {
  if (!surveyed) return null
  return haversineMeters(point, surveyed) <= SURVEYED_EYE_REACH_METERS ? surveyed.elevationMeters : null
}

function isElevation(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= MIN_ELEVATION && value <= MAX_ELEVATION
}

/** Reads a saved record, dropping it rather than the scene when it is malformed. */
export function parseSurveyedEye(raw: unknown): SurveyedEye | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<SurveyedEye>
  if (!isElevation(value.elevationMeters)) return undefined
  if (typeof value.lng !== 'number' || typeof value.lat !== 'number') return undefined
  if (!(Math.abs(value.lng) <= 180) || !(Math.abs(value.lat) <= 85)) return undefined
  return { elevationMeters: value.elevationMeters, lng: value.lng, lat: value.lat }
}
