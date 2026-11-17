/**
 * Where every pixel of a photo meets the ground, for one camera: the foundation of what is drawn over an own photo.
 * With it a projected outline can be dotted where nearer ground hides it, a click on the photo reads the map, and
 * distance contours need no second pass.
 *
 * Each working pixel (about 525 across) stores the longitude, latitude, distance along its ray and elevation of the
 * first ground its ray meets, by the same rule as `castRay` (`photoViews.ts`): a straight ray from the camera against
 * terrain dropped by the earth's curve, NaN where it meets sky, runs past `maxMeters` or leaves the terrain.
 *
 * Why it is fast. Rays that share an azimuth lie in one vertical plane. In that plane a ray first meets the ground
 * where the terrain's elevation angle seen from the camera (curvature included) first reaches the ray's own, so a
 * higher ray can only meet ground at or beyond where a lower one did: walking outward once along that azimuth and
 * handing out hits in order of elevation gives every ray's first hit. That is "march each de-rolled column upward
 * from the hit below it", made exact. A de-rolled column holds one azimuth only for a level camera; pitch makes the
 * columns converge on the nadir, so pixels are grouped by azimuth (half a working pixel wide) rather than by column,
 * and each hit is then refined along the pixel's own ray. One walk per azimuth replaces one walk per pixel.
 *
 * Free of DOM and network access: terrain is passed in.
 */
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { cameraAxes, localOffset, type PhotoPose } from './photoPose'
import { earthCurvatureDropMeters } from './visibility'

const RAD = Math.PI / 180
const METRES_PER_DEGREE_LAT = 110574
const metresPerDegreeLng = (lat: number) => 111320 * Math.cos(lat * RAD)

/** The bench's working width: enough to place an outline within a few photo pixels, cheap enough to redo on a nudge. */
export const HIT_BUFFER_WIDTH = 525
/** The ray walk's first step and growth, as `castRay` walks. */
const FIRST_STEP_METERS = 15
/** In sight within 3% of the hit's distance, the tolerance `drapePhoto` uses. */
const DEPTH_TOLERANCE = 1.03
/** One cell of tolerance is the spacing to the next nearer hit, but never more than this share of the distance. */
const MAX_CELL_SHARE = 0.05

export type HitBuffer = {
  /** Working width in pixels. */
  width: number
  height: number
  /** The pose's own pixel size; x, y given to the helpers are in photo pixels. */
  photoWidth: number
  photoHeight: number
  /** `photoPoseKey(pose)` of the camera it was cast for. */
  poseKey: string
  /** Per working pixel, row-major; NaN where the ray meets sky or leaves the terrain. */
  lng: Float64Array
  lat: Float64Array
  /** Metres along the ray from the camera to the hit (straight-line, not over the ground). */
  distance: Float32Array
  /** Metres above sea level of the hit. */
  elevation: Float32Array
}

/** A key that changes whenever anything that moves a ray changes. */
export function photoPoseKey(pose: PhotoPose): string {
  return [
    pose.lng.toFixed(7),
    pose.lat.toFixed(7),
    pose.altitudeMeters.toFixed(2),
    pose.bearing.toFixed(3),
    pose.pitch.toFixed(3),
    pose.roll.toFixed(3),
    `${pose.width}x${pose.height}`,
    pose.focalPx.toFixed(3),
    pose.k1,
    pose.k2,
  ].join(',')
}

/** Straight-line metres from the camera to a point: the measure `inSight` compares with a hit's distance. */
export function cameraDistance(
  pose: Pick<PhotoPose, 'lng' | 'lat' | 'altitudeMeters'>,
  lng: number,
  lat: number,
  altitude: number,
): number {
  const [east, north, up] = localOffset(pose, lng, lat, altitude)
  return Math.hypot(east, north, up)
}

/** Casts every working pixel's ray. `width` is the working width; `maxMeters` the furthest ground looked for. */
export function buildHitBuffer(
  pose: PhotoPose,
  source: ElevationSource,
  { width = HIT_BUFFER_WIDTH, maxMeters = 60000 }: { width?: number; maxMeters?: number } = {},
): HitBuffer {
  const W = Math.max(1, Math.round(width))
  const scale = W / pose.width
  const H = Math.max(1, Math.round(pose.height * scale))
  const n = W * H
  const lng = new Float64Array(n).fill(Number.NaN),
    lat = new Float64Array(n).fill(Number.NaN),
    distance = new Float32Array(n).fill(Number.NaN),
    elevation = new Float32Array(n).fill(Number.NaN)
  const buffer: HitBuffer = {
    width: W,
    height: H,
    photoWidth: pose.width,
    photoHeight: pose.height,
    poseKey: photoPoseKey(pose),
    lng,
    lat,
    distance,
    elevation,
  }

  // Each pixel's ray as horizontal direction (unit east, north) and rise per horizontal metre, the same pinhole ray
  // `rayThrough` gives.
  const { right, down, forward } = cameraAxes(pose)
  const east = new Float64Array(n),
    north = new Float64Array(n),
    rise = new Float64Array(n),
    /** Along-ray metres per horizontal metre. */
    stretch = new Float64Array(n),
    azimuth = new Float64Array(n)
  const bearing = pose.bearing * RAD
  const mx = metresPerDegreeLng(pose.lat)
  const steep: number[] = []
  for (let y = 0; y < H; y++) {
    const ny = ((y + 0.5) / scale - pose.height / 2) / pose.focalPx
    for (let x = 0; x < W; x++) {
      const nx = ((x + 0.5) / scale - pose.width / 2) / pose.focalPx
      const de = forward[0] + nx * right[0] + ny * down[0],
        dn = forward[1] + nx * right[1] + ny * down[1],
        du = forward[2] + nx * right[2] + ny * down[2]
      const i = y * W + x
      const level = Math.hypot(de, dn)
      if (level < 1e-9 * Math.hypot(de, dn, du)) {
        steep.push(i)
        continue
      }
      east[i] = de / level
      north[i] = dn / level
      rise[i] = du / level
      stretch[i] = Math.hypot(de, dn, du) / level
      // Relative to the camera's bearing, so the frame's pixels sit together in the bins round zero.
      let a = Math.atan2(de, dn) - bearing
      a -= 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI))
      azimuth[i] = a
    }
  }

  const altitude = pose.altitudeMeters
  /** Is pixel i's own ray at or under the ground `s` horizontal metres out? Records the spot in `spot`. */
  const spot = { lng: 0, lat: 0 }
  const under = (i: number, s: number) => {
    spot.lng = pose.lng + (east[i] * s) / mx
    spot.lat = pose.lat + (north[i] * s) / METRES_PER_DEGREE_LAT
    return altitude + rise[i] * s + earthCurvatureDropMeters(s) <= source.elevationAt(spot.lng, spot.lat)
  }
  /** Narrows pixel i's hit inside (low, high] along its own ray and stores it. */
  const settle = (i: number, low: number, high: number) => {
    for (let k = 0; k < 16 && high - low > 0.5; k++) {
      const mid = (low + high) / 2
      if (under(i, mid)) high = mid
      else low = mid
    }
    under(i, high)
    const ground = source.elevationAt(spot.lng, spot.lat)
    if (!Number.isFinite(ground)) return
    lng[i] = spot.lng
    lat[i] = spot.lat
    distance[i] = high * stretch[i]
    elevation[i] = ground
  }

  // Group pixels by azimuth: half a working pixel at the frame's centre wide, so a bin's walk strays from any of its
  // rays by a quarter of a pixel at most, and each hit is then refined on the pixel's own ray.
  const binWidth = 0.5 / (pose.focalPx * scale)
  const bins = Math.max(1, Math.ceil((2 * Math.PI) / binWidth))
  const start = new Int32Array(bins + 1)
  const binOf = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    if (stretch[i] === 0) continue
    const b = Math.min(bins - 1, Math.floor((azimuth[i] + Math.PI) / binWidth))
    binOf[i] = b
    start[b + 1]++
  }
  for (let b = 0; b < bins; b++) start[b + 1] += start[b]
  const order = new Int32Array(start[bins])
  const fill = start.slice(0, bins)
  for (let i = 0; i < n; i++) if (binOf[i] >= 0) order[fill[binOf[i]]++] = i

  for (let b = 0; b < bins; b++) {
    const from = start[b],
      to = start[b + 1]
    if (from === to) continue
    const members = order.subarray(from, to)
    // Lowest ray first: it meets ground first.
    members.sort((p, q) => rise[p] - rise[q])
    const a = bearing + (b + 0.5) * binWidth - Math.PI
    const be = Math.sin(a),
      bn = Math.cos(a)
    let next = 0,
      previous = 0
    for (let s = FIRST_STEP_METERS; s < maxMeters && next < members.length; s = s * 1.004 + 2) {
      const ground = source.elevationAt(pose.lng + (be * s) / mx, pose.lat + (bn * s) / METRES_PER_DEGREE_LAT)
      // Missing terrain ends the walk: every ray still out is unknown, as `castRay` leaves it.
      if (!Number.isFinite(ground)) break
      const terrainRise = (ground - altitude - earthCurvatureDropMeters(s)) / s
      while (next < members.length && rise[members[next]] <= terrainRise) settle(members[next++], previous, s)
      previous = s
    }
  }

  // A ray straight down meets the ground under the camera.
  for (const i of steep) {
    const ground = source.elevationAt(pose.lng, pose.lat)
    if (!(ground < altitude)) continue
    lng[i] = pose.lng
    lat[i] = pose.lat
    distance[i] = altitude - ground
    elevation[i] = ground
  }
  return buffer
}

/** The working pixel under photo pixel (x, y), or -1 outside the frame. */
function cellAt(buf: HitBuffer, x: number, y: number): number {
  if (!(x >= 0 && y >= 0 && x < buf.photoWidth && y < buf.photoHeight)) return -1
  const col = Math.min(buf.width - 1, Math.floor((x * buf.width) / buf.photoWidth)),
    row = Math.min(buf.height - 1, Math.floor((y * buf.height) / buf.photoHeight))
  return row * buf.width + col
}

/** The ground under photo pixel (x, y), or null for sky, missing terrain or outside the frame. */
export function hitAt(
  buf: HitBuffer,
  x: number,
  y: number,
): { lng: number; lat: number; distanceMeters: number; elevation: number } | null {
  const i = cellAt(buf, x, y)
  if (i < 0 || Number.isNaN(buf.lng[i])) return null
  return { lng: buf.lng[i], lat: buf.lat[i], distanceMeters: buf.distance[i], elevation: buf.elevation[i] }
}

/**
 * Whether a point that projects to photo pixel (x, y) at `depthMeters` from the camera (straight-line, as
 * `cameraDistance` measures it; `projectToPhoto`'s depth is along the optical axis and reads short off-centre) is in
 * sight: no further than its pixel's hit × 1.03 plus one cell. A cell is the spacing between this pixel's hit and the
 * nearer one in the row below, which is how much ground one working pixel spans there, capped at 5% of the distance
 * so the step over a ridge never counts as one cell. Outside the frame is never in sight; a pixel with no ground
 * (sky, or terrain that ran out) hides nothing.
 */
export function inSight(buf: HitBuffer, x: number, y: number, depthMeters: number): boolean {
  const i = cellAt(buf, x, y)
  if (i < 0) return false
  const hit = buf.distance[i]
  if (Number.isNaN(hit)) return true
  const below = i + buf.width < buf.distance.length ? buf.distance[i + buf.width] : Number.NaN
  const cell = Math.min(MAX_CELL_SHARE * hit, Number.isNaN(below) ? MAX_CELL_SHARE * hit : Math.abs(hit - below))
  return depthMeters <= hit * DEPTH_TOLERANCE + cell
}
