import type { ContextFeature, Coordinate } from './types'

export type StreamQueryBounds = [number, number, number, number]
export type ProvincialDataset = 'streams' | 'fish' | 'watersheds'
export const MAX_STREAM_QUERY_SPAN = 0.12
export const MAX_PROVINCIAL_STREAM_FEATURES = 450
export const MAX_PROVINCIAL_FISH = 1000
export const MAX_PROVINCIAL_WATERSHEDS = 40
export const MAX_PROVINCIAL_VERTICES = 50_000

export const BC_STREAM_SOURCES = {
  streams: {
    name: 'Freshwater Atlas stream network',
    serviceUrl: 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/56',
    catalogueUrl: 'https://catalogue.data.gov.bc.ca/dataset/92344413-8035-4c08-b996-65a9b3f62fca',
    fields: 'OBJECTID,GNIS_NAME,EDGE_TYPE,BLUE_LINE_KEY,FWA_WATERSHED_CODE,STREAM_ORDER,FEATURE_CODE,FEATURE_SOURCE',
    limit: MAX_PROVINCIAL_STREAM_FEATURES,
  },
  fish: {
    name: 'Known BC fish observations and distributions',
    serviceUrl: 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_fish/MapServer/20',
    catalogueUrl: 'https://catalogue.data.gov.bc.ca/dataset/aca81811-4b08-4382-9af7-204e0b9d2448',
    fields:
      'OBJECTID,FISH_OBSERVATION_POINT_ID,SPECIES_CODE,SPECIES_NAME,OBSERVATION_DATE,GAZETTED_NAME,ACAT_REPORT_URL',
    limit: MAX_PROVINCIAL_FISH,
  },
  watersheds: {
    name: 'Community watersheds — current',
    serviceUrl: 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_water_management/MapServer/35',
    catalogueUrl: 'https://catalogue.data.gov.bc.ca/dataset/bc57faf7-23e4-43fe-918a-e999936dbafa',
    fields: 'OBJECTID,WLS_CW_SYSID,CW_CODE,CW_NAME,CW_LEGISLATION,CW_STATUS',
    limit: MAX_PROVINCIAL_WATERSHEDS,
  },
} as const

export interface ProvincialStreamSource {
  dataset: 'bc-fwa'
  /** Service OBJECTID, scoped to this service; a refresh may change its geometry. */
  sourceId: string
  retrievedAt: string
  queryBounds: StreamQueryBounds
  edgeType: number | null
  blueLineKey: string | null
  watershedCode: string | null
  streamOrder: number | null
  featureCode: string | null
  featureSource: string | null
}

export interface ProvincialFishObservation {
  id: string
  observationId: string | null
  coordinate: Coordinate
  species: string
  observedOn: string | null
  waterbody: string | null
  reportUrl: string | null
}

export interface ProvincialWatershed {
  id: string
  sourceId: string | null
  name: string
  code: string | null
  legislation: string | null
  status: string | null
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

export interface ProvincialStreamData {
  schema: 'bc-stream-context-v1'
  bounds: StreamQueryBounds
  retrievedAt: string
  /** All IDs in the scoped service query were fetched and checked again after retrieval. */
  coverage: 'complete-query'
  sourceCounts: Record<ProvincialDataset, number>
  streamFeatureIds: string[]
  fish: ProvincialFishObservation[]
  watersheds: ProvincialWatershed[]
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string, max = 300): string {
  if (typeof value !== 'string' || value.length > max || !value.trim()) throw Error(`${label} is invalid.`)
  return value
}
const nullableText = (value: unknown, label: string, max = 300) =>
  value == null || value === '' ? null : text(value, label, max)
function positiveId(value: unknown, label: string) {
  const s = typeof value === 'number' && Number.isSafeInteger(value) ? String(value) : value
  if (typeof s !== 'string' || !/^\d{1,18}$/.test(s)) throw Error(`${label} must be a source record ID.`)
  return s
}
function finiteOrNull(value: unknown, label: string): number | null {
  if (value == null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw Error(`${label} is invalid.`)
  return value
}
function timestamp(value: unknown, label: string): string {
  const s = text(value, label, 40)
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s) || !Number.isFinite(Date.parse(s))) throw Error(`${label} is invalid.`)
  return s
}
function list(value: unknown, label: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw Error(`${label} exceeds the ${max}-record limit.`)
  return value
}
function coordinate(value: unknown): Coordinate {
  if (
    !Array.isArray(value) ||
    value.length < 2 ||
    value.length > 3 ||
    !value.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    Math.abs(value[0]) > 180 ||
    Math.abs(value[1]) >= 85
  )
    throw Error('Provincial coordinates must be WGS84 longitude/latitude.')
  return [value[0], value[1]]
}

export function parseStreamQueryBounds(value: unknown): StreamQueryBounds {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((n) => typeof n === 'number' && Number.isFinite(n)))
    throw Error('Choose a valid geographic stream-query extent.')
  const [w, s, e, n] = value as number[]
  if (w < -180 || e > 180 || s <= -85 || n >= 85 || w >= e || s >= n)
    throw Error('Choose a valid geographic stream-query extent.')
  if (e - w > MAX_STREAM_QUERY_SPAN || n - s > MAX_STREAM_QUERY_SPAN)
    throw Error(`Stream queries cover at most ${MAX_STREAM_QUERY_SPAN}° in each direction. Use a shorter active road.`)
  return [w, s, e, n]
}

/** A 500 m margin around the active road; no silently clipped query scope. */
export function streamQueryBounds(coordinates: Coordinate[]): StreamQueryBounds {
  if (!coordinates.length) throw Error('Place an active road before loading provincial streams.')
  coordinates.forEach(coordinate)
  const latitude = coordinates.reduce((n, p) => n + p[1], 0) / coordinates.length
  const dy = 500 / 111195,
    dx = dy / Math.max(0.1, Math.cos((latitude * Math.PI) / 180))
  return parseStreamQueryBounds([
    Math.min(...coordinates.map((p) => p[0])) - dx,
    Math.min(...coordinates.map((p) => p[1])) - dy,
    Math.max(...coordinates.map((p) => p[0])) + dx,
    Math.max(...coordinates.map((p) => p[1])) + dy,
  ])
}

export function parseProvincialStreamSource(raw: unknown): ProvincialStreamSource {
  const r = object(raw, 'Provincial stream source')
  if (r.dataset !== 'bc-fwa') throw Error('Unknown provincial stream source.')
  return {
    dataset: 'bc-fwa',
    sourceId: positiveId(r.sourceId, 'Stream source ID'),
    retrievedAt: timestamp(r.retrievedAt, 'Stream retrieval time'),
    queryBounds: parseStreamQueryBounds(r.queryBounds),
    edgeType: finiteOrNull(r.edgeType, 'Stream edge type'),
    blueLineKey: r.blueLineKey == null ? null : positiveId(r.blueLineKey, 'Blue line key'),
    watershedCode: nullableText(r.watershedCode, 'Watershed code'),
    streamOrder: finiteOrNull(r.streamOrder, 'Stream order'),
    featureCode: nullableText(r.featureCode, 'Feature code'),
    featureSource: nullableText(r.featureSource, 'Feature source'),
  }
}

function polygon(raw: unknown, budget: { vertices: number }): ProvincialWatershed['geometry'] {
  const r = object(raw, 'Watershed geometry')
  if (r.type !== 'Polygon' && r.type !== 'MultiPolygon') throw Error('Community watersheds need polygon geometry.')
  const polygons = r.type === 'Polygon' ? [r.coordinates] : list(r.coordinates, 'Watershed parts', 100)
  if (!polygons.length) throw Error('Community watershed geometry is empty.')
  const parsed = polygons.map((part) => {
    const rings = list(part, 'Watershed rings', 100)
    if (!rings.length) throw Error('Community watershed geometry is empty.')
    return rings.map((ring) => {
      const points = list(ring, 'Watershed vertices', MAX_PROVINCIAL_VERTICES).map(coordinate)
      budget.vertices += points.length
      if (budget.vertices > MAX_PROVINCIAL_VERTICES) throw Error('Crop provincial evidence to at most 50,000 vertices.')
      if (points.length < 4 || JSON.stringify(points[0]) !== JSON.stringify(points.at(-1)))
        throw Error('Community watershed rings must be closed.')
      return points
    })
  })
  return r.type === 'Polygon'
    ? { type: 'Polygon', coordinates: parsed[0] }
    : { type: 'MultiPolygon', coordinates: parsed }
}

export function parseProvincialStreamData(raw: unknown): ProvincialStreamData {
  const r = object(raw, 'Provincial stream context')
  if (r.schema !== 'bc-stream-context-v1' || r.coverage !== 'complete-query')
    throw Error('Provincial stream context requires a complete scoped query.')
  const counts = object(r.sourceCounts, 'Provincial source counts')
  const sourceCounts = Object.fromEntries(
    Object.entries(BC_STREAM_SOURCES).map(([key, source]) => {
      const count = counts[key]
      if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > source.limit)
        throw Error(`${source.name} record count is invalid.`)
      return [key, count]
    }),
  ) as Record<ProvincialDataset, number>
  const streamFeatureIds = list(r.streamFeatureIds, 'Provincial stream parts', MAX_PROVINCIAL_STREAM_FEATURES).map(
    (v) => text(v, 'Provincial stream ID', 100),
  )
  if (
    new Set(streamFeatureIds).size !== streamFeatureIds.length ||
    streamFeatureIds.some((id) => !/^bc-fwa-\d+-\d+$/.test(id))
  )
    throw Error('Provincial stream identities are invalid.')
  const fish = list(r.fish, 'Fish observations', MAX_PROVINCIAL_FISH).map((rawFish): ProvincialFishObservation => {
    const f = object(rawFish, 'Fish observation')
    const reportUrl = nullableText(f.reportUrl, 'Fish report URL', 2000)
    if (reportUrl && !/^https:\/\//i.test(reportUrl)) throw Error('Fish report links must use HTTPS.')
    const observedOn = nullableText(f.observedOn, 'Fish observation date', 40)
    if (observedOn && !Number.isFinite(Date.parse(observedOn))) throw Error('Fish observation date is invalid.')
    return {
      id: positiveId(f.id, 'Fish source ID'),
      observationId: f.observationId == null ? null : positiveId(f.observationId, 'Fish observation ID'),
      coordinate: coordinate(f.coordinate),
      species: text(f.species, 'Fish species'),
      observedOn,
      waterbody: nullableText(f.waterbody, 'Fish waterbody'),
      reportUrl,
    }
  })
  const budget = { vertices: 0 }
  const watersheds = list(r.watersheds, 'Community watersheds', MAX_PROVINCIAL_WATERSHEDS).map(
    (rawWatershed): ProvincialWatershed => {
      const w = object(rawWatershed, 'Community watershed')
      return {
        id: positiveId(w.id, 'Watershed source ID'),
        sourceId: w.sourceId == null ? null : positiveId(w.sourceId, 'Watershed system ID'),
        name: text(w.name, 'Watershed name'),
        code: nullableText(w.code, 'Watershed code'),
        legislation: nullableText(w.legislation, 'Watershed legislation'),
        status: nullableText(w.status, 'Watershed status'),
        geometry: polygon(w.geometry, budget),
      }
    },
  )
  if (
    fish.length !== sourceCounts.fish ||
    watersheds.length !== sourceCounts.watersheds ||
    new Set(fish.map((f) => f.id)).size !== fish.length ||
    new Set(watersheds.map((w) => w.id)).size !== watersheds.length ||
    new Set(streamFeatureIds.map((id) => id.split('-')[2])).size !== sourceCounts.streams
  )
    throw Error('Provincial source counts or identities do not match the retained records.')
  return {
    schema: 'bc-stream-context-v1',
    bounds: parseStreamQueryBounds(r.bounds),
    retrievedAt: timestamp(r.retrievedAt, 'Provincial retrieval time'),
    coverage: 'complete-query',
    sourceCounts,
    streamFeatureIds,
    fish,
    watersheds,
  }
}

/** Refresh source geometry/provenance only; changed reaches naturally stale assessment fingerprints. */
export function mergeProvincialStreams(existing: ContextFeature[], incoming: ContextFeature[]): ContextFeature[] {
  const merged = [...existing]
  for (const stream of incoming) {
    const i = merged.findIndex((f) => f.id === stream.id)
    if (i < 0) merged.push(stream)
    else {
      const old = merged[i]
      if (old.streamSource?.dataset !== 'bc-fwa' || old.streamSource.sourceId !== stream.streamSource?.sourceId)
        throw Error(
          'A provincial stream ID conflicts with another project feature. Rename that feature before loading.',
        )
      merged[i] = { ...old, geometry: stream.geometry, streamSource: stream.streamSource }
    }
  }
  return merged
}

export function provincialEvidenceGeoJson(data: ProvincialStreamData): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...data.fish.map(
        (f): GeoJSON.Feature<GeoJSON.Point> => ({
          type: 'Feature',
          id: `bc-fish-${f.id}`,
          geometry: { type: 'Point', coordinates: f.coordinate },
          properties: {
            kind: 'fish-observation',
            name: f.species,
            observation_id: f.observationId,
            observed_on: f.observedOn,
            waterbody: f.waterbody,
            report_url: f.reportUrl,
            source_url: BC_STREAM_SOURCES.fish.catalogueUrl,
            retrieved_at: data.retrievedAt,
            query_bounds: data.bounds,
          },
        }),
      ),
      ...data.watersheds.map(
        (w): GeoJSON.Feature => ({
          type: 'Feature',
          id: `bc-community-watershed-${w.id}`,
          geometry: w.geometry,
          properties: {
            kind: 'community-watershed',
            name: w.name,
            code: w.code,
            legislation: w.legislation,
            status: w.status,
            source_url: BC_STREAM_SOURCES.watersheds.catalogueUrl,
            retrieved_at: data.retrievedAt,
            query_bounds: data.bounds,
          },
        }),
      ),
    ],
  }
}
