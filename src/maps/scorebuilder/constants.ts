import type { BoundaryIndex, BoundaryLevel, BoundarySource, CensusBoundaryLevel } from '@/maps/airquality'
import type { ScoreMetricDefinition, ScoreMetricKey, ScoreMetricWeightMap, ScorePreset } from './types'

export const SCORE_METRICS: ScoreMetricDefinition[] = [
  // Air Quality
  {
    key: 'overallDensity',
    label: 'Overall Sensor Density',
    shortLabel: 'Overall density',
    description: 'Total sensors per km² inside each boundary.',
    format: 'density',
    category: 'airQuality'
  },
  {
    key: 'lowCostDensity',
    label: 'Low-Cost Sensor Density',
    shortLabel: 'Low-cost density',
    description: 'Low-cost network sensors (PA + EGG) per km².',
    format: 'density',
    category: 'airQuality'
  },
  {
    key: 'referenceDensity',
    label: 'Reference Sensor Density',
    shortLabel: 'Reference density',
    description: 'Regulatory and non-low-cost sensors per km².',
    format: 'density',
    category: 'airQuality'
  },
  {
    key: 'networkVariety',
    label: 'Network Variety',
    shortLabel: 'Network variety',
    description: 'Unique monitoring networks represented in a boundary.',
    format: 'count',
    category: 'airQuality'
  },
  {
    key: 'parameterVariety',
    label: 'Parameter Variety',
    shortLabel: 'Parameter variety',
    description: 'Unique parameter labels observed among sensors.',
    format: 'count',
    category: 'airQuality'
  },
  {
    key: 'activeShare',
    label: 'Active Sensor Share',
    shortLabel: 'Active share',
    description: 'Share of in-boundary sensors marked active.',
    format: 'ratio',
    category: 'airQuality'
  },
  {
    key: 'monitorCount',
    label: 'Raw Sensor Count',
    shortLabel: 'Sensor count',
    description: 'Absolute number of sensors in each boundary.',
    format: 'count',
    category: 'airQuality'
  },
  // Parks & Recreation
  {
    key: 'parkDensity',
    label: 'Park Density',
    shortLabel: 'Park density',
    description: 'Number of parks per km² in each boundary.',
    format: 'density',
    category: 'parksRec'
  },
  {
    key: 'parkAreaRatio',
    label: 'Park Area Ratio',
    shortLabel: 'Park area %',
    description: 'Percentage of boundary area covered by parks.',
    format: 'percent',
    category: 'parksRec'
  },
  {
    key: 'trailDensity',
    label: 'Trail Density',
    shortLabel: 'Trail density',
    description: 'Trail km per km² in each boundary.',
    format: 'density',
    category: 'parksRec'
  },
  {
    key: 'amenityDensity',
    label: 'Amenity Density',
    shortLabel: 'Amenity density',
    description: 'Park amenities per km² in each boundary.',
    format: 'density',
    category: 'parksRec'
  },
  // Food Safety
  {
    key: 'restaurantDensity',
    label: 'Restaurant Density',
    shortLabel: 'Restaurant density',
    description: 'Restaurants per km² in each boundary.',
    format: 'density',
    category: 'foodSafety'
  },
  {
    key: 'foodRiskScore',
    label: 'Food Risk Score',
    shortLabel: 'Food risk',
    description: 'Average hazard level of food facilities (0=Low, 1=High).',
    format: 'ratio',
    category: 'foodSafety'
  },
  // Demographics
  {
    key: 'populationDensity',
    label: 'Population Density',
    shortLabel: 'Pop. density',
    description: 'Census population per km² from overlapping DAs.',
    format: 'density',
    category: 'demographics'
  }
]

export const SCORE_METRICS_BY_CATEGORY = SCORE_METRICS.reduce((acc, metric) => {
  if (!acc[metric.category]) acc[metric.category] = []
  acc[metric.category].push(metric)
  return acc
}, {} as Record<string, ScoreMetricDefinition[]>)

const ZERO_WEIGHTS: ScoreMetricWeightMap = {
  overallDensity: 0,
  lowCostDensity: 0,
  referenceDensity: 0,
  networkVariety: 0,
  parameterVariety: 0,
  activeShare: 0,
  monitorCount: 0,
  parkDensity: 0,
  parkAreaRatio: 0,
  trailDensity: 0,
  amenityDensity: 0,
  restaurantDensity: 0,
  foodRiskScore: 0,
  populationDensity: 0
}

export const DEFAULT_SCORE_WEIGHTS: ScoreMetricWeightMap = {
  ...ZERO_WEIGHTS,
  overallDensity: 45,
  lowCostDensity: 15,
  referenceDensity: 25,
  networkVariety: 8,
  parameterVariety: 4,
  activeShare: 3
}

export const SCORE_PRESETS: ScorePreset[] = [
  {
    key: 'balancedCoverage',
    label: 'Balanced Coverage',
    description: 'Mix density with network and parameter variety.',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 40,
      lowCostDensity: 18,
      referenceDensity: 24,
      networkVariety: 10,
      parameterVariety: 5,
      activeShare: 3
    }
  },
  {
    key: 'lowCostExpansion',
    label: 'Low-Cost Expansion',
    description: 'Prioritize community low-cost deployment patterns.',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 18,
      lowCostDensity: 45,
      referenceDensity: 8,
      networkVariety: 12,
      parameterVariety: 7,
      activeShare: 10
    }
  },
  {
    key: 'referenceNetwork',
    label: 'Reference Strength',
    description: 'Emphasize reference stations and reliability.',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 20,
      lowCostDensity: 5,
      referenceDensity: 45,
      networkVariety: 8,
      parameterVariety: 5,
      activeShare: 12,
      monitorCount: 5
    }
  },
  {
    key: 'livabilityIndex',
    label: 'Livability Index',
    description: 'Holistic livability: parks, food access, and population.',
    weights: {
      ...ZERO_WEIGHTS,
      parkDensity: 20,
      parkAreaRatio: 18,
      trailDensity: 12,
      amenityDensity: 8,
      restaurantDensity: 12,
      foodRiskScore: -15,
      populationDensity: 10,
      overallDensity: 8,
      activeShare: 7
    }
  },
  {
    key: 'environmentalHealth',
    label: 'Environmental Health',
    description: 'Air quality coverage combined with green space access.',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 18,
      lowCostDensity: 10,
      activeShare: 8,
      parkAreaRatio: 22,
      parkDensity: 14,
      trailDensity: 10,
      amenityDensity: 5,
      populationDensity: 8,
      networkVariety: 5
    }
  }
]

export const DENSITY_METRIC_OPTIONS: ScoreMetricKey[] = [
  'overallDensity',
  'lowCostDensity',
  'referenceDensity',
  'monitorCount',
  'parkDensity',
  'trailDensity',
  'amenityDensity',
  'restaurantDensity',
  'populationDensity'
]

export const LOW_COST_NETWORKS = new Set(['PA', 'EGG'])

export const BOUNDARY_SOURCE_OPTIONS: Array<{
  value: BoundarySource
  label: string
  description: string
}> = [
  {
    value: 'bcHealth',
    label: 'Health Authority boundaries',
    description: 'Health Authority -> HSDA -> LHA -> CHSA'
  },
  {
    value: 'census',
    label: 'Census boundaries',
    description: 'Census Division -> CSD -> CT -> DA'
  }
]

export const HEALTH_BOUNDARY_LEVEL_OPTIONS: Array<{ value: BoundaryLevel; label: string }> = [
  { value: 'healthAuthority', label: 'Health Authority' },
  { value: 'hsda', label: 'HSDA' },
  { value: 'lha', label: 'LHA' },
  { value: 'chsa', label: 'CHSA' }
]

// Backward-compatible alias used by existing imports.
export const BOUNDARY_LEVEL_OPTIONS = HEALTH_BOUNDARY_LEVEL_OPTIONS

export const CENSUS_BOUNDARY_LEVEL_OPTIONS: Array<{ value: CensusBoundaryLevel; label: string }> = [
  { value: 'cd', label: 'Census Division' },
  { value: 'csd', label: 'Census Subdivision' },
  { value: 'ct', label: 'Census Tract' },
  { value: 'da', label: 'Dissemination Area' }
]

export const BOUNDARY_FILE_BY_LEVEL: Record<BoundaryLevel, string> = {
  healthAuthority: 'simplified/health_authorities.json',
  hsda: 'simplified/health_service_delivery_areas.json',
  lha: 'simplified/local_health_areas.json',
  chsa: 'simplified/community_health_service_areas.json'
}

export const BOUNDARY_INDEX_KEY_BY_LEVEL: Record<BoundaryLevel, keyof BoundaryIndex> = {
  healthAuthority: 'healthAuthorities',
  hsda: 'healthServiceDeliveryAreas',
  lha: 'localHealthAreas',
  chsa: 'communityHealthServiceAreas'
}

export const BOUNDARY_CODE_PROPERTY_BY_LEVEL: Record<BoundaryLevel, string> = {
  healthAuthority: 'HLTH_AUTHORITY_CODE',
  hsda: 'HLTH_SERVICE_DLVR_AREA_CODE',
  lha: 'LOCAL_HLTH_AREA_CODE',
  chsa: 'CMNTY_HLTH_SERV_AREA_CODE'
}

export const BOUNDARY_NAME_PROPERTY_BY_LEVEL: Record<BoundaryLevel, string> = {
  healthAuthority: 'HLTH_AUTHORITY_NAME',
  hsda: 'HLTH_SERVICE_DLVR_AREA_NAME',
  lha: 'LOCAL_HLTH_AREA_NAME',
  chsa: 'CMNTY_HLTH_SERV_AREA_NAME'
}

export function createDefaultWeights(): ScoreMetricWeightMap {
  return { ...DEFAULT_SCORE_WEIGHTS }
}

export function createMetricValueMap(initial = 0): Record<ScoreMetricKey, number> {
  return {
    overallDensity: initial,
    lowCostDensity: initial,
    referenceDensity: initial,
    networkVariety: initial,
    parameterVariety: initial,
    activeShare: initial,
    monitorCount: initial,
    parkDensity: initial,
    parkAreaRatio: initial,
    trailDensity: initial,
    amenityDensity: initial,
    restaurantDensity: initial,
    foodRiskScore: initial,
    populationDensity: initial
  }
}

export function getScoreColor(score: number): string {
  if (score >= 90) return '#14532d'
  if (score >= 80) return '#166534'
  if (score >= 70) return '#3f6212'
  if (score >= 60) return '#4d7c0f'
  if (score >= 50) return '#a16207'
  if (score >= 40) return '#b45309'
  if (score >= 30) return '#c2410c'
  if (score >= 20) return '#b91c1c'
  return '#7f1d1d'
}

export function encodeWeightsToParams(weights: ScoreMetricWeightMap): string {
  return SCORE_METRICS.map((m) => weights[m.key]).join(',')
}

export function decodeWeightsFromParams(param: string): ScoreMetricWeightMap | null {
  const parts = param.split(',').map(Number)
  if (parts.length !== SCORE_METRICS.length || parts.some((v) => !Number.isFinite(v))) return null
  const weights = createMetricValueMap(0) as ScoreMetricWeightMap
  SCORE_METRICS.forEach((m, i) => {
    weights[m.key] = Math.max(-100, Math.min(100, Math.round(parts[i])))
  })
  return weights
}
