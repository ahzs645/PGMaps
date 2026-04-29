import type { BoundaryIndex, BoundaryLevel, BoundarySource, CensusBoundaryLevel } from '@/maps/airquality'
import type { ScoreExample, ScoreMetricDefinition, ScoreMetricKey, ScoreMetricWeightMap, ScorePreset } from './types'

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
  {
    key: 'criticalViolationRate',
    label: 'Critical Violation Rate',
    shortLabel: 'Critical rate',
    description: 'Critical violations per inspection for restaurants in each boundary.',
    format: 'ratio',
    category: 'foodSafety'
  },
  {
    key: 'followUpRate',
    label: 'Follow-Up Inspection Rate',
    shortLabel: 'Follow-up rate',
    description: 'Share of inspections that required a follow-up.',
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
  },
  // Property & Housing
  {
    key: 'parcelDensity',
    label: 'Parcel Density',
    shortLabel: 'Parcel density',
    description: 'BC Assessment parcels per km².',
    format: 'density',
    category: 'property'
  },
  {
    key: 'avgAssessedValue',
    label: 'Average Assessed Value',
    shortLabel: 'Avg. value',
    description: 'Average total assessed parcel value.',
    format: 'currency',
    category: 'property'
  },
  {
    key: 'valueGrowth10y',
    label: '10-Year Value Growth',
    shortLabel: '10y growth',
    description: 'Average parcel value growth across available assessment history.',
    format: 'percent',
    category: 'property'
  },
  {
    key: 'buildingAge',
    label: 'Average Building Age',
    shortLabel: 'Building age',
    description: 'Average age of parcels with a known year built.',
    format: 'years',
    category: 'property'
  },
  {
    key: 'vacantParcelShare',
    label: 'Vacant Parcel Share',
    shortLabel: 'Vacant share',
    description: 'Share of parcels classified as vacant.',
    format: 'percent',
    category: 'property'
  },
  {
    key: 'multiFamilyShare',
    label: 'Multi-Family Share',
    shortLabel: 'Multi-family',
    description: 'Share of parcels classified as multi-family.',
    format: 'percent',
    category: 'property'
  },
  {
    key: 'commercialShare',
    label: 'Commercial Parcel Share',
    shortLabel: 'Commercial',
    description: 'Share of parcels classified as commercial.',
    format: 'percent',
    category: 'property'
  },
  {
    key: 'landValueShare',
    label: 'Land Value Share',
    shortLabel: 'Land value',
    description: 'Share of assessed value assigned to land rather than buildings.',
    format: 'percent',
    category: 'property'
  },
  // Safety
  {
    key: 'crimeDensity',
    label: 'Crime Density',
    shortLabel: 'Crime density',
    description: 'Crime incidents per km².',
    format: 'density',
    category: 'safety'
  },
  {
    key: 'crimePerCapita',
    label: 'Crime Per Capita',
    shortLabel: 'Crime/capita',
    description: 'Crime incidents per resident based on census population.',
    format: 'ratio',
    category: 'safety'
  },
  {
    key: 'recentCrimeShare',
    label: 'Recent Crime Share',
    shortLabel: 'Recent crime',
    description: 'Share of incidents from the most recent 180 days in the loaded data.',
    format: 'percent',
    category: 'safety'
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
  criticalViolationRate: 0,
  followUpRate: 0,
  populationDensity: 0,
  parcelDensity: 0,
  avgAssessedValue: 0,
  valueGrowth10y: 0,
  buildingAge: 0,
  vacantParcelShare: 0,
  multiFamilyShare: 0,
  commercialShare: 0,
  landValueShare: 0,
  crimeDensity: 0,
  crimePerCapita: 0,
  recentCrimeShare: 0
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
  },
  {
    key: 'housingAffordability',
    label: 'Housing Affordability',
    description: 'Highlights areas with lower values, more multi-family parcels, and less recent price pressure.',
    weights: {
      ...ZERO_WEIGHTS,
      avgAssessedValue: -32,
      valueGrowth10y: -22,
      multiFamilyShare: 18,
      parcelDensity: 8,
      buildingAge: 8,
      vacantParcelShare: 6,
      populationDensity: 6
    }
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
      populationDensity: 4
    }
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
      crimePerCapita: -8
    }
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
      populationDensity: 10
    }
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
      parcelDensity: 5
    }
  }
]

export const SCORE_EXAMPLES: ScoreExample[] = [
  // ── Census boundaries ────────────────────────────────────────────────

  // Census Tract (CT) – 23 tracts, good neighbourhood-level analysis
  {
    key: 'greenestNeighbourhoods',
    label: 'Greenest Neighbourhoods',
    question: 'Which parts of PG have the best park and trail access?',
    description: 'Scores each census tract by park coverage, trail density, and amenity access. High-scoring areas have more green space per resident.',
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
      populationDensity: 15
    }
  },
  {
    key: 'airQualityGapsCt',
    label: 'Air Monitoring Gaps (Tract)',
    question: 'Which PG tracts are underserved by air quality sensors?',
    description: 'Highlights census tracts where sensor density is low relative to population. Low-scoring tracts are monitoring blind spots.',
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
      populationDensity: -20
    }
  },
  {
    key: 'foodSafetyCt',
    label: 'Food Safety Landscape (Tract)',
    question: 'How does restaurant density and food safety risk vary across PG tracts?',
    description: 'Scores each tract by restaurant access and inspection risk. Negative weight on food risk means safer areas score higher.',
    boundarySource: 'census',
    boundaryLevel: 'ct',
    dataSources: ['restaurants', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      restaurantDensity: 35,
      foodRiskScore: -30,
      populationDensity: 20,
      amenityDensity: 15
    }
  },
  {
    key: 'communityLivabilityCt',
    label: 'Community Livability (Tract)',
    question: 'Which PG tracts score highest across parks, food, air quality, and population?',
    description: 'A holistic index blending all available data at the tract level. Best-scoring areas have parks, food options, air monitoring, and population.',
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
      referenceDensity: 5
    }
  },

  // Dissemination Area (DA) – 135 areas, fine-grained analysis
  {
    key: 'lowCostSensorDeploymentDa',
    label: 'Community Sensor Gaps (DA)',
    question: 'Where should community air sensors be prioritized at the block level?',
    description: 'Uses 135 dissemination areas to find fine-grained gaps. Areas with high population but few PA/EGG sensors score lowest.',
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
      networkVariety: 7
    }
  },
  {
    key: 'parkAccessDa',
    label: 'Park Access (DA)',
    question: 'Which small neighbourhoods have the least green space access?',
    description: 'Fine-grained view using 135 dissemination areas. Low-scoring areas lack nearby parks, trails, and amenities relative to their population.',
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
      populationDensity: -20
    }
  },
  {
    key: 'foodAccessDa',
    label: 'Food Access (DA)',
    question: 'Which dissemination areas are food deserts or have high inspection risk?',
    description: 'Fine-grained restaurant coverage across 135 areas. Highlights both under-served areas and areas with high food safety risk.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['restaurants', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      restaurantDensity: 40,
      foodRiskScore: -25,
      populationDensity: 20,
      amenityDensity: 15
    }
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
      referenceDensity: 7
    }
  },
  {
    key: 'housingAffordabilityDa',
    label: 'Housing Affordability (DA)',
    question: 'Which small areas combine lower assessed values with more housing choice?',
    description: 'Uses BC Assessment parcels to balance lower values, multi-family share, parcel density, and recent value growth.',
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
      populationDensity: 8
    }
  },
  {
    key: 'redevelopmentPressureDa',
    label: 'Redevelopment Pressure (DA)',
    question: 'Where does PG show the strongest property redevelopment pressure?',
    description: 'Highlights DAs with older buildings, high land-value share, vacant parcels, and rapid assessment growth.',
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
      populationDensity: 4
    }
  },
  {
    key: 'completeNeighbourhoodDa',
    label: 'Complete Neighbourhood (DA)',
    question: 'Which small neighbourhoods have the best mix of services, parks, housing, and safety?',
    description: 'Combines food, parks, trails, housing mix, density, and crime per capita into a neighbourhood completeness score.',
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
      crimePerCapita: -15
    }
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
      populationDensity: 10
    }
  },
  {
    key: 'crimePressureDa',
    label: 'Crime Pressure (DA)',
    question: 'Where are incident counts high relative to area and population?',
    description: 'Uses live PG crime points with census population to score density, per-capita risk, and recent activity.',
    boundarySource: 'census',
    boundaryLevel: 'da',
    dataSources: ['crime', 'census'],
    networkFilter: 'none',
    weights: {
      ...ZERO_WEIGHTS,
      crimeDensity: 35,
      crimePerCapita: 35,
      recentCrimeShare: 15,
      populationDensity: 15
    }
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
      networkVariety: 7
    }
  },

  // ── Health Authority boundaries ──────────────────────────────────────

  // Health Authority (HA) – 5 regions, province-wide comparison
  {
    key: 'provincialAirQualityHa',
    label: 'Provincial Air Quality (HA)',
    question: 'Which of BC\'s 5 health authorities has the best sensor coverage?',
    description: 'Compares the 5 health authorities across BC by overall sensor density, network variety, and reference station coverage.',
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
      activeShare: 10
    }
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
      monitorCount: 5
    }
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
      monitorCount: 4
    }
  },
  {
    key: 'lhaLowCostExpansion',
    label: 'Low-Cost Expansion Targets (LHA)',
    question: 'Which LHAs would benefit most from more PurpleAir/EGG community sensors?',
    description: 'Prioritizes local health areas with low community sensor density but existing reference coverage. Low scores = best expansion targets.',
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
      monitorCount: -5
    }
  },

  // CHSA – ~200+ regions, community-level comparison
  {
    key: 'chsaSensorCoverage',
    label: 'Community Health Sensor Coverage (CHSA)',
    question: 'Which community health service areas across BC have the worst sensor coverage?',
    description: 'The most granular health boundary level with ~200+ areas. Shows fine-grained provincial monitoring gaps.',
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
      monitorCount: 7
    }
  },
  {
    key: 'chsaReferenceGaps',
    label: 'Reference Station Gaps (CHSA)',
    question: 'Which community areas lack government-grade reference monitoring?',
    description: 'Highlights CHSAs that rely entirely on community sensors with no reference stations. Low scores = regulatory monitoring gaps.',
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
      monitorCount: 7
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
  'populationDensity',
  'parcelDensity',
  'avgAssessedValue',
  'valueGrowth10y',
  'buildingAge',
  'crimeDensity',
  'crimePerCapita'
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
    criticalViolationRate: initial,
    followUpRate: initial,
    populationDensity: initial,
    parcelDensity: initial,
    avgAssessedValue: initial,
    valueGrowth10y: initial,
    buildingAge: initial,
    vacantParcelShare: initial,
    multiFamilyShare: initial,
    commercialShare: initial,
    landValueShare: initial,
    crimeDensity: initial,
    crimePerCapita: initial,
    recentCrimeShare: initial
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
    legend: { low: 'Lower coverage', high: 'Higher coverage' }
  },
  benefit: {
    key: 'benefit',
    label: 'Benefit score',
    colors: ['#fefce8', '#bef264', '#84cc16', '#22c55e', '#14532d'],
    legend: { low: 'Lower benefit', high: 'Higher benefit' }
  },
  affordability: {
    key: 'affordability',
    label: 'Affordability score',
    colors: ['#eff6ff', '#bae6fd', '#67e8f9', '#14b8a6', '#0f766e'],
    legend: { low: 'Less affordable', high: 'More affordable' }
  },
  riskPressure: {
    key: 'riskPressure',
    label: 'Risk / pressure score',
    colors: ['#fef08a', '#fb923c', '#ef4444', '#be123c', '#581c87'],
    legend: { low: 'Lower pressure', high: 'Higher pressure' }
  },
  default: {
    key: 'default',
    label: 'Composite score',
    colors: ['#7f1d1d', '#b91c1c', '#b45309', '#4d7c0f', '#166534'],
    legend: { low: 'Lower priority', high: 'Higher priority' }
  }
}

const SCORE_PRESET_PALETTE_KEYS: Record<string, ScorePaletteKey> = {
  balancedCoverage: 'airCoverage',
  lowCostExpansion: 'airCoverage',
  referenceNetwork: 'airCoverage',
  livabilityIndex: 'benefit',
  environmentalHealth: 'benefit',
  housingAffordability: 'affordability',
  redevelopmentPressure: 'riskPressure',
  completeNeighbourhood: 'benefit',
  foodInspectionRisk: 'riskPressure',
  safetyPressure: 'riskPressure'
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
  chsaReferenceGaps: 'airCoverage'
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
  activeExampleKey: string | null
): ScorePaletteProfile {
  const paletteKey = (activeExampleKey ? SCORE_EXAMPLE_PALETTE_KEYS[activeExampleKey] : undefined)
    || (activePresetKey ? SCORE_PRESET_PALETTE_KEYS[activePresetKey] : undefined)
    || 'default'
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
  if (parts.length !== SCORE_METRICS.length || parts.some((v) => !Number.isFinite(v))) return null
  const weights = createMetricValueMap(0) as ScoreMetricWeightMap
  SCORE_METRICS.forEach((m, i) => {
    weights[m.key] = Math.max(-100, Math.min(100, Math.round(parts[i])))
  })
  return weights
}
