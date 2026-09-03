import type {
  BoundaryLevel,
  BoundarySource,
  CensusBoundaryLevel,
  CityBoundaryLevel,
  CommunityBoundaryLevel,
  DrainageBoundaryLevel,
  FireZoneBoundaryLevel,
  MunicipalityBoundaryLevel,
  NrAdminBoundaryLevel,
  RegionalDistrictBoundaryLevel,
  WatershedBoundaryLevel,
} from '@/maps/airquality'
import {
  CENSUS_BOUNDARY_LEVEL_OPTIONS,
  CITY_BOUNDARY_LEVEL_OPTIONS,
  COMMUNITY_BOUNDARY_LEVEL_OPTIONS,
  DRAINAGE_BOUNDARY_LEVEL_OPTIONS,
  FIRE_ZONE_BOUNDARY_LEVEL_OPTIONS,
  HEALTH_BOUNDARY_LEVEL_OPTIONS,
  MUNICIPALITY_BOUNDARY_LEVEL_OPTIONS,
  NR_ADMIN_BOUNDARY_LEVEL_OPTIONS,
  REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS,
  WATERSHED_BOUNDARY_LEVEL_OPTIONS,
  SCORE_METRICS,
} from '../constants'
import type { ScorePaletteKey } from '../constants/paletteTypes'
import type { ScoreDataSource, ScoreMetricKey, ScoreMetricWeightMap, ScoreMethodSettings } from '../types'
import type { MetricRecipe } from './metricRecipes'
import { BC_ENVIRO_SCREEN_DEFAULT_FORMULA, type BcEnviroScreenFormulaSettings } from './bcEnviroScreenFormula'

export const ALL_DATA_SOURCES: ScoreDataSource[] = [
  'airQuality',
  'parks',
  'heatShade',
  'restaurants',
  'census',
  'bcAssessment',
  'crime',
  'transit',
  'walkability',
  'deprivation',
  'healthyPlanPg',
  'bcEnviroScreen',
]

const HEALTH_BOUNDARY_LEVEL_VALUES = new Set<BoundaryLevel>(HEALTH_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value))
export const CENSUS_BOUNDARY_LEVEL_VALUES = new Set<CensusBoundaryLevel>(
  CENSUS_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value),
)
const CITY_BOUNDARY_LEVEL_VALUES = new Set<CityBoundaryLevel>(CITY_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value))
const COMMUNITY_BOUNDARY_LEVEL_VALUES = new Set<CommunityBoundaryLevel>(
  COMMUNITY_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value),
)
const REGIONAL_DISTRICT_BOUNDARY_LEVEL_VALUES = new Set<RegionalDistrictBoundaryLevel>(
  REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value),
)
const WATERSHED_BOUNDARY_LEVEL_VALUES = new Set<WatershedBoundaryLevel>(
  WATERSHED_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value),
)
const DRAINAGE_BOUNDARY_LEVEL_VALUES = new Set<DrainageBoundaryLevel>(
  DRAINAGE_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value),
)
const FIRE_ZONE_BOUNDARY_LEVEL_VALUES = new Set<FireZoneBoundaryLevel>(
  FIRE_ZONE_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value),
)
const MUNICIPALITY_BOUNDARY_LEVEL_VALUES = new Set<MunicipalityBoundaryLevel>(
  MUNICIPALITY_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value),
)
const NR_ADMIN_BOUNDARY_LEVEL_VALUES = new Set<NrAdminBoundaryLevel>(
  NR_ADMIN_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value),
)

export function parseBoundarySource(value: string | null): BoundarySource {
  return value === 'bcHealth' ||
    value === 'regionalDistrict' ||
    value === 'bcMunicipality' ||
    value === 'census' ||
    value === 'cityCommunity' ||
    value === 'cityPG' ||
    value === 'watershed' ||
    value === 'bcDrainage' ||
    value === 'bcWildfire' ||
    value === 'nrAdmin'
    ? value
    : 'census'
}

export function parseHealthBoundaryLevel(value: string | null): BoundaryLevel {
  return HEALTH_BOUNDARY_LEVEL_VALUES.has(value as BoundaryLevel) ? (value as BoundaryLevel) : 'chsa'
}

export function parseCensusBoundaryLevel(value: string | null): CensusBoundaryLevel {
  return CENSUS_BOUNDARY_LEVEL_VALUES.has(value as CensusBoundaryLevel) ? (value as CensusBoundaryLevel) : 'ct'
}

export function parseCommunityBoundaryLevel(value: string | null): CommunityBoundaryLevel {
  return COMMUNITY_BOUNDARY_LEVEL_VALUES.has(value as CommunityBoundaryLevel)
    ? (value as CommunityBoundaryLevel)
    : 'communityPolygon'
}

export function parseCityBoundaryLevel(value: string | null): CityBoundaryLevel {
  return CITY_BOUNDARY_LEVEL_VALUES.has(value as CityBoundaryLevel)
    ? (value as CityBoundaryLevel)
    : 'elementarySchoolCatchment'
}

export function parseRegionalDistrictBoundaryLevel(value: string | null): RegionalDistrictBoundaryLevel {
  return REGIONAL_DISTRICT_BOUNDARY_LEVEL_VALUES.has(value as RegionalDistrictBoundaryLevel)
    ? (value as RegionalDistrictBoundaryLevel)
    : 'regionalDistrict'
}

export function parseWatershedBoundaryLevel(value: string | null): WatershedBoundaryLevel {
  return WATERSHED_BOUNDARY_LEVEL_VALUES.has(value as WatershedBoundaryLevel)
    ? (value as WatershedBoundaryLevel)
    : 'watershedGroup'
}

export function parseDrainageBoundaryLevel(value: string | null): DrainageBoundaryLevel {
  return DRAINAGE_BOUNDARY_LEVEL_VALUES.has(value as DrainageBoundaryLevel)
    ? (value as DrainageBoundaryLevel)
    : 'oceanDrainageArea'
}

export function parseFireZoneBoundaryLevel(value: string | null): FireZoneBoundaryLevel {
  return FIRE_ZONE_BOUNDARY_LEVEL_VALUES.has(value as FireZoneBoundaryLevel)
    ? (value as FireZoneBoundaryLevel)
    : 'fireCentre'
}

export function parseMunicipalityBoundaryLevel(value: string | null): MunicipalityBoundaryLevel {
  return MUNICIPALITY_BOUNDARY_LEVEL_VALUES.has(value as MunicipalityBoundaryLevel)
    ? (value as MunicipalityBoundaryLevel)
    : 'municipality'
}

export function parseNrAdminBoundaryLevel(value: string | null): NrAdminBoundaryLevel {
  return NR_ADMIN_BOUNDARY_LEVEL_VALUES.has(value as NrAdminBoundaryLevel) ? (value as NrAdminBoundaryLevel) : 'nrArea'
}

export function parseNormalizationMethod(value: string | null): ScoreMethodSettings['normalization'] {
  if (value === 'minMax' || value === 'winsorizedMinMax' || value === 'percentile' || value === 'zScore') return value
  return 'percentile'
}

export function parseAggregationMethod(value: string | null): ScoreMethodSettings['aggregation'] {
  if (
    value === 'geometric' ||
    value === 'cumulativeBurden' ||
    value === 'modulePercentileRankedSum' ||
    value === 'bcEnviroScreenProduct' ||
    value === 'healthyPlanPairwisePriority' ||
    value === 'accessThreshold'
  ) {
    return value
  }
  return 'additive'
}

export function parseBcEnviroScreenComponentWeight(value: string | null, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(10, parsed)) : fallback
}

export function parseBcEnviroScreenFormulaSettings(
  mode: string | null,
  expression: string | null,
): BcEnviroScreenFormulaSettings {
  return {
    mode: mode === 'custom' ? 'custom' : 'reconstruction',
    expression:
      typeof expression === 'string' && expression.trim() && expression.length <= 1000
        ? expression
        : BC_ENVIRO_SCREEN_DEFAULT_FORMULA,
  }
}

export function parseAccessThresholdValue(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0.5
  return Math.max(0.05, Math.min(1, parsed))
}

export function parseAccessMinimumHits(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 4
  return Math.max(1, Math.min(7, Math.round(parsed)))
}

export function parseMissingDataMethod(value: string | null): ScoreMethodSettings['missingData'] {
  return value === 'neutral' ? 'neutral' : 'zero'
}

export function parseVisualOutputMode(value: string | null): ScoreMethodSettings['visualOutput'] {
  return value === 'binned' ? 'binned' : 'interpolated'
}

export function parseMapColorScale(value: string | null): ScoreMethodSettings['mapColorScale'] {
  return value === 'absolute' ? 'absolute' : 'relative'
}

const PALETTE_OVERRIDE_KEYS: ScorePaletteKey[] = ['airCoverage', 'benefit', 'affordability', 'riskPressure', 'default']

export function parsePaletteOverride(value: string | null): ScorePaletteKey | null {
  return value && PALETTE_OVERRIDE_KEYS.includes(value as ScorePaletteKey) ? (value as ScorePaletteKey) : null
}

export function parseMapSurface(value: string | null): 'source' | 'boundary' {
  return value === 'source' ? 'source' : 'boundary'
}

export function parseSelectedNetworks(value: string | null): {
  selectedNetworks: string[]
  pendingNetworkSelectAll: boolean
} {
  if (value === 'all') return { selectedNetworks: [], pendingNetworkSelectAll: true }
  if (!value) return { selectedNetworks: [], pendingNetworkSelectAll: false }
  const selectedNetworks = value
    .split(',')
    .map((network) => network.trim())
    .filter(Boolean)
  return { selectedNetworks, pendingNetworkSelectAll: false }
}

export function parseDataSources(value: string | null): ScoreDataSource[] {
  if (!value) return []
  return value.split(',').filter((s) => ALL_DATA_SOURCES.includes(s as ScoreDataSource)) as ScoreDataSource[]
}

export function getQuickIndexLabPresetKey(value: string | null): string | null {
  if (value === 'airQuality') return 'monitoringGapProxy'
  if (value === 'parks') return 'parkAccessEquity'
  if (value === 'transit') return 'transitEquity'
  if (value === 'crime') return 'safetyPressure'
  if (value === 'foodSafety') return 'foodInspectionRisk'
  if (value === 'walkability') return 'activeLivingWalkability'
  if (value === 'heatShade') return 'heatReliefPriority'
  if (value === 'canue') return 'activeLivingWalkability'
  return null
}

export function parseScoreMetricKey(value: string | null, fallback: ScoreMetricKey): ScoreMetricKey {
  return SCORE_METRICS.some((metric) => metric.key === value) ? (value as ScoreMetricKey) : fallback
}

export function parseCustomMetricRecipes(value: string | null): MetricRecipe[] {
  if (!value) return []
  try {
    const decoded = decodeURIComponent(value)
    const parsed = JSON.parse(decoded)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((recipe): recipe is MetricRecipe => {
      return (
        recipe &&
        typeof recipe.id === 'string' &&
        typeof recipe.label === 'string' &&
        typeof recipe.source === 'string' &&
        typeof recipe.operation === 'string'
      )
    })
  } catch {
    return []
  }
}

export function encodeCustomMetricRecipes(recipes: MetricRecipe[]): string {
  return encodeURIComponent(JSON.stringify(recipes))
}

export function parseCustomMetricWeights(value: string | null): Record<string, number> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(decodeURIComponent(value))
    if (!parsed || typeof parsed !== 'object') return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, raw]) => [key, Math.max(-100, Math.min(100, Math.round(Number(raw))))] as const)
        .filter(([, weight]) => Number.isFinite(weight)),
    )
  } catch {
    return {}
  }
}

export function encodeCustomMetricWeights(weights: ScoreMetricWeightMap, recipes: MetricRecipe[]): string {
  const customWeights = Object.fromEntries(
    recipes.map((recipe) => [recipe.id, weights[recipe.id] ?? 0]).filter(([, value]) => value !== 0),
  )
  return encodeURIComponent(JSON.stringify(customWeights))
}
