/**
 * Two ways to see whether a camera is right without the skyline, both for one candidate camera at a time:
 *
 * - **The photo on the map** (`drapePhoto`): every ground cell in view is projected into the photo and coloured from
 *   it, with ground the camera could not see left clear. Laid over satellite imagery and cutblocks on the plan, a wrong
 *   heading puts the photographed roads, openings and lakes visibly in the wrong place. It needs no road view.
 * - **The map in the photo** (`renderModelView`): satellite imagery draped on the terrain and seen from the camera,
 *   with distance haze, to set beside or over the photo where the skyline is one smooth ridge.
 *
 * Provenance: rebuilt for the browser from PGMaps' photo-matching bench (`scripts/forestry/photo-matching/lib/geo.ts`,
 * `castRay` and `render`). The options follow functional specifications of Pic2Map (orthorectifying a photo for a
 * pose) and QCALVIEW (draping a raster into the photo) written under route A; their code was not opened here.
 *
 * Free of DOM and network access: terrain and imagery are passed in.
 */
import type { ElevationSource } from '@/lib/forestry/terrain/terrain'
import { cameraAxes, projectToPhoto, type PhotoPose } from './photoPose'
import { earthCurvatureDropMeters } from './visibility'

const RAD = Math.PI / 180
const METRES_PER_DEGREE_LAT = 110574
const metresPerDegreeLng = (lat: number) => 111320 * Math.cos(lat * RAD)

export type Rgba = { width: number; height: number; data: Uint8ClampedArray }
export type Bounds = [number, number, number, number]
/** Imagery colour at a spot, or null outside it. */
export type ImagerySampler = (lng: number, lat: number) => [number, number, number] | null

/** Unit view ray (east, north, up) through photo pixel (u, v). */
export function rayThrough(pose: PhotoPose, u: number, v: number): [number, number, number] {
  const { right, down, forward } = cameraAxes(pose)
  const nx = (u - pose.width / 2) / pose.focalPx,
    ny = (v - pose.height / 2) / pose.focalPx
  const d = [0, 1, 2].map((k) => forward[k] + nx * right[k] + ny * down[k])
  const length = Math.hypot(d[0], d[1], d[2])
  return [d[0] / length, d[1] / length, d[2] / length]
}

export type GroundHit = { lng: number; lat: number; distanceMeters: number; elevation: number }

/** The first ground the ray through pixel (u, v) meets, or null for sky or missing terrain. */
export function castRay(
  pose: PhotoPose,
  source: ElevationSource,
  u: number,
  v: number,
  maxMeters = 60000,
): GroundHit | null {
  const d = rayThrough(pose, u, v)
  const mx = metresPerDegreeLng(pose.lat)
  const at = (t: number) => {
    const east = d[0] * t,
      north = d[1] * t
    const ground = Math.hypot(east, north)
    return {
      lng: pose.lng + east / mx,
      lat: pose.lat + north / METRES_PER_DEGREE_LAT,
      z: pose.altitudeMeters + d[2] * t + earthCurvatureDropMeters(ground),
      ground,
    }
  }
  let previous = 0
  for (let t = 15; t < maxMeters; t = t * 1.004 + 2) {
    const p = at(t)
    const g = source.elevationAt(p.lng, p.lat)
    if (!Number.isFinite(g)) return null
    if (p.z <= g) {
      let low = previous,
        high = t
      for (let k = 0; k < 12; k++) {
        const mid = (low + high) / 2
        const q = at(mid)
        if (q.z <= source.elevationAt(q.lng, q.lat)) high = mid
        else low = mid
      }
      const q = at(high)
      return { lng: q.lng, lat: q.lat, distanceMeters: q.ground, elevation: source.elevationAt(q.lng, q.lat) }
    }
    previous = t
  }
  return null
}

const SKY: [number, number, number] = [170, 200, 235]
const NO_IMAGERY: [number, number, number] = [90, 90, 90]
const HAZE: [number, number, number] = [175, 190, 215]

/**
 * Imagery seen from the camera, `width` pixels across, at the camera's own aspect. `rows` renders a strip into `into`,
 * so a page can draw it a strip at a time without freezing.
 */
export function renderModelView(
  pose: PhotoPose,
  source: ElevationSource,
  imagery: ImagerySampler,
  width = 360,
  maxMeters = 60000,
  rows?: { from: number; to: number; into: Rgba },
): Rgba {
  const scale = width / pose.width
  const height = rows?.into.height ?? Math.round(pose.height * scale)
  const data = rows?.into.data ?? new Uint8ClampedArray(width * height * 4)
  for (let y = rows?.from ?? 0; y < Math.min(height, rows?.to ?? height); y++)
    for (let x = 0; x < width; x++) {
      const hit = castRay(pose, source, (x + 0.5) / scale, (y + 0.5) / scale, maxMeters)
      let colour = SKY
      if (hit) {
        const sample = imagery(hit.lng, hit.lat) ?? NO_IMAGERY
        const f = Math.min(0.6, hit.distanceMeters / maxMeters)
        colour = [0, 1, 2].map((k) => sample[k] * (1 - f) + HAZE[k] * f) as [number, number, number]
      }
      const i = (y * width + x) * 4
      data[i] = colour[0]
      data[i + 1] = colour[1]
      data[i + 2] = colour[2]
      data[i + 3] = 255
    }
  return { width, height, data }
}

export interface Drape extends Rgba {
  /** West, south, east, north of the raster, WGS84. */
  bounds: Bounds
  cellMeters: number
  /** Share of the cells in the frame that the camera sees. */
  seenShare: number
}

/**
 * The photo laid on the map for one camera: a north-up raster, each cell coloured from the photo pixel it projects to,
 * transparent where the cell is out of frame or hidden by nearer ground. `photo` may be smaller than the pose's frame.
 */
export function drapePhoto(
  pose: PhotoPose,
  source: ElevationSource,
  photo: Rgba,
  { maxMeters = 8000, maxCells = 250_000 }: { maxMeters?: number; maxCells?: number } = {},
): Drape | null {
  const mx = metresPerDegreeLng(pose.lat)
  // Footprint: where rays round the frame's edge reach the ground, or the range limit along their azimuth.
  const xs = [0],
    ys = [0]
  const edge = 24
  for (let i = 0; i <= edge; i++)
    for (const [u, v] of [
      [(i / edge) * pose.width, 0],
      [(i / edge) * pose.width, pose.height],
      [0, (i / edge) * pose.height],
      [pose.width, (i / edge) * pose.height],
    ]) {
      const hit = castRay(pose, source, u, v, maxMeters)
      if (hit) {
        xs.push((hit.lng - pose.lng) * mx)
        ys.push((hit.lat - pose.lat) * METRES_PER_DEGREE_LAT)
      } else {
        const d = rayThrough(pose, u, v)
        const h = Math.hypot(d[0], d[1]) || 1
        xs.push((d[0] / h) * maxMeters)
        ys.push((d[1] / h) * maxMeters)
      }
    }
  const clamp = (v: number) => Math.max(-maxMeters, Math.min(maxMeters, v))
  const west = clamp(Math.min(...xs)),
    east = clamp(Math.max(...xs)),
    south = clamp(Math.min(...ys)),
    north = clamp(Math.max(...ys))
  const area = (east - west) * (north - south)
  if (!(area > 0)) return null
  const cellMeters = Math.max(2, Math.sqrt(area / maxCells))
  const width = Math.max(1, Math.ceil((east - west) / cellMeters)),
    height = Math.max(1, Math.ceil((north - south) / cellMeters))
  // Project every cell; keep the nearest depth per photo pixel (a z-buffer at half the photo's resolution).
  const zw = Math.ceil(pose.width / 2),
    zh = Math.ceil(pose.height / 2)
  const zbuffer = new Float32Array(zw * zh).fill(Infinity)
  const cellPixel = new Float32Array(width * height * 3).fill(Number.NaN)
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const e = west + (col + 0.5) * cellMeters,
        n = north - (row + 0.5) * cellMeters
      const lng = pose.lng + e / mx,
        lat = pose.lat + n / METRES_PER_DEGREE_LAT
      const z = source.elevationAt(lng, lat)
      if (!Number.isFinite(z)) continue
      const q = projectToPhoto(pose, lng, lat, z)
      if (!q || q.x < 0 || q.y < 0 || q.x >= pose.width || q.y >= pose.height) continue
      const k = (row * width + col) * 3
      cellPixel[k] = q.x
      cellPixel[k + 1] = q.y
      cellPixel[k + 2] = q.depth
      const zi = Math.floor(q.y / 2) * zw + Math.floor(q.x / 2)
      if (q.depth < zbuffer[zi]) zbuffer[zi] = q.depth
    }
  const data = new Uint8ClampedArray(width * height * 4)
  const sx = photo.width / pose.width,
    sy = photo.height / pose.height
  let inFrame = 0,
    seen = 0
  for (let cell = 0; cell < width * height; cell++) {
    const k = cell * 3
    if (Number.isNaN(cellPixel[k])) continue
    inFrame++
    const x = cellPixel[k],
      y = cellPixel[k + 1],
      depth = cellPixel[k + 2]
    // Hidden when something nearer covers its photo pixel: tolerance grows with distance and the cell's own size.
    const nearest = zbuffer[Math.floor(y / 2) * zw + Math.floor(x / 2)]
    if (depth > nearest * 1.03 + 2 * cellMeters) continue
    seen++
    const px = Math.min(photo.width - 1, Math.floor(x * sx)),
      py = Math.min(photo.height - 1, Math.floor(y * sy))
    const i = (py * photo.width + px) * 4,
      o = cell * 4
    data[o] = photo.data[i]
    data[o + 1] = photo.data[i + 1]
    data[o + 2] = photo.data[i + 2]
    data[o + 3] = 255
  }
  return {
    width,
    height,
    data,
    bounds: [
      pose.lng + west / mx,
      pose.lat + south / METRES_PER_DEGREE_LAT,
      pose.lng + east / mx,
      pose.lat + north / METRES_PER_DEGREE_LAT,
    ],
    cellMeters,
    seenShare: inFrame ? seen / inFrame : 0,
  }
}

/** Esri/OSM slippy-map tile coordinates (fractional) of a spot. */
export function tileXY(lng: number, lat: number, zoom: number): [number, number] {
  const n = 2 ** zoom,
    s = Math.sin(lat * RAD)
  return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]
}

/** A sampler over a mosaic of 256-px tiles whose top-left tile is (minX, minY) at `zoom`. */
export function mosaicSampler(mosaic: Rgba, zoom: number, minX: number, minY: number): ImagerySampler {
  return (lng, lat) => {
    const [tx, ty] = tileXY(lng, lat, zoom)
    const px = Math.floor((tx - minX) * 256),
      py = Math.floor((ty - minY) * 256)
    if (px < 0 || py < 0 || px >= mosaic.width || py >= mosaic.height) return null
    const i = (py * mosaic.width + px) * 4
    return [mosaic.data[i], mosaic.data[i + 1], mosaic.data[i + 2]]
  }
}

/** Rows of a model view `width` across for this camera. */
export const modelViewHeight = (pose: Pick<PhotoPose, 'width' | 'height'>, width: number) =>
  Math.round(pose.height * (width / pose.width))

/**
 * How well a candidate's model view matches the photo, over the ground the model shows: the correlation of their
 * brightness and of their edge strength, both resampled to the model's size. On fourteen helicopter photos (November
 * 2026) the sum ranked the skyline's winner above its runner-up on all five checked. It is evidence beside the
 * skyline and the sun, not a verdict: imagery is taken from above, in another season, and edges include the ridge.
 */
export function modelAgreement(photo: Rgba, model: Rgba): { brightness: number; edges: number; score: number } {
  const W = model.width,
    H = model.height
  const lum = (d: Uint8ClampedArray, i: number) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]
  const P = new Float64Array(W * H),
    M = new Float64Array(W * H),
    ground = new Uint8Array(W * H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let sum = 0,
        count = 0
      const y0 = Math.floor((y * photo.height) / H),
        y1 = Math.max(y0 + 1, Math.floor(((y + 1) * photo.height) / H))
      const x0 = Math.floor((x * photo.width) / W),
        x1 = Math.max(x0 + 1, Math.floor(((x + 1) * photo.width) / W))
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++) {
          sum += lum(photo.data, (yy * photo.width + xx) * 4)
          count++
        }
      const k = y * W + x,
        i = k * 4
      P[k] = sum / count
      M[k] = lum(model.data, i)
      ground[k] = model.data[i] === SKY[0] && model.data[i + 1] === SKY[1] && model.data[i + 2] === SKY[2] ? 0 : 1
    }
  const a: number[] = [],
    b: number[] = [],
    ga: number[] = [],
    gb: number[] = []
  const grad = (A: Float64Array, x: number, y: number) =>
    Math.hypot(A[y * W + x + 1] - A[y * W + x - 1], A[(y + 1) * W + x] - A[(y - 1) * W + x])
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      if (!ground[y * W + x]) continue
      a.push(P[y * W + x])
      b.push(M[y * W + x])
      ga.push(grad(P, x, y))
      gb.push(grad(M, x, y))
    }
  const correlation = (u: number[], v: number[]) => {
    const n = u.length
    if (n < 30) return 0
    const mu = u.reduce((s, x) => s + x, 0) / n,
      mv = v.reduce((s, x) => s + x, 0) / n
    let uv = 0,
      uu = 0,
      vv = 0
    for (let i = 0; i < n; i++) {
      uv += (u[i] - mu) * (v[i] - mv)
      uu += (u[i] - mu) ** 2
      vv += (v[i] - mv) ** 2
    }
    return uu && vv ? uv / Math.sqrt(uu * vv) : 0
  }
  const brightness = correlation(a, b),
    edges = correlation(ga, gb)
  return { brightness, edges, score: brightness + edges }
}
