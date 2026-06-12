import type { AirMonitor } from '@/maps/airquality/types'
import type { Property, PropertyCategory } from '@/maps/bcassessment/types'
import type { CensusUnit } from '@/maps/census/types'
import type { HazardRating, Inspection, Restaurant } from '@/maps/foodmap/types'
import type { Park, ParkAmenity, ParkClassification, Trail, TrailUserClass } from '@/maps/parks/types'
import { getCrimeCategory } from '@/maps/pgdata/constants'
import type { CrimeIncident } from '@/maps/pgdata/types'
import type { TransitStop } from '@/maps/scorebuilder/hooks/useTransitData'
import { LOW_COST_NETWORKS } from './constants'
import type { ExplorerDatasetId, ExplorerItem } from './types'
import { clampScore, createPointBounds, formatNullableText, geometryBounds, normalize } from './utils'

const EXPLORER_SESSION_NOW = Date.now()

export interface TransitRouteProperties {
  routeId: string
  routeShortName: string
  routeLongName: string
  routeColor: string
  shapeId: string
  headsigns?: string[]
  directions?: string[]
  pointCount?: number
}

export interface IcbcCrashProperties {
  dataset: string
  datasetTitle: string
  location: string
  municipality: string
  crashCount: number
  sourceLocationName: string
  geocodeMatchType: string
}

export interface WildlifeAccidentProperties {
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

export function buildMonitorItems(monitors: AirMonitor[]): ExplorerItem[] {
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
}

export function buildRestaurantItems(
  restaurants: Restaurant[],
  dateFrom: number | null,
  dateTo: number | null,
): ExplorerItem[] {
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
}

export function buildCrimeItems(
  incidents: CrimeIncident[],
  dateFrom: number | null,
  dateTo: number | null,
): ExplorerItem[] {
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
}

export function buildAmenityItems(amenities: ParkAmenity[]): ExplorerItem[] {
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
}

export function buildTrailItems(trails: Trail[]): ExplorerItem[] {
  const lengths = trails.map((trail) => trail.length || 0).filter((length) => Number.isFinite(length))
  const lengthRange = {
    min: lengths.length ? Math.min(...lengths) : 0,
    max: lengths.length ? Math.max(...lengths) : 1,
  }
  const items: ExplorerItem[] = []
  trails
    .filter((trail) => trail.coordinates.length >= 2)
    .forEach((trail) => {
      const length = trail.length || 0
      const normalizedLength = normalize(length, lengthRange.min, lengthRange.max)
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
}

export function buildParkItems(parks: Park[]): ExplorerItem[] {
  const areas = parks.map((park) => park.area || 0).filter((area) => Number.isFinite(area))
  const areaRange = {
    min: areas.length ? Math.min(...areas) : 0,
    max: areas.length ? Math.max(...areas) : 1,
  }
  const items: ExplorerItem[] = []
  parks.forEach((park) => {
    const areaSqm = park.area || 0
    const areaKm2 = areaSqm > 0 ? areaSqm / 1_000_000 : 0
    const normalizedArea = normalize(areaSqm, areaRange.min, areaRange.max)
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
}

export type CensusAreaLevel = 'da' | 'ct' | 'csd' | 'cd'

const CENSUS_AREA_LEVEL_INFO: Record<
  CensusAreaLevel,
  { datasetId: ExplorerDatasetId; idPrefix: string; label: string }
> = {
  da: { datasetId: 'censusDa', idPrefix: 'census-da', label: 'DA' },
  ct: { datasetId: 'censusCt', idPrefix: 'census-ct', label: 'CT' },
  csd: { datasetId: 'censusCsd', idPrefix: 'census-csd', label: 'CSD' },
  cd: { datasetId: 'censusCd', idPrefix: 'census-cd', label: 'CD' },
}

export function buildCensusAreaItems(units: CensusUnit[], level: CensusAreaLevel): ExplorerItem[] {
  const { datasetId, idPrefix, label } = CENSUS_AREA_LEVEL_INFO[level]
  const populations = units.map((unit) => unit.population || 0).filter((value) => Number.isFinite(value))
  const densities = units.map((unit) => unit.populationDensity || 0).filter((value) => Number.isFinite(value))
  const range = {
    populationMin: populations.length ? Math.min(...populations) : 0,
    populationMax: populations.length ? Math.max(...populations) : 1,
    densityMin: densities.length ? Math.min(...densities) : 0,
    densityMax: densities.length ? Math.max(...densities) : 1,
  }
  const items: ExplorerItem[] = []
  units.forEach((unit) => {
    const population = unit.population || 0
    const density = unit.populationDensity || 0
    const popNorm = normalize(population, range.populationMin, range.populationMax)
    const densityNorm = normalize(density, range.densityMin, range.densityMax)
    const densityPts = Math.round(densityNorm * 44)
    const popPts = Math.round(popNorm * 32)
    const relevance = clampScore(22 + densityPts + popPts)
    const bounds = geometryBounds(unit.geometry)
    if (!bounds) return
    items.push({
      id: `${idPrefix}:${unit.id}`,
      datasetId,
      geometryType: 'polygon',
      name: unit.name,
      subtitle: `${label} ${unit.id}`,
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
}

export function buildCensusBlockItems(units: CensusUnit[]): ExplorerItem[] {
  const populations = units.map((u) => u.population || 0).filter(Number.isFinite)
  const range = {
    populationMin: populations.length ? Math.min(...populations) : 0,
    populationMax: populations.length ? Math.max(...populations) : 1,
  }
  const items: ExplorerItem[] = []
  units.forEach((unit) => {
    const population = unit.population || 0
    const popNorm = normalize(population, range.populationMin, range.populationMax)
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
}

export function buildTransitStopItems(transitStops: TransitStop[]): ExplorerItem[] {
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
}

export function buildTransitRouteItems(
  features: GeoJSON.Feature<GeoJSON.LineString, TransitRouteProperties>[],
): ExplorerItem[] {
  const items: ExplorerItem[] = []
  features.forEach((feature) => {
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
}

export function buildIcbcItems(features: GeoJSON.Feature<GeoJSON.Point, IcbcCrashProperties>[]): ExplorerItem[] {
  const maxCount = features.reduce((max, feature) => Math.max(max, Number(feature.properties.crashCount) || 0), 0)
  return features
    .filter((feature) => feature.geometry.type === 'Point')
    .map((feature, index) => {
      const [longitude, latitude] = feature.geometry.coordinates
      const props = feature.properties
      const crashCount = Number(props.crashCount) || 0
      const countNorm = maxCount > 0 ? crashCount / maxCount : 0
      const countPts = Math.round(countNorm * 60)
      const matchPts = props.geocodeMatchType?.includes('intersection') ? 10 : 5
      const relevance = clampScore(20 + countPts + matchPts)
      return {
        // Location strings repeat across crash sites, so the id needs the
        // feature index to stay unique (it doubles as the React list key).
        id: `icbc:${props.dataset}-${props.location}-${index}`,
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
}

export function buildWildlifeItems(
  features: GeoJSON.Feature<GeoJSON.Point, WildlifeAccidentProperties>[],
  dateFrom: number | null,
  dateTo: number | null,
): ExplorerItem[] {
  return features
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
}

export function buildBcAssessmentItems(properties: Property[]): ExplorerItem[] {
  const values = properties.map((p) => p.totalAssessed || 0).filter((v) => v > 0)
  const valueRange = {
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 1,
  }
  const items: ExplorerItem[] = []
  properties.forEach((property) => {
    const bounds = geometryBounds(property.geometry)
    if (!bounds) return
    const valueNorm = normalize(property.totalAssessed, valueRange.min, valueRange.max)
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
}
