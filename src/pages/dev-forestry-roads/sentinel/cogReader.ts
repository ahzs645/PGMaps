/**
 * The browser's Sentinel-2 reader: byte-range reads of the AWS COGs through geotiff.js. Kept apart
 * from `window.ts` so the window maths stays network-free; geotiff picks the overview that matches
 * the requested pixel size.
 */
import { fromUrl, type GeoTIFF } from 'geotiff'
import { SENTINEL_REQUEST_TIMEOUT_MS, SENTINEL_FILE_CACHE_ENTRIES, SENTINEL_READ_CONCURRENCY } from './limits'
import { createReadQueue } from './readQueue'
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
  const queued = createReadQueue(SENTINEL_READ_CONCURRENCY)
  const open = (href: string, signal: AbortSignal) => {
    let file = files.get(href)
    if (!file) {
      file = openFile(href, signal)
      files.set(href, file)
      while (files.size > SENTINEL_FILE_CACHE_ENTRIES) files.delete(files.keys().next().value!)
      // A failed open is not kept, so a retry opens the file again.
      file.catch(() => {
        if (files.get(href) === file) files.delete(href)
      })
    } else {
      files.delete(href)
      files.set(href, file)
    }
    return file
  }
  return {
    read(href, request) {
      return queued(async () => {
        const { bbox, width, height, signal } = request
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
          files.delete(href)
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
      }, request.signal)
    },
  }
}
