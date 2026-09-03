import type { ScoreMetricDefinition, ScoreMetricKey, ScoreMetricWeightMap } from '../types'

export const BC_ENVIRO_SCREEN_METRIC_PREFIX = 'bcEnviroScreen.'

export type BcEnviroScreenComponent =
  | 'exposures'
  | 'environmentalEffects'
  | 'sensitivePopulations'
  | 'socioeconomicFactors'

type IndicatorSeed = {
  key: string
  label: string
  component: BcEnviroScreenComponent
  format?: ScoreMetricDefinition['format']
  freshness: string
  caveat?: string
}

const SEEDS: IndicatorSeed[] = [
  {
    key: 'future_precipitation',
    label: 'Future precipitation change',
    component: 'exposures',
    format: 'rawPercent',
    freshness: 'Paper-vintage benchmark',
    caveat: 'Benchmark-derived gap pending an independent province-wide Plan2Adapt recomputation.',
  },
  {
    key: 'future_temperature',
    label: 'Future temperature change',
    component: 'exposures',
    freshness: 'Paper-vintage benchmark',
    caveat: 'Benchmark-derived gap pending an independent province-wide Plan2Adapt recomputation.',
  },
  { key: 'ozone', label: 'Ozone', component: 'exposures', freshness: 'Reconstructed source vintage' },
  { key: 'pm25', label: 'PM2.5', component: 'exposures', freshness: 'Reconstructed source vintage' },
  {
    key: 'traffic_density',
    label: 'Traffic density',
    component: 'exposures',
    freshness: '2018 MoTI proxy',
    caveat: 'Traffic Data Program reconstruction is a proxy for the paper input.',
  },
  {
    key: 'water_quality_exceedances',
    label: 'Water-quality exceedances',
    component: 'exposures',
    format: 'rawPercent',
    freshness: '2016-2019 reconstruction',
  },
  {
    key: 'disturbed_landscape',
    label: 'Disturbed landscape',
    component: 'environmentalEffects',
    format: 'rawPercent',
    freshness: 'Reconstructed source vintage',
  },
  {
    key: 'industrial_sites',
    label: 'Industrial sites',
    component: 'environmentalEffects',
    freshness: 'Current-source proxy',
  },
  {
    key: 'linear_footprint',
    label: 'Linear footprint',
    component: 'environmentalEffects',
    freshness: 'Reconstructed source vintage',
  },
  {
    key: 'remediation_sites',
    label: 'Remediation sites',
    component: 'environmentalEffects',
    freshness: 'Paper-era proxy',
  },
  {
    key: 'wildfire_burn_area',
    label: 'Wildfire burn area',
    component: 'environmentalEffects',
    format: 'rawPercent',
    freshness: '2010-2019',
  },
  {
    key: 'all_causes_of_cancer',
    label: 'All causes of cancer',
    component: 'sensitivePopulations',
    freshness: 'PHSA reconstructed source',
  },
  { key: 'copd', label: 'COPD', component: 'sensitivePopulations', freshness: 'PHSA reconstructed source' },
  {
    key: 'diabetes_mellitus',
    label: 'Diabetes mellitus',
    component: 'sensitivePopulations',
    freshness: 'PHSA reconstructed source',
  },
  {
    key: 'hypertension',
    label: 'Hypertension incidence',
    component: 'sensitivePopulations',
    freshness: 'FY2015/16 CDR2022 total population',
    caveat: 'Complete current-vintage proxy; the independently recovered paper-era archive covers 72 of 89 LHAs.',
  },
  {
    key: 'low_birth_weight',
    label: 'Low birth weight',
    component: 'sensitivePopulations',
    freshness: 'PHSA reconstructed source',
  },
  {
    key: 'employment_insurance_beneficiaries',
    label: 'Employment insurance beneficiaries',
    component: 'socioeconomicFactors',
    format: 'rawPercent',
    freshness: 'Statistics Canada proxy',
  },
  {
    key: 'housing_burdened_renters',
    label: 'Housing-burdened renters',
    component: 'socioeconomicFactors',
    format: 'rawPercent',
    freshness: '2016 Census',
  },
  {
    key: 'linguistic_isolation',
    label: 'Linguistic isolation',
    component: 'socioeconomicFactors',
    format: 'rawPercent',
    freshness: '2016 Census',
  },
  {
    key: 'low_education',
    label: 'Low education',
    component: 'socioeconomicFactors',
    format: 'rawPercent',
    freshness: '2016 Census',
  },
  {
    key: 'low_income',
    label: 'Low income',
    component: 'socioeconomicFactors',
    format: 'rawPercent',
    freshness: '2016 Census',
  },
]

const GENERIC_COMPONENT: Record<BcEnviroScreenComponent, ScoreMetricDefinition['component']> = {
  exposures: 'bcEnviroScreenExposures',
  environmentalEffects: 'bcEnviroScreenEnvironmentalEffects',
  sensitivePopulations: 'bcEnviroScreenSensitivePopulations',
  socioeconomicFactors: 'bcEnviroScreenSocioeconomicFactors',
}

export const BC_ENVIRO_SCREEN_METRICS: ScoreMetricDefinition[] = SEEDS.map((seed) => ({
  key: `${BC_ENVIRO_SCREEN_METRIC_PREFIX}${seed.key}`,
  label: seed.label,
  shortLabel: seed.label,
  description: `${seed.label} raw LHA value used by the BC EnviroScreen Reconstruction.`,
  format: seed.format ?? 'count',
  category: 'bcEnviroScreen',
  direction: 'higherIsWorse',
  component: GENERIC_COMPONENT[seed.component],
  bcEnviroScreenComponent: seed.component,
  dataSourceLabel: 'BC EnviroScreen Reconstruction release',
  spatialMethod: 'directBoundaryJoin',
  uncertainty: seed.caveat ? 'high' : 'medium',
  caveat: seed.caveat,
  directionLabel: 'higher means greater burden',
  sourceUrl: 'https://data.map.ahmad.sh/environmental-burden/bc-enviro-screen/latest.json',
  freshnessLabel: seed.freshness,
  comparisonBasis: 'Provincial percentile among all 89 BC Local Health Areas',
  valueBehavior: 'continuous',
  missingDataPolicy: 'excludeRegion',
  proxyLevel: 'proxy',
  boundarySources: ['bcHealth'],
  boundaryRequirementLabel: 'Available only for BC Ministry of Health Local Health Areas.',
}))

export const BC_ENVIRO_SCREEN_METRIC_KEYS = BC_ENVIRO_SCREEN_METRICS.map((metric) => metric.key)

export function createBcEnviroScreenWeights(): ScoreMetricWeightMap {
  return Object.fromEntries(BC_ENVIRO_SCREEN_METRIC_KEYS.map((key) => [key, 1])) as ScoreMetricWeightMap
}

export function bcEnviroScreenIndicatorKey(metricKey: ScoreMetricKey): string | null {
  return metricKey.startsWith(BC_ENVIRO_SCREEN_METRIC_PREFIX)
    ? metricKey.slice(BC_ENVIRO_SCREEN_METRIC_PREFIX.length)
    : null
}
