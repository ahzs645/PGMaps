/**
 * Reading Sentinel-2's 20 m bands (SWIR B11 and B12, the scene classification) onto a 10 m window.
 * DOM-free and network-free: the reader is passed in.
 *
 * A 10 m window's edge can fall halfway across a 20 m pixel. Handing that box to geotiff makes it
 * round the box to whole 20 m pixels and stretch the result, which shifts the band by up to 10 m.
 * Instead the band is read on its own grid, over the 20 m pixels that hold the window, and each
 * 10 m pixel takes the 20 m pixel its centre falls in (nearest neighbour), so the same window always
 * gives the same pixels.
 */
import { SENTINEL_INDICES, type IndexBands, type ReflectanceBand, type SentinelIndex } from './indices'
import { SentinelError, type SentinelScene } from '@/lib/sentinel2/stac'
import {
  SENTINEL_NATIVE_PIXEL_M,
  type RasterBands,
  type RasterReader,
  type RasterRequest,
  type SceneWindow,
} from '@/lib/sentinel2/window'

/** The ground size of Sentinel-2's SWIR and scene-classification pixels. */
export const SENTINEL_20M_PIXEL_M = 20

/** Each band's own pixel size in Earth Search's COGs. */
export const BAND_PIXEL_M: Record<ReflectanceBand | 'scl', number> = {
  red: SENTINEL_NATIVE_PIXEL_M,
  nir: SENTINEL_NATIVE_PIXEL_M,
  swir16: SENTINEL_20M_PIXEL_M,
  swir22: SENTINEL_20M_PIXEL_M,
  scl: SENTINEL_20M_PIXEL_M,
}

const BAND_NAMES: Record<ReflectanceBand, string> = {
  red: 'red (B04)',
  nir: 'near-infrared (B08)',
  swir16: 'SWIR (B11)',
  swir22: 'SWIR (B12)',
}

/** The box on the `nativeM` grid that holds `window`, at the band's own pixel size. */
export function nativeRequest(window: RasterRequest, nativeM: number): RasterRequest {
  const [minX, minY, maxX, maxY] = window.bbox
  const box: [number, number, number, number] = [
    Math.floor(minX / nativeM) * nativeM,
    Math.floor(minY / nativeM) * nativeM,
    Math.ceil(maxX / nativeM) * nativeM,
    Math.ceil(maxY / nativeM) * nativeM,
  ]
  return {
    bbox: box,
    width: Math.round((box[2] - box[0]) / nativeM),
    height: Math.round((box[3] - box[1]) / nativeM),
  }
}

/**
 * One band read on `source`'s grid, resampled to `target`'s by nearest neighbour: each target pixel
 * takes the source pixel under its centre. Target pixels past the source read 0 (no data).
 */
export function resampleNearest(
  band: ArrayLike<number>,
  source: RasterRequest,
  target: RasterRequest,
): Uint16Array | Uint8Array | Float32Array {
  const out =
    band instanceof Float32Array
      ? new Float32Array(target.width * target.height)
      : band instanceof Uint8Array
        ? new Uint8Array(target.width * target.height)
        : new Uint16Array(target.width * target.height)
  const sx = (source.bbox[2] - source.bbox[0]) / source.width,
    sy = (source.bbox[3] - source.bbox[1]) / source.height
  const tx = (target.bbox[2] - target.bbox[0]) / target.width,
    ty = (target.bbox[3] - target.bbox[1]) / target.height
  // Column and row lookups once per axis: the centre of a target pixel, floored on the source grid.
  const columns = new Int32Array(target.width)
  for (let x = 0; x < target.width; x++) {
    const centre = target.bbox[0] + (x + 0.5) * tx
    const column = Math.floor((centre - source.bbox[0]) / sx)
    columns[x] = column >= 0 && column < source.width ? column : -1
  }
  for (let y = 0; y < target.height; y++) {
    const centre = target.bbox[3] - (y + 0.5) * ty
    const row = Math.floor((source.bbox[3] - centre) / sy)
    if (row < 0 || row >= source.height) continue
    const from = row * source.width,
      to = y * target.width
    for (let x = 0; x < target.width; x++) if (columns[x] >= 0) out[to + x] = band[from + columns[x]]
  }
  return out
}

/**
 * A band on the window's grid. A band coarser than the window is read on its own grid and resampled
 * here; one at or finer than the window's pixel is read on the window directly, as every 10 m band is.
 */
export async function readBandOnWindow(
  href: string,
  window: SceneWindow,
  nativeM: number,
  reader: RasterReader,
  signal?: AbortSignal,
): Promise<ArrayLike<number>> {
  if (window.pixelM >= nativeM) return (await reader.read(href, { ...windowRequest(window), signal })).bands[0]
  const source = nativeRequest(window, nativeM)
  const read: RasterBands = await reader.read(href, { ...source, signal })
  return resampleNearest(read.bands[0], source, window)
}

const windowRequest = (window: SceneWindow): RasterRequest => ({
  bbox: window.bbox,
  width: window.width,
  height: window.height,
})

/**
 * The two bands an index needs and the scene classification, all on the window's grid. Throws a
 * stated reason when the scene does not list a band (older items carry no SWIR).
 */
export async function readIndexBands(
  scene: SentinelScene,
  index: SentinelIndex,
  window: SceneWindow,
  reader: RasterReader,
  signal?: AbortSignal,
): Promise<IndexBands> {
  const spec = SENTINEL_INDICES[index]
  const missing = spec.bands.filter((band) => !scene.assets[band] || !scene.scaling[band])
  if (missing.length)
    throw new SentinelError(
      'no-scene',
      `The ${scene.date} scene lists no ${missing.map((band) => BAND_NAMES[band]).join(' or ')} band, which ${spec.label} needs.`,
    )
  const names = [...spec.bands, 'scl'] as const
  const bands = await Promise.all(
    names.map((band) => readBandOnWindow(scene.assets[band]!, window, BAND_PIXEL_M[band], reader, signal)),
  )
  return { [names[0]]: bands[0], [names[1]]: bands[1], scl: bands[2] } as IndexBands
}
