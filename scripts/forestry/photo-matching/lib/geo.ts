/**
 * Terrain, imagery and map layers round a photo's camera, and the camera maths the photo-matching scripts share.
 * Reuses the page's own modules (`terrain.ts`, `photoPose.ts`). Tiles and WFS answers are cached outside the
 * repository (PHOTO_MATCH_CACHE, default the system temp folder) so reruns are quick and offline-friendly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage, type Canvas, type SKRSContext2D } from '@napi-rs/canvas'
import * as terrain from '../../../../src/lib/forestry/terrain/terrain'
import { cameraAxes, projectToPhoto, type PhotoPose } from '../../../../src/pages/dev-forestry/photoPose'

export { createCanvas, loadImage }
export type Pose = PhotoPose
export type Bounds = [number, number, number, number]
export type LngLat = [number, number]
export type Source = { elevationAt(lng: number, lat: number): number }

export const CACHE = process.env.PHOTO_MATCH_CACHE ?? join(tmpdir(), 'pgmaps-photo-matching')
mkdirSync(CACHE, { recursive: true })
const RAD = Math.PI / 180
/** Refraction coefficient used for the drop of distant ground, as in `skylineReach.ts`. */
const REFRACTION = 0.13

export const metres = (lat: number) => ({ x: 111320 * Math.cos(lat * RAD), y: 110574 })

async function cached(url: string, name: string): Promise<Buffer | null> {
  const path = join(CACHE, name)
  if (existsSync(path)) return readFileSync(path)
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url)
      if (!res.ok) return null
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(path, buf)
      return buf
    } catch {
      // retry
    }
  }
  return null
}

async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

export function boundsAround(lng: number, lat: number, radiusM: number): Bounds {
  const m = metres(lat)
  return [lng - radiusM / m.x, lat - radiusM / m.y, lng + radiusM / m.x, lat + radiusM / m.y]
}

/** A box from the camera out to `radiusM` across `bearing ± halfAngle`. */
export function wedge(lng: number, lat: number, bearing: number, radiusM: number, halfAngle = 35): Bounds {
  const m = metres(lat)
  const pts: number[][] = [[0, 0]]
  for (let a = bearing - halfAngle; a <= bearing + halfAngle; a += 5) pts.push([Math.sin(a * RAD) * radiusM, Math.cos(a * RAD) * radiusM])
  const xs = pts.map((p) => lng + p[0] / m.x), ys = pts.map((p) => lat + p[1] / m.y)
  return [Math.min(...xs) - 0.01, Math.min(...ys) - 0.01, Math.max(...xs) + 0.01, Math.max(...ys) + 0.01]
}

/** Terrarium terrain over `bounds` at the finest zoom ≤ `maxZoom` within `maxTiles`. */
export async function dem(bounds: Bounds, maxZoom: number, maxTiles = 120): Promise<terrain.ElevationGrid> {
  let zoom = maxZoom, range = terrain.demTileRange(bounds, zoom)
  while (range.tileCount > maxTiles) range = terrain.demTileRange(bounds, --zoom)
  const grid = new terrain.ElevationGrid(range)
  const canvas = createCanvas(256, 256), ctx = canvas.getContext('2d')
  await pool(terrain.demTileCoordinates(range), 12, async ({ x, y }) => {
    const buf = await cached(terrain.demTileUrl(x, y, zoom), `dem_${zoom}_${x}_${y}.png`)
    if (!buf) return
    ctx.clearRect(0, 0, 256, 256)
    ctx.drawImage(await loadImage(buf), 0, 0)
    const d = ctx.getImageData(0, 0, 256, 256).data
    const v = new Float32Array(65536)
    for (let i = 0; i < v.length; i++) v[i] = terrain.decodeTerrariumElevation(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])
    grid.setTile(x, y, v)
  })
  return grid
}

/** The first source with a value wins, so a fine near mosaic sits over a coarse far one. */
export function layered(...sources: Source[]): Source {
  return {
    elevationAt(lng, lat) {
      for (const s of sources) {
        const v = s.elevationAt(lng, lat)
        if (Number.isFinite(v)) return v
      }
      return Number.NaN
    },
  }
}

/** Near (z13) and far (z10) terrain for a camera looking along `bearing`. */
export async function terrainFor(lng: number, lat: number, bearing: number, nearM = 12000, farM = 70000): Promise<Source> {
  const near = await dem(wedge(lng, lat, bearing, nearM), 13, 160)
  const far = await dem(boundsAround(lng, lat, farM), 10)
  return layered(near, far)
}

export type Imagery = { sample(lng: number, lat: number): [number, number, number] | null; pixel(lng: number, lat: number): [number, number]; canvas: Canvas; tiles: number }

/** Esri World Imagery (the basemap PGMaps' satellite layer uses) over `bounds`. */
export async function imagery(bounds: Bounds, zoom: number): Promise<Imagery> {
  const tile = (lng: number, lat: number): [number, number] => {
    const n = 2 ** zoom, s = Math.sin(lat * RAD)
    return [((lng + 180) / 360) * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n]
  }
  const [x0, y0] = tile(bounds[0], bounds[3]), [x1, y1] = tile(bounds[2], bounds[1])
  const minX = Math.floor(x0), maxX = Math.floor(x1), minY = Math.floor(y0), maxY = Math.floor(y1)
  const W = (maxX - minX + 1) * 256, H = (maxY - minY + 1) * 256
  const canvas = createCanvas(W, H), ctx = canvas.getContext('2d')
  ctx.fillStyle = '#808080'
  ctx.fillRect(0, 0, W, H)
  const tiles: Array<[number, number]> = []
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) tiles.push([x, y])
  await pool(tiles, 8, async ([x, y]) => {
    const url = `https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`
    const buf = await cached(url, `esri_${zoom}_${x}_${y}.jpg`)
    if (!buf) return
    try {
      ctx.drawImage(await loadImage(buf), (x - minX) * 256, (y - minY) * 256)
    } catch {
      // a blank tile stays grey
    }
  })
  const data = ctx.getImageData(0, 0, W, H).data
  const pixel = (lng: number, lat: number): [number, number] => {
    const [x, y] = tile(lng, lat)
    return [(x - minX) * 256, (y - minY) * 256]
  }
  return {
    canvas,
    tiles: tiles.length,
    pixel,
    sample(lng, lat) {
      const [px, py] = pixel(lng, lat).map(Math.floor)
      if (px < 0 || py < 0 || px >= W || py >= H) return null
      const i = (py * W + px) * 4
      return [data[i], data[i + 1], data[i + 2]]
    },
  }
}

/** Near (z15), middle (z12) and far (z10) imagery for a camera looking along `bearing`. */
export async function imageryFor(lng: number, lat: number, bearing: number): Promise<Imagery[]> {
  return [
    await imagery(wedge(lng, lat, bearing, 6000), 15),
    await imagery(wedge(lng, lat, bearing, 25000), 12),
    await imagery(boundsAround(lng, lat, 70000), 10),
  ]
}

/** DataBC WFS. The box goes in CQL_FILTER, longitude first (see AGENTS.md); the geometry field is named. */
export async function wfs(typeName: string, geometry: string, props: string, b: Bounds, extra = ''): Promise<GeoJSON.Feature[]> {
  const params = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeName, outputFormat: 'application/json', srsName: 'EPSG:4326',
    propertyName: [geometry, props].filter(Boolean).join(','),
    CQL_FILTER: `BBOX(${geometry},${b.map((v) => v.toFixed(3)).join(',')},'EPSG:4326')${extra}`,
  })
  const key = Buffer.from(`${typeName}|${b.map((v) => v.toFixed(3)).join(',')}|${extra}|${props}`).toString('base64url').slice(0, 120)
  const buf = await cached(`https://openmaps.gov.bc.ca/geo/pub/wfs?${params}`, `wfs_${key}.json`)
  return buf ? (JSON.parse(buf.toString()).features ?? []) : []
}

/** The layers the scripts draw and test against, keyed by a short name. */
export const LAYERS = {
  streams: ['WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP', 'GEOMETRY', 'STREAM_ORDER'],
  lakes: ['WHSE_BASEMAPPING.FWA_LAKES_POLY', 'GEOMETRY', ''],
  rivers: ['WHSE_BASEMAPPING.FWA_RIVERS_POLY', 'GEOMETRY', ''],
  wetlands: ['WHSE_BASEMAPPING.FWA_WETLANDS_POLY', 'GEOMETRY', ''],
  ftenRoads: ['WHSE_FOREST_TENURE.FTEN_ROAD_SECTION_LINES_SVW', 'GEOMETRY', 'LIFE_CYCLE_STATUS_CODE'],
  draRoads: ['WHSE_BASEMAPPING.DRA_DGTL_ROAD_ATLAS_MPAR_SP', 'GEOMETRY', 'ROAD_CLASS'],
  cutblocks: ['WHSE_FOREST_VEGETATION.VEG_CONSOLIDATED_CUT_BLOCKS_SP', 'SHAPE', 'HARVEST_START_YEAR_CALENDAR'],
} as const
export type LayerName = keyof typeof LAYERS
export const layer = (name: LayerName, b: Bounds, extra = '') => wfs(LAYERS[name][0], LAYERS[name][1], LAYERS[name][2], b, extra)

/** Every ring or line of the features, as [lng, lat] arrays. */
export function rings(features: GeoJSON.Feature[]): LngLat[][] {
  const out: LngLat[][] = []
  for (const f of features) {
    const g = f.geometry as GeoJSON.Geometry | null
    if (!g) continue
    if (g.type === 'Polygon') out.push(...(g.coordinates as LngLat[][]))
    else if (g.type === 'MultiPolygon') for (const p of g.coordinates) out.push(...(p as LngLat[][]))
    else if (g.type === 'LineString') out.push(g.coordinates as LngLat[])
    else if (g.type === 'MultiLineString') out.push(...(g.coordinates as LngLat[][]))
  }
  return out
}

export function inRing(ring: ArrayLike<number[]> & { length: number }, x: number, y: number): boolean {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j]
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}

export function poseFrom(o: { lng: number; lat: number; alt: number; bearing: number; pitch: number; roll: number; hfov: number; width: number; height: number }): Pose {
  return { lng: o.lng, lat: o.lat, altitudeMeters: o.alt, bearing: o.bearing, pitch: o.pitch, roll: o.roll, width: o.width, height: o.height, focalPx: o.width / 2 / Math.tan((o.hfov * RAD) / 2), k1: 0, k2: 0 }
}

const drop = (d: number) => ((d * d) / (2 * 6371000)) * (1 - REFRACTION)

/** Unit view ray (east, north, up) through photo pixel (u, v). */
export function rayThrough(pose: Pose, u: number, v: number): [number, number, number] {
  const { right, down, forward } = cameraAxes(pose)
  const nx = (u - pose.width / 2) / pose.focalPx, ny = (v - pose.height / 2) / pose.focalPx
  const d = [0, 1, 2].map((k) => forward[k] + nx * right[k] + ny * down[k])
  const len = Math.hypot(d[0], d[1], d[2])
  return [d[0] / len, d[1] / len, d[2] / len]
}

export type Hit = { lng: number; lat: number; distance: number; elevation: number }

/** First ground the ray through pixel (u, v) meets, or null for sky or missing terrain. */
export function castRay(pose: Pose, source: Source, u: number, v: number, maxM = 60000): Hit | null {
  const d = rayThrough(pose, u, v)
  const m = metres(pose.lat)
  const at = (t: number) => {
    const e = d[0] * t, n = d[1] * t
    return { lng: pose.lng + e / m.x, lat: pose.lat + n / m.y, z: pose.altitudeMeters + d[2] * t + drop(Math.hypot(e, n)), h: Math.hypot(e, n) }
  }
  let prev = 0
  for (let t = 15; t < maxM; t = t * 1.004 + 2) {
    const p = at(t), g = source.elevationAt(p.lng, p.lat)
    if (!Number.isFinite(g)) return null
    if (p.z <= g) {
      let lo = prev, hi = t
      for (let k = 0; k < 12; k++) {
        const mid = (lo + hi) / 2, q = at(mid)
        if (q.z <= source.elevationAt(q.lng, q.lat)) hi = mid
        else lo = mid
      }
      const q = at(hi)
      return { lng: q.lng, lat: q.lat, distance: q.h, elevation: source.elevationAt(q.lng, q.lat) }
    }
    prev = t
  }
  return null
}

/** Is ground at (lng, lat, elevation) in sight of the camera, terrain only (no canopy)? */
export function visible(pose: Pose, source: Source, lng: number, lat: number, elevation: number): boolean {
  const m = metres(pose.lat)
  const e = (lng - pose.lng) * m.x, n = (lat - pose.lat) * m.y, D = Math.hypot(e, n)
  const dz = elevation + 2 - drop(D) - pose.altitudeMeters
  for (let f = 0.02; f < 0.985; f += Math.max(0.004, 20 / D)) {
    if (source.elevationAt(pose.lng + (e * f) / m.x, pose.lat + (n * f) / m.y) > pose.altitudeMeters + dz * f + drop(D * f)) return false
  }
  return true
}

export const project = projectToPhoto

/** The model's view: imagery draped on the terrain, with distance haze, at `scale` of the pose's frame. */
export function render(pose: Pose, source: Source, images: Imagery[], scale = 0.5): Canvas {
  const W = Math.round(pose.width * scale), H = Math.round(pose.height * scale)
  const canvas = createCanvas(W, H), ctx = canvas.getContext('2d')
  const out = ctx.createImageData(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const hit = castRay(pose, source, (x + 0.5) / scale, (y + 0.5) / scale)
    let c: number[] = [170, 200, 235]
    if (hit) {
      c = [90, 90, 90]
      for (const im of images) {
        const s = im.sample(hit.lng, hit.lat)
        if (s) {
          c = s
          break
        }
      }
      const f = Math.min(0.6, hit.distance / 60000)
      c = [c[0] * (1 - f) + 175 * f, c[1] * (1 - f) + 190 * f, c[2] * (1 - f) + 215 * f]
    }
    const i = (y * W + x) * 4
    out.data[i] = c[0]
    out.data[i + 1] = c[1]
    out.data[i + 2] = c[2]
    out.data[i + 3] = 255
  }
  ctx.putImageData(out, 0, 0)
  return canvas
}

/** Lines drawn on a view: solid where the camera sees the ground, dotted where terrain hides it. */
export function drawLines(ctx: SKRSContext2D, pose: Pose, source: Source, lines: LngLat[][], color: string, scale = 1, width = 2) {
  const m = metres(pose.lat)
  for (const line of lines) {
    let last: { x: number; y: number; vis: boolean } | null = null
    for (let i = 0; i < line.length; i++) {
      const pts: LngLat[] = []
      if (i === 0) pts.push(line[0])
      else {
        const [a, b] = [line[i - 1], line[i]]
        const steps = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * m.x, (b[1] - a[1]) * m.y) / 25))
        for (let k = 1; k <= steps; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps])
      }
      for (const [x, y] of pts) {
        const z = source.elevationAt(x, y)
        const p = project(pose, x, y, z)
        if (!p) {
          last = null
          continue
        }
        const q = { x: p.x * scale, y: p.y * scale, vis: visible(pose, source, x, y, z) }
        if (last && Math.hypot(q.x - last.x, q.y - last.y) < 200 * scale) {
          const seen = q.vis && last.vis
          ctx.strokeStyle = color
          ctx.lineWidth = seen ? width : 1
          ctx.setLineDash(seen ? [] : [2, 4])
          ctx.beginPath()
          ctx.moveTo(last.x, last.y)
          ctx.lineTo(q.x, q.y)
          ctx.stroke()
        }
        last = q
      }
    }
  }
  ctx.setLineDash([])
}

/** Every pixel whose ground hit falls inside `ring` (and so is in sight), blended with `color`. Returns the count. */
export function fillGround(ctx: SKRSContext2D, pose: Pose, source: Source, ring: LngLat[], color: number[], scale = 1): number {
  const w = Math.round(pose.width * scale), h = Math.round(pose.height * scale)
  const pts = ring.map(([x, y]) => project(pose, x, y, source.elevationAt(x, y))).filter((p): p is NonNullable<typeof p> => !!p)
  if (!pts.length) return 0
  const x0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q.x)) * scale) - 2), x1 = Math.min(w, Math.ceil(Math.max(...pts.map((q) => q.x)) * scale) + 2)
  const y0 = Math.max(0, Math.floor(Math.min(...pts.map((q) => q.y)) * scale) - 2), y1 = Math.min(h, Math.ceil(Math.max(...pts.map((q) => q.y)) * scale) + 2)
  if (x1 <= x0 || y1 <= y0) return 0
  const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0)
  let n = 0
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const hit = castRay(pose, source, (x + 0.5) / scale, (y + 0.5) / scale, 30000)
    if (!hit || !inRing(ring, hit.lng, hit.lat)) continue
    const i = ((y - y0) * (x1 - x0) + (x - x0)) * 4
    for (let k = 0; k < 3; k++) d.data[i + k] = d.data[i + k] * 0.5 + color[k] * 0.5
    n++
  }
  ctx.putImageData(d, x0, y0)
  return n
}

/** Planar area of a lon/lat ring in hectares (local metres; fine for a block-sized ring). */
export function areaHa(ring: LngLat[]): number {
  const m = metres(ring[0][1])
  let a = 0
  for (let i = 1; i < ring.length; i++) a += ring[i - 1][0] * m.x * ring[i][1] * m.y - ring[i][0] * m.x * ring[i - 1][1] * m.y
  return Math.abs(a) / 2 / 1e4
}

export function saveJpeg(canvas: Canvas, path: string) {
  writeFileSync(path, canvas.toBuffer('image/jpeg', 85))
}
