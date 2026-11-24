import type { SourceGrid } from './sourceGrids'

/**
 * Fetches a published 1 m source grid, checks its bytes against `hash` and decodes it. Runs in
 * `sourceGrid.worker.ts`: decoding the 4.25 MB `dtm-1m.tif` took one 179 ms task on the page's
 * thread. No DOM access, so the worker and a test can both run it.
 */
export async function fetchSourceGrid(url: string, name: string, hash: string): Promise<SourceGrid> {
  const response = await fetch(url)
  if (!response.ok) throw Error(`Source raster unavailable: ${name}`)
  const bytes = await response.arrayBuffer()
  const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('')
  if (actual !== hash) throw Error(`Source raster hash mismatch: ${name}`)
  const { fromArrayBuffer } = await import('geotiff'),
    image = await (await fromArrayBuffer(bytes)).getImage()
  if (image.getGeoKeys().ProjectedCSTypeGeoKey !== 3157 || image.getSamplesPerPixel() !== 1)
    throw Error('Unsupported source grid')
  const size = image.getResolution()
  if (Math.abs(size[0] - 1) > 1e-8 || Math.abs(size[1] + 1) > 1e-8) throw Error('Expected north-up 1 m source grid')
  const values = await image.readRasters({ samples: [0], interleave: true })
  return {
    width: image.getWidth(),
    height: image.getHeight(),
    bounds: image.getBoundingBox(),
    resolution: 1,
    values: values instanceof Float32Array ? values : new Float32Array(values as ArrayLike<number>),
    noData: image.getGDALNoData(),
  }
}
