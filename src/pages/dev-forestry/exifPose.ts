/**
 * A starting camera pose for the reviewer's own field photo, read from its
 * EXIF tags, and the lens maths that turns a focal length into a field of view.
 *
 * Every value here is a suggestion. Phone GPS is often 5–20 m out, a recorded
 * heading may be magnetic, and a cropped or edited photo no longer has the
 * lens its tags describe, so the page shows where each number came from and
 * lets the reviewer change it while watching the photo over the road view.
 *
 * Headings: a `GPSImgDirectionRef` of `T` is true north and is used as is. `M`
 * (magnetic) is kept as the starting heading but marked magnetic, because
 * nothing here models declination; the reviewer adds the local declination
 * (east positive) to reach true north. A heading with no reference is treated
 * the same way as magnetic: it cannot be assumed true.
 *
 * Free of DOM and network access: exifr's output is passed in.
 */

import type { PhotoPose } from './photoPose'

const RAD = Math.PI / 180
/** A 35 mm frame's diagonal, which a "35 mm equivalent" focal length is defined against. */
export const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24)
/** Fields of view outside this, in degrees across the wider side, are not a plausible ordinary photo. */
const MIN_FOV = 3
const MAX_FOV = 150
/** Where no tag or road view gives a lens: about a phone's main camera across a landscape frame. */
export const DEFAULT_HORIZONTAL_FOV = 65

export type HeadingReference = 'true' | 'magnetic' | 'unknown'

/** Where a starting value came from, so the panel can say so beside it. */
export type PoseSource = 'exif' | 'record' | 'road-view' | 'level' | 'default' | 'reviewer' | 'skyline'

export type ExifReading = {
  position: { lng: number; lat: number } | null
  heading: { degrees: number; reference: HeadingReference } | null
  fov: { horizontal: number; vertical: number; from: '35mm' | 'focal-plane' } | null
  /** The camera clock's local time, `YYYY-MM-DD HH:MM`; it carries no time zone and may be wrong. */
  takenAt: string | null
  camera: string | null
  /** Recorded GPS altitude, metres; shown for reference only, never used to place the eye. */
  altitudeMeters: number | null
}

/** The pose the reviewer edits; position may be unknown until picked or typed. */
export type OwnPose = {
  lng: number | null
  lat: number | null
  /** Degrees clockwise from true north. */
  bearing: number
  /** Degrees above the horizon. */
  pitch: number
  /** Degrees; positive raises the photo's right side. */
  roll: number
  /** Degrees across the photo's width. */
  hfov: number
  eyeHeightMeters: number
}

export type OwnPoseSources = {
  position: PoseSource | null
  heading: PoseSource
  pitch: PoseSource
  roll: PoseSource
  fov: PoseSource
  eyeHeight: PoseSource
}

/** What a field record already holds about its camera (reviewer-checked EXIF, or typed). */
export type RecordCamera = {
  lng: number | null
  lat: number | null
  bearing: number | null
  pitch: number
  roll: number
  hfov: number | null
}

export type RoadViewPose = { lng: number; lat: number; bearing: number; hfov: number }

export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360
}

/** True-north heading from a magnetic one and the local declination (degrees, east positive). */
export function trueHeadingFromMagnetic(magnetic: number, declinationEast: number): number {
  return normalizeHeading(magnetic + declinationEast)
}

/** Vertical field of view of a pinhole frame from its horizontal one. */
export function verticalFovFromHorizontal(horizontal: number, width: number, height: number): number {
  return (2 * Math.atan(Math.tan((horizontal * RAD) / 2) * (height / width))) / RAD
}

export function horizontalFovFromVertical(vertical: number, width: number, height: number): number {
  return (2 * Math.atan(Math.tan((vertical * RAD) / 2) * (width / height))) / RAD
}

function plausible(fov: { horizontal: number; vertical: number }) {
  const wider = Math.max(fov.horizontal, fov.vertical)
  return Number.isFinite(wider) && wider >= MIN_FOV && wider <= MAX_FOV ? fov : null
}

/**
 * Field of view from a 35 mm equivalent focal length. The equivalent is defined
 * by the diagonal, so the frame's own aspect splits the 43.27 mm diagonal into
 * its equivalent width and height; orientation does not matter.
 */
export function fovFrom35mmEquivalent(
  focal35Mm: number,
  width: number,
  height: number,
): { horizontal: number; vertical: number } | null {
  if (!(focal35Mm > 0) || !(width > 0) || !(height > 0)) return null
  const diagonal = Math.hypot(width, height)
  const across = (FULL_FRAME_DIAGONAL_MM * width) / diagonal
  const down = (FULL_FRAME_DIAGONAL_MM * height) / diagonal
  return plausible({
    horizontal: (2 * Math.atan(across / 2 / focal35Mm)) / RAD,
    vertical: (2 * Math.atan(down / 2 / focal35Mm)) / RAD,
  })
}

/** Field of view from the real focal length and the sensor's size, both in millimetres. */
export function fovFromFocalLength(
  focalMm: number,
  sensorWidthMm: number,
  sensorHeightMm: number,
): { horizontal: number; vertical: number } | null {
  if (!(focalMm > 0) || !(sensorWidthMm > 0) || !(sensorHeightMm > 0)) return null
  return plausible({
    horizontal: (2 * Math.atan(sensorWidthMm / 2 / focalMm)) / RAD,
    vertical: (2 * Math.atan(sensorHeightMm / 2 / focalMm)) / RAD,
  })
}

const num = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  // A one-byte tag (GPSAltitudeRef) can arrive as a Uint8Array.
  if (value instanceof Uint8Array && value.length === 1) return value[0]
  // exifr keeps a few rationals as [numerator, denominator].
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number')
    return value[1] ? value[0] / value[1] : null
  return null
}

/** Millimetres per `FocalPlaneResolutionUnit`; 2 (inch) is EXIF's default. */
function unitMillimetres(unit: unknown): number | null {
  const value = num(unit)
  if (value === null || value === 2) return 25.4
  if (value === 3) return 10
  if (value === 4) return 1
  if (value === 5) return 0.001
  if (typeof unit === 'string') {
    const text = unit.toLowerCase()
    if (text.startsWith('inch')) return 25.4
    if (text.startsWith('cent')) return 10
    if (text.startsWith('milli')) return 1
  }
  return null
}

/**
 * The sensor's size in millimetres, in the sensor's own (unrotated) frame, from
 * the focal-plane resolution tags and the pixel dimensions the camera wrote.
 */
export function sensorSizeFromExif(tags: Record<string, unknown>): { widthMm: number; heightMm: number } | null {
  const xRes = num(tags.FocalPlaneXResolution)
  const yRes = num(tags.FocalPlaneYResolution) ?? xRes
  const width = num(tags.ExifImageWidth) ?? num(tags.PixelXDimension) ?? num(tags.ImageWidth)
  const height = num(tags.ExifImageHeight) ?? num(tags.PixelYDimension) ?? num(tags.ImageHeight)
  const mm = unitMillimetres(tags.FocalPlaneResolutionUnit)
  if (!xRes || !yRes || !width || !height || !mm) return null
  const widthMm = (width / xRes) * mm,
    heightMm = (height / yRes) * mm
  // Anything past a large-format back is a misread tag, not a sensor.
  return widthMm > 0.5 && widthMm < 100 && heightMm > 0.5 && heightMm < 100 ? { widthMm, heightMm } : null
}

/** Whether EXIF says the stored pixels are turned a quarter turn from how the photo is shown. */
function quarterTurned(orientation: unknown): boolean {
  const value = num(orientation)
  if (value !== null) return value >= 5 && value <= 8
  return typeof orientation === 'string' && /90|270/.test(orientation)
}

function dmsDegrees(value: unknown, ref: unknown): number | null {
  let degrees = num(value)
  if (degrees === null && Array.isArray(value)) {
    const [d, m = 0, s = 0] = value.map((part) => num(part) ?? Number.NaN)
    degrees = d + m / 60 + s / 3600
  }
  if (degrees === null || !Number.isFinite(degrees)) return null
  const negative = typeof ref === 'string' && /^[SW]/i.test(ref)
  return negative ? -Math.abs(degrees) : degrees
}

function position(tags: Record<string, unknown>): { lng: number; lat: number } | null {
  const lat = num(tags.latitude) ?? dmsDegrees(tags.GPSLatitude, tags.GPSLatitudeRef)
  const lng = num(tags.longitude) ?? dmsDegrees(tags.GPSLongitude, tags.GPSLongitudeRef)
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  // A GPS fix that never happened is written as 0, 0.
  if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return null
  return { lng, lat }
}

function headingReference(ref: unknown): HeadingReference {
  if (typeof ref !== 'string') return 'unknown'
  const text = ref.trim().toLowerCase()
  if (text === 't' || text.startsWith('true')) return 'true'
  if (text === 'm' || text.startsWith('magnetic')) return 'magnetic'
  return 'unknown'
}

const pad = (value: number) => String(value).padStart(2, '0')

function cameraClock(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime()))
    // exifr reads the zone-less tag as local time, so the local fields are the camera's clock.
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}`
  if (typeof value === 'string') {
    const match = /^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim())
    if (match && match[1] !== '0000') return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`
  }
  return null
}

function cameraName(tags: Record<string, unknown>): string | null {
  const make = typeof tags.Make === 'string' ? tags.Make.trim() : ''
  const model = typeof tags.Model === 'string' ? tags.Model.trim() : ''
  if (!make && !model) return null
  if (model.toLowerCase().startsWith(make.toLowerCase())) return model || make
  return [make, model].filter(Boolean).join(' ')
}

/**
 * What a photo's EXIF says about where it was taken and through what lens.
 * `width` and `height` are the photo as displayed (after its orientation tag).
 */
export function readExif(
  tags: Record<string, unknown> | null | undefined,
  { width, height }: { width: number; height: number },
): ExifReading {
  if (!tags) return { position: null, heading: null, fov: null, takenAt: null, camera: null, altitudeMeters: null }
  const direction = num(tags.GPSImgDirection)
  const focal35 = num(tags.FocalLengthIn35mmFormat) ?? num(tags.FocalLengthIn35mmFilm)
  let fov: ExifReading['fov'] = null
  const from35 = focal35 ? fovFrom35mmEquivalent(focal35, width, height) : null
  if (from35) fov = { ...from35, from: '35mm' }
  else {
    const focal = num(tags.FocalLength)
    const sensor = sensorSizeFromExif(tags)
    const real = focal && sensor ? fovFromFocalLength(focal, sensor.widthMm, sensor.heightMm) : null
    if (real) {
      // The sensor's width runs along the stored pixels' rows; a quarter-turned photo shows it upright.
      const shown = quarterTurned(tags.Orientation) ? { horizontal: real.vertical, vertical: real.horizontal } : real
      fov = { ...shown, from: 'focal-plane' }
    }
  }
  const altitude = num(tags.GPSAltitude)
  const below = num(tags.GPSAltitudeRef) === 1 || tags.GPSAltitudeRef === 'Below sea level'
  return {
    position: position(tags),
    heading:
      direction !== null && direction >= 0 && direction <= 360
        ? { degrees: normalizeHeading(direction), reference: headingReference(tags.GPSImgDirectionRef) }
        : null,
    fov,
    takenAt: cameraClock(tags.DateTimeOriginal ?? tags.CreateDate ?? tags.DateTime),
    camera: cameraName(tags),
    altitudeMeters: altitude === null ? null : below ? -Math.abs(altitude) : altitude,
  }
}

/**
 * The pose a lined-up photo starts from, and where each value came from: the
 * field record's camera (already a reviewer's), then EXIF, then the road view
 * as it stands, then plain defaults (level, eye height from the settings).
 */
export function startingPose({
  exif,
  record,
  roadView,
  eyeHeightMeters,
}: {
  exif: ExifReading | null
  record?: RecordCamera | null
  roadView: RoadViewPose | null
  eyeHeightMeters: number
}): { pose: OwnPose; sources: OwnPoseSources; headingReference: HeadingReference | null } {
  const recordPosition =
    record && record.lng !== null && record.lat !== null ? { lng: record.lng, lat: record.lat } : null
  const [where, positionSource]: [{ lng: number; lat: number } | null, PoseSource | null] = recordPosition
    ? [recordPosition, 'record']
    : exif?.position
      ? [exif.position, 'exif']
      : roadView
        ? [{ lng: roadView.lng, lat: roadView.lat }, 'road-view']
        : [null, null]
  // A record's bearing field is labelled true north and was confirmed there.
  const [bearing, headingSource, reference]: [number, PoseSource, HeadingReference | null] =
    record && record.bearing !== null
      ? [normalizeHeading(record.bearing), 'record', 'true']
      : exif?.heading
        ? [exif.heading.degrees, 'exif', exif.heading.reference]
        : roadView
          ? [normalizeHeading(roadView.bearing), 'road-view', null]
          : [0, 'default', null]
  const roadViewFov = roadView && roadView.hfov >= MIN_FOV && roadView.hfov <= MAX_FOV ? roadView.hfov : null
  const [hfov, fovSource]: [number, PoseSource] =
    record && record.hfov !== null && record.hfov >= MIN_FOV && record.hfov <= MAX_FOV
      ? [record.hfov, 'record']
      : exif?.fov
        ? [exif.fov.horizontal, 'exif']
        : roadViewFov !== null
          ? [roadViewFov, 'road-view']
          : [DEFAULT_HORIZONTAL_FOV, 'default']
  const pitch = record?.pitch ?? 0,
    roll = record?.roll ?? 0
  return {
    pose: {
      lng: where?.lng ?? null,
      lat: where?.lat ?? null,
      bearing,
      pitch,
      roll,
      hfov,
      eyeHeightMeters,
    },
    sources: {
      position: positionSource,
      heading: headingSource,
      pitch: pitch ? 'record' : 'level',
      roll: roll ? 'record' : 'level',
      fov: fovSource,
      eyeHeight: 'default',
    },
    headingReference: reference,
  }
}

/** The pinhole camera of a lined-up photo, standing `eyeHeightMeters` over `groundMeters`. */
export function ownPhotoPose(
  pose: OwnPose & { lng: number; lat: number },
  groundMeters: number,
  width: number,
  height: number,
): PhotoPose {
  return {
    lng: pose.lng,
    lat: pose.lat,
    altitudeMeters: groundMeters + pose.eyeHeightMeters,
    bearing: normalizeHeading(pose.bearing),
    pitch: pose.pitch,
    roll: pose.roll,
    width,
    height,
    focalPx: width / (2 * Math.tan((pose.hfov * RAD) / 2)),
    k1: 0,
    k2: 0,
  }
}

/** Eye east and north of a point on the road, metres, to stand the road view's walker there. */
export function offsetFrom(
  from: { lng: number; lat: number },
  to: { lng: number; lat: number },
): { east: number; north: number } {
  // The same flat-earth scale as `offsetPosition` in driveMath.ts, so the walker lands on `to`.
  return {
    east: (to.lng - from.lng) * 111320 * Math.cos(from.lat * RAD),
    north: (to.lat - from.lat) * 111320,
  }
}

/** A plausible field of view for the controls: kept inside what a lens can be. */
export function clampFov(degrees: number): number {
  return Math.max(MIN_FOV, Math.min(MAX_FOV, degrees))
}
