/**
 * Where the eye stands at a stood-at viewpoint, and the reviewer's surveyed eye elevation there.
 *
 * A stood-at viewpoint is a spot, or a pullout no longer than twice `PULLOUT_METERS` (what *Stand
 * here* lays through an inventory viewpoint, and what the road view's bar already treats as a spot).
 * The terrain model is a smoothed regional DEM: at a lookout on a bluff or a dam crest it can read
 * metres off the surveyed ground, so the reviewer may enter the eye's own elevation. It is a run
 * input — every station's eye stands there — and the road view and its captures stand there too.
 *
 * A view of interest stood at may instead carry its own eye height above the terrain model's ground
 * (`StandEyeHeight`: a truck cab, a lookout's deck). It is a run input at that stand in the same way,
 * in place of the scene's eye height, and lapses the same way when the viewpoint moves; where a
 * surveyed elevation applies too, the elevation wins, as a photo's altitude does.
 *
 * Kept free of DOM and network access.
 */
import type { Bounds } from '@/lib/forestry/terrain/terrain'
import type { StandEyeHeight, SurveyedEye, Viewpoint } from './types'
import { haversineMeters, lineLengthMeters } from './visibility'
import { pointAlongBearing, roadPath, roadPlacement } from './driveMath'
import { MAX_EYE_HEIGHT_METERS, MIN_EYE_HEIGHT_METERS } from './viewCamera'

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

/**
 * The stand's own eye height above the terrain model's ground that applies now, or null: none, a road, set for
 * another point, or a surveyed elevation applies (the elevation wins). The run, the road view and the captures all
 * stand at it in place of the scene's eye height.
 */
export function standEyeHeight(
  viewpoint: Placed & { surveyedEye?: SurveyedEye; standEyeHeight?: StandEyeHeight },
): number | null {
  const own = viewpoint.standEyeHeight
  if (!own || surveyedEyeElevation(viewpoint) !== null) return null
  const stand = standingPoint(viewpoint)
  if (!stand || haversineMeters(stand, own) > SURVEYED_EYE_MATCH_METERS) return null
  return own.heightMeters
}

/** The record to keep for an eye height set at this viewpoint; undefined clears it (none, a road, or out of range). */
export function standEyeHeightFor(viewpoint: Placed, heightMeters: number | null): StandEyeHeight | undefined {
  const stand = standingPoint(viewpoint)
  if (!stand || heightMeters === null || !isEyeHeight(heightMeters)) return undefined
  return { heightMeters, lng: stand.lng, lat: stand.lat }
}

function isEyeHeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_EYE_HEIGHT_METERS &&
    value <= MAX_EYE_HEIGHT_METERS
  )
}

/** Reads a saved record, dropping it rather than the scene when it is malformed. */
export function parseStandEyeHeight(raw: unknown): StandEyeHeight | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Partial<StandEyeHeight>
  if (!isEyeHeight(value.heightMeters)) return undefined
  if (typeof value.lng !== 'number' || typeof value.lat !== 'number') return undefined
  if (!(Math.abs(value.lng) <= 180) || !(Math.abs(value.lat) <= 85)) return undefined
  return { heightMeters: value.heightMeters, lng: value.lng, lat: value.lat }
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

/**
 * How far a photo viewpoint taken from the air loads ground ahead of its eye, metres: as far as the photo is laid on
 * the plan (25 km, where the terrain the drape reads stops). From 1,200 m looking 6° down the frame's middle lands
 * about 11 km out and its upper part, where the scene often is, further still.
 */
export const PHOTO_STAND_REACH_METERS = 25_000

/** Degrees either side of the frame the reach also covers, so a nudge of the heading stays on loaded ground. */
export const PHOTO_STAND_REACH_MARGIN_DEGREES = 10

/**
 * The ground a photo viewpoint's road view loads besides the road's and the blocks': a wedge from the eye along the
 * photo's heading, the frame's width plus `PHOTO_STAND_REACH_MARGIN_DEGREES` either side, out to `reachMeters`, as
 * west, south, east, north. Null for a photo with no altitude, which stands at eye height and sees what the road
 * view already loads. The road view keeps its tile budget: a wider box is loaded at a coarser zoom, never more tiles.
 */
export function photoStandReach(
  eye: { lng: number; lat: number },
  photo: { altitudeMeters: number | null; hfov: number },
  bearing: number,
  reachMeters = PHOTO_STAND_REACH_METERS,
): Bounds | null {
  if (photo.altitudeMeters === null || !Number.isFinite(photo.altitudeMeters)) return null
  if (![eye.lng, eye.lat, bearing, photo.hfov, reachMeters].every(Number.isFinite) || reachMeters <= 0) return null
  const half = Math.min(180, Math.max(0, photo.hfov) / 2 + PHOTO_STAND_REACH_MARGIN_DEGREES)
  const bounds: Bounds = [eye.lng, eye.lat, eye.lng, eye.lat]
  // Every 5° across the wedge and its two edges: the arc's bulge sets the box where the heading is not on an axis.
  const steps = Math.max(2, Math.ceil((2 * half) / 5))
  for (let i = 0; i <= steps; i++) {
    const point = pointAlongBearing(eye, bearing - half + (2 * half * i) / steps, reachMeters)
    bounds[0] = Math.min(bounds[0], point.lng)
    bounds[1] = Math.min(bounds[1], point.lat)
    bounds[2] = Math.max(bounds[2], point.lng)
    bounds[3] = Math.max(bounds[3], point.lat)
  }
  return bounds
}
