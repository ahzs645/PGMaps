import { SENTINEL_MIN_ZOOM, SENTINEL_VIEW_GRID_DEG } from './limits'
import type { LonLatBounds } from './stac'

/** A bounded, repeatable window over the current view, independent of the project's terrain. */
export function sentinelViewBounds(bounds: LonLatBounds, zoom: number): LonLatBounds | null {
  if (!Number.isFinite(zoom) || zoom < SENTINEL_MIN_ZOOM || !bounds.every(Number.isFinite)) return null
  const [west, south, east, north] = bounds
  if (west >= east || south >= north || west < -180 || east > 180 || south < -85 || north > 85) return null
  const grid = SENTINEL_VIEW_GRID_DEG
  return [
    Math.floor(west / grid) * grid,
    Math.floor(south / grid) * grid,
    Math.ceil(east / grid) * grid,
    Math.ceil(north / grid) * grid,
  ].map((v) => Number(v.toFixed(6))) as LonLatBounds
}
