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
  return castGroundRay(pose, source, rayThrough(pose, u, v), maxMeters)
}

/** The first terrain hit along an east/north/up unit ray from any calibrated image projection. */
export function castGroundRay(
  pose: Pick<PhotoPose, 'lng' | 'lat' | 'altitudeMeters'>,
  source: ElevationSource,
  d: readonly number[],
  maxMeters = 60000,
): GroundHit | null {
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
      const sample = hit ? imagery(hit.lng, hit.lat) : SKY
      const i = (y * width + x) * 4
      if (!sample) {
        data.fill(0, i, i + 4)
        continue
      }
      const haze = hit ? Math.min(0.6, hit.distanceMeters / maxMeters) : 0
      data[i] = sample[0] * (1 - haze) + HAZE[0] * haze
      data[i + 1] = sample[1] * (1 - haze) + HAZE[1] * haze
      data[i + 2] = sample[2] * (1 - haze) + HAZE[2] * haze
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
  /**
   * One byte a cell: 1 where the cell is in the frame but nearer ground hides it, so the plan can hatch it apart from
   * ground out of frame. Both are transparent in `data`. Terrain only, not the run's visibility.
   */
  hiddenMask: Uint8Array
  /**
   * The frame on the ground as [lng, lat], in order round the frame (top edge left to right, then down the right, back
   * along the bottom and up the left), not closed: where each edge ray meets the ground, or the range along its
   * azimuth where it meets none.
   */
  footprint: Array<[number, number]>
  /** How far out the drape reaches, metres over the ground: the frame's furthest edge hit, or the cap. */
  rangeMeters: number
}

/** The furthest a drape reaches: the zoom-11 terrain the photo tools load stops at 25 km. */
export const DRAPE_MAX_METERS = 25000
/** Edge rays per side of the frame, for the footprint and the drape's extent. */
const FOOTPRINT_EDGE_RAYS = 24
/** The share of the photo's pixels an edge drape takes as edges, its strongest; thickening by a pixel about triples it. */
const EDGE_SHARE = 0.06

export type DrapeOptions = {
  /** The range cap, metres over the ground; default `DRAPE_MAX_METERS`. The range itself comes from the frame. */
  maxMeters?: number
  /** The most cells the raster holds; cells grow to fit the range. */
  maxCells?: number
  /**
   * Drape the photo's edges in one colour instead of its pixels, so imagery under it stays readable. The colour comes
   * from the caller's symbol; `share` is the share of the photo's pixels drawn as edges (its strongest).
   */
  edges?: { rgb: readonly [number, number, number]; share?: number } | null
}

/**
 * Where the photo's strong edges are: Sobel on luminance, at the photo's own pixels, thickened by a pixel so a cell
 * coarser than a pixel still finds them. 1 where an edge is, among the strongest `share` of the photo's pixels.
 */
export function photoEdges(photo: Rgba, share = EDGE_SHARE): Uint8Array {
  const { width: W, height: H, data } = photo
  const strong = new Uint8Array(W * H)
  if (W < 3 || H < 3) return strong
  const L = new Float32Array(W * H)
  for (let k = 0; k < W * H; k++) L[k] = 0.3 * data[k * 4] + 0.59 * data[k * 4 + 1] + 0.11 * data[k * 4 + 2]
  const magnitude = new Float32Array(W * H)
  // A histogram finds the cut without sorting a million values; |gx| + |gy| on 8-bit luminance stays under 2,040.
  const BINS = 2048
  const histogram = new Uint32Array(BINS)
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x
      const gx = L[k - W + 1] + 2 * L[k + 1] + L[k + W + 1] - L[k - W - 1] - 2 * L[k - 1] - L[k + W - 1]
      const gy = L[k + W - 1] + 2 * L[k + W] + L[k + W + 1] - L[k - W - 1] - 2 * L[k - W] - L[k - W + 1]
      const m = Math.abs(gx) + Math.abs(gy)
      magnitude[k] = m
      histogram[Math.min(BINS - 1, Math.floor(m))]++
    }
  const keep = Math.max(1, Math.round((W - 2) * (H - 2) * share))
  let cut = BINS - 1
  for (let seen = 0; cut > 0; cut--) {
    seen += histogram[cut]
    if (seen >= keep) break
  }
  const threshold = Math.max(1, cut)
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x
      if (magnitude[k] < threshold) continue
      strong[k] = strong[k - 1] = strong[k + 1] = strong[k - W] = strong[k + W] = 1
    }
  return strong
}

/**
 * The photo laid on the map for one camera: a north-up raster, each cell coloured from the photo pixel it projects to,
 * transparent where the cell is out of frame or hidden by nearer ground (`hiddenMask` tells the two apart). `photo` may
 * be smaller than the pose's frame.
 *
 * Its range comes from the frame: as far as the furthest ray round the frame's edge meets the ground, capped at
 * `maxMeters` when any edge ray meets none (sky, or ground past the cap). From 1,200 m at −6° the frame's centre lands
 * about 11 km out, so a fixed 8 km left its upper half bare.
 */
export function drapePhoto(
  pose: PhotoPose,
  source: ElevationSource,
  photo: Rgba,
  { maxMeters = DRAPE_MAX_METERS, maxCells = 250_000, edges = null }: DrapeOptions = {},
): Drape | null {
  const mx = metresPerDegreeLng(pose.lat)
  // Footprint: where rays round the frame's edge reach the ground, in order round the frame.
  const ring: Array<[number, number]> = []
  for (let side = 0; side < 4; side++)
    for (let i = 0; i < FOOTPRINT_EDGE_RAYS; i++) {
      const f = i / FOOTPRINT_EDGE_RAYS
      ring.push(
        side === 0
          ? [f * pose.width, 0]
          : side === 1
            ? [pose.width, f * pose.height]
            : side === 2
              ? [(1 - f) * pose.width, pose.height]
              : [0, (1 - f) * pose.height],
      )
    }
  const reached = ring.map(([u, v]) => {
    const hit = castRay(pose, source, u, v, maxMeters)
    return hit
      ? { east: (hit.lng - pose.lng) * mx, north: (hit.lat - pose.lat) * METRES_PER_DEGREE_LAT, ground: true }
      : (() => {
          const d = rayThrough(pose, u, v)
          const h = Math.hypot(d[0], d[1]) || 1
          return { east: d[0] / h, north: d[1] / h, ground: false }
        })()
  })
  const rangeMeters = reached.every((point) => point.ground)
    ? Math.min(maxMeters, Math.max(...reached.map((point) => Math.hypot(point.east, point.north))))
    : maxMeters
  // A ray that met no ground stands at the range along its azimuth.
  const xs = reached.map((point) => (point.ground ? point.east : point.east * rangeMeters)),
    ys = reached.map((point) => (point.ground ? point.north : point.north * rangeMeters))
  const footprint = xs.map((x, i): [number, number] => [pose.lng + x / mx, pose.lat + ys[i] / METRES_PER_DEGREE_LAT])
  const clamp = (v: number) => Math.max(-rangeMeters, Math.min(rangeMeters, v))
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
  const hiddenMask = new Uint8Array(width * height)
  const sx = photo.width / pose.width,
    sy = photo.height / pose.height
  const edgeMap = edges ? photoEdges(photo, edges.share) : null
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
    if (depth > nearest * 1.03 + 2 * cellMeters) {
      hiddenMask[cell] = 1
      continue
    }
    seen++
    const px = Math.min(photo.width - 1, Math.floor(x * sx)),
      py = Math.min(photo.height - 1, Math.floor(y * sy))
    const i = (py * photo.width + px) * 4,
      o = cell * 4
    if (edges && edgeMap) {
      if (!edgeMap[py * photo.width + px]) continue
      data[o] = edges.rgb[0]
      data[o + 1] = edges.rgb[1]
      data[o + 2] = edges.rgb[2]
    } else {
      data[o] = photo.data[i]
      data[o + 1] = photo.data[i + 1]
      data[o + 2] = photo.data[i + 2]
    }
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
    hiddenMask,
    footprint,
    rangeMeters,
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
  const { width, height, data } = mosaic
  return (lng, lat) => {
    const [tx, ty] = tileXY(lng, lat, zoom)
    const x = (tx - minX) * 256
    const y = (ty - minY) * 256
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || py < 0 || px >= width || py >= height) return null
    const nearest = (py * width + px) * 4
    if (!data[nearest + 3]) return null

    // Tiles register colors at pixel centers. Blend adjacent pixels, but keep
    // the local color next to missing data so empty tiles cannot tint the view.
    const left = Math.floor(x - 0.5)
    const top = Math.floor(y - 0.5)
    const i = (top * width + left) * 4
    const j = i + width * 4
    if (
      left < 0 ||
      top < 0 ||
      left + 1 >= width ||
      top + 1 >= height ||
      !data[i + 3] ||
      !data[i + 7] ||
      !data[j + 3] ||
      !data[j + 7]
    )
      return [data[nearest], data[nearest + 1], data[nearest + 2]]

    const fx = x - 0.5 - left
    const fy = y - 0.5 - top
    const blend = (channel: number) =>
      (data[i + channel] * (1 - fx) + data[i + channel + 4] * fx) * (1 - fy) +
      (data[j + channel] * (1 - fx) + data[j + channel + 4] * fx) * fy
    return [blend(0), blend(1), blend(2)]
  }
}

/** Rows of a model view `width` across for this camera. */
export const modelViewHeight = (pose: Pick<PhotoPose, 'width' | 'height'>, width: number) =>
  Math.round(pose.height * (width / pose.width))

/**
 * Texture agreement over ground with imagery. The edge term uses only pixels with
 * ground imagery on both sides, so the terrain horizon and missing tiles do not
 * contribute artificial edges. Insufficient samples leave the score unavailable.
 */
export function modelAgreement(
  photo: Rgba,
  model: Rgba,
): {
  brightness: number
  edges: number
  score: number
  coverage: number
} {
  const W = model.width,
    H = model.height
  const lum = (d: Uint8ClampedArray, i: number) => 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]
  const P = new Float64Array(W * H),
    M = new Float64Array(W * H),
    ground = new Uint8Array(W * H)
  let mapped = 0
  let unknown = 0
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const k = y * W + x
      const i = k * 4
      if (!model.data[i + 3]) {
        unknown++
        continue
      }
      if (model.data[i] === SKY[0] && model.data[i + 1] === SKY[1] && model.data[i + 2] === SKY[2]) continue
      ground[k] = 1
      mapped++
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
      P[k] = sum / count
      M[k] = lum(model.data, i)
    }
  const a: number[] = [],
    b: number[] = [],
    ga: number[] = [],
    gb: number[] = []
  const grad = (A: Float64Array, x: number, y: number) =>
    Math.hypot(A[y * W + x + 1] - A[y * W + x - 1], A[(y + 1) * W + x] - A[(y - 1) * W + x])
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const k = y * W + x
      if (!ground[k]) continue
      a.push(P[k])
      b.push(M[k])
      if (ground[k - 1] && ground[k + 1] && ground[k - W] && ground[k + W]) {
        ga.push(grad(P, x, y))
        gb.push(grad(M, x, y))
      }
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
  const coverage = mapped / Math.max(1, mapped + unknown)
  const usable = coverage >= 0.5 && ga.length >= Math.max(30, W * H * 0.05)
  return { brightness, edges, score: usable ? brightness + edges : Number.NaN, coverage }
}
