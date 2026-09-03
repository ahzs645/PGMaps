import { METRIC_CATEGORY_LABELS } from '../types'
import type {
  ScoreDataSource,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
  ScorePreset,
  ScorePresetMethodology,
} from '../types'
import {
  CUMULATIVE_BURDEN_METHOD,
  MODULE_PERCENTILE_METHOD,
  PERCENTILE_METHOD,
  WINSORIZED_METHOD,
  Z_SCORE_METHOD,
  ACCESS_THRESHOLD_METHOD,
  HEALTHYPLAN_PAIRWISE_METHOD,
  BC_ENVIRO_SCREEN_METHOD,
} from './methodSettings'
import { SCORE_METRICS } from './metrics'
import { ZERO_WEIGHTS } from './weights'
import { createBcEnviroScreenWeights } from './bcEnviroScreenMetrics'

export const SCORE_PRESETS: ScorePreset[] = [
  {
    key: 'bcEnviroScreenReconstruction',
    label: 'BC EnviroScreen Reconstruction',
    description:
      'Hybrid research reconstruction across all 89 BC Local Health Areas. Change indicator and component weights to explore custom scenarios.',
    weights: { ...ZERO_WEIGHTS, ...createBcEnviroScreenWeights() },
    methodSettings: BC_ENVIRO_SCREEN_METHOD,
    boundarySources: ['bcHealth'],
    recommendedBoundarySource: 'bcHealth',
    recommendedBoundaryLevel: 'lha',
  },
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
    key: 'pedestrianNetworkStudyMi',
    label: 'Pedestrian Network Study MI',
    description:
      'Boundary-level proxy for the 2017 pedestrian-network Mobility Index: active routes, transit, parks, service access, density, and lower safety pressure.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      sidewalkDensity: 20,
      walkwayDensity: 12,
      walkabilityIntersectionDensity: 12,
      walkabilityCrossingDensity: 10,
      transitStopDensity: 10,
      parkWalk10Access: 10,
      childcareDensity: 8,
      walkabilityPoiDensity: 10,
      class3CrosswalkDensity: -4,
      pedestrianCrashDensity: -4,
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
    description:
      'CalEnviroScreen-style overlap of local burden, deprivation vulnerability, and adaptive-capacity gaps.',
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
    description:
      'EJI SER-style local screen using social vulnerability and environmental burden modules, without health.',
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
    description:
      'Ranks park access gaps with deprivation and population context using catchment accessibility estimates.',
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
    description:
      'Scores frequent, accessible, sheltered, longer-span transit service against population and deprivation need.',
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
    key: 'accessPg15Minute',
    label: '15-Minute PG Access',
    description:
      'Access preset for transit, parks, trails, cooling/community destinations, services, childcare, and walkability proxies.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      serviceAccessComposite: 18,
      accessibleFrequentTransitAccess: 16,
      transitServiceSpan: 10,
      parkWalk10Access: 14,
      parkTransit20Access: 8,
      trailDensity: 8,
      coolingWalk15Access: 8,
      childcareDensity: 8,
      walkabilityPoiDensity: 10,
    },
    methodSettings: ACCESS_THRESHOLD_METHOD,
  },
  {
    key: 'activeLivingWalkability',
    label: 'Active Living / Walkability',
    description:
      'Active-living preset using pedestrian network, crossings, transit, trails, parks, services, and lower pedestrian crash pressure.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      sidewalkDensity: 16,
      walkwayDensity: 10,
      walkabilityIntersectionDensity: 12,
      walkabilityCrossingDensity: 10,
      trailDensity: 10,
      parkWalk10Access: 10,
      accessibleFrequentTransitAccess: 10,
      serviceAccessComposite: 12,
      pedestrianCrashDensity: -10,
    },
    methodSettings: PERCENTILE_METHOD,
  },
  {
    key: 'housingClimateRisk',
    label: 'Housing + Climate Risk',
    description:
      'Housing stress and climate-risk proxy using older housing, lower assessed value, instability, shade/cooling gaps, and local burden.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      buildingAge: 18,
      pre1980HousingShare: 14,
      avgAssessedValue: -12,
      multiFamilyShare: 8,
      cimdResidentialInstability: 14,
      cimdEconomicDependency: 10,
      shadeGap: 14,
      coolingWalk15Access: -10,
      crimePerCapita: 6,
      foodRiskScore: 4,
    },
    methodSettings: CUMULATIVE_BURDEN_METHOD,
  },
  {
    key: 'smokeVulnerabilityProxy',
    label: 'Smoke Vulnerability Proxy',
    description:
      'Smoke-readiness proxy for vulnerable, dense, older-housing areas with weaker monitoring, cooling, and service access.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      cimdSituationalVulnerability: 20,
      cimdEconomicDependency: 12,
      populationDensity: 12,
      buildingAge: 12,
      overallDensity: -12,
      referenceDensity: -10,
      coolingWalk15Access: -10,
      serviceAccessComposite: -8,
      activeShare: -4,
    },
    methodSettings: CUMULATIVE_BURDEN_METHOD,
  },
  {
    key: 'floodVulnerabilityProxy',
    label: 'Flood Vulnerability Proxy',
    description:
      'Flood-response vulnerability proxy using population, social vulnerability, older housing, lower access, and emergency response access.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      populationDensity: 14,
      cimdComposite: 20,
      cimdResidentialInstability: 12,
      cimdEconomicDependency: 10,
      buildingAge: 12,
      pre1980HousingShare: 10,
      responseFacilityDensity: -8,
      serviceAccessComposite: -8,
      accessibleFrequentTransitAccess: -6,
    },
    methodSettings: CUMULATIVE_BURDEN_METHOD,
  },
  {
    key: 'industrialBurdenProxy',
    label: 'Industrial Burden Proxy',
    description:
      'Industrial/local burden placeholder using traffic, monitoring, land-value, food-safety, crime, and older-building proxies until NPRI and contaminated-site layers are normalized.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      transitStopDensity: 8,
      crimeDensity: 12,
      foodRiskScore: 10,
      criticalViolationRate: 8,
      commercialShare: 10,
      landValueShare: 10,
      buildingAge: 10,
      overallDensity: -8,
      parkWalk10Access: -8,
      cimdComposite: 16,
    },
    methodSettings: CUMULATIVE_BURDEN_METHOD,
  },
  {
    key: 'healthyPlanCimdCanopy',
    label: 'Pairwise: CIMD x Canopy',
    description: 'HealthyPlan-style priority: high CIMD vulnerability and low canopy benefit.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      cimdComposite: 50,
      canopyProxyRatio: 50,
    },
    methodSettings: HEALTHYPLAN_PAIRWISE_METHOD('cimdComposite', 'canopyProxyRatio'),
  },
  {
    key: 'healthyPlanEconomicParks',
    label: 'Pairwise: Economic Dependency x Parks',
    description: 'HealthyPlan-style priority: high economic dependency and low 10-minute park access.',
    boundarySources: ['census', 'cityPG'],
    recommendedBoundarySource: 'census',
    recommendedBoundaryLevel: 'da',
    weights: {
      ...ZERO_WEIGHTS,
      cimdEconomicDependency: 50,
      parkWalk10Access: 50,
    },
    methodSettings: HEALTHYPLAN_PAIRWISE_METHOD('cimdEconomicDependency', 'parkWalk10Access'),
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
  if (method?.aggregation === 'bcEnviroScreenProduct') return 'BC EnviroScreen percentile product'
  if (method?.aggregation === 'modulePercentileRankedSum') return 'EJI-style module percentile ranks'
  if (method?.aggregation === 'accessThreshold') return 'Access threshold count'
  if (method?.aggregation === 'cumulativeBurden') return 'Percentile + cumulative burden'
  if (method?.normalization === 'winsorizedMinMax') return 'Winsorized min-max'
  if (method?.normalization === 'zScore') return 'Z-score'
  if (method?.normalization === 'minMax') return 'Min-max'
  return 'Percentile rank'
}

function isProxyPreset(preset: ScorePreset): boolean {
  return /proxy|bcenviro|climate|heat|shade|retrofit|school|equity|justice|pedestrian|walkability|mobility index/i.test(
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
    needed.add(
      'HBE evidence crosswalk linking each proxy metric to toolkit feature, planning principle, and evidence direction',
    )
  }
  if (/pedestrian|walkability|mobility index/.test(text)) {
    needed.add(
      'Original asset-level sidewalk, walkway, trail, crosswalk, condition, and 44-factor Mobility Index source layers',
    )
    needed.add(
      'Network walking distances for schools, parks, transit, civic services, commerce, housing, and route classes',
    )
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
  'walkability',
  'deprivation',
  'healthyPlanPg',
  'bcEnviroScreen',
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
  if (category === 'walkability') return 'walkability'
  if (category === 'deprivation') return 'deprivation'
  if (category === 'healthyPlanPg') return 'healthyPlanPg'
  if (category === 'bcEnviroScreen') return 'bcEnviroScreen'
  return null
}

export function getScoreDataSourcesForWeights(weights: ScoreMetricWeightMap): ScoreDataSource[] {
  const sources = new Set<ScoreDataSource>()

  SCORE_METRICS.forEach((metric) => {
    if ((weights[metric.key] ?? 0) === 0) return
    const source = metricCategoryToDataSource(metric.category)
    if (source) sources.add(source)
    if (metric.key === 'crimePerCapita') sources.add('census')
  })

  return SCORE_DATA_SOURCE_ORDER.filter((source) => sources.has(source))
}
