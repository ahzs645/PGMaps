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

/** `fetchSourceGrid` in a worker, or on this thread where there are no workers (unit tests). */
function readInWorker(url: string, name: string, hash: string): Promise<SourceGrid> {
  if (typeof Worker === 'undefined')
    return import('./sourceGridRead').then((read) => read.fetchSourceGrid(url, name, hash))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./sourceGrid.worker.ts', import.meta.url), { type: 'module' })
    worker.onerror = () => {
      worker.terminate()
      reject(Error(`Source raster could not be read in this browser: ${name}`))
    }
    worker.onmessage = ({ data }: MessageEvent<{ grid?: SourceGrid; error?: string }>) => {
      worker.terminate()
      if (data.grid) resolve(data.grid)
      else reject(Error(data.error ?? `Source raster unavailable: ${name}`))
    }
    worker.postMessage({ url, name, hash })
  })
}

/**
 * The published grid `name` below `base`, checked against `hash`. Fetched, checked and decoded in a
 * worker (`sourceGrid.worker.ts`), once per address and hash.
 */
export function readSourceGrid(base: string, name: string, hash: string): Promise<SourceGrid> {
  const url = new URL(name, base).href,
    key = url + hash
  if (!cache.has(key))
    cache.set(
      key,
      readInWorker(url, name, hash).catch((error) => {
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
