import { hasCompleteCoverage } from './analysisResult'
import { alternativeCostStatus } from './alternativeCosts'
import type { RoadAnalysis } from './types'

/** Eligibility for a percentage change; a smaller covered subtotal is not an improvement. */
export function alternativeMetricComparison(
  base: RoadAnalysis,
  other: RoadAnalysis,
  metric: string,
  profiles?: { baseHasProfile: boolean; otherHasProfile: boolean },
): { comparable: boolean; reason: string | null } {
  const blocked = (reason: string) => ({ comparable: false, reason })
  if (!base.stations.length || !other.stations.length)
    return blocked('A baseline or alternative calculation is unavailable.')
  if (metric === 'cost' && (alternativeCostStatus(base) !== 'complete' || alternativeCostStatus(other) !== 'complete'))
    return blocked('Complete engineering quantities and a feasible material plan are required for a cost comparison.')
  if (
    (metric === 'earthworks' || metric === 'disturbance') &&
    (!hasCompleteCoverage(base) || !hasCompleteCoverage(other))
  )
    return blocked('Covered subtotals cannot be ranked against a road with incomplete sections.')
  if (metric === 'grade') {
    if (!profiles || profiles.baseHasProfile !== profiles.otherHasProfile)
      return blocked('Ground-following and independent formation grades use different bases.')
    if ([...base.stations, ...other.stations].some((s) => s.gradePercent === null || !Number.isFinite(s.gradePercent)))
      return blocked('Some longitudinal grades are unknown; the sampled maximum is incomplete.')
  }
  return { comparable: true, reason: null }
}
