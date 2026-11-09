/** Bounded official-source adapters. Record linkage is evidence, never proof of a road's original purpose. */
import type { ContextFeature, Coordinate } from './types'
import type { HistoricalBlockIdentity, HistoricalSource, HistoricalStructure } from './accessHistoryTypes'
import {
  buildBcRoadsQuery,
  importExistingRoads,
  MAX_EXISTING_ROADS,
  MAX_ROAD_RESPONSE_BYTES,
  sourceRoadIdentifiers,
  type RoadQueryBounds,
} from './existingRoads'
import { unreviewedRoadEvidence } from './existingRoadEvidence'

const FOREST_TENURE = 'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_tenure/MapServer'
const FOREST_VEGETATION =
  'https://delivery.maps.gov.bc.ca/arcgis/rest/services/whse/bcgw_pub_whse_forest_vegetation/MapServer'
const catalogue = (id: string) => `https://catalogue.data.gov.bc.ca/dataset/${id}`
export const MAX_BLOCK_IDENTITY_RECORDS = 100
export const MAX_IDENTITY_RESPONSE_BYTES = 1024 * 1024
export const MAX_STRUCTURE_IMPORT_BYTES = 5 * 1024 * 1024
export const MAX_IMPORTED_STRUCTURES = 500
export const ACCESS_SOURCE_TIMEOUT_MS = 20_000

export interface AccessHistorySourceDefinition {
  id: string
  name: string
  catalogueUrl: string
  serviceUrl?: string
  licence: 'Open Government Licence – British Columbia' | 'Access Only'
  access: 'public' | 'restricted'
  use: 'bounded-live-query' | 'user-import-only' | 'reference-only'
  description: string
}

/** Access and reuse rights are distinct. No Access Only or protected dataset is queried by this module. */
export const ACCESS_HISTORY_SOURCES: readonly AccessHistorySourceDefinition[] = [
  {
    id: 'results-opening',
    name: 'RESULTS openings',
    catalogueUrl: catalogue('53a17fec-e9ad-4ac0-95e6-f5106a97e677'),
    serviceUrl: `${FOREST_VEGETATION}/26`,
    licence: 'Open Government Licence – British Columbia',
    access: 'public',
    use: 'bounded-live-query',
    description:
      'Opening, licence, cutting permit and reported disturbance identity. An opening may include natural disturbance.',
  },
  {
    id: 'ften-cutblock',
    name: 'Forest Tenure Cutblock Polygons',
    catalogueUrl: catalogue('dfb8b498-fa4b-4286-b3ec-58db88aca1cf'),
    serviceUrl: `${FOREST_TENURE}/8`,
    licence: 'Open Government Licence – British Columbia',
    access: 'public',
    use: 'bounded-live-query',
    description:
      'Harvest authority identity; ACTIVE and RETIRED are administrative statuses, not current harvesting or road conditions.',
  },
  {
    id: 'ften-road-segment',
    name: 'Forest Tenure Road Segment Lines',
    catalogueUrl: catalogue('9e5bfa62-2339-445e-bf67-81657180c682'),
    serviceUrl: `${FOREST_TENURE}/21`,
    licence: 'Open Government Licence – British Columbia',
    access: 'public',
    use: 'bounded-live-query',
    description:
      'Permit, section and station identifiers. A mapped tenure segment does not establish construction, passability or a block served.',
  },
  {
    id: 'consolidated-cutblock',
    name: 'Consolidated cutblocks',
    catalogueUrl: catalogue('b1b647a6-f271-42e0-9cd0-89ec24bce9f7'),
    licence: 'Access Only',
    access: 'public',
    use: 'reference-only',
    description:
      'Historical harvest evidence with estimated dates; public access does not grant open redistribution rights.',
  },
  {
    id: 'mof-structures',
    name: 'Ministry of Forests bridges and major culverts',
    catalogueUrl: catalogue('df943320-9e31-421c-8ada-d4df80518684'),
    licence: 'Access Only',
    access: 'public',
    use: 'user-import-only',
    description:
      'Import only a source extract you are entitled to use. Current inspection/rating fields do not establish a historical construction date.',
  },
  {
    id: 'pscis',
    name: 'PSCIS fish-passage assessments',
    catalogueUrl: catalogue('7ecfafa6-5e18-48cd-8d9b-eae5b5ea2881'),
    licence: 'Access Only',
    access: 'public',
    use: 'user-import-only',
    description:
      'Import only a source extract you are entitled to use. Fish-passage barriers are not vehicle closures or load ratings.',
  },
  {
    id: 'bcts-block-access',
    name: 'BCTS Block Access Roads',
    catalogueUrl: catalogue('7c166ce7-a3ff-40ee-b7e2-98b3059aba37'),
    licence: 'Access Only',
    access: 'restricted',
    use: 'reference-only',
    description:
      'PROTECTED A; named access for regulator reviews. Not a public road-to-cutblock lookup and not loaded here.',
  },
]

export type BlockIdentitySource = 'results-opening' | 'ften-cutblock'
export interface BlockIdentityRecord {
  id: string
  source: BlockIdentitySource
  sourceUrl: string
  retrievedAt: string
  openingId: string
  cutblockSKey?: string
  forestFileId?: string
  cuttingPermitId?: string
  cutBlockId?: string
  timberMark?: string
  clientNumber?: string
  lifecycleStatus?: string
  disturbanceStartDate?: string
  disturbanceEndDate?: string
}
export interface BlockIdentityConflict {
  field: 'forestFileId' | 'cuttingPermitId' | 'cutBlockId' | 'timberMark' | 'clientNumber'
  resultsValue: string
  ftenValue: string
}
export interface BlockIdentityLookup {
  openingId: string
  retrievedAt: string
  records: BlockIdentityRecord[]
  matches: {
    resultsRecordId: string
    ftenRecordId: string
    basis: 'opening-id'
    conflicts: BlockIdentityConflict[]
  }[]
  missingSources: BlockIdentitySource[]
}

function definition(id: string): AccessHistorySourceDefinition {
  const source = ACCESS_HISTORY_SOURCES.find((entry) => entry.id === id)
  if (!source) throw Error('Unknown historical access source.')
  return source
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}
function text(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 500 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    throw Error(`Invalid ${label}.`)
  return value.trim()
}
function code(value: unknown, label: string): string | undefined {
  const result = text(value, label)
  if (result !== undefined && !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(result))
    throw Error(`Invalid ${label}; preserve the source identifier as text.`)
  return result
}
function numericId(value: unknown, label: string): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    !/^\d{1,15}$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  )
    throw Error(`${label} must be a positive integer identifier.`)
  return String(Number(value))
}
function calendarDate(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (typeof value !== 'string' && typeof value !== 'number') throw Error(`Invalid ${label}.`)
  if (typeof value === 'number' && !Number.isFinite(value)) throw Error(`Invalid ${label}.`)
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) throw Error(`Invalid ${label}.`)
  const result = date.toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || result < '1800-01-01' || result > '2200-12-31')
    throw Error(`Invalid ${label}.`)
  if (typeof value === 'string' && (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || value.slice(0, 10) !== result))
    throw Error(`Invalid ${label}; use an actual ISO calendar date.`)
  return result
}
function retrievedDate(value: string): string {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value))
    throw Error('Source retrieval time must be an ISO timestamp.')
  calendarDate(value, 'retrieval date')
  return value
}
function collection(raw: unknown, maxRecords: number, label: string): Record<string, unknown>[] {
  const response = object(raw, label)
  if (response.error) {
    const error = object(response.error, 'Service error')
    throw Error(text(error.message, 'service error message') ?? `${label} query failed.`)
  }
  const properties = response.properties == null ? undefined : object(response.properties, 'Response properties')
  if (response.exceededTransferLimit || properties?.exceededTransferLimit)
    throw Error(`${label} was truncated; no partial records were accepted.`)
  if (!Array.isArray(response.features)) throw Error(`${label} did not return a feature collection.`)
  if (response.features.length > maxRecords) throw Error(`${label} exceeds ${maxRecords} records; narrow the query.`)
  return response.features.map((feature) => object(feature, `${label} feature`))
}
function attributes(feature: Record<string, unknown>): Record<string, unknown> {
  return object(feature.properties ?? feature.attributes, 'Source attributes')
}

export function buildBcBlockIdentityQuery(openingId: string, source: BlockIdentitySource): string {
  const id = numericId(openingId, 'Opening ID')
  if (source !== 'results-opening' && source !== 'ften-cutblock') throw Error('Unknown block identity source.')
  const fields =
    source === 'results-opening'
      ? 'OPENING_ID,FOREST_FILE_ID,CUTTING_PERMIT_ID,CUT_BLOCK_ID,TIMBER_MARK,CLIENT_NUMBER,DISTURBANCE_START_DATE,DISTURBANCE_END_DATE'
      : 'CUT_BLOCK_SKEY,OPENING_ID,HARVEST_AUTH_FOREST_FILE_ID,HARVEST_AUTH_CUTTING_PERMIT_ID,CUT_BLOCK_ID,TIMBER_MARK,CLIENT_NUMBER,LIFE_CYCLE_STATUS_CODE,DISTURBANCE_START_DATE,DISTURBANCE_END_DATE'
  const params = new URLSearchParams({
    f: 'json',
    where: `OPENING_ID=${id}`,
    outFields: fields,
    returnGeometry: 'false',
    resultRecordCount: String(MAX_BLOCK_IDENTITY_RECORDS + 1),
  })
  // Avoid an unnecessary server sort for the exact RESULTS identity lookup; duplicate identities still fail parsing.
  if (source === 'ften-cutblock') params.set('orderByFields', 'CUT_BLOCK_SKEY')
  return `${definition(source).serviceUrl}/query?${params}`
}

export function parseBcBlockIdentityRecords(
  raw: unknown,
  source: BlockIdentitySource,
  openingId: string,
  retrievedAt = new Date().toISOString(),
): BlockIdentityRecord[] {
  const requestedId = numericId(openingId, 'Opening ID')
  const sourceDefinition = definition(source)
  if (source !== 'results-opening' && source !== 'ften-cutblock') throw Error('Unknown block identity source.')
  retrievedDate(retrievedAt)
  const records = collection(raw, MAX_BLOCK_IDENTITY_RECORDS, sourceDefinition.name).map((feature) => {
    const p = attributes(feature)
    const returnedId = numericId(p.OPENING_ID, 'Returned opening ID')
    if (returnedId !== requestedId)
      throw Error('The source returned another opening; no identity records were accepted.')
    const cutblockSKey = source === 'ften-cutblock' ? numericId(p.CUT_BLOCK_SKEY, 'Cutblock key') : undefined
    const record: BlockIdentityRecord = {
      id: `${source}:${cutblockSKey ?? returnedId}`,
      source,
      sourceUrl: sourceDefinition.catalogueUrl,
      retrievedAt,
      openingId: returnedId,
      ...(cutblockSKey ? { cutblockSKey } : {}),
    }
    const mapped = {
      forestFileId: source === 'results-opening' ? p.FOREST_FILE_ID : p.HARVEST_AUTH_FOREST_FILE_ID,
      cuttingPermitId: source === 'results-opening' ? p.CUTTING_PERMIT_ID : p.HARVEST_AUTH_CUTTING_PERMIT_ID,
      cutBlockId: p.CUT_BLOCK_ID,
      timberMark: p.TIMBER_MARK,
      clientNumber: p.CLIENT_NUMBER,
    }
    for (const [key, value] of Object.entries(mapped)) {
      const parsed = code(value, key)
      if (parsed !== undefined) record[key as keyof typeof mapped] = parsed
    }
    const status = code(p.LIFE_CYCLE_STATUS_CODE, 'cutblock lifecycle status')
    if (status) record.lifecycleStatus = status
    const start = calendarDate(p.DISTURBANCE_START_DATE, 'disturbance start date')
    const end = calendarDate(p.DISTURBANCE_END_DATE, 'disturbance end date')
    if (start && end && start > end) throw Error('Disturbance end date precedes the start date.')
    if (start) record.disturbanceStartDate = start
    if (end) record.disturbanceEndDate = end
    return record
  })
  if (new Set(records.map((record) => record.id)).size !== records.length)
    throw Error('Duplicate source identities require review; no rows were silently dropped.')
  return records
}

/** Keep unpaired records; compare supporting business codes instead of silently accepting conflicts. */
export function combineBlockIdentityRecords(
  openingId: string,
  records: readonly BlockIdentityRecord[],
  retrievedAt = new Date().toISOString(),
): BlockIdentityLookup {
  const id = numericId(openingId, 'Opening ID')
  retrievedDate(retrievedAt)
  if (records.length > MAX_BLOCK_IDENTITY_RECORDS * 2) throw Error('Too many identity records.')
  if (records.some((record) => record.openingId !== id)) throw Error('Cannot join records from different openings.')
  if (new Set(records.map((record) => record.id)).size !== records.length) throw Error('Duplicate source identities.')
  const results = records.filter((record) => record.source === 'results-opening')
  const ften = records.filter((record) => record.source === 'ften-cutblock')
  const fields = ['forestFileId', 'cuttingPermitId', 'cutBlockId', 'timberMark', 'clientNumber'] as const
  return {
    openingId: id,
    retrievedAt,
    records: [...records],
    matches: results.flatMap((result) =>
      ften.map((tenure) => ({
        resultsRecordId: result.id,
        ftenRecordId: tenure.id,
        basis: 'opening-id' as const,
        conflicts: fields.flatMap((field) =>
          result[field] !== undefined && tenure[field] !== undefined && result[field] !== tenure[field]
            ? [{ field, resultsValue: result[field]!, ftenValue: tenure[field]! }]
            : [],
        ),
      })),
    ),
    missingSources: (['results-opening', 'ften-cutblock'] as const).filter(
      (source) => !records.some((record) => record.source === source),
    ),
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Source loading cancelled.', 'AbortError')
}
async function boundedJson(url: string, signal: AbortSignal, limit: number): Promise<unknown> {
  throwIfAborted(signal)
  const response = await fetch(url, { signal })
  if (!response.ok)
    throw Error(`BC source request failed (${response.status}); current project evidence was not changed.`)
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw Error('BC source response is too large; narrow the query.')
  }
  const reader = response.body?.getReader()
  if (!reader) throw Error('The BC source returned an empty response.')
  const decoder = new TextDecoder()
  let count = 0
  let body = ''
  const cancel = () => {
    void reader.cancel().catch(() => undefined)
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      throwIfAborted(signal)
      const { value, done } = await reader.read()
      throwIfAborted(signal)
      if (done) break
      count += value.byteLength
      if (count > limit) {
        await reader.cancel()
        throw Error('BC source response is too large; narrow the query.')
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
  } finally {
    signal.removeEventListener('abort', cancel)
    reader.releaseLock()
  }
  throwIfAborted(signal)
  return JSON.parse(body)
}
async function sourceRequest<T>(signal: AbortSignal | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  throwIfAborted(signal)
  const controller = new AbortController()
  const cancel = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new DOMException('BC source request timed out; try a smaller query.', 'TimeoutError')),
    ACCESS_SOURCE_TIMEOUT_MS,
  )
  try {
    const result = await run(controller.signal)
    throwIfAborted(controller.signal)
    return result
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', cancel)
    controller.abort()
  }
}

export async function loadBcBlockIdentity(openingId: string, signal?: AbortSignal): Promise<BlockIdentityLookup> {
  const id = numericId(openingId, 'Opening ID')
  return sourceRequest(signal, async (requestSignal) => {
    const retrievedAt = new Date().toISOString()
    const sources: BlockIdentitySource[] = ['results-opening', 'ften-cutblock']
    const records = await Promise.all(
      sources.map(async (source) =>
        parseBcBlockIdentityRecords(
          await boundedJson(buildBcBlockIdentityQuery(id, source), requestSignal, MAX_IDENTITY_RESPONSE_BYTES),
          source,
          id,
          retrievedAt,
        ),
      ),
    )
    return combineBlockIdentityRecords(id, records.flat(), retrievedAt)
  })
}

/** A content label, not a cryptographic signature; import still compares complete records on an ID collision. */
function sourceVersion(value: unknown): string {
  const serialized = JSON.stringify(value)
  let first = 2166136261,
    second = 5381
  for (let i = 0; i < serialized.length; i++) {
    const character = serialized.charCodeAt(i)
    first = Math.imul(first ^ character, 16777619)
    second = Math.imul(second, 33) ^ character
  }
  return `${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`
}

export function blockIdentitySources(lookup: BlockIdentityLookup): HistoricalSource[] {
  const missing = lookup.missingSources.length
    ? `No record returned from ${[...lookup.missingSources].sort().join(', ')}; this is not evidence of absence.`
    : 'Both queried datasets returned records.'
  if (!lookup.records.length) {
    const description = `Opening ${lookup.openingId}: the bounded RESULTS and FTEN identity lookup returned no records. ${missing} No road service or construction purpose established.`
    return [
      {
        id: `opening-identity-query:${lookup.openingId}:v${sourceVersion(description)}`,
        dataset: 'BC opening identity lookup',
        recordId: lookup.openingId,
        url: definition('results-opening').catalogueUrl,
        retrievedAt: lookup.retrievedAt,
        publishedOn: null,
        description,
        synthetic: false,
      },
    ]
  }
  return lookup.records.map((record) => {
    const blockIdentity: HistoricalBlockIdentity = {
      entityId: record.id,
      source: record.source,
      openingId: record.openingId,
      ...(record.cutblockSKey ? { cutblockSKey: record.cutblockSKey } : {}),
      ...(record.forestFileId ? { forestFileId: record.forestFileId } : {}),
      ...(record.cuttingPermitId ? { cuttingPermitId: record.cuttingPermitId } : {}),
      ...(record.cutBlockId ? { cutBlockId: record.cutBlockId } : {}),
      ...(record.timberMark ? { timberMark: record.timberMark } : {}),
      ...(record.clientNumber ? { clientNumber: record.clientNumber } : {}),
      ...(record.lifecycleStatus ? { lifecycleStatus: record.lifecycleStatus } : {}),
      ...(record.disturbanceStartDate ? { disturbanceStartDate: record.disturbanceStartDate } : {}),
      ...(record.disturbanceEndDate ? { disturbanceEndDate: record.disturbanceEndDate } : {}),
    }
    const matches = lookup.matches
      .filter((match) => match.resultsRecordId === record.id || match.ftenRecordId === record.id)
      .sort((a, b) => `${a.resultsRecordId}|${a.ftenRecordId}`.localeCompare(`${b.resultsRecordId}|${b.ftenRecordId}`))
    const conflictingFields = [
      ...new Set(matches.flatMap((match) => match.conflicts.map((conflict) => conflict.field))),
    ].sort()
    const description = [
      `Entity ${record.id}; opening ${record.openingId}`,
      `licence ${record.forestFileId ?? 'unknown'}`,
      `cutting permit ${record.cuttingPermitId ?? 'unknown'}`,
      `block ${record.cutBlockId ?? 'unknown'}`,
      `timber mark ${record.timberMark ?? 'unknown'}`,
      `client ${record.clientNumber ?? 'unknown'}`,
      `reported disturbance ${record.disturbanceStartDate ?? 'unknown'} to ${record.disturbanceEndDate ?? 'unknown'}`,
      `administrative lifecycle ${record.lifecycleStatus ?? 'unknown'}`,
      `${matches.length} exact opening-ID counterpart(s)`,
      conflictingFields.length
        ? `Supporting business-key conflicts: ${conflictingFields.join(', ')}. Each source snapshot retains its reported values; no automatic resolution.`
        : 'No disagreement among the supporting business keys present in matched records; missing keys are not confirmed matches.',
      missing,
      'Administrative identity only; no road service or construction purpose established.',
    ].join(' · ')
    const snapshot = {
      dataset: definition(record.source).name,
      recordId: record.cutblockSKey ?? record.openingId,
      url: record.sourceUrl,
      publishedOn: null,
      description,
      synthetic: false,
      blockIdentity,
    }
    return {
      ...snapshot,
      id: `${record.id}:v${sourceVersion({ snapshot, matches, missing })}`,
      retrievedAt: record.retrievedAt,
    }
  })
}

export function buildBcRoadSegmentsQuery(bounds: RoadQueryBounds): string {
  // Reuse the same geographic extent checks as the existing local-road query.
  const url = new URL(buildBcRoadsQuery(bounds))
  const params = url.searchParams
  params.set(
    'outFields',
    'OBJECTID,FOREST_FILE_ID,ROAD_SECTION_ID,START_STATION,END_STATION,TIMBER_MARK,CLIENT_NUMBER,FILE_TYPE_CODE,FILE_STATUS_CODE,LIFE_CYCLE_STATUS_CODE,RETIREMENT_DATE',
  )
  return `${definition('ften-road-segment').serviceUrl}/query?${params}`
}
export function parseBcRoadSegments(raw: unknown, retrievedAt = new Date().toISOString()): ContextFeature[] {
  retrievedDate(retrievedAt)
  const source = definition('ften-road-segment')
  const features = collection(raw, MAX_EXISTING_ROADS, source.name).map((feature) => {
    const p = attributes(feature)
    const identifiers = sourceRoadIdentifiers(p)
    if (!identifiers.forestFileId || !identifiers.roadSectionId)
      throw Error('FTEN road segment is missing its forest file or section identifier.')
    const objectId = numericId(p.OBJECTID, 'Road segment source row ID')
    const retirementDate = calendarDate(p.RETIREMENT_DATE, 'tenure retirement date')
    const fileTypeCode = code(p.FILE_TYPE_CODE, 'road file type')
    const lifecycleStatus = code(p.LIFE_CYCLE_STATUS_CODE, 'road lifecycle status')
    const status = [lifecycleStatus, code(p.FILE_STATUS_CODE, 'road file status')].filter(Boolean).join(' / ')
    return {
      ...feature,
      type: 'Feature',
      properties: {
        name: `${identifiers.forestFileId} · ${identifiers.roadSectionId}`,
        roadEvidence: {
          ...unreviewedRoadEvidence('bc-ften'),
          ...identifiers,
          sourceId: `ften-road-segment:${objectId}`,
          sourceUrl: source.catalogueUrl,
          retrievedAt,
          ...(fileTypeCode ? { fileTypeCode } : {}),
          ...(fileTypeCode === 'B40' ? { roadClass: 'fsr' } : fileTypeCode === 'B01' ? { roadClass: 'permit' } : {}),
          ...(lifecycleStatus ? { lifecycleStatus } : {}),
          ...(status ? { status } : {}),
          ...(retirementDate ? { retirementDate } : {}),
        },
      },
    }
  })
  if (new Set(features.map((feature) => feature.properties.roadEvidence.sourceId)).size !== features.length)
    throw Error('Duplicate FTEN road segment source rows require review.')
  if (!features.length) return []
  const roads = importExistingRoads({ type: 'FeatureCollection', features })
  const parts = new Map<string, number>()
  return roads.map((road) => {
    const sourceId = road.roadEvidence!.sourceId!
    const part = parts.get(sourceId) ?? 0
    parts.set(sourceId, part + 1)
    return { ...road, id: `${sourceId.replace(':', '-')}-${part}` }
  })
}
export function loadBcRoadSegments(bounds: RoadQueryBounds, signal?: AbortSignal): Promise<ContextFeature[]> {
  const url = buildBcRoadSegmentsQuery(bounds)
  return sourceRequest(signal, async (requestSignal) =>
    parseBcRoadSegments(await boundedJson(url, requestSignal, MAX_ROAD_RESPONSE_BYTES)),
  )
}
export function roadSegmentSources(roads: readonly ContextFeature[]): HistoricalSource[] {
  const sources = new Map<string, HistoricalSource>()
  for (const road of roads) {
    const evidence = road.roadEvidence
    if (!evidence?.sourceId?.startsWith('ften-road-segment:') || !evidence.retrievedAt) continue
    sources.set(evidence.sourceId, {
      id: evidence.sourceId,
      dataset: definition('ften-road-segment').name,
      recordId: evidence.sourceId.slice('ften-road-segment:'.length),
      url: definition('ften-road-segment').catalogueUrl,
      retrievedAt: evidence.retrievedAt,
      publishedOn: null,
      description: `${evidence.forestFileId} / ${evidence.roadSectionId}. Tenure linework; construction date, current condition and original block served are unknown.`,
      synthetic: false,
    })
  }
  return [...sources.values()]
}

function coordinate(raw: unknown): Coordinate {
  const geometry = object(raw, 'Structure geometry')
  const c = geometry.coordinates
  if (
    geometry.type !== 'Point' ||
    !Array.isArray(c) ||
    c.length !== 2 ||
    c.some((value) => typeof value !== 'number' || !Number.isFinite(value)) ||
    Math.abs(c[0]) > 180 ||
    Math.abs(c[1]) >= 85
  )
    throw Error('Import structures as WGS84 GeoJSON points with longitude and latitude.')
  return [c[0], c[1]]
}
function distanceToRoad(point: Coordinate, road: ContextFeature): number {
  if (road.geometry.type !== 'LineString') return Infinity
  const sx = 111_320 * Math.cos((point[1] * Math.PI) / 180),
    sy = 111_320
  let minimum = Infinity
  const coordinates = road.geometry.coordinates
  for (let i = 1; i < coordinates.length; i++) {
    const a = coordinates[i - 1],
      b = coordinates[i]
    const ax = (a[0] - point[0]) * sx,
      ay = (a[1] - point[1]) * sy
    const dx = (b[0] - a[0]) * sx,
      dy = (b[1] - a[1]) * sy
    const length2 = dx * dx + dy * dy
    const t = length2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / length2)) : 0
    minimum = Math.min(minimum, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return minimum
}

/** Local import only. Rights to access a public viewer do not grant rights to rehost its records. */
export function importHistoricalStructures(
  raw: unknown,
  source: 'mof-structures' | 'pscis',
  options: { retrievedAt?: string; context?: readonly ContextFeature[] } = {},
): { sources: HistoricalSource[]; structures: HistoricalStructure[]; warnings: string[] } {
  if (source !== 'mof-structures' && source !== 'pscis') throw Error('Choose a supported structure import source.')
  if (typeof raw === 'string') {
    if (new TextEncoder().encode(raw).byteLength > MAX_STRUCTURE_IMPORT_BYTES)
      throw Error('Import at most 5 MB of structure GeoJSON.')
    raw = JSON.parse(raw)
  }
  const input = object(raw, 'Structure import')
  if (input.crs !== undefined)
    throw Error('Reproject structure GeoJSON to WGS84 and remove its legacy CRS declaration.')
  const features = collection(input, MAX_IMPORTED_STRUCTURES, 'Structure import')
  const retrievedAt = retrievedDate(options.retrievedAt ?? new Date().toISOString())
  const sources: HistoricalSource[] = [],
    structures: HistoricalStructure[] = [],
    warnings: string[] = []
  const ids = new Set<string>()
  for (const feature of features) {
    if (feature.crs !== undefined || object(feature.geometry, 'Structure geometry').crs !== undefined)
      throw Error('Per-feature structure CRS is not supported; reproject to WGS84.')
    const p = attributes(feature)
    const siteType = text(p.CROSSING_SITE_TYPE_CODE, 'crossing site type')
    const siteDescription = text(p.CROSSING_SITE_TYPE_DESC, 'crossing site description')?.toLowerCase()
    if (
      source === 'mof-structures' &&
      ((siteType && siteType !== 'CRS') || ['recreation', 'storage'].includes(siteDescription ?? ''))
    ) {
      warnings.push(`A ${siteType ?? siteDescription} site was excluded; it is not identified as a road crossing.`)
      continue
    }
    const crossingConfirmed = source === 'pscis' || siteType === 'CRS' || siteDescription === 'crossing'
    const row = numericId(source === 'mof-structures' ? p.RRI_BMC_SP_SYSID : p.ASSESSMENT_ID, 'Structure source row ID')
    const id = `${source}:${row}`
    if (ids.has(id))
      throw Error(
        'Duplicate structure source rows require review; crossing sites may have multiple distinct structures.',
      )
    ids.add(id)
    const point = coordinate(feature.geometry)
    const siteId = source === 'mof-structures' ? p.CROSSING_SITE_ID : p.STREAM_CROSSING_ID
    const rawCrossingSiteId = siteId === undefined || siteId === null ? null : numericId(siteId, 'Crossing site ID')
    const rawStructureId =
      text(
        source === 'mof-structures' ? p.CROSSING_STRUCTURE_NAME : p.EXTERNAL_CROSSING_REFERENCE,
        'structure identifier',
      ) ?? null
    // Different inventories use unrelated ID domains; equal numbers never identify the same crossing by themselves.
    const namespace = source === 'mof-structures' ? 'rri' : 'pscis'
    const crossingSiteId = rawCrossingSiteId ? `${namespace}:${rawCrossingSiteId}` : null
    const structureId = rawStructureId ? `${namespace}:${rawStructureId}` : null
    if (structureId && structureId.length > 200) throw Error('A structure identifier supports at most 200 characters.')
    const forestFileId = source === 'mof-structures' ? code(p.FOREST_FILE_ID, 'forest file identifier') : undefined
    const roadSectionId = source === 'mof-structures' ? code(p.ROAD_SECTION_ID, 'road section identifier') : undefined
    const roadKey = forestFileId && roadSectionId ? { forestFileId, roadSectionId } : null
    const matches = roadKey
      ? (options.context ?? []).filter(
          (road) =>
            road.kind === 'existing-road' &&
            road.roadEvidence?.forestFileId === roadKey.forestFileId &&
            road.roadEvidence?.roadSectionId === roadKey.roadSectionId,
        )
      : []
    const attached =
      crossingConfirmed && matches.length === 1 && distanceToRoad(point, matches[0]) <= 25 ? matches[0] : null
    const kindCode = text(
      source === 'mof-structures' ? p.STRUCTURE_TYPE_CLASS_CODE : p.CROSSING_SUBTYPE_CODE,
      'structure type',
    )?.toUpperCase()
    const kind: HistoricalStructure['kind'] =
      kindCode && ['PB', 'TB', 'BRIDGE'].includes(kindCode)
        ? 'bridge'
        : kindCode &&
            ['CUL', 'WLC', 'PIPE ARCH', 'WOOD BOX CULVERT', 'ROUND CULVERT', 'OVAL CULVERT'].includes(kindCode)
          ? 'culvert'
          : kindCode === 'FORD'
            ? 'ford'
            : 'unknown'
    const inspected = calendarDate(
      source === 'mof-structures' ? p.LAST_INSPECTION_DATE : p.ASSESSMENT_DATE,
      'structure inspection/assessment date',
    )
    const structure: HistoricalStructure = {
      id,
      name: rawStructureId ?? `Imported ${kind} ${row}`,
      kind,
      coordinate: point,
      sourceIds: [id],
      crossingSiteId,
      structureId,
      sourceRowId: row,
      roadKey,
      roadId: attached?.id ?? null,
      attachment: attached ? 'identifier-match' : 'unresolved',
      attachmentToleranceM: 25,
      construction: null,
      removal: null,
      evidence: [],
    }
    const rating = p.CURRENT_LOAD_RATING
    if (source === 'mof-structures' && rating !== undefined && rating !== null) {
      if (typeof rating !== 'number' || !Number.isFinite(rating) || rating < 0 || rating > 1000)
        throw Error('Structure load rating must be between 0 and 1000 tonnes.')
      structure.evidence.push({
        id: `${id}:rating`,
        sourceIds: [id],
        kind: 'load-rating',
        validFrom: null,
        validUntil: null,
        ratedLoadTonnes: rating,
        description: `Source current gross vehicle weight rating, retrieved ${retrievedAt.slice(0, 10)}. Effective period unknown; not historical capacity evidence.`,
      })
    }
    if (source === 'mof-structures' && ['BAR', 'DAC'].includes(String(p.CROSSING_SITE_STATUS_CODE)))
      structure.evidence.push({
        id: `${id}:status`,
        sourceIds: [id],
        kind: 'closure',
        validFrom: null,
        validUntil: null,
        ratedLoadTonnes: null,
        description: `Source site status ${String(p.CROSSING_SITE_STATUS_CODE)}; event date unknown.`,
      })
    const fishBarrier =
      source === 'pscis'
        ? text(p.CURRENT_BARRIER_DESCRIPTION ?? p.BARRIER_RESULT_DESCRIPTION, 'fish passage result')
        : undefined
    sources.push({
      id,
      dataset: definition(source).name,
      recordId: row,
      url: definition(source).catalogueUrl,
      retrievedAt,
      publishedOn: null,
      synthetic: false,
      description: [
        'User-provided source extract; applicable Access Only terms remain in force.',
        `Source row ${row}; crossing site ${rawCrossingSiteId ?? 'unknown'}; structure identifier ${rawStructureId ?? 'unknown'}. Identifiers are namespaced by inventory in the project.`,
        inspected &&
          `Reported ${source === 'mof-structures' ? 'inspection' : 'fish-passage assessment'} date ${inspected}; not a construction or rating-effective date.`,
        fishBarrier && `Fish passage: ${fishBarrier}. This is not a vehicle closure.`,
        'Construction and removal dates are unknown.',
      ]
        .filter(Boolean)
        .join(' '),
    })
    structures.push(structure)
    if (!crossingConfirmed)
      warnings.push(`${structure.name}: the extract does not identify this site as a road crossing.`)
    else if (!attached)
      warnings.push(
        `${structure.name}: no unique nearby road with both matching permit and section identifiers; attachment requires review.`,
      )
  }
  return { sources, structures, warnings }
}
