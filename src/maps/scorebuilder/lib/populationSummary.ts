import type { ScoredBoundaryRegion, ScoreMetricDefinition, ScoreMetricKey } from '../types'

export interface PopulationWeightedEquitySummary {
  demographicMetric: ScoreMetricKey
  environmentMetric: ScoreMetricKey
  demographicLabel: string
  environmentLabel: string
  totalPopulation: number
  priorityPopulation: number
  priorityShare: number
  priorityRegionCount: number
  narrative: string
}

export function computePopulationWeightedEquitySummary({
  regions,
  metrics,
  demographicMetric,
  environmentMetric,
}: {
  regions: ScoredBoundaryRegion[]
  metrics: ScoreMetricDefinition[]
  demographicMetric: ScoreMetricKey | null
  environmentMetric: ScoreMetricKey | null
}): PopulationWeightedEquitySummary | null {
  if (!demographicMetric || !environmentMetric || regions.length === 0) return null
  const demographicDefinition = metrics.find((metric) => metric.key === demographicMetric)
  const environmentDefinition = metrics.find((metric) => metric.key === environmentMetric)
  if (!demographicDefinition || !environmentDefinition) return null

  const totalPopulation = regions.reduce((sum, region) => sum + Math.max(0, region.counts.populationSum || 0), 0)
  if (totalPopulation <= 0) return null

  const healthyPlanPriorityRegions = regions.filter(
    (region) =>
      region.healthyPlanPriority?.demographicMetric === demographicMetric &&
      region.healthyPlanPriority.environmentMetric === environmentMetric &&
      region.healthyPlanPriority.equityPriority,
  )
  const priorityRegions = regions.filter((region) => {
    if (region.healthyPlanPriority) {
      return healthyPlanPriorityRegions.includes(region)
    }
    const vulnerability = region.normalizedMetrics[demographicMetric] ?? 0
    const normalizedEnvironment = region.normalizedMetrics[environmentMetric] ?? 0
    const environmentBenefit =
      environmentDefinition.direction === 'higherIsWorse' ? 1 - normalizedEnvironment : normalizedEnvironment
    return vulnerability >= 0.6 && environmentBenefit <= 0.4
  })
  const priorityPopulation = priorityRegions.reduce(
    (sum, region) => sum + Math.max(0, region.counts.populationSum || 0),
    0,
  )
  const priorityShare = priorityPopulation / totalPopulation
  const narrative = `${(priorityShare * 100).toFixed(1)}% of the mapped population lives in areas with high ${demographicDefinition.shortLabel.toLowerCase()} and low ${environmentDefinition.shortLabel.toLowerCase()}.`

  return {
    demographicMetric,
    environmentMetric,
    demographicLabel: demographicDefinition.label,
    environmentLabel: environmentDefinition.label,
    totalPopulation,
    priorityPopulation,
    priorityShare,
    priorityRegionCount: priorityRegions.length,
    narrative,
  }
}
