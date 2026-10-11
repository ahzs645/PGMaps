import { loadElevationGrid } from '../dev-forestry/demLoader'
import { demResolutionMeters, demTileRange, type ElevationGrid } from '../dev-forestry/terrain'
import { computeViewshed, viewshedBounds, type ViewshedSettings } from './model'

let cached: { grid: ElevationGrid; missingTileCount: number } | null = null
let controller: AbortController | null = null

self.onmessage = async (event: MessageEvent<{ requestId: number; settings: ViewshedSettings; preview?: boolean }>) => {
  controller?.abort()
  const active = new AbortController()
  controller = active
  const { requestId, settings, preview } = event.data
  try {
    const bounds = viewshedBounds(settings)
    let zoom = 13
    const padding = Math.max(500, settings.radiusMeters * 0.5)
    let range = demTileRange(bounds, zoom, padding)
    while (range.tileCount > 64 && zoom > 6) range = demTileRange(bounds, --zoom, padding)
    const required = demTileRange(bounds, zoom, 250)
    const old = cached?.grid.range
    if (
      !old ||
      old.zoom !== zoom ||
      old.minX > required.minX ||
      old.maxX < required.maxX ||
      old.minY > required.minY ||
      old.maxY < required.maxY ||
      cached?.missingTileCount
    ) {
      cached = await loadElevationGrid({
        range,
        signal: active.signal,
        onProgress: (completed, total) => self.postMessage({ type: 'progress', requestId, completed, total }),
      })
    }
    if (active.signal.aborted || !cached) return
    const result = computeViewshed(
      cached.grid,
      settings,
      demResolutionMeters(settings.observer.lat, zoom),
      preview ? 64 : undefined,
      !preview,
    )
    result.missingTileCount = cached.missingTileCount
    self.postMessage(
      { type: 'result', requestId, result },
      { transfer: [result.cells.buffer, result.horizonA.buffer, result.horizonB.buffer, result.horizonUnknown.buffer] },
    )
  } catch (error) {
    if (!active.signal.aborted)
      self.postMessage({ type: 'error', requestId, message: error instanceof Error ? error.message : String(error) })
  }
}
