import { useCallback, useEffect, useMemo, useState } from 'react'
import { Droplets, FlaskConical } from 'lucide-react'
import { MapMarker, MarkerContent } from '@/components/ui/map'
import { MapFillLayer, MapHeatmapLayer } from '@/components/ui/map-layers'
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

type WaterBoundarySource = 'bcHealth' | 'census' | 'watershed'
type WaterBoundaryLevel = 'healthAuthority' | 'hsda' | 'lha' | 'chsa' | 'cd' | 'csd' | 'ct' | 'da' | 'majorWatershed' | 'watershedGroup' | 'assessmentWatershed'
type WaterLayerMode = 'facilities' | 'samples' | 'notices'

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
  address: string
  community: string
  latitude: number
  longitude: number
  bacteriologicalSamples: number
  chemicalResults: number
  activeNotices: number
  lastSampleDate: Date | null
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
  source: Record<string, unknown>
}

interface WaterManifest {
  generatedAt?: string
  files?: Array<{ file?: string; path?: string; rows?: number; records?: number; size?: string }>
  source?: string
  sourcePage?: string
  sourceLicense?: string
}

const WATER_ROOT = '/data/water'

const WATER_FILE_SUMMARY = [
  { file: 'bacteriological_samples.json', size: '13.38 MiB', records: '1,125 facilities, 68,237 sample rows' },
  { file: 'chemical_samples.json', size: '3.01 MiB', records: '734 facilities, 1,358 packages, 24,251 result rows' },
  { file: 'drinking_water_facilities.json', size: '1.53 MiB', records: '1,125 facilities' },
  { file: 'active_water_notices.json', size: '0.18 MiB', records: '151 notices' },
  { file: 'water_reference.json', size: '0.01 MiB', records: 'interpretation/reference metadata' },
  { file: 'water_download_manifest.json', size: 'tiny', records: 'manifest' },
]

const WATER_SOURCE_OPTIONS: Array<StudyAreaSourceOption<WaterBoundarySource>> = [
  {
    value: 'bcHealth',
    label: 'CHSA health boundaries',
    description: 'Health Authority -> CHSA context',
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
]

const WATER_HEALTH_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'healthAuthority', label: 'Health Authority' },
  { value: 'hsda', label: 'Health Service Delivery Area' },
  { value: 'lha', label: 'Local Health Area' },
  { value: 'chsa', label: 'Community Health Service Area' },
]

const WATER_CENSUS_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'cd', label: 'Census Division' },
  { value: 'csd', label: 'Census Subdivision' },
  { value: 'ct', label: 'Census Tract' },
  { value: 'da', label: 'Dissemination Area' },
]

const WATER_WATERSHED_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'majorWatershed', label: 'Major Watershed' },
  { value: 'watershedGroup', label: 'Watershed Group' },
  { value: 'assessmentWatershed', label: 'Assessment Watershed' },
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
    path: '/data/boundaries/BCFWA/major_watersheds.geojson',
    idField: 'WATERSHED_KEY',
    nameField: 'WATERSHED_GROUP_NAME',
  },
  watershedGroup: {
    path: '/data/boundaries/BCFWA/watershed_groups.geojson',
    idField: 'WATERSHED_GROUP_CODE',
    nameField: 'WATERSHED_GROUP_NAME',
  },
  assessmentWatershed: {
    path: '/data/boundaries/BCFWA/assessment_watersheds.geojson',
    idField: 'ASSESSMENT_WATERSHED_CODE',
    nameField: 'ASSESSMENT_WATERSHED_NAME',
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

function firstDate(record: Record<string, unknown>, keys: string[]): Date | null {
  for (const key of keys) {
    const value = record[key]
    if (value == null || value === '') continue
    const parsed = new Date(String(value))
    if (!Number.isNaN(parsed.getTime())) return parsed
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
  if (latitude == null || longitude == null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return {
    id: firstString(record, ['facilityId', 'facility_id', 'pwsid', 'waterSystemNumber', 'water_system_number', 'id'], `facility-${index}`),
    name: firstString(record, ['facilityName', 'facility_name', 'waterSystemName', 'water_system_name', 'name'], `Facility ${index + 1}`),
    operator: firstString(record, ['operator', 'owner', 'supplierName', 'supplier_name']),
    type: firstString(record, ['facilityType', 'facility_type', 'waterSystemType', 'water_system_type', 'type']),
    status: firstString(record, ['status', 'facilityStatus', 'facility_status']),
    address: firstString(record, ['address', 'physicalAddress', 'physical_address', 'location']),
    community: firstString(record, ['community', 'city', 'locality', 'servingArea', 'serving_area']),
    latitude,
    longitude,
    bacteriologicalSamples: 0,
    chemicalResults: 0,
    activeNotices: 0,
    lastSampleDate: null,
    source: record,
  }
}

function normalizeSample(record: Record<string, unknown>, index: number, kind: WaterSampleRow['kind']): WaterSampleRow {
  return {
    id: firstString(record, ['sampleId', 'sample_id', 'resultId', 'result_id', 'id'], `${kind}-${index}`),
    facilityId: firstString(record, ['facilityId', 'facility_id', 'pwsid', 'waterSystemNumber', 'water_system_number', 'systemId', 'system_id']),
    facilityName: firstString(record, ['facilityName', 'facility_name', 'waterSystemName', 'water_system_name', 'name']),
    kind,
    date: firstDate(record, ['sampleDate', 'sample_date', 'collectionDate', 'collection_date', 'dateSampled', 'date_sampled', 'resultDate', 'result_date', 'date']),
    parameter: firstString(record, ['parameter', 'analyte', 'test', 'testName', 'test_name']),
    result: firstString(record, ['result', 'value', 'resultValue', 'result_value', 'interpretation']),
    source: record,
  }
}

function normalizeNotice(record: Record<string, unknown>, index: number): WaterNoticeRow {
  return {
    id: firstString(record, ['noticeId', 'notice_id', 'id'], `notice-${index}`),
    facilityId: firstString(record, ['facilityId', 'facility_id', 'pwsid', 'waterSystemNumber', 'water_system_number', 'systemId', 'system_id']),
    facilityName: firstString(record, ['facilityName', 'facility_name', 'waterSystemName', 'water_system_name', 'name']),
    type: firstString(record, ['noticeType', 'notice_type', 'type', 'advisoryType', 'advisory_type'], 'Active notice'),
    status: firstString(record, ['status', 'noticeStatus', 'notice_status'], 'Active'),
    date: firstDate(record, ['issuedDate', 'issued_date', 'effectiveDate', 'effective_date', 'startDate', 'start_date', 'date']),
    source: record,
  }
}

function sameFacility(sample: WaterSampleRow | WaterNoticeRow, facility: WaterFacility): boolean {
  if (sample.facilityId && sample.facilityId === facility.id) return true
  return Boolean(sample.facilityName && sample.facilityName.toLowerCase() === facility.name.toLowerCase())
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
  const [layerMode, setLayerMode] = useState<WaterLayerMode>('facilities')
  const [showPoints, setShowPoints] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selectedFacilityId, setSelectedFacilityId] = useState<string | null>(null)
  const [timelineEnabled, setTimelineEnabled] = useState(false)
  const [timelineDate, setTimelineDate] = useState<Date | null>(null)
  const [timelineWindowSize, setTimelineWindowSize] = useState(12)

  const manifest = useWaterJson<WaterManifest>(active, 'water_download_manifest.json')
  const facilitiesJson = useWaterJson<unknown>(active, 'drinking_water_facilities.json')
  const bacteriologicalJson = useWaterJson<unknown>(active, 'bacteriological_samples.json')
  const chemicalJson = useWaterJson<unknown>(active, 'chemical_samples.json')
  const noticesJson = useWaterJson<unknown>(active, 'active_water_notices.json')
  const referenceJson = useWaterJson<unknown>(active, 'water_reference.json')
  const boundaryConfig = WATER_BOUNDARY_CONFIG[boundaryLevel]
  const boundaryJson = useJsonManifest<BoundaryFeatureCollection>(active && showBoundaries ? boundaryConfig.path : null)

  const samples = useMemo(() => {
    const bacteriologicalRows = collectRows(bacteriologicalJson.data, ['sample', 'result'])
      .map((row, index) => normalizeSample(row, index, 'bacteriological'))
    const chemicalRows = collectRows(chemicalJson.data, ['result'])
      .map((row, index) => normalizeSample(row, index, 'chemical'))
    return [...bacteriologicalRows, ...chemicalRows]
  }, [bacteriologicalJson.data, chemicalJson.data])

  const notices = useMemo(() => (
    findArray(noticesJson.data, ['notices', 'activeNotices', 'records', 'rows'])
      .map(normalizeNotice)
  ), [noticesJson.data])

  const facilities = useMemo(() => {
    const baseFacilities = findArray(facilitiesJson.data, ['facilities', 'records', 'rows'])
      .map(normalizeFacility)
      .filter((facility): facility is WaterFacility => Boolean(facility))
    const byId = new Map<string, WaterFacility>()
    const byName = new Map<string, WaterFacility>()

    for (const facility of baseFacilities) {
      byId.set(facility.id, facility)
      byName.set(facility.name.toLowerCase(), facility)
    }

    for (const sample of samples) {
      const facility = (sample.facilityId && byId.get(sample.facilityId)) || (sample.facilityName && byName.get(sample.facilityName.toLowerCase()))
      if (!facility) continue
      if (sample.kind === 'bacteriological') facility.bacteriologicalSamples += 1
      else facility.chemicalResults += 1
      if (sample.date && (!facility.lastSampleDate || sample.date > facility.lastSampleDate)) facility.lastSampleDate = sample.date
    }

    for (const notice of notices) {
      const facility = (notice.facilityId && byId.get(notice.facilityId)) || (notice.facilityName && byName.get(notice.facilityName.toLowerCase()))
      if (facility) facility.activeNotices += 1
    }

    return Array.from(byId.values()).sort((left, right) => right.activeNotices - left.activeNotices || right.bacteriologicalSamples + right.chemicalResults - left.bacteriologicalSamples - left.chemicalResults)
  }, [facilitiesJson.data, notices, samples])

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
    if (!timelineFilterRange) return samples
    return samples.filter((sample) => {
      if (!sample.date) return false
      const time = sample.date.getTime()
      return time >= timelineFilterRange.start && time <= timelineFilterRange.end
    })
  }, [samples, timelineFilterRange])

  const activeFacilityIds = useMemo(() => {
    if (!timelineFilterRange) return null
    const ids = new Set<string>()
    for (const sample of filteredSamples) {
      for (const facility of facilities) {
        if (sameFacility(sample, facility)) ids.add(facility.id)
      }
    }
    return ids
  }, [facilities, filteredSamples, timelineFilterRange])

  const visibleFacilities = useMemo(() => {
    const modeFiltered = facilities.filter((facility) => {
      if (layerMode === 'notices') return facility.activeNotices > 0
      if (layerMode === 'samples') return facility.bacteriologicalSamples + facility.chemicalResults > 0
      return true
    })
    if (!activeFacilityIds) return modeFiltered
    return modeFiltered.filter((facility) => activeFacilityIds.has(facility.id))
  }, [activeFacilityIds, facilities, layerMode])

  const selectedFacility = useMemo(() => (
    selectedFacilityId ? facilities.find((facility) => facility.id === selectedFacilityId) ?? null : null
  ), [facilities, selectedFacilityId])

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
    features: visibleFacilities.map((facility) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [facility.longitude, facility.latitude] },
      properties: {
        id: facility.id,
        weight: Math.max(1, facility.activeNotices * 8 + facility.bacteriologicalSamples + facility.chemicalResults),
      },
    })),
  }), [visibleFacilities])

  const boundaryLevelOptions = boundarySource === 'bcHealth'
    ? WATER_HEALTH_LEVEL_OPTIONS
    : boundarySource === 'census'
      ? WATER_CENSUS_LEVEL_OPTIONS
      : WATER_WATERSHED_LEVEL_OPTIONS

  const boundaries = useMemo(() => prepareBoundaries(boundaryJson.data, boundaryConfig), [boundaryConfig, boundaryJson.data])

  const handleBoundarySourceChange = useCallback((source: WaterBoundarySource) => {
    setBoundarySource(source)
    setBoundaryLevel(source === 'bcHealth' ? 'chsa' : source === 'census' ? 'da' : 'watershedGroup')
    setShowBoundaries(true)
  }, [])

  const handleTimelineDisable = useCallback(() => {
    setTimelineEnabled(false)
    setTimelineDate(null)
  }, [])

  return {
    manifest,
    facilitiesJson,
    bacteriologicalJson,
    chemicalJson,
    noticesJson,
    referenceJson,
    boundaryJson,
    boundarySource,
    boundaryLevel,
    boundaryLevelOptions,
    showBoundaries,
    setShowBoundaries,
    handleBoundarySourceChange,
    setBoundaryLevel,
    layerMode,
    setLayerMode,
    showPoints,
    setShowPoints,
    showHeatmap,
    setShowHeatmap,
    facilities,
    visibleFacilities,
    samples,
    filteredSamples,
    notices,
    selectedFacility,
    selectedFacilityId,
    setSelectedFacilityId,
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
    boundaries,
  }
}

export type WaterState = ReturnType<typeof useWaterData>

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
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{water.facilities.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">facilities</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{water.filteredSamples.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">sample rows</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{water.notices.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">active notices</div>
            </div>
            <div className="rounded border border-border p-2">
              <div className="text-sm font-bold text-foreground">{water.visibleFacilities.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">mapped now</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => water.setShowPoints((current) => !current)}
              className={cn(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                water.showPoints ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              {water.showPoints ? 'Hide points' : 'Show points'}
            </button>
            <button
              type="button"
              onClick={() => water.setShowHeatmap((current) => !current)}
              className={cn(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                water.showHeatmap ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400' : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              {water.showHeatmap ? 'Hide heatmap' : 'Show heatmap'}
            </button>
            <button
              type="button"
              onClick={() => water.setTimelineEnabled((current) => !current)}
              className={cn(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                water.timelineEnabled ? 'border-violet-500 text-violet-600 dark:text-violet-400' : 'border-input text-muted-foreground hover:text-foreground',
              )}
            >
              {water.timelineEnabled ? 'Hide timeline' : 'Show timeline'}
            </button>
          </div>
          {water.selectedFacility && (
            <div className="rounded-md border border-border bg-background p-3 text-xs">
              <div className="font-semibold text-foreground">{water.selectedFacility.name}</div>
              <div className="mt-1 text-muted-foreground">{water.selectedFacility.community || water.selectedFacility.address || 'No locality provided'}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
                <span className="text-muted-foreground">Bacteriological</span>
                <span className="text-right font-medium">{water.selectedFacility.bacteriologicalSamples.toLocaleString()}</span>
                <span className="text-muted-foreground">Chemical</span>
                <span className="text-right font-medium">{water.selectedFacility.chemicalResults.toLocaleString()}</span>
                <span className="text-muted-foreground">Active notices</span>
                <span className="text-right font-medium">{water.selectedFacility.activeNotices.toLocaleString()}</span>
                <span className="text-muted-foreground">Last sample</span>
                <span className="text-right font-medium">{formatDate(water.selectedFacility.lastSampleDate?.toISOString())}</span>
              </div>
            </div>
          )}
          {(water.facilitiesJson.error || water.bacteriologicalJson.error || water.chemicalJson.error || water.noticesJson.error) && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs leading-5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/35 dark:text-amber-100">
              Water JSON files were not found at {WATER_ROOT}. Copy the downloaded files into public/data/water to populate this section.
            </div>
          )}
        </div>
      </div>

      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-cyan-600" />
          <h2 className="text-sm font-semibold text-foreground">Downloaded Files</h2>
        </div>
        <div className="space-y-1.5">
          {WATER_FILE_SUMMARY.map((file) => (
            <div key={file.file} className="rounded-md border border-border p-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-medium text-foreground">{file.file}</span>
                <span className="shrink-0 text-[10px] text-muted-foreground">{file.size}</span>
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">{file.records}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

export function WaterLayer({ water }: { water: WaterState }) {
  return (
    <>
      {water.showBoundaries && water.boundaries.features.length > 0 && (
        <MapFillLayer
          data={water.boundaries}
          fillColor="#38bdf8"
          fillOpacity={0.08}
          lineColor="#0284c7"
          lineWidth={0.8}
          lineOpacity={0.55}
          idProperty="boundaryId"
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
      {water.showPoints && water.visibleFacilities.map((facility) => {
        const notice = facility.activeNotices > 0
        const sampleCount = facility.bacteriologicalSamples + facility.chemicalResults
        const size = notice ? 12 : Math.max(7, Math.min(18, 6 + Math.sqrt(sampleCount) / 3))
        const color = notice
          ? '#dc2626'
          : water.layerMode === 'samples'
            ? '#0891b2'
            : '#2563eb'
        return (
          <MapMarker key={facility.id} longitude={facility.longitude} latitude={facility.latitude}>
            <MarkerContent>
              <button
                type="button"
                onClick={() => water.setSelectedFacilityId(facility.id)}
                className={cn(
                  'rounded-full border-2 border-white shadow-md transition-transform hover:scale-125',
                  water.selectedFacilityId === facility.id && 'ring-2 ring-cyan-300',
                )}
                style={{ width: size, height: size, backgroundColor: color }}
                title={`${facility.name}: ${sampleCount.toLocaleString()} sample rows${notice ? ', active notice' : ''}`}
              />
            </MarkerContent>
          </MapMarker>
        )
      })}
    </>
  )
}

export function WaterLegend({ water }: { water: WaterState }) {
  return (
    <div className="w-56 space-y-2 text-xs text-muted-foreground">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-foreground">Drinking water</span>
        <span className="tabular-nums text-[10px]">{water.visibleFacilities.length.toLocaleString()} mapped</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-blue-600" />
        <span>Facility</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-cyan-600" />
        <span>Sampling activity</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="h-3 w-3 rounded-full bg-red-600" />
        <span>Active notice</span>
      </div>
      {water.showBoundaries && (
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-sm border border-sky-600 bg-sky-300/30" />
          <span>Selected study area</span>
        </div>
      )}
    </div>
  )
}

export function WaterSourceNotes({ water }: { water: WaterState }) {
  return (
    <>
      <p>Drinking water extracts updated {formatDate(water.manifest.data?.generatedAt)}.</p>
      <p>Includes facilities, bacteriological samples, chemical results, active notices, reference metadata, and download manifest files.</p>
    </>
  )
}
