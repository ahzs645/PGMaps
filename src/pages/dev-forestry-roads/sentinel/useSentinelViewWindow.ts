import type { Map as MapLibreMap } from 'maplibre-gl'
import { useViewWindow } from '@/components/ui/map-view-window'
import {
  SENTINEL_MIN_ZOOM,
  SENTINEL_VIEW_EDGE_SHARE,
  SENTINEL_VIEW_GRID_DEG,
  SENTINEL_VIEW_OVERSCAN,
  SENTINEL_VIEW_SETTLE_MS,
  SENTINEL_VIEW_THROTTLE_MS,
} from '@/lib/sentinel2/limits'
import type { LonLatBounds } from '@/lib/sentinel2/stac'
import { viewPixelM } from '@/lib/sentinel2/window'

/** A window is reused only at the pixel size its view needs (10, 20, 40… m), never coarser. */
const sentinelLevel = (view: LonLatBounds) => viewPixelM(view) ?? 'outside'

/**
 * The Sentinel-2 read window: the shared view-window rule (`useViewWindow`) with the layer's own
 * overscan, edge, throttle, settle, grid and least zoom. It follows the map while it moves.
 */
export function useSentinelViewWindow(map: MapLibreMap | null, enabled: boolean) {
  return useViewWindow(map, {
    enabled,
    minZoom: SENTINEL_MIN_ZOOM,
    overscan: SENTINEL_VIEW_OVERSCAN,
    edgeShare: SENTINEL_VIEW_EDGE_SHARE,
    gridDeg: SENTINEL_VIEW_GRID_DEG,
    throttleMs: SENTINEL_VIEW_THROTTLE_MS,
    settleMs: SENTINEL_VIEW_SETTLE_MS,
    level: sentinelLevel,
  })
}
