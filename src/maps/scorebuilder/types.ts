import type { BoundarySource, RegionLevel } from '@/maps/airquality'

export type ScoreMetricCategory = 'airQuality' | 'parksRec' | 'foodSafety' | 'demographics'

export type ScoreMetricKey =
  // Air Quality
  | 'overallDensity'
  | 'lowCostDensity'
  | 'referenceDensity'
  | 'networkVariety'
  | 'parameterVariety'
  | 'activeShare'
  | 'monitorCount'
  // Parks & Recreation
  | 'parkDensity'
  | 'parkAreaRatio'
  | 'trailDensity'
  | 'amenityDensity'
  // Food Safety
  | 'restaurantDensity'
  | 'foodRiskScore'
  // Demographics
  | 'populationDensity'

export type ScoreMetricFormat = 'density' | 'count' | 'ratio' | 'percent'

export interface ScoreMetricDefinition {
  key: ScoreMetricKey
  label: string
  shortLabel: string
  description: string
  format: ScoreMetricFormat
  category: ScoreMetricCategory
}

export type ScoreMetricWeightMap = Record<ScoreMetricKey, number>
export type ScoreMetricValueMap = Record<ScoreMetricKey, number>

export interface ScoreBuilderRegion {
  id: string
  code: string
  name: string
  source: BoundarySource
  level: RegionLevel
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  bounds: [number, number, number, number]
  areaKm2: number
}

export interface ScorePreset {
  key: string
  label: string
  description: string
  weights: ScoreMetricWeightMap
}

export interface RegionDataCounts {
  monitorCount: number
  lowCostCount: number
  referenceCount: number
  activeCount: number
  parkCount: number
  parkAreaSqKm: number
  trailCount: number
  trailLengthKm: number
  amenityCount: number
  restaurantCount: number
  restaurantHazardSum: number
  populationSum: number
}

export interface ScoredBoundaryRegion {
  region: ScoreBuilderRegion
  metrics: ScoreMetricValueMap
  normalizedMetrics: ScoreMetricValueMap
  contributions: ScoreMetricValueMap
  counts: RegionDataCounts
  score: number
  scoreColor: string
  rank: number
}

export type ScoreDataSource = 'airQuality' | 'parks' | 'restaurants' | 'census'

export const SCORE_DATA_SOURCES: Array<{ id: ScoreDataSource; label: string; description: string }> = [
  { id: 'airQuality', label: 'Air Quality', description: 'Sensor network coverage and diversity' },
  { id: 'parks', label: 'Parks & Trails', description: 'Parks, trails, and amenity infrastructure' },
  { id: 'restaurants', label: 'Food Safety', description: 'Restaurant inspection coverage' },
  { id: 'census', label: 'Demographics', description: 'Census population data (PG area)' }
]

export const METRIC_CATEGORY_LABELS: Record<ScoreMetricCategory, string> = {
  airQuality: 'Air Quality',
  parksRec: 'Parks & Recreation',
  foodSafety: 'Food Safety',
  demographics: 'Demographics'
}
