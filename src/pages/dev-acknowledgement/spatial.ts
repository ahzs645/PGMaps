import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'

import {
  buildNationAliasIndex,
  matchBoundaryRelationshipPlace as engineMatchBoundaryRelationshipPlace,
  matchRelationshipPlace,
  nationName,
  relationshipMatches,
  resolveNationId,
  uniqueMatches,
} from '@/lib/acknowledgement/engine'
import type { GeocodeLike, ReferenceAreaRecord, RelationshipGraph } from '@/lib/acknowledgement/engine'
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
import type { GeocodeResult, SourceMatch } from './types'

// Re-export the engine's pure matching so the app has a single import surface.
export { matchRelationshipPlace, relationshipMatches }

type FeatureProperties = Record<string, unknown>

const geojsonCache = new Map<string, Promise<GeoJSON.FeatureCollection>>()
const relationshipGraphCache = new Map<string, Promise<RelationshipGraph>>()

export async function loadGeoJsonLayer(url: string): Promise<GeoJSON.FeatureCollection> {
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

/** Concrete resolver mapping a reference area's geometrySource to a bundled GeoJSON URL. */
function geometrySourceUrl(source: ReferenceAreaRecord['geometrySource']) {
  if (!source) return null
  if (source.dataset === 'native-land') return `${NATIVE_LAND_DATA_BASE}${source.category}.geojson`
  if (source.category === 'first_nations_treaty_areas') return TREATY_AREAS_DATA
  if (source.category === 'first_nations_treaty_lands') return TREATY_LANDS_DATA
  return null
}

/** Boundary match wired to the bundled-GeoJSON loader + URL resolver. */
export function matchBoundaryRelationshipPlace(graph: RelationshipGraph, result: GeocodeLike) {
  return engineMatchBoundaryRelationshipPlace(graph, result, geometrySourceUrl, loadGeoJsonLayer)
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

/**
 * Resolve the Nation name(s) whose Native Land territory covers a point, mapped
 * to canonical names via the relationship graph's alias index. Used by the
 * multi-point composer to turn dropped dots into a Nation set.
 */
export async function resolveNationsAtPoint(
  lat: number,
  lng: number,
  graph: RelationshipGraph | null,
  signal?: AbortSignal,
): Promise<string[]> {
  const matches = await queryNativeLandSource(lat, lng, signal)
  const territoryNames = matches.filter((match) => match.label === 'Native Land territory overlap').map((match) => match.name)
  const names = territoryNames.length > 0 ? territoryNames : matches.map((match) => match.name)

  const aliasIndex = graph ? buildNationAliasIndex(graph) : null
  const seen = new Set<string>()
  const resolved: string[] = []
  for (const name of names) {
    const id = aliasIndex ? resolveNationId(name, aliasIndex) : undefined
    const display = id && graph ? nationName(graph, id) : name
    if (display && !seen.has(display)) {
      seen.add(display)
      resolved.push(display)
    }
  }
  return resolved
}
