import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, Layers } from 'lucide-react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { HeatmapMashupLayer, type HeatmapDataset } from '@/components/HeatmapMashupLayer'
import { NeighborhoodReport } from '@/components/NeighborhoodReport'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { LegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
import { useAirQualityData } from '@/maps/airquality'
import { useBcAssessmentData } from '@/maps/bcassessment/hooks/useBcAssessmentData'
import type { PropertyCategory } from '@/maps/bcassessment/types'
import { useCensusData } from '@/maps/census/hooks/useCensusData'
import { useRestaurantData } from '@/maps/foodmap/hooks/useRestaurantData'
import type { HazardRating, Inspection } from '@/maps/foodmap/types'
import { useParksData } from '@/maps/parks/hooks/useParksData'
import type { ParkClassification, TrailUserClass } from '@/maps/parks/types'
import { getCrimeCategory } from '@/maps/pgdata/constants'
import { useCrimeData } from '@/maps/pgdata/hooks/useCrimeData'
import { useTransitData } from '@/maps/scorebuilder/hooks/useTransitData'
import { cn } from '@/lib/utils'
import { useExplorerGeoJson } from './hooks/useExplorerGeoJson'
import { datasetById, EXPLORER_DATASETS, GEOMETRY_TYPE_LABEL, LOW_COST_NETWORKS } from './constants'
import { ExplorerMap } from './components/ExplorerMap'
import { ExplorerSidebar, formatRelevance } from './components/ExplorerSidebar'
import type {
  ExplorerDatasetId,
  ExplorerDatasetStat,
  ExplorerGeometryType,
  ExplorerItem,
  ExplorerLineCollection,
  ExplorerPointCollection,
  ExplorerPolygonCollection,
  GeometryBounds,
  SpatialFilter,
} from './types'

const ALL_GEOMETRY_TYPES: ExplorerGeometryType[] = ['point', 'line', 'polygon']
const ALL_DATASET_IDS: ExplorerDatasetId[] = EXPLORER_DATASETS.map((dataset) => dataset.id)
const DEFAULT_ACTIVE_DATASET_IDS: ExplorerDatasetId[] = [
  'restaurants',
  'parkAmenities',
  'transitStops',
  'trails',
  'parks',
]
const EXPLORER_SESSION_NOW = Date.now()

interface TransitRouteProperties {
  routeId: string
  routeShortName: string
  routeLongName: string
  routeColor: string
  shapeId: string
  headsigns?: string[]
  directions?: string[]
  pointCount?: number
}

interface IcbcCrashProperties {
  dataset: string
  datasetTitle: string
  location: string
  municipality: string
  crashCount: number
  sourceLocationName: string
  geocodeMatchType: string
}

interface WildlifeAccidentProperties {
  id: string
  accidentDate: string
  year: number
  timeOfKill: string
  nearestTown: string
  species: string
  quantity: number
  sourceFile: string
}

const PROPERTY_CATEGORY_WEIGHT: Record<PropertyCategory, number> = {
  residential: 6,
  'multi-family': 10,
  commercial: 12,
  industrial: 11,
  institutional: 10,
  vacant: 4,
  farm: 6,
  other: 5,
}

type SortMode = 'relevance' | 'name'

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function normalize(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

function createPointBounds(longitude: number, latitude: number): GeometryBounds {
  const pad = 0.008
  return { minLng: longitude - pad, minLat: latitude - pad, maxLng: longitude + pad, maxLat: latitude + pad }
}

function expandBounds(bounds: GeometryBounds, lng: number, lat: number) {
  if (lng < bounds.minLng) bounds.minLng = lng
  if (lng > bounds.maxLng) bounds.maxLng = lng
  if (lat < bounds.minLat) bounds.minLat = lat
  if (lat > bounds.maxLat) bounds.maxLat = lat
}

function geometryBounds(geometry: GeoJSON.Geometry): GeometryBounds | null {
  if (geometry.type === 'Point') {
    const [lng, lat] = geometry.coordinates
    return createPointBounds(lng, lat)
  }
  const bounds: GeometryBounds = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity }
  const scanRing = (ring: number[][]) => {
    ring.forEach(([lng, lat]) => expandBounds(bounds, lng, lat))
  }
  if (geometry.type === 'LineString') geometry.coordinates.forEach(([lng, lat]) => expandBounds(bounds, lng, lat))
  else if (geometry.type === 'MultiLineString')
    geometry.coordinates.forEach((line) => line.forEach(([lng, lat]) => expandBounds(bounds, lng, lat)))
  else if (geometry.type === 'Polygon') geometry.coordinates.forEach((ring) => scanRing(ring))
  else if (geometry.type === 'MultiPolygon')
    geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => scanRing(ring)))
  else return null
  if (!Number.isFinite(bounds.minLng) || !Number.isFinite(bounds.minLat)) return null
  if (bounds.minLng === bounds.maxLng && bounds.minLat === bounds.maxLat)
    return createPointBounds(bounds.minLng, bounds.minLat)
  return bounds
}

function formatNullableText(value: string | number | null | undefined, fallback = 'N/A'): string {
  if (value == null) return fallback
  const text = String(value).trim()
  return text || fallback
}

function countInspectionViolations(inspections: Inspection[] | undefined): number {
  if (!inspections || inspections.length === 0) return 0
  return inspections.reduce((total, inspection) => {
    const counted = (inspection.violations || []).length
    const fallback = (inspection.critical_violations_count || 0) + (inspection.non_critical_violations_count || 0)
    return total + Math.max(counted, fallback)
  }, 0)
}

function classificationWeight(classification: ParkClassification | null): number {
  switch (classification) {
    case 'Major':
      return 14
    case 'Community':
      return 12
    case 'Athletic':
      return 11
    case 'Nature':
    case 'Green Space':
      return 10
    case 'Special Purpose':
      return 9
    default:
      return 7
  }
}

function trailClassWeight(userClass: TrailUserClass | null): number {
  switch (userClass) {
    case 'Multiuse':
      return 12
    case 'Walking':
      return 9
    case 'Equine':
      return 8
    default:
      return 6
  }
}

function hazardWeight(rating: HazardRating): number {
  switch (rating) {
    case 'Moderate':
      return 22
    case 'Low':
      return 12
    case 'Unknown':
    default:
      return 6
  }
}

function boundsIntersect(a: GeometryBounds, b: SpatialFilter): boolean {
  return a.maxLng >= b.minLng && a.minLng <= b.maxLng && a.maxLat >= b.minLat && a.minLat <= b.maxLat
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export default function ExplorerSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showSidebar, setShowSidebar] = useState(true)
  const [geometryFilters, setGeometryFilters] = useState<ExplorerGeometryType[]>(() => {
    const values = (searchParams.get('geom') || '').split(',').filter(Boolean) as ExplorerGeometryType[]
    return values.length ? values.filter((value) => ALL_GEOMETRY_TYPES.includes(value)) : ALL_GEOMETRY_TYPES
  })
  const [activeDatasetIds, setActiveDatasetIds] = useState<ExplorerDatasetId[]>(() => {
    const datasetParam = searchParams.get('datasets') || ''
    if (datasetParam === 'all') return ALL_DATASET_IDS
    const values = datasetParam.split(',').filter(Boolean) as ExplorerDatasetId[]
    const valid = values.filter((value) => ALL_DATASET_IDS.includes(value))
    return valid.length ? valid : DEFAULT_ACTIVE_DATASET_IDS
  })
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [sortMode, setSortMode] = useState<SortMode>(() => (searchParams.get('sort') === 'name' ? 'name' : 'relevance'))
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [spatialFilter, setSpatialFilter] = useState<SpatialFilter | null>(null)
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() => ({
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
  }))
  const [showHeatmap, setShowHeatmap] = useState(() => searchParams.get('heatmap') === '1')
  const [showMobileLegend, setShowMobileLegend] = useState(false)
  const [neighborhoodPoint, setNeighborhoodPoint] = useState<{ lat: number; lng: number } | null>(null)

  const activeDatasetSetForLoading = useMemo(() => new Set(activeDatasetIds), [activeDatasetIds])
  const parksDataEnabled =
    activeDatasetSetForLoading.has('parks') ||
    activeDatasetSetForLoading.has('trails') ||
    activeDatasetSetForLoading.has('parkAmenities')
  const censusDataEnabled =
    activeDatasetSetForLoading.has('censusDa') ||
    activeDatasetSetForLoading.has('censusCt') ||
    activeDatasetSetForLoading.has('censusCsd') ||
    activeDatasetSetForLoading.has('censusCd') ||
    activeDatasetSetForLoading.has('censusDb')

  const {
    monitors,
    loading: loadingMonitors,
    error: monitorsError,
  } = useAirQualityData(activeDatasetSetForLoading.has('airMonitors'))
  const {
    restaurants,
    loading: loadingRestaurants,
    error: restaurantsError,
  } = useRestaurantData(activeDatasetSetForLoading.has('restaurants'))
  const { parks, trails, amenities, loading: loadingParks, error: parksError } = useParksData([], parksDataEnabled)
  const { unitsByLevel, loading: loadingCensus, error: censusError } = useCensusData(censusDataEnabled)
  const { incidents, loading: loadingCrime, error: crimeError } = useCrimeData(activeDatasetSetForLoading.has('crime'))
  const {
    stops: transitStops,
    loading: loadingTransit,
    error: transitError,
  } = useTransitData(activeDatasetSetForLoading.has('transitStops'))
  const transitRoutesState = useExplorerGeoJson<GeoJSON.LineString, TransitRouteProperties>(
    '/data/transit/prince_george_gtfs_routes.geojson',
    activeDatasetSetForLoading.has('transitRoutes'),
  )
  const icbcCrashesState = useExplorerGeoJson<GeoJSON.Point, IcbcCrashProperties>(
    '/data/icbc/prince_george_crash_locations.geojson',
    activeDatasetSetForLoading.has('icbcCrashes'),
  )
  const wildlifeState = useExplorerGeoJson<GeoJSON.Point, WildlifeAccidentProperties>(
    '/data/wars/prince_george_wildlife_accidents.geojson',
    activeDatasetSetForLoading.has('wildlifeAccidents'),
  )
  const bcAssessmentEnabled = activeDatasetIds.includes('bcAssessment')
  const {
    properties: bcParcels,
    loading: loadingBcAssessment,
    error: bcAssessmentError,
  } = useBcAssessmentData(bcAssessmentEnabled)

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    const defaultDatasetsActive =
      activeDatasetIds.length === DEFAULT_ACTIVE_DATASET_IDS.length &&
      DEFAULT_ACTIVE_DATASET_IDS.every((datasetId) => activeDatasetIds.includes(datasetId))
    const datasetValue =
      activeDatasetIds.length === ALL_DATASET_IDS.length
        ? 'all'
        : defaultDatasetsActive
          ? ''
          : activeDatasetIds.join(',')
    const geomValue = geometryFilters.length === ALL_GEOMETRY_TYPES.length ? '' : geometryFilters.join(',')
    if (datasetValue) params.set('datasets', datasetValue)
    else params.delete('datasets')
    if (geomValue) params.set('geom', geomValue)
    else params.delete('geom')
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    else params.delete('q')
    if (sortMode !== 'relevance') params.set('sort', sortMode)
    else params.delete('sort')
    if (dateRange.from) params.set('from', dateRange.from)
    else params.delete('from')
    if (dateRange.to) params.set('to', dateRange.to)
    else params.delete('to')
    if (showHeatmap) params.set('heatmap', '1')
    else params.delete('heatmap')
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [activeDatasetIds, dateRange, geometryFilters, searchParams, searchQuery, setSearchParams, showHeatmap, sortMode])

  // Date range parsing
  const dateFrom = useMemo(() => (dateRange.from ? new Date(dateRange.from).getTime() : null), [dateRange.from])
  const dateTo = useMemo(() => {
    if (!dateRange.to) return null
    const date = new Date(dateRange.to)
    date.setHours(23, 59, 59, 999)
    return date.getTime()
  }, [dateRange.to])

  const monitorItems = useMemo<ExplorerItem[]>(() => {
    return monitors
      .filter((monitor) => Number.isFinite(monitor.latitude) && Number.isFinite(monitor.longitude))
      .map((monitor) => {
        const parameterCount = monitor.parameters.filter((parameter) => parameter.trim()).length
        const activeBoost = (monitor.status || '').toLowerCase() === 'active' ? 20 : 8
        const networkBoost = LOW_COST_NETWORKS.has(monitor.network) ? 9 : 14
        const richnessBoost = Math.min(parameterCount * 6, 24)
        const relevance = clampScore(30 + activeBoost + networkBoost + richnessBoost)
        const geometry: GeoJSON.Point = { type: 'Point', coordinates: [monitor.longitude, monitor.latitude] }
        return {
          id: `air:${monitor.id}`,
          datasetId: 'airMonitors' as const,
          geometryType: 'point' as const,
          name: monitor.name,
          subtitle: `${monitor.network} | ${formatNullableText(monitor.city, 'Unknown city')}`,
          relevance,
          relevanceBreakdown: [
            { label: 'Base', points: 30 },
            { label: monitor.status === 'active' ? 'Active status' : 'Inactive', points: activeBoost },
            {
              label: LOW_COST_NETWORKS.has(monitor.network) ? 'Low-cost network' : 'Reference network',
              points: networkBoost,
            },
            { label: `${parameterCount} param(s)`, points: richnessBoost },
          ],
          summary: `Active state ${formatNullableText(monitor.status, 'unknown')} with ${parameterCount} tracked parameter(s).`,
          bounds: createPointBounds(monitor.longitude, monitor.latitude),
          geometry,
          details: [
            { label: 'Network', value: monitor.network },
            { label: 'Status', value: formatNullableText(monitor.status, 'Unknown') },
            { label: 'City', value: formatNullableText(monitor.city, 'Unknown') },
            { label: 'Province', value: formatNullableText(monitor.province, 'Unknown') },
            { label: 'Parameters', value: monitor.parameters.join(', ') || 'N/A' },
          ],
        }
      })
  }, [monitors])

  const restaurantItems = useMemo<ExplorerItem[]>(() => {
    return restaurants
      .filter((restaurant) => restaurant.latitude != null && restaurant.longitude != null)
      .map((restaurant) => {
        const latitude = restaurant.latitude as number
        const longitude = restaurant.longitude as number

        // Apply temporal filter to inspections
        let filteredInspections = restaurant.inspections || []
        if (dateFrom || dateTo) {
          filteredInspections = filteredInspections.filter((insp) => {
            if (!insp.date) return false
            const ts = new Date(insp.date).getTime()
            if (dateFrom && ts < dateFrom) return false
            if (dateTo && ts > dateTo) return false
            return true
          })
        }

        const inspectionCount = filteredInspections.length
        const violationCount = countInspectionViolations(filteredInspections)
        const rating = (restaurant.current_hazard_rating || restaurant.hazard_rating || 'Unknown') as HazardRating
        const hazardPts = hazardWeight(rating)
        const violPts = Math.min(violationCount * 2.5, 40)
        const inspPts = Math.min(inspectionCount * 1.6, 20)
        const relevance = clampScore(20 + hazardPts + violPts + inspPts)
        const geometry: GeoJSON.Point = { type: 'Point', coordinates: [longitude, latitude] }

        const latestDate = filteredInspections.length
          ? Math.max(...filteredInspections.map((i) => new Date(i.date || 0).getTime()))
          : undefined

        return {
          id: `food:${restaurant.details_url}`,
          datasetId: 'restaurants' as const,
          geometryType: 'point' as const,
          name: restaurant.name,
          subtitle: `${rating} hazard | ${restaurant.facility_type}`,
          relevance,
          relevanceBreakdown: [
            { label: 'Base', points: 20 },
            { label: `${rating} hazard`, points: hazardPts },
            { label: `${violationCount} violation(s)`, points: Math.round(violPts) },
            { label: `${inspectionCount} inspection(s)`, points: Math.round(inspPts) },
          ],
          summary: `${violationCount} violation(s) across ${inspectionCount} inspection(s).`,
          bounds: createPointBounds(longitude, latitude),
          geometry,
          details: [
            { label: 'Hazard', value: rating },
            { label: 'Facility', value: formatNullableText(restaurant.facility_type, 'Unknown') },
            { label: 'Address', value: formatNullableText(restaurant.address, 'Unknown') },
            { label: 'Inspections', value: inspectionCount.toLocaleString() },
            { label: 'Violations', value: violationCount.toLocaleString() },
          ],
          timestamp: latestDate,
        }
      })
  }, [restaurants, dateFrom, dateTo])

  const crimeItems = useMemo<ExplorerItem[]>(() => {
    return incidents
      .filter((incident) => Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude))
      .filter((incident) => {
        const ts = incident.date.getTime()
        if (dateFrom && ts < dateFrom) return false
        if (dateTo && ts > dateTo) return false
        return true
      })
      .map((incident) => {
        const category = getCrimeCategory(incident.crimeType)
        const ageDays = Math.max(0, (EXPLORER_SESSION_NOW - incident.date.getTime()) / 86_400_000)
        const recencyPts = Math.round(Math.max(0, 34 - Math.min(ageDays / 14, 34)))
        const locationPts = incident.address || incident.community ? 12 : 4
        const filePts = incident.fileNumber ? 8 : 0
        const relevance = clampScore(28 + recencyPts + locationPts + filePts)
        const geometry: GeoJSON.Point = { type: 'Point', coordinates: [incident.longitude, incident.latitude] }
        const dateLabel = incident.date.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
        })

        return {
          id: `crime:${incident.id}`,
          datasetId: 'crime' as const,
          geometryType: 'point' as const,
          name: incident.crimeType,
          subtitle: `${category} | ${formatNullableText(incident.community, 'Unknown community')}`,
          relevance,
          relevanceBreakdown: [
            { label: 'Base', points: 28 },
            { label: 'Recency', points: recencyPts },
            { label: 'Location detail', points: locationPts },
            { label: incident.fileNumber ? 'Has file number' : 'No file number', points: filePts },
          ],
          summary: `${category} incident reported ${dateLabel} near ${formatNullableText(incident.address, 'an unknown address').toLowerCase()}.`,
          bounds: createPointBounds(incident.longitude, incident.latitude),
          geometry,
          details: [
            { label: 'Category', value: category },
            { label: 'Type', value: incident.crimeType },
            { label: 'Date', value: dateLabel },
            { label: 'Time', value: formatNullableText(incident.time, 'Unknown') },
            { label: 'Address', value: formatNullableText(incident.address, 'Unknown') },
            { label: 'Community', value: formatNullableText(incident.community, 'Unknown') },
            { label: 'File', value: formatNullableText(incident.fileNumber, 'Unknown') },
          ],
          timestamp: incident.date.getTime(),
        }
      })
  }, [dateFrom, dateTo, incidents])

  const amenityItems = useMemo<ExplorerItem[]>(() => {
    return amenities
      .filter((amenity) => Number.isFinite(amenity.latitude) && Number.isFinite(amenity.longitude))
      .map((amenity) => {
        const typePts = amenity.type ? 10 : 0
        const parkPts = amenity.parkName ? 10 : 0
        const relevance = clampScore(34 + parkPts + typePts)
        const geometry: GeoJSON.Point = { type: 'Point', coordinates: [amenity.longitude, amenity.latitude] }
        return {
          id: `amenity:${amenity.id}`,
          datasetId: 'parkAmenities' as const,
          geometryType: 'point' as const,
          name: formatNullableText(amenity.type, 'Park Amenity'),
          subtitle: formatNullableText(amenity.parkName, 'Unknown park'),
          relevance,
          relevanceBreakdown: [
            { label: 'Base', points: 34 },
            { label: amenity.parkName ? 'Has park name' : 'No park name', points: parkPts },
            { label: amenity.type ? 'Has type' : 'No type', points: typePts },
          ],
          summary: 'Park infrastructure and public-space amenity location.',
          bounds: createPointBounds(amenity.longitude, amenity.latitude),
          geometry,
          details: [
            { label: 'Amenity Type', value: formatNullableText(amenity.type, 'Unknown') },
            { label: 'Park', value: formatNullableText(amenity.parkName, 'Unknown') },
            { label: 'Location', value: formatNullableText(amenity.location, 'Unknown') },
          ],
        }
      })
  }, [amenities])

  const trailLengthRange = useMemo(() => {
    const lengths = trails.map((trail) => trail.length || 0).filter((length) => Number.isFinite(length))
    return { min: lengths.length ? Math.min(...lengths) : 0, max: lengths.length ? Math.max(...lengths) : 1 }
  }, [trails])

  const trailItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    trails
      .filter((trail) => trail.coordinates.length >= 2)
      .forEach((trail) => {
        const length = trail.length || 0
        const normalizedLength = normalize(length, trailLengthRange.min, trailLengthRange.max)
        const lengthPts = Math.round(normalizedLength * 50)
        const winterPts = trail.winterMaintenance ? 12 : 4
        const classPts = trailClassWeight(trail.userClass)
        const relevance = clampScore(24 + lengthPts + winterPts + classPts)
        const geometry: GeoJSON.LineString = { type: 'LineString', coordinates: trail.coordinates }
        const bounds = geometryBounds(geometry)
        if (!bounds) return
        items.push({
          id: `trail:${trail.id}`,
          datasetId: 'trails',
          geometryType: 'line',
          name: trail.name,
          subtitle: `${formatNullableText(trail.userClass, 'Unknown class')} | ${formatNullableText(trail.parkName, 'No park')}`,
          relevance,
          relevanceBreakdown: [
            { label: 'Base', points: 24 },
            { label: `Length (norm)`, points: lengthPts },
            { label: trail.winterMaintenance ? 'Winter maintained' : 'No winter maint.', points: winterPts },
            { label: `${trail.userClass || 'Unknown'} class`, points: classPts },
          ],
          summary: `${trail.winterMaintenance ? 'Maintained' : 'Not maintained'} in winter with length ${length.toLocaleString(undefined, { maximumFractionDigits: 0 })} m.`,
          bounds,
          geometry,
          details: [
            { label: 'User Class', value: formatNullableText(trail.userClass, 'Unknown') },
            { label: 'Surface', value: formatNullableText(trail.surfaceMaterial, 'Unknown') },
            { label: 'Winter', value: trail.winterMaintenance ? 'Maintained' : 'Not maintained' },
            { label: 'Length (m)', value: length.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
          ],
        })
      })
    return items
  }, [trailLengthRange.max, trailLengthRange.min, trails])

  const parkAreaRange = useMemo(() => {
    const areas = parks.map((park) => park.area || 0).filter((area) => Number.isFinite(area))
    return { min: areas.length ? Math.min(...areas) : 0, max: areas.length ? Math.max(...areas) : 1 }
  }, [parks])

  const parkItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    parks.forEach((park) => {
      const areaSqm = park.area || 0
      const areaKm2 = areaSqm > 0 ? areaSqm / 1_000_000 : 0
      const normalizedArea = normalize(areaSqm, parkAreaRange.min, parkAreaRange.max)
      const areaPts = Math.round(normalizedArea * 48)
      const devPts = park.developed ? 14 : 6
      const classPts = classificationWeight(park.classification)
      const relevance = clampScore(24 + areaPts + devPts + classPts)
      const bounds = geometryBounds(park.geometry)
      if (!bounds) return
      items.push({
        id: `park:${park.id}`,
        datasetId: 'parks',
        geometryType: 'polygon',
        name: park.name,
        subtitle: `${formatNullableText(park.classification, 'Unclassified')} | ${formatNullableText(park.subType, 'No subtype')}`,
        relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 24 },
          { label: 'Area (norm)', points: areaPts },
          { label: park.developed ? 'Developed' : 'Natural', points: devPts },
          { label: `${park.classification || 'Unknown'} class`, points: classPts },
        ],
        summary: `${park.developed ? 'Developed' : 'Natural/open'} park with area ${areaKm2.toLocaleString(undefined, { maximumFractionDigits: 2 })} km².`,
        bounds,
        geometry: park.geometry,
        details: [
          { label: 'Classification', value: formatNullableText(park.classification, 'Unknown') },
          { label: 'Subtype', value: formatNullableText(park.subType, 'Unknown') },
          { label: 'Developed', value: park.developed ? 'Yes' : 'No' },
          { label: 'Area (km²)', value: areaKm2.toLocaleString(undefined, { maximumFractionDigits: 2 }) },
        ],
      })
    })
    return items
  }, [parkAreaRange.max, parkAreaRange.min, parks])

  // Census DA items
  const censusDaRange = useMemo(() => {
    const daUnits = unitsByLevel.da
    const populations = daUnits.map((unit) => unit.population || 0).filter((value) => Number.isFinite(value))
    const densities = daUnits.map((unit) => unit.populationDensity || 0).filter((value) => Number.isFinite(value))
    return {
      populationMin: populations.length ? Math.min(...populations) : 0,
      populationMax: populations.length ? Math.max(...populations) : 1,
      densityMin: densities.length ? Math.min(...densities) : 0,
      densityMax: densities.length ? Math.max(...densities) : 1,
    }
  }, [unitsByLevel.da])

  const censusDaItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    unitsByLevel.da.forEach((unit) => {
      const population = unit.population || 0
      const density = unit.populationDensity || 0
      const popNorm = normalize(population, censusDaRange.populationMin, censusDaRange.populationMax)
      const densityNorm = normalize(density, censusDaRange.densityMin, censusDaRange.densityMax)
      const densityPts = Math.round(densityNorm * 44)
      const popPts = Math.round(popNorm * 32)
      const relevance = clampScore(22 + densityPts + popPts)
      const bounds = geometryBounds(unit.geometry)
      if (!bounds) return
      items.push({
        id: `census-da:${unit.id}`,
        datasetId: 'censusDa',
        geometryType: 'polygon',
        name: unit.name,
        subtitle: `DA ${unit.id}`,
        relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 22 },
          { label: 'Pop. density (norm)', points: densityPts },
          { label: 'Population (norm)', points: popPts },
        ],
        summary: `Population ${population.toLocaleString()} with density ${density.toLocaleString(undefined, { maximumFractionDigits: 1 })} /km².`,
        bounds,
        geometry: unit.geometry,
        details: [
          { label: 'Population', value: population.toLocaleString() },
          { label: 'Density', value: density.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
          { label: 'Households', value: (unit.households || 0).toLocaleString() },
          { label: 'Dwellings', value: (unit.dwellings || 0).toLocaleString() },
          { label: 'Area (km²)', value: (unit.areaSqKm || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) },
        ],
      })
    })
    return items
  }, [censusDaRange, unitsByLevel.da])

  // Census CT items (new)
  const censusCtRange = useMemo(() => {
    const ctUnits = unitsByLevel.ct
    const populations = ctUnits.map((u) => u.population || 0).filter(Number.isFinite)
    const densities = ctUnits.map((u) => u.populationDensity || 0).filter(Number.isFinite)
    return {
      populationMin: populations.length ? Math.min(...populations) : 0,
      populationMax: populations.length ? Math.max(...populations) : 1,
      densityMin: densities.length ? Math.min(...densities) : 0,
      densityMax: densities.length ? Math.max(...densities) : 1,
    }
  }, [unitsByLevel.ct])

  const censusCtItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    unitsByLevel.ct.forEach((unit) => {
      const population = unit.population || 0
      const density = unit.populationDensity || 0
      const popNorm = normalize(population, censusCtRange.populationMin, censusCtRange.populationMax)
      const densityNorm = normalize(density, censusCtRange.densityMin, censusCtRange.densityMax)
      const densityPts = Math.round(densityNorm * 44)
      const popPts = Math.round(popNorm * 32)
      const relevance = clampScore(22 + densityPts + popPts)
      const bounds = geometryBounds(unit.geometry)
      if (!bounds) return
      items.push({
        id: `census-ct:${unit.id}`,
        datasetId: 'censusCt',
        geometryType: 'polygon',
        name: unit.name,
        subtitle: `CT ${unit.id}`,
        relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 22 },
          { label: 'Pop. density (norm)', points: densityPts },
          { label: 'Population (norm)', points: popPts },
        ],
        summary: `Population ${population.toLocaleString()} with density ${density.toLocaleString(undefined, { maximumFractionDigits: 1 })} /km².`,
        bounds,
        geometry: unit.geometry,
        details: [
          { label: 'Population', value: population.toLocaleString() },
          { label: 'Density', value: density.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
          { label: 'Households', value: (unit.households || 0).toLocaleString() },
          { label: 'Dwellings', value: (unit.dwellings || 0).toLocaleString() },
          { label: 'Area (km²)', value: (unit.areaSqKm || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) },
        ],
      })
    })
    return items
  }, [censusCtRange, unitsByLevel.ct])

  // Census CSD items (new)
  const censusCsdRange = useMemo(() => {
    const csdUnits = unitsByLevel.csd
    const populations = csdUnits.map((u) => u.population || 0).filter(Number.isFinite)
    const densities = csdUnits.map((u) => u.populationDensity || 0).filter(Number.isFinite)
    return {
      populationMin: populations.length ? Math.min(...populations) : 0,
      populationMax: populations.length ? Math.max(...populations) : 1,
      densityMin: densities.length ? Math.min(...densities) : 0,
      densityMax: densities.length ? Math.max(...densities) : 1,
    }
  }, [unitsByLevel.csd])

  const censusCsdItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    unitsByLevel.csd.forEach((unit) => {
      const population = unit.population || 0
      const density = unit.populationDensity || 0
      const popNorm = normalize(population, censusCsdRange.populationMin, censusCsdRange.populationMax)
      const densityNorm = normalize(density, censusCsdRange.densityMin, censusCsdRange.densityMax)
      const densityPts = Math.round(densityNorm * 44)
      const popPts = Math.round(popNorm * 32)
      const relevance = clampScore(22 + densityPts + popPts)
      const bounds = geometryBounds(unit.geometry)
      if (!bounds) return
      items.push({
        id: `census-csd:${unit.id}`,
        datasetId: 'censusCsd',
        geometryType: 'polygon',
        name: unit.name,
        subtitle: `CSD ${unit.id}`,
        relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 22 },
          { label: 'Pop. density (norm)', points: densityPts },
          { label: 'Population (norm)', points: popPts },
        ],
        summary: `Population ${population.toLocaleString()} with density ${density.toLocaleString(undefined, { maximumFractionDigits: 1 })} /km².`,
        bounds,
        geometry: unit.geometry,
        details: [
          { label: 'Population', value: population.toLocaleString() },
          { label: 'Density', value: density.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
          { label: 'Households', value: (unit.households || 0).toLocaleString() },
          { label: 'Dwellings', value: (unit.dwellings || 0).toLocaleString() },
          { label: 'Area (km²)', value: (unit.areaSqKm || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) },
        ],
      })
    })
    return items
  }, [censusCsdRange, unitsByLevel.csd])

  // Census CD items
  const censusCdRange = useMemo(() => {
    const cdUnits = unitsByLevel.cd
    const populations = cdUnits.map((u) => u.population || 0).filter(Number.isFinite)
    const densities = cdUnits.map((u) => u.populationDensity || 0).filter(Number.isFinite)
    return {
      populationMin: populations.length ? Math.min(...populations) : 0,
      populationMax: populations.length ? Math.max(...populations) : 1,
      densityMin: densities.length ? Math.min(...densities) : 0,
      densityMax: densities.length ? Math.max(...densities) : 1,
    }
  }, [unitsByLevel.cd])

  const censusCdItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    unitsByLevel.cd.forEach((unit) => {
      const population = unit.population || 0
      const density = unit.populationDensity || 0
      const popNorm = normalize(population, censusCdRange.populationMin, censusCdRange.populationMax)
      const densityNorm = normalize(density, censusCdRange.densityMin, censusCdRange.densityMax)
      const densityPts = Math.round(densityNorm * 44)
      const popPts = Math.round(popNorm * 32)
      const relevance = clampScore(22 + densityPts + popPts)
      const bounds = geometryBounds(unit.geometry)
      if (!bounds) return
      items.push({
        id: `census-cd:${unit.id}`,
        datasetId: 'censusCd',
        geometryType: 'polygon',
        name: unit.name,
        subtitle: `CD ${unit.id}`,
        relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 22 },
          { label: 'Pop. density (norm)', points: densityPts },
          { label: 'Population (norm)', points: popPts },
        ],
        summary: `Population ${population.toLocaleString()} with density ${density.toLocaleString(undefined, { maximumFractionDigits: 1 })} /km².`,
        bounds,
        geometry: unit.geometry,
        details: [
          { label: 'Population', value: population.toLocaleString() },
          { label: 'Density', value: density.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
          { label: 'Households', value: (unit.households || 0).toLocaleString() },
          { label: 'Dwellings', value: (unit.dwellings || 0).toLocaleString() },
          { label: 'Area (km²)', value: (unit.areaSqKm || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) },
        ],
      })
    })
    return items
  }, [censusCdRange, unitsByLevel.cd])

  // Census DB items
  const censusDbRange = useMemo(() => {
    const dbUnits = unitsByLevel.db
    const populations = dbUnits.map((u) => u.population || 0).filter(Number.isFinite)
    return {
      populationMin: populations.length ? Math.min(...populations) : 0,
      populationMax: populations.length ? Math.max(...populations) : 1,
    }
  }, [unitsByLevel.db])

  const censusDbItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    unitsByLevel.db.forEach((unit) => {
      const population = unit.population || 0
      const popNorm = normalize(population, censusDbRange.populationMin, censusDbRange.populationMax)
      const popPts = Math.round(popNorm * 60)
      const relevance = clampScore(20 + popPts)
      const bounds = geometryBounds(unit.geometry)
      if (!bounds) return
      items.push({
        id: `census-db:${unit.id}`,
        datasetId: 'censusDb',
        geometryType: 'polygon',
        name: unit.name,
        subtitle: `DB ${unit.id}`,
        relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 20 },
          { label: 'Population (norm)', points: popPts },
        ],
        summary: `Census block with population ${population.toLocaleString()}.`,
        bounds,
        geometry: unit.geometry,
        details: [
          { label: 'Population', value: population.toLocaleString() },
          { label: 'Dwellings', value: (unit.dwellings || 0).toLocaleString() },
          { label: 'Area (km²)', value: (unit.areaSqKm || 0).toLocaleString(undefined, { maximumFractionDigits: 4 }) },
        ],
      })
    })
    return items
  }, [censusDbRange, unitsByLevel.db])

  // Transit stops (point)
  const transitStopItems = useMemo<ExplorerItem[]>(() => {
    return transitStops
      .filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
      .map((stop) => {
        const shelterPts = stop.hasShelter ? 16 : 4
        const accessPts = stop.accessible ? 12 : 4
        const tripsPts = Math.min(Math.round(stop.weekdayTrips / 4), 24)
        const frequentPts = stop.frequent ? 10 : 0
        const relevance = clampScore(20 + shelterPts + accessPts + tripsPts + frequentPts)
        const geometry: GeoJSON.Point = { type: 'Point', coordinates: [stop.longitude, stop.latitude] }
        return {
          id: `transit-stop:${stop.id}`,
          datasetId: 'transitStops' as const,
          geometryType: 'point' as const,
          name: stop.name,
          subtitle: stop.frequent ? 'Frequent service' : `${stop.weekdayTrips} weekday trips`,
          relevance,
          relevanceBreakdown: [
            { label: 'Base', points: 20 },
            { label: stop.hasShelter ? 'Has shelter' : 'No shelter', points: shelterPts },
            { label: stop.accessible ? 'Accessible' : 'Not accessible', points: accessPts },
            { label: 'Weekday trips', points: tripsPts },
            { label: stop.frequent ? 'Frequent service' : 'Standard service', points: frequentPts },
          ],
          summary: `${stop.weekdayTrips} weekday trips across ${stop.serviceSpanHours.toFixed(1)} hr service span.`,
          bounds: createPointBounds(stop.longitude, stop.latitude),
          geometry,
          details: [
            { label: 'Stop ID', value: stop.id },
            { label: 'Shelter', value: stop.hasShelter ? 'Yes' : 'No' },
            { label: 'Accessible', value: stop.accessible ? 'Yes' : 'No' },
            { label: 'Weekday trips', value: stop.weekdayTrips.toLocaleString() },
            { label: 'Service span (hr)', value: stop.serviceSpanHours.toFixed(1) },
            { label: 'Status', value: formatNullableText(stop.status, 'Unknown') },
          ],
        }
      })
  }, [transitStops])

  // Transit routes (line)
  const transitRouteItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    transitRoutesState.features.forEach((feature) => {
      const geometry = feature.geometry
      if (geometry.type !== 'LineString') return
      const props = feature.properties
      const bounds = geometryBounds(geometry)
      if (!bounds) return
      const pointCount = props.pointCount ?? geometry.coordinates.length
      const lengthPts = Math.min(Math.round(pointCount / 12), 40)
      const headsignPts = props.headsigns && props.headsigns.length > 1 ? 10 : 5
      const directionPts = props.directions && props.directions.length > 1 ? 8 : 4
      const relevance = clampScore(28 + lengthPts + headsignPts + directionPts)
      items.push({
        id: `transit-route:${props.routeId}-${props.shapeId}`,
        datasetId: 'transitRoutes',
        geometryType: 'line',
        name: `Route ${props.routeShortName} | ${props.routeLongName}`,
        subtitle: (props.headsigns && props.headsigns[0]) || props.routeLongName,
        relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 28 },
          { label: 'Shape length', points: lengthPts },
          { label: 'Headsigns', points: headsignPts },
          { label: 'Directions', points: directionPts },
        ],
        summary: `Bus route ${props.routeShortName} (${props.routeLongName}) with ${pointCount} shape points.`,
        bounds,
        geometry,
        details: [
          { label: 'Route', value: props.routeShortName },
          { label: 'Long name', value: props.routeLongName },
          { label: 'Headsigns', value: (props.headsigns || []).join(', ') || 'N/A' },
          { label: 'Shape ID', value: props.shapeId },
        ],
      })
    })
    return items
  }, [transitRoutesState.features])

  // ICBC crashes (point)
  const icbcMaxCount = useMemo(() => {
    return icbcCrashesState.features.reduce(
      (max, feature) => Math.max(max, Number(feature.properties.crashCount) || 0),
      0,
    )
  }, [icbcCrashesState.features])

  const icbcItems = useMemo<ExplorerItem[]>(() => {
    return icbcCrashesState.features
      .filter((feature) => feature.geometry.type === 'Point')
      .map((feature) => {
        const [longitude, latitude] = feature.geometry.coordinates
        const props = feature.properties
        const crashCount = Number(props.crashCount) || 0
        const countNorm = icbcMaxCount > 0 ? crashCount / icbcMaxCount : 0
        const countPts = Math.round(countNorm * 60)
        const matchPts = props.geocodeMatchType?.includes('intersection') ? 10 : 5
        const relevance = clampScore(20 + countPts + matchPts)
        return {
          id: `icbc:${props.dataset}-${props.location}`,
          datasetId: 'icbcCrashes' as const,
          geometryType: 'point' as const,
          name: props.location || 'Crash location',
          subtitle: `${crashCount.toLocaleString()} crashes | ${props.datasetTitle}`,
          relevance,
          relevanceBreakdown: [
            { label: 'Base', points: 20 },
            { label: 'Crash count (norm)', points: countPts },
            { label: 'Geocode quality', points: matchPts },
          ],
          summary: `${crashCount} crashes reported at this location (${props.datasetTitle}).`,
          bounds: createPointBounds(longitude, latitude),
          geometry: feature.geometry,
          details: [
            { label: 'Location', value: formatNullableText(props.location, 'Unknown') },
            { label: 'Municipality', value: formatNullableText(props.municipality, 'Unknown') },
            { label: 'Crashes', value: crashCount.toLocaleString() },
            { label: 'Dataset', value: formatNullableText(props.datasetTitle, 'Unknown') },
            { label: 'Match type', value: formatNullableText(props.geocodeMatchType, 'Unknown') },
          ],
        }
      })
  }, [icbcCrashesState.features, icbcMaxCount])

  // Wildlife accidents (point)
  const wildlifeItems = useMemo<ExplorerItem[]>(() => {
    return wildlifeState.features
      .filter((feature) => feature.geometry.type === 'Point')
      .filter((feature) => {
        if (!dateFrom && !dateTo) return true
        const dateStr = feature.properties.accidentDate
        if (!dateStr) return false
        const ts = new Date(dateStr).getTime()
        if (dateFrom && ts < dateFrom) return false
        if (dateTo && ts > dateTo) return false
        return true
      })
      .map((feature) => {
        const [longitude, latitude] = feature.geometry.coordinates
        const props = feature.properties
        const quantity = Number(props.quantity) || 1
        const ageYears = Math.max(0, new Date().getFullYear() - props.year)
        const recencyPts = Math.round(Math.max(0, 30 - Math.min(ageYears * 1.5, 30)))
        const quantityPts = Math.min(quantity * 6, 24)
        const speciesPts = props.species && props.species !== 'UNKNOWN' ? 10 : 4
        const relevance = clampScore(22 + recencyPts + quantityPts + speciesPts)
        return {
          id: `wars:${props.sourceFile}-${props.id}`,
          datasetId: 'wildlifeAccidents' as const,
          geometryType: 'point' as const,
          name: `${props.species || 'Wildlife'} (${props.year})`,
          subtitle: `${formatNullableText(props.nearestTown, 'Unknown town')} | ${quantity} animal(s)`,
          relevance,
          relevanceBreakdown: [
            { label: 'Base', points: 22 },
            { label: 'Recency', points: recencyPts },
            { label: 'Quantity', points: quantityPts },
            { label: 'Species known', points: speciesPts },
          ],
          summary: `${quantity} ${props.species || 'wildlife'} struck near ${formatNullableText(props.nearestTown, 'an unknown town')} on ${props.accidentDate}.`,
          bounds: createPointBounds(longitude, latitude),
          geometry: feature.geometry,
          details: [
            { label: 'Species', value: formatNullableText(props.species, 'Unknown') },
            { label: 'Year', value: String(props.year) },
            { label: 'Date', value: formatNullableText(props.accidentDate, 'Unknown') },
            { label: 'Town', value: formatNullableText(props.nearestTown, 'Unknown') },
            { label: 'Quantity', value: quantity.toLocaleString() },
            { label: 'Time', value: formatNullableText(props.timeOfKill, 'Unknown') },
          ],
          timestamp: props.accidentDate ? new Date(props.accidentDate).getTime() : undefined,
        }
      })
  }, [dateFrom, dateTo, wildlifeState.features])

  // BC Assessment parcels (polygon)
  const bcAssessmentRange = useMemo(() => {
    const values = bcParcels.map((p) => p.totalAssessed || 0).filter((v) => v > 0)
    return {
      min: values.length ? Math.min(...values) : 0,
      max: values.length ? Math.max(...values) : 1,
    }
  }, [bcParcels])

  const bcAssessmentItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    bcParcels.forEach((property) => {
      const bounds = geometryBounds(property.geometry)
      if (!bounds) return
      const valueNorm = normalize(property.totalAssessed, bcAssessmentRange.min, bcAssessmentRange.max)
      const valuePts = Math.round(valueNorm * 38)
      const categoryPts = PROPERTY_CATEGORY_WEIGHT[property.category] ?? 5
      const yearPts = property.yearBuilt ? Math.min(Math.max(property.yearBuilt - 1950, 0) / 2, 16) : 0
      const relevance = clampScore(20 + valuePts + categoryPts + Math.round(yearPts))
      items.push({
        id: `parcel:${property.id || property.roll}`,
        datasetId: 'bcAssessment',
        geometryType: 'polygon',
        name: property.address || property.roll || 'Parcel',
        subtitle: `${property.category} | $${(property.totalAssessed || 0).toLocaleString()}`,
        relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 20 },
          { label: 'Assessed value (norm)', points: valuePts },
          { label: `${property.category}`, points: categoryPts },
          { label: 'Year built', points: Math.round(yearPts) },
        ],
        summary: `${property.category} parcel assessed at $${(property.totalAssessed || 0).toLocaleString()}.`,
        bounds,
        geometry: property.geometry,
        details: [
          { label: 'Address', value: formatNullableText(property.address, 'Unknown') },
          { label: 'Category', value: property.category },
          { label: 'Total assessed', value: `$${(property.totalAssessed || 0).toLocaleString()}` },
          { label: 'Land', value: `$${(property.totalLand || 0).toLocaleString()}` },
          { label: 'Building', value: `$${(property.totalBuilding || 0).toLocaleString()}` },
          { label: 'Year built', value: property.yearBuilt ? String(property.yearBuilt) : 'Unknown' },
          { label: 'Roll', value: formatNullableText(property.roll, 'Unknown') },
        ],
      })
    })
    return items
  }, [bcParcels, bcAssessmentRange.max, bcAssessmentRange.min])

  const allItems = useMemo(() => {
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

  const datasetStats = useMemo<ExplorerDatasetStat[]>(() => {
    return EXPLORER_DATASETS.map((dataset) => {
      const datasetItems = allItems.filter((item) => item.datasetId === dataset.id)
      const count = datasetItems.length
      const relevanceValues = datasetItems.map((item) => item.relevance)
      const averageRelevance = relevanceValues.length
        ? relevanceValues.reduce((sum, value) => sum + value, 0) / relevanceValues.length
        : 0
      const maxRelevance = relevanceValues.length ? Math.max(...relevanceValues) : 0
      return { dataset, count, averageRelevance, maxRelevance }
    })
  }, [allItems])

  const geometrySet = useMemo(() => new Set(geometryFilters), [geometryFilters])
  const datasetSet = useMemo(() => new Set(activeDatasetIds), [activeDatasetIds])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = allItems.filter((item) => {
      if (!geometrySet.has(item.geometryType)) return false
      if (!datasetSet.has(item.datasetId)) return false
      // Spatial filter
      if (spatialFilter && !boundsIntersect(item.bounds, spatialFilter)) return false
      // Text search
      if (query && ![item.name, item.subtitle, item.summary].join(' ').toLowerCase().includes(query)) return false
      return true
    })
    filtered.sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name) || b.relevance - a.relevance
      return b.relevance - a.relevance || a.name.localeCompare(b.name)
    })
    return filtered
  }, [allItems, datasetSet, geometrySet, searchQuery, sortMode, spatialFilter])

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null
    return filteredItems.find((item) => item.id === selectedItemId) || null
  }, [filteredItems, selectedItemId])

  useEffect(() => {
    if (selectedItemId && !selectedItem) setSelectedItemId(null)
  }, [selectedItem, selectedItemId])

  const mapCollections = useMemo(() => {
    const pointCollections: ExplorerPointCollection[] = []
    const lineCollections: ExplorerLineCollection[] = []
    const polygonCollections: ExplorerPolygonCollection[] = []

    EXPLORER_DATASETS.forEach((dataset) => {
      const datasetItems = filteredItems.filter((item) => item.datasetId === dataset.id)
      if (dataset.geometryType === 'point') {
        pointCollections.push({
          datasetId: dataset.id,
          color: dataset.color,
          visible: datasetSet.has(dataset.id) && geometrySet.has('point') && datasetItems.length > 0,
          data: {
            type: 'FeatureCollection',
            features: datasetItems
              .filter((item) => item.geometry.type === 'Point')
              .map((item) => ({
                type: 'Feature',
                geometry: item.geometry as GeoJSON.Point,
                properties: {
                  itemId: item.id,
                  datasetId: item.datasetId,
                  name: item.name,
                  subtitle: item.subtitle,
                  relevance: item.relevance,
                },
              })),
          },
        })
      }
      if (dataset.geometryType === 'line') {
        lineCollections.push({
          datasetId: dataset.id,
          color: dataset.color,
          visible: datasetSet.has(dataset.id) && geometrySet.has('line') && datasetItems.length > 0,
          data: {
            type: 'FeatureCollection',
            features: datasetItems
              .filter((item) => item.geometry.type === 'LineString' || item.geometry.type === 'MultiLineString')
              .map((item) => ({
                type: 'Feature',
                geometry: item.geometry as GeoJSON.LineString | GeoJSON.MultiLineString,
                properties: {
                  itemId: item.id,
                  datasetId: item.datasetId,
                  name: item.name,
                  subtitle: item.subtitle,
                  relevance: item.relevance,
                },
              })),
          },
        })
      }
      if (dataset.geometryType === 'polygon') {
        polygonCollections.push({
          datasetId: dataset.id,
          color: dataset.color,
          visible: datasetSet.has(dataset.id) && geometrySet.has('polygon') && datasetItems.length > 0,
          data: {
            type: 'FeatureCollection',
            features: datasetItems
              .filter((item) => item.geometry.type === 'Polygon' || item.geometry.type === 'MultiPolygon')
              .map((item) => ({
                type: 'Feature',
                geometry: item.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
                properties: {
                  itemId: item.id,
                  datasetId: item.datasetId,
                  name: item.name,
                  subtitle: item.subtitle,
                  relevance: item.relevance,
                },
              })),
          },
        })
      }
    })
    return { pointCollections, lineCollections, polygonCollections }
  }, [datasetSet, filteredItems, geometrySet])

  const combinedErrors = useMemo(() => {
    const errors: string[] = []
    if (monitorsError) errors.push(`Air monitors: ${monitorsError}`)
    if (restaurantsError) errors.push(`Food inspections: ${restaurantsError}`)
    if (parksError) errors.push(`Parks data: ${parksError}`)
    if (censusError) errors.push(`Census data: ${censusError}`)
    if (crimeError) errors.push(`Property crime: ${crimeError}`)
    if (transitError) errors.push(`Transit stops: ${transitError}`)
    if (transitRoutesState.error) errors.push(`Transit routes: ${transitRoutesState.error}`)
    if (icbcCrashesState.error) errors.push(`ICBC crashes: ${icbcCrashesState.error}`)
    if (wildlifeState.error) errors.push(`Wildlife accidents: ${wildlifeState.error}`)
    if (bcAssessmentError) errors.push(`BC Assessment: ${bcAssessmentError}`)
    return errors
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

  const legendDatasets = useMemo(() => {
    return EXPLORER_DATASETS.filter(
      (dataset) =>
        datasetSet.has(dataset.id) &&
        geometrySet.has(dataset.geometryType) &&
        filteredItems.some((item) => item.datasetId === dataset.id),
    )
  }, [datasetSet, filteredItems, geometrySet])
  const showLegend = showHeatmap || (activeDatasetIds.length > 0 && geometryFilters.length > 0)

  const toggleGeometry = useCallback((geometryType: ExplorerGeometryType) => {
    setGeometryFilters((current) => {
      if (current.includes(geometryType)) return current.filter((entry) => entry !== geometryType)
      return [...current, geometryType]
    })
  }, [])

  const toggleDataset = useCallback((datasetId: ExplorerDatasetId) => {
    setActiveDatasetIds((current) => {
      if (current.includes(datasetId)) return current.filter((entry) => entry !== datasetId)
      return [...current, datasetId]
    })
  }, [])

  const selectAllDatasets = useCallback(() => {
    setActiveDatasetIds(ALL_DATASET_IDS)
  }, [])
  const clearDatasets = useCallback(() => {
    setActiveDatasetIds([])
  }, [])

  const heatmapDatasets = useMemo<HeatmapDataset[]>(() => {
    const datasets: HeatmapDataset[] = []
    if (datasetSet.has('airMonitors')) {
      datasets.push({
        id: 'air',
        label: 'Air Monitors',
        points: monitors
          .filter((m) => Number.isFinite(m.latitude) && Number.isFinite(m.longitude))
          .map((m) => ({ lng: m.longitude, lat: m.latitude })),
        color: ['#bae6fd', '#38bdf8', '#0284c7', '#075985'],
      })
    }
    if (datasetSet.has('restaurants')) {
      datasets.push({
        id: 'food',
        label: 'Restaurants',
        points: restaurants
          .filter((r) => r.latitude && r.longitude)
          .map((r) => ({ lng: r.longitude as number, lat: r.latitude as number })),
        color: ['#fed7aa', '#fb923c', '#ea580c', '#9a3412'],
      })
    }
    if (datasetSet.has('crime')) {
      datasets.push({
        id: 'crime',
        label: 'Property Crime',
        points: incidents
          .filter((incident) => Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude))
          .map((incident) => ({ lng: incident.longitude, lat: incident.latitude })),
        color: ['#fecaca', '#f87171', '#dc2626', '#7f1d1d'],
      })
    }
    if (datasetSet.has('parkAmenities')) {
      datasets.push({
        id: 'amenities',
        label: 'Amenities',
        points: amenities
          .filter((a) => Number.isFinite(a.latitude) && Number.isFinite(a.longitude))
          .map((a) => ({ lng: a.longitude, lat: a.latitude })),
        color: ['#bbf7d0', '#4ade80', '#16a34a', '#14532d'],
      })
    }
    if (datasetSet.has('transitStops')) {
      datasets.push({
        id: 'transit',
        label: 'Transit Stops',
        points: transitStops
          .filter((s) => Number.isFinite(s.latitude) && Number.isFinite(s.longitude))
          .map((s) => ({ lng: s.longitude, lat: s.latitude })),
        color: ['#bfdbfe', '#60a5fa', '#2563eb', '#1e3a8a'],
      })
    }
    if (datasetSet.has('icbcCrashes')) {
      datasets.push({
        id: 'icbc',
        label: 'ICBC Crashes',
        points: icbcCrashesState.features
          .filter((f) => f.geometry.type === 'Point')
          .map((f) => ({ lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] })),
        color: ['#fee2e2', '#fca5a5', '#dc2626', '#7f1d1d'],
      })
    }
    if (datasetSet.has('wildlifeAccidents')) {
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
    datasetSet,
    monitors,
    restaurants,
    incidents,
    amenities,
    transitStops,
    icbcCrashesState.features,
    wildlifeState.features,
  ])

  const handleExport = useCallback(
    (format: 'csv' | 'geojson') => {
      if (format === 'csv') {
        const header = ['Name', 'Dataset', 'Geometry', 'Relevance', 'Subtitle', 'Summary']
        const rows = filteredItems.map((item) => [
          item.name,
          item.datasetId,
          item.geometryType,
          Math.round(item.relevance),
          item.subtitle,
          item.summary,
        ])
        const csv = [
          header.join(','),
          ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')),
        ].join('\n')
        downloadBlob(csv, 'explorer-items.csv', 'text/csv')
      } else {
        const fc: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: filteredItems.map((item) => ({
            type: 'Feature',
            geometry: item.geometry,
            properties: {
              id: item.id,
              name: item.name,
              dataset: item.datasetId,
              relevance: item.relevance,
              subtitle: item.subtitle,
              summary: item.summary,
            },
          })),
        }
        downloadBlob(JSON.stringify(fc, null, 2), 'explorer-items.geojson', 'application/geo+json')
      }
    },
    [filteredItems],
  )

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={370}
      mobilePeek={
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            Explorer | {filteredItems.length.toLocaleString()} visible
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {activeDatasetIds.length === ALL_DATASET_IDS.length
              ? 'All datasets'
              : `${activeDatasetIds.length} datasets`}
            {selectedItem ? ` | ${selectedItem.name}` : searchQuery ? ` | "${searchQuery}"` : ''}
          </div>
        </div>
      }
      sidebar={
        <ExplorerSidebar
          className="h-full w-full border-0 shadow-none md:w-[370px] md:border-r md:shadow-xl"
          loading={loading}
          errors={combinedErrors}
          geometryFilters={geometryFilters}
          onToggleGeometry={toggleGeometry}
          datasetStats={datasetStats}
          activeDatasetIds={activeDatasetIds}
          onToggleDataset={toggleDataset}
          onSelectAllDatasets={selectAllDatasets}
          onClearDatasets={clearDatasets}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          items={filteredItems}
          selectedItem={selectedItem}
          onSelectItem={setSelectedItemId}
          onClearSelection={() => setSelectedItemId(null)}
          spatialFilter={spatialFilter}
          onClearSpatialFilter={() => setSpatialFilter(null)}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onExport={handleExport}
        />
      }
    >
      <div className="relative h-full">
        <ExplorerMap
          pointCollections={showHeatmap ? [] : mapCollections.pointCollections}
          lineCollections={mapCollections.lineCollections}
          polygonCollections={mapCollections.polygonCollections}
          selectedItem={selectedItem}
          onItemSelect={setSelectedItemId}
          spatialFilter={spatialFilter}
          onSpatialFilterChange={setSpatialFilter}
          onMapRightClick={(lng, lat) => setNeighborhoodPoint({ lat, lng })}
          heatmapLayer={showHeatmap ? <HeatmapMashupLayer datasets={heatmapDatasets} visible /> : null}
          loading={loading}
        />

        {neighborhoodPoint && (
          <NeighborhoodReport
            lat={neighborhoodPoint.lat}
            lng={neighborhoodPoint.lng}
            onClose={() => setNeighborhoodPoint(null)}
          />
        )}

        {showLegend && (
          <MapLegendPanel
            title="Active Layers"
            icon={<Layers className="h-3.5 w-3.5 shrink-0" />}
            collapsible
            contentClassName={cn('mt-2 space-y-1 md:mt-0 md:block', showMobileLegend ? 'block' : 'hidden')}
            actions={
              <div className="flex items-center gap-2">
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground md:hidden">
                  {legendDatasets.length}
                </span>
                <button
                  type="button"
                  onClick={() => setShowMobileLegend((current) => !current)}
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground md:hidden"
                  aria-label={showMobileLegend ? 'Hide active layer legend' : 'Show active layer legend'}
                  aria-expanded={showMobileLegend}
                >
                  {showMobileLegend ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
                </button>
                <button
                  onClick={() => setShowHeatmap((v) => !v)}
                  className={`hidden rounded border px-2 py-0.5 text-[10px] font-medium transition-colors md:inline-flex ${
                    showHeatmap
                      ? 'border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300'
                      : 'border-input text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {showHeatmap ? 'Heatmap ON' : 'Heatmap'}
                </button>
              </div>
            }
          >
            <MapLegendSection>
              <button
                onClick={() => setShowHeatmap((v) => !v)}
                className={`mb-1 inline-flex rounded border px-2 py-0.5 text-[10px] font-medium transition-colors md:hidden ${
                  showHeatmap
                    ? 'border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300'
                    : 'border-input text-muted-foreground hover:text-foreground'
                }`}
              >
                {showHeatmap ? 'Heatmap ON' : 'Heatmap'}
              </button>
              {legendDatasets.slice(0, 8).map((dataset) => {
                const stat = datasetStats.find((entry) => entry.dataset.id === dataset.id)
                return (
                  <LegendItem
                    key={dataset.id}
                    color={dataset.color}
                    label={dataset.label}
                    value={`${GEOMETRY_TYPE_LABEL[dataset.geometryType]} | ${stat?.count.toLocaleString() || 0}`}
                  />
                )
              })}
              {legendDatasets.length === 0 && (
                <div className="text-xs text-muted-foreground">No active layers in current filter.</div>
              )}
              {legendDatasets.length > 8 && (
                <div className="pt-1 text-xs text-muted-foreground">+{legendDatasets.length - 8} more layers</div>
              )}
            </MapLegendSection>
            {selectedItem && (
              <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
                Selected: <span className="font-medium text-foreground">{selectedItem.name}</span>
                <div>
                  {datasetById(selectedItem.datasetId).label} | relevance {Math.round(selectedItem.relevance)}
                </div>
              </div>
            )}
          </MapLegendPanel>
        )}

        {selectedItem && (
          <MobileExplorerFeatureCard
            item={selectedItem}
            onClose={() => setSelectedItemId(null)}
          />
        )}
      </div>
    </MapSectionLayout>
  )
}

function MobileExplorerFeatureCard({
  item,
  onClose,
}: {
  item: ExplorerItem
  onClose: () => void
}) {
  const dataset = datasetById(item.datasetId)

  return (
    <MobileFeatureCard
      title={item.name}
      subtitle={item.subtitle}
      onClose={onClose}
    >
      <div className="text-xs text-cyan-800 dark:text-cyan-200">
        Relevance {formatRelevance(item.relevance)} / 100
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {dataset.label} | {GEOMETRY_TYPE_LABEL[dataset.geometryType]}
      </div>

      <div className="mt-3 rounded-md border border-cyan-300/60 bg-cyan-50 p-3 text-xs text-cyan-900 dark:border-cyan-800/60 dark:bg-cyan-950/25 dark:text-cyan-100">
        {item.summary}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-cyan-800 dark:text-cyan-300">
        {item.details.slice(0, 8).map((detail) => (
          <div key={`${item.id}-${detail.label}`}>
            <span className="font-medium">{detail.label}:</span> {detail.value}
          </div>
        ))}
      </div>

      {item.relevanceBreakdown.length > 0 && (
        <div className="mt-3 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
          <div className="mb-1 font-semibold text-foreground">Score Breakdown</div>
          {item.relevanceBreakdown.map((entry) => (
            <div key={`${item.id}-${entry.label}`} className="flex items-center justify-between gap-3 py-0.5 text-muted-foreground">
              <span>{entry.label}</span>
              <span className="font-medium text-foreground">+{entry.points}</span>
            </div>
          ))}
        </div>
      )}
    </MobileFeatureCard>
  )
}
