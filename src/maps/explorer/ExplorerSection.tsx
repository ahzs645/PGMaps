import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { HeatmapMashupLayer, type HeatmapDataset } from '@/components/HeatmapMashupLayer'
import { NeighborhoodReport } from '@/components/NeighborhoodReport'
import { useAirQualityData } from '@/maps/airquality'
import { useCensusData } from '@/maps/census/hooks/useCensusData'
import { useRestaurantData } from '@/maps/foodmap/hooks/useRestaurantData'
import type { HazardRating, Inspection } from '@/maps/foodmap/types'
import { useParksData } from '@/maps/parks/hooks/useParksData'
import type { ParkClassification, TrailUserClass } from '@/maps/parks/types'
import {
  datasetById,
  EXPLORER_DATASETS,
  GEOMETRY_TYPE_LABEL,
  LOW_COST_NETWORKS
} from './constants'
import { ExplorerMap } from './components/ExplorerMap'
import { ExplorerSidebar } from './components/ExplorerSidebar'
import type {
  ExplorerDatasetId,
  ExplorerDatasetStat,
  ExplorerGeometryType,
  ExplorerItem,
  ExplorerLineCollection,
  ExplorerPointCollection,
  ExplorerPolygonCollection,
  GeometryBounds,
  SpatialFilter
} from './types'

const ALL_GEOMETRY_TYPES: ExplorerGeometryType[] = ['point', 'line', 'polygon']
const ALL_DATASET_IDS: ExplorerDatasetId[] = EXPLORER_DATASETS.map((dataset) => dataset.id)

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
  const scanRing = (ring: number[][]) => { ring.forEach(([lng, lat]) => expandBounds(bounds, lng, lat)) }
  if (geometry.type === 'LineString') geometry.coordinates.forEach(([lng, lat]) => expandBounds(bounds, lng, lat))
  else if (geometry.type === 'MultiLineString') geometry.coordinates.forEach((line) => line.forEach(([lng, lat]) => expandBounds(bounds, lng, lat)))
  else if (geometry.type === 'Polygon') geometry.coordinates.forEach((ring) => scanRing(ring))
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((polygon) => polygon.forEach((ring) => scanRing(ring)))
  else return null
  if (!Number.isFinite(bounds.minLng) || !Number.isFinite(bounds.minLat)) return null
  if (bounds.minLng === bounds.maxLng && bounds.minLat === bounds.maxLat) return createPointBounds(bounds.minLng, bounds.minLat)
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
    case 'Major': return 14
    case 'Community': return 12
    case 'Athletic': return 11
    case 'Nature': case 'Green Space': return 10
    case 'Special Purpose': return 9
    default: return 7
  }
}

function trailClassWeight(userClass: TrailUserClass | null): number {
  switch (userClass) {
    case 'Multiuse': return 12
    case 'Walking': return 9
    case 'Equine': return 8
    default: return 6
  }
}

function hazardWeight(rating: HazardRating): number {
  switch (rating) {
    case 'Moderate': return 22
    case 'Low': return 12
    case 'Unknown': default: return 6
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
  const [showSidebar, setShowSidebar] = useState(true)
  const [geometryFilters, setGeometryFilters] = useState<ExplorerGeometryType[]>(ALL_GEOMETRY_TYPES)
  const [activeDatasetIds, setActiveDatasetIds] = useState<ExplorerDatasetId[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('relevance')
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [spatialFilter, setSpatialFilter] = useState<SpatialFilter | null>(null)
  const [dateRange, setDateRange] = useState<{ from: string; to: string }>({ from: '', to: '' })
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [neighborhoodPoint, setNeighborhoodPoint] = useState<{ lat: number; lng: number } | null>(null)

  const { monitors, loading: loadingMonitors, error: monitorsError } = useAirQualityData()
  const { restaurants, loading: loadingRestaurants, error: restaurantsError } = useRestaurantData()
  const { parks, trails, amenities, loading: loadingParks, error: parksError } = useParksData()
  const { unitsByLevel, loading: loadingCensus, error: censusError } = useCensusData()

  // Date range parsing
  const dateFrom = useMemo(() => dateRange.from ? new Date(dateRange.from).getTime() : null, [dateRange.from])
  const dateTo = useMemo(() => dateRange.to ? new Date(dateRange.to).getTime() : null, [dateRange.to])

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
            { label: LOW_COST_NETWORKS.has(monitor.network) ? 'Low-cost network' : 'Reference network', points: networkBoost },
            { label: `${parameterCount} param(s)`, points: richnessBoost }
          ],
          summary: `Active state ${formatNullableText(monitor.status, 'unknown')} with ${parameterCount} tracked parameter(s).`,
          bounds: createPointBounds(monitor.longitude, monitor.latitude),
          geometry,
          details: [
            { label: 'Network', value: monitor.network },
            { label: 'Status', value: formatNullableText(monitor.status, 'Unknown') },
            { label: 'City', value: formatNullableText(monitor.city, 'Unknown') },
            { label: 'Province', value: formatNullableText(monitor.province, 'Unknown') },
            { label: 'Parameters', value: monitor.parameters.join(', ') || 'N/A' }
          ]
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
            { label: `${inspectionCount} inspection(s)`, points: Math.round(inspPts) }
          ],
          summary: `${violationCount} violation(s) across ${inspectionCount} inspection(s).`,
          bounds: createPointBounds(longitude, latitude),
          geometry,
          details: [
            { label: 'Hazard', value: rating },
            { label: 'Facility', value: formatNullableText(restaurant.facility_type, 'Unknown') },
            { label: 'Address', value: formatNullableText(restaurant.address, 'Unknown') },
            { label: 'Inspections', value: inspectionCount.toLocaleString() },
            { label: 'Violations', value: violationCount.toLocaleString() }
          ],
          timestamp: latestDate
        }
      })
  }, [restaurants, dateFrom, dateTo])

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
            { label: amenity.type ? 'Has type' : 'No type', points: typePts }
          ],
          summary: 'Park infrastructure and public-space amenity location.',
          bounds: createPointBounds(amenity.longitude, amenity.latitude),
          geometry,
          details: [
            { label: 'Amenity Type', value: formatNullableText(amenity.type, 'Unknown') },
            { label: 'Park', value: formatNullableText(amenity.parkName, 'Unknown') },
            { label: 'Location', value: formatNullableText(amenity.location, 'Unknown') }
          ]
        }
      })
  }, [amenities])

  const trailLengthRange = useMemo(() => {
    const lengths = trails.map((trail) => trail.length || 0).filter((length) => Number.isFinite(length))
    return { min: lengths.length ? Math.min(...lengths) : 0, max: lengths.length ? Math.max(...lengths) : 1 }
  }, [trails])

  const trailItems = useMemo<ExplorerItem[]>(() => {
    const items: ExplorerItem[] = []
    trails.filter((trail) => trail.coordinates.length >= 2).forEach((trail) => {
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
          { label: `${trail.userClass || 'Unknown'} class`, points: classPts }
        ],
        summary: `${trail.winterMaintenance ? 'Maintained' : 'Not maintained'} in winter with length ${length.toLocaleString(undefined, { maximumFractionDigits: 0 })} m.`,
        bounds, geometry,
        details: [
          { label: 'User Class', value: formatNullableText(trail.userClass, 'Unknown') },
          { label: 'Surface', value: formatNullableText(trail.surfaceMaterial, 'Unknown') },
          { label: 'Winter', value: trail.winterMaintenance ? 'Maintained' : 'Not maintained' },
          { label: 'Length (m)', value: length.toLocaleString(undefined, { maximumFractionDigits: 0 }) }
        ]
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
          { label: `${park.classification || 'Unknown'} class`, points: classPts }
        ],
        summary: `${park.developed ? 'Developed' : 'Natural/open'} park with area ${areaKm2.toLocaleString(undefined, { maximumFractionDigits: 2 })} km².`,
        bounds, geometry: park.geometry,
        details: [
          { label: 'Classification', value: formatNullableText(park.classification, 'Unknown') },
          { label: 'Subtype', value: formatNullableText(park.subType, 'Unknown') },
          { label: 'Developed', value: park.developed ? 'Yes' : 'No' },
          { label: 'Area (km²)', value: areaKm2.toLocaleString(undefined, { maximumFractionDigits: 2 }) }
        ]
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
      densityMax: densities.length ? Math.max(...densities) : 1
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
        id: `census-da:${unit.id}`, datasetId: 'censusDa', geometryType: 'polygon',
        name: unit.name, subtitle: `DA ${unit.id}`, relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 22 },
          { label: 'Pop. density (norm)', points: densityPts },
          { label: 'Population (norm)', points: popPts }
        ],
        summary: `Population ${population.toLocaleString()} with density ${density.toLocaleString(undefined, { maximumFractionDigits: 1 })} /km².`,
        bounds, geometry: unit.geometry,
        details: [
          { label: 'Population', value: population.toLocaleString() },
          { label: 'Density', value: density.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
          { label: 'Households', value: (unit.households || 0).toLocaleString() },
          { label: 'Dwellings', value: (unit.dwellings || 0).toLocaleString() },
          { label: 'Area (km²)', value: (unit.areaSqKm || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) }
        ]
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
      densityMax: densities.length ? Math.max(...densities) : 1
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
        id: `census-ct:${unit.id}`, datasetId: 'censusCt', geometryType: 'polygon',
        name: unit.name, subtitle: `CT ${unit.id}`, relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 22 },
          { label: 'Pop. density (norm)', points: densityPts },
          { label: 'Population (norm)', points: popPts }
        ],
        summary: `Population ${population.toLocaleString()} with density ${density.toLocaleString(undefined, { maximumFractionDigits: 1 })} /km².`,
        bounds, geometry: unit.geometry,
        details: [
          { label: 'Population', value: population.toLocaleString() },
          { label: 'Density', value: density.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
          { label: 'Households', value: (unit.households || 0).toLocaleString() },
          { label: 'Dwellings', value: (unit.dwellings || 0).toLocaleString() },
          { label: 'Area (km²)', value: (unit.areaSqKm || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) }
        ]
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
      densityMax: densities.length ? Math.max(...densities) : 1
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
        id: `census-csd:${unit.id}`, datasetId: 'censusCsd', geometryType: 'polygon',
        name: unit.name, subtitle: `CSD ${unit.id}`, relevance,
        relevanceBreakdown: [
          { label: 'Base', points: 22 },
          { label: 'Pop. density (norm)', points: densityPts },
          { label: 'Population (norm)', points: popPts }
        ],
        summary: `Population ${population.toLocaleString()} with density ${density.toLocaleString(undefined, { maximumFractionDigits: 1 })} /km².`,
        bounds, geometry: unit.geometry,
        details: [
          { label: 'Population', value: population.toLocaleString() },
          { label: 'Density', value: density.toLocaleString(undefined, { maximumFractionDigits: 1 }) },
          { label: 'Households', value: (unit.households || 0).toLocaleString() },
          { label: 'Dwellings', value: (unit.dwellings || 0).toLocaleString() },
          { label: 'Area (km²)', value: (unit.areaSqKm || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }) }
        ]
      })
    })
    return items
  }, [censusCsdRange, unitsByLevel.csd])

  const allItems = useMemo(() => {
    return [
      ...monitorItems, ...restaurantItems, ...amenityItems,
      ...trailItems, ...parkItems,
      ...censusDaItems, ...censusCtItems, ...censusCsdItems
    ]
  }, [amenityItems, censusDaItems, censusCtItems, censusCsdItems, monitorItems, parkItems, restaurantItems, trailItems])

  const datasetStats = useMemo<ExplorerDatasetStat[]>(() => {
    return EXPLORER_DATASETS.map((dataset) => {
      const datasetItems = allItems.filter((item) => item.datasetId === dataset.id)
      const count = datasetItems.length
      const relevanceValues = datasetItems.map((item) => item.relevance)
      const averageRelevance = relevanceValues.length
        ? relevanceValues.reduce((sum, value) => sum + value, 0) / relevanceValues.length : 0
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
          datasetId: dataset.id, color: dataset.color,
          visible: datasetSet.has(dataset.id) && geometrySet.has('point') && datasetItems.length > 0,
          data: {
            type: 'FeatureCollection',
            features: datasetItems.filter((item) => item.geometry.type === 'Point').map((item) => ({
              type: 'Feature',
              geometry: item.geometry as GeoJSON.Point,
              properties: { itemId: item.id, datasetId: item.datasetId, name: item.name, subtitle: item.subtitle, relevance: item.relevance }
            }))
          }
        })
      }
      if (dataset.geometryType === 'line') {
        lineCollections.push({
          datasetId: dataset.id, color: dataset.color,
          visible: datasetSet.has(dataset.id) && geometrySet.has('line') && datasetItems.length > 0,
          data: {
            type: 'FeatureCollection',
            features: datasetItems
              .filter((item) => item.geometry.type === 'LineString' || item.geometry.type === 'MultiLineString')
              .map((item) => ({
                type: 'Feature',
                geometry: item.geometry as GeoJSON.LineString | GeoJSON.MultiLineString,
                properties: { itemId: item.id, datasetId: item.datasetId, name: item.name, subtitle: item.subtitle, relevance: item.relevance }
              }))
          }
        })
      }
      if (dataset.geometryType === 'polygon') {
        polygonCollections.push({
          datasetId: dataset.id, color: dataset.color,
          visible: datasetSet.has(dataset.id) && geometrySet.has('polygon') && datasetItems.length > 0,
          data: {
            type: 'FeatureCollection',
            features: datasetItems
              .filter((item) => item.geometry.type === 'Polygon' || item.geometry.type === 'MultiPolygon')
              .map((item) => ({
                type: 'Feature',
                geometry: item.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon,
                properties: { itemId: item.id, datasetId: item.datasetId, name: item.name, subtitle: item.subtitle, relevance: item.relevance }
              }))
          }
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
    return errors
  }, [censusError, monitorsError, parksError, restaurantsError])

  const loading = loadingMonitors || loadingRestaurants || loadingParks || loadingCensus

  const legendDatasets = useMemo(() => {
    return EXPLORER_DATASETS.filter((dataset) => (
      datasetSet.has(dataset.id) && geometrySet.has(dataset.geometryType) && filteredItems.some((item) => item.datasetId === dataset.id)
    ))
  }, [datasetSet, filteredItems, geometrySet])

  const toggleGeometry = useCallback((geometryType: ExplorerGeometryType) => {
    setGeometryFilters((current) => {
      if (current.includes(geometryType)) {
        const next = current.filter((entry) => entry !== geometryType)
        return next.length > 0 ? next : current
      }
      return [...current, geometryType]
    })
  }, [])

  const toggleDataset = useCallback((datasetId: ExplorerDatasetId) => {
    setActiveDatasetIds((current) => {
      if (current.includes(datasetId)) return current.filter((entry) => entry !== datasetId)
      return [...current, datasetId]
    })
  }, [])

  const selectAllDatasets = useCallback(() => { setActiveDatasetIds(ALL_DATASET_IDS) }, [])
  const clearDatasets = useCallback(() => { setActiveDatasetIds([]) }, [])

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
    return datasets
  }, [datasetSet, monitors, restaurants, amenities])

  const handleExport = useCallback((format: 'csv' | 'geojson') => {
    if (format === 'csv') {
      const header = ['Name', 'Dataset', 'Geometry', 'Relevance', 'Subtitle', 'Summary']
      const rows = filteredItems.map((item) => [
        item.name, item.datasetId, item.geometryType,
        Math.round(item.relevance), item.subtitle, item.summary
      ])
      const csv = [header.join(','), ...rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n')
      downloadBlob(csv, 'explorer-items.csv', 'text/csv')
    } else {
      const fc: GeoJSON.FeatureCollection = {
        type: 'FeatureCollection',
        features: filteredItems.map((item) => ({
          type: 'Feature', geometry: item.geometry,
          properties: {
            id: item.id, name: item.name, dataset: item.datasetId,
            relevance: item.relevance, subtitle: item.subtitle, summary: item.summary
          }
        }))
      }
      downloadBlob(JSON.stringify(fc, null, 2), 'explorer-items.geojson', 'application/geo+json')
    }
  }, [filteredItems])

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      desktopSidebarWidth={370}
      sidebar={(
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
      )}
    >
      <div className="relative h-full">
        <ExplorerMap
          pointCollections={mapCollections.pointCollections}
          lineCollections={mapCollections.lineCollections}
          polygonCollections={mapCollections.polygonCollections}
          selectedItem={selectedItem}
          onItemSelect={setSelectedItemId}
          spatialFilter={spatialFilter}
          onSpatialFilterChange={setSpatialFilter}
          onMapRightClick={(lng, lat) => setNeighborhoodPoint({ lat, lng })}
          heatmapLayer={showHeatmap ? <HeatmapMashupLayer datasets={heatmapDatasets} visible /> : null}
        />

        {neighborhoodPoint && (
          <NeighborhoodReport
            lat={neighborhoodPoint.lat}
            lng={neighborhoodPoint.lng}
            onClose={() => setNeighborhoodPoint(null)}
          />
        )}

        <div className="absolute bottom-24 right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h4 className="text-xs font-semibold text-foreground">Active Layers</h4>
            <button
              onClick={() => setShowHeatmap((v) => !v)}
              className={`rounded border px-2 py-0.5 text-[10px] font-medium transition-colors ${
                showHeatmap
                  ? 'border-orange-400 bg-orange-50 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300'
                  : 'border-input text-muted-foreground hover:text-foreground'
              }`}
            >
              {showHeatmap ? 'Heatmap ON' : 'Heatmap'}
            </button>
          </div>
          <div className="space-y-1">
            {legendDatasets.slice(0, 8).map((dataset) => {
              const stat = datasetStats.find((entry) => entry.dataset.id === dataset.id)
              return (
                <div key={dataset.id} className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: dataset.color }} />
                    <span className="text-foreground">{dataset.label}</span>
                  </div>
                  <span className="text-muted-foreground">{GEOMETRY_TYPE_LABEL[dataset.geometryType]} | {stat?.count.toLocaleString() || 0}</span>
                </div>
              )
            })}
            {legendDatasets.length === 0 && (
              <div className="text-xs text-muted-foreground">No active layers in current filter.</div>
            )}
            {legendDatasets.length > 8 && (
              <div className="pt-1 text-xs text-muted-foreground">+{legendDatasets.length - 8} more layers</div>
            )}
          </div>
          {selectedItem && (
            <div className="mt-2 border-t border-border pt-2 text-[11px] text-muted-foreground">
              Selected: <span className="font-medium text-foreground">{selectedItem.name}</span>
              <div>{datasetById(selectedItem.datasetId).label} | relevance {Math.round(selectedItem.relevance)}</div>
            </div>
          )}
        </div>
      </div>
    </MapSectionLayout>
  )
}
