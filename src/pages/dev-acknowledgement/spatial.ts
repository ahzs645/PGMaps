import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'

import {
  COMMUNITIES_DATA,
  LOCAL_COMMUNITY_MAX_KM,
  NATIVE_LAND_DATA_BASE,
  NATIVE_LAND_LAYERS,
  RELATIONSHIP_GRAPH_DATA,
  RESERVES_DATA,
  TREATY_AREAS_DATA,
  TREATY_LANDS_DATA,
} from './data'
import { normalizeMatchText, uniqueMatches } from './names'
import { nationName, referenceAreaLabel, sourceTitle } from './wording'
import type {
  GeocodeResult,
  MatchedRelationshipPlace,
  MatchType,
  PlaceRecord,
  PlaceRelationshipRecord,
  ReferenceAreaRecord,
  RelationshipGraph,
  SourceKey,
  SourceMatch,
} from './types'

type FeatureProperties = Record<string, unknown>

const geojsonCache = new Map<string, Promise<GeoJSON.FeatureCollection>>()
const relationshipGraphCache = new Map<string, Promise<RelationshipGraph>>()

async function loadGeoJsonLayer(url: string): Promise<GeoJSON.FeatureCollection> {
  const cached = geojsonCache.get(url)
  if (cached) return cached
  const request = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load ${url.split('/').pop()} (${response.status})`)
      return response.json() as Promise<GeoJSON.FeatureCollection>
    })
    .catch((error: unknown) => {
      // Drop the failed promise so a later lookup can retry the fetch.
      geojsonCache.delete(url)
      throw error instanceof Error ? error : new Error('Failed to load layer data')
    })
  geojsonCache.set(url, request)
  return request
}

export async function loadRelationshipGraph(url = RELATIONSHIP_GRAPH_DATA): Promise<RelationshipGraph> {
  const cached = relationshipGraphCache.get(url)
  if (cached) return cached
  const request = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error(`Could not load relationship graph (${response.status})`)
      return response.json() as Promise<RelationshipGraph>
    })
    .catch((error: unknown) => {
      relationshipGraphCache.delete(url)
      throw error instanceof Error ? error : new Error('Failed to load relationship graph')
    })
  relationshipGraphCache.set(url, request)
  return request
}

function relationshipPlaceScore(place: PlaceRecord, result: GeocodeResult, addressInput: string) {
  const haystack = normalizeMatchText(`${result.fullAddress} ${addressInput}`)
  const addressScore = (place.addressAliases ?? []).reduce((score, alias) => {
    const normalizedAlias = normalizeMatchText(alias)
    if (!normalizedAlias) return score
    return haystack.includes(normalizedAlias) ? Math.max(score, normalizedAlias.length + (place.type === 'municipality' ? 0 : 1000)) : score
  }, 0)

  if (addressScore > 0) return addressScore

  return [place.name, ...(place.locationNames ?? [])].reduce((score, alias) => {
    const normalizedAlias = normalizeMatchText(alias)
    if (!normalizedAlias) return score
    return haystack.includes(normalizedAlias) ? Math.max(score, normalizedAlias.length) : score
  }, 0)
}

function placeMatchType(place: PlaceRecord): MatchType {
  return place.type === 'municipality' ? 'municipality' : 'place'
}

export function matchRelationshipPlace(
  graph: RelationshipGraph,
  result: GeocodeResult,
  addressInput: string,
  enabledMatchTypes: Record<MatchType, boolean>,
): MatchedRelationshipPlace | null {
  const ranked = graph.places
    .filter((place) => enabledMatchTypes[placeMatchType(place)])
    .map((place) => ({ place, score: relationshipPlaceScore(place, result, addressInput) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score)

  const place = ranked[0]?.place
  if (!place) return null

  const relationships = graph.placeRelationships.filter((relationship) => relationship.placeId === place.id)
  return relationships.length > 0 ? { place, relationships } : null
}

function geometrySourceUrl(source: ReferenceAreaRecord['geometrySource']) {
  if (!source) return null
  if (source.dataset === 'native-land') return `${NATIVE_LAND_DATA_BASE}${source.category}.geojson`
  if (source.category === 'first_nations_treaty_areas') return TREATY_AREAS_DATA
  if (source.category === 'first_nations_treaty_lands') return TREATY_LANDS_DATA
  return null
}

async function relationshipReferencesPoint(
  graph: RelationshipGraph,
  relationship: PlaceRelationshipRecord,
  lat: number,
  lng: number,
) {
  const pt = point([lng, lat])
  const referenceAreas = relationship.referenceAreaIds
    ?.map((areaId) => graph.referenceAreas?.find((area) => area.id === areaId))
    .filter((area): area is ReferenceAreaRecord => Boolean(area?.geometrySource)) ?? []

  for (const area of referenceAreas) {
    const source = area.geometrySource
    if (!source) continue
    const url = geometrySourceUrl(source)
    if (!url) continue
    const collection = await loadGeoJsonLayer(url)
    for (const feature of collection.features) {
      const properties = (feature.properties ?? {}) as FeatureProperties
      if (String(properties[source.property] ?? '') !== source.value) continue
      const geometry = feature.geometry
      if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue
      if (booleanPointInPolygon(pt, geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon)) return true
    }
  }

  return false
}

export async function matchBoundaryRelationshipPlace(graph: RelationshipGraph, result: GeocodeResult): Promise<MatchedRelationshipPlace | null> {
  for (const relationship of graph.placeRelationships) {
    if (!relationship.referenceAreaIds?.length) continue
    if (!(await relationshipReferencesPoint(graph, relationship, result.latitude, result.longitude))) continue
    const place = graph.places.find((place) => place.id === relationship.placeId)
    if (place) return { place, relationships: [relationship] }
  }
  return null
}

export function relationshipMatches(graph: RelationshipGraph, match: MatchedRelationshipPlace): SourceMatch[] {
  return uniqueMatches(match.relationships.flatMap((relationship) => (
    relationship.nationIds.map((nationId) => ({
      source: 'verified' as SourceKey,
      name: nationName(graph, nationId),
      label: `${match.place.name}: ${relationship.relationshipType.replace(/_/g, ' ')}`,
      detail: [
        ...relationship.sourceRefs.map((sourceRef) => sourceTitle(graph, sourceRef)),
        ...(relationship.referenceAreaIds ?? []).map((areaId) => referenceAreaLabel(graph, areaId)),
      ].join(' / '),
    }))
  )))
}

function joinDetail(parts: unknown[]) {
  const detail = parts
    .map((part) => (part == null ? '' : String(part).trim()))
    .filter((part) => part && part.toLowerCase() !== 'blank')
    .join(' / ')
  return detail || undefined
}

async function queryPolygonLayer(
  url: string,
  lat: number,
  lng: number,
  toMatch: (properties: FeatureProperties) => SourceMatch | null,
): Promise<SourceMatch[]> {
  const collection = await loadGeoJsonLayer(url)
  const pt = point([lng, lat])
  const matches: SourceMatch[] = []
  for (const feature of collection.features) {
    const geometry = feature.geometry
    if (!geometry || (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')) continue
    if (!booleanPointInPolygon(pt, geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon)) continue
    const match = toMatch((feature.properties ?? {}) as FeatureProperties)
    if (match) matches.push(match)
  }
  return uniqueMatches(matches)
}

export async function queryTreatySources(lat: number, lng: number) {
  const [lands, areas] = await Promise.all([
    queryPolygonLayer(TREATY_LANDS_DATA, lat, lng, (properties) => {
      const name = String(properties.FIRST_NATION_NAME ?? properties.TREATY ?? '').trim()
      if (!name) return null
      return {
        source: 'treaty',
        name,
        label: 'Treaty land intersection',
        detail: joinDetail([properties.TREATY, properties.LAND_TYPE]),
      }
    }),
    queryPolygonLayer(TREATY_AREAS_DATA, lat, lng, (properties) => {
      const name = String(properties.FIRST_NATION_NAME ?? properties.TREATY ?? '').trim()
      if (!name) return null
      return {
        source: 'treaty',
        name,
        label: 'Treaty area intersection',
        detail: joinDetail([properties.TREATY, properties.AREA_TYPE, properties.GEOGRAPHIC_LOCATION]),
      }
    }),
  ])
  return uniqueMatches([...lands, ...areas])
}

export async function queryReserveSource(lat: number, lng: number) {
  return queryPolygonLayer(RESERVES_DATA, lat, lng, (properties) => {
    const name = String(properties.BAND_NAME ?? properties.ENGLISH_NAME ?? '').trim()
    if (!name) return null
    return {
      source: 'reserve',
      name,
      label: 'Reserve boundary intersection',
      detail: joinDetail([properties.ENGLISH_NAME, properties.BAND_NUMBER ? `Band ${properties.BAND_NUMBER}` : null]),
    }
  })
}

export async function queryNativeLandSource(lat: number, lng: number, signal?: AbortSignal) {
  const results = await Promise.all(
    NATIVE_LAND_LAYERS.map((layer) =>
      queryPolygonLayer(layer.url, lat, lng, (properties) => {
        if (signal?.aborted) return null
        const name = String(properties.Name ?? '').trim()
        if (!name) return null
        return {
          source: 'nativeLand',
          name,
          label: layer.label,
          detail: joinDetail([properties.Slug, properties.description]),
        }
      }),
    ),
  )
  return uniqueMatches(results.flat())
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(a)))
}

export async function localVerifiedMatches(result: GeocodeResult): Promise<SourceMatch[]> {
  const collection = await loadGeoJsonLayer(COMMUNITIES_DATA)
  let nearest: { name: string; distanceKm: number; office: string } | null = null
  for (const feature of collection.features) {
    const coordinates = feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null
    if (!coordinates || coordinates.length < 2) continue
    const properties = (feature.properties ?? {}) as FeatureProperties
    const name = String(properties.FIRST_NATION_BC_NAME ?? properties.FIRST_NATION_FEDERAL_NAME ?? '').trim()
    if (!name) continue
    const distanceKm = haversineKm(result.latitude, result.longitude, coordinates[1], coordinates[0])
    if (!nearest || distanceKm < nearest.distanceKm) {
      nearest = { name, distanceKm, office: String(properties.BC_REGIONAL_OFFICE ?? '').trim() }
    }
  }

  if (!nearest || nearest.distanceKm > LOCAL_COMMUNITY_MAX_KM) return []

  return [{
    source: 'local',
    name: nearest.name,
    label: 'Nearest First Nation community',
    detail: `~${Math.round(nearest.distanceKm)} km away${nearest.office ? ` · ${nearest.office} office` : ''}`,
  }]
}
