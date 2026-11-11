/**
 * The browser's Sentinel-2 reader: byte-range reads of the AWS COGs through geotiff.js. Kept apart
 * from `window.ts` so the window maths stays network-free; geotiff picks the overview that matches
 * the requested pixel size.
 */
import { fromUrl, type GeoTIFF } from 'geotiff'
import { SENTINEL_REQUEST_TIMEOUT_MS } from './limits'
import { SentinelError, timeoutSignal } from './stac'
import { clipRequest, pasteBands, type RasterBands, type RasterReader } from './window'

const openRemote = (href: string, signal: AbortSignal) =>
  fromUrl(href, { allowFullFile: false, credentials: 'omit', blockSize: 65536, cacheSize: 64 }, signal)

/** `openFile` defaults to byte-range reads over HTTPS; the tests open in-memory GeoTIFFs instead. */
export function createCogReader({
  timeoutMs = SENTINEL_REQUEST_TIMEOUT_MS,
  openFile = openRemote,
}: { timeoutMs?: number; openFile?: (href: string, signal: AbortSignal) => Promise<GeoTIFF> } = {}): RasterReader {
  const files = new Map<string, Promise<GeoTIFF>>()
  const open = (href: string, signal: AbortSignal) => {
    let file = files.get(href)
    if (!file) {
      file = openFile(href, signal)
      files.set(href, file)
      // A failed open is not kept, so a retry opens the file again.
      file.catch(() => files.delete(href))
    }
    return file
  }
  return {
    async read(href, { bbox, width, height, signal }) {
      const timed = timeoutSignal(signal, timeoutMs)
      try {
        const tiff = await open(href, timed.signal)
        const image = await tiff.getImage()
        const clip = clipRequest({ bbox, width, height }, image.getBoundingBox() as [number, number, number, number])
        const samples = image.getSamplesPerPixel()
        if (!clip)
          return { width, height, bands: Array.from({ length: samples }, () => new Uint16Array(width * height)) }
        const rasters = (await tiff.readRasters({
          bbox: clip.bbox,
          width: clip.width,
          height: clip.height,
          resampleMethod: 'nearest',
          interleave: false,
          signal: timed.signal,
        })) as unknown as ArrayLike<number>[]
        const part: RasterBands = { width: clip.width, height: clip.height, bands: Array.from(rasters) }
        return pasteBands(part, clip, width, height)
      } catch (error) {
        if (signal?.aborted) throw error
        throw new SentinelError(
          'read',
          timed.timedOut()
            ? `A Sentinel-2 image read took longer than ${Math.round(timeoutMs / 1000)} s.`
            : 'A Sentinel-2 image could not be read from the AWS archive.',
        )
      } finally {
        timed.done()
      }
    },
  }
}
