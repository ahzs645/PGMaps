import Dexie, { type EntityTable } from 'dexie'
import { parseCsvRows } from '@/lib/parseCsv'

/** Prefix that marks a metric recipe source as a user-uploaded dataset. */
export const USER_DATASET_SOURCE_PREFIX = 'user.'

export const MAX_USER_DATASET_FEATURES = 50_000
export const MAX_USER_DATASET_FILE_BYTES = 25 * 1024 * 1024

export interface UserDatasetRecord {
  id: string
  label: string
  fileName: string
  format: 'geojson' | 'csv'
  createdAt: string
  featureCount: number
  propertyKeys: string[]
  collection: GeoJSON.FeatureCollection
}

/** Lightweight projection used for lists so the geometry payload stays in IndexedDB. */
export interface UserDatasetSummary {
  id: string
  label: string
  fileName: string
  format: 'geojson' | 'csv'
  createdAt: string
  featureCount: number
  propertyKeys: string[]
}

export interface ParsedUserDataset {
  collection: GeoJSON.FeatureCollection
  format: 'geojson' | 'csv'
  featureCount: number
  propertyKeys: string[]
  warnings: string[]
}

class IndexLabDatabase extends Dexie {
  userDatasets!: EntityTable<UserDatasetRecord, 'id'>

  constructor() {
    super('pgmaps-index-lab')
    this.version(1).stores({
      // Geometry lives in the unindexed `collection` field.
      userDatasets: 'id, label, createdAt',
    })
  }
}

let database: IndexLabDatabase | null = null

function getDatabase(): IndexLabDatabase {
  if (!database) database = new IndexLabDatabase()
  return database
}

export function userDatasetSourceId(datasetId: string): `user.${string}` {
  return `${USER_DATASET_SOURCE_PREFIX}${datasetId}` as `user.${string}`
}

export function isUserDatasetSource(source: string): source is `user.${string}` {
  return source.startsWith(USER_DATASET_SOURCE_PREFIX)
}

export async function listUserDatasets(): Promise<UserDatasetSummary[]> {
  const records = await getDatabase().userDatasets.orderBy('createdAt').reverse().toArray()
  return records.map((record) => ({
    id: record.id,
    label: record.label,
    fileName: record.fileName,
    format: record.format,
    createdAt: record.createdAt,
    featureCount: record.featureCount,
    propertyKeys: record.propertyKeys,
  }))
}

export async function loadUserDatasetCollections(): Promise<Record<string, GeoJSON.FeatureCollection>> {
  const records = await getDatabase().userDatasets.toArray()
  return Object.fromEntries(records.map((record) => [userDatasetSourceId(record.id), record.collection]))
}

export async function saveUserDataset(record: UserDatasetRecord): Promise<void> {
  await getDatabase().userDatasets.put(record)
}

export async function deleteUserDataset(id: string): Promise<void> {
  await getDatabase().userDatasets.delete(id)
}

export function createUserDatasetId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `upload_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

// ---------------------------------------------------------------------------
// File parsing
// ---------------------------------------------------------------------------

const LATITUDE_COLUMNS = ['latitude', 'lat', 'y', 'ycoord', 'y_coord']
const LONGITUDE_COLUMNS = ['longitude', 'lon', 'lng', 'long', 'x', 'xcoord', 'x_coord']

export function parseUserDatasetText(text: string, fileName: string): ParsedUserDataset {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.csv') || lower.endsWith('.tsv')) {
    return parseCsvDataset(text, lower.endsWith('.tsv') ? '\t' : ',')
  }
  return parseGeoJsonDataset(text)
}

export async function parseUserDatasetFile(file: File): Promise<ParsedUserDataset> {
  if (file.size > MAX_USER_DATASET_FILE_BYTES) {
    throw new Error(`File is larger than ${Math.round(MAX_USER_DATASET_FILE_BYTES / (1024 * 1024))} MB.`)
  }
  const text = await file.text()
  return parseUserDatasetText(text, file.name)
}

function parseGeoJsonDataset(text: string): ParsedUserDataset {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('File is not valid JSON. Upload a GeoJSON FeatureCollection or a CSV with lat/lon columns.')
  }

  const candidate = parsed as { type?: string; features?: unknown; geometry?: unknown }
  let features: GeoJSON.Feature[]
  if (candidate?.type === 'FeatureCollection' && Array.isArray(candidate.features)) {
    features = candidate.features as GeoJSON.Feature[]
  } else if (candidate?.type === 'Feature' && candidate.geometry) {
    features = [parsed as GeoJSON.Feature]
  } else {
    throw new Error('JSON file must be a GeoJSON FeatureCollection or Feature.')
  }

  const warnings: string[] = []
  if (features.length > MAX_USER_DATASET_FEATURES) {
    warnings.push(`Dataset truncated to the first ${MAX_USER_DATASET_FEATURES.toLocaleString()} features.`)
    features = features.slice(0, MAX_USER_DATASET_FEATURES)
  }

  // Spatial-join operations work on points; non-point geometries are collapsed to a
  // representative point (first coordinate average) so they can still be counted.
  let convertedGeometries = 0
  let dropped = 0
  const pointFeatures: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const feature of features) {
    if (!feature || typeof feature !== 'object' || !feature.geometry) {
      dropped += 1
      continue
    }
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        dropped += 1
        continue
      }
      pointFeatures.push(feature as GeoJSON.Feature<GeoJSON.Point>)
      continue
    }
    const representative = representativePoint(feature.geometry)
    if (!representative) {
      dropped += 1
      continue
    }
    convertedGeometries += 1
    pointFeatures.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: representative },
      properties: feature.properties ?? {},
    })
  }

  if (!pointFeatures.length) throw new Error('No usable point features found in the file.')
  if (convertedGeometries > 0) {
    warnings.push(`${convertedGeometries.toLocaleString()} non-point geometries were reduced to representative points.`)
  }
  if (dropped > 0) warnings.push(`${dropped.toLocaleString()} features without usable geometry were skipped.`)

  return {
    collection: { type: 'FeatureCollection', features: pointFeatures },
    format: 'geojson',
    featureCount: pointFeatures.length,
    propertyKeys: collectPropertyKeys(pointFeatures),
    warnings,
  }
}

function parseCsvDataset(text: string, delimiter: string): ParsedUserDataset {
  const rows = parseCsvRows(text, { delimiter })
  if (rows.length < 2) throw new Error('CSV needs a header row and at least one data row.')

  const header = rows[0].map((cell) => cell.trim())
  const normalized = header.map((cell) => cell.toLowerCase().replace(/[^a-z_]/g, ''))
  const latIndex = normalized.findIndex((cell) => LATITUDE_COLUMNS.includes(cell))
  const lngIndex = normalized.findIndex((cell) => LONGITUDE_COLUMNS.includes(cell))
  if (latIndex < 0 || lngIndex < 0) {
    throw new Error(
      `CSV needs latitude/longitude columns (looked for ${LATITUDE_COLUMNS.join(', ')} and ${LONGITUDE_COLUMNS.join(', ')}).`,
    )
  }

  const warnings: string[] = []
  let dropped = 0
  const features: GeoJSON.Feature<GeoJSON.Point>[] = []
  for (const row of rows.slice(1)) {
    if (features.length >= MAX_USER_DATASET_FEATURES) {
      warnings.push(`Dataset truncated to the first ${MAX_USER_DATASET_FEATURES.toLocaleString()} rows.`)
      break
    }
    const lat = Number(row[latIndex])
    const lng = Number(row[lngIndex])
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      dropped += 1
      continue
    }
    const properties: Record<string, string | number> = {}
    header.forEach((column, index) => {
      if (index === latIndex || index === lngIndex || !column) return
      const raw = (row[index] ?? '').trim()
      if (raw === '') return
      const numeric = Number(raw)
      properties[column] = Number.isFinite(numeric) && raw !== '' ? numeric : raw
    })
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties })
  }

  if (!features.length) throw new Error('No rows with valid coordinates found in the CSV.')
  if (dropped > 0) warnings.push(`${dropped.toLocaleString()} rows with invalid coordinates were skipped.`)

  return {
    collection: { type: 'FeatureCollection', features },
    format: 'csv',
    featureCount: features.length,
    propertyKeys: collectPropertyKeys(features),
    warnings,
  }
}

/** Minimal RFC4180-ish parser: quoted fields, escaped quotes, CRLF/LF rows. */
function representativePoint(geometry: GeoJSON.Geometry): [number, number] | null {
  if (geometry.type === 'GeometryCollection') {
    for (const member of geometry.geometries) {
      const result = representativePoint(member)
      if (result) return result
    }
    return null
  }
  const flat = flattenPositions(geometry.coordinates)
  if (!flat.length) return null
  const sum = flat.reduce<[number, number]>((acc, [lng, lat]) => [acc[0] + lng, acc[1] + lat], [0, 0])
  const lng = sum[0] / flat.length
  const lat = sum[1] / flat.length
  return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
}

function flattenPositions(coordinates: unknown): Array<[number, number]> {
  if (!Array.isArray(coordinates)) return []
  if (coordinates.length >= 2 && typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    return [[coordinates[0], coordinates[1]]]
  }
  return coordinates.flatMap((entry) => flattenPositions(entry))
}

function collectPropertyKeys(features: GeoJSON.Feature[]): string[] {
  const keys = new Set<string>()
  for (const feature of features.slice(0, 2000)) {
    Object.keys(feature.properties ?? {}).forEach((key) => keys.add(key))
  }
  return Array.from(keys).slice(0, 64)
}
