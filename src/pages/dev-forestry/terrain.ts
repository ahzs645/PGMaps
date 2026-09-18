/**
 * Terrain sampling for the visual-quality utility.
 *
 * Elevation comes from the AWS Open Data "terrain tiles" archive in Terrarium
 * encoding — the same tiles the map renders as 3D terrain and hillshade, so the
 * numbers behind a sightline match the relief a person sees on screen. Tiles
 * need no API key, which keeps this page self-contained.
 *
 * Everything here works in Web Mercator pixel space at a single DEM zoom. A
 * sightline walk converts its endpoints once and then interpolates pixels,
 * which avoids a `log`/`tan` pair per step; over the tens of kilometres this
 * page covers, the difference between a Mercator chord and a geodesic is far
 * below the DEM's own resolution.
 */

export const TERRARIUM_TILE_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

export const TERRAIN_ATTRIBUTION =
  '<a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noreferrer">Terrain tiles</a> (AWS Open Data · SRTM/CDEM)'

export const DEM_TILE_SIZE = 256

/** Equatorial circumference in metres, the Web Mercator world width. */
export const EARTH_CIRCUMFERENCE_METERS = 40075016.686

export const EARTH_RADIUS_METERS = 6371008.8

/** Web Mercator cuts off here; BC is nowhere near it, but clamping keeps the math total. */
const MAX_MERCATOR_LATITUDE = 85.05112878

export const MIN_DEM_ZOOM = 10
export const MAX_DEM_ZOOM = 14
export const DEFAULT_DEM_ZOOM = 13

/**
 * Upper bound on tiles fetched for one analysis. 256 tiles is ~64 MB of
 * Float32 samples and a few seconds of network; past that the answer is to
 * drop a DEM zoom level rather than to wait.
 */
export const MAX_DEM_TILES = 256

/** Metres represented by one DEM pixel at a latitude and zoom. */
export function demResolutionMeters(latitude: number, zoom: number): number {
  const scale = DEM_TILE_SIZE * 2 ** zoom
  return (EARTH_CIRCUMFERENCE_METERS * Math.cos((latitude * Math.PI) / 180)) / scale
}

/** Terrarium packs metres as `r * 256 + g + b / 256 - 32768`. */
export function decodeTerrariumElevation(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}

/** Normalised Web Mercator coordinates in `[0, 1)`, origin at the north-west corner. */
export function lngLatToMercator(lng: number, lat: number): [x: number, y: number] {
  const clampedLat = Math.max(-MAX_MERCATOR_LATITUDE, Math.min(MAX_MERCATOR_LATITUDE, lat))
  const sin = Math.sin((clampedLat * Math.PI) / 180)
  return [(lng + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)]
}

/** Inverse of {@link lngLatToMercator}. */
export function mercatorToLngLat(x: number, y: number): [lng: number, lat: number] {
  const n = Math.PI - 2 * Math.PI * y
  return [x * 360 - 180, (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))]
}

/** Web Mercator pixel coordinates at `zoom`, in 256 px tile units. */
export function lngLatToWorldPixel(lng: number, lat: number, zoom: number): [x: number, y: number] {
  const scale = DEM_TILE_SIZE * 2 ** zoom
  const [x, y] = lngLatToMercator(lng, lat)
  return [x * scale, y * scale]
}

/** Inverse of {@link lngLatToWorldPixel}. */
export function worldPixelToLngLat(x: number, y: number, zoom: number): [lng: number, lat: number] {
  const scale = DEM_TILE_SIZE * 2 ** zoom
  return mercatorToLngLat(x / scale, y / scale)
}

export type DemTileRange = {
  zoom: number
  minX: number
  minY: number
  maxX: number
  maxY: number
  tileCount: number
}

/** `[minLng, minLat, maxLng, maxLat]`, matching @turf/bbox and MapLibre. */
export type Bounds = [number, number, number, number]

/** Inclusive tile range covering `bounds`, padded by `padMeters` on every side. */
export function demTileRange(bounds: Bounds, zoom: number, padMeters = 0): DemTileRange {
  const [minLng, minLat, maxLng, maxLat] = bounds
  const latPad = (padMeters / EARTH_RADIUS_METERS) * (180 / Math.PI)
  const midLat = (minLat + maxLat) / 2
  const lngPad = latPad / Math.max(0.05, Math.cos((midLat * Math.PI) / 180))

  const topLeft = lngLatToWorldPixel(minLng - lngPad, maxLat + latPad, zoom)
  const bottomRight = lngLatToWorldPixel(maxLng + lngPad, minLat - latPad, zoom)
  const worldTiles = 2 ** zoom

  const clampTile = (value: number) => Math.max(0, Math.min(worldTiles - 1, value))
  const minX = clampTile(Math.floor(topLeft[0] / DEM_TILE_SIZE))
  const maxX = clampTile(Math.floor(bottomRight[0] / DEM_TILE_SIZE))
  const minY = clampTile(Math.floor(topLeft[1] / DEM_TILE_SIZE))
  const maxY = clampTile(Math.floor(bottomRight[1] / DEM_TILE_SIZE))

  return {
    zoom,
    minX,
    minY,
    maxX,
    maxY,
    tileCount: (maxX - minX + 1) * (maxY - minY + 1),
  }
}

/** Every `{ x, y }` in a tile range, row by row. */
export function demTileCoordinates(range: DemTileRange): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = []
  for (let y = range.minY; y <= range.maxY; y += 1) {
    for (let x = range.minX; x <= range.maxX; x += 1) tiles.push({ x, y })
  }
  return tiles
}

export function demTileUrl(x: number, y: number, zoom: number, template = TERRARIUM_TILE_URL): string {
  return template.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y))
}

/** Metres above sea level, or `NaN` where the source holds no data. */
export interface ElevationSource {
  elevationAt(lng: number, lat: number): number
  /**
   * Optional fast path for callers that already walk normalised Mercator
   * space, such as the sightline profile. Sampling the same positions as
   * {@link elevationAt}, it only skips the coordinate round trip.
   */
  elevationAtMercator?(x: number, y: number): number
}

/**
 * A mosaic of decoded DEM tiles at one zoom, sampled bilinearly.
 *
 * Tiles are blitted into one contiguous array covering the whole range rather
 * than kept as a map of tiles. A sightline reads four texels per step and a run
 * walks tens of millions of steps, so reducing a lookup to one bounds check and
 * one index is the difference between a snappy analysis and a slow one.
 *
 * The mosaic addresses tiles absolutely and does not wrap at the antimeridian;
 * an analysis area straddling it would need the range split in two.
 */
export class ElevationGrid implements ElevationSource {
  readonly zoom: number

  readonly range: DemTileRange

  /** Mosaic origin in world pixels, and its size. */
  private readonly originX: number

  private readonly originY: number

  private readonly width: number

  private readonly height: number

  private readonly values: Float32Array

  private loadedTiles = 0

  constructor(range: DemTileRange) {
    this.zoom = range.zoom
    this.range = range
    this.originX = range.minX * DEM_TILE_SIZE
    this.originY = range.minY * DEM_TILE_SIZE
    this.width = (range.maxX - range.minX + 1) * DEM_TILE_SIZE
    this.height = (range.maxY - range.minY + 1) * DEM_TILE_SIZE
    // Ground the mosaic does not cover reads as NaN, which sightlines skip
    // rather than mistaking for sea level.
    this.values = new Float32Array(this.width * this.height).fill(Number.NaN)
  }

  get tileCount(): number {
    return this.loadedTiles
  }

  setTile(x: number, y: number, values: Float32Array): void {
    const { minX, minY, maxX, maxY } = this.range
    if (x < minX || x > maxX || y < minY || y > maxY) return

    const offsetX = (x - minX) * DEM_TILE_SIZE
    const offsetY = (y - minY) * DEM_TILE_SIZE
    for (let row = 0; row < DEM_TILE_SIZE; row += 1) {
      this.values.set(
        values.subarray(row * DEM_TILE_SIZE, (row + 1) * DEM_TILE_SIZE),
        (offsetY + row) * this.width + offsetX,
      )
    }
    this.loadedTiles += 1
  }

  hasTile(x: number, y: number): boolean {
    const { minX, minY, maxX, maxY } = this.range
    if (x < minX || x > maxX || y < minY || y > maxY) return false
    const index = (y - minY) * DEM_TILE_SIZE * this.width + (x - minX) * DEM_TILE_SIZE
    return !Number.isNaN(this.values[index])
  }

  /** Nearest-neighbour read of one DEM pixel, or `NaN` outside the mosaic. */
  private texel(px: number, py: number): number {
    const x = px - this.originX
    const y = py - this.originY
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return Number.NaN
    return this.values[y * this.width + x]
  }

  /**
   * Bilinear elevation at a Web Mercator pixel position. Terrarium samples sit
   * at pixel centres, so the sample position is shifted by half a pixel before
   * the corners are picked.
   */
  elevationAtWorldPixel(px: number, py: number): number {
    const x = px - 0.5
    const y = py - 0.5
    const x0 = Math.floor(x)
    const y0 = Math.floor(y)
    const fx = x - x0
    const fy = y - y0

    const h00 = this.texel(x0, y0)
    const h10 = this.texel(x0 + 1, y0)
    const h01 = this.texel(x0, y0 + 1)
    const h11 = this.texel(x0 + 1, y0 + 1)
    if (Number.isNaN(h00) || Number.isNaN(h10) || Number.isNaN(h01) || Number.isNaN(h11)) {
      // Edge of the loaded mosaic: fall back to whichever corner exists so a
      // sightline grazing the boundary degrades instead of reporting a hole.
      const present = [h00, h10, h01, h11].filter((value) => !Number.isNaN(value))
      if (present.length === 0) return Number.NaN
      return present.reduce((total, value) => total + value, 0) / present.length
    }

    const top = h00 + (h10 - h00) * fx
    const bottom = h01 + (h11 - h01) * fx
    return top + (bottom - top) * fy
  }

  elevationAtMercator(x: number, y: number): number {
    const scale = DEM_TILE_SIZE * 2 ** this.zoom
    return this.elevationAtWorldPixel(x * scale, y * scale)
  }

  elevationAt(lng: number, lat: number): number {
    const [px, py] = lngLatToWorldPixel(lng, lat, this.zoom)
    return this.elevationAtWorldPixel(px, py)
  }
}
