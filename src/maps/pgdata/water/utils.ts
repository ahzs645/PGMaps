import { formatDate } from '../shared'
import {
  WATER_BOUNDARY_METRIC_OPTIONS,
  WATER_DATE_MAX_YEAR,
  WATER_DATE_MIN_YEAR,
  WATER_HAZARD_COLORS,
  WATER_MONTH_INDEX,
} from './constants'
import type {
  BoundaryFeatureCollection,
  BoundaryLevelConfig,
  WaterBoundaryAggregateProperties,
  WaterBoundaryMetric,
  WaterFacility,
  WaterLayerMode,
  WaterNoticeRow,
  WaterPointCategory,
  WaterSampleRow,
} from './types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function firstString(record: Record<string, unknown>, keys: string[], fallback = ''): string {
  for (const key of keys) {
    const value = record[key]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return fallback
}

function firstNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key]
    const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function isExpectedWaterDate(date: Date): boolean {
  const year = date.getFullYear()
  return year >= WATER_DATE_MIN_YEAR && year <= WATER_DATE_MAX_YEAR
}

function exactDate(year: number, month: number, day: number): Date | null {
  if (year < WATER_DATE_MIN_YEAR || year > WATER_DATE_MAX_YEAR) return null
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  return date
}

function parseWaterDate(value: unknown): Date | null {
  if (value instanceof Date) return isExpectedWaterDate(value) ? value : null
  if (value == null || value === '') return null

  const text = String(value).trim()
  if (!text) return null

  const dayMonthYear = text.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{4})$/)
  if (dayMonthYear) {
    const month = WATER_MONTH_INDEX[dayMonthYear[2].toLowerCase()]
    if (month == null) return null
    return exactDate(Number(dayMonthYear[3]), month, Number(dayMonthYear[1]))
  }

  const isoDate = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/)
  if (isoDate) {
    return exactDate(Number(isoDate[1]), Number(isoDate[2]) - 1, Number(isoDate[3]))
  }

  const slashDate = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashDate) {
    return exactDate(Number(slashDate[3]), Number(slashDate[1]) - 1, Number(slashDate[2]))
  }

  if (!/\b\d{4}\b/.test(text)) return null
  const parsed = new Date(text)
  if (Number.isNaN(parsed.getTime()) || !isExpectedWaterDate(parsed)) return null
  return parsed
}

export function firstDate(record: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const value = record[key]
    const parsed = parseWaterDate(value)
    if (parsed) return parsed
  }
  return null
}

export function findArray(data: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord)
  if (!isRecord(data)) return []
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) return value.filter(isRecord)
  }
  return []
}

export function collectRows(data: unknown, keys: string[]): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  const seen = new Set<Record<string, unknown>>()
  const rowKeys = ['sampledate', 'sample_date', 'collectiondate', 'collection_date', 'resultdate', 'result_date', 'parameter', 'analyte', 'result']

  function looksLikeRow(record: Record<string, unknown>): boolean {
    const recordKeys = Object.keys(record).map((key) => key.toLowerCase())
    return rowKeys.some((key) => recordKeys.includes(key))
  }

  function visit(value: unknown) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isRecord(item) && looksLikeRow(item) && !seen.has(item)) {
          rows.push(item)
          seen.add(item)
        }
        visit(item)
      }
      return
    }
    if (!isRecord(value)) return
    for (const [key, nested] of Object.entries(value)) {
      if (Array.isArray(nested) && keys.some((candidate) => key.toLowerCase().includes(candidate))) {
        for (const item of nested) {
          if (isRecord(item) && !seen.has(item)) {
            rows.push(item)
            seen.add(item)
          }
          visit(item)
        }
      } else if (isRecord(nested)) {
        visit(nested)
      }
    }
  }

  visit(data)
  return rows
}

export function normalizeFacility(record: Record<string, unknown>, index: number): WaterFacility | null {
  const latitude = firstNumber(record, ['latitude', 'lat', 'facilityLatitude', 'facility_latitude', 'gpsLatitude', 'y'])
  const longitude = firstNumber(record, ['longitude', 'lon', 'lng', 'facilityLongitude', 'facility_longitude', 'gpsLongitude', 'x'])
  const validLatitude = latitude != null && Math.abs(latitude) <= 90 ? latitude : null
  const validLongitude = longitude != null && Math.abs(longitude) <= 180 ? longitude : null
  const hazardRating = firstString(record, ['current_hazard_rating', 'hazard_rating', 'hazardRating', 'hazard'], 'Unknown')
  return {
    id: firstString(record, ['facilityId', 'facility_id', 'pwsid', 'waterSystemNumber', 'water_system_number', 'details_url', 'id'], `facility-${index}`),
    name: firstString(record, ['facilityName', 'facility_name', 'waterSystemName', 'water_system_name', 'name'], `Facility ${index + 1}`),
    operator: firstString(record, ['operator', 'owner', 'supplierName', 'supplier_name']),
    type: firstString(record, ['facilityType', 'facility_type', 'waterSystemType', 'water_system_type', 'type']),
    status: firstString(record, ['status', 'facilityStatus', 'facility_status']),
    hazardRating,
    address: firstString(record, ['address', 'physicalAddress', 'physical_address', 'facility_location', 'location']),
    community: firstString(record, ['community', 'city', 'locality', 'location_summary', 'servingArea', 'serving_area']),
    latitude: validLatitude,
    longitude: validLongitude,
    bacteriologicalSamples: 0,
    chemicalResults: 0,
    activeNotices: 0,
    lastSampleDate: null,
    source: record,
  }
}

export function normalizeSample(record: Record<string, unknown>, index: number, kind: WaterSampleRow['kind']): WaterSampleRow {
  const parameter = firstString(record, ['parameter', 'analyte', 'type', 'test', 'testName', 'test_name'])
  return {
    id: firstString(record, ['sampleId', 'sample_id', 'resultId', 'result_id', 'id'], `${kind}-${index}`),
    facilityId: firstString(record, ['facilityId', 'facility_id', 'pwsid', 'waterSystemNumber', 'water_system_number', 'systemId', 'system_id', 'details_url']),
    facilityName: firstString(record, ['facilityName', 'facility_name', 'waterSystemName', 'water_system_name', 'name']),
    kind,
    date: firstDate(record, ['sampleDate', 'sample_date', 'collectionDate', 'collection_date', 'dateSampled', 'date_sampled', 'resultDate', 'result_date', 'date']),
    parameter: parameter || (kind === 'bacteriological' ? 'Bacteriological' : ''),
    result: firstString(record, ['result', 'value', 'resultValue', 'result_value', 'interpretation']),
    source: record,
  }
}

export function normalizeNotice(record: Record<string, unknown>, index: number): WaterNoticeRow {
  const latitude = firstNumber(record, ['latitude', 'lat', 'facilityLatitude', 'facility_latitude', 'gpsLatitude', 'y'])
  const longitude = firstNumber(record, ['longitude', 'lon', 'lng', 'facilityLongitude', 'facility_longitude', 'gpsLongitude', 'x'])
  const validLatitude = latitude != null && Math.abs(latitude) <= 90 ? latitude : null
  const validLongitude = longitude != null && Math.abs(longitude) <= 180 ? longitude : null

  return {
    id: firstString(record, ['noticeId', 'notice_id', 'id'], `notice-${index}`),
    facilityId: firstString(record, ['facilityId', 'facility_id', 'pwsid', 'waterSystemNumber', 'water_system_number', 'systemId', 'system_id', 'details_url']),
    facilityName: firstString(record, ['facilityName', 'facility_name', 'waterSystemName', 'water_system_name', 'name']),
    type: firstString(record, ['noticeType', 'notice_type', 'type', 'advisoryType', 'advisory_type'], 'Active notice'),
    status: firstString(record, ['status', 'noticeStatus', 'notice_status'], 'Active'),
    date: firstDate(record, ['issuedDate', 'issued_date', 'effectiveDate', 'effective_date', 'startDate', 'start_date', 'start_date_iso', 'date']),
    latitude: validLatitude,
    longitude: validLongitude,
    locationSummary: firstString(record, ['location_summary', 'community', 'city', 'locality']),
    primarySource: firstString(record, ['primary_source', 'source']),
    mergeBucket: firstString(record, ['merge_bucket', 'record_type']),
    sourceCount: firstNumber(record, ['source_count']) ?? 1,
    source: record,
  }
}

export function sameFacility(sample: WaterSampleRow | WaterNoticeRow, facility: WaterFacility): boolean {
  if ('noticeIds' in facility && facility.noticeIds?.includes(sample.id)) return true
  if (sample.facilityId && sample.facilityId === facility.id) return true
  return Boolean(sample.facilityName && sample.facilityName.toLowerCase() === facility.name.toLowerCase())
}

export function getWaterPointCategory(layerMode: WaterLayerMode): WaterPointCategory {
  if (layerMode === 'notices') return 'notice'
  if (layerMode === 'samples') return 'samples'
  return 'facility'
}

function cleanSampleLocationText(value: string): string {
  return value
    .replace(/\bPG\s*Pulp\s*Mill\b/gi, 'PG Pulp Mill')
    .replace(/\bPG\s*Pulpmill\b/gi, 'PG Pulp Mill')
    .replace(/\bPulpmill\b/gi, 'Pulp Mill')
    .replace(/\s+,/g, ',')
    .replace(/,\s*/g, ', ')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function parseSampleLocation(value: unknown): { raw: string; samplePoint: string; context: string } | null {
  if (value == null) return null
  const raw = cleanSampleLocationText(String(value))
  if (!raw) return null
  const parts = raw
    .split(',')
    .map((part) => cleanSampleLocationText(part))
    .filter(Boolean)
  if (parts.length === 0) return null
  return {
    raw,
    samplePoint: parts[0],
    context: parts.slice(1).join(', '),
  }
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '')
  const full = normalized.length === 3
    ? normalized.split('').map((char) => char + char).join('')
    : normalized
  const value = Number.parseInt(full, 16)
  const red = (value >> 16) & 255
  const green = (value >> 8) & 255
  const blue = value & 255
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}

export function getBoundaryMetricLabel(metric: WaterBoundaryMetric): string {
  return WATER_BOUNDARY_METRIC_OPTIONS.find((option) => option.value === metric)?.label ?? 'Boundary metric'
}

export function getHazardColorClass(rating: string): string {
  return WATER_HAZARD_COLORS[rating] ?? 'bg-gray-500'
}

export function orderHazardRatings(ratings: string[]): string[] {
  const preferred = ['Low', 'Moderate', 'High', 'Unknown']
  return ratings.sort((left, right) => {
    const leftIndex = preferred.indexOf(left)
    const rightIndex = preferred.indexOf(right)
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (leftIndex === -1 ? preferred.length : leftIndex) - (rightIndex === -1 ? preferred.length : rightIndex)
    }
    return left.localeCompare(right)
  })
}

export function getFacilitySampleTotal(facility: WaterFacility): number {
  return facility.bacteriologicalSamples + facility.chemicalResults
}

export function getBoundaryMetricValue(properties: WaterBoundaryAggregateProperties, metric: WaterBoundaryMetric): number {
  if (metric === 'facilities') return properties.facilityCount
  if (metric === 'sampleRows') return properties.sampleRows
  if (metric === 'activeNotices') return properties.activeNotices
  return properties.avgSamplesPerFacility
}

export function formatMetricValue(value: number, metric: WaterBoundaryMetric): string {
  if (metric === 'avgSamplesPerFacility') return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return Math.round(value).toLocaleString()
}

export function formatUnknown(value: unknown): string {
  if (value == null || value === '') return 'None listed'
  if (value instanceof Date) return formatDate(value.toISOString())
  if (Array.isArray(value)) return value.map(formatUnknown).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function getInspectionRows(facility: WaterFacility): Record<string, unknown>[] {
  const healthSpaceSource = getNoticeSourceRecord(facility.source, 'HealthSpace')
  const rawHealthSpace = isRecord(healthSpaceSource?.raw) ? healthSpaceSource.raw : null
  const inspections = facility.source.inspections ?? healthSpaceSource?.inspections ?? rawHealthSpace?.inspections
  return Array.isArray(inspections) ? inspections.filter(isRecord) : []
}

function getNoticeSourceRecord(record: Record<string, unknown>, sourceName: string): Record<string, unknown> | null {
  const sources = record.sources
  if (!Array.isArray(sources)) return null
  return sources
    .filter(isRecord)
    .find((source) => String(source.source ?? '').toLowerCase() === sourceName.toLowerCase()) ?? null
}

export function getNoticeDetail(notice: WaterNoticeRow, key: string): string {
  const healthSpaceSource = getNoticeSourceRecord(notice.source, 'HealthSpace')
  const waterTodaySource = getNoticeSourceRecord(notice.source, 'WaterToday')
  const rawHealthSpace = isRecord(healthSpaceSource?.raw) ? healthSpaceSource.raw : null
  const rawWaterToday = isRecord(waterTodaySource?.raw) ? waterTodaySource.raw : null
  const noticeDetails = isRecord(notice.source.notice_details) ? notice.source.notice_details : null
  const value = notice.source[key]
    ?? healthSpaceSource?.[key]
    ?? rawHealthSpace?.[key]
    ?? waterTodaySource?.[key]
    ?? rawWaterToday?.[key]
    ?? noticeDetails?.[key]
  return typeof value === 'string' ? value.trim() : ''
}

export function getNoticeDetailsUrl(record: Record<string, unknown>): string {
  const direct = firstString(record, ['details_url', 'source_id'])
  if (direct) return direct
  const primarySource = firstString(record, ['primary_source'])
  const preferredSource = primarySource ? getNoticeSourceRecord(record, primarySource) : null
  const anySource = Array.isArray(record.sources) ? record.sources.filter(isRecord)[0] : null
  return firstString(preferredSource ?? anySource ?? {}, ['details_url', 'source_id'])
}

function getBoundaryName(properties: GeoJSON.GeoJsonProperties | undefined, config: BoundaryLevelConfig): string {
  return String(properties?.[config.nameField] ?? properties?.name ?? properties?.NAME ?? 'Boundary')
}

export function prepareBoundaries(data: BoundaryFeatureCollection | null, config: BoundaryLevelConfig): BoundaryFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (data?.features ?? []).filter((feature) => feature.geometry).map((feature, index) => ({
      ...feature,
      id: String(feature.properties?.[config.idField] ?? feature.id ?? index),
      properties: {
        ...feature.properties,
        boundaryId: String(feature.properties?.[config.idField] ?? feature.id ?? index),
        boundaryName: getBoundaryName(feature.properties, config),
      },
    })),
  }
}
