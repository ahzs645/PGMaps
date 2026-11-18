/**
 * Satellite imagery round a camera as one RGBA mosaic, for drawing the map into a photo (`photoViews.ts`) on the
 * page's thread or the photo worker's (`layer`). The tiles are the plan's own (`SATELLITE_TILES`, Esri World
 * Imagery), which allow cross-origin reads.
 */
import { SATELLITE_TILES } from '@/components/ui/map-satellite-imagery'
import type { ImageryLayer } from './photoWork'
import { mosaicSampler, tileXY, type ImagerySampler } from './photoViews'

/** The most tiles one mosaic fetches; past it the zoom drops. */
const MAX_TILES = 64

export async function loadImageryMosaic(
  bounds: [number, number, number, number],
  maxZoom: number,
  signal?: AbortSignal,
): Promise<{ sampler: ImagerySampler; zoom: number; tiles: number; layer: ImageryLayer }> {
  let zoom = maxZoom
  const range = (z: number) => {
    const [x0, y0] = tileXY(bounds[0], bounds[3], z),
      [x1, y1] = tileXY(bounds[2], bounds[1], z)
    return { minX: Math.floor(x0), minY: Math.floor(y0), maxX: Math.floor(x1), maxY: Math.floor(y1) }
  }
  let r = range(zoom)
  while ((r.maxX - r.minX + 1) * (r.maxY - r.minY + 1) > MAX_TILES && zoom > 3) r = range(--zoom)
  const cols = r.maxX - r.minX + 1,
    rows = r.maxY - r.minY + 1
  const canvas = new OffscreenCanvas(cols * 256, rows * 256)
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  const jobs: Array<[number, number]> = []
  for (let y = r.minY; y <= r.maxY; y++) for (let x = r.minX; x <= r.maxX; x++) jobs.push([x, y])
  let next = 0
  const worker = async () => {
    while (next < jobs.length) {
      const [x, y] = jobs[next++]
      const url = SATELLITE_TILES[0].replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y))
      try {
        const response = await fetch(url, { signal })
        if (!response.ok) continue
        const bitmap = await createImageBitmap(await response.blob())
        context.drawImage(bitmap, (x - r.minX) * 256, (y - r.minY) * 256)
        bitmap.close()
      } catch (error) {
        if (signal?.aborted) throw error
        // A missing tile stays transparent, so a coarser layer can fill it.
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker))
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  // The same pixels as a layer the photo worker can take (`renderPhotoModelView`): its sampler is made there.
  const layer: ImageryLayer = {
    zoom,
    minX: r.minX,
    minY: r.minY,
    width: image.width,
    height: image.height,
    data: image.data,
  }
  return { sampler: mosaicSampler(image, zoom, r.minX, r.minY), zoom, tiles: jobs.length, layer }
}

/** Near imagery first, then a coarser ring for distant ground. */
export function layeredSampler(...samplers: ImagerySampler[]): ImagerySampler {
  return (lng, lat) => {
    for (const sample of samplers) {
      const colour = sample(lng, lat)
      if (colour) return colour
    }
    return null
  }
}
