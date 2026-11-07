import {
  BC_STREAM_SOURCES,
  MAX_PROVINCIAL_STREAM_FEATURES,
  MAX_PROVINCIAL_VERTICES,
  parseProvincialStreamData,
  parseProvincialStreamSource,
  parseStreamQueryBounds,
  type ProvincialDataset,
  type ProvincialStreamData,
  type StreamQueryBounds,
} from './provincialStreamData'
import type { ContextFeature, Coordinate } from './types'

export const STREAM_QUERY_PAGE_SIZE = 150
export const MAX_STREAM_RESPONSE_BYTES = 8 * 1024 * 1024
export const STREAM_QUERY_TIMEOUT_MS = 30_000
const datasets: ProvincialDataset[] = ['streams', 'fish', 'watersheds']
type SourceFeature = GeoJSON.Feature<GeoJSON.Geometry, Record<string, unknown>>

export function buildProvincialQuery(dataset: ProvincialDataset, bounds: StreamQueryBounds, ids?: string[]): string {
  parseStreamQueryBounds(bounds)
  const params = new URLSearchParams({ f: ids ? 'geojson' : 'json', where: '1=1' })
  if (ids) {
    if (!ids.length || ids.length > STREAM_QUERY_PAGE_SIZE || ids.some((id) => !/^\d{1,18}$/.test(id)))
      throw Error('Use a bounded page of source record IDs.')
    params.set('objectIds', ids.join(','))
    params.set('outFields', BC_STREAM_SOURCES[dataset].fields)
    params.set('outSR', '4326')
    params.set('returnGeometry', 'true')
    params.set('orderByFields', 'OBJECTID')
    params.set('resultRecordCount', String(STREAM_QUERY_PAGE_SIZE))
  } else {
    params.set('geometry', bounds.join(','))
    params.set('geometryType', 'esriGeometryEnvelope')
    params.set('inSR', '4326')
    params.set('spatialRel', 'esriSpatialRelIntersects')
    params.set('returnIdsOnly', 'true')
    params.set('returnGeometry', 'false')
  }
  return `${BC_STREAM_SOURCES[dataset].serviceUrl}/query?${params}`
}

function recordId(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  if (typeof value === 'string' && /^\d{1,18}$/.test(value)) return value
  throw Error('The provincial service returned a missing or invalid record ID.')
}
function responseObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw Error('The provincial service returned invalid JSON.')
  const r = raw as Record<string, unknown>
  if (r.error) throw Error('The provincial service could not complete this query. Try again or import local data.')
  if (r.exceededTransferLimit || (r.properties as Record<string, unknown> | undefined)?.exceededTransferLimit)
    throw Error('The provincial service truncated this query. No partial evidence was loaded; use a smaller extent.')
  return r
}
function sourceIds(raw: unknown, dataset: ProvincialDataset): string[] {
  const r = responseObject(raw)
  // ArcGIS uses null for a successful empty ID inventory (observed on fish and watershed queries).
  if (r.objectIds === null && r.objectIdFieldName === 'OBJECTID') return []
  if (!Array.isArray(r.objectIds)) throw Error('The provincial service did not return an ID inventory.')
  if (r.objectIds.length > BC_STREAM_SOURCES[dataset].limit)
    throw Error(
      `Too many ${BC_STREAM_SOURCES[dataset].name} records. Use a shorter active road; no partial data was loaded.`,
    )
  const ids = r.objectIds.map(recordId).sort((a, b) => a.length - b.length || a.localeCompare(b))
  if (new Set(ids).size !== ids.length) throw Error('The provincial ID inventory contains duplicate records.')
  return ids
}
function sourcePage(raw: unknown, expected: string[]): SourceFeature[] {
  const r = responseObject(raw)
  if (r.type !== 'FeatureCollection' || !Array.isArray(r.features))
    throw Error('The provincial service did not return GeoJSON features.')
  const features = r.features as SourceFeature[]
  const ids = features.map((f) => {
    if (!f || f.type !== 'Feature' || !f.geometry || !f.properties) throw Error('A provincial feature is malformed.')
    return recordId(f.properties.OBJECTID)
  })
  if (ids.length !== expected.length || new Set(ids).size !== ids.length || ids.some((id) => !expected.includes(id)))
    throw Error('Provincial records changed or a page is incomplete. Retry the query; no partial data was loaded.')
  return features
}

async function readJson(url: string, signal: AbortSignal, fetcher: typeof fetch, budget: { bytes: number }) {
  const response = await fetcher(url, { signal })
  if (!response.ok) throw Error(`Provincial stream query failed (${response.status}). Try again or import local data.`)
  if (Number(response.headers.get('content-length')) > MAX_STREAM_RESPONSE_BYTES)
    throw Error('Provincial stream response is too large. Use a smaller extent.')
  const reader = response.body?.getReader()
  if (!reader) throw Error('The provincial service returned an empty response.')
  const decoder = new TextDecoder()
  let text = ''
  try {
    while (true) {
      signal.throwIfAborted()
      const chunk = await reader.read()
      if (chunk.done) break
      budget.bytes += chunk.value.byteLength
      if (budget.bytes > MAX_STREAM_RESPONSE_BYTES) {
        await reader.cancel()
        throw Error('Provincial stream response is too large. Use a smaller extent.')
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw Error('The provincial service returned unreadable JSON.')
  }
}

async function loadDataset(
  dataset: ProvincialDataset,
  bounds: StreamQueryBounds,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  const budget = { bytes: 0 }
  const url = buildProvincialQuery(dataset, bounds)
  const ids = sourceIds(await readJson(url, signal, fetcher, budget), dataset)
  const result: SourceFeature[] = []
  for (let offset = 0; offset < ids.length; offset += STREAM_QUERY_PAGE_SIZE) {
    const pageIds = ids.slice(offset, offset + STREAM_QUERY_PAGE_SIZE)
    result.push(
      ...sourcePage(await readJson(buildProvincialQuery(dataset, bounds, pageIds), signal, fetcher, budget), pageIds),
    )
  }
  const after = sourceIds(await readJson(url, signal, fetcher, budget), dataset)
  if (JSON.stringify(ids) !== JSON.stringify(after))
    throw Error('The provincial query changed during loading. Retry; no partial data was loaded.')
  return result
}

const sourceText = (value: unknown, max = 300): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
const sourceNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
const optionalId = (value: unknown) => (value == null ? null : recordId(value))

export function normalizeProvincialContext(
  raw: Record<ProvincialDataset, SourceFeature[]>,
  bounds: StreamQueryBounds,
  retrievedAt: string,
): { streams: ContextFeature[]; data: ProvincialStreamData } {
  const streams: ContextFeature[] = []
  let vertices = 0
  for (const feature of raw.streams) {
    const p = feature.properties,
      sourceId = recordId(p.OBJECTID)
    const g = feature.geometry
    if (g.type !== 'LineString' && g.type !== 'MultiLineString') throw Error('FWA flow arcs must be line geometry.')
    const parts = g.type === 'LineString' ? [g.coordinates] : g.coordinates
    if (!parts.length) throw Error('FWA flow arc geometry is empty.')
    parts.forEach((part, index) => {
      vertices += part.length
      if (part.length < 2 || part.length > 10000 || vertices > MAX_PROVINCIAL_VERTICES)
        throw Error('Crop FWA linework to the project vertex limits. No partial data was loaded.')
      const coordinates = part.map((point): Coordinate => {
        if (
          point.length < 2 ||
          point.length > 3 ||
          !point.every(Number.isFinite) ||
          Math.abs(point[0]) > 180 ||
          Math.abs(point[1]) >= 85
        )
          throw Error('FWA flow arcs must use WGS84 longitude/latitude.')
        return [point[0], point[1]]
      })
      streams.push({
        id: `bc-fwa-${sourceId}-${index}`,
        name: sourceText(p.GNIS_NAME) ?? `FWA flow arc ${sourceId}`,
        kind: 'stream',
        geometry: { type: 'LineString', coordinates },
        streamSource: parseProvincialStreamSource({
          dataset: 'bc-fwa',
          sourceId,
          retrievedAt,
          queryBounds: bounds,
          edgeType: sourceNumber(p.EDGE_TYPE),
          blueLineKey: optionalId(p.BLUE_LINE_KEY),
          watershedCode: sourceText(p.FWA_WATERSHED_CODE),
          streamOrder: sourceNumber(p.STREAM_ORDER),
          featureCode: sourceText(p.FEATURE_CODE),
          featureSource: sourceText(p.FEATURE_SOURCE),
        }),
      })
    })
  }
  if (streams.length > MAX_PROVINCIAL_STREAM_FEATURES) throw Error('Too many FWA stream parts. Use a smaller extent.')
  const fish = raw.fish.map((f) => {
    const p = f.properties
    if (f.geometry.type !== 'Point') throw Error('Fish observations must be point geometry.')
    const d = p.OBSERVATION_DATE
    const parsedDate = typeof d === 'number' || typeof d === 'string' ? new Date(d) : null
    const url = sourceText(p.ACAT_REPORT_URL, 2000)
    return {
      id: recordId(p.OBJECTID),
      observationId: optionalId(p.FISH_OBSERVATION_POINT_ID),
      coordinate: f.geometry.coordinates,
      species: sourceText(p.SPECIES_NAME) ?? sourceText(p.SPECIES_CODE) ?? 'Species not recorded',
      observedOn: parsedDate && Number.isFinite(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      waterbody: sourceText(p.GAZETTED_NAME),
      reportUrl: url && /^https:\/\//i.test(url) ? url : null,
    }
  })
  const watersheds = raw.watersheds.map((f) => ({
    id: recordId(f.properties.OBJECTID),
    sourceId: optionalId(f.properties.WLS_CW_SYSID),
    name: sourceText(f.properties.CW_NAME) ?? 'Unnamed community watershed',
    code: sourceText(f.properties.CW_CODE),
    legislation: sourceText(f.properties.CW_LEGISLATION),
    status: sourceText(f.properties.CW_STATUS),
    geometry: f.geometry,
  }))
  const data = parseProvincialStreamData({
    schema: 'bc-stream-context-v1',
    bounds,
    retrievedAt,
    coverage: 'complete-query',
    sourceCounts: Object.fromEntries(datasets.map((key) => [key, raw[key].length])),
    streamFeatureIds: streams.map((f) => f.id),
    fish,
    watersheds,
  })
  return { streams, data }
}

/** Atomic bounded load: no project mutation until all three sources pass their completeness checks. */
export async function loadBcStreamContext(
  bounds: StreamQueryBounds,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  parseStreamQueryBounds(bounds)
  const controller = new AbortController()
  const cancel = () => controller.abort(signal?.reason)
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new Error('The provincial stream query timed out. Try a smaller extent.')),
    STREAM_QUERY_TIMEOUT_MS,
  )
  try {
    const loaded = await Promise.all(
      datasets.map(
        async (dataset) => [dataset, await loadDataset(dataset, bounds, controller.signal, fetcher)] as const,
      ),
    )
    controller.signal.throwIfAborted()
    return normalizeProvincialContext(
      Object.fromEntries(loaded) as Record<ProvincialDataset, SourceFeature[]>,
      bounds,
      new Date().toISOString(),
    )
  } catch (error) {
    controller.abort()
    throw error
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
  }
}
