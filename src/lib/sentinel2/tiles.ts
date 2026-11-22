/**
 * One Sentinel-2 scene as Web Mercator map tiles: which part of the scene's true-colour COG a tile
 * needs (`tileReadWindow`, in the scene's UTM zone, at the coarsest pixel the tile can use so the
 * COG's overview answers), and that read reprojected onto the tile's 256 × 256 pixels (`warpTile`).
 * The scene's own pixels are never resampled twice: the read is nearest-neighbour on the UTM grid
 * and the warp picks the nearest of those for each tile pixel. No data (all three bands 0) and
 * ground outside the read are clear. DOM-free; the reader is passed in (`cogReader.ts` in a browser).
 * The MapLibre protocol over it is `tileProtocol.ts`.
 */
import { SENTINEL_TILE_MAX_ZOOM, SENTINEL_TILE_MIN_ZOOM } from './limits'
import { SENTINEL_NATIVE_PIXEL_M, utm, type RasterBands, type RasterReader, type RasterRequest } from './window'

export const SENTINEL_TILE_SIZE = 256
/** The warp projects a grid of this many cells a side and interpolates inside each, not every pixel. */
const WARP_GRID = 16
const EARTH_CIRCUMFERENCE_M = 40_075_016.686

/** The longitude and latitude of a point on a tile, `px` and `py` in tile pixels from its top left. */
export function tilePointLonLat(z: number, x: number, y: number, px: number, py: number): [number, number] {
  const n = 2 ** z
  const lon = ((x + px / SENTINEL_TILE_SIZE) / n) * 360 - 180
  const mercY = Math.PI * (1 - (2 * (y + py / SENTINEL_TILE_SIZE)) / n)
  return [lon, (Math.atan(Math.sinh(mercY)) * 180) / Math.PI]
}

export type TileRead = RasterRequest & { epsg: number; pixelM: number }

/**
 * The UTM box a tile covers, padded by a pixel and snapped to the read's pixel grid, read at the
 * coarsest power-of-two multiple of 10 m no larger than the tile's own ground pixel.
 */
export function tileReadWindow(z: number, x: number, y: number, epsg: number): TileRead {
  const projection = utm(epsg)
  const xs: number[] = []
  const ys: number[] = []
  // A tile's edges bow in UTM, so the box is taken round its whole outline.
  for (let i = 0; i <= 8; i++) {
    const t = (i / 8) * SENTINEL_TILE_SIZE
    for (const [px, py] of [
      [t, 0],
      [t, SENTINEL_TILE_SIZE],
      [0, t],
      [SENTINEL_TILE_SIZE, t],
    ]) {
      const [ux, uy] = projection.forward(tilePointLonLat(z, x, y, px, py))
      xs.push(ux)
      ys.push(uy)
    }
  }
  const [, centreLat] = tilePointLonLat(z, x, y, SENTINEL_TILE_SIZE / 2, SENTINEL_TILE_SIZE / 2)
  const groundPixelM = (EARTH_CIRCUMFERENCE_M * Math.cos((centreLat * Math.PI) / 180)) / (SENTINEL_TILE_SIZE * 2 ** z)
  let pixelM = SENTINEL_NATIVE_PIXEL_M
  while (pixelM * 2 <= groundPixelM) pixelM *= 2
  const minX = Math.floor(Math.min(...xs) / pixelM - 1) * pixelM
  const minY = Math.floor(Math.min(...ys) / pixelM - 1) * pixelM
  const maxX = Math.ceil(Math.max(...xs) / pixelM + 1) * pixelM
  const maxY = Math.ceil(Math.max(...ys) / pixelM + 1) * pixelM
  return {
    epsg,
    pixelM,
    bbox: [minX, minY, maxX, maxY],
    width: Math.round((maxX - minX) / pixelM),
    height: Math.round((maxY - minY) / pixelM),
  }
}

/**
 * The read's three true-colour bands on the tile's pixels. Each tile pixel's centre is placed in UTM
 * by interpolating a projected `WARP_GRID` grid (the projection is smooth across one tile, and
 * projecting every pixel cost about 65,000 transforms a tile), then takes the nearest read pixel.
 */
export function warpTile(read: TileRead, bands: RasterBands, z: number, x: number, y: number): Uint8ClampedArray {
  const projection = utm(read.epsg)
  const cell = SENTINEL_TILE_SIZE / WARP_GRID
  const grid: Array<[number, number]> = []
  for (let gy = 0; gy <= WARP_GRID; gy++)
    for (let gx = 0; gx <= WARP_GRID; gx++)
      grid.push(projection.forward(tilePointLonLat(z, x, y, gx * cell, gy * cell)) as [number, number])
  const [minX, , , maxY] = read.bbox
  const [r, g, b] = bands.bands
  const out = new Uint8ClampedArray(SENTINEL_TILE_SIZE * SENTINEL_TILE_SIZE * 4)
  for (let py = 0; py < SENTINEL_TILE_SIZE; py++) {
    const fy = (py + 0.5) / cell
    const gy = Math.min(WARP_GRID - 1, Math.floor(fy))
    const ty = fy - gy
    for (let px = 0; px < SENTINEL_TILE_SIZE; px++) {
      const fx = (px + 0.5) / cell
      const gx = Math.min(WARP_GRID - 1, Math.floor(fx))
      const tx = fx - gx
      const a = grid[gy * (WARP_GRID + 1) + gx]
      const bRight = grid[gy * (WARP_GRID + 1) + gx + 1]
      const c = grid[(gy + 1) * (WARP_GRID + 1) + gx]
      const d = grid[(gy + 1) * (WARP_GRID + 1) + gx + 1]
      const ux = (a[0] * (1 - tx) + bRight[0] * tx) * (1 - ty) + (c[0] * (1 - tx) + d[0] * tx) * ty
      const uy = (a[1] * (1 - tx) + bRight[1] * tx) * (1 - ty) + (c[1] * (1 - tx) + d[1] * tx) * ty
      const column = Math.floor((ux - minX) / read.pixelM)
      const row = Math.floor((maxY - uy) / read.pixelM)
      if (column < 0 || row < 0 || column >= bands.width || row >= bands.height) continue
      const i = row * bands.width + column
      const red = r[i]
      const green = g[i]
      const blue = b[i]
      if (!red && !green && !blue) continue
      const o = (py * SENTINEL_TILE_SIZE + px) * 4
      out[o] = red
      out[o + 1] = green
      out[o + 2] = blue
      out[o + 3] = 255
    }
  }
  return out
}

/** A tile's pixels for one scene's TCI, or null outside the zooms a tile is drawn at. */
export async function readSentinelTile(
  visualHref: string,
  epsg: number,
  z: number,
  x: number,
  y: number,
  reader: RasterReader,
  signal?: AbortSignal,
): Promise<Uint8ClampedArray | null> {
  if (z < SENTINEL_TILE_MIN_ZOOM || z > SENTINEL_TILE_MAX_ZOOM) return null
  const read = tileReadWindow(z, x, y, epsg)
  const bands = await reader.read(visualHref, { bbox: read.bbox, width: read.width, height: read.height, signal })
  if (bands.bands.length < 3) throw new Error('The scene has no true-colour bands.')
  return warpTile(read, bands, z, x, y)
}

export const SENTINEL_TILE_PROTOCOL = 'pgmaps-s2'

/** The tile template for one scene: its UTM zone, then the tile, with the COG's address as a query. */
export function sentinelTileUrl(scene: { epsg: number; assets: { visual: string } }): string {
  return `${SENTINEL_TILE_PROTOCOL}://${scene.epsg}/{z}/{x}/{y}?cog=${encodeURIComponent(scene.assets.visual)}`
}

/** A tile request's parts, or null for anything that is not a Sentinel-2 tile on an https COG. */
export function parseSentinelTileUrl(
  url: string,
): { epsg: number; z: number; x: number; y: number; visualHref: string } | null {
  const match = /^pgmaps-s2:\/\/(\d+)\/(\d+)\/(\d+)\/(\d+)\?cog=([^&]+)$/.exec(url)
  if (!match) return null
  const visualHref = decodeURIComponent(match[5])
  if (!/^https:\/\//.test(visualHref)) return null
  const [epsg, z, x, y] = match.slice(1, 5).map(Number)
  return { epsg, z, x, y, visualHref }
}
