import { SCORE_METRICS } from '../constants'
import { MINIMUM_DATA_COVERAGE } from '../types'
import type { ScoreDataSource, ScoreFilterKey, ScoreMetricKey, ScoreMethodSettings } from '../types'

export const MAX_VISIBLE_REGION_ROWS = 220

export const SCORE_FILTER_DEFINITIONS: Array<{ key: ScoreFilterKey; label: string; description: string }> = [
  {
    key: 'requireCoverage',
    label: 'Require data coverage',
    description: `Exclude regions where fewer than ${Math.round(
      MINIMUM_DATA_COVERAGE * 100,
    )}% of the weighted metrics have real data.`,
  },
  {
    key: 'requirePopulation',
    label: 'Require population data',
    description: 'Exclude regions without census population assigned.',
  },
  {
    key: 'requireParks',
    label: 'Require parks or trails',
    description: 'Exclude regions with no parks, trails, or park amenities.',
  },
  {
    key: 'limitCrime',
    label: 'Lower crime pressure',
    description: 'Keep regions at or below the current median crime-per-capita value.',
  },
  {
    key: 'limitFoodRisk',
    label: 'Lower food-risk pressure',
    description: 'Keep regions at or below the current median food risk score.',
  },
]

export function formatNormalizationMethod(method: ScoreMethodSettings['normalization']): string {
  if (method === 'percentile') return 'percentile rank'
  if (method === 'winsorizedMinMax') return 'winsorized min-max'
  if (method === 'zScore') return 'z-score'
  return 'min-max'
}

export function formatAggregationMethod(method: ScoreMethodSettings['aggregation']): string {
  if (method === 'bcEnviroScreenProduct') return 'BC EnviroScreen percentile product'
  if (method === 'healthyPlanPairwisePriority') return 'HealthyPlan-style pairwise priority'
  if (method === 'modulePercentileRankedSum') return 'EJI-style module ranked sum'
  if (method === 'accessThreshold') return 'access threshold'
  if (method === 'cumulativeBurden') return 'cumulative burden'
  if (method === 'geometric') return 'geometric mean'
  return 'weighted average'
}

export function isHealthyPlanDemographicMetric(metric: (typeof SCORE_METRICS)[number]): boolean {
  return metric.component === 'sensitivity' || metric.category === 'demographics' || metric.category === 'deprivation'
}

export function isHealthyPlanEnvironmentMetric(metric: (typeof SCORE_METRICS)[number]): boolean {
  return (
    metric.component === 'environmentalBurden' ||
    metric.component === 'serviceAccess' ||
    metric.component === 'adaptiveCapacity' ||
    metric.category === 'airQuality' ||
    metric.category === 'parksRec' ||
    metric.category === 'heatShade' ||
    metric.category === 'transit' ||
    metric.category === 'walkability'
  )
}

export function getDataSourceLabel(source: ScoreDataSource): string {
  if (source === 'airQuality') return 'Air'
  if (source === 'parks') return 'Parks'
  if (source === 'heatShade') return 'Heat/Shade'
  if (source === 'restaurants') return 'Food'
  if (source === 'census') return 'Census'
  if (source === 'bcAssessment') return 'Property'
  if (source === 'crime') return 'Crime'
  if (source === 'transit') return 'Transit'
  if (source === 'walkability') return 'Walk'
  if (source === 'healthyPlanPg') return 'HealthyPlan PG'
  return source
}

export function clampWeight(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)))
}

export function getDefaultMetricWeight(metric: ScoreMetricKey): number {
  if (
    metric === 'foodRiskScore' ||
    metric === 'criticalViolationRate' ||
    metric === 'followUpRate' ||
    metric === 'buildingAge' ||
    metric === 'crimeDensity' ||
    metric === 'crimePerCapita' ||
    metric === 'recentCrimeShare'
  ) {
    return -35
  }
  return 35
}

export function getWeightIntent(value: number): string {
  if (value === 0) return 'Disabled'
  return value > 0 ? 'Prefer high' : 'Prefer low'
}

export function getCategoryTone(category: string): string {
  if (category === 'airQuality') return 'bg-sky-500'
  if (category === 'parksRec') return 'bg-emerald-500'
  if (category === 'heatShade') return 'bg-lime-600'
  if (category === 'foodSafety') return 'bg-orange-500'
  if (category === 'demographics') return 'bg-amber-500'
  if (category === 'property') return 'bg-violet-500'
  if (category === 'safety') return 'bg-rose-500'
  if (category === 'transit') return 'bg-teal-500'
  if (category === 'walkability') return 'bg-emerald-600'
  return 'bg-cyan-500'
}
