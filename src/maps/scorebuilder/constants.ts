import type { BoundaryIndex, BoundaryLevel, BoundarySource, CensusBoundaryLevel } from '@/maps/airquality'
import type { ScoreMetricDefinition, ScoreMetricKey, ScoreMetricWeightMap, ScorePreset } from './types'

export const SCORE_METRICS: ScoreMetricDefinition[] = [
  {
    key: 'overallDensity',
    label: 'Overall Sensor Density',
    shortLabel: 'Overall density',
    description: 'Total sensors per km² inside each boundary.',
    format: 'density'
  },
  {
    key: 'lowCostDensity',
    label: 'Low-Cost Sensor Density',
    shortLabel: 'Low-cost density',
    description: 'Low-cost network sensors (PA + EGG) per km².',
    format: 'density'
  },
  {
    key: 'referenceDensity',
    label: 'Reference Sensor Density',
    shortLabel: 'Reference density',
    description: 'Regulatory and non-low-cost sensors per km².',
    format: 'density'
  },
  {
    key: 'networkVariety',
    label: 'Network Variety',
    shortLabel: 'Network variety',
    description: 'Unique monitoring networks represented in a boundary.',
    format: 'count'
  },
  {
    key: 'parameterVariety',
    label: 'Parameter Variety',
    shortLabel: 'Parameter variety',
    description: 'Unique parameter labels observed among sensors.',
    format: 'count'
  },
  {
    key: 'activeShare',
    label: 'Active Sensor Share',
    shortLabel: 'Active share',
    description: 'Share of in-boundary sensors marked active.',
    format: 'ratio'
  },
  {
    key: 'monitorCount',
    label: 'Raw Sensor Count',
    shortLabel: 'Sensor count',
    description: 'Absolute number of sensors in each boundary.',
    format: 'count'
  }
]

export const DEFAULT_SCORE_WEIGHTS: ScoreMetricWeightMap = {
  overallDensity: 45,
  lowCostDensity: 15,
  referenceDensity: 25,
  networkVariety: 8,
  parameterVariety: 4,
  activeShare: 3,
  monitorCount: 0
}

export const SCORE_PRESETS: ScorePreset[] = [
  {
    key: 'balancedCoverage',
    label: 'Balanced Coverage',
    description: 'Mix density with network and parameter variety.',
    weights: {
      overallDensity: 40,
      lowCostDensity: 18,
      referenceDensity: 24,
      networkVariety: 10,
      parameterVariety: 5,
      activeShare: 3,
      monitorCount: 0
    }
  },
  {
    key: 'lowCostExpansion',
    label: 'Low-Cost Expansion',
    description: 'Prioritize community low-cost deployment patterns.',
    weights: {
      overallDensity: 18,
      lowCostDensity: 45,
      referenceDensity: 8,
      networkVariety: 12,
      parameterVariety: 7,
      activeShare: 10,
      monitorCount: 0
    }
  },
  {
    key: 'referenceNetwork',
    label: 'Reference Strength',
    description: 'Emphasize reference stations and reliability.',
    weights: {
      overallDensity: 20,
      lowCostDensity: 5,
      referenceDensity: 45,
      networkVariety: 8,
      parameterVariety: 5,
      activeShare: 12,
      monitorCount: 5
    }
  }
]

export const DENSITY_METRIC_OPTIONS: ScoreMetricKey[] = [
  'overallDensity',
  'lowCostDensity',
  'referenceDensity',
  'monitorCount'
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
    monitorCount: initial
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
