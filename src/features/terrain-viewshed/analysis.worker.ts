import { ViewshedResultCache } from './resultCache'
import { loadElevationGrid } from '@/pages/dev-forestry/demLoader'
import { demResolutionMeters, demTileRange, type ElevationGrid } from '@/pages/dev-forestry/terrain'
import { computeViewshed, viewshedBounds, type ViewshedSettings } from './model'

const results = new ViewshedResultCache()
let lastRetry = 0
let cached: { grid: ElevationGrid; missingTileCount: number } | null = null
let controller: AbortController | null = null

self.onmessage = async (
  event: MessageEvent<{
    requestId: number
    settings: ViewshedSettings
    preview?: boolean
    retry?: number
    horizon?: boolean
    detailSize?: number
    demZoom?: number
  }>,
) => {
  controller?.abort()
  const active = new AbortController()
  controller = active
  const { requestId, settings, preview, retry = 0, horizon = true, detailSize = 192, demZoom = 13 } = event.data
  try {
    const refresh = retry !== lastRetry
    if (refresh) {
      results.clear()
      cached = null
      lastRetry = retry
    }
    const resultKey = JSON.stringify([settings, preview, horizon, detailSize, demZoom])
    const hit = results.get(resultKey)
    if (hit) {
      self.postMessage(
        { type: 'result', requestId, result: hit, cacheHit: true },
        { transfer: [hit.cells.buffer, hit.horizonA.buffer, hit.horizonB.buffer, hit.horizonUnknown.buffer] },
      )
      return
    }
    const bounds = viewshedBounds(settings)
    let zoom = Math.max(6, Math.min(14, demZoom))
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
        refresh,
        signal: active.signal,
        onProgress: (completed, total) => self.postMessage({ type: 'progress', requestId, completed, total }),
      })
    }
    if (active.signal.aborted || !cached) return
    const result = computeViewshed(
      cached.grid,
      settings,
      demResolutionMeters(settings.observer.lat, zoom),
      preview ? 64 : Math.max(16, Math.min(192, detailSize)),
      !preview && horizon,
    )
    result.missingTileCount = cached.missingTileCount
    results.put(resultKey, result)
    self.postMessage(
      { type: 'result', requestId, result },
      { transfer: [result.cells.buffer, result.horizonA.buffer, result.horizonB.buffer, result.horizonUnknown.buffer] },
    )
  } catch (error) {
    if (!active.signal.aborted)
      self.postMessage({ type: 'error', requestId, message: error instanceof Error ? error.message : String(error) })
  }
}
