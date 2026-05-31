import type { ScoreMetricKey, ScoreMethodSettings } from '../types'

export const PERCENTILE_METHOD: Partial<ScoreMethodSettings> = { normalization: 'percentile', aggregation: 'additive' }
export const WINSORIZED_METHOD: Partial<ScoreMethodSettings> = {
  normalization: 'winsorizedMinMax',
  aggregation: 'additive',
}
export const Z_SCORE_METHOD: Partial<ScoreMethodSettings> = { normalization: 'zScore', aggregation: 'additive' }
export const CUMULATIVE_BURDEN_METHOD: Partial<ScoreMethodSettings> = {
  normalization: 'percentile',
  aggregation: 'cumulativeBurden',
}
export const MODULE_PERCENTILE_METHOD: Partial<ScoreMethodSettings> = {
  normalization: 'percentile',
  aggregation: 'modulePercentileRankedSum',
}
export const ACCESS_THRESHOLD_METHOD: Partial<ScoreMethodSettings> = {
  normalization: 'percentile',
  aggregation: 'accessThreshold',
  accessThreshold: {
    minimumAccess: 0.5,
    minimumHits: 4,
  },
}
export const HEALTHYPLAN_PAIRWISE_METHOD = (
  demographicMetric: ScoreMetricKey,
  environmentMetric: ScoreMetricKey,
): Partial<ScoreMethodSettings> => ({
  normalization: 'percentile',
  aggregation: 'healthyPlanPairwisePriority',
  healthyPlanPriority: {
    demographicMetric,
    environmentMetric,
  },
})

export const HEALTHYPLAN_PAIRWISE_PRESETS: Array<{
  key: string
  label: string
  description: string
  demographicMetric: ScoreMetricKey
  environmentMetric: ScoreMetricKey
}> = [
  {
    key: 'lowIncomeCanopy',
    label: 'CIMD vulnerability x canopy',
    description: 'Find higher-vulnerability areas with lower canopy benefit.',
    demographicMetric: 'cimdComposite',
    environmentMetric: 'canopyProxyRatio',
  },
  {
    key: 'seniorsCoolingProxy',
    label: 'Situational vulnerability x cooling',
    description: 'Find areas with higher vulnerability and weaker walking access to cooling/community facilities.',
    demographicMetric: 'cimdSituationalVulnerability',
    environmentMetric: 'coolingWalk15Access',
  },
  {
    key: 'economicParkAccess',
    label: 'Economic dependency x parks',
    description: 'Find economically vulnerable areas with weaker 10-minute park access.',
    demographicMetric: 'cimdEconomicDependency',
    environmentMetric: 'parkWalk10Access',
  },
  {
    key: 'instabilityTransitAccess',
    label: 'Residential instability x transit',
    description: 'Find higher-instability areas with weaker accessible frequent transit access.',
    demographicMetric: 'cimdResidentialInstability',
    environmentMetric: 'accessibleFrequentTransitAccess',
  },
  {
    key: 'densityServiceAccess',
    label: 'Population density x services',
    description: 'Find more populated areas with lower composite access to nearby services.',
    demographicMetric: 'populationDensity',
    environmentMetric: 'serviceAccessComposite',
  },
]
