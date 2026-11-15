/**
 * A photo's case file, its working frame, what its metadata says, the sun, and the photo's skyline.
 *
 * A case file is local JSON kept outside the repository (it holds where the photo was taken). Pixel coordinates in
 * it are in the *working frame*: the upright photo scaled to WORK_WIDTH pixels wide.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import exifr from 'exifr'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { fovFrom35mmEquivalent } from '../../../../src/pages/dev-forestry/exifPose'
import { photoSkyline } from '../../../../src/pages/dev-forestry/skylineFit'

export const WORK_WIDTH = 1050
const RAD = Math.PI / 180

export type Px = [number, number]
export type Observation = {
  lng: number
  lat: number
  gpsAltitude: number | null
  compass: number | null
  compassRef: string | null
  focal35: number | null
  digitalZoom: number | null
  hfov: number
  vfov: number
  width: number
  height: number
  /** Camera clock as written (no zone) and its stated offset. */
  takenLocal: string | null
  offset: string | null
  /** GPS fix time, UTC ISO. */
  gpsTimeUtc: string | null
  /** Seconds the GPS fix is older than the shutter, when both are known. */
  fixAgeSeconds: number | null
  speedKmh: number | null
  horizontalErrorM: number | null
  /** Apple maker-note acceleration (g), its magnitude, and pitch/roll read from it as "up". */
  accel: { x: number; y: number; z: number; g: number; pitch: number; roll: number } | null
}
export type PoseRecord = { lng: number; lat: number; alt: number; bearing: number; pitch: number; roll: number; hfov: number; source: string }
export type CaseFile = {
  photo: string
  /** The original file, when `photo` is a converted copy (a HEIC turned into PNG): metadata and rotation come from it. */
  metadata?: string
  out?: string
  observation?: Observation
  /** 'air' places the eye at GPS altitude; 'ground' at terrain + eyeHeight. */
  platform?: 'air' | 'ground'
  eyeHeight?: number
  skyline?: { mode: 'auto' } | { mode: 'luma'; from: number } | { mode: 'trace'; points: Px[] }
  /** Where the sun, or a sun-lit cloud edge, appears in the photo. */
  sunPixel?: Px
  orientation?: { roll?: [number, number]; pitch?: [number, number]; span?: number }
  pose?: PoseRecord
  masks?: { fromY: number; default: string; polygons: Array<{ class: string; points: Px[] }> }
  controls?: {
    points?: Array<{ name: string; pixel: Px; lngLat?: [number, number]; peakNear?: boolean }>
    lines?: Array<{ name: string; layer: 'streams' | 'ftenRoads' | 'draRoads' | 'lakes' | 'wetlands' | 'cutblocks'; pixels: Px[] }>
  }
  traces?: Array<{ name: string; pixels: Px[] }>
  views?: Array<{ name: string; lng?: number; lat?: number; agl?: number; dAlt?: number; bearing?: number | 'toward'; pitch?: number | 'toward'; hfov: number }>
  results?: Record<string, unknown>
}

export function readCase(path: string): CaseFile & { path: string; dir: string } {
  const c = JSON.parse(readFileSync(path, 'utf8')) as CaseFile
  const dir = dirname(resolve(path))
  return { ...c, photo: resolve(dir, c.photo), ...(c.metadata ? { metadata: resolve(dir, c.metadata) } : {}), out: resolve(dir, c.out ?? '.'), path: resolve(path), dir }
}

export function writeCase(c: CaseFile & { path: string; dir: string }) {
  const rest: Record<string, unknown> = { ...c, photo: relative(c.dir, c.photo), ...(c.metadata ? { metadata: relative(c.dir, c.metadata) } : {}), out: relative(c.dir, c.out ?? c.dir) || '.' }
  delete rest.path
  delete rest.dir
  writeFileSync(c.path, JSON.stringify(rest, null, 2) + '\n')
}

/**
 * The upright photo at WORK_WIDTH, as a canvas and RGBA pixels. The decoder already applies a JPEG's own EXIF
 * rotation; a converted copy (`metadata` set: a HEIC turned into PNG by sips, which neither rotates nor keeps the tag)
 * is turned here by the original's rotation (3, 6 or 8).
 */
export async function workFrame(photo: string, metadata?: string) {
  const img = await loadImage(readFileSync(photo))
  const turn = metadata && metadata !== photo ? Number((await exifr.orientation(metadata).catch(() => 1)) ?? 1) : 1
  const quarter = turn === 6 || turn === 8
  const upW = quarter ? img.height : img.width, upH = quarter ? img.width : img.height
  const width = WORK_WIDTH, height = Math.round((upH / upW) * WORK_WIDTH)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.translate(width / 2, height / 2)
  ctx.rotate(turn === 6 ? Math.PI / 2 : turn === 8 ? -Math.PI / 2 : turn === 3 ? Math.PI : 0)
  const [dw, dh] = quarter ? [height, width] : [width, height]
  ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  const data = ctx.getImageData(0, 0, width, height).data
  return { canvas, width, height, data }
}

/** Apple maker note tag 0x0008: acceleration vector in g ("Apple iOS" header, big-endian IFD at offset 14). */
function appleAcceleration(note: Uint8Array | undefined) {
  if (!note || note.length < 16) return null
  const b = Buffer.from(note.buffer, note.byteOffset, note.byteLength)
  if (b.toString('latin1', 0, 9) !== 'Apple iOS') return null
  const be = b.toString('latin1', 12, 14) === 'MM'
  const u16 = (o: number) => (be ? b.readUInt16BE(o) : b.readUInt16LE(o)), u32 = (o: number) => (be ? b.readUInt32BE(o) : b.readUInt32LE(o)), s32 = (o: number) => (be ? b.readInt32BE(o) : b.readInt32LE(o))
  for (let i = 0, n = u16(14); i < n; i++) {
    const e = 16 + i * 12
    if (u16(e) !== 8 || u16(e + 2) !== 10) continue
    const off = u32(e + 8)
    const [x, y, z] = [0, 1, 2].map((k) => s32(off + k * 8) / s32(off + k * 8 + 4))
    const g = Math.hypot(x, y, z)
    // exiftool: +X toward the left side, +Y toward the bottom, +Z into the face, read here as the "up" direction.
    // The back camera looks along +Z, so pitch = asin(z/g); the image's right is −X, so the right side's rise is −x/g.
    return { x, y, z, g, pitch: Math.asin(z / g) / RAD, roll: Math.asin(-x / g) / RAD }
  }
  return null
}

export async function readObservation(photo: string, metadata = photo): Promise<Observation> {
  const t = await exifr.parse(metadata, { gps: true, exif: true, tiff: true, makerNote: true, translateValues: false, reviveValues: false })
  const frame = await workFrame(photo, metadata)
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const f35 = n(t?.FocalLengthIn35mmFormat ?? t?.FocalLenIn35mmFilm)
  const fov = (f35 && fovFrom35mmEquivalent(f35, frame.width, frame.height)) || { horizontal: 65, vertical: 65 * (frame.height / frame.width) }
  // GPS time is UTC; the camera clock is local with OffsetTimeOriginal.
  const gpsDate = typeof t?.GPSDateStamp === 'string' ? t.GPSDateStamp.replace(/:/g, '-') : null
  const gt = Array.isArray(t?.GPSTimeStamp) ? t.GPSTimeStamp : typeof t?.GPSTimeStamp === 'string' ? t.GPSTimeStamp.split(':').map(Number) : null
  const gpsTimeUtc = gpsDate && gt ? new Date(`${gpsDate}T${gt.map((v: number, i: number) => (i < 2 ? String(Math.floor(v)).padStart(2, '0') : String(Math.floor(v)).padStart(2, '0'))).join(':')}Z`).toISOString() : null
  const local = typeof t?.DateTimeOriginal === 'string' ? t.DateTimeOriginal : null
  const offset = typeof t?.OffsetTimeOriginal === 'string' ? t.OffsetTimeOriginal : null
  let fixAge: number | null = null
  if (local && offset && gpsTimeUtc) {
    const shutter = new Date(local.replace(/^(\d+):(\d+):(\d+) /, '$1-$2-$3T') + offset)
    const sub = Number(`0.${t?.SubSecTimeOriginal ?? 0}`)
    fixAge = Math.round(((shutter.getTime() + sub * 1000 - new Date(gpsTimeUtc).getTime()) / 1000) * 10) / 10
  }
  const lat = (t?.GPSLatitudeRef === 'S' ? -1 : 1) * dms(t?.GPSLatitude)
  const lng = (t?.GPSLongitudeRef === 'W' ? -1 : 1) * dms(t?.GPSLongitude)
  const altRef = t?.GPSAltitudeRef instanceof Uint8Array ? t.GPSAltitudeRef[0] : n(t?.GPSAltitudeRef)
  const alt = n(t?.GPSAltitude)
  const speed = n(t?.GPSSpeed)
  return {
    lng, lat,
    gpsAltitude: alt === null ? null : altRef === 1 ? -alt : alt,
    compass: n(t?.GPSImgDirection),
    compassRef: typeof t?.GPSImgDirectionRef === 'string' ? t.GPSImgDirectionRef : null,
    focal35: f35,
    digitalZoom: n(t?.DigitalZoomRatio),
    hfov: fov.horizontal, vfov: fov.vertical,
    width: frame.width, height: frame.height,
    takenLocal: local, offset, gpsTimeUtc, fixAgeSeconds: fixAge,
    speedKmh: speed === null ? null : t?.GPSSpeedRef === 'M' ? speed * 1.609 : t?.GPSSpeedRef === 'N' ? speed * 1.852 : speed,
    horizontalErrorM: n(t?.GPSHPositioningError),
    accel: appleAcceleration(t?.makerNote ?? t?.MakerNote),
  }
}

function dms(v: unknown): number {
  if (typeof v === 'number') return v
  if (Array.isArray(v) && v.length === 3) return v[0] + v[1] / 60 + v[2] / 3600
  return Number.NaN
}

/** Sun azimuth (° from true north) and elevation (°) at a UTC instant; NOAA's low-precision formulae. */
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
  return { azimuth: ((az / RAD) % 360 + 360) % 360, elevation: el / RAD }
}

/** The photo's skyline in the working frame, by the case's chosen reader. */
export function readSkyline(c: CaseFile, frame: { width: number; height: number; data: Uint8ClampedArray }, columns = 200): Array<{ x: number; y: number } | null> {
  const s = c.skyline ?? { mode: 'auto' }
  if (s.mode === 'trace') return s.points.map(([x, y]) => ({ x, y }))
  if (s.mode === 'auto') return photoSkyline(frame, columns)
  // Brightness drop: from a row known to be sky, the first run of 6 px below 70% of the sky just above.
  const { width, height, data } = frame
  const from = Math.round(s.from * height)
  const luma = (x: number, y: number) => {
    const i = (y * width + x) * 4
    return 0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]
  }
  return Array.from({ length: columns }, (_, col) => {
    const x = Math.min(width - 1, Math.floor(((col + 0.5) / columns) * width))
    let ref = luma(x, from)
    for (let y = from + 1; y < height * 0.85; y++) {
      let dark = true
      for (let k = 0; k < 6; k++) if (luma(x, y + k) > 0.7 * ref) {
        dark = false
        break
      }
      if (dark) return { x: x + 0.5, y }
      ref = 0.9 * ref + 0.1 * luma(x, y)
    }
    return null
  })
}

export const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d))
