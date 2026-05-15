import fs from 'node:fs/promises'
import path from 'node:path'
import { buildIconUrl } from './aqmapIconAdapter'

export type AqmapDataFormat = 'json' | 'csv' | 'tsv' | 'geojson'

export interface AqmapMonitorRow {
  [key: string]: string | number | boolean | null | undefined
}

interface RawMonitorRow {
  [key: string]: string | number | null | undefined
}

interface AqmapFeature {
  type?: string
  geometry?: {
    coordinates?: [number, number] | number[]
    type?: string
  }
  properties?: Record<string, unknown>
}

const DATA_JSON_PATHS = [
  path.resolve(process.cwd(), 'public', 'airdatamap', 'data', 'monitors', 'all.json'),
  path.resolve(process.cwd(), 'public', 'data', 'monitors', 'all.json'),
]

const DATA_CSV_PATH = path.resolve(process.cwd(), 'public', 'data', 'monitors.csv')

const MONITOR_NETWORK_ALIASES: Record<string, string[]> = {
  agency: ['FEM', 'BC ENV'],
  fem: ['FEM', 'BC ENV'],
  lcm: ['PA', 'EGG'],
  purpleair: ['PA'],
  pa: ['PA'],
  aqegg: ['EGG'],
  egg: ['EGG'],
}

const KNOWN_NUMERIC_KEYS = new Set([
  'lat',
  'lng',
  'latitude',
  'longitude',
  'pm25_recent_r',
  'pm25_recent',
  'pm25_1hr_r',
  'pm25_1hr',
  'pm25_3hr_r',
  'pm25_3hr',
  'pm25_24hr_r',
  'pm25_24hr',
  'pm25',
  'val',
  'val_r',
  'val_1hr',
  'val_24hr',
  'val_1hr_r',
  'val_24hr_r',
  'pm25Recent',
  'pm25_recent',
  'pm25_10min',
  'pm25_1hr',
  'pm25_3hr',
  'pm25_24hr',
  'pm25Recent_r',
  'pm25_1hr_r',
  'pm25_3hr_r',
  'pm25_24hr_r',
  'pm25OneHour',
  'pm25OneHourRaw',
  'pm25ThreeHour',
  'pm25ThreeHourRaw',
  'pm25TwentyFourHour',
  'pm25TwentyFourHourRaw',
  'temperature',
  'rh',
  'pressure',
])

const KEY_ALIASES: Array<[string, string]> = [
  ['pm25Recent', 'pm25_recent'],
  ['pm25Recent_r', 'pm25_recent_r'],
  ['pm25OneHour', 'pm25_1hr'],
  ['pm25OneHourRaw', 'pm25_1hr_r'],
  ['pm25ThreeHour', 'pm25_3hr'],
  ['pm25ThreeHourRaw', 'pm25_3hr_r'],
  ['pm25TwentyFourHour', 'pm25_24hr'],
  ['pm25TwentyFourHourRaw', 'pm25_24hr_r'],
  ['dateObserved', 'date'],
  ['dateObserved', 'date_last_obs'],
  ['date_last_observed', 'date_last_obs'],
  ['dateLastObs', 'date_last_obs'],
  ['siteId', 'site_id'],
]

const ICON_COLOR_SIZE_ONLINE = 29
const ICON_COLOR_SIZE_OFFLINE = 20

const PREFERRED_KEY_ORDER = [
  'id',
  'name',
  'site_id',
  'network',
  'monitor_type',
  'sensor_index',
  'latitude',
  'longitude',
  'lat',
  'lng',
  'city',
  'province',
  'state',
  'prov_terr',
  'date',
  'date_last_obs',
  'date_observed',
  'status',
  'pm25_recent_r',
  'pm25_recent',
  'pm25_1hr_r',
  'pm25_1hr',
  'pm25_3hr_r',
  'pm25_3hr',
  'pm25_24hr_r',
  'pm25_24hr',
  'temperature',
  'rh',
  'pressure',
]

function normalizeMonitorIdentifier(row: RawMonitorRow): AqmapMonitorRow {
  const normalizedRow = normalizeAliasKeys(row)
  const id = valueToString(normalizedRow.id ?? normalizedRow.site_id ?? normalizedRow.sensor_index)
  const network = valueToString(normalizedRow.network ?? normalizedRow.network_id ?? normalizedRow.monitor_type)
  const siteId = valueToString(normalizedRow.site_id ?? normalizedRow.sensor_index)
  const dateValue = valueToString(
    normalizedRow.date_last_obs ?? normalizedRow.date ?? normalizedRow.date_observed ?? normalizedRow.dateObserved ?? normalizedRow.date_last_observed,
  )
  const province = valueToString(normalizedRow.prov_terr ?? normalizedRow.province ?? normalizedRow.state)

  const normalized: AqmapMonitorRow = {
    ...normalizedRow,
    id: id || normalizedRow.id || siteId,
    name: valueToString(normalizedRow.name ?? normalizedRow.monitor ?? normalizedRow.site_name ?? ''),
    site_id: siteId,
    network,
    latitude: parseNumeric(row.latitude ?? row.lat),
    longitude: parseNumeric(row.longitude ?? row.lng),
    date: dateValue,
    date_last_obs: dateValue,
    prov_terr: province,
  }

  if (normalized.latitude === undefined) normalized.latitude = parseNumeric(row.lat)
  if (normalized.longitude === undefined) normalized.longitude = parseNumeric(row.lng)

  for (const [key, value] of Object.entries(row)) {
    if (KNOWN_NUMERIC_KEYS.has(key)) {
      const parsed = parseNumeric(value)
      if (parsed !== undefined) {
        normalized[key] = parsed
      }
    }
  }

  return normalized
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function parseFeatureCollectionRows(value: unknown): RawMonitorRow[] {
  if (!isPlainObject(value) || value.type !== 'FeatureCollection') return []

  const typed = value as { features?: AqmapFeature[] }
  if (!Array.isArray(typed.features)) return []

  return typed.features
    .filter((feature) => feature.type === 'Feature')
    .map((feature) => {
      const coordinates = feature.geometry?.coordinates ?? []
      const [longitude, latitude] = coordinates
      const properties = feature.properties ?? {}
      return {
        ...properties,
        longitude,
        latitude,
        date: properties.date ?? properties.date_last_obs,
        date_last_obs: properties.date_last_obs ?? properties.date,
      } as RawMonitorRow
    })
    .filter((row) => row.latitude !== undefined || row.longitude !== undefined)
}

function parseMonitorPayload(payload: unknown): RawMonitorRow[] {
  if (Array.isArray(payload)) return payload as RawMonitorRow[]
  if (!isPlainObject(payload)) return []

  const nested = (payload.data ?? payload.monitors ?? payload.rows) as unknown
  if (Array.isArray(nested)) return nested as RawMonitorRow[]
  if (isPlainObject(nested)) {
    const featureCollectionRows = parseFeatureCollectionRows(nested)
    if (featureCollectionRows.length > 0) return featureCollectionRows
  }
  if (payload.type === 'FeatureCollection') {
    const featureCollectionRows = parseFeatureCollectionRows(payload)
    if (featureCollectionRows.length > 0) return featureCollectionRows
  }
  return []
}

function normalizeAliasKeys(row: RawMonitorRow): RawMonitorRow {
  const normalized = { ...row }

  for (const [source, target] of KEY_ALIASES) {
    if (normalized[target] === undefined && normalized[source] !== undefined) {
      normalized[target] = normalized[source]
    }
  }

  return normalized
}

function valueToString(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  return String(value)
}

function parseNumeric(value: string | number | null | undefined): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (value === null || value === undefined || value === '') return undefined

  const parsed = Number.parseFloat(String(value))
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseCsvText(text: string): RawMonitorRow[] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index]
    const next = text[index + 1]

    if (current === '\"' && inQuotes && next === '\"') {
      value += '\"'
      index += 1
    } else if (current === '\"') {
      inQuotes = !inQuotes
    } else if (current === ',' && !inQuotes) {
      row.push(value)
      value = ''
    } else if ((current === '\n' || current === '\r') && !inQuotes) {
      if (current === '\r' && next === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      value = ''
    } else {
      value += current
    }
  }

  if (value || row.length > 0) {
    row.push(value)
    if (row.some((cell) => cell.length > 0)) rows.push(row)
  }

  const [header, ...records] = rows
  if (!header) return []

  return records.map((record) => {
    const normalized: RawMonitorRow = {}
    header.forEach((key, index) => {
      const raw = record[index] ?? ''
      normalized[key.trim()] = raw
    })
    return normalized
  })
}

type AqmapIconMetaGroup = 'agency' | 'purpleair' | 'aqegg' | 'lcm'

function toIconMetaGroup(network: unknown): AqmapIconMetaGroup {
  const normalized = String(network ?? '').trim().toUpperCase()
  if (normalized === 'FEM' || normalized === 'BC ENV') return 'agency'
  if (normalized === 'PA') return 'purpleair'
  if (normalized === 'EGG') return 'aqegg'
  return 'lcm'
}

function resolveIconValue(row: AqmapMonitorRow): number | null {
  const candidates: Array<keyof AqmapMonitorRow> = [
    'pm25_recent_r',
    'pm25_recent',
    'pm25Recent',
    'pm25Recent_r',
    'pm25_10min',
    'pm25_1hr_r',
    'pm25_1hr',
    'pm25OneHour',
    'pm25OneHourRaw',
    'pm25_3hr_r',
    'pm25_3hr',
    'pm25ThreeHour',
    'pm25ThreeHourRaw',
    'pm25_24hr_r',
    'pm25_24hr',
    'pm25TwentyFourHour',
    'pm25TwentyFourHourRaw',
    'val',
    'val_1hr',
    'val_24hr',
    'val_1hr_r',
    'val_24hr_r',
    'pm25',
    'val_r',
  ]
  for (const key of candidates) {
    const value = parseNumeric(row[key] as string | number | null | undefined)
    if (value !== undefined) return value
  }
  return null
}

function markerSortKey(network: string, value: number | null): number {
  if (value === null) return -1
  const group = toIconMetaGroup(network)
  const groupOffset = group === 'agency' ? 100000 : 0
  return groupOffset + Math.round(value * 100)
}

function buildMonitorIconMetadata(row: AqmapMonitorRow) {
  const value = resolveIconValue(row)
  const group = toIconMetaGroup(row.network)
  const size = value === null ? ICON_COLOR_SIZE_OFFLINE : ICON_COLOR_SIZE_ONLINE
  return {
    iconUrl: buildIconUrl(group, value, size),
    iconSize: size,
    zIndexOffset: markerSortKey(String(row.network), value),
    pane: 'markerPane',
  }
}

export function resolveNetworkFilter(value?: string): string[] | null {
  if (!value) return null
  const resolved = MONITOR_NETWORK_ALIASES[value.toLowerCase()]
  return resolved ? [...resolved] : null
}

export function getMonitorNetworkValue(row: AqmapMonitorRow): string {
  return String(row.network ?? '').trim().toUpperCase()
}

function toCsvValue(value: unknown): string {
  const text = value == null ? '' : String(value)
  const escaped = text.replace(/\"/g, '\"\"')
  const requiresQuote = escaped.includes(',') || escaped.includes('\n') || escaped.includes('\r') || escaped.includes('\"')
  return requiresQuote ? `\"${escaped}\"` : escaped
}

function serializeRows(rows: AqmapMonitorRow[], delimiter: string): string {
  if (!rows.length) return ''

  const keys = Array.from(new Set<string>(rows.flatMap((row) => Object.keys(row))))
  const orderedKeys = [
    ...PREFERRED_KEY_ORDER.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !PREFERRED_KEY_ORDER.includes(key)),
  ]

  const header = orderedKeys.join(delimiter)
  const body = rows
    .map((row) => orderedKeys
      .map((key) => toCsvValue(row[key]))
      .join(delimiter))
    .join('\n')

  return `${header}\n${body}`
}

export function serializeAqmapData(rows: AqmapMonitorRow[], format: AqmapDataFormat): string {
  if (format === 'geojson') {
    return JSON.stringify(toGeoJson(rows))
  }
  if (format === 'tsv') {
    return serializeRows(rows, '\t')
  }
  if (format === 'csv') {
    return serializeRows(rows, ',')
  }
  return JSON.stringify(rows)
}

export async function loadRecentMonitorRows(): Promise<AqmapMonitorRow[]> {
  for (const filePath of DATA_JSON_PATHS) {
    try {
      const text = await fs.readFile(filePath, 'utf8')
      const parsed = JSON.parse(text) as unknown
      const rows = parseMonitorPayload(parsed)
      if (rows.length > 0) {
        return rows.map(normalizeMonitorIdentifier)
      }
    } catch {
      // continue
    }
  }

  try {
    const text = await fs.readFile(DATA_CSV_PATH, 'utf8')
    return parseCsvText(text).map(normalizeMonitorIdentifier)
  } catch {
    return []
  }
}

export function sanitizeRecentRows(rows: AqmapMonitorRow[], datasetName?: string): AqmapMonitorRow[] {
  if (datasetName !== 'meta') return rows

  return rows.map((row) => {
    const sanitized: AqmapMonitorRow = {}
    for (const [key, value] of Object.entries(row)) {
      const lower = key.toLowerCase()
      if (lower.startsWith('pm25') || lower.startsWith('val') || lower.startsWith('date')) {
        continue
      }
      sanitized[key] = value
    }
    return sanitized
  })
}

export function toGeoJson(rows: AqmapMonitorRow[]) {
  const features = rows
    .map((row) => {
      const latitude = Number(row.latitude)
      const longitude = Number(row.longitude)
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null
      const iconMeta = buildMonitorIconMetadata(row)
      const rest = {
        ...row,
      }
      delete rest.latitude
      delete rest.longitude
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [longitude, latitude],
        },
        properties: {
          ...rest,
          id: rest.id ?? rest.site_id,
          latitude,
          longitude,
          site_id: rest.site_id ?? rest.id,
          date_last_obs: rest.date_last_obs ?? rest.date,
          ...iconMeta,
        },
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  return {
    type: 'FeatureCollection',
    features,
  }
}

export const DEFAULT_DATA_FORMATS: AqmapDataFormat[] = ['json', 'geojson', 'csv', 'tsv']

export function applyNetworkFilter(rows: AqmapMonitorRow[], network?: string | null): AqmapMonitorRow[] {
  if (!network) return rows

  const allowed = resolveNetworkFilter(network)
  if (!allowed) return rows

  const allowedSet = new Set(allowed.map((value) => value.toUpperCase()))
  return rows.filter((row) => {
    const monitorNetwork = getMonitorNetworkValue(row)
    return allowedSet.has(monitorNetwork)
  })
}
