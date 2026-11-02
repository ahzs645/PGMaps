import proj4 from 'proj4'
import { projectionDefinition } from '@/lib/geo/projectedCrs'
// NAD83(CSRS) / UTM 10N with the EPSG:1946 datum shift. Matches the pinned PROJ processing pipeline.
export const METRIC_CRS = projectionDefinition(3157)
export const toMetric = (lon: number, lat: number) => proj4('EPSG:4326', METRIC_CRS, [lon, lat])
export interface SourceGrid {
  width: number
  height: number
  bounds: number[]
  resolution: number
  values: Float32Array
  noData: number | null
}
const cache = new Map<string, Promise<SourceGrid>>()
export function readSourceGrid(base: string, name: string, hash: string): Promise<SourceGrid> {
  const url = new URL(name, base).href,
    key = url + hash
  if (!cache.has(key))
    cache.set(
      key,
      (async () => {
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
        if (Math.abs(size[0] - 1) > 1e-8 || Math.abs(size[1] + 1) > 1e-8)
          throw Error('Expected north-up 1 m source grid')
        const values = await image.readRasters({ samples: [0], interleave: true })
        return {
          width: image.getWidth(),
          height: image.getHeight(),
          bounds: image.getBoundingBox(),
          resolution: 1,
          values: new Float32Array(values as ArrayLike<number>),
          noData: image.getGDALNoData(),
        }
      })().catch((error) => {
        cache.delete(key)
        throw error
      }),
    )
  return cache.get(key)!
}
export function sourceCell(grid: Pick<SourceGrid, 'bounds' | 'resolution' | 'width' | 'height'>, x: number, y: number) {
  const col = Math.floor((x - grid.bounds[0]) / grid.resolution),
    row = Math.floor((grid.bounds[3] - y) / grid.resolution)
  return col < 0 || row < 0 || col >= grid.width || row >= grid.height ? -1 : row * grid.width + col
}
export function sourceValue(grid: SourceGrid, index: number) {
  const v = grid.values[index]
  return index < 0 || !Number.isFinite(v) || v === grid.noData ? null : v
}
