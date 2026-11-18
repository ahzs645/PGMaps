/**
 * The rules behind the own-photo queue (`useFieldPhoto`; doc proposal
 * `forestry-visual-quality-own-photo-redesign-2026-11-17.md`, §2.1): which photo runs next, what each cache is keyed
 * on, the ranges a search is given, and what a photo's status and reasons are. The hook holds the state and runs the
 * work; everything here is a plain function of its inputs, so the order and the keys are tested without a browser.
 *
 * Free of DOM and network access.
 */
import type { ExifReading, OwnPoseSources, PoseSource } from './exifPose'
import { sameCamera, type AcceptancePose, type PhotoAcceptance, type PhotoCameraMethod } from './photoAcceptance'
import { groupFlights, type LensCheck } from './photoFlight'
import { photoReasons, type PhotoFailureReason, type PhotoOptionKind, type PhotoQueueStatus } from './photoOptions'
import { imageryTileRange } from './photoViews'
import type { WideSearchInput, WideSearchResult } from './wideOrientation'

/** The overlay's terrain: zoom 11 out to 25 km, as many tiles as that takes up to 160. */
export const SKYLINE_RADIUS_METERS = 25000
export const SKYLINE_ZOOM = 11
export const SKYLINE_MAX_TILES = 160
/**
 * The all-headings search's terrain past it: an aircraft sees ridges far beyond 25 km, and a coarser ring at zoom 9
 * (about 180 m cells, some 20 tiles) is enough for ridges 25–90 km off.
 */
export const WIDE_RADIUS_METERS = 90000
export const WIDE_MAX_ZOOM = 9
export const WIDE_MAX_TILES = 40

/** The terrain rings round a photo's place, finest first (`photoTerrainSpec`). */
export const PHOTO_TERRAIN_RINGS = [
  { radiusMeters: SKYLINE_RADIUS_METERS, maxZoom: SKYLINE_ZOOM, maxTiles: SKYLINE_MAX_TILES },
  { radiusMeters: WIDE_RADIUS_METERS, maxZoom: WIDE_MAX_ZOOM, maxTiles: WIDE_MAX_TILES },
] as const

/** A tilt-sensor pitch is used only while it reads gravity alone (|a| within this of 1 g), then ± this many degrees. */
export const TILT_G_TOLERANCE = 0.05
export const TILT_PITCH_SPAN = 6

/**
 * A photo cropped after it was taken has at most the tagged lens. How much narrower it may be is not known; a crop to
 * 40% of the width is about as far as a crop that still shows a skyline goes.
 */
export const CROP_MIN_LENS_SHARE = 0.4

/** The initial angle sources the queue may replace with a search result. */
const AUTOMATIC_ANGLE = new Set<PoseSource>(['exif', 'road-view', 'default', 'level'])

/** Whether the angles, and the lens when fitted, still come from the initial camera. */
export function queueMaySetPose(
  sources: Pick<OwnPoseSources, 'heading' | 'pitch' | 'roll' | 'fov'>,
  changesLens: boolean,
): boolean {
  return (
    [sources.heading, sources.pitch, sources.roll].every((source) => AUTOMATIC_ANGLE.has(source)) &&
    (!changesLens || AUTOMATIC_ANGLE.has(sources.fov))
  )
}

/**
 * A phone's GPS altitude this far above the ground under it is an aircraft, not a GPS error: phone altitude is good to
 * some tens of metres, and a helicopter photo is hundreds of metres up.
 */
export const AIRBORNE_ABOVE_GROUND_METERS = 100

/**
 * The altitude the queue stands a photo's eye at before it searches: its GPS altitude when that is clearly above the
 * ground (`AIRBORNE_ABOVE_GROUND_METERS`), else null (eye height over the ground). Only while the eye is still the
 * default: a reviewer who said the photo was taken on the ground keeps it there.
 */
export function airborneAltitude({
  gpsAltitudeMeters,
  groundMeters,
  eyeSource,
}: {
  gpsAltitudeMeters: number | null | undefined
  groundMeters: number
  eyeSource: PoseSource
}): number | null {
  if (eyeSource !== 'default') return null
  if (gpsAltitudeMeters === null || gpsAltitudeMeters === undefined || !Number.isFinite(gpsAltitudeMeters)) return null
  if (!Number.isFinite(groundMeters)) return null
  return gpsAltitudeMeters - groundMeters >= AIRBORNE_ABOVE_GROUND_METERS ? gpsAltitudeMeters : null
}

/** The pitch the search looks in: the tilt sensor's ± a few degrees while it reads gravity alone, else by altitude. */
export function pitchRangeFor({
  tilt,
  airborne,
}: {
  tilt: ExifReading['tilt'] | null | undefined
  airborne: boolean
}): readonly [number, number] {
  if (tilt && Math.abs(tilt.g - 1) <= TILT_G_TOLERANCE)
    return [tilt.pitch - TILT_PITCH_SPAN, tilt.pitch + TILT_PITCH_SPAN]
  return airborne ? [-50, 10] : [-20, 15]
}

/** The lenses a cropped photo's search tries (`WideSearchInput.hfovRange`); null when the lens is as tagged. */
export function lensRangeFor(lens: Pick<LensCheck, 'cropped' | 'hfov'> | null | undefined): [number, number] | null {
  if (!lens?.cropped || lens.hfov === null) return null
  return [Math.max(3, lens.hfov * CROP_MIN_LENS_SHARE), lens.hfov]
}

/** The 360° horizon is the same for every eye within about 10 m and a metre of altitude. */
export function horizonKey(eye: { lng: number; lat: number; altitudeMeters: number }): string {
  return `${eye.lng.toFixed(4)},${eye.lat.toFixed(4)},${Math.round(eye.altitudeMeters)}`
}

/** Imagery round a place, finest first: near (zoom 14 to 6 km), middle (zoom 11 to 25 km) and far (zoom 9 to 90 km). */
export const IMAGERY_RINGS = [
  { radiusMeters: 6000, maxZoom: 14 },
  { radiusMeters: 25000, maxZoom: 11 },
  { radiusMeters: WIDE_RADIUS_METERS, maxZoom: 9 },
] as const

/** A ring's box round a place: west, south, east, north. */
export function imageryBox(lng: number, lat: number, radiusMeters: number): [number, number, number, number] {
  const degLat = radiusMeters / 110574,
    degLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180))
  return [lng - degLng, lat - degLat, lng + degLng, lat + degLat]
}

/**
 * Each ring's key for a place: the tiles its mosaic holds. Photos of one flight are hundreds of metres to kilometres
 * apart, and keyed by place (to 100 m, as this once was) every one of them loaded all three mosaics again; by tiles,
 * the far and middle rings are shared by a whole flight and the near ring by every photo over the same few tiles.
 */
export function imageryRingKeys(lng: number, lat: number): string[] {
  return IMAGERY_RINGS.map(({ radiusMeters, maxZoom }) => {
    const r = imageryTileRange(imageryBox(lng, lat, radiusMeters), maxZoom)
    return `${r.zoom}/${r.minX}-${r.maxX}/${r.minY}-${r.maxY}`
  })
}

/** The three rings' imagery round a place, as one key: the same tiles, the same key. */
export function imageryKey(lng: number, lat: number): string {
  return imageryRingKeys(lng, lat).join('|')
}

/** A search's result is the same for the same photo, camera start, ranges and priors. */
export function searchKey(input: {
  photoId: string
  pose: { lng: number; lat: number; altitudeMeters: number; width: number; height: number; focalPx: number }
  pitchRange?: readonly [number, number] | null
  rollRange?: readonly [number, number] | null
  headingSpan?: number | null
  hfovRange?: readonly [number, number] | null
  priors?: WideSearchInput['priors'] | null
}): string {
  const { pose } = input
  const range = (r: readonly [number, number] | null | undefined) => (r ? `${r[0]}~${r[1]}` : '-')
  const prior = (key: 'heading' | 'pitch' | 'roll') => {
    const p = input.priors?.[key]
    return p ? `${key}=${p.value.toFixed(2)}±${p.tolerance}` : ''
  }
  return [
    input.photoId,
    `${pose.lng.toFixed(6)},${pose.lat.toFixed(6)},${pose.altitudeMeters.toFixed(1)}`,
    `${pose.width}x${pose.height}@${pose.focalPx.toFixed(2)}`,
    range(input.pitchRange),
    range(input.rollRange),
    input.headingSpan ?? 180,
    range(input.hfovRange),
    prior('heading') + prior('pitch') + prior('roll'),
  ].join('|')
}

/** Features read for what a camera sees: a box rounded to about 100 m, so a nudge does not read them again. */
export function featuresKey(box: readonly [number, number, number, number]): string {
  return box.map((value) => value.toFixed(3)).join(',')
}

/**
 * Runs `work` over `items`, at most `lanes` at a time, and gives the results in the items' order. A flight's photos
 * are read this way: side by side, but never more at once than the browser decodes together.
 */
export async function inLanes<T, R>(
  items: readonly T[],
  lanes: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const lane = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await work(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(Math.floor(lanes) || 1, items.length)) }, lane))
  return results
}

type Timed = { id: string; takenAtUtc: string | null; name?: string; flightId?: string | null }

/** Photo ids in time order: flights in order, each frame in its flight's order; photos with no time last, by name. */
export function queueOrder(photos: readonly Timed[]): string[] {
  return groupFlights(photos).flatMap((flight) => flight.photos.map((photo) => photo.id))
}

/** The next photo to run: the earliest in time of those waiting. */
export function nextInQueue(pending: readonly string[], photos: readonly Timed[]): string | null {
  if (!pending.length) return null
  const waiting = new Set(pending)
  return queueOrder(photos).find((id) => waiting.has(id)) ?? null
}

/**
 * The photo whose features are read next, or null when none is due. The open photo's are read as soon as its search is
 * done, because its layers are what the reviewer is looking at. The others' wait until no search is running or
 * waiting, then go in time order; a paused or cancelled queue reads none of them, only the open photo's.
 */
export function featuresNext(input: {
  photos: ReadonlyArray<Timed & { positioned: boolean; searched: boolean; read: boolean }>
  activeId: string | null
  /** A search is running or waiting its turn. */
  searching: boolean
  /** The queue is paused or was cancelled. */
  held: boolean
}): string | null {
  const due = input.photos.filter((photo) => photo.positioned && photo.searched && !photo.read)
  if (!due.length) return null
  if (input.activeId && due.some((photo) => photo.id === input.activeId)) return input.activeId
  if (input.searching || input.held) return null
  const waiting = new Set(due.map((photo) => photo.id))
  return queueOrder(input.photos).find((id) => waiting.has(id)) ?? null
}

/** Each photo's flight and its place in it (`groupFlights`); a photo with no time is in none. */
export function photoFlights(photos: readonly Timed[]): Map<string, { flightId: string; frameIndex: number }> {
  const placed = new Map<string, { flightId: string; frameIndex: number }>()
  for (const flight of groupFlights(photos))
    if (flight.timed)
      flight.photos.forEach((photo, frameIndex) => placed.set(photo.id, { flightId: flight.id, frameIndex }))
  return placed
}

/** The camera the check images were drawn for that is the camera as it stands, else the last one drawn. */
export function checkedPoseFor(
  drawn: readonly AcceptancePose[],
  current: AcceptancePose | null,
): AcceptancePose | null {
  if (!drawn.length) return null
  if (current) {
    const same = drawn.find((pose) => sameCamera(pose, current))
    if (same) return same
  }
  return drawn[drawn.length - 1]
}

/** Keeps the cameras checks were drawn for, the newest last, without repeats and at most `limit`. */
export function withCheckedPose(drawn: readonly AcceptancePose[], pose: AcceptancePose, limit = 8): AcceptancePose[] {
  return [...drawn.filter((other) => !sameCamera(other, pose)), pose].slice(-limit)
}

/** How a camera chosen from an options row was found, for its acceptance. */
export function methodForOption(kind: PhotoOptionKind): PhotoCameraMethod {
  switch (kind) {
    case 'winner':
    case 'runner-up':
      return 'skyline'
    case 'phone':
      return 'phone'
    case 'neighbour':
      return 'neighbour'
    case 'landmark':
      return 'landmark'
    case 'points':
      return 'points'
    case 'matched':
      return 'matched'
  }
}

/** How a camera was found, from where its heading came, when no options row names it. */
export function methodForSource(heading: PoseSource): PhotoCameraMethod {
  switch (heading) {
    case 'skyline':
      return 'skyline'
    case 'controls':
      return 'points'
    case 'matched':
      return 'matched'
    case 'exif':
      return 'phone'
    default:
      return 'typed'
  }
}

/** Where each angle comes from once an options row is used. */
export function sourcesForOption(kind: PhotoOptionKind): {
  heading: PoseSource
  pitch: PoseSource
  roll?: PoseSource
  /** Set too when the row moves the camera's place or lens (a point solve, a matched camera). */
  position?: PoseSource
} {
  switch (kind) {
    case 'winner':
    case 'runner-up':
      return { heading: 'skyline', pitch: 'skyline', roll: 'skyline' }
    case 'phone':
      return { heading: 'exif', pitch: 'exif', roll: 'level' }
    // Another frame's camera, taken by the reviewer for this one: theirs, as a typed value would be.
    case 'neighbour':
      return { heading: 'reviewer', pitch: 'reviewer', roll: 'reviewer' }
    case 'landmark':
      return { heading: 'landmark', pitch: 'landmark' }
    case 'points':
      return { heading: 'controls', pitch: 'controls', roll: 'controls', position: 'controls' }
    case 'matched':
      return { heading: 'matched', pitch: 'matched', roll: 'matched', position: 'matched' }
  }
}

/**
 * A point solve that is probably mis-paired: rolled over, or moved far from where the photo says it was. The rule the
 * camera tools' `solveLooksWrong` shows.
 */
export function controlSolveSuspect(solve: {
  pose: { roll: number }
  shift: { east: number; north: number; up: number }
}): boolean {
  return (
    Math.abs(solve.pose.roll) > 30 ||
    Math.hypot(solve.shift.east, solve.shift.north) > 150 ||
    Math.abs(solve.shift.up) > 100
  )
}

/** What the queue learned about a photo on its way to a camera. */
export type PhotoFound = {
  lens?: Pick<LensCheck, 'cropped'> | null
  /** False when no terrain loaded under the camera. */
  terrain?: boolean
  /** False when the photo's skyline gave too few columns. */
  skyline?: boolean
  /** Why the queue stopped without a result, in words: a missing position, a failed load. */
  stopped?: string | null
  /** What the reviewer should know that changes nothing: a narrow search that stood, model views not drawn. */
  notes?: string[]
}

/**
 * A photo's place in the queue. Searching while its search runs (the queue's, or one the reviewer started); accepted
 * while the camera is still the one accepted; checked once the check images were drawn for the camera as it stands;
 * then options once a search came back, failed when it could not.
 */
export function photoQueueStatus(input: {
  running: boolean
  queued: boolean
  acceptance: PhotoAcceptance | null
  /** The camera as it stands; null without a position. */
  pose: AcceptancePose | null
  checked: readonly AcceptancePose[]
  search: 'idle' | 'working' | 'done' | 'failed'
  found: PhotoFound | null
  hasCameraOption?: boolean
}): PhotoQueueStatus {
  if (input.running || input.search === 'working') return 'searching'
  const current = input.pose
  if (input.acceptance && current && sameCamera(input.acceptance.pose, current)) return 'accepted'
  if (current && input.checked.some((pose) => sameCamera(pose, current))) return 'checked'
  if (input.queued) return 'queued'
  if (input.search === 'done' || input.hasCameraOption) return 'options'
  if (
    input.search === 'failed' ||
    input.found?.stopped ||
    input.found?.terrain === false ||
    input.found?.skyline === false
  )
    return 'failed'
  // Never searched (the queue was cancelled before it, or the photo came back from a file): no options to choose yet.
  return 'unsearched'
}

/** The reasons a photo wants the reviewer (`photoReasons`), from what the queue found and the options it has. */
export function queueReasons(input: {
  found: PhotoFound | null
  search: Pick<WideSearchResult, 'trustworthy' | 'ambiguous'> | null
  /** Options other than the phone's own heading. */
  otherOptions: number
  neighbourGap: number | null
}): PhotoFailureReason[] {
  return photoReasons({
    lens: input.found?.lens ?? null,
    skyline: input.found?.skyline,
    terrain: input.found?.terrain,
    search: input.search,
    otherOptions: input.otherOptions,
    neighbourGap: input.neighbourGap,
  })
}

/** A photo's jobs with one linked (`on`) or taken off, as `linkPhotoJob` and `unlinkPhotoJob` do to its record. */
export function withPhotoUse<J extends string>(
  uses: ReadonlyArray<{ job: J; targetId?: string | null }>,
  job: J,
  on: boolean,
  targetId: string | null = null,
): Array<{ job: J; targetId?: string | null }> {
  const same = (use: { job: J; targetId?: string | null }) => use.job === job && (use.targetId ?? null) === targetId
  if (on) return uses.some(same) ? [...uses] : [...uses, { job, ...(targetId !== null ? { targetId } : {}) }]
  return uses.filter((use) => !same(use))
}
