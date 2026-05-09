import { METRIC_CATEGORY_LABELS } from './types'
import type {
  ScoreDataSource,
  ScoreExample,
  ScoreIndexDomain,
  ScoreIndexModule,
  ScoreMetricValueBehavior,
  ScoreMissingDataPolicy,
  ScoreMetricDefinition,
  ScoreMetricDirection,
  ScoreMetricComponent,
  ScoreMetricKey,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
  ScorePresetMethodology,
  ScoreSpatialMethod,
  ScoreUncertaintyLevel,
  ScorePreset,
} from './types'

export type ScorePaletteKey = 'airCoverage' | 'benefit' | 'affordability' | 'riskPressure' | 'default'

export interface ScorePaletteProfile {
  key: ScorePaletteKey
  label: string
  colors: readonly [string, string, string, string, string]
  legend: {
    low: string
    high: string
  }
}

type ScoreMetricBaseDefinition = Omit<
  ScoreMetricDefinition,
  | 'direction'
  | 'component'
  | 'dataSourceLabel'
  | 'spatialMethod'
  | 'uncertainty'
  | 'caveat'
  | 'directionLabel'
  | 'sourceUrl'
  | 'freshnessLabel'
  | 'comparisonBasis'
  | 'indexModule'
  | 'indexDomain'
  | 'valueBehavior'
  | 'missingDataPolicy'
  | 'proxyLevel'
>

const PERCENTILE_METHOD: Partial<ScoreMethodSettings> = { normalization: 'percentile', aggregation: 'additive' }
const WINSORIZED_METHOD: Partial<ScoreMethodSettings> = { normalization: 'winsorizedMinMax', aggregation: 'additive' }
const Z_SCORE_METHOD: Partial<ScoreMethodSettings> = { normalization: 'zScore', aggregation: 'additive' }
const CUMULATIVE_BURDEN_METHOD: Partial<ScoreMethodSettings> = {
  normalization: 'percentile',
  aggregation: 'cumulativeBurden',
}
const MODULE_PERCENTILE_METHOD: Partial<ScoreMethodSettings> = {
  normalization: 'percentile',
  aggregation: 'modulePercentileRankedSum',
}

export const SCORE_INDEX_MODULE_LABELS: Record<ScoreIndexModule, string> = {
  socialVulnerability: 'Social Vulnerability',
  environmentalBurden: 'Environmental Burden',
  healthVulnerability: 'Health Vulnerability',
  climateBurden: 'Climate Burden',
  localContext: 'Local Context',
}

export const SCORE_INDEX_DOMAIN_LABELS: Record<ScoreIndexDomain, string> = {
  demographics: 'Demographics',
  socioeconomic: 'Socioeconomic Status',
  housing: 'Housing',
  airPollution: 'Air Pollution',
  builtEnvironment: 'Built Environment',
  transportationInfrastructure: 'Transportation Infrastructure',
  foodSafety: 'Food Safety',
  publicSafety: 'Public Safety',
  heat: 'Heat',
  wildfire: 'Wildfire',
  extremeEvents: 'Extreme Events',
  healthConditions: 'Health Conditions',
  monitoring: 'Monitoring',
  services: 'Services',
}

const SCORE_METRIC_BASES: ScoreMetricBaseDefinition[] = [
  // Air Quality
  {
    key: 'overallDensity',
    label: 'Overall Sensor Density',
    shortLabel: 'Overall density',
    description: 'Total sensors per km² inside each boundary.',
    format: 'density',
    category: 'airQuality',
  },
  {
    key: 'lowCostDensity',
    label: 'Low-Cost Sensor Density',
    shortLabel: 'Low-cost density',
    description: 'Low-cost network sensors (PA + EGG) per km².',
    format: 'density',
    category: 'airQuality',
  },
  {
    key: 'referenceDensity',
    label: 'Reference Sensor Density',
    shortLabel: 'Reference density',
    description: 'Regulatory and non-low-cost sensors per km².',
    format: 'density',
    category: 'airQuality',
  },
  {
    key: 'networkVariety',
    label: 'Network Variety',
    shortLabel: 'Network variety',
    description: 'Unique monitoring networks represented in a boundary.',
    format: 'count',
    category: 'airQuality',
  },
  {
    key: 'parameterVariety',
    label: 'Parameter Variety',
    shortLabel: 'Parameter variety',
    description: 'Unique parameter labels observed among sensors.',
    format: 'count',
    category: 'airQuality',
  },
  {
    key: 'activeShare',
    label: 'Active Sensor Share',
    shortLabel: 'Active share',
    description: 'Share of in-boundary sensors marked active.',
    format: 'ratio',
    category: 'airQuality',
  },
  {
    key: 'monitorCount',
    label: 'Raw Sensor Count',
    shortLabel: 'Sensor count',
    description: 'Absolute number of sensors in each boundary.',
    format: 'count',
    category: 'airQuality',
  },
  // Parks & Recreation
  {
    key: 'parkDensity',
    label: 'Park Density',
    shortLabel: 'Park density',
    description: 'Number of parks per km² in each boundary.',
    format: 'density',
    category: 'parksRec',
  },
  {
    key: 'parkAreaRatio',
    label: 'Park Area Ratio',
    shortLabel: 'Park area %',
    description: 'Percentage of boundary area covered by parks.',
    format: 'percent',
    category: 'parksRec',
  },
  {
    key: 'trailDensity',
    label: 'Trail Density',
    shortLabel: 'Trail density',
    description: 'Trail km per km² in each boundary.',
    format: 'density',
    category: 'parksRec',
  },
  {
    key: 'amenityDensity',
    label: 'Amenity Density',
    shortLabel: 'Amenity density',
    description: 'Park amenities per km² in each boundary.',
    format: 'density',
    category: 'parksRec',
  },
  {
    key: 'parkAccessGap1Mile',
    label: 'Park Access Gap',
    shortLabel: 'Park gap',
    description: 'Share of boundary area outside a 1.6 km buffer around CityPG park/open-space polygons.',
    format: 'percent',
    category: 'parksRec',
  },
  // Heat & Shade
  {
    key: 'treeDensity',
    label: 'Tree Density',
    shortLabel: 'Tree density',
    description: 'Tree points per km² inside each boundary, where available.',
    format: 'density',
    category: 'heatShade',
  },
  {
    key: 'matureTreeDensity',
    label: 'Mature Tree Density',
    shortLabel: 'Mature trees',
    description: 'Mature tree points per km² inside each boundary, where available.',
    format: 'density',
    category: 'heatShade',
  },
  {
    key: 'forestAreaRatio',
    label: 'Forest Area Ratio',
    shortLabel: 'Forest area %',
    description: 'Share of boundary area covered by forest/open-space canopy proxies, where available.',
    format: 'percent',
    category: 'heatShade',
  },
  {
    key: 'coolingFacilityDensity',
    label: 'Cooling Facility Density',
    shortLabel: 'Cooling facilities',
    description: 'Cooling or community facility points per km² inside each boundary, where available.',
    format: 'density',
    category: 'heatShade',
  },
  {
    key: 'responseFacilityDensity',
    label: 'Response Facility Density',
    shortLabel: 'Response facilities',
    description: 'Emergency response or support facility points per km² inside each boundary, where available.',
    format: 'density',
    category: 'heatShade',
  },
  // Food Safety
  {
    key: 'restaurantDensity',
    label: 'Restaurant Density',
    shortLabel: 'Restaurant density',
    description: 'Restaurants per km² in each boundary.',
    format: 'density',
    category: 'foodSafety',
  },
  {
    key: 'foodRiskScore',
    label: 'Food Risk Score',
    shortLabel: 'Food risk',
    description: 'Average hazard level of food facilities (0=Low, 1=High).',
    format: 'ratio',
    category: 'foodSafety',
  },
  {
    key: 'criticalViolationRate',
    label: 'Critical Violation Rate',
    shortLabel: 'Critical rate',
    description: 'Critical violations per inspection for restaurants in each boundary.',
    format: 'ratio',
    category: 'foodSafety',
  },
  {
    key: 'followUpRate',
    label: 'Follow-Up Inspection Rate',
    shortLabel: 'Follow-up rate',
    description: 'Share of inspections that required a follow-up.',
    format: 'ratio',
    category: 'foodSafety',
  },
  // Demographics
  {
    key: 'populationDensity',
    label: 'Population Density',
    shortLabel: 'Pop. density',
    description: 'Census population per km² from overlapping DAs.',
    format: 'density',
    category: 'demographics',
  },
  // Property & Housing
  {
    key: 'parcelDensity',
    label: 'Parcel Density',
    shortLabel: 'Parcel density',
    description: 'BC Assessment parcels per km².',
    format: 'density',
    category: 'property',
  },
  {
    key: 'avgAssessedValue',
    label: 'Average Assessed Value',
    shortLabel: 'Avg. value',
    description: 'Average total assessed parcel value.',
    format: 'currency',
    category: 'property',
  },
  {
    key: 'valueGrowth10y',
    label: '10-Year Value Growth',
    shortLabel: '10y growth',
    description: 'Average parcel value growth across available assessment history.',
    format: 'percent',
    category: 'property',
  },
  {
    key: 'buildingAge',
    label: 'Average Building Age',
    shortLabel: 'Building age',
    description: 'Average age of parcels with a known year built.',
    format: 'years',
    category: 'property',
  },
  {
    key: 'pre1980HousingShare',
    label: 'Pre-1980 Housing Share',
    shortLabel: 'Pre-1980',
    description: 'Share of BC Assessment parcels with known building year before 1980.',
    format: 'percent',
    category: 'property',
  },
  {
    key: 'vacantParcelShare',
    label: 'Vacant Parcel Share',
    shortLabel: 'Vacant share',
    description: 'Share of parcels classified as vacant.',
    format: 'percent',
    category: 'property',
  },
  {
    key: 'multiFamilyShare',
    label: 'Multi-Family Share',
    shortLabel: 'Multi-family',
    description: 'Share of parcels classified as multi-family.',
    format: 'percent',
    category: 'property',
  },
  {
    key: 'commercialShare',
    label: 'Commercial Parcel Share',
    shortLabel: 'Commercial',
    description: 'Share of parcels classified as commercial.',
    format: 'percent',
    category: 'property',
  },
  {
    key: 'landValueShare',
    label: 'Land Value Share',
    shortLabel: 'Land value',
    description: 'Share of assessed value assigned to land rather than buildings.',
    format: 'percent',
    category: 'property',
  },
  // Safety
  {
    key: 'crimeDensity',
    label: 'Crime Density',
    shortLabel: 'Crime density',
    description: 'Crime incidents per km².',
    format: 'density',
    category: 'safety',
  },
  {
    key: 'crimePerCapita',
    label: 'Crime Per Capita',
    shortLabel: 'Crime/capita',
    description: 'Crime incidents per resident based on census population.',
    format: 'ratio',
    category: 'safety',
  },
  {
    key: 'recentCrimeShare',
    label: 'Recent Crime Share',
    shortLabel: 'Recent crime',
    description: 'Share of incidents from the most recent 180 days in the loaded data.',
    format: 'percent',
    category: 'safety',
  },
  // Transit
  {
    key: 'transitStopDensity',
    label: 'Transit Stop Density',
    shortLabel: 'Transit density',
    description: 'Transit stops per km² inside each boundary.',
    format: 'density',
    category: 'transit',
  },
  {
    key: 'accessibleTransitStopDensity',
    label: 'Accessible Transit Stop Density',
    shortLabel: 'Accessible transit',
    description: 'Accessible transit stops per km² inside each boundary.',
    format: 'density',
    category: 'transit',
  },
  {
    key: 'transitShelterDensity',
    label: 'Transit Shelter/Exchange Density',
    shortLabel: 'Shelter density',
    description: 'Transit shelters and exchanges per km² inside each boundary.',
    format: 'density',
    category: 'transit',
  },
  {
    key: 'frequentTransitStopAccess',
    label: 'Frequent Transit Stop Access',
    shortLabel: 'Frequent transit',
    description: 'Share of regional demand within an estimated 10-minute walk of stops with stronger weekday service.',
    format: 'percent',
    category: 'transit',
  },
  {
    key: 'transitServiceSpan',
    label: 'Transit Service Span',
    shortLabel: 'Service span',
    description: 'Average daily service span in hours for in-boundary or nearby GTFS stops.',
    format: 'count',
    category: 'transit',
  },
  {
    key: 'transitTripsPerStop',
    label: 'Transit Trips per Stop',
    shortLabel: 'Trips/stop',
    description: 'Average scheduled weekday stop events per in-boundary stop.',
    format: 'count',
    category: 'transit',
  },
  {
    key: 'accessibleFrequentTransitAccess',
    label: 'Accessible Frequent Transit Access',
    shortLabel: 'Accessible frequent',
    description: 'Share of regional demand within an estimated 10-minute walk of accessible frequent-service stops.',
    format: 'percent',
    category: 'transit',
  },
  {
    key: 'parkWalk10Access',
    label: '10-Minute Park Walk Access',
    shortLabel: 'Park 10-min',
    description: 'Distance-decay estimate of park access within a 10-minute walk catchment.',
    format: 'percent',
    category: 'parksRec',
  },
  {
    key: 'parkWalk20Access',
    label: '20-Minute Park Walk Access',
    shortLabel: 'Park 20-min',
    description: 'Distance-decay estimate of park access within a 20-minute walk catchment.',
    format: 'percent',
    category: 'parksRec',
  },
  {
    key: 'coolingWalk15Access',
    label: '15-Minute Cooling Access',
    shortLabel: 'Cooling 15-min',
    description: 'Distance-decay estimate of cooling/community facility access within a 15-minute walk catchment.',
    format: 'percent',
    category: 'heatShade',
  },
  {
    key: 'parkTransit20Access',
    label: '20-Minute Park Transit Access',
    shortLabel: 'Park transit',
    description: 'Catchment estimate for park access where nearby transit service improves reach.',
    format: 'percent',
    category: 'parksRec',
  },
  {
    key: 'serviceAccessComposite',
    label: 'Service Access Composite',
    shortLabel: 'Service access',
    description: 'Combined catchment estimate for parks, cooling facilities, amenities, and transit.',
    format: 'percent',
    category: 'transit',
  },
  {
    key: 'canopyProxyRatio',
    label: 'Canopy Proxy Ratio',
    shortLabel: 'Canopy proxy',
    description: 'Tree-inventory buffer and forest/open-space proxy area as a share of boundary area.',
    format: 'percent',
    category: 'heatShade',
  },
  {
    key: 'shadeGap',
    label: 'Shade Gap',
    shortLabel: 'Shade gap',
    description: 'Need proxy combining low canopy/cooling access with population and deprivation pressure.',
    format: 'percent',
    category: 'heatShade',
  },
  {
    key: 'cimdComposite',
    label: 'CIMD Composite Deprivation',
    shortLabel: 'CIMD composite',
    description: 'Statistics Canada Canadian Index of Multiple Deprivation composite context.',
    format: 'percent',
    category: 'deprivation',
  },
  {
    key: 'cimdResidentialInstability',
    label: 'CIMD Residential Instability',
    shortLabel: 'Residential instability',
    description: 'CIMD residential instability dimension.',
    format: 'percent',
    category: 'deprivation',
  },
  {
    key: 'cimdEconomicDependency',
    label: 'CIMD Economic Dependency',
    shortLabel: 'Economic dependency',
    description: 'CIMD economic dependency dimension.',
    format: 'percent',
    category: 'deprivation',
  },
  {
    key: 'cimdSituationalVulnerability',
    label: 'CIMD Situational Vulnerability',
    shortLabel: 'Situational vulnerability',
    description: 'CIMD situational vulnerability dimension.',
    format: 'percent',
    category: 'deprivation',
  },
  {
    key: 'cimdEthnoCulturalComposition',
    label: 'CIMD Ethno-Cultural Composition',
    shortLabel: 'Ethno-cultural',
    description: 'CIMD ethno-cultural composition dimension.',
    format: 'percent',
    category: 'deprivation',
  },
]

const METRIC_DIRECTION: Record<ScoreMetricKey, ScoreMetricDirection> = {
  overallDensity: 'higherIsBetter',
  lowCostDensity: 'higherIsBetter',
  referenceDensity: 'higherIsBetter',
  networkVariety: 'higherIsBetter',
  parameterVariety: 'higherIsBetter',
  activeShare: 'higherIsBetter',
  monitorCount: 'higherIsBetter',
  parkDensity: 'higherIsBetter',
  parkAreaRatio: 'higherIsBetter',
  trailDensity: 'higherIsBetter',
  amenityDensity: 'higherIsBetter',
  parkAccessGap1Mile: 'higherIsWorse',
  treeDensity: 'higherIsBetter',
  matureTreeDensity: 'higherIsBetter',
  forestAreaRatio: 'higherIsBetter',
  coolingFacilityDensity: 'higherIsBetter',
  responseFacilityDensity: 'higherIsBetter',
  restaurantDensity: 'higherIsBetter',
  foodRiskScore: 'higherIsWorse',
  criticalViolationRate: 'higherIsWorse',
  followUpRate: 'higherIsWorse',
  populationDensity: 'higherIsWorse',
  parcelDensity: 'higherIsBetter',
  avgAssessedValue: 'higherIsBetter',
  valueGrowth10y: 'higherIsWorse',
  buildingAge: 'higherIsWorse',
  pre1980HousingShare: 'higherIsWorse',
  vacantParcelShare: 'higherIsWorse',
  multiFamilyShare: 'higherIsBetter',
  commercialShare: 'higherIsBetter',
  landValueShare: 'higherIsWorse',
  crimeDensity: 'higherIsWorse',
  crimePerCapita: 'higherIsWorse',
  recentCrimeShare: 'higherIsWorse',
  transitStopDensity: 'higherIsBetter',
  accessibleTransitStopDensity: 'higherIsBetter',
  transitShelterDensity: 'higherIsBetter',
  frequentTransitStopAccess: 'higherIsBetter',
  transitServiceSpan: 'higherIsBetter',
  transitTripsPerStop: 'higherIsBetter',
  accessibleFrequentTransitAccess: 'higherIsBetter',
  parkWalk10Access: 'higherIsBetter',
  parkWalk20Access: 'higherIsBetter',
  coolingWalk15Access: 'higherIsBetter',
  parkTransit20Access: 'higherIsBetter',
  serviceAccessComposite: 'higherIsBetter',
  canopyProxyRatio: 'higherIsBetter',
  shadeGap: 'higherIsWorse',
  cimdComposite: 'higherIsWorse',
  cimdResidentialInstability: 'higherIsWorse',
  cimdEconomicDependency: 'higherIsWorse',
  cimdSituationalVulnerability: 'higherIsWorse',
  cimdEthnoCulturalComposition: 'higherIsWorse',
}

const METRIC_COMPONENT: Record<ScoreMetricKey, ScoreMetricComponent> = {
  overallDensity: 'monitoringAdequacy',
  lowCostDensity: 'monitoringAdequacy',
  referenceDensity: 'monitoringAdequacy',
  networkVariety: 'monitoringAdequacy',
  parameterVariety: 'monitoringAdequacy',
  activeShare: 'monitoringAdequacy',
  monitorCount: 'monitoringAdequacy',
  parkDensity: 'adaptiveCapacity',
  parkAreaRatio: 'adaptiveCapacity',
  trailDensity: 'serviceAccess',
  amenityDensity: 'serviceAccess',
  parkAccessGap1Mile: 'environmentalBurden',
  treeDensity: 'adaptiveCapacity',
  matureTreeDensity: 'adaptiveCapacity',
  forestAreaRatio: 'adaptiveCapacity',
  coolingFacilityDensity: 'adaptiveCapacity',
  responseFacilityDensity: 'adaptiveCapacity',
  restaurantDensity: 'serviceAccess',
  foodRiskScore: 'environmentalBurden',
  criticalViolationRate: 'environmentalBurden',
  followUpRate: 'environmentalBurden',
  populationDensity: 'sensitivity',
  parcelDensity: 'housingPressure',
  avgAssessedValue: 'housingPressure',
  valueGrowth10y: 'housingPressure',
  buildingAge: 'housingPressure',
  pre1980HousingShare: 'housingPressure',
  vacantParcelShare: 'housingPressure',
  multiFamilyShare: 'adaptiveCapacity',
  commercialShare: 'serviceAccess',
  landValueShare: 'housingPressure',
  crimeDensity: 'safetyPressure',
  crimePerCapita: 'safetyPressure',
  recentCrimeShare: 'safetyPressure',
  transitStopDensity: 'serviceAccess',
  accessibleTransitStopDensity: 'serviceAccess',
  transitShelterDensity: 'adaptiveCapacity',
  frequentTransitStopAccess: 'serviceAccess',
  transitServiceSpan: 'serviceAccess',
  transitTripsPerStop: 'serviceAccess',
  accessibleFrequentTransitAccess: 'serviceAccess',
  parkWalk10Access: 'serviceAccess',
  parkWalk20Access: 'serviceAccess',
  coolingWalk15Access: 'adaptiveCapacity',
  parkTransit20Access: 'serviceAccess',
  serviceAccessComposite: 'serviceAccess',
  canopyProxyRatio: 'adaptiveCapacity',
  shadeGap: 'environmentalBurden',
  cimdComposite: 'sensitivity',
  cimdResidentialInstability: 'sensitivity',
  cimdEconomicDependency: 'sensitivity',
  cimdSituationalVulnerability: 'sensitivity',
  cimdEthnoCulturalComposition: 'sensitivity',
}

const METRIC_SPATIAL_METHOD: Record<ScoreMetricKey, ScoreSpatialMethod> = {
  overallDensity: 'pointInPolygon',
  lowCostDensity: 'pointInPolygon',
  referenceDensity: 'pointInPolygon',
  networkVariety: 'pointInPolygon',
  parameterVariety: 'pointInPolygon',
  activeShare: 'pointInPolygon',
  monitorCount: 'pointInPolygon',
  parkDensity: 'centroidInPolygon',
  parkAreaRatio: 'centroidInPolygon',
  trailDensity: 'midpointInPolygon',
  amenityDensity: 'pointInPolygon',
  parkAccessGap1Mile: 'bufferAreaIntersection',
  treeDensity: 'pointInPolygon',
  matureTreeDensity: 'pointInPolygon',
  forestAreaRatio: 'derivedRatio',
  coolingFacilityDensity: 'pointInPolygon',
  responseFacilityDensity: 'pointInPolygon',
  restaurantDensity: 'pointInPolygon',
  foodRiskScore: 'pointInPolygon',
  criticalViolationRate: 'pointInPolygon',
  followUpRate: 'pointInPolygon',
  populationDensity: 'centroidInPolygon',
  parcelDensity: 'directBoundaryJoin',
  avgAssessedValue: 'directBoundaryJoin',
  valueGrowth10y: 'directBoundaryJoin',
  buildingAge: 'directBoundaryJoin',
  pre1980HousingShare: 'directBoundaryJoin',
  vacantParcelShare: 'directBoundaryJoin',
  multiFamilyShare: 'directBoundaryJoin',
  commercialShare: 'directBoundaryJoin',
  landValueShare: 'directBoundaryJoin',
  crimeDensity: 'pointInPolygon',
  crimePerCapita: 'pointInPolygon',
  recentCrimeShare: 'pointInPolygon',
  transitStopDensity: 'pointInPolygon',
  accessibleTransitStopDensity: 'pointInPolygon',
  transitShelterDensity: 'pointInPolygon',
  frequentTransitStopAccess: 'derivedRatio',
  transitServiceSpan: 'pointInPolygon',
  transitTripsPerStop: 'pointInPolygon',
  accessibleFrequentTransitAccess: 'derivedRatio',
  parkWalk10Access: 'derivedRatio',
  parkWalk20Access: 'derivedRatio',
  coolingWalk15Access: 'derivedRatio',
  parkTransit20Access: 'derivedRatio',
  serviceAccessComposite: 'derivedRatio',
  canopyProxyRatio: 'derivedRatio',
  shadeGap: 'derivedRatio',
  cimdComposite: 'directBoundaryJoin',
  cimdResidentialInstability: 'directBoundaryJoin',
  cimdEconomicDependency: 'directBoundaryJoin',
  cimdSituationalVulnerability: 'directBoundaryJoin',
  cimdEthnoCulturalComposition: 'directBoundaryJoin',
}

const METRIC_UNCERTAINTY: Record<ScoreMetricKey, ScoreUncertaintyLevel> = {
  overallDensity: 'medium',
  lowCostDensity: 'medium',
  referenceDensity: 'low',
  networkVariety: 'medium',
  parameterVariety: 'medium',
  activeShare: 'medium',
  monitorCount: 'medium',
  parkDensity: 'medium',
  parkAreaRatio: 'high',
  trailDensity: 'medium',
  amenityDensity: 'medium',
  parkAccessGap1Mile: 'medium',
  treeDensity: 'high',
  matureTreeDensity: 'high',
  forestAreaRatio: 'high',
  coolingFacilityDensity: 'high',
  responseFacilityDensity: 'medium',
  restaurantDensity: 'medium',
  foodRiskScore: 'medium',
  criticalViolationRate: 'medium',
  followUpRate: 'medium',
  populationDensity: 'medium',
  parcelDensity: 'low',
  avgAssessedValue: 'low',
  valueGrowth10y: 'medium',
  buildingAge: 'medium',
  pre1980HousingShare: 'medium',
  vacantParcelShare: 'medium',
  multiFamilyShare: 'medium',
  commercialShare: 'medium',
  landValueShare: 'medium',
  crimeDensity: 'high',
  crimePerCapita: 'high',
  recentCrimeShare: 'high',
  transitStopDensity: 'medium',
  accessibleTransitStopDensity: 'medium',
  transitShelterDensity: 'medium',
  frequentTransitStopAccess: 'medium',
  transitServiceSpan: 'medium',
  transitTripsPerStop: 'medium',
  accessibleFrequentTransitAccess: 'medium',
  parkWalk10Access: 'high',
  parkWalk20Access: 'high',
  coolingWalk15Access: 'high',
  parkTransit20Access: 'high',
  serviceAccessComposite: 'high',
  canopyProxyRatio: 'high',
  shadeGap: 'high',
  cimdComposite: 'medium',
  cimdResidentialInstability: 'medium',
  cimdEconomicDependency: 'medium',
  cimdSituationalVulnerability: 'medium',
  cimdEthnoCulturalComposition: 'medium',
}

const METRIC_CAVEATS: Partial<Record<ScoreMetricKey, string>> = {
  parkAreaRatio: 'Uses park centroid assignment, so parks crossing a boundary are not area-weighted yet.',
  parkAccessGap1Mile:
    'Uses CityPG park/open-space polygons buffered by 1.6 km; it is an area-access screen, not a sidewalk-network walking-time model.',
  trailDensity: 'Uses trail midpoint assignment rather than network-length clipping by boundary.',
  treeDensity: 'Tree inventory coverage varies by source and is not a full canopy model.',
  matureTreeDensity: 'Maturity classification depends on source attributes and may be incomplete.',
  forestAreaRatio: 'Forest/open-space proxy is not a remote-sensing canopy or shade-quality layer.',
  coolingFacilityDensity: 'Cooling facility inventory is a proxy until verified public cooling-centre data is loaded.',
  populationDensity: 'Uses census unit centroids; future versions should support area or population weighting.',
  crimeDensity: 'Live point data can shift over time and should be interpreted as planning context, not official risk.',
  crimePerCapita: 'Combines live incidents with census population, so temporal alignment is approximate.',
  recentCrimeShare: 'Recent window is relative to the newest loaded incident date.',
  transitStopDensity:
    'Uses CityPG/BC Transit stop point inventory; route frequency and service span are not included yet.',
  accessibleTransitStopDensity: 'Uses the stop inventory Accessible flag, where populated.',
  transitShelterDensity:
    'Counts shelter and exchange subtype points; benches, lighting, and sidewalk flags are separate attributes.',
  frequentTransitStopAccess: 'Catchment accessibility estimate; not a network-certified travel-time model.',
  accessibleFrequentTransitAccess: 'Catchment accessibility estimate; depends on stop accessibility flags/proxies.',
  parkWalk10Access: 'Distance-decay catchment estimate; not a sidewalk-network travel-time model.',
  parkWalk20Access: 'Distance-decay catchment estimate; not a sidewalk-network travel-time model.',
  coolingWalk15Access: 'Cooling/community facility inventory is a proxy until verified public cooling-centre data is loaded.',
  parkTransit20Access: 'Transit-assisted park access is estimated from nearby service, not full itinerary planning.',
  serviceAccessComposite: 'Composite catchment estimate; review component metrics before making site decisions.',
  canopyProxyRatio: 'Derived from tree inventory buffers and forest/open-space proxies, not remote-sensing canopy.',
  shadeGap: 'Screening proxy for planning triage, not a validated heat exposure model.',
  cimdComposite: 'Area-level deprivation context; do not infer individual deprivation.',
  cimdResidentialInstability: 'Area-level deprivation context; do not infer individual deprivation.',
  cimdEconomicDependency: 'Area-level deprivation context; do not infer individual deprivation.',
  cimdSituationalVulnerability: 'Area-level deprivation context; do not infer individual deprivation.',
  cimdEthnoCulturalComposition: 'Area-level deprivation context; do not infer individual deprivation.',
}

const METRIC_INDEX_MODULE: Record<ScoreMetricKey, ScoreIndexModule> = {
  overallDensity: 'localContext',
  lowCostDensity: 'localContext',
  referenceDensity: 'localContext',
  networkVariety: 'localContext',
  parameterVariety: 'localContext',
  activeShare: 'localContext',
  monitorCount: 'localContext',
  parkDensity: 'environmentalBurden',
  parkAreaRatio: 'environmentalBurden',
  trailDensity: 'environmentalBurden',
  amenityDensity: 'localContext',
  parkAccessGap1Mile: 'environmentalBurden',
  treeDensity: 'climateBurden',
  matureTreeDensity: 'climateBurden',
  forestAreaRatio: 'climateBurden',
  coolingFacilityDensity: 'climateBurden',
  responseFacilityDensity: 'localContext',
  restaurantDensity: 'localContext',
  foodRiskScore: 'environmentalBurden',
  criticalViolationRate: 'environmentalBurden',
  followUpRate: 'environmentalBurden',
  populationDensity: 'socialVulnerability',
  parcelDensity: 'localContext',
  avgAssessedValue: 'socialVulnerability',
  valueGrowth10y: 'environmentalBurden',
  buildingAge: 'environmentalBurden',
  pre1980HousingShare: 'environmentalBurden',
  vacantParcelShare: 'environmentalBurden',
  multiFamilyShare: 'socialVulnerability',
  commercialShare: 'localContext',
  landValueShare: 'environmentalBurden',
  crimeDensity: 'environmentalBurden',
  crimePerCapita: 'environmentalBurden',
  recentCrimeShare: 'environmentalBurden',
  transitStopDensity: 'environmentalBurden',
  accessibleTransitStopDensity: 'environmentalBurden',
  transitShelterDensity: 'environmentalBurden',
  frequentTransitStopAccess: 'environmentalBurden',
  transitServiceSpan: 'environmentalBurden',
  transitTripsPerStop: 'environmentalBurden',
  accessibleFrequentTransitAccess: 'environmentalBurden',
  parkWalk10Access: 'environmentalBurden',
  parkWalk20Access: 'environmentalBurden',
  coolingWalk15Access: 'climateBurden',
  parkTransit20Access: 'environmentalBurden',
  serviceAccessComposite: 'environmentalBurden',
  canopyProxyRatio: 'climateBurden',
  shadeGap: 'climateBurden',
  cimdComposite: 'socialVulnerability',
  cimdResidentialInstability: 'socialVulnerability',
  cimdEconomicDependency: 'socialVulnerability',
  cimdSituationalVulnerability: 'socialVulnerability',
  cimdEthnoCulturalComposition: 'socialVulnerability',
}

const METRIC_INDEX_DOMAIN: Record<ScoreMetricKey, ScoreIndexDomain> = {
  overallDensity: 'monitoring',
  lowCostDensity: 'monitoring',
  referenceDensity: 'monitoring',
  networkVariety: 'monitoring',
  parameterVariety: 'monitoring',
  activeShare: 'monitoring',
  monitorCount: 'monitoring',
  parkDensity: 'builtEnvironment',
  parkAreaRatio: 'builtEnvironment',
  trailDensity: 'builtEnvironment',
  amenityDensity: 'services',
  parkAccessGap1Mile: 'builtEnvironment',
  treeDensity: 'heat',
  matureTreeDensity: 'heat',
  forestAreaRatio: 'heat',
  coolingFacilityDensity: 'heat',
  responseFacilityDensity: 'services',
  restaurantDensity: 'services',
  foodRiskScore: 'foodSafety',
  criticalViolationRate: 'foodSafety',
  followUpRate: 'foodSafety',
  populationDensity: 'demographics',
  parcelDensity: 'housing',
  avgAssessedValue: 'socioeconomic',
  valueGrowth10y: 'housing',
  buildingAge: 'builtEnvironment',
  pre1980HousingShare: 'builtEnvironment',
  vacantParcelShare: 'housing',
  multiFamilyShare: 'housing',
  commercialShare: 'services',
  landValueShare: 'housing',
  crimeDensity: 'publicSafety',
  crimePerCapita: 'publicSafety',
  recentCrimeShare: 'publicSafety',
  transitStopDensity: 'transportationInfrastructure',
  accessibleTransitStopDensity: 'transportationInfrastructure',
  transitShelterDensity: 'transportationInfrastructure',
  frequentTransitStopAccess: 'transportationInfrastructure',
  transitServiceSpan: 'transportationInfrastructure',
  transitTripsPerStop: 'transportationInfrastructure',
  accessibleFrequentTransitAccess: 'transportationInfrastructure',
  parkWalk10Access: 'builtEnvironment',
  parkWalk20Access: 'builtEnvironment',
  coolingWalk15Access: 'heat',
  parkTransit20Access: 'transportationInfrastructure',
  serviceAccessComposite: 'services',
  canopyProxyRatio: 'heat',
  shadeGap: 'heat',
  cimdComposite: 'socioeconomic',
  cimdResidentialInstability: 'housing',
  cimdEconomicDependency: 'socioeconomic',
  cimdSituationalVulnerability: 'demographics',
  cimdEthnoCulturalComposition: 'demographics',
}

const METRIC_VALUE_BEHAVIOR: Partial<Record<ScoreMetricKey, ScoreMetricValueBehavior>> = {
  overallDensity: 'inverseContinuous',
  lowCostDensity: 'inverseContinuous',
  referenceDensity: 'inverseContinuous',
  networkVariety: 'inverseContinuous',
  parameterVariety: 'inverseContinuous',
  activeShare: 'inverseContinuous',
  parkDensity: 'inverseContinuous',
  parkAreaRatio: 'inverseContinuous',
  trailDensity: 'inverseContinuous',
  amenityDensity: 'inverseContinuous',
  parkAccessGap1Mile: 'continuous',
  treeDensity: 'inverseContinuous',
  matureTreeDensity: 'inverseContinuous',
  forestAreaRatio: 'inverseContinuous',
  coolingFacilityDensity: 'inverseContinuous',
  responseFacilityDensity: 'inverseContinuous',
  restaurantDensity: 'inverseContinuous',
  transitStopDensity: 'inverseContinuous',
  accessibleTransitStopDensity: 'inverseContinuous',
  transitShelterDensity: 'inverseContinuous',
  frequentTransitStopAccess: 'inverseContinuous',
  transitServiceSpan: 'inverseContinuous',
  transitTripsPerStop: 'inverseContinuous',
  accessibleFrequentTransitAccess: 'inverseContinuous',
  parkWalk10Access: 'inverseContinuous',
  parkWalk20Access: 'inverseContinuous',
  coolingWalk15Access: 'inverseContinuous',
  parkTransit20Access: 'inverseContinuous',
  serviceAccessComposite: 'inverseContinuous',
  canopyProxyRatio: 'inverseContinuous',
  avgAssessedValue: 'inverseContinuous',
  multiFamilyShare: 'inverseContinuous',
}

const METRIC_MISSING_DATA_POLICY: Partial<Record<ScoreMetricKey, ScoreMissingDataPolicy>> = {
  cimdComposite: 'excludeRegion',
  cimdResidentialInstability: 'excludeRegion',
  cimdEconomicDependency: 'excludeRegion',
  cimdSituationalVulnerability: 'excludeRegion',
  cimdEthnoCulturalComposition: 'excludeRegion',
  shadeGap: 'neutral',
  canopyProxyRatio: 'neutral',
  coolingWalk15Access: 'neutral',
}

function metricDataSourceLabel(category: ScoreMetricDefinition['category']): string {
  if (category === 'airQuality') return 'Air quality monitor inventory'
  if (category === 'parksRec') return 'City of Prince George parks, trails, and amenities'
  if (category === 'heatShade') return 'City/open-data heat and shade proxy layers'
  if (category === 'foodSafety') return 'Northern Health food facility inspections'
  if (category === 'demographics') return 'Statistics Canada census boundary data'
  if (category === 'property') return 'BC Assessment parcel data'
  if (category === 'safety') return 'City of Prince George crime incidents'
  if (category === 'transit') return 'City of Prince George transit stop inventory'
  if (category === 'deprivation') return 'Statistics Canada CIMD 2021'
  return 'PGMaps data source'
}

function metricSourceUrl(category: ScoreMetricDefinition['category']): string | undefined {
  if (category === 'transit') return 'https://www.bctransit.com/open-data/'
  if (category === 'deprivation') return 'https://www150.statcan.gc.ca/n1/pub/45-20-0001/452000012023001-eng.htm'
  if (category === 'heatShade' || category === 'parksRec') return 'https://www.princegeorge.ca/city-hall/maps-information-requests/open-data'
  return undefined
}

export const SCORE_METRICS: ScoreMetricDefinition[] = SCORE_METRIC_BASES.map((metric) => ({
  ...metric,
  direction: METRIC_DIRECTION[metric.key],
  component: METRIC_COMPONENT[metric.key],
  dataSourceLabel: metricDataSourceLabel(metric.category),
  spatialMethod: METRIC_SPATIAL_METHOD[metric.key],
  uncertainty: METRIC_UNCERTAINTY[metric.key],
  caveat: METRIC_CAVEATS[metric.key],
  directionLabel: METRIC_DIRECTION[metric.key] === 'higherIsWorse' ? 'lower helps' : 'higher helps',
  sourceUrl: metricSourceUrl(metric.category),
  freshnessLabel:
    metric.category === 'deprivation'
      ? '2021 Census / CIMD correction 2024'
      : metric.category === 'transit'
        ? 'Latest synced CityPG/BC Transit data'
        : 'Latest bundled PGMaps data',
  comparisonBasis: 'Compared within the currently loaded boundary level',
  indexModule: METRIC_INDEX_MODULE[metric.key],
  indexDomain: METRIC_INDEX_DOMAIN[metric.key],
  valueBehavior:
    METRIC_VALUE_BEHAVIOR[metric.key] ??
    (METRIC_DIRECTION[metric.key] === 'higherIsWorse' ? 'continuous' : 'inverseContinuous'),
  missingDataPolicy: METRIC_MISSING_DATA_POLICY[metric.key] ?? 'neutral',
  proxyLevel:
    metric.category === 'deprivation' || metric.category === 'demographics' || metric.category === 'property'
      ? 'proxy'
      : 'experimental',
}))

export const SCORE_METRICS_BY_CATEGORY = SCORE_METRICS.reduce(
  (acc, metric) => {
    if (!acc[metric.category]) acc[metric.category] = []
    acc[metric.category].push(metric)
    return acc
  },
  {} as Record<string, ScoreMetricDefinition[]>,
)

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
  parkAccessGap1Mile: 0,
  treeDensity: 0,
  matureTreeDensity: 0,
  forestAreaRatio: 0,
  coolingFacilityDensity: 0,
  responseFacilityDensity: 0,
  restaurantDensity: 0,
  foodRiskScore: 0,
  criticalViolationRate: 0,
  followUpRate: 0,
  populationDensity: 0,
  parcelDensity: 0,
  avgAssessedValue: 0,
  valueGrowth10y: 0,
  buildingAge: 0,
  pre1980HousingShare: 0,
  vacantParcelShare: 0,
  multiFamilyShare: 0,
  commercialShare: 0,
  landValueShare: 0,
  crimeDensity: 0,
  crimePerCapita: 0,
  recentCrimeShare: 0,
  transitStopDensity: 0,
  accessibleTransitStopDensity: 0,
  transitShelterDensity: 0,
  frequentTransitStopAccess: 0,
  transitServiceSpan: 0,
  transitTripsPerStop: 0,
  accessibleFrequentTransitAccess: 0,
  parkWalk10Access: 0,
  parkWalk20Access: 0,
  coolingWalk15Access: 0,
  parkTransit20Access: 0,
  serviceAccessComposite: 0,
  canopyProxyRatio: 0,
  shadeGap: 0,
  cimdComposite: 0,
  cimdResidentialInstability: 0,
  cimdEconomicDependency: 0,
  cimdSituationalVulnerability: 0,
  cimdEthnoCulturalComposition: 0,
}

export const DEFAULT_SCORE_WEIGHTS: ScoreMetricWeightMap = {
  ...ZERO_WEIGHTS,
  overallDensity: 45,
  lowCostDensity: 15,
  referenceDensity: 25,
  networkVariety: 8,
  parameterVariety: 4,
  activeShare: 3,
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
      activeShare: 3,
    },
    methodSettings: WINSORIZED_METHOD,
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
      activeShare: 10,
    },
    methodSettings: WINSORIZED_METHOD,
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
      monitorCount: 5,
    },
    methodSettings: WINSORIZED_METHOD,
  },
  {
    key: 'livabilityIndex',
    label: 'Livability Index',
    description: 'Holistic livability: parks, food access, air coverage, and lower crowding pressure.',
    weights: {
      ...ZERO_WEIGHTS,
      parkDensity: 20,
      parkAreaRatio: 18,
      trailDensity: 12,
      amenityDensity: 8,
      restaurantDensity: 12,
      foodRiskScore: -15,
      populationDensity: -10,
      overallDensity: 8,
      activeShare: 7,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'environmentalHealth',
    label: 'Environmental Health',
    description: 'Air quality coverage combined with green space access and lower population exposure.',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 18,
      lowCostDensity: 10,
      activeShare: 8,
      parkAreaRatio: 22,
      parkDensity: 14,
      trailDensity: 10,
      amenityDensity: 5,
      populationDensity: -8,
      networkVariety: 5,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'climateCommunityHealth',
    label: 'Climate + Health Vulnerability Proxy',
    description:
      'Proxy vulnerability recipe using density, housing, parks, safety, food, monitoring gaps, and CityPG shade/cooling proxy layers.',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 18,
      overallDensity: -14,
      lowCostDensity: -8,
      referenceDensity: -10,
      parkAreaRatio: -16,
      treeDensity: -8,
      forestAreaRatio: -8,
      coolingFacilityDensity: -4,
      trailDensity: -8,
      amenityDensity: -6,
      avgAssessedValue: -10,
      vacantParcelShare: 7,
      buildingAge: 8,
      crimePerCapita: 8,
      foodRiskScore: 5,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'sensorGapEquity',
    label: 'Sensor Gap + Equity Proxy',
    description: 'Proxy recipe for populated areas with weak monitor coverage and low adaptive-capacity signals.',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 28,
      overallDensity: -26,
      lowCostDensity: -18,
      referenceDensity: -16,
      networkVariety: -6,
      parkAreaRatio: -4,
      activeShare: -2,
    },
    methodSettings: WINSORIZED_METHOD,
  },
  {
    key: 'schoolExposureMobility',
    label: 'School Access + Safety Proxy',
    description:
      'Proxy recipe for child-serving areas: parks/trails, stronger monitoring, and lower food/safety pressure help.',
    boundarySources: ['cityPG', 'census'],
    recommendedBoundarySource: 'cityPG',
    recommendedBoundaryLevel: 'elementarySchoolCatchment',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 18,
      parkDensity: 14,
      trailDensity: 16,
      amenityDensity: 10,
      overallDensity: 12,
      referenceDensity: 8,
      foodRiskScore: -8,
      criticalViolationRate: -6,
      crimePerCapita: -8,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'monitoringGapProxy',
    label: 'Monitoring Gap 2.0 Proxy',
    description: 'Higher scores flag populated areas where additional air monitoring may add value.',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 30,
      overallDensity: -28,
      referenceDensity: -18,
      lowCostDensity: -14,
      networkVariety: -5,
      activeShare: -5,
    },
    methodSettings: WINSORIZED_METHOD,
  },
  {
    key: 'heatShadeNeedProxy',
    label: 'Heat + Shade Need Proxy',
    description:
      'Higher scores flag dense areas with older housing, weaker tree/forest cover, and fewer cooling proxies.',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 22,
      buildingAge: 16,
      avgAssessedValue: -8,
      treeDensity: -16,
      matureTreeDensity: -12,
      forestAreaRatio: -18,
      coolingFacilityDensity: -8,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'shadeGapHeatMap',
    label: 'Shade Gap Heat Map',
    description: 'Single-layer heat-map score: high values mark areas with lower canopy and weaker cooling access.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      shadeGap: 100,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'canopyCoolingHeatMap',
    label: 'Canopy + Cooling Heat Map',
    description: 'Single-theme heat-map score for stronger canopy proxy and cooling/community facility access.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      canopyProxyRatio: 60,
      coolingWalk15Access: 40,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'housingClimateRetrofitNeed',
    label: 'Housing Climate Retrofit Proxy',
    description: 'Proxy recipe for older, lower-resource housing areas with weaker adaptive-capacity signals.',
    weights: {
      ...ZERO_WEIGHTS,
      buildingAge: 26,
      avgAssessedValue: -20,
      multiFamilyShare: 12,
      populationDensity: 12,
      parkAreaRatio: -10,
      overallDensity: -8,
      valueGrowth10y: -6,
      parcelDensity: 6,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'foodSafetyAccess',
    label: 'Food Safety + Access',
    description: 'Higher scores flag areas with food access but lower inspection pressure and better context.',
    weights: {
      ...ZERO_WEIGHTS,
      restaurantDensity: 26,
      foodRiskScore: -22,
      criticalViolationRate: -18,
      followUpRate: -10,
      populationDensity: 12,
      crimePerCapita: -7,
      amenityDensity: 5,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'hbeLinkagesIndex',
    label: 'HBE Linkages Index',
    description:
      'Healthy Built Environment toolkit proxy combining complete neighbourhoods, active mobility, nature access, food context, housing, and equity.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'ct',
    weights: {
      ...ZERO_WEIGHTS,
      serviceAccessComposite: 14,
      parkWalk10Access: 10,
      accessibleFrequentTransitAccess: 10,
      transitServiceSpan: 8,
      canopyProxyRatio: 10,
      coolingWalk15Access: 8,
      restaurantDensity: 8,
      foodRiskScore: -6,
      criticalViolationRate: -4,
      multiFamilyShare: 7,
      avgAssessedValue: -6,
      valueGrowth10y: -5,
      crimePerCapita: -6,
      cimdComposite: -8,
    },
    methodSettings: MODULE_PERCENTILE_METHOD,
  },
  {
    key: 'hbeCompleteNeighbourhood',
    label: 'HBE Complete Neighbourhood',
    description:
      'Toolkit neighbourhood-design proxy for compact, connected places with mixed services, parks, housing choice, and lower safety pressure.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      serviceAccessComposite: 22,
      parkWalk10Access: 14,
      transitStopDensity: 10,
      restaurantDensity: 10,
      parcelDensity: 8,
      multiFamilyShare: 10,
      commercialShare: 8,
      populationDensity: 8,
      crimePerCapita: -10,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'hbeActiveTransportation',
    label: 'HBE Active Transportation',
    description:
      'Toolkit transportation-network proxy for accessible transit, connected trails, active-mobility service reach, and lower safety pressure.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      trailDensity: 18,
      transitStopDensity: 16,
      accessibleTransitStopDensity: 14,
      frequentTransitStopAccess: 14,
      accessibleFrequentTransitAccess: 14,
      transitServiceSpan: 10,
      transitShelterDensity: 6,
      crimePerCapita: -8,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'hbeNaturalEnvironmentAccess',
    label: 'HBE Nature + Cooling Access',
    description:
      'Toolkit natural-environments proxy for park access, canopy, forest/open-space cover, cooling access, and lower shade gaps.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      parkWalk10Access: 18,
      parkWalk20Access: 10,
      parkTransit20Access: 8,
      parkAreaRatio: 12,
      trailDensity: 8,
      canopyProxyRatio: 16,
      forestAreaRatio: 10,
      coolingWalk15Access: 12,
      shadeGap: -6,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'hbeFoodAccessResilience',
    label: 'HBE Food Access + Resilience',
    description:
      'Toolkit food-systems proxy using available food premises, service access, transit reach, and lower inspection-risk pressure until grocery and food-program layers are added.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      restaurantDensity: 18,
      serviceAccessComposite: 16,
      accessibleFrequentTransitAccess: 12,
      transitServiceSpan: 8,
      populationDensity: 8,
      cimdEconomicDependency: -12,
      foodRiskScore: -14,
      criticalViolationRate: -8,
      followUpRate: -4,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'hbeHousingQualityHazards',
    label: 'HBE Housing Quality + Hazards',
    description:
      'Toolkit housing proxy for affordability, housing choice, older-stock retrofit need, shade/cooling gaps, and nearby local burden.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      avgAssessedValue: -18,
      valueGrowth10y: -12,
      multiFamilyShare: 12,
      buildingAge: -8,
      pre1980HousingShare: -8,
      canopyProxyRatio: 10,
      coolingWalk15Access: 10,
      shadeGap: -10,
      crimePerCapita: -8,
      cimdComposite: -4,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'transitAccess',
    label: 'Transit Access',
    description:
      'Scores areas with stronger stop coverage, accessible-stop proxies, shelters/exchanges, and nearby demand.',
    boundarySources: ['census', 'cityPG'],
    weights: {
      ...ZERO_WEIGHTS,
      transitStopDensity: 30,
      accessibleTransitStopDensity: 28,
      transitShelterDensity: 22,
      populationDensity: 12,
      amenityDensity: 8,
    },
  },
  {
    key: 'cumulativeEquityBurden',
    label: 'Cumulative Equity Burden',
    description: 'CalEnviroScreen-style overlap of local burden, deprivation vulnerability, and adaptive-capacity gaps.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      foodRiskScore: 16,
      criticalViolationRate: 10,
      crimePerCapita: 18,
      valueGrowth10y: 8,
      buildingAge: 8,
      shadeGap: 16,
      cimdComposite: 20,
      cimdEconomicDependency: 10,
      populationDensity: 10,
      parkWalk10Access: 12,
      coolingWalk15Access: 10,
      serviceAccessComposite: 8,
    },
    methodSettings: CUMULATIVE_BURDEN_METHOD,
  },
  {
    key: 'pgEnvironmentalJusticeProxy',
    label: 'PG Environmental Justice Proxy',
    description:
      'EJI-inspired local screen combining social vulnerability context, environmental burden proxies, and adaptive-capacity gaps.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      cimdComposite: 18,
      cimdResidentialInstability: 8,
      cimdEconomicDependency: 10,
      cimdSituationalVulnerability: 12,
      populationDensity: 10,
      shadeGap: 18,
      crimePerCapita: 12,
      foodRiskScore: 8,
      criticalViolationRate: 6,
      buildingAge: 8,
      parkWalk10Access: 10,
      coolingWalk15Access: 10,
      accessibleFrequentTransitAccess: 8,
      serviceAccessComposite: 8,
    },
    methodSettings: MODULE_PERCENTILE_METHOD,
  },
  {
    key: 'pgSocialEnvironmentalRank',
    label: 'PG Social-Environmental Rank',
    description: 'EJI SER-style local screen using social vulnerability and environmental burden modules, without health.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      cimdComposite: 18,
      cimdResidentialInstability: 8,
      cimdEconomicDependency: 10,
      populationDensity: 8,
      foodRiskScore: 10,
      criticalViolationRate: 8,
      crimePerCapita: 12,
      buildingAge: 8,
      parkWalk10Access: 10,
      serviceAccessComposite: 8,
    },
    methodSettings: MODULE_PERCENTILE_METHOD,
  },
  {
    key: 'heatReliefPriority',
    label: 'Heat Relief Priority',
    description: 'Prioritizes populated, deprivation-affected areas with shade/cooling gaps and older housing.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      shadeGap: 28,
      canopyProxyRatio: 18,
      coolingWalk15Access: 16,
      buildingAge: 14,
      cimdSituationalVulnerability: 14,
      cimdComposite: 10,
      populationDensity: 10,
    },
    methodSettings: CUMULATIVE_BURDEN_METHOD,
  },
  {
    key: 'parkAccessEquity',
    label: 'Park Access Equity',
    description: 'Ranks park access gaps with deprivation and population context using catchment accessibility estimates.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      parkWalk10Access: 28,
      parkWalk20Access: 18,
      parkTransit20Access: 12,
      parkAreaRatio: 10,
      amenityDensity: 8,
      cimdComposite: 14,
      populationDensity: 10,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'transitEquity',
    label: 'Transit Equity',
    description: 'Scores frequent, accessible, sheltered, longer-span transit service against population and deprivation need.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      frequentTransitStopAccess: 24,
      accessibleFrequentTransitAccess: 20,
      transitServiceSpan: 16,
      transitTripsPerStop: 14,
      transitShelterDensity: 8,
      cimdEconomicDependency: 10,
      populationDensity: 8,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'investmentPriority',
    label: 'Investment Priority',
    description: 'Screening preset for stable high-burden, high-need areas with low adaptive capacity.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      cimdComposite: 18,
      shadeGap: 18,
      crimePerCapita: 14,
      foodRiskScore: 10,
      buildingAge: 10,
      parkWalk10Access: 12,
      accessibleFrequentTransitAccess: 10,
      serviceAccessComposite: 8,
    },
    methodSettings: CUMULATIVE_BURDEN_METHOD,
  },
  {
    key: 'communityResilienceProxy',
    label: 'Community Resilience Proxy',
    description: 'Higher scores combine monitoring, parks, services, housing mix, and lower safety/food pressure.',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 10,
      activeShare: 6,
      parkAreaRatio: 16,
      parkDensity: 10,
      trailDensity: 10,
      amenityDensity: 8,
      restaurantDensity: 6,
      foodRiskScore: -8,
      multiFamilyShare: 8,
      buildingAge: -8,
      crimePerCapita: -10,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'housingAffordability',
    label: 'Housing Affordability',
    description: 'Highlights lower values, slower price pressure, older stock, multi-family mix, and vacant capacity.',
    weights: {
      ...ZERO_WEIGHTS,
      avgAssessedValue: -32,
      valueGrowth10y: -22,
      multiFamilyShare: 18,
      parcelDensity: 8,
      buildingAge: 8,
      vacantParcelShare: 6,
      populationDensity: 6,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'redevelopmentPressure',
    label: 'Redevelopment Pressure',
    description: 'Finds areas with high land value share, vacant land, older buildings, and rapid value growth.',
    weights: {
      ...ZERO_WEIGHTS,
      valueGrowth10y: 28,
      landValueShare: 22,
      vacantParcelShare: 18,
      buildingAge: 14,
      commercialShare: 8,
      parcelDensity: 6,
      populationDensity: 4,
    },
    methodSettings: Z_SCORE_METHOD,
  },
  {
    key: 'completeNeighbourhood',
    label: 'Complete Neighbourhood',
    description: 'Balances services, parks, trails, density, and housing mix.',
    weights: {
      ...ZERO_WEIGHTS,
      restaurantDensity: 16,
      parkDensity: 14,
      trailDensity: 12,
      amenityDensity: 10,
      populationDensity: 12,
      parcelDensity: 8,
      multiFamilyShare: 8,
      foodRiskScore: -6,
      criticalViolationRate: -6,
      crimePerCapita: -8,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'foodInspectionRisk',
    label: 'Food Inspection Risk',
    description: 'Prioritizes restaurant areas with more critical violations, follow-ups, and hazard risk.',
    weights: {
      ...ZERO_WEIGHTS,
      criticalViolationRate: 34,
      followUpRate: 24,
      foodRiskScore: 22,
      restaurantDensity: 10,
      populationDensity: 10,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'safetyPressure',
    label: 'Safety Pressure',
    description: 'Ranks areas by crime density, per-capita incident load, and recent activity.',
    weights: {
      ...ZERO_WEIGHTS,
      crimeDensity: 35,
      crimePerCapita: 35,
      recentCrimeShare: 15,
      populationDensity: 10,
      parcelDensity: 5,
    },
    methodSettings: PERCENTILE_METHOD,
  },
]

function formatPresetNormalization(method: Partial<ScoreMethodSettings> | undefined): string {
  if (method?.aggregation === 'modulePercentileRankedSum') return 'EJI-style module percentile ranks'
  if (method?.aggregation === 'cumulativeBurden') return 'Percentile + cumulative burden'
  if (method?.normalization === 'winsorizedMinMax') return 'Winsorized min-max'
  if (method?.normalization === 'zScore') return 'Z-score'
  if (method?.normalization === 'minMax') return 'Min-max'
  return 'Percentile rank'
}

function isProxyPreset(preset: ScorePreset): boolean {
  return /proxy|climate|heat|shade|retrofit|school|equity|justice/i.test(
    `${preset.key} ${preset.label} ${preset.description}`,
  )
}

function getPresetDataNeeded(preset: ScorePreset): string[] {
  const text = `${preset.key} ${preset.label} ${preset.description}`.toLowerCase()
  const needed = new Set<string>()
  if (/climate|heat|shade/.test(text)) {
    needed.add('Observed heat days or land-surface temperature')
    needed.add('Tree canopy, shade, impervious surface, and cooling/clean-air facilities')
  }
  if (/climate|smoke|monitor|sensor|air/.test(text)) {
    needed.add('Pollutant-specific exposure surfaces, smoke days, and model uncertainty')
  }
  if (/equity|justice|resilience|vulnerability|community/.test(text)) {
    needed.add('Documented social-vulnerability policy variables and weighting rationale')
  }
  if (/school/.test(text)) {
    needed.add('School locations, catchments, student counts, walking routes, and traffic exposure')
  }
  if (/retrofit|housing/.test(text)) {
    needed.add('Energy-efficiency, indoor cooling/filtration, tenancy, and program eligibility data')
  }
  if (/food/.test(text)) {
    needed.add('Grocery access, vehicle access, transit access, and food-service capacity data')
  }
  if (/hbe|built environment|linkages|active transportation|nature/.test(text)) {
    needed.add('HBE evidence crosswalk linking each proxy metric to toolkit feature, planning principle, and evidence direction')
  }
  if (/redevelopment/.test(text)) {
    needed.add('Development applications, zoning, tenure, displacement-risk, and parcel transaction data')
  }
  if (needed.size === 0) needed.add('No major extra data required for the current proxy recipe.')
  return Array.from(needed)
}

export function getScorePresetMethodology(preset: ScorePreset): ScorePresetMethodology {
  const activeMetrics = SCORE_METRICS.filter((metric) => preset.weights[metric.key] !== 0)
  const components = Array.from(new Set(activeMetrics.map((metric) => METRIC_CATEGORY_LABELS[metric.category])))
  const proxy = isProxyPreset(preset)

  return {
    purpose: preset.description,
    components,
    normalization: formatPresetNormalization(preset.methodSettings),
    proxy,
    knownLimits: proxy
      ? [
          'This is a proxy recipe, not a validated exposure, health, or environmental-justice index.',
          'It is inspired by cumulative-burden screening methods, but it is not the CDC/ATSDR EJI and should not be compared to national EJI percentiles.',
          'Scores are normalized within the selected boundary level, so CT/DA/CHSA maps should not be read as identical scales.',
          'Point-in-polygon and centroid-style assignments can miss cross-boundary access, exposure, and service catchments.',
        ]
      : [
          'Scores are normalized within the selected boundary level, so boundary changes can change ranks.',
          'The recipe summarizes available indicators; it does not replace source-data review or field validation.',
        ],
    dataNeeded: getPresetDataNeeded(preset),
  }
}

const SCORE_DATA_SOURCE_ORDER: ScoreDataSource[] = [
  'airQuality',
  'parks',
  'heatShade',
  'restaurants',
  'census',
  'bcAssessment',
  'crime',
  'transit',
  'deprivation',
]

function metricCategoryToDataSource(category: string): ScoreDataSource | null {
  if (category === 'airQuality') return 'airQuality'
  if (category === 'parksRec') return 'parks'
  if (category === 'heatShade') return 'heatShade'
  if (category === 'foodSafety') return 'restaurants'
  if (category === 'demographics') return 'census'
  if (category === 'property') return 'bcAssessment'
  if (category === 'safety') return 'crime'
  if (category === 'transit') return 'transit'
  if (category === 'deprivation') return 'deprivation'
  return null
}

export function getScoreDataSourcesForWeights(weights: ScoreMetricWeightMap): ScoreDataSource[] {
  const sources = new Set<ScoreDataSource>()

  SCORE_METRICS.forEach((metric) => {
    if (weights[metric.key] === 0) return
    const source = metricCategoryToDataSource(metric.category)
    if (source) sources.add(source)
    if (metric.key === 'crimePerCapita') sources.add('census')
  })

  return SCORE_DATA_SOURCE_ORDER.filter((source) => sources.has(source))
}

export const SCORE_EXAMPLES: ScoreExample[] = [
  // ── Census boundaries ────────────────────────────────────────────────

  // Census Tract (CT) – 23 tracts, good neighbourhood-level analysis
  {
    key: 'greenestNeighbourhoods',
    label: 'Greenest Neighbourhoods',
    question: 'Which parts of PG have the best park and trail access?',
    description:
      'Scores each census tract by park coverage, trail density, and amenity access. High-scoring areas have more green space per resident.',
    boundarySource: 'census',
    boundaryLevel: 'ct',
    dataSources: ['parks', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      parkDensity: 22,
      parkAreaRatio: 28,
      trailDensity: 20,
      amenityDensity: 15,
      populationDensity: 15,
    },
  },
  {
    key: 'airQualityGapsCt',
    label: 'Air Monitoring Gaps (Tract)',
    question: 'Which PG tracts are underserved by air quality sensors?',
    description:
      'Highlights census tracts where sensor density is low relative to population. Low-scoring tracts are monitoring blind spots.',
    boundarySource: 'census',
    boundaryLevel: 'ct',
    dataSources: ['airQuality', 'census'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 30,
      lowCostDensity: 15,
      referenceDensity: 20,
      networkVariety: 8,
      activeShare: 7,
      populationDensity: -20,
    },
  },
  {
    key: 'foodSafetyCt',
    label: 'Food Safety Landscape (Tract)',
    question: 'How does restaurant density and food safety risk vary across PG tracts?',
    description:
      'Scores each tract by restaurant access and inspection risk. Negative weight on food risk means safer areas score higher.',
    boundarySource: 'census',
    boundaryLevel: 'ct',
    dataSources: ['parks', 'restaurants', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      restaurantDensity: 35,
      foodRiskScore: -30,
      populationDensity: 20,
      amenityDensity: 15,
    },
  },
  {
    key: 'communityLivabilityCt',
    label: 'Community Livability (Tract)',
    question: 'Which PG tracts score highest across parks, food, air quality, and population?',
    description:
      'A holistic index blending all available data at the tract level. Best-scoring areas have parks, food options, air monitoring, and population.',
    boundarySource: 'census',
    boundaryLevel: 'ct',
    dataSources: ['airQuality', 'parks', 'restaurants', 'census'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      parkAreaRatio: 15,
      parkDensity: 10,
      trailDensity: 10,
      amenityDensity: 5,
      restaurantDensity: 10,
      foodRiskScore: -10,
      overallDensity: 12,
      activeShare: 5,
      networkVariety: 3,
      populationDensity: 10,
      lowCostDensity: 5,
      referenceDensity: 5,
    },
  },

  // Dissemination Area (DA) – 135 areas, fine-grained analysis
  {
    key: 'lowCostSensorDeploymentDa',
    label: 'Community Sensor Gaps (DA)',
    question: 'Where should community air sensors be prioritized at the block level?',
    description:
      'Uses 135 dissemination areas to find fine-grained gaps. Areas with high population but few PA/EGG sensors score lowest.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['airQuality', 'census'],
    networkFilter: ['PA', 'EGG'],
    weights: {
      ...ZERO_WEIGHTS,
      lowCostDensity: 35,
      overallDensity: 15,
      activeShare: 10,
      populationDensity: -25,
      parameterVariety: 8,
      networkVariety: 7,
    },
  },
  {
    key: 'parkAccessDa',
    label: 'Park Access (DA)',
    question: 'Which small neighbourhoods have the least green space access?',
    description:
      'Fine-grained view using 135 dissemination areas. Low-scoring areas lack nearby parks, trails, and amenities relative to their population.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['parks', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      parkDensity: 20,
      parkAreaRatio: 30,
      trailDensity: 18,
      amenityDensity: 12,
      populationDensity: -20,
    },
  },
  {
    key: 'foodAccessDa',
    label: 'Food Access (DA)',
    question: 'Which dissemination areas are food deserts or have high inspection risk?',
    description:
      'Fine-grained restaurant coverage across 135 areas. Highlights both under-served areas and areas with high food safety risk.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['parks', 'restaurants', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      restaurantDensity: 40,
      foodRiskScore: -25,
      populationDensity: 20,
      amenityDensity: 15,
    },
  },
  {
    key: 'livabilityDa',
    label: 'Livability Index (DA)',
    question: 'Holistic livability scored at the most granular level in PG?',
    description: 'Blends all data sources across 135 dissemination areas for the most detailed livability picture.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['airQuality', 'parks', 'restaurants', 'census'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      parkAreaRatio: 15,
      parkDensity: 8,
      trailDensity: 8,
      amenityDensity: 5,
      restaurantDensity: 8,
      foodRiskScore: -8,
      overallDensity: 12,
      activeShare: 6,
      networkVariety: 4,
      populationDensity: 12,
      lowCostDensity: 6,
      referenceDensity: 7,
    },
  },
  {
    key: 'pgClimateHealthVulnerabilityDa',
    label: 'PG Climate + Health Vulnerability Proxy (DA)',
    question: 'Which small areas have higher cumulative climate and community-health vulnerability?',
    description:
      'Research-backed starter index that combines exposure proxies, population sensitivity, property vulnerability, and adaptive capacity. High scores mark areas needing closer review.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['airQuality', 'parks', 'heatShade', 'restaurants', 'census', 'bcAssessment', 'crime'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 18,
      overallDensity: -14,
      lowCostDensity: -8,
      referenceDensity: -10,
      parkAreaRatio: -16,
      treeDensity: -8,
      forestAreaRatio: -8,
      coolingFacilityDensity: -4,
      trailDensity: -8,
      amenityDensity: -6,
      avgAssessedValue: -10,
      vacantParcelShare: 7,
      buildingAge: 8,
      crimePerCapita: 8,
      foodRiskScore: 5,
    },
  },
  {
    key: 'pgEnvironmentalJusticeProxyDa',
    label: 'PG Environmental Justice Proxy (DA)',
    question: 'Which small areas show overlapping local burden, deprivation context, and adaptive-capacity gaps?',
    description:
      'CDC EJI-inspired local screen using module percentile-ranked sums. This is a local proxy, not the official ATSDR Environmental Justice Index.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['heatShade', 'restaurants', 'census', 'bcAssessment', 'crime', 'transit', 'deprivation'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      cimdComposite: 18,
      cimdResidentialInstability: 8,
      cimdEconomicDependency: 10,
      cimdSituationalVulnerability: 12,
      populationDensity: 10,
      shadeGap: 18,
      crimePerCapita: 12,
      foodRiskScore: 8,
      criticalViolationRate: 6,
      buildingAge: 8,
      parkWalk10Access: 10,
      coolingWalk15Access: 10,
      accessibleFrequentTransitAccess: 8,
      serviceAccessComposite: 8,
    },
    methodSettings: MODULE_PERCENTILE_METHOD,
  },
  {
    key: 'pgSocialEnvironmentalRankDa',
    label: 'PG Social-Environmental Rank (DA)',
    question: 'Which areas have overlapping social vulnerability and environmental burden, before health data is considered?',
    description:
      'EJI SER-style example that ranks social vulnerability and environmental burden modules, then combines those module ranks without health vulnerability.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['heatShade', 'restaurants', 'census', 'bcAssessment', 'crime', 'transit', 'deprivation'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      cimdComposite: 18,
      cimdResidentialInstability: 8,
      cimdEconomicDependency: 10,
      populationDensity: 8,
      foodRiskScore: 10,
      criticalViolationRate: 8,
      crimePerCapita: 12,
      buildingAge: 8,
      parkWalk10Access: 10,
      serviceAccessComposite: 8,
    },
    methodSettings: MODULE_PERCENTILE_METHOD,
  },
  {
    key: 'heatShadeNeedDa',
    label: 'Heat + Shade Need Proxy (DA)',
    question: 'Which small areas have higher heat adaptation need based on real shade and facility proxies?',
    description:
      'Uses the CityPG tree inventory, forest layers, community-facility proxies, building age, values, and population density. High scores mark areas needing closer heat/shade review.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['heatShade', 'census', 'bcAssessment'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 22,
      buildingAge: 16,
      avgAssessedValue: -8,
      treeDensity: -16,
      matureTreeDensity: -12,
      forestAreaRatio: -18,
      coolingFacilityDensity: -8,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'shadeGapHeatMapDa',
    label: 'Shade Gap Heat Map (DA)',
    question: 'Where does a one-layer heat-map score show the largest shade and cooling gap?',
    description:
      'Uses the score builder heat-map lens as a score: high-ranking dissemination areas have lower canopy proxy and weaker cooling access.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['heatShade'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      shadeGap: 100,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'canopyCoolingHeatMapDa',
    label: 'Canopy + Cooling Heat Map (DA)',
    question: 'Which small areas look strongest for shade and cooling-service coverage?',
    description:
      'A compact heat-map score built from canopy proxy and cooling-facility access, useful as a positive heat-resilience layer.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['heatShade'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      canopyProxyRatio: 60,
      coolingWalk15Access: 40,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'sensorGapEquityDa',
    label: 'Sensor Gap + Equity Proxy (DA)',
    question: 'Where should PG prioritize new community air-quality monitors?',
    description:
      'Ranks populated areas with weaker monitor density, less network variety, and fewer nearby adaptive-capacity proxies.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['airQuality', 'parks', 'census'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 28,
      overallDensity: -26,
      lowCostDensity: -18,
      referenceDensity: -16,
      networkVariety: -6,
      parkAreaRatio: -4,
      activeShare: -2,
    },
  },
  {
    key: 'schoolExposureMobilityDa',
    label: 'School Exposure + Active Mobility Proxy (DA)',
    question: 'Which areas look stronger for child-serving mobility and lower exposure pressure?',
    description:
      'A near-term school proxy using population, trails, parks, amenities, monitor coverage, food-risk, and safety pressure until school points and catchments are fully wired in.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['airQuality', 'parks', 'restaurants', 'census', 'crime'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 18,
      parkDensity: 14,
      trailDensity: 16,
      amenityDensity: 10,
      overallDensity: -12,
      referenceDensity: -8,
      foodRiskScore: -8,
      criticalViolationRate: -6,
      crimePerCapita: -8,
    },
  },
  {
    key: 'housingAffordabilityDa',
    label: 'Housing Affordability (DA)',
    question: 'Which small areas combine lower assessed values with more housing choice?',
    description:
      'Uses BC Assessment parcels to balance lower values, multi-family share, parcel density, and recent value growth.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['bcAssessment', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      avgAssessedValue: -34,
      valueGrowth10y: -22,
      multiFamilyShare: 18,
      parcelDensity: 10,
      buildingAge: 8,
      populationDensity: 8,
    },
  },
  {
    key: 'redevelopmentPressureDa',
    label: 'Redevelopment Pressure (DA)',
    question: 'Where does PG show the strongest property redevelopment pressure?',
    description:
      'Highlights DAs with older buildings, high land-value share, vacant parcels, and rapid assessment growth.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['bcAssessment', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      valueGrowth10y: 28,
      landValueShare: 22,
      vacantParcelShare: 18,
      buildingAge: 14,
      commercialShare: 8,
      parcelDensity: 6,
      populationDensity: 4,
    },
  },
  {
    key: 'completeNeighbourhoodDa',
    label: 'Complete Neighbourhood (DA)',
    question: 'Which small neighbourhoods have the best mix of services, parks, housing, and safety?',
    description:
      'Combines food, parks, trails, housing mix, density, and crime per capita into a neighbourhood completeness score.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['restaurants', 'parks', 'bcAssessment', 'census', 'crime'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      restaurantDensity: 15,
      parkDensity: 12,
      trailDensity: 10,
      amenityDensity: 8,
      populationDensity: 12,
      parcelDensity: 8,
      multiFamilyShare: 8,
      foodRiskScore: -6,
      criticalViolationRate: -6,
      crimePerCapita: -15,
    },
  },
  {
    key: 'foodInspectionRiskDa',
    label: 'Food Inspection Risk (DA)',
    question: 'Which restaurant clusters have higher inspection risk?',
    description: 'Looks beyond hazard rating by adding critical violation rate and follow-up inspection rate.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['restaurants', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      criticalViolationRate: 34,
      followUpRate: 24,
      foodRiskScore: 22,
      restaurantDensity: 10,
      populationDensity: 10,
    },
  },
  {
    key: 'crimePressureDa',
    label: 'Crime Pressure (DA)',
    question: 'Where are incident counts high relative to area and population?',
    description:
      'Uses live PG crime points with census population to score density, per-capita risk, and recent activity.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['crime', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      crimeDensity: 35,
      crimePerCapita: 35,
      recentCrimeShare: 15,
      populationDensity: 15,
    },
  },

  // Census Subdivision (CSD) – 1 unit (city-wide), useful as a baseline
  {
    key: 'cityOverviewCsd',
    label: 'City Overview (CSD)',
    question: 'What is the overall livability score for Prince George as a municipality?',
    description: 'Single census subdivision view. Useful as a baseline to compare with finer-grained levels.',
    boundarySource: 'census',
    boundaryLevel: 'csd',
    dataSources: ['airQuality', 'parks', 'restaurants', 'census'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      parkAreaRatio: 15,
      parkDensity: 10,
      trailDensity: 10,
      restaurantDensity: 10,
      foodRiskScore: -10,
      overallDensity: 15,
      activeShare: 5,
      populationDensity: 10,
      amenityDensity: 8,
      networkVariety: 7,
    },
  },

  // ── Health Authority boundaries ──────────────────────────────────────

  // Health Authority (HA) – 5 regions, province-wide comparison
  {
    key: 'provincialAirQualityHa',
    label: 'Provincial Air Quality (HA)',
    question: "Which of BC's 5 health authorities has the best sensor coverage?",
    description:
      'Compares the 5 health authorities across BC by overall sensor density, network variety, and reference station coverage.',
    boundarySource: 'bcHealth',
    boundaryLevel: 'healthAuthority',
    dataSources: ['airQuality'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 30,
      referenceDensity: 25,
      lowCostDensity: 15,
      networkVariety: 14,
      parameterVariety: 6,
      activeShare: 10,
    },
  },

  // HSDA – 16 regions, sub-regional comparison
  {
    key: 'hsdaSensorCoverage',
    label: 'Sensor Coverage (HSDA)',
    question: 'Which health service delivery areas across BC have monitoring gaps?',
    description: 'Uses 16 HSDAs across BC. Reveals which sub-regions rely on community sensors vs. reference stations.',
    boundarySource: 'bcHealth',
    boundaryLevel: 'hsda',
    dataSources: ['airQuality'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 28,
      lowCostDensity: 18,
      referenceDensity: 22,
      networkVariety: 12,
      activeShare: 10,
      parameterVariety: 5,
      monitorCount: 5,
    },
  },

  // LHA – ~89 regions, local area comparison
  {
    key: 'lhaMonitoringComparison',
    label: 'Local Health Area Monitoring (LHA)',
    question: 'How does air quality monitoring compare across BC local health areas?',
    description: 'Compares ~89 LHAs across BC by sensor network coverage, variety, and active monitoring rates.',
    boundarySource: 'bcHealth',
    boundaryLevel: 'lha',
    dataSources: ['airQuality'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 35,
      lowCostDensity: 15,
      referenceDensity: 20,
      networkVariety: 12,
      parameterVariety: 6,
      activeShare: 8,
      monitorCount: 4,
    },
  },
  {
    key: 'lhaLowCostExpansion',
    label: 'Low-Cost Expansion Targets (LHA)',
    question: 'Which LHAs would benefit most from more PurpleAir/EGG community sensors?',
    description:
      'Prioritizes local health areas with low community sensor density but existing reference coverage. Low scores = best expansion targets.',
    boundarySource: 'bcHealth',
    boundaryLevel: 'lha',
    dataSources: ['airQuality'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      lowCostDensity: 35,
      referenceDensity: -15,
      activeShare: 12,
      networkVariety: 15,
      parameterVariety: 8,
      overallDensity: 10,
      monitorCount: -5,
    },
  },

  // CHSA – ~200+ regions, community-level comparison
  {
    key: 'chsaSensorCoverage',
    label: 'Community Health Sensor Coverage (CHSA)',
    question: 'Which community health service areas across BC have the worst sensor coverage?',
    description:
      'The most granular health boundary level with ~200+ areas. Shows fine-grained provincial monitoring gaps.',
    boundarySource: 'bcHealth',
    boundaryLevel: 'chsa',
    dataSources: ['airQuality'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      overallDensity: 30,
      lowCostDensity: 20,
      referenceDensity: 18,
      networkVariety: 10,
      activeShare: 10,
      parameterVariety: 5,
      monitorCount: 7,
    },
  },
  {
    key: 'chsaReferenceGaps',
    label: 'Reference Station Gaps (CHSA)',
    question: 'Which community areas lack government-grade reference monitoring?',
    description:
      'Highlights CHSAs that rely entirely on community sensors with no reference stations. Low scores = regulatory monitoring gaps.',
    boundarySource: 'bcHealth',
    boundaryLevel: 'chsa',
    dataSources: ['airQuality'],
    networkFilter: 'all',
    weights: {
      ...ZERO_WEIGHTS,
      referenceDensity: 45,
      overallDensity: 15,
      activeShare: 15,
      parameterVariety: 10,
      networkVariety: 8,
      monitorCount: 7,
    },
  },
]

function getRecommendedExampleMethodSettings(example: ScoreExample): Partial<ScoreMethodSettings> {
  if (example.key.toLowerCase().includes('redevelopment')) return Z_SCORE_METHOD
  const airOnly = example.dataSources.length === 1 && example.dataSources[0] === 'airQuality'
  const monitoringGap = /gap|sensor|monitor|air quality/i.test(`${example.label} ${example.question}`)
  if (airOnly || monitoringGap) return WINSORIZED_METHOD
  return PERCENTILE_METHOD
}

export const SCORE_BUILDER_EXAMPLES: ScoreExample[] = SCORE_EXAMPLES.map((example) => ({
  ...example,
  methodSettings: example.methodSettings ?? getRecommendedExampleMethodSettings(example),
})).filter(
  (example) =>
    (example.boundarySource === 'census' && (example.boundaryLevel === 'ct' || example.boundaryLevel === 'da')) ||
    example.boundarySource === 'bcHealth',
)

export const DENSITY_METRIC_OPTIONS: ScoreMetricKey[] = [
  'overallDensity',
  'lowCostDensity',
  'referenceDensity',
  'monitorCount',
  'parkDensity',
  'trailDensity',
  'amenityDensity',
  'treeDensity',
  'matureTreeDensity',
  'coolingFacilityDensity',
  'responseFacilityDensity',
  'restaurantDensity',
  'populationDensity',
  'parcelDensity',
  'avgAssessedValue',
  'valueGrowth10y',
  'buildingAge',
  'crimeDensity',
  'crimePerCapita',
  'transitStopDensity',
  'accessibleTransitStopDensity',
  'transitShelterDensity',
  'frequentTransitStopAccess',
  'transitServiceSpan',
  'transitTripsPerStop',
  'accessibleFrequentTransitAccess',
  'parkWalk10Access',
  'parkWalk20Access',
  'coolingWalk15Access',
  'parkTransit20Access',
  'serviceAccessComposite',
  'canopyProxyRatio',
  'shadeGap',
  'cimdComposite',
  'cimdResidentialInstability',
  'cimdEconomicDependency',
  'cimdSituationalVulnerability',
  'cimdEthnoCulturalComposition',
]

export const LOW_COST_NETWORKS = new Set(['PA', 'EGG'])

export {
  BOUNDARY_SOURCE_OPTIONS,
  HEALTH_BOUNDARY_LEVEL_OPTIONS,
  CENSUS_BOUNDARY_LEVEL_OPTIONS,
  REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS,
  CITY_BOUNDARY_LEVEL_OPTIONS,
  WATERSHED_BOUNDARY_LEVEL_OPTIONS,
  BOUNDARY_FILE_BY_LEVEL,
  BOUNDARY_INDEX_KEY_BY_LEVEL,
  BOUNDARY_CODE_PROPERTY_BY_LEVEL,
  BOUNDARY_NAME_PROPERTY_BY_LEVEL,
} from '@/lib/studyArea'
import { HEALTH_BOUNDARY_LEVEL_OPTIONS as _SCORE_BUILDER_HEALTH_BOUNDARY_LEVEL_OPTIONS } from '@/lib/studyArea'

// Backward-compatible alias used by existing imports.
export const BOUNDARY_LEVEL_OPTIONS = _SCORE_BUILDER_HEALTH_BOUNDARY_LEVEL_OPTIONS

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
    parkAccessGap1Mile: initial,
    treeDensity: initial,
    matureTreeDensity: initial,
    forestAreaRatio: initial,
    coolingFacilityDensity: initial,
    responseFacilityDensity: initial,
    restaurantDensity: initial,
    foodRiskScore: initial,
    criticalViolationRate: initial,
    followUpRate: initial,
    populationDensity: initial,
    parcelDensity: initial,
    avgAssessedValue: initial,
    valueGrowth10y: initial,
    buildingAge: initial,
    pre1980HousingShare: initial,
    vacantParcelShare: initial,
    multiFamilyShare: initial,
    commercialShare: initial,
    landValueShare: initial,
    crimeDensity: initial,
    crimePerCapita: initial,
    recentCrimeShare: initial,
    transitStopDensity: initial,
    accessibleTransitStopDensity: initial,
    transitShelterDensity: initial,
    frequentTransitStopAccess: initial,
    transitServiceSpan: initial,
    transitTripsPerStop: initial,
    accessibleFrequentTransitAccess: initial,
    parkWalk10Access: initial,
    parkWalk20Access: initial,
    coolingWalk15Access: initial,
    parkTransit20Access: initial,
    serviceAccessComposite: initial,
    canopyProxyRatio: initial,
    shadeGap: initial,
    cimdComposite: initial,
    cimdResidentialInstability: initial,
    cimdEconomicDependency: initial,
    cimdSituationalVulnerability: initial,
    cimdEthnoCulturalComposition: initial,
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

export const SCORE_PALETTE_PROFILES: Record<ScorePaletteKey, ScorePaletteProfile> = {
  airCoverage: {
    key: 'airCoverage',
    label: 'Coverage score',
    colors: ['#7f1d1d', '#c2410c', '#a16207', '#4d7c0f', '#166534'],
    legend: { low: 'Lower coverage', high: 'Higher coverage' },
  },
  benefit: {
    key: 'benefit',
    label: 'Benefit score',
    colors: ['#fefce8', '#bef264', '#84cc16', '#22c55e', '#14532d'],
    legend: { low: 'Lower benefit', high: 'Higher benefit' },
  },
  affordability: {
    key: 'affordability',
    label: 'Affordability score',
    colors: ['#eff6ff', '#bae6fd', '#67e8f9', '#14b8a6', '#0f766e'],
    legend: { low: 'Less affordable', high: 'More affordable' },
  },
  riskPressure: {
    key: 'riskPressure',
    label: 'Risk / pressure score',
    colors: ['#fef08a', '#fb923c', '#ef4444', '#be123c', '#581c87'],
    legend: { low: 'Lower pressure', high: 'Higher pressure' },
  },
  default: {
    key: 'default',
    label: 'Composite score',
    colors: ['#7f1d1d', '#b91c1c', '#b45309', '#4d7c0f', '#166534'],
    legend: { low: 'Lower priority', high: 'Higher priority' },
  },
}

const SCORE_PRESET_PALETTE_KEYS: Record<string, ScorePaletteKey> = {
  balancedCoverage: 'airCoverage',
  lowCostExpansion: 'airCoverage',
  referenceNetwork: 'airCoverage',
  livabilityIndex: 'benefit',
  environmentalHealth: 'benefit',
  climateCommunityHealth: 'riskPressure',
  sensorGapEquity: 'riskPressure',
  schoolExposureMobility: 'benefit',
  monitoringGapProxy: 'riskPressure',
  heatShadeNeedProxy: 'riskPressure',
  shadeGapHeatMap: 'riskPressure',
  canopyCoolingHeatMap: 'benefit',
  housingClimateRetrofitNeed: 'riskPressure',
  foodSafetyAccess: 'benefit',
  hbeLinkagesIndex: 'benefit',
  hbeCompleteNeighbourhood: 'benefit',
  hbeActiveTransportation: 'benefit',
  hbeNaturalEnvironmentAccess: 'benefit',
  hbeFoodAccessResilience: 'benefit',
  hbeHousingQualityHazards: 'affordability',
  transitAccess: 'benefit',
  communityResilienceProxy: 'benefit',
  housingAffordability: 'affordability',
  redevelopmentPressure: 'riskPressure',
  completeNeighbourhood: 'benefit',
  foodInspectionRisk: 'riskPressure',
  safetyPressure: 'riskPressure',
}

const SCORE_EXAMPLE_PALETTE_KEYS: Record<string, ScorePaletteKey> = {
  greenestNeighbourhoods: 'benefit',
  airQualityGapsCt: 'airCoverage',
  foodSafetyCt: 'benefit',
  communityLivabilityCt: 'benefit',
  lowCostSensorDeploymentDa: 'airCoverage',
  parkAccessDa: 'benefit',
  foodAccessDa: 'benefit',
  livabilityDa: 'benefit',
  pgClimateHealthVulnerabilityDa: 'riskPressure',
  heatShadeNeedDa: 'riskPressure',
  shadeGapHeatMapDa: 'riskPressure',
  canopyCoolingHeatMapDa: 'benefit',
  sensorGapEquityDa: 'riskPressure',
  schoolExposureMobilityDa: 'benefit',
  housingAffordabilityDa: 'affordability',
  redevelopmentPressureDa: 'riskPressure',
  completeNeighbourhoodDa: 'benefit',
  foodInspectionRiskDa: 'riskPressure',
  crimePressureDa: 'riskPressure',
  cityOverviewCsd: 'benefit',
  provincialAirQualityHa: 'airCoverage',
  hsdaSensorCoverage: 'airCoverage',
  lhaMonitoringComparison: 'airCoverage',
  lhaLowCostExpansion: 'airCoverage',
  chsaSensorCoverage: 'airCoverage',
  chsaReferenceGaps: 'airCoverage',
}

function interpolateChannel(start: number, end: number, ratio: number): number {
  return Math.round(start + (end - start) * ratio)
}

function interpolateHexColor(start: string, end: string, ratio: number): string {
  const startValue = Number.parseInt(start.slice(1), 16)
  const endValue = Number.parseInt(end.slice(1), 16)
  const sr = (startValue >> 16) & 255
  const sg = (startValue >> 8) & 255
  const sb = startValue & 255
  const er = (endValue >> 16) & 255
  const eg = (endValue >> 8) & 255
  const eb = endValue & 255
  const r = interpolateChannel(sr, er, ratio).toString(16).padStart(2, '0')
  const g = interpolateChannel(sg, eg, ratio).toString(16).padStart(2, '0')
  const b = interpolateChannel(sb, eb, ratio).toString(16).padStart(2, '0')
  return `#${r}${g}${b}`
}

export function getScorePaletteProfile(
  activePresetKey: string | null,
  activeExampleKey: string | null,
): ScorePaletteProfile {
  const paletteKey =
    (activeExampleKey ? SCORE_EXAMPLE_PALETTE_KEYS[activeExampleKey] : undefined) ||
    (activePresetKey ? SCORE_PRESET_PALETTE_KEYS[activePresetKey] : undefined) ||
    'default'
  return SCORE_PALETTE_PROFILES[paletteKey]
}

export function getScorePaletteColor(score: number, profile: ScorePaletteProfile): string {
  if (!Number.isFinite(score)) return profile.colors[0]
  const normalizedScore = Math.max(0, Math.min(100, score)) / 100
  const scaledIndex = normalizedScore * (profile.colors.length - 1)
  const lowerIndex = Math.floor(scaledIndex)
  const upperIndex = Math.min(profile.colors.length - 1, lowerIndex + 1)
  const lowerColor = profile.colors[lowerIndex] || profile.colors[0]
  const upperColor = profile.colors[upperIndex] || lowerColor
  return interpolateHexColor(lowerColor, upperColor, scaledIndex - lowerIndex)
}

export function encodeWeightsToParams(weights: ScoreMetricWeightMap): string {
  return SCORE_METRICS.map((m) => weights[m.key]).join(',')
}

export function decodeWeightsFromParams(param: string): ScoreMetricWeightMap | null {
  const parts = param.split(',').map(Number)
  if (parts.length > SCORE_METRICS.length || parts.some((v) => !Number.isFinite(v))) return null
  const weights = createMetricValueMap(0) as ScoreMetricWeightMap
  SCORE_METRICS.forEach((m, i) => {
    weights[m.key] = Math.max(-100, Math.min(100, Math.round(parts[i] ?? 0)))
  })
  return weights
}
