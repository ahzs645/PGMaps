/**
 * The MI bands as the generated grid states them, for a legend that does not already hold the grid
 * (`walkabilityMiBands.ts` holds the bands and the rules; this file only fetches).
 */
import { useMemo } from 'react'
import { useFetchData } from '@/hooks/useFetchData'
import {
  WALKABILITY_HEATMAP_MANIFEST_PATH,
  WALKABILITY_MI_GRID_FALLBACK_PATH,
  resolveWalkabilityMiBands,
  type WalkabilityMiBand,
  type WalkabilityMiBandSource,
} from './walkabilityMiBands'

interface WalkabilityHeatmapManifest {
  citywideGrid?: { path?: string | null } | null
}

/**
 * Resolves MI bands for consumers that do not already hold the grid.
 *
 * Both fetches are served from `useFetchData`'s module cache once anything else
 * on the page has loaded them, so a legend costs no extra network work when the
 * raster is on screen.
 */
export function useWalkabilityMiBands(enabled = true): WalkabilityMiBand[] {
  const manifest = useFetchData<WalkabilityHeatmapManifest>(enabled ? WALKABILITY_HEATMAP_MANIFEST_PATH : null)
  const gridPath = manifest.data?.citywideGrid?.path || WALKABILITY_MI_GRID_FALLBACK_PATH
  const grid = useFetchData<WalkabilityMiBandSource>(enabled ? gridPath : null)
  return useMemo(() => resolveWalkabilityMiBands(grid.data), [grid.data])
}
