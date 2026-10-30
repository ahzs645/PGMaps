import type { Coordinate } from './types'

export const GRAVEL_WFS = 'https://openmaps.gov.bc.ca/geo/pub/WHSE_FOREST_TENURE.FTEN_SPEC_USE_PERMIT_POLY_SVW/ows'
export const GRAVEL_ARCGIS = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/mpcm/bcgwpub/MapServer/615/query'
export const GRAVEL_CATALOGUE = 'https://catalogue.data.gov.bc.ca/dataset/forest-tenure-special-use-permit-polygon'
export const MAX_GRAVEL_CANDIDATES = 100
export const MAX_GRAVEL_RESPONSE_BYTES = 4 * 1024 * 1024
export interface GravelCandidate {
  id: string
  name: string
  fileId: string
  status: string
  use: string
  /** Bounding-box centre for identifying a candidate, not a surveyed pit entrance. */
  coordinate: Coordinate
}

/** CQL BBOX is longitude-first; WFS 2 EPSG:4326 bbox would be latitude-first. */
function gravelBounds(road: Coordinate[]): number[] {
  if (
    !road.length ||
    road.some(
      ([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) >= 85,
    )
  )
    throw Error('A valid road is required to search nearby pits.')
  const lat = road.reduce((sum, p) => sum + p[1], 0) / road.length
  const dy = 10000 / 111195,
    dx = dy / Math.cos((lat * Math.PI) / 180)
  const bounds = [
    Math.min(...road.map((p) => p[0])) - dx,
    Math.min(...road.map((p) => p[1])) - dy,
    Math.max(...road.map((p) => p[0])) + dx,
    Math.max(...road.map((p) => p[1])) + dy,
  ]
  if (
    (bounds[2] - bounds[0]) * 111195 * Math.cos((lat * Math.PI) / 180) > 50000 ||
    (bounds[3] - bounds[1]) * 111195 > 50000
  )
    throw Error('Use a road spanning at most 30 km for the nearby-pit search.')
  return bounds
}

export function gravelCandidateUrl(road: Coordinate[]): string {
  const bounds = gravelBounds(road)
  const query = new URLSearchParams({
    service: 'WFS',
    version: '2.0.0',
    request: 'GetFeature',
    typeNames: 'pub:WHSE_FOREST_TENURE.FTEN_SPEC_USE_PERMIT_POLY_SVW',
    outputFormat: 'application/json',
    srsName: 'EPSG:4326',
    count: String(MAX_GRAVEL_CANDIDATES + 1),
    propertyName: 'FOREST_FILE_ID,MAP_LABEL,SPECIAL_USE_DESCRIPTION,LIFE_CYCLE_STATUS_CODE,FILE_STATUS_CODE,GEOMETRY',
    CQL_FILTER: `BBOX(GEOMETRY,${bounds.join(',')},'EPSG:4326') AND SPECIAL_USE_DESCRIPTION IN ('Gravel Pit, Rock Quarry','Quarrying')`,
  })
  return `${GRAVEL_WFS}?${query}`
}

export function gravelArcgisUrl(road: Coordinate[]): string {
  const query = new URLSearchParams({
    f: 'geojson',
    where: "SPECIAL_USE_DESCRIPTION IN ('Gravel Pit, Rock Quarry','Quarrying')",
    geometry: gravelBounds(road).join(','),
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'FOREST_FILE_ID,MAP_LABEL,SPECIAL_USE_DESCRIPTION,LIFE_CYCLE_STATUS_CODE,FILE_STATUS_CODE',
    returnGeometry: 'true',
    resultRecordCount: String(MAX_GRAVEL_CANDIDATES + 1),
  })
  return `${GRAVEL_ARCGIS}?${query}`
}

export function parseGravelCandidates(raw: unknown): GravelCandidate[] {
  const data = raw as { type?: string; features?: unknown[]; numberMatched?: unknown; numberReturned?: unknown }
  if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features))
    throw Error('BC pit service did not return a feature collection.')
  const matched = Number(data.numberMatched)
  if (
    data.numberMatched === null ||
    data.numberMatched === undefined ||
    data.numberReturned === null ||
    data.numberReturned === undefined ||
    !Number.isInteger(matched) ||
    matched < 0 ||
    matched > MAX_GRAVEL_CANDIDATES ||
    matched !== data.features.length ||
    Number(data.numberReturned) !== data.features.length
  )
    throw Error('BC pit results are incomplete or exceed 100 candidates; use a smaller road area.')
  let vertices = 0
  return data.features.map((rawFeature, index) => {
    const f = rawFeature as {
      id?: unknown
      properties?: Record<string, unknown>
      geometry?: { type?: string; coordinates?: unknown }
    }
    if (!f.properties || !f.geometry || !['Polygon', 'MultiPolygon'].includes(f.geometry.type ?? ''))
      throw Error('BC pit service returned an unsupported feature.')
    if (!['Gravel Pit, Rock Quarry', 'Quarrying'].includes(String(f.properties.SPECIAL_USE_DESCRIPTION)))
      throw Error(
        'The export includes non-pit permits; filter SPECIAL_USE_DESCRIPTION to gravel pits or quarrying first.',
      )
    const points: Coordinate[] = []
    const scan = (value: unknown): void => {
      if (!Array.isArray(value)) throw Error('BC pit geometry is invalid.')
      if (typeof value[0] === 'number') {
        if (
          ++vertices > 50000 ||
          value.length < 2 ||
          !Number.isFinite(value[0]) ||
          typeof value[1] !== 'number' ||
          !Number.isFinite(value[1]) ||
          Math.abs(value[0]) > 180 ||
          Math.abs(value[1]) >= 85
        )
          throw Error('BC pit geometry exceeds limits or has invalid coordinates.')
        points.push([value[0], value[1]])
      } else value.forEach(scan)
    }
    scan(f.geometry.coordinates)
    if (!points.length) throw Error('BC pit geometry is empty.')
    const text = (key: string, fallback: string) =>
      typeof f.properties![key] === 'string' ? String(f.properties![key]).slice(0, 200) : fallback
    const fileId = text('FOREST_FILE_ID', 'Unknown file')
    return {
      id: String(f.id ?? `${fileId}-${index}`).slice(0, 200),
      name: text('MAP_LABEL', fileId),
      fileId,
      status: `${text('LIFE_CYCLE_STATUS_CODE', 'Unknown lifecycle')} / ${text('FILE_STATUS_CODE', 'unknown file status')}`,
      use: text('SPECIAL_USE_DESCRIPTION', 'Unknown use'),
      coordinate: [
        (Math.min(...points.map((p) => p[0])) + Math.max(...points.map((p) => p[0]))) / 2,
        (Math.min(...points.map((p) => p[1])) + Math.max(...points.map((p) => p[1]))) / 2,
      ],
    }
  })
}

export async function loadGravelCandidates(
  road: Coordinate[],
  fetcher: typeof fetch = fetch,
): Promise<GravelCandidate[]> {
  const url = gravelArcgisUrl(road)
  let response: Response
  try {
    response = await fetcher(url, { signal: AbortSignal.timeout(20000) })
  } catch {
    try {
      response = await fetcher(gravelCandidateUrl(road), { signal: AbortSignal.timeout(20000) })
    } catch {
      throw Error(
        'BC pit service could not be reached (network or browser cross-origin restriction). Import a BC special-use permit GeoJSON export instead.',
      )
    }
  }
  if (!response.ok) throw Error(`BC pit service returned HTTP ${response.status}.`)
  if (Number(response.headers.get('content-length')) > MAX_GRAVEL_RESPONSE_BYTES)
    throw Error('BC pit response exceeds the 4 MB limit; use a smaller road area.')
  const reader = response.body?.getReader()
  if (!reader) throw Error('BC pit service returned an empty response.')
  const decoder = new TextDecoder()
  let bytes = 0,
    body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_GRAVEL_RESPONSE_BYTES) {
        await reader.cancel()
        throw Error('BC pit response exceeds the 4 MB limit; use a smaller road area.')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    body += decoder.decode()
  } finally {
    reader.releaseLock()
  }
  const raw = JSON.parse(body) as {
    error?: { message?: string }
    type?: string
    features?: unknown[]
    numberMatched?: unknown
    exceededTransferLimit?: boolean
    properties?: { exceededTransferLimit?: boolean }
  }
  if (raw.error) throw Error(raw.error.message ?? 'BC pit service returned an error.')
  if (raw.exceededTransferLimit || raw.properties?.exceededTransferLimit)
    throw Error('BC pit results exceed the service limit; import a smaller filtered area.')
  if (raw.numberMatched === undefined && Array.isArray(raw.features))
    return parseGravelCandidates({ ...raw, numberMatched: raw.features.length, numberReturned: raw.features.length })
  return parseGravelCandidates(raw)
}

/** An explicitly imported export has no remote completeness claim. */
export function importGravelCandidates(text: string): GravelCandidate[] {
  if (new TextEncoder().encode(text).byteLength > MAX_GRAVEL_RESPONSE_BYTES)
    throw Error('BC pit export exceeds the 4 MB limit.')
  const raw = JSON.parse(text) as { type?: string; features?: unknown[] }
  if (!raw || !Array.isArray(raw.features)) throw Error('Import a BC special-use permit GeoJSON feature collection.')
  return parseGravelCandidates({ ...raw, numberMatched: raw.features.length, numberReturned: raw.features.length })
}
