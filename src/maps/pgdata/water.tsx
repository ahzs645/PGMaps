import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { Droplets } from 'lucide-react'
import { MapClusterLayer, MapMarker, MapPopup, MarkerContent } from '@/components/ui/map'
import { MapFillLayer, MapHeatmapLayer } from '@/components/ui/map-layers'
import { InlineAlert, LegendItem, MapGradientLegendItem, StatGrid, ToggleChip } from '@/components/ui/map-panels'
import { AppSelect } from '@/components/ui/select'
import { StudyAreaSelector, type StudyAreaLevelOption, type StudyAreaSourceOption } from '@/components/StudyAreaSelector'
import type { TimelineWindowOption } from '@/components/ui/timeline'
import { cn } from '@/lib/utils'
import { formatDate, useJsonManifest } from './shared'

export const WATER_TIMELINE_WINDOW_OPTIONS: TimelineWindowOption[] = [
  { value: 1, label: '1 mo' },
  { value: 12, label: '1 yr' },
  { value: 60, label: '5 yr' },
  { value: -1, label: 'Cumul.' },
]

type WaterBoundarySource = 'bcHealth' | 'regionalDistrict' | 'census' | 'watershed' | 'nrAdmin'
type WaterBoundaryLevel =
  | 'healthAuthority'
  | 'hsda'
  | 'lha'
  | 'chsa'
  | 'regionalDistrict'
  | 'cd'
  | 'csd'
  | 'ct'
  | 'da'
  | 'majorWatershed'
  | 'watershedGroup'
  | 'assessmentWatershed'
  | 'nrArea'
  | 'nrRegion'
  | 'nrDistrict'
type WaterLayerMode = 'facilities' | 'samples' | 'notices'
type WaterBoundaryMetric = 'facilities' | 'sampleRows' | 'avgSamplesPerFacility' | 'activeNotices'
type WaterPointCategory = 'facility' | 'samples' | 'notice'
type WaterSampleKindFilter = 'all' | WaterSampleRow['kind']

type BoundaryFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>

interface BoundaryLevelConfig {
  path: string
  idField: string
  nameField: string
}

interface WaterFacility {
  id: string
  name: string
  operator: string
  type: string
  status: string
  hazardRating: string
  address: string
  community: string
  latitude: number | null
  longitude: number | null
  bacteriologicalSamples: number
  chemicalResults: number
  activeNotices: number
  lastSampleDate: Date | null
  geocodedAddress?: string
  geocodePartialMatch?: boolean
  noticeOnly?: boolean
  noticeIds?: string[]
  primarySource?: string
  mergeBucket?: string
  sourceCount?: number
  source: Record<string, unknown>
}

interface WaterSampleRow {
  id: string
  facilityId: string
  facilityName: string
  kind: 'bacteriological' | 'chemical'
  date: Date | null
  parameter: string
  result: string
  source: Record<string, unknown>
}

interface WaterNoticeRow {
  id: string
  facilityId: string
  facilityName: string
  type: string
  status: string
  date: Date | null
  latitude: number | null
  longitude: number | null
  locationSummary: string
  primarySource: string
  mergeBucket: string
  sourceCount: number
  source: Record<string, unknown>
}

interface WaterManifest {
  generatedAt?: string
  files?: Array<{ file?: string; path?: string; rows?: number; records?: number; size?: string }>
  source?: string
  sourcePage?: string
  sourceLicense?: string
}

interface CombinedWaterNoticesSummary {
  combined_count?: number
  healthspace_count?: number
  watertoday_count?: number
  with_coordinates?: number
  with_multiple_sources?: number
  record_type_counts?: Record<string, number>
  merge_bucket_counts?: Record<string, number>
  primary_source_counts?: Record<string, number>
}

interface GeocodedLocation {
  dataset: string
  source_index: number
  source_name?: string
  source_details_url?: string
  latitude: number
  longitude: number
  google_geocoded_address?: string
  google_partial_match?: boolean
}

interface GeocodedLocationsFile {
  summary?: unknown
  locations?: GeocodedLocation[]
}

type WaterFacilityFeatureProperties = Record<string, unknown> & {
  id: string
  name: string
  category: WaterPointCategory
}

type WaterBoundaryAggregateProperties = Record<string, unknown> & {
  boundaryId: string
  boundaryName: string
  facilityCount: number
  sampleRows: number
  avgSamplesPerFacility: number
  activeNotices: number
  metricValue: number
}

const WATER_ROOT = '/data/water'

const WATER_POINT_COLORS: Record<WaterPointCategory, string> = {
  facility: '#2563eb',
  samples: '#0891b2',
  notice: '#dc2626',
}

const WATER_POINT_CATEGORIES: WaterPointCategory[] = ['facility', 'samples', 'notice']

const WATER_BOUNDARY_METRIC_OPTIONS: Array<{ value: WaterBoundaryMetric; label: string }> = [
  { value: 'avgSamplesPerFacility', label: 'Avg sample rows / facility' },
  { value: 'sampleRows', label: 'Sample rows' },
  { value: 'facilities', label: 'Facilities' },
  { value: 'activeNotices', label: 'Active notices' },
]

const WATER_HAZARD_COLORS: Record<string, string> = {
  Low: 'bg-green-500',
  Moderate: 'bg-amber-500',
  High: 'bg-red-600',
  Unknown: 'bg-gray-500',
}

const WATER_DATE_MIN_YEAR = 1900
const WATER_DATE_MAX_YEAR = new Date().getFullYear() + 1
const WATER_MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
}

const WATER_SOURCE_OPTIONS: Array<StudyAreaSourceOption<WaterBoundarySource>> = [
  {
    value: 'bcHealth',
    label: 'Health boundaries',
    description: 'Health Authority -> CHSA hierarchy',
  },
  {
    value: 'regionalDistrict',
    label: 'Regional district',
    description: 'Large local-government region - Fraser-Fort George, Cariboo RD, Bulkley-Nechako RD',
  },
  {
    value: 'census',
    label: 'Census boundaries',
    description: 'PG census tract -> dissemination area',
  },
  {
    value: 'watershed',
    label: 'Watershed boundaries',
    description: 'BC Freshwater Atlas hierarchy',
  },
  {
    value: 'nrAdmin',
    label: 'Natural Resource admin',
    description: 'BC NR Areas, Regions, and Districts',
  },
]

const WATER_HEALTH_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'healthAuthority', label: 'Health Authority' },
  { value: 'hsda', label: 'Health Service Delivery Area' },
  { value: 'lha', label: 'Local Health Area' },
  { value: 'chsa', label: 'Community Health Service Area' },
]

const WATER_CENSUS_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'cd', label: 'Census Division' },
  { value: 'ct', label: 'Census Tract' },
  { value: 'da', label: 'Dissemination Area' },
]

const WATER_REGIONAL_DISTRICT_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'regionalDistrict', label: 'Regional District' },
]

const WATER_WATERSHED_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'majorWatershed', label: 'Major Watershed' },
  { value: 'watershedGroup', label: 'Watershed Group' },
  { value: 'assessmentWatershed', label: 'Assessment Watershed' },
]

const WATER_NR_ADMIN_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'nrArea', label: 'NR Area' },
  { value: 'nrRegion', label: 'NR Region' },
  { value: 'nrDistrict', label: 'NR District' },
]

const WATER_BOUNDARY_CONFIG: Record<WaterBoundaryLevel, BoundaryLevelConfig> = {
  healthAuthority: {
    path: '/data/boundaries/BCMoH/simplified/health_authorities.json',
    idField: 'HLTH_AUTHORITY_CODE',
    nameField: 'HLTH_AUTHORITY_NAME',
  },
  hsda: {
    path: '/data/boundaries/BCMoH/simplified/health_service_delivery_areas.json',
    idField: 'HLTH_SERVICE_DLVR_AREA_CODE',
    nameField: 'HLTH_SERVICE_DLVR_AREA_NAME',
  },
  lha: {
    path: '/data/boundaries/BCMoH/simplified/local_health_areas.json',
    idField: 'LOCAL_HLTH_AREA_CODE',
    nameField: 'LOCAL_HLTH_AREA_NAME',
  },
  chsa: {
    path: '/data/boundaries/BCMoH/simplified/community_health_service_areas.json',
    idField: 'CMNTY_HLTH_SERV_AREA_CODE',
    nameField: 'CMNTY_HLTH_SERV_AREA_NAME',
  },
  regionalDistrict: {
    path: '/data/boundaries/BC/regional_districts.geojson',
    idField: 'LGL_ADMIN_AREA_ID',
    nameField: 'ADMIN_AREA_NAME',
  },
  cd: {
    path: '/data/census/prince_george_cd.geo.json',
    idField: 'id',
    nameField: 'name',
  },
  csd: {
    path: '/data/census/prince_george_csd.geo.json',
    idField: 'id',
    nameField: 'name',
  },
  ct: {
    path: '/data/census/prince_george_ct.geo.json',
    idField: 'id',
    nameField: 'name',
  },
  da: {
    path: '/data/census/prince_george_da.geo.json',
    idField: 'id',
    nameField: 'name',
  },
  majorWatershed: {
    path: '/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
  },
  watershedGroup: {
    path: '/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
  },
  assessmentWatershed: {
    path: '/data/boundaries/BCFWA/assessment_watersheds.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
  },
  nrArea: {
    path: '/data/boundaries/BCNR/nr_areas.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
  },
  nrRegion: {
    path: '/data/boundaries/BCNR/nr_regions.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
  },
  nrDistrict: {
    path: '/data/boundaries/BCNR/nr_districts.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function firstString(record: Record<string, unknown>, keys: string[], fallback = ''): string {
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

function firstDate(record: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const value = record[key]
    const parsed = parseWaterDate(value)
    if (parsed) return parsed
  }
  return null
}

function findArray(data: unknown, keys: string[]): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord)
  if (!isRecord(data)) return []
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) return value.filter(isRecord)
  }
  return []
}

function collectRows(data: unknown, keys: string[]): Record<string, unknown>[] {
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

function normalizeFacility(record: Record<string, unknown>, index: number): WaterFacility | null {
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

function normalizeSample(record: Record<string, unknown>, index: number, kind: WaterSampleRow['kind']): WaterSampleRow {
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

function normalizeNotice(record: Record<string, unknown>, index: number): WaterNoticeRow {
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

function sameFacility(sample: WaterSampleRow | WaterNoticeRow, facility: WaterFacility): boolean {
  if ('noticeIds' in facility && facility.noticeIds?.includes(sample.id)) return true
  if (sample.facilityId && sample.facilityId === facility.id) return true
  return Boolean(sample.facilityName && sample.facilityName.toLowerCase() === facility.name.toLowerCase())
}

function getWaterPointCategory(facility: WaterFacility, layerMode: WaterLayerMode): WaterPointCategory {
  if (facility.activeNotices > 0) return 'notice'
  if (layerMode === 'samples') return 'samples'
  return 'facility'
}

function hexToRgba(hex: string, alpha: number): string {
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

function getBoundaryMetricLabel(metric: WaterBoundaryMetric): string {
  return WATER_BOUNDARY_METRIC_OPTIONS.find((option) => option.value === metric)?.label ?? 'Boundary metric'
}

function getHazardColorClass(rating: string): string {
  return WATER_HAZARD_COLORS[rating] ?? 'bg-gray-500'
}

function orderHazardRatings(ratings: string[]): string[] {
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

function getFacilitySampleTotal(facility: WaterFacility): number {
  return facility.bacteriologicalSamples + facility.chemicalResults
}

function getBoundaryMetricValue(properties: WaterBoundaryAggregateProperties, metric: WaterBoundaryMetric): number {
  if (metric === 'facilities') return properties.facilityCount
  if (metric === 'sampleRows') return properties.sampleRows
  if (metric === 'activeNotices') return properties.activeNotices
  return properties.avgSamplesPerFacility
}

function formatMetricValue(value: number, metric: WaterBoundaryMetric): string {
  if (metric === 'avgSamplesPerFacility') return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
  return Math.round(value).toLocaleString()
}

function formatUnknown(value: unknown): string {
  if (value == null || value === '') return 'None listed'
  if (value instanceof Date) return formatDate(value.toISOString())
  if (Array.isArray(value)) return value.map(formatUnknown).join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function getInspectionRows(facility: WaterFacility): Record<string, unknown>[] {
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

function getNoticeDetail(notice: WaterNoticeRow, key: string): string {
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

function getNoticeDetailsUrl(record: Record<string, unknown>): string {
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

function prepareBoundaries(data: BoundaryFeatureCollection | null, config: BoundaryLevelConfig): BoundaryFeatureCollection {
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

function useWaterJson<T>(active: boolean, filename: string) {
  return useJsonManifest<T>(active ? `${WATER_ROOT}/${filename}` : null)
}

export function useWaterData(active: boolean) {
  const [boundarySource, setBoundarySource] = useState<WaterBoundarySource>('bcHealth')
  const [boundaryLevel, setBoundaryLevel] = useState<WaterBoundaryLevel>('chsa')
  const [showBoundaries, setShowBoundaries] = useState(true)
  const [boundaryMetric, setBoundaryMetric] = useState<WaterBoundaryMetric>('avgSamplesPerFacility')
  const [selectedBoundaryId, setSelectedBoundaryId] = useState<string | null>(null)
  const [layerMode, setLayerMode] = useState<WaterLayerMode>('facilities')
  const [selectedHazardRatings, setSelectedHazardRatings] = useState<string[] | null>(null)
  const [selectedFacilityTypes, setSelectedFacilityTypes] = useState<string[] | null>(null)
  const [sampleKindFilter, setSampleKindFilter] = useState<WaterSampleKindFilter>('all')
  const [sampleParameterFilter, setSampleParameterFilter] = useState('all')
  const [showPoints, setShowPoints] = useState(true)
  const [visiblePointCategories, setVisiblePointCategories] = useState<WaterPointCategory[]>(WATER_POINT_CATEGORIES)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null)
  const [showSelectedFacilityReport, setShowSelectedFacilityReport] = useState(false)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(12)

  const manifest = useWaterJson<WaterManifest>(active, 'water_download_manifest.json')
  const facilitiesJson = useWaterJson<unknown>(active, 'drinking_water_facilities.json')
  const bacteriologicalJson = useWaterJson<unknown>(active, 'bacteriological_samples.json')
  const chemicalJson = useWaterJson<unknown>(active, 'chemical_samples.json')
  const noticesJson = useWaterJson<unknown>(active, 'active_water_notices.json')
  const combinedNoticesJson = useWaterJson<unknown>(active, 'combined_water_notices.json')
  const combinedNoticesSummary = useWaterJson<CombinedWaterNoticesSummary>(active, 'combined_water_notices_summary.json')
  const referenceJson = useWaterJson<unknown>(active, 'water_reference.json')
  const geocodedLocations = useJsonManifest<GeocodedLocationsFile>(active ? '/data/geocoding/geocoded_locations.json' : null)
  const boundaryConfig = WATER_BOUNDARY_CONFIG[boundaryLevel]
  const boundaryJson = useJsonManifest<BoundaryFeatureCollection>(active && showBoundaries ? boundaryConfig.path : null)

  const samples = useMemo(() => {
    const bacteriologicalRows: WaterSampleRow[] = []
    findArray(bacteriologicalJson.data, ['facilities', 'records', 'rows']).forEach((facility, facilityIndex) => {
      const facilityId = firstString(facility, ['facilityId', 'facility_id', 'details_url', 'id'], `bacteriological-facility-${facilityIndex}`)
      const facilityName = firstString(facility, ['facilityName', 'facility_name', 'name'])
      const rows = Array.isArray(facility.samples) ? facility.samples.filter(isRecord) : []
      rows.forEach((row, rowIndex) => {
        bacteriologicalRows.push(normalizeSample({
          ...row,
          facilityId,
          facilityName,
        }, bacteriologicalRows.length + rowIndex, 'bacteriological'))
      })
    })

    const chemicalRows: WaterSampleRow[] = []
    findArray(chemicalJson.data, ['facilities', 'records', 'rows']).forEach((facility, facilityIndex) => {
      const facilityId = firstString(facility, ['facilityId', 'facility_id', 'details_url', 'id'], `chemical-facility-${facilityIndex}`)
      const facilityName = firstString(facility, ['facilityName', 'facility_name', 'name'])
      const packages = Array.isArray(facility.chemical_result_packages) ? facility.chemical_result_packages.filter(isRecord) : []
      packages.forEach((samplePackage, packageIndex) => {
        const packageDate = firstString(samplePackage, ['date'])
        const results = Array.isArray(samplePackage.results) ? samplePackage.results.filter(isRecord) : []
        results.forEach((result, resultIndex) => {
          chemicalRows.push(normalizeSample({
            ...result,
            facilityId,
            facilityName,
            date: packageDate,
            sampleId: `${facilityId}-${packageIndex}-${resultIndex}`,
          }, chemicalRows.length + resultIndex, 'chemical'))
        })
      })
    })

    if (!bacteriologicalRows.length && !chemicalRows.length) {
      return [
        ...collectRows(bacteriologicalJson.data, ['sample', 'result']).map((row, index) => normalizeSample(row, index, 'bacteriological')),
        ...collectRows(chemicalJson.data, ['result']).map((row, index) => normalizeSample(row, index, 'chemical')),
      ]
    }
    return [...bacteriologicalRows, ...chemicalRows]
  }, [bacteriologicalJson.data, chemicalJson.data])

  const notices = useMemo(() => (
    findArray(combinedNoticesJson.data, ['notices', 'activeNotices', 'records', 'rows'])
      .map(normalizeNotice)
  ), [combinedNoticesJson.data])

  const fallbackNotices = useMemo(() => (
    findArray(noticesJson.data, ['notices', 'activeNotices', 'records', 'rows'])
      .map(normalizeNotice)
  ), [noticesJson.data])

  const activeNotices = notices.length > 0 ? notices : fallbackNotices

  const facilities = useMemo(() => {
    const geocodedByIndex = new Map(
      (geocodedLocations.data?.locations ?? [])
        .filter((location) => location.dataset === 'water_drinking')
        .map((location) => [location.source_index, location]),
    )
    const baseFacilities = findArray(facilitiesJson.data, ['facilities', 'records', 'rows'])
      .map((record, index) => {
        const facility = normalizeFacility(record, index)
        const geocoded = geocodedByIndex.get(index)
        if (!facility || !geocoded) return facility
        return {
          ...facility,
          latitude: geocoded.latitude,
          longitude: geocoded.longitude,
          geocodedAddress: geocoded.google_geocoded_address,
          geocodePartialMatch: geocoded.google_partial_match,
        }
      })
      .filter((facility): facility is WaterFacility => Boolean(facility))
    const mutableFacilities = baseFacilities.map((facility) => ({
      ...facility,
      noticeIds: facility.noticeIds ? [...facility.noticeIds] : undefined,
    }))
    const byId = new Map<string, WaterFacility>()
    const byName = new Map<string, WaterFacility>()

    for (const facility of mutableFacilities) {
      byId.set(facility.id, facility)
      byName.set(facility.name.toLowerCase(), facility)
    }

    const facilityUpdates = new Map<string, {
      bacteriologicalSamples: number
      chemicalResults: number
      activeNotices: number
      lastSampleDate: Date | null
      noticeIds: string[]
    }>()
    const getFacilityUpdate = (facility: WaterFacility) => {
      const existing = facilityUpdates.get(facility.id)
      if (existing) return existing
      const update = {
        bacteriologicalSamples: facility.bacteriologicalSamples,
        chemicalResults: facility.chemicalResults,
        activeNotices: facility.activeNotices,
        lastSampleDate: facility.lastSampleDate,
        noticeIds: [...(facility.noticeIds ?? [])],
      }
      facilityUpdates.set(facility.id, update)
      return update
    }

    for (const sample of samples) {
      const facility = (sample.facilityId && byId.get(sample.facilityId)) || (sample.facilityName && byName.get(sample.facilityName.toLowerCase()))
      if (!facility) continue
      const update = getFacilityUpdate(facility)
      if (sample.kind === 'bacteriological') update.bacteriologicalSamples += 1
      else update.chemicalResults += 1
      if (sample.date && (!update.lastSampleDate || sample.date > update.lastSampleDate)) update.lastSampleDate = sample.date
    }

    const matchedNoticeIds = new Set<string>()

    for (const notice of activeNotices) {
      const facility = (notice.facilityId && byId.get(notice.facilityId)) || (notice.facilityName && byName.get(notice.facilityName.toLowerCase()))
      if (!facility) continue
      const update = getFacilityUpdate(facility)
      update.activeNotices += 1
      update.noticeIds.push(notice.id)
      matchedNoticeIds.add(notice.id)
    }

    for (const notice of activeNotices) {
      if (matchedNoticeIds.has(notice.id) || notice.latitude == null || notice.longitude == null) continue
      const id = `notice-point:${notice.id}`
      byId.set(id, {
        id,
        name: notice.facilityName || `Notice ${notice.id}`,
        operator: '',
        type: notice.primarySource || 'Notice',
        status: notice.status,
        hazardRating: 'Unknown',
        address: '',
        community: notice.locationSummary,
        latitude: notice.latitude,
        longitude: notice.longitude,
        bacteriologicalSamples: 0,
        chemicalResults: 0,
        activeNotices: 1,
        lastSampleDate: null,
        noticeOnly: true,
        noticeIds: [notice.id],
        primarySource: notice.primarySource,
        mergeBucket: notice.mergeBucket,
        sourceCount: notice.sourceCount,
        source: notice.source,
      })
    }

    return Array.from(byId.values())
      .map((facility) => {
        const update = facilityUpdates.get(facility.id)
        return update
          ? { ...facility, ...update }
          : facility
      })
      .sort((left, right) => right.activeNotices - left.activeNotices || right.bacteriologicalSamples + right.chemicalResults - left.bacteriologicalSamples - left.chemicalResults)
  }, [activeNotices, facilitiesJson.data, geocodedLocations.data, samples])

  const hazardCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const facility of facilities) {
      if (facility.noticeOnly) continue
      const rating = facility.hazardRating || 'Unknown'
      counts[rating] = (counts[rating] ?? 0) + 1
    }
    return counts
  }, [facilities])

  const hazardOptions = useMemo(() => (
    orderHazardRatings(Object.keys(hazardCounts))
  ), [hazardCounts])

  const facilityTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const facility of facilities) {
      if (facility.noticeOnly) continue
      const type = facility.type || 'Unknown'
      counts[type] = (counts[type] ?? 0) + 1
    }
    return counts
  }, [facilities])

  const facilityTypeOptions = useMemo(() => (
    Object.keys(facilityTypeCounts).sort((left, right) => facilityTypeCounts[right] - facilityTypeCounts[left] || left.localeCompare(right))
  ), [facilityTypeCounts])

  const sampleKindCounts = useMemo(() => {
    const counts: Record<WaterSampleRow['kind'], number> = {
      bacteriological: 0,
      chemical: 0,
    }
    for (const sample of samples) {
      counts[sample.kind] += 1
    }
    return counts
  }, [samples])

  const sampleParameterCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const sample of samples) {
      if (sampleKindFilter !== 'all' && sample.kind !== sampleKindFilter) continue
      const parameter = sample.parameter || (sample.kind === 'bacteriological' ? 'Bacteriological' : 'Unknown')
      counts[parameter] = (counts[parameter] ?? 0) + 1
    }
    return counts
  }, [sampleKindFilter, samples])

  const sampleParameterOptions = useMemo(() => (
    Object.entries(sampleParameterCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([parameter, count]) => ({
        value: parameter,
        label: `${parameter} (${count.toLocaleString()})`,
      }))
  ), [sampleParameterCounts])

  const sampleDateRange = useMemo(() => {
    let min: Date | null = null
    let max: Date | null = null
    for (const sample of samples) {
      if (!sample.date) continue
      if (!min || sample.date < min) min = sample.date
      if (!max || sample.date > max) max = sample.date
    }
    const now = new Date()
    return {
      start: min ?? new Date(now.getFullYear(), 0, 1),
      end: max ?? new Date(now.getFullYear(), now.getMonth(), 1),
    }
  }, [samples])

  useEffect(() => {
    if (timelineEnabled && !timelineDate && samples.length > 0) {
      setTimelineDate(new Date(sampleDateRange.end.getFullYear(), sampleDateRange.end.getMonth(), 1))
    }
  }, [sampleDateRange.end, samples.length, timelineDate, timelineEnabled])

  const timelineFilterRange = useMemo(() => {
    if (!timelineEnabled || !timelineDate) return null
    const isCumulative = timelineWindowSize === -1
    const start = isCumulative
      ? new Date(sampleDateRange.start.getFullYear(), sampleDateRange.start.getMonth(), 1)
      : new Date(timelineDate.getFullYear(), timelineDate.getMonth(), 1)
    const end = new Date(
      timelineDate.getFullYear(),
      timelineDate.getMonth() + (isCumulative ? 1 : timelineWindowSize),
      0,
      23,
      59,
      59,
      999,
    )
    return { start: start.getTime(), end: end.getTime() }
  }, [sampleDateRange.start, timelineDate, timelineEnabled, timelineWindowSize])

  const filteredSamples = useMemo(() => {
    return samples.filter((sample) => {
      if (sampleKindFilter !== 'all' && sample.kind !== sampleKindFilter) return false
      if (sampleParameterFilter !== 'all') {
        const parameter = sample.parameter || (sample.kind === 'bacteriological' ? 'Bacteriological' : 'Unknown')
        if (parameter !== sampleParameterFilter) return false
      }
      if (!timelineFilterRange) return true
      if (!sample.date) return false
      const time = sample.date.getTime()
      return time >= timelineFilterRange.start && time <= timelineFilterRange.end
    })
  }, [sampleKindFilter, sampleParameterFilter, samples, timelineFilterRange])

  const facilityLookup = useMemo(() => ({
    byId: new Map(facilities.map((facility) => [facility.id, facility])),
    byName: new Map(facilities.map((facility) => [facility.name.toLowerCase(), facility])),
  }), [facilities])

  const activeFacilityIds = useMemo(() => {
    const sampleFilterActive = timelineFilterRange != null || sampleKindFilter !== 'all' || sampleParameterFilter !== 'all'
    if (!sampleFilterActive) return null
    const ids = new Set<string>()
    for (const sample of filteredSamples) {
      const facility = (sample.facilityId && facilityLookup.byId.get(sample.facilityId)) || (sample.facilityName && facilityLookup.byName.get(sample.facilityName.toLowerCase()))
      if (facility) ids.add(facility.id)
    }
    return ids
  }, [facilityLookup, filteredSamples, sampleKindFilter, sampleParameterFilter, timelineFilterRange])

  const facilityFilteredSampleCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sample of filteredSamples) {
      const facility = (sample.facilityId && facilityLookup.byId.get(sample.facilityId)) || (sample.facilityName && facilityLookup.byName.get(sample.facilityName.toLowerCase()))
      if (facility) counts.set(facility.id, (counts.get(facility.id) ?? 0) + 1)
    }
    return counts
  }, [facilityLookup, filteredSamples])

  const visibleFacilities = useMemo(() => {
    const modeFiltered = facilities.filter((facility) => {
      if (layerMode === 'notices') return facility.activeNotices > 0
      if (layerMode === 'samples') return !facility.noticeOnly && facility.bacteriologicalSamples + facility.chemicalResults > 0
      return !facility.noticeOnly
    })
    const facetFiltered = modeFiltered.filter((facility) => {
      if (facility.noticeOnly) return true
      const matchesHazard = !selectedHazardRatings || selectedHazardRatings.includes(facility.hazardRating || 'Unknown')
      const matchesType = !selectedFacilityTypes || selectedFacilityTypes.includes(facility.type || 'Unknown')
      return matchesHazard && matchesType
    })
    if (!activeFacilityIds) return facetFiltered
    return facetFiltered.filter((facility) => activeFacilityIds.has(facility.id))
  }, [activeFacilityIds, facilities, layerMode, selectedFacilityTypes, selectedHazardRatings])

  const mappedFacilities = useMemo(() => (
    visibleFacilities.filter((facility) => facility.latitude != null && facility.longitude != null)
  ), [visibleFacilities])

  const visibleNoticeCount = useMemo(() => (
    visibleFacilities.reduce((sum, facility) => sum + facility.activeNotices, 0)
  ), [visibleFacilities])

  const selectedFacility = useMemo(() => (
    selectedFacilityId ? facilities.find((facility) => facility.id === selectedFacilityId) ?? null : null
  ), [facilities, selectedFacilityId])

  const selectedFacilitySamples = useMemo(() => (
    selectedFacility
      ? samples
        .filter((sample) => sameFacility(sample, selectedFacility))
        .sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0))
      : []
  ), [samples, selectedFacility])

  const selectedFacilityNotices = useMemo(() => (
    selectedFacility
      ? activeNotices
        .filter((notice) => sameFacility(notice, selectedFacility))
        .sort((left, right) => (right.date?.getTime() ?? 0) - (left.date?.getTime() ?? 0))
      : []
  ), [activeNotices, selectedFacility])

  const selectedFacilityInspections = useMemo(() => (
    selectedFacility ? getInspectionRows(selectedFacility) : []
  ), [selectedFacility])

  useEffect(() => {
    if (sampleParameterFilter !== 'all' && !sampleParameterOptions.some((option) => option.value === sampleParameterFilter)) {
      setSampleParameterFilter('all')
    }
  }, [sampleParameterFilter, sampleParameterOptions])

  useEffect(() => {
    if (!selectedFacilityId) setShowSelectedFacilityReport(false)
  }, [selectedFacilityId])

  const bucketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sample of samples) {
      if (!sample.date) continue
      const key = `${sample.date.getFullYear()}-${String(sample.date.getMonth()).padStart(2, '0')}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [samples])

  const heatmapData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: mappedFacilities.map((facility) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [facility.longitude as number, facility.latitude as number] },
      properties: {
        id: facility.id,
        weight: Math.max(1, facility.activeNotices * 8 + (facilityFilteredSampleCounts.get(facility.id) ?? getFacilitySampleTotal(facility))),
      },
    })),
  }), [facilityFilteredSampleCounts, mappedFacilities])

  const facilityPointData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point, WaterFacilityFeatureProperties>>(() => ({
    type: 'FeatureCollection',
    features: mappedFacilities.flatMap((facility) => {
      const categories: WaterPointCategory[] = []
      if (!facility.noticeOnly) categories.push('facility')
      if (!facility.noticeOnly && getFacilitySampleTotal(facility) > 0) categories.push('samples')
      if (facility.activeNotices > 0) categories.push('notice')
      return categories.map((category) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [facility.longitude as number, facility.latitude as number] },
        properties: {
          id: facility.id,
          name: facility.name,
          category,
        },
      }))
    }),
  }), [mappedFacilities])

  const togglePointCategory = useCallback((category: WaterPointCategory) => {
    setVisiblePointCategories((current) => (
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category]
    ))
  }, [])

  const boundaryLevelOptions = boundarySource === 'bcHealth'
    ? WATER_HEALTH_LEVEL_OPTIONS
    : boundarySource === 'regionalDistrict'
      ? WATER_REGIONAL_DISTRICT_LEVEL_OPTIONS
    : boundarySource === 'census'
      ? WATER_CENSUS_LEVEL_OPTIONS
      : boundarySource === 'watershed'
        ? WATER_WATERSHED_LEVEL_OPTIONS
        : WATER_NR_ADMIN_LEVEL_OPTIONS

  const boundaries = useMemo(() => prepareBoundaries(boundaryJson.data, boundaryConfig), [boundaryConfig, boundaryJson.data])

  const boundaryData = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, WaterBoundaryAggregateProperties>>(() => ({
    type: 'FeatureCollection',
    features: boundaries.features.map((feature, index) => {
      const boundaryId = String(feature.properties?.boundaryId ?? feature.id ?? index)
      const boundaryName = String(feature.properties?.boundaryName ?? 'Boundary')
      const containedFacilities = mappedFacilities.filter((facility) => (
        booleanPointInPolygon(point([facility.longitude as number, facility.latitude as number]), feature)
      ))
      const properties: WaterBoundaryAggregateProperties = {
        ...feature.properties,
        boundaryId,
        boundaryName,
        facilityCount: containedFacilities.length,
        sampleRows: containedFacilities.reduce((sum, facility) => sum + (facilityFilteredSampleCounts.get(facility.id) ?? getFacilitySampleTotal(facility)), 0),
        avgSamplesPerFacility: 0,
        activeNotices: containedFacilities.reduce((sum, facility) => sum + facility.activeNotices, 0),
        metricValue: 0,
      }
      properties.avgSamplesPerFacility = properties.facilityCount > 0 ? properties.sampleRows / properties.facilityCount : 0
      properties.metricValue = getBoundaryMetricValue(properties, boundaryMetric)
      return {
        ...feature,
        id: boundaryId,
        properties,
      }
    }),
  }), [boundaries, boundaryMetric, facilityFilteredSampleCounts, mappedFacilities])

  const boundaryMaxValue = useMemo(() => (
    Math.max(1, ...boundaryData.features.map((feature) => feature.properties?.metricValue ?? 0))
  ), [boundaryData])

  const selectedBoundary = useMemo(() => (
    selectedBoundaryId
      ? boundaryData.features.find((feature) => feature.properties.boundaryId === selectedBoundaryId) ?? null
      : null
  ), [boundaryData, selectedBoundaryId])

  const handleBoundarySourceChange = useCallback((source: WaterBoundarySource) => {
    setBoundarySource(source)
    setBoundaryLevel(
      source === 'bcHealth'
        ? 'chsa'
        : source === 'regionalDistrict'
          ? 'regionalDistrict'
          : source === 'census'
            ? 'da'
            : source === 'watershed'
              ? 'watershedGroup'
              : 'nrDistrict',
    )
    setShowBoundaries(true)
    setSelectedBoundaryId(null)
  }, [])

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  const toggleHazardRating = useCallback((rating: string) => {
    const current = selectedHazardRatings ?? hazardOptions
    setSelectedHazardRatings(current.includes(rating)
      ? current.filter((value) => value !== rating)
      : [...current, rating])
  }, [hazardOptions, selectedHazardRatings])

  const toggleFacilityType = useCallback((type: string) => {
    const current = selectedFacilityTypes ?? facilityTypeOptions
    setSelectedFacilityTypes(current.includes(type)
      ? current.filter((value) => value !== type)
      : [...current, type])
  }, [facilityTypeOptions, selectedFacilityTypes])

  return {
    manifest,
    facilitiesJson,
    bacteriologicalJson,
    chemicalJson,
    noticesJson,
    combinedNoticesJson,
    combinedNoticesSummary,
    referenceJson,
    geocodedLocations,
    boundaryJson,
    boundarySource,
    boundaryLevel,
    boundaryLevelOptions,
    showBoundaries,
    setShowBoundaries,
    boundaryMetric,
    setBoundaryMetric,
    selectedBoundaryId,
    setSelectedBoundaryId,
    handleBoundarySourceChange,
    setBoundaryLevel,
    layerMode,
    setLayerMode,
    hazardOptions,
    hazardCounts,
    selectedHazardRatings,
    toggleHazardRating,
    facilityTypeOptions,
    facilityTypeCounts,
    selectedFacilityTypes,
    toggleFacilityType,
    sampleKindFilter,
    setSampleKindFilter,
    sampleKindCounts,
    sampleParameterFilter,
    setSampleParameterFilter,
    sampleParameterOptions,
    sampleParameterCounts,
    showPoints,
    setShowPoints,
    visiblePointCategories,
    togglePointCategory,
    showHeatmap,
    setShowHeatmap,
    facilities,
    visibleFacilities,
    visibleNoticeCount,
    mappedFacilities,
    samples,
    filteredSamples,
    notices: activeNotices,
    combinedNoticeCount: notices.length,
    selectedFacility,
    selectedFacilitySamples,
    selectedFacilityNotices,
    selectedFacilityInspections,
    selectedFacilityId,
    setSelectedFacilityId,
    showSelectedFacilityReport,
    setShowSelectedFacilityReport,
    sampleDateRange,
    bucketCounts,
    timelineEnabled,
    setTimelineEnabled,
    timelineDate,
    setTimelineDate,
    timelineWindowSize,
    setTimelineWindowSize,
    handleTimelineDisable,
    heatmapData,
    facilityPointData,
    boundaries,
    boundaryData,
    boundaryMaxValue,
    selectedBoundary,
  }
}

export type WaterState = ReturnType<typeof useWaterData>

export function WaterLayerControls({ water }: { water: WaterState }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ToggleChip
        active={water.showPoints}
        onClick={() => water.setShowPoints((current) => !current)}
      >
        {water.showPoints ? 'Hide points' : 'Show points'}
      </ToggleChip>
      <ToggleChip
        active={water.showHeatmap}
        onClick={() => water.setShowHeatmap((current) => !current)}
        tone="cyan"
      >
        {water.showHeatmap ? 'Hide heatmap' : 'Show heatmap'}
      </ToggleChip>
      <ToggleChip
        active={water.timelineEnabled}
        onClick={() => water.setTimelineEnabled((current) => !current)}
        tone="violet"
      >
        {water.timelineEnabled ? 'Hide timeline' : 'Show timeline'}
      </ToggleChip>
    </div>
  )
}

export function WaterSidebar({ water }: { water: WaterState }) {
  return (
    <>
      <StudyAreaSelector<WaterBoundarySource, WaterBoundaryLevel>
        source={water.showBoundaries ? water.boundarySource : undefined}
        sourceOptions={WATER_SOURCE_OPTIONS}
        level={water.boundaryLevel}
        levelOptions={water.showBoundaries ? water.boundaryLevelOptions : []}
        onSourceChange={water.handleBoundarySourceChange}
        onSelectedSourceClick={() => water.setShowBoundaries(false)}
        onLevelChange={water.setBoundaryLevel}
        levelSelectId="water-study-area-level"
      />

      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Droplets className="h-4 w-4 text-sky-600" />
          <h2 className="text-sm font-semibold text-foreground">Drinking Water</h2>
        </div>
        <div className="space-y-3">
          <label className="block text-xs font-medium text-foreground">
            Layer
            <AppSelect
              value={water.layerMode}
              onValueChange={(value) => water.setLayerMode(value as WaterLayerMode)}
              options={[
                { value: 'facilities', label: 'Facilities' },
                { value: 'samples', label: 'Sampling activity' },
                { value: 'notices', label: 'Active notices' },
              ]}
              className="mt-1"
              triggerClassName="h-8 rounded-md text-xs"
            />
          </label>
          {water.showBoundaries && (
            <label className="block text-xs font-medium text-foreground">
              Boundary metric
              <AppSelect
                value={water.boundaryMetric}
                onValueChange={(value) => water.setBoundaryMetric(value as WaterBoundaryMetric)}
                options={WATER_BOUNDARY_METRIC_OPTIONS}
                className="mt-1"
                triggerClassName="h-8 rounded-md text-xs"
              />
            </label>
          )}
          <StatGrid
            columns={2}
            stats={[
              { label: water.layerMode === 'notices' ? 'visible notices' : 'visible facilities', value: water.visibleFacilities.length.toLocaleString() },
              { label: 'sample rows', value: water.filteredSamples.length.toLocaleString() },
              { label: 'active notices', value: water.visibleNoticeCount.toLocaleString() },
              { label: 'mapped now', value: water.mappedFacilities.length.toLocaleString() },
            ]}
          />
          {water.selectedBoundary && <WaterBoundarySummary water={water} />}
          {water.selectedFacility && <WaterFacilityDetailCard water={water} />}
          {water.facilities.length === 0 && (water.facilitiesJson.error || water.bacteriologicalJson.error || water.chemicalJson.error || water.noticesJson.error) && (
            <InlineAlert tone="warning">
              Water JSON files were not found at {WATER_ROOT}. Copy the downloaded files into public/data/water to populate this section.
            </InlineAlert>
          )}
          {!water.facilitiesJson.error && water.facilities.length > 0 && water.mappedFacilities.length === 0 && (
            <InlineAlert tone="warning">
              The copied water facility records do not include coordinates, so this section can summarize the files and timeline but cannot place facility markers yet.
            </InlineAlert>
          )}
          {!water.geocodedLocations.error && water.facilities.length > 0 && water.mappedFacilities.length > 0 && (
            <InlineAlert>
              Using consolidated Google geocodes for mapped water locations.
            </InlineAlert>
          )}
        </div>
      </div>

      <div className="space-y-4 border-b border-border bg-background/95 p-4">
        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">Hazard Rating</h3>
          <div className="flex flex-wrap gap-2">
            {water.hazardOptions.map((rating) => {
              const selected = !water.selectedHazardRatings || water.selectedHazardRatings.includes(rating)
              return (
                <button
                  key={rating}
                  type="button"
                  onClick={() => water.toggleHazardRating(rating)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border transition-colors',
                    selected
                      ? `${getHazardColorClass(rating)} text-white border-transparent`
                      : 'border-input bg-background text-foreground hover:bg-accent',
                  )}
                >
                  {rating}
                  <span className="ml-1 opacity-75">({(water.hazardCounts[rating] ?? 0).toLocaleString()})</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">Facility Type</h3>
          <div className="flex flex-wrap gap-2">
            {water.facilityTypeOptions.map((facilityType) => {
              const selected = !water.selectedFacilityTypes || water.selectedFacilityTypes.includes(facilityType)
              return (
                <button
                  key={facilityType}
                  type="button"
                  onClick={() => water.toggleFacilityType(facilityType)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border transition-colors',
                    selected
                      ? 'bg-sky-500 text-white border-transparent'
                      : 'border-input bg-background text-foreground hover:bg-accent',
                  )}
                >
                  {facilityType}
                  <span className="ml-1 opacity-75">({(water.facilityTypeCounts[facilityType] ?? 0).toLocaleString()})</span>
                </button>
              )
            })}
          </div>
        </div>

        <div>
          <h3 className="mb-2 text-sm font-medium text-foreground">Sample Type</h3>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'all' as const, label: 'All', count: water.samples.length },
              { value: 'bacteriological' as const, label: 'Bacteriological', count: water.sampleKindCounts.bacteriological },
              { value: 'chemical' as const, label: 'Chemical', count: water.sampleKindCounts.chemical },
            ].map((option) => {
              const selected = water.sampleKindFilter === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => water.setSampleKindFilter(option.value)}
                  className={cn(
                    'px-3 py-1 text-xs rounded-full border transition-colors',
                    selected
                      ? 'bg-cyan-600 text-white border-transparent'
                      : 'border-input bg-background text-foreground hover:bg-accent',
                  )}
                >
                  {option.label}
                  <span className="ml-1 opacity-75">({option.count.toLocaleString()})</span>
                </button>
              )
            })}
          </div>
        </div>

        <label className="block text-xs font-medium text-foreground">
          Sample parameter
          <AppSelect
            value={water.sampleParameterFilter}
            onValueChange={water.setSampleParameterFilter}
            options={[
              { value: 'all', label: 'All parameters' },
              ...water.sampleParameterOptions,
            ]}
            className="mt-1"
            triggerClassName="h-8 rounded-md text-xs"
          />
        </label>
      </div>
      {water.showSelectedFacilityReport && water.selectedFacility && (
        <WaterSamplingReportModal water={water} onClose={() => water.setShowSelectedFacilityReport(false)} />
      )}
    </>
  )
}

function WaterBoundarySummary({ water }: { water: WaterState }) {
  const properties = water.selectedBoundary?.properties
  if (!properties) return null

  return (
    <div className="rounded-md border border-sky-200 bg-sky-50/80 p-3 text-xs text-sky-950 dark:border-sky-900/60 dark:bg-sky-950/25 dark:text-sky-50">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">Selected scope</div>
      <div className="mt-1 font-semibold">{properties.boundaryName}</div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="text-sky-800/75 dark:text-sky-200/75">Facilities</span>
        <span className="text-right font-medium">{properties.facilityCount.toLocaleString()}</span>
        <span className="text-sky-800/75 dark:text-sky-200/75">Sample rows</span>
        <span className="text-right font-medium">{properties.sampleRows.toLocaleString()}</span>
        <span className="text-sky-800/75 dark:text-sky-200/75">Avg / facility</span>
        <span className="text-right font-medium">{formatMetricValue(properties.avgSamplesPerFacility, 'avgSamplesPerFacility')}</span>
        <span className="text-sky-800/75 dark:text-sky-200/75">Active notices</span>
        <span className="text-right font-medium">{properties.activeNotices.toLocaleString()}</span>
      </div>
      <button
        type="button"
        className="mt-2 text-[11px] font-medium text-sky-700 hover:text-sky-950 dark:text-sky-300 dark:hover:text-sky-100"
        onClick={() => water.setSelectedBoundaryId(null)}
      >
        Clear scope
      </button>
    </div>
  )
}

function WaterFacilityPopupCard({ facility, onOpenReport }: { facility: WaterFacility; onOpenReport: () => void }) {
  const sampleRows = facility.bacteriologicalSamples + facility.chemicalResults
  return (
    <div className="w-72 text-xs">
      <div className="pr-6">
        <div className="font-semibold leading-snug text-foreground">{facility.name}</div>
        <div className="mt-1 text-muted-foreground">{facility.community || facility.address || 'No locality provided'}</div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded border border-border p-2">
          <div className="font-semibold text-foreground">{sampleRows.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">samples</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="font-semibold text-foreground">{facility.activeNotices.toLocaleString()}</div>
          <div className="text-[10px] text-muted-foreground">notices</div>
        </div>
        <div className="rounded border border-border p-2">
          <div className="font-semibold text-foreground">{formatDate(facility.lastSampleDate?.toISOString())}</div>
          <div className="text-[10px] text-muted-foreground">latest</div>
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenReport}
        className="mt-3 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700"
      >
        {facility.noticeOnly ? 'Open notice details' : 'Open sampling report'}
      </button>
    </div>
  )
}

function WaterFacilityDetailCard({ water }: { water: WaterState }) {
  const facility = water.selectedFacility
  if (!facility) return null
  const sampleRows = facility.bacteriologicalSamples + facility.chemicalResults

  return (
    <div className="rounded-md border border-border bg-background p-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-foreground">{facility.name}</div>
          <div className="mt-1 text-muted-foreground">{facility.community || facility.address || 'No locality provided'}</div>
        </div>
        <button
          type="button"
          className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          onClick={() => water.setSelectedFacilityId(null)}
        >
          Clear
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="text-muted-foreground">Bacteriological</span>
        <span className="text-right font-medium">{facility.bacteriologicalSamples.toLocaleString()}</span>
        <span className="text-muted-foreground">Chemical</span>
        <span className="text-right font-medium">{facility.chemicalResults.toLocaleString()}</span>
        <span className="text-muted-foreground">All sample rows</span>
        <span className="text-right font-medium">{sampleRows.toLocaleString()}</span>
        <span className="text-muted-foreground">Active notices</span>
        <span className="text-right font-medium">{facility.activeNotices.toLocaleString()}</span>
        <span className="text-muted-foreground">Last sample</span>
        <span className="text-right font-medium">{formatDate(facility.lastSampleDate?.toISOString())}</span>
      </div>
      {facility.geocodedAddress && (
        <div className="mt-2 border-t border-border pt-2 text-muted-foreground">
          {facility.geocodedAddress}
          {facility.geocodePartialMatch ? ' (partial match)' : ''}
        </div>
      )}
      <button
        type="button"
        className="mt-3 w-full rounded-md bg-sky-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700"
        onClick={() => water.setShowSelectedFacilityReport(true)}
      >
        {facility.noticeOnly ? 'Open notice details' : 'Open sampling report'}
      </button>

      <WaterDetailSection title="Active notices" count={water.selectedFacilityNotices.length}>
        {water.selectedFacilityNotices.length === 0 ? (
          <EmptyWaterDetail label="No active notices for this facility." />
        ) : water.selectedFacilityNotices.map((notice) => (
          <WaterNoticeCard key={notice.id} notice={notice} compact />
        ))}
      </WaterDetailSection>

      <WaterDetailSection title="Sampling" count={water.selectedFacilitySamples.length}>
        {water.selectedFacilitySamples.length === 0 ? (
          <EmptyWaterDetail label="No sample rows for this facility." />
        ) : water.selectedFacilitySamples.map((sample) => (
          <div key={sample.id} className="rounded border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium capitalize text-foreground">{sample.kind}</div>
              <div className="text-muted-foreground">{formatDate(sample.date?.toISOString())}</div>
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1 text-muted-foreground">
              <span>Parameter</span>
              <span className="text-right text-foreground">{sample.parameter || formatUnknown(sample.source.type)}</span>
              <span>Result</span>
              <span className="text-right text-foreground">{sample.result || formatUnknown(sample.source.value)}</span>
              {sample.kind === 'bacteriological' && (
                <>
                  <span>Total coliform</span>
                  <span className="text-right text-foreground">{formatUnknown(sample.source.total_coliform)}</span>
                  <span>E. coli</span>
                  <span className="text-right text-foreground">{formatUnknown(sample.source.e_coli)}</span>
                </>
              )}
            </div>
          </div>
        ))}
      </WaterDetailSection>

      <WaterDetailSection title="Facility history" count={water.selectedFacilityInspections.length}>
        {water.selectedFacilityInspections.length === 0 ? (
          <EmptyWaterDetail label="No inspection history included in the copied facility record." />
        ) : water.selectedFacilityInspections.map((inspection, index) => (
          <div key={`${facility.id}-inspection-${index}`} className="rounded border border-border p-2">
            <div className="flex items-start justify-between gap-2">
              <div className="font-medium text-foreground">{firstString(inspection, ['type', 'inspectionType', 'description'], `History ${index + 1}`)}</div>
              <div className="text-muted-foreground">{formatDate(firstDate(inspection, ['date', 'inspectionDate', 'inspection_date'])?.toISOString())}</div>
            </div>
            <div className="mt-1 text-muted-foreground">{firstString(inspection, ['result', 'status', 'summary', 'comments'], 'No summary listed')}</div>
          </div>
        ))}
      </WaterDetailSection>
    </div>
  )
}

function WaterDetailSection({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <div className="mt-3 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold text-foreground">{title}</div>
        <div className="text-[10px] tabular-nums text-muted-foreground">{count.toLocaleString()}</div>
      </div>
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {children}
      </div>
    </div>
  )
}

function EmptyWaterDetail({ label }: { label: string }) {
  return (
    <div className="rounded border border-dashed border-border p-2 text-muted-foreground">{label}</div>
  )
}

function WaterNoticeCard({ notice, compact = false }: { notice: WaterNoticeRow; compact?: boolean }) {
  const underlyingProblems = getNoticeDetail(notice, 'underlying_problems')
  const stepsTaken = getNoticeDetail(notice, 'steps_taken_to_remedy')
  const correctiveActions = getNoticeDetail(notice, 'corrective_actions_remaining')
  const waterTodayDetails = getNoticeDetail(notice, 'details') || getNoticeDetail(notice, 'map_details')
  const detailsUrl = getNoticeDetailsUrl(notice.source)

  return (
    <div className={cn('rounded border border-border bg-background', compact ? 'p-2' : 'p-3 text-sm')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="font-medium text-foreground">{notice.type}</div>
        <div className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-900/50 dark:text-red-200">
          Active
        </div>
      </div>
      <div className="mt-1 flex justify-between gap-2 text-muted-foreground">
        <span>{notice.primarySource || notice.status}{notice.sourceCount > 1 ? ` +${notice.sourceCount - 1}` : ''}</span>
        <span>Started {formatDate(notice.date?.toISOString())}</span>
      </div>
      {(underlyingProblems || stepsTaken || correctiveActions || waterTodayDetails || detailsUrl) && (
        <div className={cn('mt-2 space-y-2 border-t border-border pt-2', compact ? 'text-[11px]' : 'text-xs')}>
          {underlyingProblems && (
            <div>
              <div className="font-medium text-foreground">Underlying problems</div>
              <div className="mt-0.5 leading-relaxed text-muted-foreground">{underlyingProblems}</div>
            </div>
          )}
          {stepsTaken && (
            <div>
              <div className="font-medium text-foreground">Steps taken to remedy</div>
              <div className="mt-0.5 leading-relaxed text-muted-foreground">{stepsTaken}</div>
            </div>
          )}
          {correctiveActions && (
            <div>
              <div className="font-medium text-foreground">Corrective actions remaining</div>
              <div className="mt-0.5 leading-relaxed text-muted-foreground">{correctiveActions}</div>
            </div>
          )}
          {!underlyingProblems && waterTodayDetails && (
            <div>
              <div className="font-medium text-foreground">Notice details</div>
              <div className="mt-0.5 whitespace-pre-line leading-relaxed text-muted-foreground">{waterTodayDetails}</div>
            </div>
          )}
          {detailsUrl && (
            <a
              href={detailsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-[11px] font-medium text-sky-700 hover:text-sky-950 dark:text-sky-300 dark:hover:text-sky-100"
            >
              View source
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function WaterSamplingReportModal({ water, onClose }: { water: WaterState; onClose: () => void }) {
  const facility = water.selectedFacility

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeydown)
    return () => window.removeEventListener('keydown', handleKeydown)
  }, [onClose])

  if (!facility) return null

  const detailsUrl = getNoticeDetailsUrl(facility.source) || firstString(facility.source, ['details_url'])
  const sampleRows = facility.bacteriologicalSamples + facility.chemicalResults

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-border bg-background/95 shadow-2xl backdrop-blur">
        <div className="shrink-0 border-b border-border bg-background/90 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-xl font-bold text-foreground">{facility.name}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{facility.community || facility.address || facility.geocodedAddress || 'No locality provided'}</p>
              {facility.geocodedAddress && (
                <p className="mt-1 text-xs text-muted-foreground">{facility.geocodedAddress}</p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close sampling report"
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{sampleRows.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Samples</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{facility.bacteriologicalSamples.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Bacteriological</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{facility.chemicalResults.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Chemical</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-2xl font-bold text-foreground">{facility.activeNotices.toLocaleString()}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Notices</div>
            </div>
            <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
              <div className="text-lg font-bold text-foreground">{formatDate(facility.lastSampleDate?.toISOString())}</div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Latest</div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-muted/20 p-4 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.45fr)]">
            <section>
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Sampling</h3>
                <span className="text-xs tabular-nums text-muted-foreground">{water.selectedFacilitySamples.length.toLocaleString()}</span>
              </div>
              <WaterSamplingGrid samples={water.selectedFacilitySamples} />
            </section>

            <aside className="space-y-6">
              <section>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Active notices</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">{water.selectedFacilityNotices.length.toLocaleString()}</span>
                </div>
                <div className="space-y-3">
                  {water.selectedFacilityNotices.length === 0 ? (
                    <EmptyWaterDetail label="No active notices for this facility." />
                  ) : water.selectedFacilityNotices.map((notice) => (
                    <WaterNoticeCard key={notice.id} notice={notice} />
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-foreground">Facility history</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">{water.selectedFacilityInspections.length.toLocaleString()}</span>
                </div>
                <div className="space-y-3">
                  {water.selectedFacilityInspections.length === 0 ? (
                    <EmptyWaterDetail label="No inspection history included in the copied facility record." />
                  ) : water.selectedFacilityInspections.map((inspection, index) => (
                    <div key={`${facility.id}-modal-inspection-${index}`} className="rounded-lg border border-border bg-background p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-foreground">{firstString(inspection, ['document_type', 'type', 'inspectionType', 'description'], `History ${index + 1}`)}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(firstDate(inspection, ['date', 'inspectionDate', 'inspection_date'])?.toISOString())}</div>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">{firstString(inspection, ['hazard_rating', 'result', 'status', 'summary', 'comments'], 'No summary listed')}</div>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-background/90 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-muted-foreground">
              Data from {facility.primarySource || (facility.noticeOnly ? 'WaterToday / HealthSpace combined notices' : 'Northern Health Authority HealthSpace')}
            </div>
            <div className="flex flex-wrap gap-2">
              {detailsUrl && (
                <a
                  href={detailsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center rounded-lg border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
                >
                  View source
                </a>
              )}
              <button
                type="button"
                onClick={onClose}
                className="inline-flex items-center justify-center rounded-lg border border-input bg-secondary px-4 py-2 text-sm font-medium text-secondary-foreground transition-colors hover:bg-accent"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function WaterSamplingGrid({ samples }: { samples: WaterSampleRow[] }) {
  if (samples.length === 0) {
    return <EmptyWaterDetail label="No sample rows for this facility." />
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background shadow-sm">
      <div className="max-h-[58vh] overflow-auto">
        <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted/90 text-[10px] uppercase tracking-wide text-muted-foreground backdrop-blur">
            <tr>
              <th className="border-b border-border px-3 py-2 font-semibold">Date</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Type</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Parameter</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Result</th>
              <th className="border-b border-border px-3 py-2 font-semibold">Sample details</th>
            </tr>
          </thead>
          <tbody>
            {samples.map((sample, index) => (
              <WaterSamplingGridRow key={`${sample.id}-${index}`} sample={sample} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WaterSamplingGridRow({ sample }: { sample: WaterSampleRow }) {
  const isBacteriological = sample.kind === 'bacteriological'
  const result = sample.result || formatUnknown(sample.source.value)
  const details = isBacteriological
    ? [
      ['Location', formatUnknown(sample.source.location)],
      ['Total coliform', formatUnknown(sample.source.total_coliform)],
      ['E. coli', formatUnknown(sample.source.e_coli)],
    ].filter(([, value]) => value && value !== 'None listed')
    : []

  return (
    <tr className="align-top odd:bg-muted/20">
      <td className="border-b border-border/70 px-3 py-2 whitespace-nowrap text-muted-foreground">
        {formatDate(sample.date?.toISOString())}
      </td>
      <td className="border-b border-border/70 px-3 py-2">
        <span className={cn(
          'inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
          sample.kind === 'chemical'
            ? 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200'
            : 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200',
        )}>
          {sample.kind}
        </span>
      </td>
      <td className="border-b border-border/70 px-3 py-2 font-medium text-foreground">
        {sample.parameter || 'Unknown parameter'}
      </td>
      <td className="border-b border-border/70 px-3 py-2 font-mono text-foreground">
        {result}
      </td>
      <td className="border-b border-border/70 px-3 py-2 text-muted-foreground">
        {details.length === 0 ? (
          <span className="text-muted-foreground/70">-</span>
        ) : (
          <div className="space-y-1">
            {details.map(([label, value]) => (
              <div key={label}>
                <span className="font-medium text-foreground">{label}: </span>
                {value}
              </div>
            ))}
          </div>
        )}
      </td>
    </tr>
  )
}

export function WaterLayer({ water }: { water: WaterState }) {
  const pointCollections = useMemo(() => (
    WATER_POINT_CATEGORIES
      .filter((category) => water.visiblePointCategories.includes(category))
      .map((category) => {
        const features = water.facilityPointData.features.filter((feature) => feature.properties.category === category)
        return [category, { type: 'FeatureCollection' as const, features }] as const
      })
      .filter(([, collection]) => collection.features.length > 0)
  ), [water.facilityPointData, water.visiblePointCategories])

  const boundaryFillColor = useMemo(() => ([
    'interpolate',
    ['linear'],
    ['coalesce', ['to-number', ['get', 'metricValue']], 0],
    0,
    '#e0f2fe',
    water.boundaryMaxValue * 0.5,
    '#38bdf8',
    water.boundaryMaxValue,
    '#0369a1',
  ]), [water.boundaryMaxValue])

  return (
    <>
      {water.showBoundaries && water.boundaryData.features.length > 0 && (
        <MapFillLayer
          key={`water-boundaries-${water.boundaryMetric}-${water.boundaryMaxValue}`}
          data={water.boundaryData}
          fillColor={boundaryFillColor}
          fillOpacity={0.22}
          lineColor="#0284c7"
          lineWidth={0.8}
          lineOpacity={0.55}
          idProperty="boundaryId"
          selectedId={water.selectedBoundaryId}
          selectionColor="#0f172a"
          selectionWidth={2}
          onFeatureClick={water.setSelectedBoundaryId}
          visible
        />
      )}
      {water.showHeatmap && (
        <MapHeatmapLayer
          data={water.heatmapData}
          weight={['interpolate', ['linear'], ['coalesce', ['get', 'weight'], 1], 1, 0.2, 50, 1]}
          intensityStops={[
            [8, 0.6],
            [11, 1.1],
            [14, 1.7],
          ]}
          radiusStops={[
            [8, 14],
            [11, 26],
            [14, 42],
          ]}
          opacity={[
            [8, 0.45],
            [14, 0.72],
          ]}
          colorRamp="air"
        />
      )}
      {water.showPoints && pointCollections.map(([category, collection]) => {
        const color = WATER_POINT_COLORS[category]
        const clusterColors: [string, string, string] = [
          hexToRgba(color, 0.65),
          hexToRgba(color, 0.8),
          color,
        ]

        return (
          <MapClusterLayer<WaterFacilityFeatureProperties>
            key={category}
            data={collection}
            pointColor={color}
            clusterColors={clusterColors}
            clusterThresholds={[40, 150]}
            onPointClick={(feature) => {
              const id = feature.properties?.id
              if (id) water.setSelectedFacilityId(id)
            }}
          />
        )
      })}
      {water.selectedFacility?.latitude != null && water.selectedFacility.longitude != null && (
        <>
          <MapMarker
            longitude={water.selectedFacility.longitude}
            latitude={water.selectedFacility.latitude}
          >
            <MarkerContent>
              <div
                className="h-5 w-5 rounded-full border-2 border-white shadow-lg ring-2 ring-sky-500 ring-offset-2"
                style={{ backgroundColor: WATER_POINT_COLORS[getWaterPointCategory(water.selectedFacility, water.layerMode)] }}
              />
            </MarkerContent>
          </MapMarker>
          <MapPopup
            key={water.selectedFacility.id}
            longitude={water.selectedFacility.longitude}
            latitude={water.selectedFacility.latitude}
            closeButton
            onClose={() => water.setSelectedFacilityId(null)}
            className="max-w-xs"
          >
            <WaterFacilityPopupCard
              facility={water.selectedFacility}
              onOpenReport={() => water.setShowSelectedFacilityReport(true)}
            />
          </MapPopup>
        </>
      )}
    </>
  )
}

export function WaterLegend({ water }: { water: WaterState }) {
  const togglePointCategory = (category: WaterPointCategory) => {
    if (!water.showPoints) {
      water.setShowPoints(true)
      if (!water.visiblePointCategories.includes(category)) water.togglePointCategory(category)
      return
    }
    water.togglePointCategory(category)
  }

  return (
    <div className="w-full space-y-2 text-xs text-muted-foreground md:w-56">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Drinking water</span>
      </div>
      <LegendItem
        color="#2563eb"
        label="Facility"
        active={water.showPoints && water.visiblePointCategories.includes('facility')}
        onClick={() => togglePointCategory('facility')}
      />
      <LegendItem
        color="#0891b2"
        label="Sampling activity"
        active={water.showPoints && water.visiblePointCategories.includes('samples')}
        onClick={() => togglePointCategory('samples')}
      />
      <LegendItem
        color="#dc2626"
        label="Active notice"
        active={water.showPoints && water.visiblePointCategories.includes('notice')}
        onClick={() => togglePointCategory('notice')}
      />
      <LegendItem
        color="#7dd3fc"
        label={getBoundaryMetricLabel(water.boundaryMetric)}
        active={water.showBoundaries}
        onClick={() => water.setShowBoundaries((current) => !current)}
      />
      {water.showBoundaries && (
        <div className="px-1">
          <MapGradientLegendItem
            colors={['#e0f2fe', '#38bdf8', '#075985']}
            minLabel="0"
            maxLabel={formatMetricValue(water.boundaryMaxValue, water.boundaryMetric)}
          />
        </div>
      )}
    </div>
  )
}

export function WaterSourceNotes({ water }: { water: WaterState }) {
  const summary = water.combinedNoticesSummary.data
  return (
    <>
      <p>Drinking water extracts updated {formatDate(water.manifest.data?.generatedAt)}.</p>
      <p>
        Includes facilities, bacteriological samples, chemical results, and a combined active notices layer from HealthSpace and WaterToday
        {summary?.combined_count ? ` (${summary.combined_count.toLocaleString()} canonical notices, ${summary.with_coordinates?.toLocaleString() ?? 'all'} mapped).` : '.'}
      </p>
    </>
  )
}
