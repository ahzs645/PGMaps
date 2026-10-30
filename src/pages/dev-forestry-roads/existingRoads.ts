/** Live, per-place DataBC query. No catalogue status is treated as proof of a built, usable road. */
import { importContextGeoJson } from './project'
import { unreviewedRoadEvidence } from './existingRoadEvidence'
import type { ContextFeature, Coordinate, ExistingRoadEvidence } from './types'

export type RoadQueryBounds = [number, number, number, number]
export const BC_ROADS_SERVICE = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/196'
export const BC_ROADS_CATALOGUE = 'https://catalogue.data.gov.bc.ca/dataset/243c94a1-f275-41dc-bc37-91d8a2b26e10'
export const MAX_EXISTING_ROADS = 500
export const MAX_ROAD_QUERY_SPAN = 0.3
export const MAX_ROAD_RESPONSE_BYTES = 10 * 1024 * 1024
export const MAX_FSR_QUERY_SPAN = 0.5
export const FSR_FILE_TYPE_CODE = 'B40'
export type BcRoadQueryOptions = { fsrOnly?: boolean; activeOnly?: boolean }

export function existingRoadQueryBounds(coordinates: Coordinate[]): RoadQueryBounds {
  if (!coordinates.length) throw Error('Place a road or select a map extent before loading existing roads.')
  const latitude = coordinates.reduce((sum, c) => sum + c[1], 0) / coordinates.length
  const longitudePadding = 0.009 / Math.max(0.2, Math.cos((latitude * Math.PI) / 180))
  return [
    Math.min(...coordinates.map((c) => c[0])) - longitudePadding,
    Math.min(...coordinates.map((c) => c[1])) - 0.009,
    Math.max(...coordinates.map((c) => c[0])) + longitudePadding,
    Math.max(...coordinates.map((c) => c[1])) + 0.009,
  ]
}

export function buildBcRoadsQuery(bounds: RoadQueryBounds, options: BcRoadQueryOptions = {}): string {
  const [west, south, east, north] = bounds
  if (
    !bounds.every(Number.isFinite) ||
    west >= east ||
    south >= north ||
    west < -180 ||
    east > 180 ||
    south <= -85 ||
    north >= 85
  )
    throw Error('Choose a valid geographic extent for the road query.')
  const maxSpan = options.fsrOnly ? MAX_FSR_QUERY_SPAN : MAX_ROAD_QUERY_SPAN
  if (east - west > maxSpan || north - south > maxSpan)
    throw Error(`Zoom in before loading roads: query at most ${maxSpan}° in either direction.`)
  const params = new URLSearchParams({
    f: 'geojson',
    where: [
      options.fsrOnly ? "FILE_TYPE_CODE='B40'" : '1=1',
      ...(options.activeOnly ? ["LIFE_CYCLE_STATUS_CODE='ACTIVE'"] : []),
    ].join(' AND '),
    geometry: bounds.join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true',
    resultRecordCount: String(MAX_EXISTING_ROADS + 1),
    orderByFields: 'OBJECTID',
    outFields:
      'OBJECTID,ROAD_SECTION_NAME,ROAD_SECTION_ID,FOREST_FILE_ID,FILE_TYPE_CODE,FILE_TYPE_DESCRIPTION,FILE_STATUS_CODE,LIFE_CYCLE_STATUS_CODE,AWARD_DATE,RETIREMENT_DATE',
  })
  return `${BC_ROADS_SERVICE}/query?${params}`
}

function recordDate(value: unknown): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  const date = new Date(typeof value === 'number' ? value : String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined
}
const recordText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined

export function parseBcExistingRoads(raw: unknown, retrievedAt = new Date().toISOString()): ContextFeature[] {
  if (!raw || typeof raw !== 'object') throw Error('The BC roads service returned an invalid response.')
  const response = raw as {
    features?: unknown[]
    exceededTransferLimit?: boolean
    properties?: { exceededTransferLimit?: boolean }
    error?: { message?: string }
  }
  if (response.error) throw Error(response.error.message || 'The BC roads service could not complete the query.')
  if (!Array.isArray(response.features)) throw Error('The BC roads service did not return a feature collection.')
  if (
    response.exceededTransferLimit ||
    response.properties?.exceededTransferLimit ||
    response.features.length > MAX_EXISTING_ROADS
  )
    throw Error('Too many existing roads in this extent. Zoom in; no partial road network was loaded.')
  if (!response.features.length) return []
  const features = response.features.map((value, i) => {
    const f = value as GeoJSON.Feature
    const p = f?.properties ?? {}
    const evidence: ExistingRoadEvidence = {
      ...unreviewedRoadEvidence('bc-ften'),
      ...(p.FILE_TYPE_CODE === FSR_FILE_TYPE_CODE
        ? { roadClass: 'fsr' as const }
        : p.FILE_TYPE_CODE === 'B01'
          ? { roadClass: 'permit' as const }
          : {}),
      ...(recordText(p.FILE_TYPE_CODE) ? { fileTypeCode: recordText(p.FILE_TYPE_CODE) } : {}),
      ...(recordText(p.LIFE_CYCLE_STATUS_CODE) ? { lifecycleStatus: recordText(p.LIFE_CYCLE_STATUS_CODE) } : {}),
      sourceId: String(p.OBJECTID ?? f.id ?? i),
      sourceUrl: BC_ROADS_CATALOGUE,
      retrievedAt,
      ...(recordText(p.LIFE_CYCLE_STATUS_CODE) || recordText(p.FILE_STATUS_CODE)
        ? { status: [recordText(p.LIFE_CYCLE_STATUS_CODE), recordText(p.FILE_STATUS_CODE)].filter(Boolean).join(' / ') }
        : {}),
      ...(recordDate(p.AWARD_DATE) ? { awardDate: recordDate(p.AWARD_DATE) } : {}),
      ...(recordDate(p.RETIREMENT_DATE) ? { retirementDate: recordDate(p.RETIREMENT_DATE) } : {}),
    }
    const name = [recordText(p.FOREST_FILE_ID), recordText(p.ROAD_SECTION_NAME) ?? recordText(p.ROAD_SECTION_ID)]
      .filter(Boolean)
      .join(' · ')
    return {
      ...f,
      properties: {
        name: name.slice(0, 200) || `BC tenure road ${evidence.sourceId}`,
        kind: 'existing-road',
        roadEvidence: evidence,
      },
    }
  })
  const parsed = importContextGeoJson({ type: 'FeatureCollection', features })
  if (parsed.some((f) => f.geometry.type !== 'LineString')) throw Error('BC roads must contain line geometry.')
  const parts = new Map<string, number>()
  return parsed.map((f) => {
    const sourceId = f.roadEvidence!.sourceId!
    const part = parts.get(sourceId) ?? 0
    parts.set(sourceId, part + 1)
    return { ...f, id: `bc-ften-${sourceId}-${part}` }
  })
}

export async function loadBcExistingRoads(
  bounds: RoadQueryBounds,
  signal?: AbortSignal,
  options: BcRoadQueryOptions = {},
): Promise<ContextFeature[]> {
  return loadRoadQuery(buildBcRoadsQuery(bounds, options), signal)
}

/** ArcGIS distance query covers a circle; full section geometries are returned for exact projection. */
export function buildBcFsrRadiusQuery(origin: Coordinate, radiusM: number): string {
  if (
    origin.length !== 2 ||
    !origin.every(Number.isFinite) ||
    Math.abs(origin[0]) > 180 ||
    Math.abs(origin[1]) >= 85 ||
    !Number.isFinite(radiusM) ||
    radiusM < 100 ||
    radiusM > 10000
  )
    throw Error('Use a valid location and a nearest-FSR search radius of 100–10,000 m.')
  const query = new URL(
    buildBcRoadsQuery([origin[0] - 0.001, origin[1] - 0.001, origin[0] + 0.001, origin[1] + 0.001], {
      fsrOnly: true,
      activeOnly: true,
    }),
  )
  query.searchParams.set('geometry', origin.join(','))
  query.searchParams.set('geometryType', 'esriGeometryPoint')
  query.searchParams.set('distance', String(radiusM))
  query.searchParams.set('units', 'esriSRUnit_Meter')
  return query.toString()
}

export async function loadBcFsrsNear(
  origin: Coordinate,
  radiusM: number,
  signal?: AbortSignal,
): Promise<ContextFeature[]> {
  return loadRoadQuery(buildBcFsrRadiusQuery(origin, radiusM), signal)
}

async function loadRoadQuery(url: string, signal?: AbortSignal): Promise<ContextFeature[]> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw Error(`BC roads query failed (${response.status}). Try again or import your road linework.`)
  if (Number(response.headers.get('content-length')) > MAX_ROAD_RESPONSE_BYTES)
    throw Error('BC roads response is too large. Zoom in.')
  const reader = response.body?.getReader()
  if (!reader) throw Error('The BC roads service returned an empty response.')
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_ROAD_RESPONSE_BYTES) {
        await reader.cancel()
        throw Error('BC roads response is too large. Zoom in.')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  return parseBcExistingRoads(JSON.parse(text))
}

/** Force line imports to road context without losing previously exported review evidence. */
export function importExistingRoads(raw: unknown): ContextFeature[] {
  const collection = raw as GeoJSON.FeatureCollection | GeoJSON.Feature
  const input =
    collection?.type === 'FeatureCollection'
      ? collection.features
      : collection?.type === 'Feature'
        ? [collection]
        : null
  if (!input) throw Error('Import a GeoJSON FeatureCollection or Feature containing road lines.')
  const features = input.map((f, index) => {
    if (!f || !f.geometry || !['LineString', 'MultiLineString'].includes(f.geometry.type))
      throw Error('Existing-road imports require LineString or MultiLineString geometry.')
    return {
      ...f,
      properties: {
        ...f.properties,
        name: typeof f.properties?.name === 'string' ? f.properties.name : `Imported road ${index + 1}`,
        kind: 'existing-road',
        roadEvidence: f.properties?.roadEvidence ?? {
          ...unreviewedRoadEvidence(),
          roadClass:
            f.properties?.FILE_TYPE_CODE === FSR_FILE_TYPE_CODE
              ? 'fsr'
              : f.properties?.FILE_TYPE_CODE === 'B01'
                ? 'permit'
                : 'user',
          ...(recordText(f.properties?.FILE_TYPE_CODE)
            ? { fileTypeCode: recordText(f.properties?.FILE_TYPE_CODE) }
            : {}),
          ...(recordText(f.properties?.LIFE_CYCLE_STATUS_CODE)
            ? { lifecycleStatus: recordText(f.properties?.LIFE_CYCLE_STATUS_CODE) }
            : {}),
        },
      },
    }
  })
  return importContextGeoJson({ type: 'FeatureCollection', features })
}
