import { useMemo } from 'react'
import type { HeatmapDataset } from '@/components/HeatmapMashupLayer'
import { useAirQualityData } from '@/maps/airquality'
import { useBcAssessmentData } from '@/maps/bcassessment/hooks/useBcAssessmentData'
import { useCensusData } from '@/maps/census/hooks/useCensusData'
import { useRestaurantData } from '@/maps/foodmap/hooks/useRestaurantData'
import { useParksData } from '@/maps/parks/hooks/useParksData'
import { useCrimeData } from '@/maps/pgdata/hooks/useCrimeData'
import { useTransitData } from '@/maps/scorebuilder/hooks/useTransitData'
import {
  buildAmenityItems,
  buildBcAssessmentItems,
  buildCensusAreaItems,
  buildCensusBlockItems,
  buildCrimeItems,
  buildIcbcItems,
  buildMonitorItems,
  buildParkItems,
  buildRestaurantItems,
  buildTrailItems,
  buildTransitRouteItems,
  buildTransitStopItems,
  buildWildlifeItems,
  type IcbcCrashProperties,
  type TransitRouteProperties,
  type WildlifeAccidentProperties,
} from '../itemBuilders'
import type { ExplorerDatasetId, ExplorerItem } from '../types'
import { useExplorerGeoJson } from './useExplorerGeoJson'

/**
 * Load every explorer dataset (lazily, based on which datasets are active)
 * and convert the raw records into ranked ExplorerItems plus heatmap inputs.
 */
export function useExplorerItems(
  activeDatasetIds: ExplorerDatasetId[],
  dateFrom: number | null,
  dateTo: number | null,
) {
  const activeDatasetSet = useMemo(() => new Set(activeDatasetIds), [activeDatasetIds])
  const parksDataEnabled =
    activeDatasetSet.has('parks') || activeDatasetSet.has('trails') || activeDatasetSet.has('parkAmenities')
  const censusDataEnabled =
    activeDatasetSet.has('censusDa') ||
    activeDatasetSet.has('censusCt') ||
    activeDatasetSet.has('censusCsd') ||
    activeDatasetSet.has('censusCd') ||
    activeDatasetSet.has('censusDb')

  const {
    monitors,
    loading: loadingMonitors,
    error: monitorsError,
  } = useAirQualityData(activeDatasetSet.has('airMonitors'))
  const {
    restaurants,
    loading: loadingRestaurants,
    error: restaurantsError,
  } = useRestaurantData(activeDatasetSet.has('restaurants'))
  const { parks, trails, amenities, loading: loadingParks, error: parksError } = useParksData([], parksDataEnabled)
  const { unitsByLevel, loading: loadingCensus, error: censusError } = useCensusData(censusDataEnabled)
  const { incidents, loading: loadingCrime, error: crimeError } = useCrimeData(activeDatasetSet.has('crime'))
  const {
    stops: transitStops,
    loading: loadingTransit,
    error: transitError,
  } = useTransitData(activeDatasetSet.has('transitStops'))
  const transitRoutesState = useExplorerGeoJson<GeoJSON.LineString, TransitRouteProperties>(
    '/data/transit/prince_george_gtfs_routes.geojson',
    activeDatasetSet.has('transitRoutes'),
  )
  const icbcCrashesState = useExplorerGeoJson<GeoJSON.Point, IcbcCrashProperties>(
    '/data/icbc/prince_george_crash_locations.geojson',
    activeDatasetSet.has('icbcCrashes'),
  )
  const wildlifeState = useExplorerGeoJson<GeoJSON.Point, WildlifeAccidentProperties>(
    '/data/wars/northern_region_wildlife_accidents.geojson.gz',
    activeDatasetSet.has('wildlifeAccidents'),
  )
  const bcAssessmentEnabled = activeDatasetIds.includes('bcAssessment')
  const {
    properties: bcParcels,
    loading: loadingBcAssessment,
    error: bcAssessmentError,
  } = useBcAssessmentData(bcAssessmentEnabled)

  const monitorItems = useMemo(() => buildMonitorItems(monitors), [monitors])
  const restaurantItems = useMemo(
    () => buildRestaurantItems(restaurants, dateFrom, dateTo),
    [dateFrom, dateTo, restaurants],
  )
  const crimeItems = useMemo(() => buildCrimeItems(incidents, dateFrom, dateTo), [dateFrom, dateTo, incidents])
  const amenityItems = useMemo(() => buildAmenityItems(amenities), [amenities])
  const trailItems = useMemo(() => buildTrailItems(trails), [trails])
  const parkItems = useMemo(() => buildParkItems(parks), [parks])
  const censusDaItems = useMemo(() => buildCensusAreaItems(unitsByLevel.da, 'da'), [unitsByLevel.da])
  const censusCtItems = useMemo(() => buildCensusAreaItems(unitsByLevel.ct, 'ct'), [unitsByLevel.ct])
  const censusCsdItems = useMemo(() => buildCensusAreaItems(unitsByLevel.csd, 'csd'), [unitsByLevel.csd])
  const censusCdItems = useMemo(() => buildCensusAreaItems(unitsByLevel.cd, 'cd'), [unitsByLevel.cd])
  const censusDbItems = useMemo(() => buildCensusBlockItems(unitsByLevel.db), [unitsByLevel.db])
  const transitStopItems = useMemo(() => buildTransitStopItems(transitStops), [transitStops])
  const transitRouteItems = useMemo(
    () => buildTransitRouteItems(transitRoutesState.features),
    [transitRoutesState.features],
  )
  const icbcItems = useMemo(() => buildIcbcItems(icbcCrashesState.features), [icbcCrashesState.features])
  const wildlifeItems = useMemo(
    () => buildWildlifeItems(wildlifeState.features, dateFrom, dateTo),
    [dateFrom, dateTo, wildlifeState.features],
  )
  const bcAssessmentItems = useMemo(() => buildBcAssessmentItems(bcParcels), [bcParcels])

  const allItems = useMemo<ExplorerItem[]>(() => {
    return [
      ...monitorItems,
      ...crimeItems,
      ...restaurantItems,
      ...amenityItems,
      ...transitStopItems,
      ...icbcItems,
      ...wildlifeItems,
      ...trailItems,
      ...transitRouteItems,
      ...parkItems,
      ...bcAssessmentItems,
      ...censusDaItems,
      ...censusCtItems,
      ...censusCsdItems,
      ...censusCdItems,
      ...censusDbItems,
    ]
  }, [
    amenityItems,
    bcAssessmentItems,
    censusCdItems,
    censusCsdItems,
    censusCtItems,
    censusDaItems,
    censusDbItems,
    crimeItems,
    icbcItems,
    monitorItems,
    parkItems,
    restaurantItems,
    trailItems,
    transitRouteItems,
    transitStopItems,
    wildlifeItems,
  ])

  const heatmapDatasets = useMemo<HeatmapDataset[]>(() => {
    const datasets: HeatmapDataset[] = []
    if (activeDatasetSet.has('airMonitors')) {
      datasets.push({
        id: 'air',
        label: 'Air Monitors',
        points: monitors
          .filter((m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude))
          .map((m) => ({ lng: m.longitude, lat: m.latitude })),
        color: ['#bae6fd', '#38bdf8', '#0284c7', '#075985'],
      })
    }
    if (activeDatasetSet.has('restaurants')) {
      datasets.push({
        id: 'food',
        label: 'Restaurants',
        points: restaurants
          .filter((r) => r.latitude && r.longitude)
          .map((r) => ({ lng: r.longitude as number, lat: r.latitude as number })),
        color: ['#fed7aa', '#fb923c', '#ea580c', '#9a3412'],
      })
    }
    if (activeDatasetSet.has('crime')) {
      datasets.push({
        id: 'crime',
        label: 'Property Crime',
        points: incidents
          .filter((incident) => Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude))
          .map((incident) => ({ lng: incident.longitude, lat: incident.latitude })),
        color: ['#fecaca', '#f87171', '#dc2626', '#7f1d1d'],
      })
    }
    if (activeDatasetSet.has('parkAmenities')) {
      datasets.push({
        id: 'amenities',
        label: 'Amenities',
        points: amenities
          .filter((a) => Number.isFinite(a.latitude) && Number.isFinite(a.longitude))
          .map((a) => ({ lng: a.longitude, lat: a.latitude })),
        color: ['#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
      })
    }
    if (activeDatasetSet.has('transitStops')) {
      datasets.push({
        id: 'transit',
        label: 'Transit Stops',
        points: transitStops
          .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
          .map((s) => ({ lng: s.longitude, lat: s.latitude })),
        color: ['#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'],
      })
    }
    if (activeDatasetSet.has('icbcCrashes')) {
      datasets.push({
        id: 'icbc',
        label: 'ICBC Crashes',
        points: icbcCrashesState.features
          .filter((f) => f.geometry.type === 'Point')
          .map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })),
        color: ['#fee2e2', '#fca5a5', '#dc2626', '#7f1d1d'],
      })
    }
    if (activeDatasetSet.has('wildlifeAccidents')) {
      datasets.push({
        id: 'wars',
        label: 'Wildlife Accidents',
        points: wildlifeState.features
          .filter((f) => f.geometry.type === 'Point')
          .map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })),
        color: ['#fef3c7', '#fbbf24', '#a16207', '#713f12'],
      })
    }
    return datasets
  }, [
    activeDatasetSet,
    monitors,
    restaurants,
    incidents,
    amenities,
    transitStops,
    icbcCrashesState.features,
    wildlifeState.features,
  ])

  const errors = useMemo(() => {
    const combined: string[] = []
    if (monitorsError) combined.push(`Air monitors: ${monitorsError}`)
    if (restaurantsError) combined.push(`Food inspections: ${restaurantsError}`)
    if (parksError) combined.push(`Parks data: ${parksError}`)
    if (censusError) combined.push(`Census data: ${censusError}`)
    if (crimeError) combined.push(`Property crime: ${crimeError}`)
    if (transitError) combined.push(`Transit stops: ${transitError}`)
    if (transitRoutesState.error) combined.push(`Transit routes: ${transitRoutesState.error}`)
    if (icbcCrashesState.error) combined.push(`ICBC crashes: ${icbcCrashesState.error}`)
    if (wildlifeState.error) combined.push(`Wildlife accidents: ${wildlifeState.error}`)
    if (bcAssessmentError) combined.push(`BC Assessment: ${bcAssessmentError}`)
    return combined
  }, [
    bcAssessmentError,
    censusError,
    crimeError,
    icbcCrashesState.error,
    monitorsError,
    parksError,
    restaurantsError,
    transitError,
    transitRoutesState.error,
    wildlifeState.error,
  ])

  const loading =
    loadingMonitors ||
    loadingRestaurants ||
    loadingParks ||
    loadingCensus ||
    loadingCrime ||
    loadingTransit ||
    transitRoutesState.loading ||
    icbcCrashesState.loading ||
    wildlifeState.loading ||
    (bcAssessmentEnabled && loadingBcAssessment)

  return { allItems, heatmapDatasets, loading, errors }
}
