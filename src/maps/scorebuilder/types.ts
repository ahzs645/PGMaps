import type { BoundarySource, RegionLevel } from '@/maps/airquality'

export type ScoreMetricCategory = 'airQuality' | 'parksRec' | 'foodSafety' | 'demographics' | 'property' | 'safety'

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
  | 'criticalViolationRate'
  | 'followUpRate'
  // Demographics
  | 'populationDensity'
  // Property
  | 'parcelDensity'
  | 'avgAssessedValue'
  | 'valueGrowth10y'
  | 'buildingAge'
  | 'vacantParcelShare'
  | 'multiFamilyShare'
  | 'commercialShare'
  | 'landValueShare'
  // Safety
  | 'crimeDensity'
  | 'crimePerCapita'
  | 'recentCrimeShare'

export type ScoreMetricFormat = 'density' | 'count' | 'ratio' | 'percent' | 'currency' | 'years'

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

export interface ScoreExample {
  key: string
  label: string
  question: string
  description: string
  boundarySource: BoundarySource
  boundaryLevel: string
  dataSources: ScoreDataSource[]
  networkFilter: 'all' | 'none' | string[]
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
  inspectionCount: number
  criticalViolationCount: number
  followUpInspectionCount: number
  populationSum: number
  parcelCount: number
  assessedValueSum: number
  landValueSum: number
  buildingValueSum: number
  propertyGrowthSum: number
  propertyGrowthCount: number
  yearBuiltSum: number
  yearBuiltCount: number
  vacantParcelCount: number
  multiFamilyParcelCount: number
  commercialParcelCount: number
  crimeCount: number
  recentCrimeCount: number
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

export type ScoreDataSource = 'airQuality' | 'parks' | 'restaurants' | 'census' | 'bcAssessment' | 'crime'

export const SCORE_DATA_SOURCES: Array<{ id: ScoreDataSource; label: string; description: string }> = [
  { id: 'airQuality', label: 'Air Quality', description: 'Sensor network coverage and diversity' },
  { id: 'parks', label: 'Parks & Trails', description: 'Parks, trails, and amenity infrastructure' },
  { id: 'restaurants', label: 'Food Safety', description: 'Restaurant inspection coverage' },
  { id: 'census', label: 'Demographics', description: 'Census population data (PG area)' },
  { id: 'bcAssessment', label: 'BC Assessment', description: 'Parcel values, housing mix, age, and growth' },
  { id: 'crime', label: 'Crime', description: 'Prince George crime density, per-capita risk, and recency' }
]

export const METRIC_CATEGORY_LABELS: Record<ScoreMetricCategory, string> = {
  airQuality: 'Air Quality',
  parksRec: 'Parks & Recreation',
  foodSafety: 'Food Safety',
  demographics: 'Demographics',
  property: 'Property & Housing',
  safety: 'Safety'
}
