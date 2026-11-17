/**
 * Many own photos at once (doc proposal `forestry-visual-quality-own-photo-redesign-2026-11-17.md`, §2.1): when each
 * was taken, which belong to one flight, which frame of a burst can seed the next, and what lens each was taken
 * through.
 *
 * Time. A photo's instant is its camera clock with its `OffsetTimeOriginal`, else its GPS date and time stamp (UTC),
 * else the camera clock alone. That last has no zone, so its ISO text carries none (no `Z`): it orders a set of
 * photos from one camera but is not an instant, and `takenAt.zoneKnown` says so. An iPhone's GPS stamp is the fix's
 * time, which can trail the shutter: on one helicopter flight it ran 1–23 s behind the zoned clock. `gpsBehindSeconds`
 * reports that gap; the zoned clock orders a burst, since the GPS stamps would shuffle its frames.
 *
 * Lens. `FocalLengthIn35mmFormat` already includes a phone's digital zoom (an iPhone 15's 26 mm main camera at ×1.26
 * writes 33 mm), so it is applied once and `DigitalZoomRatio` never on top. The field-of-view maths is `exifPose.ts`'
 * `readExif`, not a copy of it.
 *
 * Free of DOM and network access: exifr's tags are passed in.
 */
import { readExif, gpsTimeUtc } from './exifPose'
import { wrapHeading } from './photoAcceptance'
import type { WideSearchInput } from './wideOrientation'

const RAD = Math.PI / 180

/** A gap longer than this between photos in time order starts a new flight. */
export const FLIGHT_GAP_SECONDS = 5 * 60
/** A burst neighbour is at most this far apart in time … */
export const BURST_MAX_SECONDS = 20
/** … and this far apart on the ground (a helicopter covers about 500 m in 20 s). */
export const BURST_MAX_METERS = 500
/** How far round a neighbour's camera the narrow search looks, degrees. */
export const NEIGHBOUR_HEADING_TOLERANCE = 15
export const NEIGHBOUR_PITCH_TOLERANCE = 10

type Tags = Record<string, unknown> | null | undefined

const num = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number')
    return value[1] ? value[0] / value[1] : null
  return null
}
const pad = (value: number, width = 2) => String(value).padStart(width, '0')

export type TakenAt = {
  /** ISO 8601. With `Z` when the instant is known; without a zone when it is the camera clock alone. */
  iso: string
  source: 'gps' | 'clock-offset' | 'camera-clock'
  /** False for the camera clock alone: it orders photos but is not a UTC instant. */
  zoneKnown: boolean
  /** How far the GPS stamp trails the zoned camera clock, seconds; null unless both are present. */
  gpsBehindSeconds: number | null
}

/** The camera clock's fields, from exifr's revived `Date` (its local fields are the clock) or the raw tag text. */
function clockFields(value: unknown, subSec: unknown): { date: string; time: string; ms: number } | null {
  let date: string, time: string
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
    time = `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`
  } else if (typeof value === 'string') {
    const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(value.trim())
    if (!match || match[1] === '0000') return null
    date = `${match[1]}-${match[2]}-${match[3]}`
    time = `${match[4]}:${match[5]}:${match[6]}`
  } else return null
  // SubSecTimeOriginal is the digits after the decimal point: "834" is 0.834 s, "03" is 0.03 s.
  const digits = typeof subSec === 'string' ? subSec.trim() : typeof subSec === 'number' ? String(subSec) : ''
  const ms = /^\d{1,9}$/.test(digits) ? Math.round(Number(`0.${digits}`) * 1000) % 1000 : 0
  return { date, time, ms }
}

/** `+HH:MM` / `-HH:MM` as minutes east of UTC. */
function offsetMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const match = /^([+-])(\d{2}):?(\d{2})$/.exec(value.trim())
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/** Milliseconds since the epoch of an ISO time; one without a zone is read as UTC, so the order never depends on the machine. */
export function instantOf(iso: string | null | undefined): number | null {
  if (!iso) return null
  const zoned = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}Z`
  const t = Date.parse(zoned)
  return Number.isFinite(t) ? t : null
}

/**
 * When a photo was taken: the zoned camera clock first (the shutter's own time), else the GPS stamp, else the camera
 * clock flagged as zone-less. `gpsBehindSeconds` says how far a GPS stamp trails the zoned clock when both are there.
 */
export function takenAtUtc(tags: Tags): TakenAt | null {
  if (!tags) return null
  const clock = clockFields(tags.DateTimeOriginal ?? tags.CreateDate ?? tags.DateTime, tags.SubSecTimeOriginal)
  const offset = offsetMinutes(tags.OffsetTimeOriginal ?? tags.OffsetTime)
  const local = clock ? `${clock.date}T${clock.time}.${pad(clock.ms, 3)}` : null
  const zoned =
    local !== null && offset !== null ? new Date((instantOf(local) as number) - offset * 60000).toISOString() : null
  const gps = gpsTimeUtc(tags.GPSDateStamp, tags.GPSTimeStamp)
  const behind = zoned && gps ? ((instantOf(zoned) as number) - (instantOf(gps) as number)) / 1000 : null
  // The zoned clock is the shutter's time; the GPS stamp is the fix's, which trails it by up to 23 s and would put
  // the frames of a burst out of order.
  if (zoned) return { iso: zoned, source: 'clock-offset', zoneKnown: true, gpsBehindSeconds: behind }
  if (gps) return { iso: gps, source: 'gps', zoneKnown: true, gpsBehindSeconds: null }
  if (local) return { iso: local, source: 'camera-clock', zoneKnown: false, gpsBehindSeconds: null }
  return null
}

export type FlightPhoto = {
  id: string
  takenAtUtc: string | null
  /** The flight it was given before, kept when its flight still holds most of the same photos. */
  flightId?: string | null
  /** Ties in time (one-second GPS stamps) fall back to the name, then the id. */
  name?: string
}

export type Flight<P extends FlightPhoto> = {
  id: string
  /** In time order; `frameIndex` is the position here. */
  photos: P[]
  start: string | null
  end: string | null
  /** False for a photo with no time, which stands alone. */
  timed: boolean
}

const flightIdFor = (iso: string) => `flight:${iso.replace(/\.\d+/, '').replace(/[^0-9TZ]/g, '')}`

/**
 * Photos grouped into flights: sorted by time, a gap over `FLIGHT_GAP_SECONDS` starts a new one. A flight keeps the
 * id most of its photos already carry, so adding or removing a photo does not rename it; otherwise its id comes from
 * its first photo's time, the same on every machine. Photos with no time each stand alone, last, by name.
 */
export function groupFlights<P extends FlightPhoto>(photos: readonly P[]): Flight<P>[] {
  const order = (a: P, b: P) => (a.name ?? '').localeCompare(b.name ?? '') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const timed = photos
    .map((photo) => ({ photo, t: instantOf(photo.takenAtUtc) }))
    .filter((row): row is { photo: P; t: number } => row.t !== null)
    .sort((a, b) => a.t - b.t || order(a.photo, b.photo))
  const groups: Array<Array<{ photo: P; t: number }>> = []
  for (const row of timed) {
    const last = groups[groups.length - 1]
    if (last && (row.t - last[last.length - 1].t) / 1000 <= FLIGHT_GAP_SECONDS) last.push(row)
    else groups.push([row])
  }
  const used = new Set<string>()
  const flights: Flight<P>[] = groups.map((group) => {
    const tally = new Map<string, number>()
    for (const { photo } of group) if (photo.flightId) tally.set(photo.flightId, (tally.get(photo.flightId) ?? 0) + 1)
    // The id held by most; on a tie, the one the earliest photo holds (Map keeps first-seen order).
    let kept: string | null = null
    for (const [id, n] of tally) if (!used.has(id) && (kept === null || n > (tally.get(kept) as number))) kept = id
    let id = kept ?? flightIdFor(new Date(group[0].t).toISOString())
    for (let k = 2; used.has(id); k++) id = `${flightIdFor(new Date(group[0].t).toISOString())}-${k}`
    used.add(id)
    return {
      id,
      photos: group.map((row) => row.photo),
      start: new Date(group[0].t).toISOString(),
      end: new Date(group[group.length - 1].t).toISOString(),
      timed: true,
    }
  })
  const untimed = photos.filter((photo) => instantOf(photo.takenAtUtc) === null).sort(order)
  for (const photo of untimed)
    flights.push({ id: `untimed:${photo.id}`, photos: [photo], start: null, end: null, timed: false })
  return flights
}

/** Metres across the ground between two places (haversine). */
export function metresBetween(a: { lng: number; lat: number }, b: { lng: number; lat: number }): number {
  const dLat = (b.lat - a.lat) * RAD,
    dLng = (b.lng - a.lng) * RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export type PlacedPhoto = {
  id: string
  takenAtUtc: string | null
  lng: number | null
  lat: number | null
}

export type BurstNeighbour<A extends PlacedPhoto> = {
  photo: A
  /** Signed: negative when the neighbour was taken before this photo. */
  gapSeconds: number
  distanceMeters: number
}

/**
 * The accepted photo nearest in time within `BURST_MAX_SECONDS` and `BURST_MAX_METERS`, whose camera can seed this
 * frame's search; null when none qualifies or either photo lacks a time or a place.
 */
export function burstNeighbour<A extends PlacedPhoto>(
  photo: PlacedPhoto,
  accepted: readonly A[],
): BurstNeighbour<A> | null {
  const t = instantOf(photo.takenAtUtc)
  if (t === null || photo.lng === null || photo.lat === null) return null
  const here = { lng: photo.lng, lat: photo.lat }
  let best: BurstNeighbour<A> | null = null
  for (const other of accepted) {
    if (other.id === photo.id || other.lng === null || other.lat === null) continue
    const u = instantOf(other.takenAtUtc)
    if (u === null) continue
    const gapSeconds = (u - t) / 1000
    if (Math.abs(gapSeconds) > BURST_MAX_SECONDS) continue
    const distanceMeters = metresBetween(here, { lng: other.lng, lat: other.lat })
    if (distanceMeters > BURST_MAX_METERS) continue
    if (!best || Math.abs(gapSeconds) < Math.abs(best.gapSeconds)) best = { photo: other, gapSeconds, distanceMeters }
  }
  return best
}

/**
 * Priors for a narrow search round a burst neighbour's accepted camera: heading ±15°, pitch ±10°, roll free. A prior
 * hides any runner-up outside it (`wideOrientation.ts`), so a narrow fit that is not trustworthy must be followed by
 * the full 360° search.
 */
export function neighbourPriors(pose: { bearing: number; pitch: number }): NonNullable<WideSearchInput['priors']> {
  return {
    heading: { value: wrapHeading(pose.bearing), tolerance: NEIGHBOUR_HEADING_TOLERANCE },
    pitch: { value: pose.pitch, tolerance: NEIGHBOUR_PITCH_TOLERANCE },
  }
}

export type LensCheck = {
  /** Degrees across and down the photo as shown; null when nothing in the tags gives a lens. */
  hfov: number | null
  vfov: number | null
  source: 'exif35' | 'focal+sensor' | 'unknown'
  /**
   * The decoded picture is not the shape the camera wrote: cropped after it was taken, so the tagged lens is only an
   * upper bound and the search fits the lens too.
   */
  cropped: boolean
  /** The decoded picture is the camera's shape at another size: resized, its lens as tagged. */
  resized?: boolean
  /** The 35 mm-equivalent focal length used, mm, when the tags give one. */
  focal35Mm: number | null
  /** The digital zoom the camera wrote (already in `focal35Mm`), when over 1. */
  digitalZoom: number | null
  note: string
}

/** The pixel size the camera wrote (exifr names `PixelXDimension` `ExifImageWidth`). */
function recordedSize(tags: Record<string, unknown>): { width: number; height: number } | null {
  const width = num(tags.ExifImageWidth) ?? num(tags.PixelXDimension)
  const height = num(tags.ExifImageHeight) ?? num(tags.PixelYDimension)
  return width && height && width > 0 && height > 0 ? { width, height } : null
}

const round = (value: number) => Math.round(value * 10) / 10

/**
 * The lens a photo was taken through, as it is shown: field of view from the 35 mm-equivalent focal length (which
 * already includes digital zoom), else from the real focal length and the sensor's size (divided by any digital
 * zoom, which the sensor's size does not know). A decoded size other than the recorded one, allowing a quarter turn,
 * means the photo was cropped or resized after it was taken: the tagged lens is then the uncropped frame's, an upper
 * bound, and the search needs a field-of-view range rather than a value.
 */
export function lensCheck({
  exif,
  decodedWidth,
  decodedHeight,
}: {
  exif: Tags
  decodedWidth: number
  decodedHeight: number
}): LensCheck {
  const tags = exif ?? {}
  const recorded = recordedSize(tags)
  // The recorded size as shown: turned a quarter when the decoded picture's shape is.
  const shown =
    recorded && recorded.width > recorded.height !== decodedWidth > decodedHeight
      ? { width: recorded.height, height: recorded.width }
      : recorded
  const otherSize = !!shown && (shown.width !== decodedWidth || shown.height !== decodedHeight)
  // The same shape at another size is a resize, which keeps the lens: only a change of shape is a crop the tags cannot
  // describe. (A crop that keeps the shape reads as a resize; the skyline search still checks the lens it is given.)
  const sameShape = !!shown && Math.abs(shown.width / shown.height - decodedWidth / decodedHeight) < 0.01
  const cropped = otherSize && !sameShape
  const resized = otherSize && sameShape
  // A cropped photo's lens is the frame the camera wrote; read it across that frame's shape.
  const frame = cropped && shown ? shown : { width: decodedWidth, height: decodedHeight }
  const fov = readExif(tags, frame).fov
  const focal35 = num(tags.FocalLengthIn35mmFormat) ?? num(tags.FocalLengthIn35mmFilm)
  const zoom = num(tags.DigitalZoomRatio)
  const digitalZoom = zoom && zoom > 1.001 ? zoom : null
  let hfov: number | null = null,
    vfov: number | null = null,
    source: LensCheck['source'] = 'unknown'
  if (fov?.from === '35mm') {
    ;[hfov, vfov, source] = [fov.horizontal, fov.vertical, 'exif35']
  } else if (fov?.from === 'focal-plane') {
    // The sensor's size spans the whole sensor; digital zoom uses its middle.
    const z = digitalZoom ?? 1
    const narrow = (degrees: number) => (2 * Math.atan(Math.tan((degrees * RAD) / 2) / z)) / RAD
    ;[hfov, vfov, source] = [narrow(fov.horizontal), narrow(fov.vertical), 'focal+sensor']
  }
  const parts: string[] = []
  if (source === 'exif35') parts.push(`${round(focal35 as number)} mm equivalent`)
  else if (source === 'focal+sensor') parts.push('from the focal length and sensor size')
  else parts.push('no lens in the photo’s tags')
  if (digitalZoom)
    parts.push(
      source === 'exif35'
        ? `digital zoom ×${round(digitalZoom)} already included`
        : `digital zoom ×${round(digitalZoom)} applied`,
    )
  if (cropped && shown)
    parts.push(
      `cropped: lens unknown (${decodedWidth}×${decodedHeight} against ${shown.width}×${shown.height} taken; at most the tagged lens)`,
    )
  else if (resized && shown)
    parts.push(`resized to ${decodedWidth}×${decodedHeight} from ${shown.width}×${shown.height}: the lens is as tagged`)
  return {
    hfov,
    vfov,
    source,
    cropped,
    resized,
    focal35Mm: source === 'exif35' ? focal35 : null,
    digitalZoom,
    note: parts.join('; '),
  }
}
