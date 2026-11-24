/**
 * Where else the queue searches a photo whose skyline did not settle from where it stands (doc section **A photo of
 * your own**, *Places searched in the background*). A phone's GPS can be off by a kilometre while stating 125 m, and a
 * flat, distant skyline fits about as well at every heading from the wrong place, so a second search from the place
 * the evidence points to (the high ground at the GPS altitude, the area round the fix) is the next thing a reviewer
 * would try. Each search found is an options row standing at its own place: a hypothesis, never the camera.
 *
 * Free of DOM and network access: the hook (`useFieldPhoto.ts`) loads terrain and runs the searches.
 */
import type { PoseSource } from './exifPose'
import { compassPoint, groundDistance, type HighGround } from './highGround'
import type { PhotoLocation, PhotoLocationSearch } from './photoLocationSearch'
import { haversineMeters, metersPerDegree } from './visibility'
import type { SunCheck, WideSearchResult } from './wideOrientation'

/**
 * A stated GPS error at or past this many metres puts the place in doubt, so the area round the fix is searched.
 * Phones state 3–20 m under open sky; IMG_7996 stated 125 m and was 1.1 km out. A screen, not a measured threshold:
 * it only decides whether nine more searches run in the background.
 */
export const PLACE_DOUBT_ERROR_METERS = 100
/** Two places within this many metres are one place: inside a phone's GPS scatter and a terrain cell or two. */
export const SAME_PLACE_METERS = 25

/** One search made from a place other than where the camera stood. */
export type PlaceSearch = {
  id: string
  /** In words, for a row's label: "the high ground 1.2 km NNW". */
  label: string
  positionSource: PoseSource
  /** Why the place is a guess, said on its row. */
  warning: string
  at: { lng: number; lat: number; altitudeMeters: null; hfov: number }
  result: WideSearchResult
  sun: SunCheck | null
  /** The sun for the search's runner-up heading, when it has one. */
  runnerUpSun?: SunCheck | null
}

/** What the background search tried for a photo, and what it found. */
export type PhotoPlaces = {
  status: 'working' | 'done'
  /** What is being or was searched, in words, in order: "the high ground 1.2 km NNW", "9 places round it". */
  tried: string[]
  searches: PlaceSearch[]
  /** The area search, as the hand tool's *Find the photo location* shows it. */
  area: PhotoLocationSearch | null
  /** Where the area search was centred, and on what. */
  areaCentre: (PhotoLocation & { on: 'high-ground' | 'fix' }) | null
  /** Why something could not be searched, in words. */
  notes: string[]
}

/** Where to search a photo, beyond where it stands: nothing when the skyline settled or the reviewer placed it. */
export function placesToSearch(input: {
  /** The search from where the photo stands settled. */
  settled: boolean
  positionSource: PoseSource | null
  fix: PhotoLocation | null
  /** The GPS error the phone stated, metres; null when it stated none. */
  statedErrorMeters: number | null
  /** Ground at the GPS altitude near a fix far below it (`highGroundNearFix`). */
  highGround: HighGround | null
  /** The eye stands at an altitude: a photo from the air, whose fix is not the doubt. */
  airborne: boolean
}): { highGround: HighGround | null; area: (PhotoLocation & { on: 'high-ground' | 'fix' }) | null } {
  const none = { highGround: null, area: null }
  if (input.settled || !input.fix) return none
  // A place the reviewer set, solved or matched is theirs: only a place from the photo's own GPS is searched round.
  if (input.positionSource !== 'exif' && input.positionSource !== 'gps-altitude') return none
  if (input.highGround)
    return {
      highGround: input.highGround,
      area: { lng: input.highGround.lng, lat: input.highGround.lat, on: 'high-ground' },
    }
  if (!input.airborne && input.statedErrorMeters !== null && input.statedErrorMeters >= PLACE_DOUBT_ERROR_METERS)
    return { highGround: null, area: { ...input.fix, on: 'fix' } }
  return none
}

/** The compass bearing from one place to another, degrees from north (flat: these places are a kilometre or two apart). */
export function bearingTo(from: PhotoLocation, to: PhotoLocation): number {
  const scale = metersPerDegree(from.lat)
  const east = (to.lng - from.lng) * scale.lng
  const north = (to.lat - from.lat) * scale.lat
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360
}

/** A place in words, relative to the GPS fix: "the GPS fix", or "a place 500 m E of the fix". */
export function placeFromFix(place: PhotoLocation, fix: PhotoLocation | null): string {
  if (!fix) return 'a searched place'
  const metres = haversineMeters(fix, place)
  if (metres <= SAME_PLACE_METERS) return 'the GPS fix'
  return `a place ${groundDistance(metres)} ${compassPoint(bearingTo(fix, place))} of the fix`
}

/** The high ground in words, as its row and its search are labelled. */
export const highGroundLabel = (high: Pick<HighGround, 'distanceMeters' | 'bearing'>) =>
  `the high ground ${groundDistance(high.distanceMeters)} ${compassPoint(high.bearing)}`

/**
 * Where the search from the photo's own place stood, in words, when the camera has since moved away from it; null
 * while the camera still stands there (its rows then need no place in their label).
 */
export function searchPlaceName(input: {
  searchedAt: PhotoLocation
  standsAt: PhotoLocation
  fix: PhotoLocation | null
  highGround: PhotoLocation | null
}): string | null {
  if (haversineMeters(input.searchedAt, input.standsAt) <= SAME_PLACE_METERS) return null
  if (input.fix && haversineMeters(input.searchedAt, input.fix) <= SAME_PLACE_METERS) return 'the GPS fix'
  if (input.highGround && haversineMeters(input.searchedAt, input.highGround) <= SAME_PLACE_METERS)
    return 'the high ground'
  return 'where it was first searched'
}

/** A fit within this many degrees of the phone's heading agrees with it (`NEIGHBOUR_AGREE_DEGREES`'s tolerance). */
export const PHONE_TIE_BREAK_DEGREES = 15

/**
 * The area search's place worth a row, and why: its best fit when one stands clearly ahead (`clear`); else, from a
 * near tie, the best fit within `PHONE_TIE_BREAK_DEGREES` of the phone's heading (`phone`), the second sensor the tie
 * needs, as a pair landmark would be; null when neither, or when that place was already searched. The top of a tie
 * alone is never a suggestion (`rankPhotoLocations`).
 */
export function areaPick(
  area: PhotoLocationSearch | null,
  /** Cameras already rows: a place and the headings fitted there. The same place facing another way is not one. */
  already: ReadonlyArray<PhotoLocation & { bearings: readonly number[] }>,
  /** The phone's heading from true north, held on the ground; null without one. */
  phoneBearing: number | null,
): { place: PhotoLocation & { fit: WideSearchResult }; by: 'clear' | 'phone' } | null {
  if (area?.status !== 'done' || !area.candidates.length) return null
  const gap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180)
  const fresh = (place: PhotoLocation & { fit: WideSearchResult }) =>
    !already.some(
      (other) =>
        haversineMeters(other, place) <= SAME_PLACE_METERS &&
        other.bearings.some((bearing) => gap(bearing, place.fit.bearing) <= PHONE_TIE_BREAK_DEGREES),
    )
  if (!area.ambiguous) return fresh(area.candidates[0]) ? { place: area.candidates[0], by: 'clear' } : null
  if (phoneBearing === null) return null
  const agreeing = area.candidates.find((place) => gap(place.fit.bearing, phoneBearing) <= PHONE_TIE_BREAK_DEGREES)
  return agreeing && fresh(agreeing) ? { place: agreeing, by: 'phone' } : null
}

/** Whether any search from another place settled: the photo then needs no comparison by the look of the ground. */
export const placeSettled = (places: PhotoPlaces | null | undefined) =>
  !!places?.searches.some((search) => search.result.trustworthy)
