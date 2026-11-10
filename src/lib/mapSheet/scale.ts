/**
 * Scale maths for a north-up Web Mercator map frame: which ground the frame shows at a stated scale,
 * where a longitude/latitude falls on the paper, the scale bar's segments and the graticule ticks.
 *
 * Web Mercator stretches distance by 1 / cos(latitude), so a printed scale is exact only at one
 * latitude. The frame is set so the stated scale holds at its centre latitude; it is about 0.2 %
 * off at the top and bottom of a 1:50,000 tabloid frame in central BC. No DOM or network access.
 */
import type { Rect } from './layout'

export const POINTS_PER_INCH = 72
export const METRES_PER_INCH = 0.0254
/** Web Mercator equatorial radius (EPSG:3857), metres. */
const MERCATOR_R = 6378137
const RAD = Math.PI / 180
/** Scales the sheet dialog offers. */
export const SHEET_SCALES = [5000, 10000, 20000, 50000] as const
/** Scales "fit the block" may choose from, smallest first. */
export const FIT_SCALES = [
  1000, 2000, 2500, 5000, 7500, 10000, 12500, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000, 200000,
  250000,
] as const
/** Largest scale denominator a sheet prints. Beyond it the Mercator scale drifts across the frame. */
export const MAX_SHEET_SCALE = 250000
/** Fraction of the frame a fitted block may fill on its longer side. */
export const FIT_FILL = 0.8

export const metresPerPoint = (scale: number) => (scale * METRES_PER_INCH) / POINTS_PER_INCH

export function mercatorX(lng: number) {
  return MERCATOR_R * lng * RAD
}
export function mercatorY(lat: number) {
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat))
  return MERCATOR_R * Math.log(Math.tan(Math.PI / 4 + (clamped * RAD) / 2))
}
export function inverseMercator(x: number, y: number): [number, number] {
  return [x / MERCATOR_R / RAD, (2 * Math.atan(Math.exp(y / MERCATOR_R)) - Math.PI / 2) / RAD]
}

export interface FrameProjection {
  /** Scale denominator, true at `center`'s latitude. */
  scale: number
  center: [number, number]
  frame: Rect
  /** Mercator metres per paper point. */
  mercatorPerPoint: number
  /** West, south, east, north of the frame. */
  bounds: [number, number, number, number]
  /** The same box in Web Mercator metres: west, south, east, north. */
  mercatorBox: [number, number, number, number]
  /** Paper position of a longitude/latitude. */
  project: (lng: number, lat: number) => [number, number]
  /** Longitude/latitude under a paper position. */
  unproject: (x: number, y: number) => [number, number]
}

export function frameProjection(frame: Rect, center: [number, number], scale: number): FrameProjection {
  if (!(scale > 0) || !Number.isFinite(scale)) throw Error('The sheet scale must be a positive number.')
  if (!center.every(Number.isFinite) || Math.abs(center[1]) > 85) throw Error('The sheet centre is not on the map.')
  // Ground metres per point at the centre, spread by Mercator's 1 / cos(latitude).
  const mercatorPerPoint = metresPerPoint(scale) / Math.cos(center[1] * RAD)
  const cx = mercatorX(center[0]),
    cy = mercatorY(center[1])
  const left = cx - (frame.w / 2) * mercatorPerPoint,
    top = cy + (frame.h / 2) * mercatorPerPoint
  const project = (lng: number, lat: number): [number, number] => [
    frame.x + (mercatorX(lng) - left) / mercatorPerPoint,
    frame.y + (top - mercatorY(lat)) / mercatorPerPoint,
  ]
  const unproject = (x: number, y: number) =>
    inverseMercator(left + (x - frame.x) * mercatorPerPoint, top - (y - frame.y) * mercatorPerPoint)
  const [west, north] = unproject(frame.x, frame.y)
  const [east, south] = unproject(frame.x + frame.w, frame.y + frame.h)
  return {
    scale,
    center,
    frame,
    mercatorPerPoint,
    bounds: [west, south, east, north],
    mercatorBox: [left, top - frame.h * mercatorPerPoint, left + frame.w * mercatorPerPoint, top],
    project,
    unproject,
  }
}

/**
 * The smallest listed scale at which the box fits `FIT_FILL` of the frame, measured at the box's
 * centre latitude. A box too large for `MAX_SHEET_SCALE` gets that scale.
 */
export function fitScale(bounds: [number, number, number, number], frame: Rect): number {
  const centerLat = (bounds[1] + bounds[3]) / 2
  const widthM = (mercatorX(bounds[2]) - mercatorX(bounds[0])) * Math.cos(centerLat * RAD)
  const heightM = (mercatorY(bounds[3]) - mercatorY(bounds[1])) * Math.cos(centerLat * RAD)
  for (const scale of FIT_SCALES) {
    const perPoint = metresPerPoint(scale)
    if (widthM / perPoint <= frame.w * FIT_FILL && heightM / perPoint <= frame.h * FIT_FILL) return scale
  }
  return MAX_SHEET_SCALE
}

/** "1:10,000". */
export const formatScale = (scale: number) => `1:${Math.round(scale).toLocaleString('en-US')}`

export interface ScaleBar {
  /** Ground length of one segment, metres. */
  segmentM: number
  /** Width of one segment on paper, points. */
  segmentPt: number
  /** Segments right of zero. A single segment left of zero is split in two halves. */
  rightSegments: number
  /** Labels left to right: the left segment's length, its half, 0, then each right segment end. */
  labels: { value: number; offsetPt: number }[]
  /** Total bar width, points. */
  widthPt: number
}

const NICE = [1, 2, 2.5, 5]

/**
 * An alternating scale bar like the reference sheets: about 1 cm of paper per segment, rounded to a
 * 1, 2, 2.5 or 5 × 10ⁿ metre length, one subdivided segment left of zero and as many right of it as
 * fit `maxWidthPt` (two to six).
 */
export function scaleBar(scale: number, maxWidthPt: number): ScaleBar {
  const centimetreM = scale / 100
  const exponent = Math.floor(Math.log10(centimetreM))
  let segmentM = NICE[0] * 10 ** exponent
  for (const step of [...NICE.map((n) => n * 10 ** exponent), 10 ** (exponent + 1)])
    if (Math.abs(Math.log(step / centimetreM)) < Math.abs(Math.log(segmentM / centimetreM))) segmentM = step
  const segmentPt = segmentM / metresPerPoint(scale)
  const rightSegments = Math.max(2, Math.min(6, Math.floor(maxWidthPt / segmentPt) - 1))
  const labels = [
    { value: segmentM, offsetPt: 0 },
    { value: segmentM / 2, offsetPt: segmentPt / 2 },
    { value: 0, offsetPt: segmentPt },
    ...Array.from({ length: rightSegments }, (_, i) => ({ value: segmentM * (i + 1), offsetPt: segmentPt * (i + 2) })),
  ]
  return { segmentM, segmentPt, rightSegments, labels, widthPt: segmentPt * (rightSegments + 1) }
}

/** "121°32'30\"W", "54°4'0\"N": whole seconds, the hemisphere letter last. */
export function formatDms(value: number, axis: 'lng' | 'lat'): string {
  const hemisphere = axis === 'lng' ? (value < 0 ? 'W' : 'E') : value < 0 ? 'S' : 'N'
  let seconds = Math.round(Math.abs(value) * 3600)
  const degrees = Math.floor(seconds / 3600)
  seconds -= degrees * 3600
  const minutes = Math.floor(seconds / 60)
  seconds -= minutes * 60
  return `${degrees}°${minutes}'${seconds}"${hemisphere}`
}

/** Graticule intervals tried, arc-seconds. */
const GRATICULE_SECONDS = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

/**
 * Tick values across a span: the smallest listed interval that puts at most `maxTicks` inside it.
 * The reference sheets used 30" at 1:10,000.
 */
export function graticuleTicks(min: number, max: number, maxTicks = 6): { intervalSec: number; values: number[] } {
  for (const intervalSec of GRATICULE_SECONDS) {
    const step = intervalSec / 3600
    const first = Math.ceil(min / step - 1e-9)
    const last = Math.floor(max / step + 1e-9)
    if (last - first + 1 <= maxTicks) {
      const values: number[] = []
      for (let i = first; i <= last; i++) values.push(Math.round(i * step * 1e9) / 1e9)
      return { intervalSec, values }
    }
  }
  return { intervalSec: 3600, values: [] }
}

/**
 * MapLibre zoom whose CSS pixel covers the ground one CSS pixel (1/96 in) covers on paper at `scale`,
 * at latitude `lat`. MapLibre tiles are 512 px at zoom 0.
 */
export function zoomForScale(scale: number, lat: number): number {
  const metresPerCssPixel = (scale * METRES_PER_INCH) / 96
  return Math.log2((2 * Math.PI * MERCATOR_R * Math.cos(lat * RAD)) / (512 * metresPerCssPixel))
}
