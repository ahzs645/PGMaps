import type { BoundarySource, RegionLevel, StudyAreaRegion } from '@/lib/studyArea'

export type ScoreMetricCategory =
  | 'airQuality'
  | 'parksRec'
  | 'heatShade'
  | 'foodSafety'
  | 'demographics'
  | 'property'
  | 'safety'
  | 'transit'
  | 'walkability'
  | 'deprivation'

export type ScoreIndexModule =
  | 'socialVulnerability'
  | 'environmentalBurden'
  | 'healthVulnerability'
  | 'climateBurden'
  | 'localContext'

export type ScoreIndexDomain =
  | 'demographics'
  | 'socioeconomic'
  | 'housing'
  | 'airPollution'
  | 'builtEnvironment'
  | 'transportationInfrastructure'
  | 'foodSafety'
  | 'publicSafety'
  | 'heat'
  | 'wildfire'
  | 'extremeEvents'
  | 'healthConditions'
  | 'monitoring'
  | 'services'

export type ScoreMetricValueBehavior = 'continuous' | 'inverseContinuous' | 'topTertileFlag'
export type ScoreMissingDataPolicy = 'neutral' | 'zero' | 'excludeRegion' | 'zeroWithFlag'

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
  | 'parkAccessGap1Mile'
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
  | 'pre1980HousingShare'
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
  | 'frequentTransitStopAccess'
  | 'transitServiceSpan'
  | 'transitTripsPerStop'
  | 'accessibleFrequentTransitAccess'
  // Walkability / Pedestrian Network Study
  | 'sidewalkDensity'
  | 'walkwayDensity'
  | 'walkabilityIntersectionDensity'
  | 'walkabilityCrossingDensity'
  | 'childcareDensity'
  | 'walkabilityPoiDensity'
  | 'class3CrosswalkDensity'
  | 'pedestrianCrashDensity'
  // Accessibility
  | 'parkWalk10Access'
  | 'parkWalk20Access'
  | 'coolingWalk15Access'
  | 'parkTransit20Access'
  | 'serviceAccessComposite'
  // Shade and deprivation
  | 'canopyProxyRatio'
  | 'shadeGap'
  | 'cimdComposite'
  | 'cimdResidentialInstability'
  | 'cimdEconomicDependency'
  | 'cimdSituationalVulnerability'
  | 'cimdEthnoCulturalComposition'

export type ScoreMetricFormat = 'density' | 'count' | 'ratio' | 'percent' | 'currency' | 'years'
export type ScoreNormalizationMethod = 'minMax' | 'winsorizedMinMax' | 'percentile' | 'zScore'
export type ScoreVisualOutputMode = 'interpolated' | 'binned'
export type ScoreAggregationMethod =
  | 'additive'
  | 'geometric'
  | 'cumulativeBurden'
  | 'modulePercentileRankedSum'
  | 'healthyPlanPairwisePriority'
export type ScoreNormalizationScope = 'activeBoundaryLevel'
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
  | 'bufferAreaIntersection'
export type ScoreUncertaintyLevel = 'low' | 'medium' | 'high'

export interface ScoreMethodSettings {
  normalization: ScoreNormalizationMethod
  aggregation: ScoreAggregationMethod
  missingData: 'zero' | 'neutral'
  sensitivity: boolean
  normalizationScope: ScoreNormalizationScope
  visualOutput: ScoreVisualOutputMode
  healthyPlanPriority: {
    demographicMetric: ScoreMetricKey | null
    environmentMetric: ScoreMetricKey | null
  }
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
  directionLabel: string
  sourceUrl?: string
  freshnessLabel: string
  comparisonBasis: string
  indexModule?: ScoreIndexModule
  indexDomain?: ScoreIndexDomain
  valueBehavior?: ScoreMetricValueBehavior
  missingDataPolicy?: ScoreMissingDataPolicy
  proxyLevel?: 'official' | 'proxy' | 'experimental'
}

export type ScoreMetricWeightMap = Record<ScoreMetricKey, number>
export type ScoreMetricValueMap = Record<ScoreMetricKey, number>
export type ScoreMetricRangeMap = Record<ScoreMetricKey, { min: number; max: number }>

export type ScoreBuilderRegion = StudyAreaRegion

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
  pre1980BuildingCount: number
  vacantParcelCount: number
  multiFamilyParcelCount: number
  commercialParcelCount: number
  crimeCount: number
  recentCrimeCount: number
  transitStopCount: number
  accessibleTransitStopCount: number
  transitShelterCount: number
  frequentTransitStopCount: number
  accessibleFrequentTransitStopCount: number
  transitTripCount: number
  transitServiceSpanSum: number
  sidewalkLengthKm: number
  walkwayLengthKm: number
  walkabilityIntersectionCount: number
  walkabilityCrossingCount: number
  childcareCount: number
  walkabilityPoiCount: number
  class3CrosswalkCount: number
  pedestrianCrashCount: number
  treeCount: number
  matureTreeCount: number
  forestAreaSqKm: number
  canopyProxyAreaSqKm: number
  coolingFacilityCount: number
  responseFacilityCount: number
  cimdJoinedCount: number
  cimdPopulationWeight: number
  cimdCompositeSum: number
  cimdResidentialInstabilitySum: number
  cimdEconomicDependencySum: number
  cimdSituationalVulnerabilitySum: number
  cimdEthnoCulturalCompositionSum: number
}

export interface RegionEquityAudit {
  referenceRank: number | null
  rankDelta: number
  referenceScore: number | null
  deprivationQuintile: number | null
  burdenOverlap: number
  cutoffWarning: string | null
}

export interface HealthyPlanPriorityAudit {
  demographicMetric: ScoreMetricKey
  environmentMetric: ScoreMetricKey
  demographicRank: number | null
  environmentRank: number | null
  priorityScore: number | null
  priorityColor: string | null
  equityPriority: boolean
}

export interface ScoreModuleResult {
  key: ScoreIndexModule
  label: string
  rawScore: number
  rank: number
  activeMetricCount: number
  missingMetricCount: number
}

export interface ScoreDomainResult {
  key: ScoreIndexDomain
  label: string
  module: ScoreIndexModule
  score: number
  activeMetricCount: number
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
  rankConfidence: 'Stable priority' | 'Borderline priority' | 'Sensitive result'
  rankInterval: [number, number]
  scoreInterval: [number, number]
  comparisonUniverseLabel: string
  equityAudit: RegionEquityAudit
  scoreMethodLabel?: string
  healthyPlanPriority?: HealthyPlanPriorityAudit
  moduleScores?: ScoreModuleResult[]
  domainScores?: ScoreDomainResult[]
  missingDataFlags?: string[]
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
  | 'walkability'
  | 'deprivation'

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
  { id: 'walkability', label: 'Walkability', description: 'Pedestrian network study layers and public-data supplements' },
  { id: 'deprivation', label: 'Deprivation', description: 'Statistics Canada CIMD deprivation context' },
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
  walkability: 'Walkability',
  deprivation: 'Deprivation',
}
