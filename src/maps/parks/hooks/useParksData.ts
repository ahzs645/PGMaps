import { useEffect, useState } from 'react'
import { ARCGIS_BASE, LAYER_IDS } from '../constants'
import type {
  CityPgOverlayData,
  CityPgOverlaySummary,
  Park,
  Trail,
  ParkAmenity,
  ParkClassification,
  TrailUserClass,
  TrailSurfaceClass,
} from '../types'

const QUERY_PARAMS = 'where=1=1&outFields=*&f=geojson&resultRecordCount=2000'
const EMPTY_FEATURE_COLLECTION = { type: 'FeatureCollection', features: [] } as const

const CITYPG_OVERLAY_GROUPS = {
  parkAssets: [
    { path: '/data/citypg/parks_trees.geojson', label: 'Trees', color: '#16a34a' },
    { path: '/data/citypg/parks_sport_structures.geojson', label: 'Sport structure', color: '#2563eb' },
    { path: '/data/citypg/parks_site_amenities.geojson', label: 'Site amenity', color: '#f59e0b' },
    { path: '/data/citypg/parks_public_art.geojson', label: 'Public art', color: '#a855f7' },
    { path: '/data/citypg/parks_playground_equipment.geojson', label: 'Playground', color: '#ec4899' },
    { path: '/data/citypg/outdoor_ice_rinks.geojson', label: 'Outdoor rink', color: '#06b6d4' },
  ],
  parkLines: [
    { path: '/data/citypg/parks_pedestrian_structures.geojson', label: 'Pedestrian structure', color: '#7c3aed' },
    { path: '/data/citypg/parks_boardwalks.geojson', label: 'Boardwalk', color: '#92400e' },
  ],
  parkAreas: [
    { path: '/data/citypg/parks_facilities.geojson', label: 'Park facility', color: '#0ea5e9' },
    { path: '/data/citypg/parks_playing_areas.geojson', label: 'Playing area', color: '#22c55e' },
  ],
  mobilityLines: [
    { path: '/data/citypg/active_transportation_cycle_network.geojson', label: 'Cycle network', color: '#0891b2' },
    { path: '/data/citypg/active_transportation_connectors.geojson', label: 'Connector', color: '#0f766e' },
    { path: '/data/citypg/sidewalks.geojson', label: 'Sidewalk', color: '#64748b' },
    { path: '/data/citypg/walkways.geojson', label: 'Walkway', color: '#84cc16' },
    { path: '/data/citypg/ocp_2025_cycle_pedestrian_network.geojson', label: 'OCP proposed active route', color: '#f97316' },
  ],
  mobilityPoints: [
    { path: '/data/citypg/traffic_counts.geojson', label: 'Traffic count', color: '#ef4444' },
  ],
  ecologyAreas: [
    { path: '/data/citypg/ecology_sensitivity.geojson', label: 'Ecology sensitivity', color: '#16a34a' },
    { path: '/data/citypg/ecology_high_conservation_value.geojson', label: 'High conservation', color: '#15803d' },
    { path: '/data/citypg/ecology_riparian_areas.geojson', label: 'Riparian area', color: '#0ea5e9' },
    { path: '/data/citypg/ocp_2025_flood_hazard.geojson', label: 'OCP flood hazard', color: '#0284c7' },
    { path: '/data/citypg/ocp_2025_wildfire_development.geojson', label: 'OCP wildfire area', color: '#dc2626' },
  ],
  communityAreas: [
    { path: '/data/citypg/community_boundaries.geojson', label: 'Community boundary', color: '#6366f1' },
    { path: '/data/citypg/subdivision_boundaries.geojson', label: 'Subdivision', color: '#8b5cf6' },
  ],
  civicAreas: [
    { path: '/data/citypg/civic_facility_buildings.geojson', label: 'Civic facility', color: '#0ea5e9' },
  ],
  serviceLines: [
    { path: '/data/citypg/snow_removal.geojson', label: 'Snow removal', color: '#38bdf8' },
  ],
  serviceAreas: [
    { path: '/data/citypg/garbage_collection_zones.geojson', label: 'Garbage zone', color: '#65a30d' },
    { path: '/data/citypg/evacuation_zones.geojson', label: 'Evacuation zone', color: '#f97316' },
  ],
  planningLines: [],
  planningPoints: [
    { path: '/data/citypg/ocp_2025_proposed_park_improvements.geojson', label: 'OCP park improvement', color: '#f59e0b' },
    { path: '/data/citypg/ocp_2025_community_facilities.geojson', label: 'OCP community facility', color: '#06b6d4' },
  ],
  planningAreas: [],
} as const

function queryUrl(layerId: number): string {
  return `${ARCGIS_BASE}/${layerId}/query?${QUERY_PARAMS}`
}

function withBase(path: string): string {
  const base = import.meta.env.BASE_URL || '/'
  return `${base.replace(/\/$/, '')}${path}`
}

function emptyCollection<T extends GeoJSON.Geometry>(): GeoJSON.FeatureCollection<T> {
  return { type: 'FeatureCollection', features: [] }
}

function featureId(feature: GeoJSON.Feature, fallback: number): string | number {
  const props = feature.properties ?? {}
  return props.OBJECTID ?? props.objectid ?? props.ObjectID ?? feature.id ?? fallback
}

function annotateFeatures<T extends GeoJSON.Geometry>(
  geojson: GeoJSON.FeatureCollection,
  source: { label: string; color: string },
): GeoJSON.Feature<T>[] {
  return geojson.features
    .filter((feature): feature is GeoJSON.Feature<T> => Boolean(feature.geometry))
    .map((feature, index) => ({
      ...feature,
      id: featureId(feature, index),
      properties: {
        ...(feature.properties ?? {}),
        id: featureId(feature, index),
        sourceLabel: source.label,
        color: source.color,
      },
    }))
}

async function fetchLocalGeojson(path: string, signal: AbortSignal): Promise<GeoJSON.FeatureCollection> {
  const response = await fetch(withBase(path), { signal })
  if (response.status === 404) return { type: 'FeatureCollection', features: [] }
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
  const geojson = await response.json()
  if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new Error(`${path} did not return a GeoJSON FeatureCollection`)
  }
  return geojson
}

async function loadOverlayCollection<T extends GeoJSON.Geometry>(
  sources: readonly { path: string; label: string; color: string }[],
  signal: AbortSignal,
): Promise<GeoJSON.FeatureCollection<T>> {
  const collections = await Promise.all(
    sources.map(async (source) => annotateFeatures<T>(await fetchLocalGeojson(source.path, signal), source))
  )
  return { type: 'FeatureCollection', features: collections.flat() }
}

function overlaySummary(overlays: CityPgOverlayData): CityPgOverlaySummary {
  return {
    parkAssets: overlays.parkAssets.features.length,
    parkLines: overlays.parkLines.features.length,
    parkAreas: overlays.parkAreas.features.length,
    mobility: overlays.mobilityLines.features.length + overlays.mobilityPoints.features.length,
    ecology: overlays.ecologyAreas.features.length,
    community: overlays.communityAreas.features.length + overlays.civicAreas.features.length,
    services: overlays.serviceLines.features.length + overlays.serviceAreas.features.length,
    planning: overlays.planningLines.features.length + overlays.planningPoints.features.length + overlays.planningAreas.features.length,
  }
}

function centroid(geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon): [number, number] {
  const coords =
    geometry.type === 'MultiPolygon'
      ? geometry.coordinates.flat(2)
      : geometry.coordinates.flat(1)

  let sumLng = 0
  let sumLat = 0
  for (const [lng, lat] of coords) {
    sumLng += lng
    sumLat += lat
  }
  return [sumLng / coords.length, sumLat / coords.length]
}

function normalizeClassification(value: string | null | undefined): ParkClassification | null {
  if (!value) return null
  const valid: ParkClassification[] = [
    'Athletic', 'Community', 'Downtown', 'Green Space',
    'Major', 'Nature', 'Neighbourhood', 'Public', 'Special Purpose',
  ]
  return valid.find((v) => v === value) ?? null
}

function normalizeTrailUserClass(value: string | null | undefined): TrailUserClass | null {
  if (!value) return null
  const valid: TrailUserClass[] = ['Walking', 'Multiuse', 'Equine']
  return valid.find((v) => v === value) ?? null
}

function normalizeTrailSurfaceClass(value: string | null | undefined): TrailSurfaceClass | null {
  if (!value) return null
  const valid: TrailSurfaceClass[] = ['Hard Surface', 'Soft Surface', 'Granular']
  return valid.find((v) => v === value) ?? null
}

function parseParks(geojson: GeoJSON.FeatureCollection): Park[] {
  return geojson.features
    .filter((f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'))
    .map((f) => {
      const props = f.properties ?? {}
      const geometry = f.geometry as GeoJSON.MultiPolygon | GeoJSON.Polygon
      const [longitude, latitude] = centroid(geometry)

      return {
        id: props.OBJECTID ?? f.id ?? 0,
        name: props.ParkName || props.Location || 'Unnamed Park',
        classification: normalizeClassification(props.ParkClassification),
        subType: props.SubType_TEXT === 'Open Space' ? 'Open Space' as const : props.SubType_TEXT === 'Park' ? 'Park' as const : null,
        developed: props.Developed === 1,
        area: props.Shape__Area ?? null,
        longitude,
        latitude,
        geometry,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function parseTrails(geojson: GeoJSON.FeatureCollection): Trail[] {
  return geojson.features
    .filter((f) => f.geometry && f.geometry.type === 'LineString')
    .map((f) => {
      const props = f.properties ?? {}
      return {
        id: props.OBJECTID ?? f.id ?? 0,
        name: props.TrailName || props.Location || 'Unnamed Trail',
        parkName: props.ParkName || null,
        userClass: normalizeTrailUserClass(props.TrailUserClass),
        surfaceClass: normalizeTrailSurfaceClass(props.TrailSurfaceClass),
        surfaceMaterial: props.SurfaceMaterial || null,
        winterMaintenance: props.WinterMaintenance === 'Yes' || props.WinterMaintenance === 1,
        length: props.Shape__Length ?? null,
        coordinates: (f.geometry as GeoJSON.LineString).coordinates as [number, number][],
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

function parseAmenities(geojson: GeoJSON.FeatureCollection): ParkAmenity[] {
  return geojson.features
    .filter((f) => f.geometry && f.geometry.type === 'Point')
    .map((f) => {
      const props = f.properties ?? {}
      const [longitude, latitude] = (f.geometry as GeoJSON.Point).coordinates
      return {
        id: props.OBJECTID ?? f.id ?? 0,
        type: props.SubType_TEXT || null,
        location: props.Location || null,
        parkName: props.ParkName || props.TrailName || null,
        longitude,
        latitude,
      }
    })
}

export function useParksData() {
  const [parks, setParks] = useState<Park[]>([])
  const [trails, setTrails] = useState<Trail[]>([])
  const [amenities, setAmenities] = useState<ParkAmenity[]>([])
  const [cityOverlays, setCityOverlays] = useState<CityPgOverlayData>({
    parkAssets: emptyCollection(),
    parkLines: emptyCollection(),
    parkAreas: emptyCollection(),
    mobilityLines: emptyCollection(),
    mobilityPoints: emptyCollection(),
    ecologyAreas: emptyCollection(),
    communityAreas: emptyCollection(),
    civicAreas: emptyCollection(),
    serviceLines: emptyCollection(),
    serviceAreas: emptyCollection(),
    planningLines: emptyCollection(),
    planningPoints: emptyCollection(),
    planningAreas: emptyCollection(),
  })
  const [overlaySummaryState, setOverlaySummaryState] = useState<CityPgOverlaySummary>({
    parkAssets: 0,
    parkLines: 0,
    parkAreas: 0,
    mobility: 0,
    ecology: 0,
    community: 0,
    services: 0,
    planning: 0,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function fetchLayer(layerId: number): Promise<GeoJSON.FeatureCollection> {
      const response = await fetch(queryUrl(layerId), { signal: controller.signal })
      if (!response.ok) throw new Error(`Failed to fetch layer ${layerId}: ${response.status}`)
      return response.json()
    }

    async function loadAll() {
      setLoading(true)
      setError(null)
      try {
        const [
          parksGeo,
          trailsGeo,
          amenitiesGeo,
          parkAssets,
          parkLines,
          parkAreas,
          mobilityLines,
          mobilityPoints,
          ecologyAreas,
          communityAreas,
          civicAreas,
          serviceLines,
          serviceAreas,
          planningLines,
          planningPoints,
          planningAreas,
        ] = await Promise.all([
          fetchLayer(LAYER_IDS.parks),
          fetchLayer(LAYER_IDS.trails),
          fetchLayer(LAYER_IDS.amenities),
          loadOverlayCollection<GeoJSON.Point>(CITYPG_OVERLAY_GROUPS.parkAssets, controller.signal),
          loadOverlayCollection<GeoJSON.LineString | GeoJSON.MultiLineString>(CITYPG_OVERLAY_GROUPS.parkLines, controller.signal),
          loadOverlayCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>(CITYPG_OVERLAY_GROUPS.parkAreas, controller.signal),
          loadOverlayCollection<GeoJSON.LineString | GeoJSON.MultiLineString>(CITYPG_OVERLAY_GROUPS.mobilityLines, controller.signal),
          loadOverlayCollection<GeoJSON.Point>(CITYPG_OVERLAY_GROUPS.mobilityPoints, controller.signal),
          loadOverlayCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>(CITYPG_OVERLAY_GROUPS.ecologyAreas, controller.signal),
          loadOverlayCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>(CITYPG_OVERLAY_GROUPS.communityAreas, controller.signal),
          loadOverlayCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>(CITYPG_OVERLAY_GROUPS.civicAreas, controller.signal),
          loadOverlayCollection<GeoJSON.LineString | GeoJSON.MultiLineString>(CITYPG_OVERLAY_GROUPS.serviceLines, controller.signal),
          loadOverlayCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>(CITYPG_OVERLAY_GROUPS.serviceAreas, controller.signal),
          loadOverlayCollection<GeoJSON.LineString | GeoJSON.MultiLineString>(CITYPG_OVERLAY_GROUPS.planningLines, controller.signal),
          loadOverlayCollection<GeoJSON.Point>(CITYPG_OVERLAY_GROUPS.planningPoints, controller.signal),
          loadOverlayCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>(CITYPG_OVERLAY_GROUPS.planningAreas, controller.signal),
        ])

        setParks(parseParks(parksGeo))
        setTrails(parseTrails(trailsGeo))
        setAmenities(parseAmenities(amenitiesGeo))
        const overlays = {
          parkAssets,
          parkLines,
          parkAreas,
          mobilityLines,
          mobilityPoints,
          ecologyAreas,
          communityAreas,
          civicAreas,
          serviceLines,
          serviceAreas,
          planningLines,
          planningPoints,
          planningAreas,
        }
        setCityOverlays(overlays)
        setOverlaySummaryState(overlaySummary(overlays))
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load park data')
      } finally {
        setLoading(false)
      }
    }

    loadAll()
    return () => controller.abort()
  }, [])

  return { parks, trails, amenities, cityOverlays, overlaySummary: overlaySummaryState, loading, error }
}
