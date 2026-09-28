import { fromBlob } from 'geotiff'
import { fetchBytes, fetchJson } from '@/lib/fetchJson'
import { sampleCcissRaster } from './raster'
import type { LegacyManifest, LegacyReference, LegacyRegion } from './legacyAnalysis'
import type { LegacyPointSample } from './legacyComparison'

const BASE = '/data/cciss/legacy-analysis/'
// Cache bounded dataset resources across dialog openings. Failed loads can retry.
const cache = new Map<string, Promise<unknown>>()
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  if (!cache.has(key))
    cache.set(
      key,
      load().catch((error: unknown) => {
        cache.delete(key)
        throw error
      }),
    )
  return cache.get(key) as Promise<T>
}
export const loadLegacyManifest = () =>
  cached('manifest', async () => {
    const value = await fetchJson<LegacyManifest>(BASE + 'manifest.json')
    if (value.schema !== 'cciss-legacy-analysis-v1') throw new Error('Unsupported legacy dataset')
    return value
  })
export const loadLegacyReference = (file: string) => cached(file, () => fetchJson<LegacyReference>(BASE + file))
export const loadLegacyRegion = (file: string) => cached(file, () => fetchJson<LegacyRegion>(BASE + file))
export async function sampleLegacy(file: string, longitude: number, latitude: number) {
  const tiff = await cached(file, async () => {
    const { bytes } = await fetchBytes(BASE + file)
    return fromBlob(new Blob([bytes as BlobPart]))
  })
  return sampleCcissRaster(await tiff.getImage(), latitude, longitude)
}

/** Four readers bound the initial download/decode workload; TIFF promises are shared. */
export async function loadLegacyPoint(
  manifest: LegacyManifest,
  point: [number, number],
  progress: (done: number) => void,
) {
  const result: LegacyPointSample[] = new Array(manifest.rasters.length)
  let next = 0,
    done = 0
  await Promise.all(
    Array.from({ length: Math.min(4, manifest.rasters.length) }, async () => {
      while (next < manifest.rasters.length) {
        const i = next++
        const raster = manifest.rasters[i]
        result[i] = { ...raster, sample: await sampleLegacy(raster.file, ...point) }
        progress(++done)
      }
    }),
  )
  return result
}
