/**
 * The UTM window a Sentinel-2 scene is read over, and the reads themselves through an injected
 * reader. DOM-free and network-free: `cogReader.ts` is the browser's reader, the tests pass their own.
 */
import proj4 from 'proj4'
import {
  SENTINEL_BC_UTM_ZONES,
  SENTINEL_LIST_SCL_PX,
  SENTINEL_MAX_WINDOW_KM,
  SENTINEL_MAX_WINDOW_PX,
  SENTINEL_WINDOW_MARGIN_M,
} from './limits'
import { SentinelError, type LonLatBounds, type SentinelScene } from './stac'

/** Sentinel-2's finest grid, in metres. Tile origins sit on it. */
export const SENTINEL_NATIVE_PIXEL_M = 10

/** A read: a box in the reader's CRS (min x, min y, max x, max y) resampled to width × height pixels. */
export type RasterRequest = { bbox: [number, number, number, number]; width: number; height: number }

export type SceneWindow = RasterRequest & {
  epsg: number
  /** Ground size of one output pixel, in metres. */
  pixelM: number
}

export type RasterBands = { width: number; height: number; bands: ArrayLike<number>[] }

/**
 * Reads a COG's bands inside `bbox` (in the COG's own CRS), resampled nearest-neighbour to
 * width × height. Pixels outside the image read as 0, Sentinel-2's no-data value.
 */
export interface RasterReader {
  read(href: string, request: RasterRequest & { signal?: AbortSignal }): Promise<RasterBands>
}

export const utmZone = (lon: number) => Math.max(1, Math.min(60, Math.floor((lon + 180) / 6) + 1))
export const utmEpsg = (zone: number) => 32600 + zone

function utm(epsg: number) {
  const zone = epsg - 32600
  if (zone < 1 || zone > 60) throw new SentinelError('zones', `EPSG:${epsg} is not a WGS84 / UTM north zone.`)
  return proj4('EPSG:4326', `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`)
}

/** The terrain's UTM zone, refusing ground outside British Columbia's zones 7–11. */
export function terrainZoneEpsg(bounds: LonLatBounds | null): number {
  if (!bounds) throw new SentinelError('no-terrain', 'Load terrain first: the imagery is read over its bounds.')
  const centre = (bounds[0] + bounds[2]) / 2,
    latitude = (bounds[1] + bounds[3]) / 2
  const zone = utmZone(centre)
  const [first, last] = SENTINEL_BC_UTM_ZONES
  if (zone < first || zone > last || latitude < 48 || latitude > 60.1)
    throw new SentinelError(
      'outside-bc',
      `The terrain is outside British Columbia's UTM zones ${first}–${last}, which this imagery covers.`,
    )
  return utmEpsg(zone)
}

/**
 * The scene's read window over the terrain bounds: the bounds' outline projected to the scene's UTM
 * zone, widened by the margin and snapped outward to the pixel grid. A window past the pixel budget
 * reads 20, 40… m pixels, so geotiff picks the matching overview.
 */
export function sceneWindow(
  bounds: LonLatBounds,
  epsg: number,
  {
    marginM = SENTINEL_WINDOW_MARGIN_M,
    maxKm = SENTINEL_MAX_WINDOW_KM,
    maxPx = SENTINEL_MAX_WINDOW_PX,
  }: { marginM?: number; maxKm?: number; maxPx?: number } = {},
): SceneWindow {
  const projection = utm(epsg)
  const [west, south, east, north] = bounds
  const xs: number[] = [],
    ys: number[] = []
  // Projected edges bow, so sample along them rather than only at the corners.
  for (let i = 0; i <= 8; i++) {
    const t = i / 8
    for (const [lon, lat] of [
      [west + (east - west) * t, south],
      [west + (east - west) * t, north],
      [west, south + (north - south) * t],
      [east, south + (north - south) * t],
    ]) {
      const [x, y] = projection.forward([lon, lat])
      xs.push(x)
      ys.push(y)
    }
  }
  let minX = Math.min(...xs) - marginM,
    minY = Math.min(...ys) - marginM,
    maxX = Math.max(...xs) + marginM,
    maxY = Math.max(...ys) + marginM
  const spanKm = Math.max(maxX - minX, maxY - minY) / 1000
  if (!Number.isFinite(spanKm))
    throw new SentinelError('outside-bc', 'The terrain bounds could not be placed in a UTM zone.')
  if (spanKm > maxKm)
    throw new SentinelError(
      'too-large',
      `The terrain spans ${spanKm.toFixed(1)} km; Sentinel-2 imagery is read over at most ${maxKm} km.`,
    )
  let pixelM = SENTINEL_NATIVE_PIXEL_M
  while (Math.max(maxX - minX, maxY - minY) / pixelM > maxPx) pixelM *= 2
  minX = Math.floor(minX / pixelM) * pixelM
  minY = Math.floor(minY / pixelM) * pixelM
  maxX = Math.ceil(maxX / pixelM) * pixelM
  maxY = Math.ceil(maxY / pixelM) * pixelM
  return {
    epsg,
    pixelM,
    bbox: [minX, minY, maxX, maxY],
    width: Math.round((maxX - minX) / pixelM),
    height: Math.round((maxY - minY) / pixelM),
  }
}

/** The same window at no more than `maxPx` pixels a side, for cheap whole-window statistics. */
export function coarseWindow(window: SceneWindow, maxPx = SENTINEL_LIST_SCL_PX): SceneWindow {
  const factor = Math.max(1, Math.ceil(Math.max(window.width, window.height) / maxPx))
  return {
    ...window,
    pixelM: window.pixelM * factor,
    width: Math.max(1, Math.round(window.width / factor)),
    height: Math.max(1, Math.round(window.height / factor)),
  }
}

/** The window's corners in degrees, in MapLibre image-source order: NW, NE, SE, SW. */
export function windowQuad(
  window: SceneWindow,
): [[number, number], [number, number], [number, number], [number, number]] {
  const projection = utm(window.epsg)
  const [minX, minY, maxX, maxY] = window.bbox
  const corner = (x: number, y: number) => projection.inverse([x, y]) as [number, number]
  return [corner(minX, maxY), corner(maxX, maxY), corner(maxX, minY), corner(minX, minY)]
}

/** The window's bounds in degrees (west, south, east, north), for the scene search. */
export function windowLonLatBounds(window: SceneWindow): LonLatBounds {
  const quad = windowQuad(window)
  const lons = quad.map((p) => p[0]),
    lats = quad.map((p) => p[1])
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)]
}

export type ClippedRequest = RasterRequest & { column: number; row: number }

/**
 * The part of `request` that lies inside an image, on the request's own pixel grid: the box to read,
 * its size and where it lands in the full output. Pixels that only partly overlap the image are
 * left out rather than read past its edge. Null when nothing overlaps.
 */
export function clipRequest(request: RasterRequest, image: [number, number, number, number]): ClippedRequest | null {
  const [minX, minY, maxX, maxY] = request.bbox
  const px = (maxX - minX) / request.width,
    py = (maxY - minY) / request.height
  const eps = 1e-6
  const column = Math.max(0, Math.ceil((image[0] - minX) / px - eps))
  const columnEnd = Math.min(request.width, Math.floor((image[2] - minX) / px + eps))
  const row = Math.max(0, Math.ceil((maxY - image[3]) / py - eps))
  const rowEnd = Math.min(request.height, Math.floor((maxY - image[1]) / py + eps))
  if (columnEnd <= column || rowEnd <= row) return null
  return {
    column,
    row,
    width: columnEnd - column,
    height: rowEnd - row,
    bbox: [minX + column * px, maxY - rowEnd * py, minX + columnEnd * px, maxY - row * py],
  }
}

/** Place a clipped read into a full window of zeros (no data). */
export function pasteBands(part: RasterBands, clip: ClippedRequest, width: number, height: number): RasterBands {
  const bands = part.bands.map((band) => {
    const out = new Uint16Array(width * height)
    for (let y = 0; y < clip.height; y++) {
      const target = (clip.row + y) * width + clip.column,
        source = y * part.width
      for (let x = 0; x < clip.width; x++) out[target + x] = band[source + x]
    }
    return out
  })
  return { width, height, bands }
}

/** Scene-classification classes that see the ground: vegetation, bare, water, unclassified. */
export const SCL_CLEAR = new Set([4, 5, 6, 7])

export type ClearShare = {
  /** Clear pixels over covered pixels (0–1). */
  clear: number
  /** Covered pixels (any class but no-data) over the window (0–1). */
  coverage: number
}

/** How much of a scene-classification window sees clear ground, and how much of it the tile covers. */
export function clearShare(scl: ArrayLike<number>): ClearShare {
  let covered = 0,
    clear = 0
  for (let i = 0; i < scl.length; i++) {
    const value = scl[i]
    if (!value) continue
    covered++
    if (SCL_CLEAR.has(value)) clear++
  }
  return { clear: covered ? clear / covered : 0, coverage: scl.length ? covered / scl.length : 0 }
}

/** Rate one scene over the window from a coarse read of its scene classification. */
export async function readSceneClearShare(
  scene: SentinelScene,
  window: SceneWindow,
  reader: RasterReader,
  signal?: AbortSignal,
): Promise<ClearShare> {
  const coarse = coarseWindow(window)
  const result = await reader.read(scene.assets.scl, { ...coarse, signal })
  return clearShare(result.bands[0] ?? [])
}

/** The bands each display reads: the TCI's three for true colour, red, near infrared and SCL for NDVI. */
export async function readTrueColour(
  scene: SentinelScene,
  window: SceneWindow,
  reader: RasterReader,
  signal?: AbortSignal,
) {
  return reader.read(scene.assets.visual, { ...window, signal })
}

export type NdviBands = { red: ArrayLike<number>; nir: ArrayLike<number>; scl: ArrayLike<number> }

export async function readNdviBands(
  scene: SentinelScene,
  window: SceneWindow,
  reader: RasterReader,
  signal?: AbortSignal,
): Promise<NdviBands> {
  const [red, nir, scl] = await Promise.all(
    [scene.assets.red, scene.assets.nir, scene.assets.scl].map((href) => reader.read(href, { ...window, signal })),
  )
  return { red: red.bands[0], nir: nir.bands[0], scl: scl.bands[0] }
}
