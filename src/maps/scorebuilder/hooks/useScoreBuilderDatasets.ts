import { useMemo } from 'react'
import { useAirQualityData, type BoundarySource, type RegionLevel } from '@/maps/airquality'
import { useCensusData } from '@/maps/census/hooks/useCensusData'
import type { CensusCategoryData, CensusHierarchyLevel } from '@/maps/census/types'
import { useRestaurantData } from '@/maps/foodmap/hooks/useRestaurantData'
import { useParksData } from '@/maps/parks/hooks/useParksData'
import { useBcAssessmentData } from '@/maps/bcassessment/hooks/useBcAssessmentData'
import { useCrimeData } from '@/maps/pgdata/hooks/useCrimeData'
import { useJsonManifest } from '@/maps/pgdata/shared'
import { censusVariableDataPath, getCensusRecipeCategories } from '../lib/censusComposer'
import { profileFeatureCollection, type DatasetProfile } from '../lib/datasetCatalog'
import type { MetricRecipe, MetricRecipeSource } from '../lib/metricRecipes'
import type { ScoreDataSource } from '../types'
import { useCimdData } from './useCimdData'
import { useHeatShadeData } from './useHeatShadeData'
import { useScoreBuilderRegions } from './useScoreBuilderRegions'
import { useTransitData } from './useTransitData'
import { useBcEnviroScreenData } from './useBcEnviroScreenData'

const CENSUS_VARIABLE_LEVEL_VALUES = new Set<CensusHierarchyLevel>(['cd', 'csd', 'ct', 'da', 'db'])

export interface ScoreBuilderDatasetsOptions {
  enabledSourceSet: ReadonlySet<ScoreDataSource>
  boundarySource: BoundarySource
  selectedRegionLevel: RegionLevel
  customMetricRecipes: MetricRecipe[]
}

/**
 * Fetches every raw dataset the score builder can aggregate, gated on the enabled
 * data sources, and folds the per-dataset loading/error flags into single values.
 */
export function useScoreBuilderDatasets({
  enabledSourceSet,
  boundarySource,
  selectedRegionLevel,
  customMetricRecipes,
}: ScoreBuilderDatasetsOptions) {
  const censusDataEnabled = enabledSourceSet.has('census') || enabledSourceSet.has('deprivation')

  const {
    monitors,
    loading: loadingMonitors,
    error: monitorsError,
  } = useAirQualityData(enabledSourceSet.has('airQuality'))
  const {
    parks,
    trails,
    amenities,
    loading: loadingParks,
    error: parksError,
  } = useParksData([], enabledSourceSet.has('parks'))
  const {
    restaurants,
    loading: loadingRestaurants,
    error: restaurantsError,
  } = useRestaurantData(enabledSourceSet.has('restaurants'))
  const { unitsByLevel, loading: loadingCensus, error: censusError } = useCensusData(censusDataEnabled)
  const {
    regions,
    loading: loadingRegions,
    error: regionsError,
  } = useScoreBuilderRegions(boundarySource, selectedRegionLevel)
  const {
    properties,
    loading: loadingProperties,
    error: propertiesError,
  } = useBcAssessmentData(enabledSourceSet.has('bcAssessment'))
  const { incidents, loading: loadingCrime, error: crimeError } = useCrimeData(enabledSourceSet.has('crime'))
  const {
    trees: heatShadeTrees,
    forests: heatShadeForests,
    facilities: heatShadeFacilities,
    loading: loadingHeatShade,
    error: heatShadeError,
  } = useHeatShadeData(enabledSourceSet.has('heatShade'))
  const {
    stops: transitStops,
    loading: loadingTransit,
    error: transitError,
  } = useTransitData(enabledSourceSet.has('transit'))
  const {
    records: cimdRecords,
    loading: loadingCimd,
    error: cimdError,
  } = useCimdData(enabledSourceSet.has('deprivation'))
  const bcEnviroScreen = useBcEnviroScreenData(enabledSourceSet.has('bcEnviroScreen'))

  const walkabilityEnabled = enabledSourceSet.has('walkability')
  const walkabilitySidewalks = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/citypg/sidewalks.geojson' : null,
  )
  const walkabilityWalkways = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/citypg/walkways.geojson' : null,
  )
  const walkabilityIntersections = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/citypg/road_intersections.geojson' : null,
  )
  const walkabilityCrossings = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/walkability/supplemental/osm_crossings.geojson' : null,
  )
  const walkabilityChildcare = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/walkability/supplemental/bc_childcare_locations.geojson' : null,
  )
  const walkabilityOsmDaycares = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/walkability/supplemental/osm_daycares.geojson' : null,
  )
  const walkabilityClass3Crosswalks = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/walkability/supplemental/report_class3_crosswalks_geocoded.geojson' : null,
  )
  const walkabilitySupplementalPoi = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/walkability/supplemental/missing_poi_supplement.geojson' : null,
  )
  const walkabilityIntercityStops = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/walkability/supplemental/intercity_bus_stops.geojson' : null,
  )
  const walkabilityPedestrianCrashes = useJsonManifest<GeoJSON.FeatureCollection>(
    walkabilityEnabled ? '/data/icbc/prince_george_pedestrian_crashes.geojson' : null,
  )

  const healthyPlanPgEnabled = enabledSourceSet.has('healthyPlanPg')
  const healthyPlanBusinessPois = useJsonManifest<GeoJSON.FeatureCollection>(
    healthyPlanPgEnabled ? '/data/healthyplan-pg/business_pois.geojson' : null,
  )
  const healthyPlanEducationFacilities = useJsonManifest<GeoJSON.FeatureCollection>(
    healthyPlanPgEnabled ? '/data/healthyplan-pg/education_facilities.geojson' : null,
  )
  const healthyPlanBusinessLicences = useJsonManifest<GeoJSON.FeatureCollection>(
    healthyPlanPgEnabled ? '/data/healthyplan-pg/business_licences_bc_geocoded.geojson' : null,
  )

  // Census variable tables are only fetched when a custom census recipe needs them.
  const censusVariableLevel = CENSUS_VARIABLE_LEVEL_VALUES.has(selectedRegionLevel as CensusHierarchyLevel)
    ? (selectedRegionLevel as CensusHierarchyLevel)
    : 'da'
  const customCensusCategories = useMemo(() => getCensusRecipeCategories(customMetricRecipes), [customMetricRecipes])
  const shouldLoadCustomCensus = customCensusCategories.length > 0
  const censusAgeVariables = useJsonManifest<CensusCategoryData>(
    shouldLoadCustomCensus ? censusVariableDataPath(censusVariableLevel, 'age') : null,
  )
  const censusVisibleMinorityVariables = useJsonManifest<CensusCategoryData>(
    shouldLoadCustomCensus ? censusVariableDataPath(censusVariableLevel, 'visible_minority_and_ethnic_origin') : null,
  )
  const censusImmigrationVariables = useJsonManifest<CensusCategoryData>(
    shouldLoadCustomCensus ? censusVariableDataPath(censusVariableLevel, 'citizenship_and_immigration') : null,
  )
  const censusHouseholdVariables = useJsonManifest<CensusCategoryData>(
    shouldLoadCustomCensus ? censusVariableDataPath(censusVariableLevel, 'households') : null,
  )
  const censusIncomeVariables = useJsonManifest<CensusCategoryData>(
    shouldLoadCustomCensus ? censusVariableDataPath(censusVariableLevel, 'income_100') : null,
  )
  const censusCategoryData = useMemo<Partial<Record<string, CensusCategoryData>>>(
    () => ({
      age: censusAgeVariables.data ?? undefined,
      visible_minority_and_ethnic_origin: censusVisibleMinorityVariables.data ?? undefined,
      citizenship_and_immigration: censusImmigrationVariables.data ?? undefined,
      households: censusHouseholdVariables.data ?? undefined,
      income_100: censusIncomeVariables.data ?? undefined,
    }),
    [
      censusAgeVariables.data,
      censusHouseholdVariables.data,
      censusImmigrationVariables.data,
      censusIncomeVariables.data,
      censusVisibleMinorityVariables.data,
    ],
  )

  const datasetCollections = useMemo<Partial<Record<MetricRecipeSource, GeoJSON.FeatureCollection | null>>>(
    () => ({
      'healthyplanPg.businessPois': healthyPlanBusinessPois.data,
      'healthyplanPg.educationFacilities': healthyPlanEducationFacilities.data,
      'healthyplanPg.businessLicencesBcGeocoded': healthyPlanBusinessLicences.data,
    }),
    [healthyPlanBusinessLicences.data, healthyPlanBusinessPois.data, healthyPlanEducationFacilities.data],
  )
  const datasetProfiles = useMemo<Partial<Record<MetricRecipeSource, DatasetProfile>>>(
    () => ({
      'healthyplanPg.businessPois': profileFeatureCollection(healthyPlanBusinessPois.data),
      'healthyplanPg.educationFacilities': profileFeatureCollection(healthyPlanEducationFacilities.data),
      'healthyplanPg.businessLicencesBcGeocoded': profileFeatureCollection(healthyPlanBusinessLicences.data),
    }),
    [healthyPlanBusinessLicences.data, healthyPlanBusinessPois.data, healthyPlanEducationFacilities.data],
  )

  const loading =
    loadingMonitors ||
    loadingRegions ||
    loadingParks ||
    loadingRestaurants ||
    loadingCensus ||
    loadingProperties ||
    loadingCrime ||
    loadingHeatShade ||
    loadingTransit ||
    loadingCimd ||
    bcEnviroScreen.loading

  const dataErrors = useMemo(() => {
    const errors: string[] = []
    if (monitorsError) errors.push(monitorsError)
    if (regionsError) errors.push(regionsError)
    if (parksError) errors.push(parksError)
    if (restaurantsError) errors.push(restaurantsError)
    if (censusError) errors.push(censusError)
    if (propertiesError) errors.push(propertiesError)
    if (crimeError) errors.push(crimeError)
    if (heatShadeError) errors.push(heatShadeError)
    if (transitError) errors.push(transitError)
    if (cimdError) errors.push(cimdError)
    if (bcEnviroScreen.error) errors.push(bcEnviroScreen.error)
    if (walkabilitySidewalks.error) errors.push(walkabilitySidewalks.error)
    if (walkabilityWalkways.error) errors.push(walkabilityWalkways.error)
    if (walkabilityIntersections.error) errors.push(walkabilityIntersections.error)
    if (walkabilityCrossings.error) errors.push(walkabilityCrossings.error)
    if (walkabilityChildcare.error) errors.push(walkabilityChildcare.error)
    if (walkabilityOsmDaycares.error) errors.push(walkabilityOsmDaycares.error)
    if (walkabilityClass3Crosswalks.error) errors.push(walkabilityClass3Crosswalks.error)
    if (walkabilitySupplementalPoi.error) errors.push(walkabilitySupplementalPoi.error)
    if (walkabilityIntercityStops.error) errors.push(walkabilityIntercityStops.error)
    if (walkabilityPedestrianCrashes.error) errors.push(walkabilityPedestrianCrashes.error)
    if (healthyPlanBusinessPois.error) errors.push(healthyPlanBusinessPois.error)
    if (healthyPlanEducationFacilities.error) errors.push(healthyPlanEducationFacilities.error)
    if (healthyPlanBusinessLicences.error) errors.push(healthyPlanBusinessLicences.error)
    if (censusAgeVariables.error) errors.push(censusAgeVariables.error)
    if (censusVisibleMinorityVariables.error) errors.push(censusVisibleMinorityVariables.error)
    if (censusImmigrationVariables.error) errors.push(censusImmigrationVariables.error)
    if (censusHouseholdVariables.error) errors.push(censusHouseholdVariables.error)
    if (censusIncomeVariables.error) errors.push(censusIncomeVariables.error)
    return errors
  }, [
    monitorsError,
    regionsError,
    parksError,
    restaurantsError,
    censusError,
    propertiesError,
    crimeError,
    heatShadeError,
    transitError,
    cimdError,
    bcEnviroScreen.error,
    walkabilitySidewalks.error,
    walkabilityWalkways.error,
    walkabilityIntersections.error,
    walkabilityCrossings.error,
    walkabilityChildcare.error,
    walkabilityOsmDaycares.error,
    walkabilityClass3Crosswalks.error,
    walkabilitySupplementalPoi.error,
    walkabilityIntercityStops.error,
    walkabilityPedestrianCrashes.error,
    healthyPlanBusinessPois.error,
    healthyPlanEducationFacilities.error,
    healthyPlanBusinessLicences.error,
    censusAgeVariables.error,
    censusVisibleMinorityVariables.error,
    censusImmigrationVariables.error,
    censusHouseholdVariables.error,
    censusIncomeVariables.error,
  ])

  return {
    monitors,
    parks,
    trails,
    amenities,
    restaurants,
    censusUnitsByLevel: unitsByLevel,
    regions,
    loadingRegions,
    properties,
    incidents,
    heatShadeTrees,
    heatShadeForests,
    heatShadeFacilities,
    transitStops,
    cimdRecords,
    bcEnviroScreen,
    walkabilityCollections: {
      sidewalks: walkabilitySidewalks.data,
      walkways: walkabilityWalkways.data,
      intersections: walkabilityIntersections.data,
      crossings: walkabilityCrossings.data,
      childcare: walkabilityChildcare.data,
      osmDaycares: walkabilityOsmDaycares.data,
      class3Crosswalks: walkabilityClass3Crosswalks.data,
      supplementalPoi: walkabilitySupplementalPoi.data,
      intercityStops: walkabilityIntercityStops.data,
      pedestrianCrashes: walkabilityPedestrianCrashes.data,
    },
    censusCategoryData,
    datasetCollections,
    datasetProfiles,
    loading,
    dataErrors,
  }
}

export type ScoreBuilderDatasets = ReturnType<typeof useScoreBuilderDatasets>
