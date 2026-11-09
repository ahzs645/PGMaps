/** Discover a small, deterministic page of actual tenure cutblocks. No source geometry is saved by a search. */
import { ACCESS_HISTORY_SOURCES, MAX_ACCESS_SOURCE_TIMEOUT_MS, requestBcAccessSourceJson } from './accessHistorySources'
import type { RoadQueryBounds } from './existingRoads'

export const BC_CUTBLOCK_SEARCH_DEFAULT_LIMIT = 25
export const BC_CUTBLOCK_SEARCH_MAX_LIMIT = 50
export const BC_CUTBLOCK_SEARCH_MAX_SPAN = 0.3
export const BC_CUTBLOCK_SEARCH_MAX_BYTES = 5 * 1024 * 1024
export const BC_CUTBLOCK_SEARCH_MAX_VERTICES = 100_000
export const BC_CUTBLOCK_SEARCH_TIMEOUT_MS = MAX_ACCESS_SOURCE_TIMEOUT_MS

export interface BcCutblockSearchFilters {
  openingId?: string
  forestFileId?: string
  cuttingPermitId?: string
  timberMark?: string
  cutBlockId?: string
  bounds?: RoadQueryBounds
  limit?: number
}

export interface BcCutblockSearchRecord {
  id: string
  openingId: string | null
  /** Preserve nonpositive legacy source values without treating them as positive RESULTS lookup identifiers. */
  reportedOpeningId?: string
  studyUnavailableReason?: string
  cutblockSKey: string
  forestFileId?: string
  cuttingPermitId?: string
  cutBlockId?: string
  timberMark?: string
  clientNumber?: string
  lifecycleStatus?: string
  disturbanceStartDate?: string
  disturbanceEndDate?: string
  /** Envelope of the returned, unsimplified geometry; null means the source supplied no geometry. */
  bounds: RoadQueryBounds | null
}

export interface BcCutblockSearchResult {
  records: BcCutblockSearchRecord[]
  query: {
    filters: BcCutblockSearchFilters & { limit: number }
    requestUrl: string
    retrievedAt: string
    sourceUrl: string
    limit: number
  }
  returnedCount: number
  /** A bounded page, not an exhaustive inventory. Narrow the filters instead of silently paginating. */
  hasMore: boolean
  matchedCountLowerBound: number
}

const source = ACCESS_HISTORY_SOURCES.find((entry) => entry.id === 'ften-cutblock')!
const fieldNames = {
  forestFileId: 'HARVEST_AUTH_FOREST_FILE_ID',
  cuttingPermitId: 'HARVEST_AUTH_CUTTING_PERMIT_ID',
  cutBlockId: 'CUT_BLOCK_ID',
  timberMark: 'TIMBER_MARK',
} as const
const optionalRecordFields = { ...fieldNames, clientNumber: 'CLIENT_NUMBER', lifecycleStatus: 'LIFE_CYCLE_STATUS_CODE' }
const allowedFilters = new Set(['openingId', ...Object.keys(fieldNames), 'bounds', 'limit'])

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function identifier(value: unknown, label: string): string {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^\d{1,15}$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  )
    throw Error(`${label} must be a positive integer identifier.`)
  return String(Number(value))
}

function reportedOpening(
  value: unknown,
): Pick<BcCutblockSearchRecord, 'openingId' | 'reportedOpeningId' | 'studyUnavailableReason'> {
  if (value === null || value === undefined)
    return {
      openingId: null,
      studyUnavailableReason:
        'The source supplies no opening ID. A positive opening ID is required for the linked RESULTS and road study.',
    }
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^-?\d{1,15}$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value))
  )
    throw Error('The source reported an invalid opening identifier.')
  const reportedOpeningId = String(Number(value))
  return {
    openingId: Number(value) > 0 ? reportedOpeningId : null,
    reportedOpeningId,
    ...(Number(value) <= 0
      ? {
          studyUnavailableReason: `The source reports opening ${reportedOpeningId}. This linked study requires a positive RESULTS opening ID; the FTEN record is retained for review.`,
        }
      : {}),
  }
}

function businessCode(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value.trim()))
    throw Error(`${label} must be an identifier containing letters, numbers, dots, colons, underscores or hyphens.`)
  return value.trim()
}

function calendarDate(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' && typeof value !== 'number') throw Error(`Invalid ${label}.`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw Error(`Invalid ${label}.`)
  const result = date.toISOString().slice(0, 10)
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    result < '1800-01-01' ||
    result > '2200-12-31' ||
    (typeof value === 'string' && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || value.slice(0, 10) !== result))
  )
    throw Error(`Invalid ${label}; use an actual calendar date.`)
  return result
}

/** No free-form SQL, wildcards, prefix matches, unbounded inventory request, or silently clipped extent. */
export function normalizeBcCutblockSearchFilters(
  filters: BcCutblockSearchFilters,
): BcCutblockSearchFilters & { limit: number } {
  const raw = object(filters, 'Cutblock search filters')
  if (Object.keys(raw).some((key) => !allowedFilters.has(key))) throw Error('Unknown cutblock search filter.')
  const limit = filters.limit ?? BC_CUTBLOCK_SEARCH_DEFAULT_LIMIT
  if (!Number.isInteger(limit) || limit < 1 || limit > BC_CUTBLOCK_SEARCH_MAX_LIMIT)
    throw Error(`Search for at most ${BC_CUTBLOCK_SEARCH_MAX_LIMIT} cutblocks at a time.`)
  const result: BcCutblockSearchFilters & { limit: number } = { limit }
  if (filters.openingId !== undefined && filters.openingId !== '') {
    if (typeof filters.openingId !== 'string') throw Error('Enter the opening identifier as text.')
    result.openingId = identifier(filters.openingId.trim(), 'Opening ID')
  }
  for (const key of Object.keys(fieldNames) as (keyof typeof fieldNames)[]) {
    const value = businessCode(filters[key], key)
    if (value) result[key] = value.toUpperCase()
  }
  if (filters.bounds !== undefined) {
    const bounds = filters.bounds
    if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite))
      throw Error('Choose a valid WGS84 search envelope.')
    const [west, south, east, north] = bounds
    if (west >= east || south >= north || west < -180 || east > 180 || south <= -85 || north >= 85)
      throw Error('Choose a valid WGS84 search envelope.')
    if (east - west > BC_CUTBLOCK_SEARCH_MAX_SPAN || north - south > BC_CUTBLOCK_SEARCH_MAX_SPAN)
      throw Error(
        `Choose a smaller area: cutblock search spans at most ${BC_CUTBLOCK_SEARCH_MAX_SPAN}° in each direction.`,
      )
    result.bounds = [...bounds]
  }
  if (
    !result.openingId &&
    !result.bounds &&
    !Object.keys(fieldNames).some((key) => result[key as keyof typeof fieldNames])
  )
    throw Error('Enter an opening ID, licence, cutting permit, timber mark, block ID or a small search area.')
  return result
}

export function buildBcCutblockSearchQuery(filters: BcCutblockSearchFilters): string {
  const normalized = normalizeBcCutblockSearchFilters(filters)
  const clauses = normalized.openingId ? [`OPENING_ID=${normalized.openingId}`] : []
  for (const [key, field] of Object.entries(fieldNames)) {
    const value = normalized[key as keyof typeof fieldNames]
    if (value) clauses.push(`${field}='${value}'`)
  }
  const params = new URLSearchParams({
    f: 'geojson',
    where: clauses.join(' AND ') || '1=1',
    outFields:
      'CUT_BLOCK_SKEY,OPENING_ID,HARVEST_AUTH_FOREST_FILE_ID,HARVEST_AUTH_CUTTING_PERMIT_ID,CUT_BLOCK_ID,TIMBER_MARK,CLIENT_NUMBER,LIFE_CYCLE_STATUS_CODE,DISTURBANCE_START_DATE,DISTURBANCE_END_DATE',
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: String(normalized.limit + 1),
    orderByFields: 'CUT_BLOCK_SKEY',
  })
  if (normalized.bounds) {
    params.set('geometry', normalized.bounds.join(','))
    params.set('geometryType', 'esriGeometryEnvelope')
    params.set('inSR', '4326')
    params.set('spatialRel', 'esriSpatialRelIntersects')
  }
  return `${source.serviceUrl}/query?${params}`
}

function geometryBounds(value: unknown, budget: { vertices: number }): RoadQueryBounds | null {
  if (value === null || value === undefined) return null
  const geometry = object(value, 'Cutblock geometry')
  if (geometry.crs !== undefined) throw Error('Cutblock search geometry must use WGS84 coordinates.')
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')
    throw Error('Cutblock search requires polygon geometry.')
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  if (!Array.isArray(polygons) || !polygons.length) throw Error('Cutblock search returned an empty polygon.')
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !polygon.length) throw Error('Cutblock search returned an empty polygon.')
    for (const ring of polygon) {
      if (!Array.isArray(ring) || ring.length < 4) throw Error('Cutblock search returned an invalid polygon ring.')
      for (const coordinate of ring) {
        if (
          !Array.isArray(coordinate) ||
          coordinate.length < 2 ||
          coordinate.length > 3 ||
          !coordinate.every(Number.isFinite) ||
          coordinate[0] < -180 ||
          coordinate[0] > 180 ||
          coordinate[1] <= -85 ||
          coordinate[1] >= 85
        )
          throw Error('Cutblock search returned invalid WGS84 coordinates.')
        budget.vertices += 1
        if (budget.vertices > BC_CUTBLOCK_SEARCH_MAX_VERTICES)
          throw Error(`Cutblock search exceeds ${BC_CUTBLOCK_SEARCH_MAX_VERTICES} vertices; narrow the filters.`)
        west = Math.min(west, coordinate[0])
        east = Math.max(east, coordinate[0])
        south = Math.min(south, coordinate[1])
        north = Math.max(north, coordinate[1])
      }
      if (ring[0][0] !== ring.at(-1)![0] || ring[0][1] !== ring.at(-1)![1])
        throw Error('Cutblock search returned an unclosed polygon ring.')
    }
  }
  if (west === east || south === north) throw Error('Cutblock search returned a degenerate polygon envelope.')
  return [west, south, east, north]
}

/** Truncation is visible in discovery. Importing the selected opening still requires the complete pilot lookup. */
export function parseBcCutblockSearch(
  raw: unknown,
  filters: BcCutblockSearchFilters,
  retrievedAt = new Date().toISOString(),
): BcCutblockSearchResult {
  const normalized = normalizeBcCutblockSearchFilters(filters)
  if (typeof retrievedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(retrievedAt))
    throw Error('Invalid search retrieval timestamp.')
  calendarDate(retrievedAt, 'search retrieval timestamp')
  const response = object(raw, 'Cutblock search response')
  if (response.error) {
    const error = object(response.error, 'Cutblock service error')
    throw Error(typeof error.message === 'string' ? error.message.slice(0, 500) : 'The BC cutblock search failed.')
  }
  if (response.type !== 'FeatureCollection' || response.crs !== undefined || !Array.isArray(response.features))
    throw Error('Cutblock search must return a WGS84 GeoJSON feature collection.')
  if (response.features.length > normalized.limit + 1)
    throw Error('Cutblock search exceeded its requested record budget.')
  const metadata = response.properties === undefined ? {} : object(response.properties, 'Cutblock search metadata')
  for (const value of [response.exceededTransferLimit, metadata.exceededTransferLimit])
    if (value !== undefined && typeof value !== 'boolean') throw Error('Invalid cutblock search transfer-limit flag.')
  const budget = { vertices: 0 }
  const records = response.features
    .map((rawFeature): BcCutblockSearchRecord => {
      const feature = object(rawFeature, 'Cutblock search feature')
      if (feature.type !== 'Feature' || feature.crs !== undefined) throw Error('Invalid cutblock search feature.')
      const p = object(feature.properties, 'Cutblock search attributes')
      const cutblockSKey = identifier(p.CUT_BLOCK_SKEY, 'Cutblock key')
      const record: BcCutblockSearchRecord = {
        id: `ften-cutblock:${cutblockSKey}`,
        cutblockSKey,
        ...reportedOpening(p.OPENING_ID),
        bounds: geometryBounds(feature.geometry, budget),
      }
      for (const [key, field] of Object.entries(optionalRecordFields)) {
        const parsed = businessCode(p[field], key)
        if (parsed) record[key as keyof typeof optionalRecordFields] = parsed
      }
      const start = calendarDate(p.DISTURBANCE_START_DATE, 'reported harvest start')
      const end = calendarDate(p.DISTURBANCE_END_DATE, 'reported harvest completion')
      if (start && end && start > end) throw Error('Reported harvest completion precedes start.')
      if (start) record.disturbanceStartDate = start
      if (end) record.disturbanceEndDate = end
      if (normalized.openingId && record.openingId !== normalized.openingId)
        throw Error('The service returned another opening; search results were not accepted.')
      for (const key of Object.keys(fieldNames) as (keyof typeof fieldNames)[])
        if (normalized[key] && normalized[key] !== record[key]?.toUpperCase())
          throw Error('The service returned a cutblock outside the requested identifiers.')
      if (normalized.bounds && record.bounds) {
        const [w, s, e, n] = normalized.bounds,
          [rw, rs, re, rn] = record.bounds
        if (re < w || rw > e || rn < s || rs > n)
          throw Error('The service returned a cutblock outside the search envelope.')
      }
      return record
    })
    .sort((a, b) => Number(a.cutblockSKey) - Number(b.cutblockSKey))
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw Error('Duplicate cutblock source keys require review; no search records were silently dropped.')
  const hasMore =
    records.length > normalized.limit ||
    response.exceededTransferLimit === true ||
    metadata.exceededTransferLimit === true
  const visible = records.slice(0, normalized.limit)
  return {
    records: visible,
    query: {
      filters: normalized,
      requestUrl: buildBcCutblockSearchQuery(normalized),
      retrievedAt,
      sourceUrl: source.catalogueUrl,
      limit: normalized.limit,
    },
    returnedCount: visible.length,
    hasMore,
    matchedCountLowerBound: Math.max(records.length, visible.length + (hasMore ? 1 : 0)),
  }
}

export async function searchBcCutblocks(
  filters: BcCutblockSearchFilters,
  signal?: AbortSignal,
): Promise<BcCutblockSearchResult> {
  const normalized = normalizeBcCutblockSearchFilters(filters)
  const raw = await requestBcAccessSourceJson(
    buildBcCutblockSearchQuery(normalized),
    BC_CUTBLOCK_SEARCH_MAX_BYTES,
    signal,
    BC_CUTBLOCK_SEARCH_TIMEOUT_MS,
  )
  return parseBcCutblockSearch(raw, normalized)
}
