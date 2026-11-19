/**
 * Meta / WRI global canopy height map v2 (DINOv3 "ml3", March 2026), read from the cloud-native
 * copy on Source Cooperative: one uint8 COG per Bing quadkey tile at zoom 10, EPSG:3857, 32768 px
 * a side (1.194 m Mercator pixels; about 0.70 m on the ground at 54° N), CORS and byte ranges.
 *
 * Heights are a model's prediction from satellite imagery (most of it 2018–2020; this tile's own
 * window is in `acq_dates.parquet`), never a laser measurement. 0 is both "no canopy" and no data.
 * DOM and network free: the caller opens the GeoTIFF (`openTiff`), so tests and scripts pass their own.
 */
export const META_CHM_BASE_URL = 'https://data.source.coop/tge-labs/meta-chm-v2'
export const META_CHM_CREDIT =
  'Canopy height © Meta Data for Good (CHM v2, CC BY 4.0); cloud-native copy by Taylor Geospatial Engine Labs'
/** Quadkey zoom of the COG tiles. */
export const META_CHM_TILE_ZOOM = 10
/** log2 of the COG's full-resolution side (32768 px). */
export const META_CHM_TILE_BITS = 15
/** Largest window read at once, in pixels: about 0.7 m cells over 6 × 6 km at 54° N. */
export const META_CHM_MAX_WINDOW_PIXELS = 80_000_000

const EARTH_CIRCUMFERENCE_M = 40_075_016.685_578_49

export type LonLatBounds = [west: number, south: number, east: number, north: number]

/** Global Web Mercator pixel coordinate at `zoom`, origin at the top-left of the world. */
export function mercatorPixel(lon: number, lat: number, zoom: number): [number, number] {
  const size = 2 ** zoom
  const s = Math.sin((Math.max(-85.051_128_78, Math.min(85.051_128_78, lat)) * Math.PI) / 180)
  return [((lon + 180) / 360) * size, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * size]
}

export function mercatorLonLat(x: number, y: number, zoom: number): [number, number] {
  const size = 2 ** zoom
  const lon = (x / size) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / size
  return [lon, (180 / Math.PI) * Math.atan(Math.sinh(n))]
}

export function quadkey(tileX: number, tileY: number, zoom: number): string {
  let key = ''
  for (let i = zoom; i > 0; i--) {
    const mask = 1 << (i - 1)
    key += String((tileX & mask ? 1 : 0) + (tileY & mask ? 2 : 0))
  }
  return key
}

export function metaChmTileUrl(key: string, base = META_CHM_BASE_URL) {
  if (!/^[0-3]{10}$/.test(key)) throw Error(`Not a zoom-10 quadkey: ${key}`)
  return `${base}/chm/${key}.tif`
}

/** The zoom-10 tiles a box touches, west to east then north to south. */
export function metaChmTiles(bounds: LonLatBounds) {
  const [w, s, e, n] = bounds
  const [x0, y0] = mercatorPixel(w, n, META_CHM_TILE_ZOOM)
  const [x1, y1] = mercatorPixel(e, s, META_CHM_TILE_ZOOM)
  const tiles: { x: number; y: number; key: string }[] = []
  for (let y = Math.floor(y0); y <= Math.floor(y1 - 1e-12); y++)
    for (let x = Math.floor(x0); x <= Math.floor(x1 - 1e-12); x++)
      tiles.push({ x, y, key: quadkey(x, y, META_CHM_TILE_ZOOM) })
  return tiles
}

/** A canopy window on the global Mercator pixel grid at `zoom` (25 at full resolution). */
export interface CanopyGrid {
  zoom: number
  /** Global pixel column and row of the window's top-left cell. */
  x0: number
  y0: number
  width: number
  height: number
  /** Metres; 0 is no canopy or no data. */
  data: Uint8Array
  /** Ground size of one cell at the window's centre latitude, metres. */
  cellM: number
  sources: string[]
}

/** The subset of geotiff.js this reader needs, so tests can stand in for a COG. */
export interface ChmTiff {
  getImageCount(): Promise<number>
  getImage(index: number): Promise<{
    getWidth(): number
    /** geotiff.js's parsed IFD; `NewSubfileType` bit 4 marks a transparency mask. */
    fileDirectory?: { NewSubfileType?: number }
    readRasters(options: {
      window: [number, number, number, number]
      samples: number[]
      interleave: true
    }): Promise<ArrayLike<number>>
  }>
}

/**
 * The image `width` pixels wide that is not a mask. The COGs interleave a transparency mask after the
 * full-resolution image (IFD 1) and keep the overviews' masks after the overviews, so an overview's
 * IFD number is not its level.
 */
export async function overviewImage(tiff: ChmTiff, width: number) {
  const count = await tiff.getImageCount()
  for (let i = 0; i < count; i++) {
    const image = await tiff.getImage(i)
    if (image.getWidth() === width && !((image.fileDirectory?.NewSubfileType ?? 0) & 4)) return image
  }
  return null
}

/**
 * Reads the canopy over `bounds` from every tile it touches, at full resolution (`overview` 0) or a
 * COG overview (each halves the resolution). Refuses windows over `maxPixels` (default
 * `META_CHM_MAX_WINDOW_PIXELS`).
 */
export async function readMetaChm(
  bounds: LonLatBounds,
  openTiff: (url: string) => Promise<ChmTiff>,
  options: { overview?: number; base?: string; maxPixels?: number } = {},
): Promise<CanopyGrid> {
  const overview = options.overview ?? 0
  const zoom = META_CHM_TILE_ZOOM + META_CHM_TILE_BITS - overview
  const [w, s, e, n] = bounds
  const [fx0, fy0] = mercatorPixel(w, n, zoom)
  const [fx1, fy1] = mercatorPixel(e, s, zoom)
  const x0 = Math.floor(fx0),
    y0 = Math.floor(fy0)
  const width = Math.ceil(fx1) - x0,
    height = Math.ceil(fy1) - y0
  if (width <= 0 || height <= 0) throw Error('The canopy window is empty.')
  if (width * height > (options.maxPixels ?? META_CHM_MAX_WINDOW_PIXELS))
    throw Error(`The canopy window is ${width} × ${height} cells; read a smaller area or an overview.`)
  const data = new Uint8Array(width * height)
  const tilePixels = 2 ** (META_CHM_TILE_BITS - overview)
  const sources: string[] = []
  for (const tile of metaChmTiles(bounds)) {
    const url = metaChmTileUrl(tile.key, options.base)
    const tiff = await openTiff(url)
    const image = await overviewImage(tiff, tilePixels)
    if (!image) throw Error(`${url} has no ${tilePixels} px image (overview ${overview}).`)
    const tx0 = tile.x * tilePixels,
      ty0 = tile.y * tilePixels
    const cx0 = Math.max(x0, tx0),
      cy0 = Math.max(y0, ty0)
    const cx1 = Math.min(x0 + width, tx0 + tilePixels),
      cy1 = Math.min(y0 + height, ty0 + tilePixels)
    if (cx1 <= cx0 || cy1 <= cy0) continue
    const values = await image.readRasters({
      window: [cx0 - tx0, cy0 - ty0, cx1 - tx0, cy1 - ty0],
      samples: [0],
      interleave: true,
    })
    const w2 = cx1 - cx0
    for (let r = 0; r < cy1 - cy0; r++)
      for (let c = 0; c < w2; c++) data[(cy0 - y0 + r) * width + (cx0 - x0 + c)] = values[r * w2 + c]
    sources.push(url)
  }
  const midLat = (s + n) / 2
  const cellM = (EARTH_CIRCUMFERENCE_M / 2 ** zoom) * Math.cos((midLat * Math.PI) / 180)
  return { zoom, x0, y0, width, height, data, cellM, sources }
}

/** Height at a point (nearest cell), or NaN outside the window. */
export function canopyAt(grid: CanopyGrid, lon: number, lat: number) {
  const [x, y] = mercatorPixel(lon, lat, grid.zoom)
  const c = Math.floor(x) - grid.x0,
    r = Math.floor(y) - grid.y0
  return c < 0 || r < 0 || c >= grid.width || r >= grid.height ? NaN : grid.data[r * grid.width + c]
}

/** Every cell within `radiusM` of a point, for percentiles over a footprint. */
export function canopyWithin(grid: CanopyGrid, lon: number, lat: number, radiusM: number): number[] {
  const [x, y] = mercatorPixel(lon, lat, grid.zoom)
  const rc = radiusM / grid.cellM
  const out: number[] = []
  for (let r = Math.floor(y - rc); r <= Math.ceil(y + rc); r++)
    for (let c = Math.floor(x - rc); c <= Math.ceil(x + rc); c++) {
      if ((c + 0.5 - x) ** 2 + (r + 0.5 - y) ** 2 > rc * rc) continue
      const cc = c - grid.x0,
        rr = r - grid.y0
      if (cc >= 0 && rr >= 0 && cc < grid.width && rr < grid.height) out.push(grid.data[rr * grid.width + cc])
    }
  return out
}
