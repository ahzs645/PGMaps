/**
 * Open an FTEN cutblock that has no RESULTS opening ID as the start of a design.
 *
 * About one FTEN block in six has no opening ID: most are blocks planned in a cutting permit before harvest is
 * reported. The access-history study needs an opening to cross-check, so these blocks are loaded here by their
 * FTEN spatial key instead, with nearby FTEN road segments as candidates. Nothing here establishes that the block is
 * authorized, will be harvested, or is served by any of the returned roads.
 */
import type { ContextFeature, Coordinate } from './types'
import {
  ACCESS_HISTORY_SOURCES,
  MAX_ACCESS_SOURCE_TIMEOUT_MS,
  MAX_BC_OPENING_POLYGON_BYTES,
  MAX_BC_OPENING_POLYGONS,
  MAX_BC_OPENING_VERTICES,
  buildBcRoadSegmentsQuery,
  loadBcRoadSegments,
  requestBcAccessSourceJson,
} from './accessHistorySources'
import { businessCode, calendarDate } from './bcAccessSearch'
import { existingRoadQueryBounds, type RoadQueryBounds } from './existingRoads'
import { importContextGeoJson } from './project'

export const BC_PLANNED_BLOCK_ROAD_BUFFER_M = 1000
export const BC_PLANNED_BLOCK_MAX_ROADS = 250
export const BC_PLANNED_BLOCK_MAX_VERTICES = 30_000
export const BC_PLANNED_BLOCK_TIMEOUT_MS = 65_000

const source = ACCESS_HISTORY_SOURCES.find((entry) => entry.id === 'ften-cutblock')!
const FIELDS = [
  'CUT_BLOCK_SKEY',
  'OPENING_ID',
  'HARVEST_AUTH_FOREST_FILE_ID',
  'HARVEST_AUTH_CUTTING_PERMIT_ID',
  'CUT_BLOCK_ID',
  'TIMBER_MARK',
  'CLIENT_NUMBER',
  'LIFE_CYCLE_STATUS_CODE',
  'BLOCK_STATUS_CODE',
  'BLOCK_STATUS_DATE',
  'HARVEST_AUTH_STATUS_CODE',
  'PLANNED_HARVEST_DATE',
  'PLANNED_GROSS_BLOCK_AREA',
  'PLANNED_NET_BLOCK_AREA',
  'DISTURBANCE_START_DATE',
  'DISTURBANCE_END_DATE',
]

export interface BcPlannedBlockRecord {
  /** `ften-cutblock:<CUT_BLOCK_SKEY>`, the same identity the search and the access study use. */
  id: string
  cutblockSKey: string
  /** A zero or negative source value, kept as reported; a positive opening uses the access study instead. */
  reportedOpeningId?: string
  forestFileId?: string
  cuttingPermitId?: string
  cutBlockId?: string
  timberMark?: string
  clientNumber?: string
  lifecycleStatus?: string
  /** FTA codes kept as reported; this module does not translate them into a harvest or authorization state. */
  blockStatusCode?: string
  blockStatusDate?: string
  harvestAuthStatusCode?: string
  plannedHarvestDate?: string
  plannedGrossAreaHa?: number
  plannedNetAreaHa?: number
  disturbanceStartDate?: string
  disturbanceEndDate?: string
  requestUrl: string
  retrievedAt: string
}

export interface BcPlannedBlockResult {
  record: BcPlannedBlockRecord
  blocks: ContextFeature[]
  roads: ContextFeature[]
  bounds: RoadQueryBounds
  roadsQueryUrl: string
  retrievedAt: string
  /** Plain-language gaps the project keeps as scenario warnings. */
  warnings: string[]
}

function cutblockKey(value: unknown): string {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    !/^\d{1,15}$/.test(String(value).trim()) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) <= 0
  )
    throw Error('The cutblock key must be a positive integer.')
  return String(Number(value))
}

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  return value as Record<string, unknown>
}

function area(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100_000)
    throw Error(`Invalid ${label}.`)
  return Math.round(value * 100) / 100
}

export function buildBcPlannedBlockQuery(cutblockSKey: string): string {
  const key = cutblockKey(cutblockSKey)
  return `${source.serviceUrl}/query?${new URLSearchParams({
    f: 'geojson',
    where: `CUT_BLOCK_SKEY=${key}`,
    outFields: FIELDS.join(','),
    returnGeometry: 'true',
    outSR: '4326',
    resultRecordCount: '2',
  })}`
}

/** One record, the one asked for, with polygon geometry; anything else is refused rather than partly accepted. */
export function parseBcPlannedBlock(
  raw: unknown,
  cutblockSKey: string,
  retrievedAt = new Date().toISOString(),
): { record: BcPlannedBlockRecord; blocks: ContextFeature[] } {
  const key = cutblockKey(cutblockSKey)
  const response = object(raw, 'FTEN cutblock response')
  if (response.error) {
    const error = object(response.error, 'FTEN cutblock service error')
    throw Error(typeof error.message === 'string' ? error.message.slice(0, 500) : 'The FTEN cutblock request failed.')
  }
  if (response.type !== 'FeatureCollection' || response.crs !== undefined || !Array.isArray(response.features))
    throw Error('The FTEN cutblock request must return a WGS84 GeoJSON feature collection.')
  if (!response.features.length)
    throw Error(`No FTEN cutblock record has key ${key}. It may have been retired or replaced; search again.`)
  if (response.features.length > 1) throw Error(`The FTEN source returned more than one record for key ${key}.`)
  const feature = object(response.features[0], 'FTEN cutblock feature')
  const p = object(feature.properties, 'FTEN cutblock attributes')
  if (cutblockKey(p.CUT_BLOCK_SKEY) !== key) throw Error('The FTEN source returned a different cutblock.')
  const opening = p.OPENING_ID
  if (opening !== null && opening !== undefined) {
    if (!/^-?\d{1,15}$/.test(String(opening))) throw Error('The source reported an invalid opening identifier.')
    if (Number(opening) > 0)
      throw Error(`This cutblock has RESULTS opening ${Number(opening)}. Open its study instead.`)
  }
  const record: BcPlannedBlockRecord = {
    id: `ften-cutblock:${key}`,
    cutblockSKey: key,
    ...(opening !== null && opening !== undefined ? { reportedOpeningId: String(Number(opening)) } : {}),
    requestUrl: buildBcPlannedBlockQuery(key),
    retrievedAt,
  }
  const codes = {
    forestFileId: 'HARVEST_AUTH_FOREST_FILE_ID',
    cuttingPermitId: 'HARVEST_AUTH_CUTTING_PERMIT_ID',
    cutBlockId: 'CUT_BLOCK_ID',
    timberMark: 'TIMBER_MARK',
    clientNumber: 'CLIENT_NUMBER',
    lifecycleStatus: 'LIFE_CYCLE_STATUS_CODE',
    blockStatusCode: 'BLOCK_STATUS_CODE',
    harvestAuthStatusCode: 'HARVEST_AUTH_STATUS_CODE',
  } as const
  for (const [field, name] of Object.entries(codes)) {
    const value = businessCode(p[name], field)
    if (value) record[field as keyof typeof codes] = value
  }
  const dates = {
    blockStatusDate: ['BLOCK_STATUS_DATE', 'block status date'],
    plannedHarvestDate: ['PLANNED_HARVEST_DATE', 'planned harvest date'],
    disturbanceStartDate: ['DISTURBANCE_START_DATE', 'reported harvest start'],
    disturbanceEndDate: ['DISTURBANCE_END_DATE', 'reported harvest completion'],
  } as const
  for (const [field, [name, label]] of Object.entries(dates)) {
    const value = calendarDate(p[name], label)
    if (value) record[field as keyof typeof dates] = value
  }
  if (
    record.disturbanceStartDate &&
    record.disturbanceEndDate &&
    record.disturbanceStartDate > record.disturbanceEndDate
  )
    throw Error('Reported harvest completion precedes start.')
  const gross = area(p.PLANNED_GROSS_BLOCK_AREA, 'planned gross block area')
  const net = area(p.PLANNED_NET_BLOCK_AREA, 'planned net block area')
  if (gross !== undefined) record.plannedGrossAreaHa = gross
  if (net !== undefined) record.plannedNetAreaHa = net

  const geometry = object(feature.geometry, 'FTEN cutblock geometry')
  if (geometry.type !== 'Polygon' && geometry.type !== 'MultiPolygon')
    throw Error('The FTEN cutblock must have polygon geometry.')
  if (geometry.crs !== undefined || feature.crs !== undefined) throw Error('The FTEN cutblock must use WGS84.')
  const harvested = !!(record.disturbanceStartDate || record.disturbanceEndDate)
  const label = record.cutBlockId ?? key
  const facts = [
    'FTEN cutblock polygon with no RESULTS opening ID',
    record.blockStatusCode ? `Block status ${record.blockStatusCode}` : 'Block status not reported',
    record.plannedHarvestDate ? `planned harvest ${record.plannedHarvestDate}` : '',
    gross !== undefined ? `planned gross area ${gross} ha` : '',
  ]
    .filter(Boolean)
    .join('; ')
  const blocks = importContextGeoJson({
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        id: record.id,
        geometry,
        properties: {
          name: `FTEN block ${label} · no opening ID`,
          kind: 'harvest',
          harvestEvidence: {
            source: 'bc-ften',
            // A proposed block may not carry harvest dates, so a reported start keeps the block as harvested.
            status: harvested ? 'harvested' : 'proposed',
            sourceId: record.id,
            sourceUrl: record.requestUrl,
            retrievedAt,
            dataSource: `${facts}. A tenure footprint, not a harvest authorization or an access route.`,
            yearMethod: record.disturbanceEndDate
              ? 'estimated-range'
              : record.disturbanceStartDate
                ? 'start-only'
                : 'unknown',
            ...(record.disturbanceStartDate ? { startDate: record.disturbanceStartDate } : {}),
            ...(record.disturbanceEndDate ? { endDate: record.disturbanceEndDate } : {}),
            ...(gross !== undefined ? { areaHectares: gross } : {}),
          },
        },
      },
    ],
  })
  if (blocks.length > MAX_BC_OPENING_POLYGONS)
    throw Error(`The cutblock has more than ${MAX_BC_OPENING_POLYGONS} polygon parts; it was not loaded.`)
  const vertices = blocks.reduce(
    (total, block) =>
      total +
      (block.geometry.type === 'Polygon'
        ? block.geometry.coordinates.reduce((count, ring) => count + ring.length, 0)
        : 0),
    0,
  )
  if (vertices > MAX_BC_OPENING_VERTICES)
    throw Error(`The cutblock has more than ${MAX_BC_OPENING_VERTICES} vertices; it was not loaded.`)
  return { record, blocks }
}

function plannedBlockWarnings(record: BcPlannedBlockRecord, roads: readonly ContextFeature[]): string[] {
  const status = [
    record.blockStatusCode && `block status ${record.blockStatusCode}`,
    record.harvestAuthStatusCode && `harvest authority status ${record.harvestAuthStatusCode}`,
    record.lifecycleStatus && `lifecycle ${record.lifecycleStatus}`,
  ]
    .filter(Boolean)
    .join(', ')
  return [
    `FTEN block ${record.cutBlockId ?? record.cutblockSKey} has no RESULTS opening ID, so there is no opening to cross-check and no access-history study. The source reports ${status || 'no status'}; that is tenure administration, not confirmation that the block is authorized, will be harvested or has usable access.`,
    roads.length
      ? `${roads.length} FTEN road segment part(s) lie within about ${BC_PLANNED_BLOCK_ROAD_BUFFER_M / 1000} km of the block. Proximity is a candidate connection, not a reviewed entrance, a continuous route or permission to use the road.`
      : `No FTEN road segment was returned within about ${BC_PLANNED_BLOCK_ROAD_BUFFER_M / 1000} km of the block. That is not evidence that no road exists; check FTEN, the licensee's plans and imagery.`,
    'Forest Operations Map (FOM) planned blocks and roads were not queried. A FOM filing for this block can differ in boundary, version and planned roads; reconcile it by its FOM ID, not by the block label.',
  ]
}

/** Atomic: the block, then the roads around it. A failure or timeout returns nothing. */
export async function loadBcPlannedBlock(cutblockSKey: string, signal?: AbortSignal): Promise<BcPlannedBlockResult> {
  const key = cutblockKey(cutblockSKey)
  if (signal?.aborted) throw signal.reason ?? new DOMException('Loading cancelled.', 'AbortError')
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(
    () => controller.abort(new DOMException('Loading the BC cutblock timed out; nothing was opened.', 'TimeoutError')),
    BC_PLANNED_BLOCK_TIMEOUT_MS,
  )
  try {
    const retrievedAt = new Date().toISOString()
    const raw = await requestBcAccessSourceJson(
      buildBcPlannedBlockQuery(key),
      MAX_BC_OPENING_POLYGON_BYTES,
      controller.signal,
      MAX_ACCESS_SOURCE_TIMEOUT_MS,
    )
    const { record, blocks } = parseBcPlannedBlock(raw, key, retrievedAt)
    const coordinates: Coordinate[] = blocks.flatMap((block) =>
      block.geometry.type === 'Polygon'
        ? block.geometry.coordinates.flat().map((point) => [point[0], point[1]] as Coordinate)
        : [],
    )
    const bounds = existingRoadQueryBounds(coordinates, BC_PLANNED_BLOCK_ROAD_BUFFER_M / 1000)
    const roads = await loadBcRoadSegments(
      bounds,
      controller.signal,
      BC_PLANNED_BLOCK_MAX_ROADS,
      MAX_ACCESS_SOURCE_TIMEOUT_MS,
    )
    if (controller.signal.aborted)
      throw controller.signal.reason ?? new DOMException('Loading cancelled.', 'AbortError')
    if (roads.length > BC_PLANNED_BLOCK_MAX_ROADS)
      throw Error(`More than ${BC_PLANNED_BLOCK_MAX_ROADS} road parts surround this block; nothing was opened.`)
    const vertices = [...blocks, ...roads].reduce(
      (total, feature) =>
        total +
        (feature.geometry.type === 'LineString'
          ? feature.geometry.coordinates.length
          : feature.geometry.coordinates.reduce((count, ring) => count + ring.length, 0)),
      0,
    )
    if (vertices > BC_PLANNED_BLOCK_MAX_VERTICES)
      throw Error(`The block and its roads exceed ${BC_PLANNED_BLOCK_MAX_VERTICES} vertices; nothing was opened.`)
    return {
      record,
      blocks,
      roads,
      bounds,
      roadsQueryUrl: buildBcRoadSegmentsQuery(bounds, BC_PLANNED_BLOCK_MAX_ROADS),
      retrievedAt,
      warnings: plannedBlockWarnings(record, roads),
    }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
    controller.abort()
  }
}
