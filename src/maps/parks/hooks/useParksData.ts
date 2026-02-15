import { useEffect, useState } from 'react'
import { ARCGIS_BASE, LAYER_IDS } from '../constants'
import type { Park, Trail, ParkAmenity, ParkClassification, TrailUserClass, TrailSurfaceClass } from '../types'

const QUERY_PARAMS = 'where=1=1&outFields=*&f=geojson&resultRecordCount=2000'

function queryUrl(layerId: number): string {
  return `${ARCGIS_BASE}/${layerId}/query?${QUERY_PARAMS}`
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
        const [parksGeo, trailsGeo, amenitiesGeo] = await Promise.all([
          fetchLayer(LAYER_IDS.parks),
          fetchLayer(LAYER_IDS.trails),
          fetchLayer(LAYER_IDS.amenities),
        ])

        setParks(parseParks(parksGeo))
        setTrails(parseTrails(trailsGeo))
        setAmenities(parseAmenities(amenitiesGeo))
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

  return { parks, trails, amenities, loading, error }
}
