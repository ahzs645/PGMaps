import { useMemo } from 'react'
import { buildQueenContiguity, weightsForValues, type ContiguityGraph } from '../lib/spatialWeights'
import { summariseSpatialPattern, type SpatialPatternSummary } from '../lib/spatialAutocorrelation'
import type { ScoreBuilderRegion } from '../types'

// One graph per loaded region list: the boundaries change only with the study area, while
// the values change with every metric or weight.
const graphCache = new WeakMap<readonly ScoreBuilderRegion[], ContiguityGraph>()

function contiguityFor(regions: readonly ScoreBuilderRegion[]): ContiguityGraph {
  let graph = graphCache.get(regions)
  if (!graph) {
    graph = buildQueenContiguity(regions.map((region) => ({ id: region.id, geometry: region.feature.geometry })))
    graphCache.set(regions, graph)
  }
  return graph
}

export interface SpatialObservation {
  id: string
  value: number
}

/**
 * Moran's I for one variable over the study area's regions. Runs only while `enabled`,
 * once per change of regions, observations or options; never inside the scoring passes.
 * `local` adds the LISA clusters, which cost the most, so the residual check leaves it off.
 */
export function useSpatialPattern({
  regions,
  observations,
  enabled,
  local,
  fdr,
}: {
  regions: readonly ScoreBuilderRegion[]
  /** Memoise these: a new array is a new run. */
  observations: readonly SpatialObservation[] | null
  enabled: boolean
  local: boolean
  fdr: boolean
}): SpatialPatternSummary | null {
  return useMemo(() => {
    if (!enabled || !observations || regions.length < 4) return null
    const weights = weightsForValues(contiguityFor(regions), observations)
    return summariseSpatialPattern(weights, { local, fdr })
  }, [enabled, fdr, local, observations, regions])
}
