import type { Bounds, ElevationSource } from '@/pages/dev-forestry/terrain'
import { computeViewshed, viewshedBounds, type GeoPoint, type ViewshedResult, type ViewshedSettings } from './model'

export const MAX_ROAD_OBSERVERS = 32

export function combinedViewshedBounds(settings: ViewshedSettings, observers: readonly GeoPoint[]): Bounds {
  if (!observers.length || observers.length > MAX_ROAD_OBSERVERS) throw new Error('Choose 1–32 road viewpoints.')
  const boxes = observers.map((observer) => viewshedBounds({ ...settings, observer }))
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ]
}

/** Union on one fixed grid: a verified visible ray wins; missing rays never establish visibility. */
export function computeCombinedViewshed(
  source: ElevationSource,
  settings: ViewshedSettings,
  observers: readonly GeoPoint[],
  resolution: number,
  size: number,
  bounds = combinedViewshedBounds(settings, observers),
  onProgress?: (completed: number, total: number) => void,
  previous?: { result: ViewshedResult; observerCount: number },
): ViewshedResult {
  combinedViewshedBounds(settings, observers) // Validate the bounded observer budget even with an explicit footprint.
  if (settings.heightA !== settings.heightB) throw new Error('Combined road views use one observer height.')
  let merged = previous ? structuredClone(previous.result) : null
  for (let index = previous?.observerCount ?? 0; index < observers.length; index++) {
    const next = computeViewshed(source, { ...settings, observer: observers[index] }, resolution, size, false, {
      bounds,
      skipVisible: merged?.cells,
    })
    if (!merged) merged = next
    else
      for (let i = 0; i < merged.cells.length; i++) {
        const old = merged.cells[i],
          cell = next.cells[i]
        merged.cells[i] = old === 4 || cell === 4 ? 4 : old === 5 || cell === 5 ? 5 : old || cell
      }
    onProgress?.(index + 1, observers.length)
  }
  const result = merged!
  result.settings = settings
  result.counts = { total: 0, visibleA: 0, visibleB: 0, unknown: 0 }
  for (const cell of result.cells) {
    if (cell) result.counts.total++
    if (cell === 4) {
      result.counts.visibleA++
      result.counts.visibleB++
    }
    if (cell === 5) result.counts.unknown++
  }
  return result
}
