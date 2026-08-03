import { useMemo } from 'react'
import { useFetchAll } from '@/hooks/useFetchData'

export interface HeatShadeTree {
  id: string
  longitude: number
  latitude: number
  commonName: string | null
  dbh: number | null
  treeAge: number | null
}

export interface HeatShadePolygon {
  id: string
  name: string
  areaSqKm: number
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

export interface HeatShadeFacility {
  id: string
  name: string
  longitude: number
  latitude: number
  status: string | null
  kind: 'communityFacility' | 'responseFacility'
}

const HEAT_SHADE_PATHS = {
  trees: '/data/heat-shade/citypg_trees.geojson',
  intactForest: '/data/heat-shade/citypg_intact_forest.geojson',
  communityForests: '/data/heat-shade/citypg_community_forests.geojson',
  communityFacilities: '/data/heat-shade/citypg_community_facility.geojson',
  responseFacilities: '/data/heat-shade/citypg_response_facilities.geojson',
}

function parseNumber(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function centroid(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number] | null {
  const coordinates = geometry.type === 'MultiPolygon' ? geometry.coordinates.flat(2) : geometry.coordinates.flat(1)
  if (!coordinates.length) return null
  const [sumLng, sumLat] = coordinates.reduce(
    ([lngTotal, latTotal], [lng, lat]) => [lngTotal + lng, latTotal + lat],
    [0, 0],
  )
  return [sumLng / coordinates.length, sumLat / coordinates.length]
}

function parseTrees(geojson: GeoJSON.FeatureCollection): HeatShadeTree[] {
  return geojson.features
    .map((feature): HeatShadeTree | null => {
      if (!feature.geometry || feature.geometry.type !== 'Point') return null
      const properties = feature.properties ?? {}
      const [longitude, latitude] = feature.geometry.coordinates
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
      return {
        id: String(properties.OBJECTID ?? properties.AssetID ?? feature.id ?? `${longitude},${latitude}`),
        longitude,
        latitude,
        commonName: properties.CommonName ? String(properties.CommonName) : null,
        dbh: parseNumber(properties.DBH),
        treeAge: parseNumber(properties.TreeAge),
      }
    })
    .filter((tree): tree is HeatShadeTree => tree !== null)
}

function parsePolygons(geojson: GeoJSON.FeatureCollection, fallbackName: string): HeatShadePolygon[] {
  return geojson.features
    .map((feature): HeatShadePolygon | null => {
      if (!feature.geometry || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) {
        return null
      }
      const properties = feature.properties ?? {}
      return {
        id: String(properties.OBJECTID ?? properties.GlobalID ?? feature.id ?? fallbackName),
        name: String(properties.FacilityDescription ?? properties.ParkName ?? properties.Name ?? fallbackName),
        areaSqKm: (parseNumber(properties.Shape__Area) ?? 0) / 1_000_000,
        geometry: feature.geometry,
      }
    })
    .filter((polygon): polygon is HeatShadePolygon => polygon !== null)
}

function parseCommunityFacilities(geojson: GeoJSON.FeatureCollection): HeatShadeFacility[] {
  return geojson.features
    .map((feature): HeatShadeFacility | null => {
      if (!feature.geometry || (feature.geometry.type !== 'Polygon' && feature.geometry.type !== 'MultiPolygon')) {
        return null
      }
      const center = centroid(feature.geometry)
      if (!center) return null
      const properties = feature.properties ?? {}
      return {
        id: String(properties.OBJECTID ?? properties.GlobalID ?? feature.id ?? `${center[0]},${center[1]}`),
        name: String(properties.FacilityDescription ?? 'Community facility'),
        longitude: center[0],
        latitude: center[1],
        status: null,
        kind: 'communityFacility',
      }
    })
    .filter((facility): facility is HeatShadeFacility => facility !== null)
}

function parseResponseFacilities(geojson: GeoJSON.FeatureCollection): HeatShadeFacility[] {
  return geojson.features
    .map((feature): HeatShadeFacility | null => {
      if (!feature.geometry || feature.geometry.type !== 'Point') return null
      const properties = feature.properties ?? {}
      const [longitude, latitude] = feature.geometry.coordinates
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return null
      return {
        id: String(properties.OBJECTID ?? properties.FacID ?? feature.id ?? `${longitude},${latitude}`),
        name: String(properties.FacName ?? 'Response facility'),
        longitude,
        latitude,
        status: properties.Status ? String(properties.Status) : null,
        kind: 'responseFacility',
      }
    })
    .filter((facility): facility is HeatShadeFacility => facility !== null)
}

const HEAT_SHADE_URLS = [
  HEAT_SHADE_PATHS.trees,
  HEAT_SHADE_PATHS.intactForest,
  HEAT_SHADE_PATHS.communityForests,
  HEAT_SHADE_PATHS.communityFacilities,
  HEAT_SHADE_PATHS.responseFacilities,
] as const

export function useHeatShadeData(enabled = true) {
  const { data, loading, error } = useFetchAll<GeoJSON.FeatureCollection>(HEAT_SHADE_URLS as unknown as string[], {
    enabled,
  })

  const parsed = useMemo(() => {
    if (!data) return { trees: [], forests: [], facilities: [] }
    const [treesGeo, intactForestGeo, communityForestsGeo, communityFacilitiesGeo, responseFacilitiesGeo] = data
    return {
      trees: treesGeo ? parseTrees(treesGeo) : [],
      forests: [
        ...(intactForestGeo ? parsePolygons(intactForestGeo, 'Intact forest') : []),
        ...(communityForestsGeo ? parsePolygons(communityForestsGeo, 'Community forest') : []),
      ],
      facilities: [
        ...(communityFacilitiesGeo ? parseCommunityFacilities(communityFacilitiesGeo) : []),
        ...(responseFacilitiesGeo ? parseResponseFacilities(responseFacilitiesGeo) : []),
      ],
    }
  }, [data])

  return { ...parsed, loading, error: error ?? null }
}
