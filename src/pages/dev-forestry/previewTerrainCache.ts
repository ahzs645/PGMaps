import { loadElevationGrid, type LoadElevationGridOptions, type LoadElevationGridResult } from './demLoader'
import { renderedGroundSource } from './terrain'

/** Two fixed mosaics, at most 128 tiles each (~64 MB total). Reuse decoded
 * elevations, not rendered LOD samples, so reopening cannot move the ground. */
export function createPreviewTerrainLoader(load: (options: LoadElevationGridOptions) => Promise<LoadElevationGridResult> = loadElevationGrid) {
  const cache = new Map<string, { source: ReturnType<typeof renderedGroundSource> | null; missingTileCount: number; time: number }>()
  return async (options: LoadElevationGridOptions, retry = false) => {
    if (options.signal?.aborted) throw new DOMException('Terrain loading cancelled', 'AbortError')
    const key = JSON.stringify([options.tileUrlTemplate, options.range])
    if (retry) cache.delete(key)
    const cached = cache.get(key)
    if (cached && (!cached.missingTileCount || Date.now() - cached.time < 30000)) {
      cache.delete(key)
      cache.set(key, cached)
      options.onProgress?.(options.range.tileCount, options.range.tileCount)
      return cached
    }
    const { grid, missingTileCount } = await load(options)
    if (options.signal?.aborted) throw new DOMException('Terrain loading cancelled', 'AbortError')
    const entry = { source: missingTileCount === options.range.tileCount ? null : renderedGroundSource(grid), missingTileCount, time: Date.now() }
    cache.set(key, entry)
    while (cache.size > 2) cache.delete(cache.keys().next().value!)
    return entry
  }
}
export const loadPreviewTerrain = createPreviewTerrainLoader()
