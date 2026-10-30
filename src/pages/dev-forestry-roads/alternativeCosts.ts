import { hasCompleteCoverage } from './analysisResult'
import type { RoadAnalysis } from './types'

/** Quantity coverage does not establish that a material prescription can actually be supplied. */
export function alternativeCostStatus(
  analysis: RoadAnalysis,
): 'complete' | 'infeasible' | 'incomplete' | 'unavailable' {
  if (!analysis.stations.length) return 'unavailable'
  if (analysis.engineering?.haul.optimizationStatus === 'infeasible') return 'infeasible'
  if (!hasCompleteCoverage(analysis) || analysis.engineering?.complete === false) return 'incomplete'
  return 'complete'
}
export const alternativeCostLabel = (analysis: RoadAnalysis) => {
  const status = alternativeCostStatus(analysis)
  return status === 'complete'
    ? null
    : status === 'infeasible'
      ? 'Material plan infeasible'
      : status === 'incomplete'
        ? 'Incomplete cost'
        : 'Unavailable'
}
