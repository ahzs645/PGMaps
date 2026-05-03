import type { BoundarySource, RegionLevel } from '@/maps/airquality'

export type ScoreMetricCategory =
  | 'airQuality'
  | 'parksRec'
  | 'heatShade'
  | 'foodSafety'
  | 'demographics'
  | 'property'
  | 'safety'
  | 'transit'

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
  // Heat & Shade
  | 'treeDensity'
  | 'matureTreeDensity'
  | 'forestAreaRatio'
  | 'coolingFacilityDensity'
  | 'responseFacilityDensity'
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
  // Transit
  | 'transitStopDensity'
  | 'accessibleTransitStopDensity'
  | 'transitShelterDensity'

export type ScoreMetricFormat = 'density' | 'count' | 'ratio' | 'percent' | 'currency' | 'years'
export type ScoreNormalizationMethod = 'minMax' | 'winsorizedMinMax' | 'percentile' | 'zScore'
export type ScoreAggregationMethod = 'additive' | 'geometric'
export type ScoreMetricDirection = 'higherIsBetter' | 'higherIsWorse'
export type ScoreMetricComponent =
  | 'monitoringAdequacy'
  | 'serviceAccess'
  | 'environmentalBurden'
  | 'sensitivity'
  | 'adaptiveCapacity'
  | 'housingPressure'
  | 'safetyPressure'
export type ScoreSpatialMethod =
  | 'pointInPolygon'
  | 'centroidInPolygon'
  | 'midpointInPolygon'
  | 'directBoundaryJoin'
  | 'derivedRatio'
export type ScoreUncertaintyLevel = 'low' | 'medium' | 'high'

export interface ScoreMethodSettings {
  normalization: ScoreNormalizationMethod
  aggregation: ScoreAggregationMethod
  missingData: 'zero' | 'neutral'
  sensitivity: boolean
}

export interface ScoreMetricDefinition {
  key: ScoreMetricKey
  label: string
  shortLabel: string
  description: string
  format: ScoreMetricFormat
  category: ScoreMetricCategory
  direction: ScoreMetricDirection
  component: ScoreMetricComponent
  dataSourceLabel: string
  spatialMethod: ScoreSpatialMethod
  uncertainty: ScoreUncertaintyLevel
  caveat?: string
}

export type ScoreMetricWeightMap = Record<ScoreMetricKey, number>
export type ScoreMetricValueMap = Record<ScoreMetricKey, number>
export type ScoreMetricRangeMap = Record<ScoreMetricKey, { min: number; max: number }>

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
  methodSettings?: Partial<ScoreMethodSettings>
  boundarySources?: BoundarySource[]
  recommendedBoundarySource?: BoundarySource
  recommendedBoundaryLevel?: RegionLevel
}

export interface ScorePresetMethodology {
  purpose: string
  components: string[]
  normalization: string
  knownLimits: string[]
  dataNeeded: string[]
  proxy: boolean
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
  methodSettings?: Partial<ScoreMethodSettings>
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
  transitStopCount: number
  accessibleTransitStopCount: number
  transitShelterCount: number
  treeCount: number
  matureTreeCount: number
  forestAreaSqKm: number
  coolingFacilityCount: number
  responseFacilityCount: number
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
  dataCoverageScore: number
}

export interface ScoreComponentSummary {
  key: ScoreMetricCategory
  label: string
  score: number
  weightShare: number
  activeMetricCount: number
}

export interface RobustnessResult {
  regionId: string
  regionName: string
  baseRank: number
  medianRank: number
  rankInterval: [number, number]
  scoreInterval: [number, number]
  stability: 'stable' | 'moderate' | 'sensitive'
  topDrivers: ScoreMetricKey[]
}

export type ScoreDataSource =
  | 'airQuality'
  | 'parks'
  | 'heatShade'
  | 'restaurants'
  | 'census'
  | 'bcAssessment'
  | 'crime'
  | 'transit'

export type ScoreFilterKey = 'requirePopulation' | 'requireParks' | 'limitCrime' | 'limitFoodRisk'

export type ScoreFilterState = Record<ScoreFilterKey, boolean>

export interface ScoreBandSummary {
  key: 'high' | 'moderate' | 'low' | 'watchlist'
  label: string
  description: string
  min: number
  max: number
  count: number
}

export interface ScenarioComparison {
  label: string
  currentTopName: string | null
  currentTopScore: number
  referenceTopName: string | null
  referenceTopScore: number
  averageDelta: number
  topChanged: boolean
  stableTopShare: number
  averageRankShift: number
}

export const SCORE_DATA_SOURCES: Array<{ id: ScoreDataSource; label: string; description: string }> = [
  { id: 'airQuality', label: 'Air Quality', description: 'Sensor network coverage and diversity' },
  { id: 'parks', label: 'Parks & Trails', description: 'Parks, trails, and amenity infrastructure' },
  { id: 'heatShade', label: 'Heat & Shade', description: 'Tree inventory, forest cover, and cooling-access proxies' },
  { id: 'restaurants', label: 'Food Safety', description: 'Restaurant inspection coverage' },
  { id: 'census', label: 'Demographics', description: 'Census population data (PG area)' },
  { id: 'bcAssessment', label: 'BC Assessment', description: 'Parcel values, housing mix, age, and growth' },
  { id: 'crime', label: 'Crime', description: 'Prince George crime density, per-capita risk, and recency' },
  { id: 'transit', label: 'Transit', description: 'City of Prince George transit stops and stop amenities' },
]

export const METRIC_CATEGORY_LABELS: Record<ScoreMetricCategory, string> = {
  airQuality: 'Air Quality',
  parksRec: 'Parks & Recreation',
  heatShade: 'Heat & Shade',
  foodSafety: 'Food Safety',
  demographics: 'Demographics',
  property: 'Property & Housing',
  safety: 'Safety',
  transit: 'Transit',
}
