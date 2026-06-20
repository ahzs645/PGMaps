import { useMemo } from 'react'
import { useJsonManifest } from '@/maps/pgdata/shared'
import { zonalMeanMiByRegion, type RegionMiSummary, type WalkabilityMiGrid } from '../lib/walkabilityZonal'
import type { ScoreBuilderRegion } from '../types'

const CITYWIDE_MI_GRID_PATH = '/data/walkability/heatmap/citywide_mi_grid.json'
const EMPTY = new Map<string, RegionMiSummary>()

/**
 * Loads the citywide MI raster (only when `enabled`) and aggregates it into the
 * active regions. The zonal computation is memoized on the grid + regions so it
 * runs once per boundary change, and stays off entirely unless the MI-surface
 * metric is actually in use.
 */
export function useWalkabilityMiZonal(
  enabled: boolean,
  regions: ScoreBuilderRegion[],
): Map<string, RegionMiSummary> {
  const grid = useJsonManifest<WalkabilityMiGrid>(enabled ? CITYWIDE_MI_GRID_PATH : null)

  return useMemo(() => {
    if (!enabled || !grid.data || regions.length === 0) return EMPTY
    return zonalMeanMiByRegion(grid.data, regions)
  }, [enabled, grid.data, regions])
}
