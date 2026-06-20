import { useMemo } from 'react'
import type { CensusCategoryData } from '@/maps/census/types'
import { LOW_COST_NETWORKS, createMetricValueMap } from '../constants'
import { computeCensusMetricValue } from '../lib/censusComposer'
import {
  HEALTHYPLAN_PG_STARTER_RECIPES,
  computeDerivedExpressionMetric,
  computePointMetricRecipe,
  pointRecordsFromFeatureCollection,
  type MetricRecipe,
  type MetricRecipeSource,
} from '../lib/metricRecipes'
import { buildMetricRanges, buildMetricValueLists, type RegionMetricRow } from '../lib/scoring'
import { bufferedAccessShare, catchmentAccess, isInRegion, regionCenter } from '../lib/spatial'
import type {
  RegionDataCounts,
  ScoreBuilderRegion,
  ScoreMetricDefinition,
  ScoreMetricKey,
} from '../types'
import type { ScoreBuilderPointRecords } from './useScoreBuilderPointRecords'

const CURRENT_YEAR = new Date().getFullYear()

export interface ScoreBuilderMetricRowsOptions {
  regions: ScoreBuilderRegion[]
  points: ScoreBuilderPointRecords
  customMetricRecipes: MetricRecipe[]
  censusCategoryData: Partial<Record<string, CensusCategoryData>>
  datasetCollections: Partial<Record<MetricRecipeSource, GeoJSON.FeatureCollection | null>>
  healthyPlanPgEnabled: boolean
  activeMetricDefinitions: ScoreMetricDefinition[]
}

/**
 * Aggregates every point-record collection into one metric row per region
 * (raw metric values plus data-coverage counts), then derives the per-metric
 * ranges and value lists used by normalization.
 */
export function useScoreBuilderMetricRows({
  regions,
  points,
  customMetricRecipes,
  censusCategoryData,
  datasetCollections,
  healthyPlanPgEnabled,
  activeMetricDefinitions,
}: ScoreBuilderMetricRowsOptions) {
  const {
    monitorPointRecords,
    parkPointRecords,
    parkBufferRecords,
    shouldComputeParkBufferAccess,
    trailPointRecords,
    amenityPointRecords,
    restaurantPointRecords,
    censusPointRecords,
    propertyPointRecords,
    crimePointRecords,
    transitPointRecords,
    walkabilityLineRecords,
    walkabilityPointRecords,
    heatShadeTreePointRecords,
    heatShadeForestRecords,
    heatShadeFacilityPointRecords,
    cimdPointRecords,
  } = points

  const pointRecipeValues = useMemo(() => {
    const empty = new Map<ScoreMetricKey, Map<string, { value: number; matchedFeatureCount: number }>>()
    if (regions.length === 0) return empty

    // Point records are extracted lazily per source so user-uploaded datasets
    // (`user.*` keys in datasetCollections) join through the same code path as
    // the built-in HealthyPlan collections.
    const recordCache = new Map<MetricRecipeSource, ReturnType<typeof pointRecordsFromFeatureCollection>>()
    const recordsForSource = (source: MetricRecipeSource) => {
      const cached = recordCache.get(source)
      if (cached) return cached
      const collection = datasetCollections[source]
      const records = collection ? pointRecordsFromFeatureCollection(collection) : []
      recordCache.set(source, records)
      return records
    }

    const values = new Map<ScoreMetricKey, Map<string, { value: number; matchedFeatureCount: number }>>()
    const pointRecipes = [...(healthyPlanPgEnabled ? HEALTHYPLAN_PG_STARTER_RECIPES : []), ...customMetricRecipes].filter(
      (recipe) => recipe.operation !== 'derivedExpression' && recipe.operation !== 'censusVariable',
    )
    pointRecipes.forEach((recipe) => {
      if (recipe.source.startsWith('healthyplanPg.') && !healthyPlanPgEnabled) return
      const computed = computePointMetricRecipe(recipe, regions, recordsForSource(recipe.source))
      values.set(
        recipe.id as ScoreMetricKey,
        new Map(
          computed.map((entry) => [
            entry.regionId,
            { value: entry.value, matchedFeatureCount: entry.matchedFeatureCount },
          ]),
        ),
      )
    })
    return values
  }, [customMetricRecipes, datasetCollections, healthyPlanPgEnabled, regions])

  const regionMetricRows = useMemo<RegionMetricRow[]>(() => {
    return regions.map((region) => {
      const counts: RegionDataCounts = {
        monitorCount: 0,
        lowCostCount: 0,
        referenceCount: 0,
        activeCount: 0,
        parkCount: 0,
        parkAreaSqKm: 0,
        trailCount: 0,
        trailLengthKm: 0,
        amenityCount: 0,
        restaurantCount: 0,
        restaurantHazardSum: 0,
        inspectionCount: 0,
        criticalViolationCount: 0,
        followUpInspectionCount: 0,
        populationSum: 0,
        parcelCount: 0,
        assessedValueSum: 0,
        landValueSum: 0,
        buildingValueSum: 0,
        propertyGrowthSum: 0,
        propertyGrowthCount: 0,
        yearBuiltSum: 0,
        yearBuiltCount: 0,
        pre1980BuildingCount: 0,
        vacantParcelCount: 0,
        multiFamilyParcelCount: 0,
        commercialParcelCount: 0,
        crimeCount: 0,
        recentCrimeCount: 0,
        transitStopCount: 0,
        accessibleTransitStopCount: 0,
        transitShelterCount: 0,
        frequentTransitStopCount: 0,
        accessibleFrequentTransitStopCount: 0,
        transitTripCount: 0,
        transitServiceSpanSum: 0,
        sidewalkLengthKm: 0,
        walkwayLengthKm: 0,
        walkabilityIntersectionCount: 0,
        walkabilityCrossingCount: 0,
        childcareCount: 0,
        walkabilityPoiCount: 0,
        class3CrosswalkCount: 0,
        pedestrianCrashCount: 0,
        treeCount: 0,
        matureTreeCount: 0,
        forestAreaSqKm: 0,
        canopyProxyAreaSqKm: 0,
        coolingFacilityCount: 0,
        responseFacilityCount: 0,
        healthyFoodOutletAccessCount: 0,
        retailServiceAccessCount: 0,
        educationFacilityAccessCount: 0,
        geocodedBusinessCount: 0,
        cimdJoinedCount: 0,
        cimdPopulationWeight: 0,
        cimdCompositeSum: 0,
        cimdResidentialInstabilitySum: 0,
        cimdEconomicDependencySum: 0,
        cimdSituationalVulnerabilitySum: 0,
        cimdEthnoCulturalCompositionSum: 0,
      }
      const networks = new Set<string>()
      const parameters = new Set<string>()

      // Air quality
      monitorPointRecords.forEach(({ monitor, feature }) => {
        if (!isInRegion(monitor.longitude, monitor.latitude, feature, region)) return
        counts.monitorCount += 1
        if (LOW_COST_NETWORKS.has(monitor.network)) counts.lowCostCount += 1
        else counts.referenceCount += 1
        if ((monitor.status || '').toLowerCase() === 'active') counts.activeCount += 1
        networks.add(monitor.network)
        monitor.parameters.forEach((p) => {
          const n = p.trim()
          if (n) parameters.add(n)
        })
      })

      // Parks
      parkPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.parkCount += 1
        counts.parkAreaSqKm += rec.areaSqKm
      })

      // Trails
      trailPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.trailCount += 1
        counts.trailLengthKm += rec.lengthKm
      })

      // Amenities
      amenityPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.amenityCount += 1
      })

      // Restaurants
      restaurantPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.restaurantCount += 1
        counts.restaurantHazardSum += rec.hazard
        counts.inspectionCount += rec.inspectionCount
        counts.criticalViolationCount += rec.criticalViolations
        counts.followUpInspectionCount += rec.followUps
      })

      // Census
      censusPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.populationSum += rec.population
      })

      // BC Assessment
      propertyPointRecords.forEach((rec) => {
        const directCensusMatch =
          region.source === 'census' &&
          (region.level === 'ct' || region.level === 'da') &&
          rec[region.level as 'ct' | 'da'] === region.code
        if (!directCensusMatch && !isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.parcelCount += 1
        counts.assessedValueSum += rec.assessedValue
        counts.landValueSum += rec.landValue
        counts.buildingValueSum += rec.buildingValue
        if (rec.valueGrowth != null) {
          counts.propertyGrowthSum += rec.valueGrowth
          counts.propertyGrowthCount += 1
        }
        if (rec.yearBuilt) {
          counts.yearBuiltSum += rec.yearBuilt
          counts.yearBuiltCount += 1
          if (rec.yearBuilt < 1980) counts.pre1980BuildingCount += 1
        }
        if (rec.category === 'vacant') counts.vacantParcelCount += 1
        if (rec.category === 'multi-family') counts.multiFamilyParcelCount += 1
        if (rec.category === 'commercial') counts.commercialParcelCount += 1
      })

      // Crime
      crimePointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.crimeCount += 1
        if (rec.recent) counts.recentCrimeCount += 1
      })

      // Transit
      transitPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.transitStopCount += 1
        if (rec.accessible) counts.accessibleTransitStopCount += 1
        if (rec.hasShelter) counts.transitShelterCount += 1
        if (rec.frequent) counts.frequentTransitStopCount += 1
        if (rec.frequent && rec.accessible) counts.accessibleFrequentTransitStopCount += 1
        counts.transitTripCount += rec.weekdayTrips
        counts.transitServiceSpanSum += rec.serviceSpanHours
      })

      // Walkability / Pedestrian Network Study
      walkabilityLineRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        if (rec.kind === 'sidewalk') counts.sidewalkLengthKm += rec.lengthKm
        else counts.walkwayLengthKm += rec.lengthKm
      })

      walkabilityPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        if (rec.kind === 'intersection') counts.walkabilityIntersectionCount += rec.count
        else if (rec.kind === 'crossing') counts.walkabilityCrossingCount += rec.count
        else if (rec.kind === 'childcare') counts.childcareCount += rec.count
        else if (rec.kind === 'poi') counts.walkabilityPoiCount += rec.count
        else if (rec.kind === 'class3Crosswalk') counts.class3CrosswalkCount += rec.count
        else counts.pedestrianCrashCount += rec.count
      })

      // Heat and shade
      heatShadeTreePointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.treeCount += 1
        if (rec.mature) counts.matureTreeCount += 1
        counts.canopyProxyAreaSqKm += rec.canopyAreaSqKm
      })

      heatShadeForestRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.forestAreaSqKm += rec.areaSqKm
      })

      heatShadeFacilityPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        if (rec.kind === 'communityFacility') counts.coolingFacilityCount += 1
        else counts.responseFacilityCount += 1
      })

      cimdPointRecords.forEach((rec) => {
        const { cimd } = rec
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        const weight = cimd.population || 1
        counts.cimdJoinedCount += 1
        counts.cimdPopulationWeight += weight
        counts.cimdCompositeSum += cimd.composite * weight
        counts.cimdResidentialInstabilitySum += cimd.residentialInstability * weight
        counts.cimdEconomicDependencySum += cimd.economicDependency * weight
        counts.cimdSituationalVulnerabilitySum += cimd.situationalVulnerability * weight
        counts.cimdEthnoCulturalCompositionSum += cimd.ethnoCulturalComposition * weight
      })

      const safeArea = region.areaKm2 > 0 ? region.areaKm2 : 1
      const center = regionCenter(region)
      const parkBufferAccessShare = shouldComputeParkBufferAccess
        ? bufferedAccessShare(region, parkBufferRecords)
        : null
      const parkWalk10Access = catchmentAccess(center, parkPointRecords, 0.8)
      const parkWalk20Access = catchmentAccess(center, parkPointRecords, 1.6)
      const coolingWalk15Access = catchmentAccess(
        center,
        heatShadeFacilityPointRecords.filter((record) => record.kind === 'communityFacility'),
        1.2,
      )
      const frequentTransitAccess = catchmentAccess(
        center,
        transitPointRecords.filter((record) => record.frequent),
        0.8,
      )
      const accessibleFrequentTransitAccess = catchmentAccess(
        center,
        transitPointRecords.filter((record) => record.frequent && record.accessible),
        0.8,
      )
      const parkTransit20Access = Math.max(
        parkWalk20Access,
        Math.min(1, parkWalk20Access + frequentTransitAccess * 0.35),
      )
      const serviceAccessComposite =
        (parkWalk10Access + parkWalk20Access + coolingWalk15Access + frequentTransitAccess) / 4
      const cimdWeight = counts.cimdPopulationWeight || counts.cimdJoinedCount || 1
      const cimdComposite = counts.cimdPopulationWeight > 0 ? counts.cimdCompositeSum / cimdWeight : 0
      const canopyProxyRatio =
        region.areaKm2 > 0 ? Math.min(1, (counts.canopyProxyAreaSqKm + counts.forestAreaSqKm) / region.areaKm2) : 0
      const shadeGap = Math.max(
        0,
        Math.min(1, (1 - (canopyProxyRatio + coolingWalk15Access) / 2) * (0.5 + Math.min(0.5, cimdComposite / 2))),
      )
      const metricValues = createMetricValueMap(0)
      metricValues.overallDensity = counts.monitorCount / safeArea
      metricValues.lowCostDensity = counts.lowCostCount / safeArea
      metricValues.referenceDensity = counts.referenceCount / safeArea
      metricValues.networkVariety = networks.size
      metricValues.parameterVariety = parameters.size
      metricValues.activeShare = counts.monitorCount > 0 ? counts.activeCount / counts.monitorCount : 0
      metricValues.monitorCount = counts.monitorCount
      metricValues.parkDensity = counts.parkCount / safeArea
      metricValues.parkAreaRatio = region.areaKm2 > 0 ? Math.min(1, counts.parkAreaSqKm / region.areaKm2) : 0
      metricValues.trailDensity = counts.trailLengthKm / safeArea
      metricValues.amenityDensity = counts.amenityCount / safeArea
      metricValues.parkAccessGap1Mile = parkBufferAccessShare == null ? 0 : 1 - parkBufferAccessShare
      metricValues.treeDensity = counts.treeCount / safeArea
      metricValues.matureTreeDensity = counts.matureTreeCount / safeArea
      metricValues.forestAreaRatio = region.areaKm2 > 0 ? Math.min(1, counts.forestAreaSqKm / region.areaKm2) : 0
      metricValues.coolingFacilityDensity = counts.coolingFacilityCount / safeArea
      metricValues.responseFacilityDensity = counts.responseFacilityCount / safeArea
      metricValues.restaurantDensity = counts.restaurantCount / safeArea
      metricValues.foodRiskScore = counts.restaurantCount > 0 ? counts.restaurantHazardSum / counts.restaurantCount : 0
      metricValues.criticalViolationRate =
        counts.inspectionCount > 0 ? counts.criticalViolationCount / counts.inspectionCount : 0
      metricValues.followUpRate =
        counts.inspectionCount > 0 ? counts.followUpInspectionCount / counts.inspectionCount : 0
      metricValues.populationDensity = counts.populationSum / safeArea
      metricValues.parcelDensity = counts.parcelCount / safeArea
      metricValues.avgAssessedValue = counts.parcelCount > 0 ? counts.assessedValueSum / counts.parcelCount : 0
      metricValues.valueGrowth10y =
        counts.propertyGrowthCount > 0 ? counts.propertyGrowthSum / counts.propertyGrowthCount : 0
      metricValues.buildingAge =
        counts.yearBuiltCount > 0 ? Math.max(0, CURRENT_YEAR - counts.yearBuiltSum / counts.yearBuiltCount) : 0
      metricValues.pre1980HousingShare =
        counts.yearBuiltCount > 0 ? counts.pre1980BuildingCount / counts.yearBuiltCount : 0
      metricValues.vacantParcelShare = counts.parcelCount > 0 ? counts.vacantParcelCount / counts.parcelCount : 0
      metricValues.multiFamilyShare = counts.parcelCount > 0 ? counts.multiFamilyParcelCount / counts.parcelCount : 0
      metricValues.commercialShare = counts.parcelCount > 0 ? counts.commercialParcelCount / counts.parcelCount : 0
      metricValues.landValueShare = counts.assessedValueSum > 0 ? counts.landValueSum / counts.assessedValueSum : 0
      metricValues.crimeDensity = counts.crimeCount / safeArea
      metricValues.crimePerCapita = counts.populationSum > 0 ? counts.crimeCount / counts.populationSum : 0
      metricValues.recentCrimeShare = counts.crimeCount > 0 ? counts.recentCrimeCount / counts.crimeCount : 0
      metricValues.transitStopDensity = counts.transitStopCount / safeArea
      metricValues.accessibleTransitStopDensity = counts.accessibleTransitStopCount / safeArea
      metricValues.transitShelterDensity = counts.transitShelterCount / safeArea
      metricValues.frequentTransitStopAccess = frequentTransitAccess
      metricValues.transitServiceSpan =
        counts.transitStopCount > 0 ? counts.transitServiceSpanSum / counts.transitStopCount : 0
      metricValues.transitTripsPerStop =
        counts.transitStopCount > 0 ? counts.transitTripCount / counts.transitStopCount : 0
      metricValues.accessibleFrequentTransitAccess = accessibleFrequentTransitAccess
      metricValues.sidewalkDensity = counts.sidewalkLengthKm / safeArea
      metricValues.walkwayDensity = counts.walkwayLengthKm / safeArea
      metricValues.walkabilityIntersectionDensity = counts.walkabilityIntersectionCount / safeArea
      metricValues.walkabilityCrossingDensity = counts.walkabilityCrossingCount / safeArea
      metricValues.childcareDensity = counts.childcareCount / safeArea
      metricValues.walkabilityPoiDensity = counts.walkabilityPoiCount / safeArea
      metricValues.class3CrosswalkDensity = counts.class3CrosswalkCount / safeArea
      metricValues.pedestrianCrashDensity = counts.pedestrianCrashCount / safeArea
      metricValues.parkWalk10Access = parkWalk10Access
      metricValues.parkWalk20Access = parkWalk20Access
      metricValues.coolingWalk15Access = coolingWalk15Access
      metricValues.parkTransit20Access = parkTransit20Access
      metricValues.serviceAccessComposite = serviceAccessComposite
      metricValues.canopyProxyRatio = canopyProxyRatio
      metricValues.shadeGap = shadeGap
      metricValues.cimdComposite = cimdComposite
      metricValues.cimdResidentialInstability =
        counts.cimdPopulationWeight > 0 ? counts.cimdResidentialInstabilitySum / cimdWeight : 0
      metricValues.cimdEconomicDependency =
        counts.cimdPopulationWeight > 0 ? counts.cimdEconomicDependencySum / cimdWeight : 0
      metricValues.cimdSituationalVulnerability =
        counts.cimdPopulationWeight > 0 ? counts.cimdSituationalVulnerabilitySum / cimdWeight : 0
      metricValues.cimdEthnoCulturalComposition =
        counts.cimdPopulationWeight > 0 ? counts.cimdEthnoCulturalCompositionSum / cimdWeight : 0
      const healthyFoodAccess = pointRecipeValues.get('healthyFoodOutletAccess1km')?.get(region.id)
      const retailServiceAccess = pointRecipeValues.get('retailServiceAccess1km')?.get(region.id)
      const educationFacilityAccess = pointRecipeValues.get('educationFacilityAccess1km')?.get(region.id)
      const geocodedBusinessDensity = pointRecipeValues.get('geocodedBusinessDensity')?.get(region.id)

      counts.healthyFoodOutletAccessCount = healthyFoodAccess?.matchedFeatureCount ?? 0
      counts.retailServiceAccessCount = retailServiceAccess?.matchedFeatureCount ?? 0
      counts.educationFacilityAccessCount = educationFacilityAccess?.matchedFeatureCount ?? 0
      counts.geocodedBusinessCount = geocodedBusinessDensity?.matchedFeatureCount ?? 0

      metricValues.healthyFoodOutletAccess1km = healthyFoodAccess?.value ?? 0
      metricValues.retailServiceAccess1km = retailServiceAccess?.value ?? 0
      metricValues.educationFacilityAccess1km = educationFacilityAccess?.value ?? 0
      metricValues.geocodedBusinessDensity = geocodedBusinessDensity?.value ?? 0

      // Community walkability variants are precomputed and ride along in the
      // boundary feature properties (PG Community boundary only).
      if (region.source === 'walkabilityCommunity') {
        const props = (region.feature.properties ?? {}) as Record<string, unknown>
        const readScore = (key: string): number => {
          const value = Number(props[key])
          return Number.isFinite(value) ? value : 0
        }
        metricValues.communityWalkBalanced = readScore('balancedScore')
        metricValues.communityWalkInfrastructure = readScore('infrastructureScore')
        metricValues.communityWalkAccess = readScore('accessScore')
        metricValues.communityWalkSafetyAdjusted = readScore('safetyAdjustedScore')
        metricValues.communityWalkSupplementedLocal = readScore('supplementedLocalScore')
      }
      customMetricRecipes.forEach((recipe) => {
        if (recipe.operation === 'censusVariable') {
          metricValues[recipe.id] = computeCensusMetricValue(recipe, region.id, censusCategoryData)
          return
        }
        if (recipe.operation === 'derivedExpression') {
          metricValues[recipe.id] = computeDerivedExpressionMetric(recipe, metricValues)
          return
        }
        metricValues[recipe.id] = pointRecipeValues.get(recipe.id)?.get(region.id)?.value ?? 0
      })

      return { region, metrics: metricValues, counts }
    })
  }, [
    monitorPointRecords,
    parkPointRecords,
    parkBufferRecords,
    shouldComputeParkBufferAccess,
    trailPointRecords,
    amenityPointRecords,
    restaurantPointRecords,
    censusPointRecords,
    propertyPointRecords,
    crimePointRecords,
    transitPointRecords,
    walkabilityLineRecords,
    walkabilityPointRecords,
    heatShadeTreePointRecords,
    heatShadeForestRecords,
    heatShadeFacilityPointRecords,
    cimdPointRecords,
    customMetricRecipes,
    censusCategoryData,
    pointRecipeValues,
    regions,
  ])

  const metricRanges = useMemo(
    () => buildMetricRanges(regionMetricRows, activeMetricDefinitions),
    [activeMetricDefinitions, regionMetricRows],
  )

  const metricValueLists = useMemo(
    () => buildMetricValueLists(regionMetricRows, activeMetricDefinitions),
    [activeMetricDefinitions, regionMetricRows],
  )

  return { regionMetricRows, metricRanges, metricValueLists }
}
