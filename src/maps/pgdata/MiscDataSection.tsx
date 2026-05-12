import { useEffect, useMemo, useState } from 'react'
import type { ElementType } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, Database, Droplets, Footprints, Layers, PawPrint, Satellite, ShieldAlert, Trees } from 'lucide-react'
import { Map as PgMap, MapControls, MapMarker, MarkerContent } from '@/components/ui/map'
import { MapFillLayer, MapPmtilesFillLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { DatasetInfo } from '@/components/DatasetInfo'
import { StudyAreaSelector, type StudyAreaLevelOption, type StudyAreaSourceOption } from '@/components/StudyAreaSelector'
import { BOUNDARY_SOURCE_OPTIONS as ALL_BOUNDARY_SOURCE_OPTIONS } from '@/lib/studyArea'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import { useHeatShadeData } from '@/maps/scorebuilder/hooks/useHeatShadeData'
import { formatDate, formatNullableNumber, useJsonManifest } from './shared'
import {
  WALKABILITY_DEFAULT_VARIANT,
  WALKABILITY_DEFAULT_DISPLAY_MODE,
  WalkabilityLayer,
  WalkabilityLegend,
  WalkabilitySidebar,
  WalkabilitySourceNotes,
  useWalkabilityData,
} from './walkability'
import { ICBC_TIMELINE_WINDOW_OPTIONS, IcbcLayer, IcbcLayerControls, IcbcLegend, IcbcSidebar, IcbcSourceNotes, useIcbcData } from './icbc'
import { WARS_TIMELINE_WINDOW_OPTIONS, WarsLayer, WarsLayerControls, WarsLegend, WarsSidebar, WarsSourceNotes, useWarsData } from './wars'
import { WATER_TIMELINE_WINDOW_OPTIONS, WaterLayer, WaterLayerControls, WaterLegend, WaterSidebar, WaterSourceNotes, useWaterData } from './water'
import { Timeline } from '@/components/ui/timeline'
import { DroughtSection } from '@/maps/drought'
import {
  CANUE_V2_CATALOG_URL,
  CANUE_V2_ENABLED,
  listCanueV2Selections,
  type CanueV2Catalog,
  type CanueVariableSelection,
} from './canueV2'
import { useCanueV2AggregateData } from './canueV2Aggregates'
import { useCanuePmtilesBoundaryData } from './canuePmtilesAggregate'

interface HeatShadeManifestSource {
  id: string
  name: string
  kind: string
  featureCount?: number
  sceneCount?: number
  years?: number[]
}

interface HeatShadeManifest {
  generatedAt: string
  sources: HeatShadeManifestSource[]
  caveats?: string[]
}

type BoundaryFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>

type MiscLayerId = 'trees' | 'forests' | 'facilities'
type MiscDataTab = 'heatShade' | 'canue' | 'icbc' | 'wars' | 'walkability' | 'water' | 'drought'
type CanueYearMode = 'single' | 'month' | 'all' | 'range'
type CanueBoundarySource = 'bcHealth' | 'census' | 'cityPG'
type CanueBoundaryLevel =
  | 'healthAuthority'
  | 'hsda'
  | 'lha'
  | 'chsa'
  | 'cd'
  | 'csd'
  | 'ct'
  | 'da'
  | 'db'
  | 'elementarySchoolCatchment'
  | 'secondarySchoolCatchment'

interface CanueFile {
  datasetId: string
  label: string
  category: string
  cadence?: 'annual' | 'monthly'
  year: number
  output: string
  rowCount: number
  coordinateCount: number
  variables: string[]
  compression?: string
  gzipSize?: number
}

interface CanueManifest {
  generatedAt: string
  province?: string
  boundaryClip?: string | null
  files: CanueFile[]
}

interface CanueBoundaryResult {
  data: BoundaryFeatureCollection
  loading: boolean
  error: string | null
  minValue: number | null
  maxValue: number | null
  validBoundaryCount: number
  matchedRowCount: number
}

interface CanueDatasetGroup {
  datasetId: string
  label: string
  category: string
  files: CanueFile[]
  years: number[]
}

interface BoundaryIndexEntry {
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  bbox: [number, number, number, number]
  id: string
  name: string
}

interface BoundaryLevelConfig {
  path: string
  idField: string
  nameField: string
  label: string
}

interface CanuePostalMembershipRecord {
  postalcode: string
  boundaries: Partial<Record<CanueBoundaryLevel, string>>
}

interface CanuePostalMembership {
  generatedAt: string
  records: CanuePostalMembershipRecord[]
}

const MISC_LAYERS: Array<{ id: MiscLayerId; label: string; color: string }> = [
  { id: 'trees', label: 'Tree canopy proxy', color: '#16a34a' },
  { id: 'forests', label: 'Forests', color: '#15803d' },
  { id: 'facilities', label: 'Cooling access proxy', color: '#0ea5e9' },
]

const MISC_TABS: Array<{ id: MiscDataTab; label: string; icon: ElementType }> = [
  { id: 'heatShade', label: 'Heat & Shade', icon: Trees },
  { id: 'canue', label: 'CANUE', icon: Database },
  { id: 'icbc', label: 'ICBC', icon: ShieldAlert },
  { id: 'wars', label: 'WARS', icon: PawPrint },
  { id: 'walkability', label: 'Walkability', icon: Footprints },
  { id: 'water', label: 'Water', icon: Droplets },
  { id: 'drought', label: 'Drought', icon: Droplets },
]

const CANUE_SUPPORTED_SOURCES = new Set<string>(['bcHealth', 'census', 'cityPG'])

const CANUE_BOUNDARY_SOURCE_OPTIONS: Array<StudyAreaSourceOption<string>> = ALL_BOUNDARY_SOURCE_OPTIONS.map(
  (option) => {
    const supported = CANUE_SUPPORTED_SOURCES.has(option.value)
    return {
      value: option.value,
      label: option.label,
      description: option.description,
      disabled: !supported,
      disabledReason: supported
        ? undefined
        : 'Postal-code-to-boundary aggregation is not yet generated for this boundary type.',
    }
  },
)

const CANUE_HEALTH_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'healthAuthority', label: 'Health Authority' },
  { value: 'hsda', label: 'Health Service Delivery Area' },
  { value: 'lha', label: 'Local Health Area' },
  { value: 'chsa', label: 'Community Health Service Area' },
]

const CANUE_CENSUS_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'cd', label: 'Census Division' },
  { value: 'csd', label: 'Census Subdivision' },
  { value: 'ct', label: 'Census Tract' },
  { value: 'da', label: 'Dissemination Area' },
  { value: 'db', label: 'Dissemination Block' },
]

const CANUE_CITY_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'elementarySchoolCatchment', label: 'Elementary School Catchment' },
  { value: 'secondarySchoolCatchment', label: 'Secondary School Catchment' },
]

const CANUE_BOUNDARY_CONFIG: Record<CanueBoundaryLevel, BoundaryLevelConfig> = {
  healthAuthority: {
    path: '/data/boundaries/BCMoH/simplified/health_authorities.json',
    idField: 'HLTH_AUTHORITY_CODE',
    nameField: 'HLTH_AUTHORITY_NAME',
    label: 'Health Authority',
  },
  hsda: {
    path: '/data/boundaries/BCMoH/simplified/health_service_delivery_areas.json',
    idField: 'HLTH_SERVICE_DLVR_AREA_CODE',
    nameField: 'HLTH_SERVICE_DLVR_AREA_NAME',
    label: 'Health Service Delivery Area',
  },
  lha: {
    path: '/data/boundaries/BCMoH/simplified/local_health_areas.json',
    idField: 'LOCAL_HLTH_AREA_CODE',
    nameField: 'LOCAL_HLTH_AREA_NAME',
    label: 'Local Health Area',
  },
  chsa: {
    path: '/data/boundaries/BCMoH/simplified/community_health_service_areas.json',
    idField: 'CMNTY_HLTH_SERV_AREA_CODE',
    nameField: 'CMNTY_HLTH_SERV_AREA_NAME',
    label: 'Community Health Service Area',
  },
  cd: {
    path: '/data/census/prince_george_cd.geo.json',
    idField: 'id',
    nameField: 'name',
    label: 'Census Division',
  },
  csd: {
    path: '/data/census/prince_george_csd.geo.json',
    idField: 'id',
    nameField: 'name',
    label: 'Census Subdivision',
  },
  ct: {
    path: '/data/census/prince_george_ct.geo.json',
    idField: 'id',
    nameField: 'name',
    label: 'Census Tract',
  },
  da: {
    path: '/data/census/prince_george_da.geo.json',
    idField: 'id',
    nameField: 'name',
    label: 'Dissemination Area',
  },
  db: {
    path: '/data/census/prince_george_db.geo.json',
    idField: 'id',
    nameField: 'name',
    label: 'Dissemination Block',
  },
  elementarySchoolCatchment: {
    path: '/data/boundaries/CityPG/elementary_school_catchments.geojson',
    idField: 'OBJECTID',
    nameField: 'SchoolName',
    label: 'Elementary School Catchment',
  },
  secondarySchoolCatchment: {
    path: '/data/boundaries/CityPG/secondary_school_catchments.geojson',
    idField: 'OBJECTID',
    nameField: 'SchoolNam',
    label: 'Secondary School Catchment',
  },
}

const CANUE_DEFAULT_VARIABLE_BY_DATASET: Partial<Record<string, string>> = {
  ale_a: 'ale16_06',
  nhbic_ava: 'nhbic21_09',
  nhpmd_ann: 'nhpmd19_03',
}

const CANUE_INVALID_NUMERIC_VALUES = new Set([-9999, -1111])

const CANUE_EXACT_VARIABLE_LABELS: Record<string, string> = {
  pm25dal21_01: 'Annual mean PM2.5',
  lgtnlt13_01: 'Night-time light intensity',
  aqsmk22_01: 'Smoke PM2.5 mean',
  aqsmk22_02: 'Smoke PM2.5 median',
  aqsmk22_03: 'Smoke PM2.5 minimum',
  aqsmk22_04: 'Smoke PM2.5 maximum',
  aqsmk22_05: 'Smoke PM2.5 standard deviation',
}

const CANUE_SUFFIX_LABELS_BY_DATASET: Record<string, Record<string, string>> = {
  pm25dale_a: {
    '01': 'Annual mean PM2.5',
  },
  aqsmk_avb: {
    '01': 'Smoke PM2.5 mean',
    '02': 'Smoke PM2.5 median',
    '03': 'Smoke PM2.5 minimum',
    '04': 'Smoke PM2.5 maximum',
    '05': 'Smoke PM2.5 standard deviation',
  },
  ale_a: {
    '01': 'Dissemination area ID',
    '02': 'Intersection density',
    '03': 'Dwelling density',
    '04': 'Intersection density z-score',
    '05': 'Dwelling density z-score',
    '06': 'ALE index',
    '07': 'ALE class',
    '08': 'Points of interest',
    '09': 'Points of interest z-score',
    '10': 'Transit stops',
    '11': 'Transit z-score',
    '12': 'ALE transit index',
    '13': 'ALE transit class',
  },
  dtr_a: {
    '01': 'Distance to expressways',
    '02': 'Distance to primary highways',
    '03': 'Distance to secondary highways',
    '04': 'Distance to major roads',
    '05': 'Distance to local roads',
  },
  nhacs_ava: {
    '01': 'Spatial accessibility measure 01',
  },
  nhbic_ava: {
    '01': 'Dissemination area ID',
    '02': 'ALE index',
    '03': 'ALE class',
    '04': 'Bike-to-work rate',
    '05': 'Sustainable transportation to work rate',
    '06': 'High-comfort bike infrastructure',
    '07': 'Medium-comfort bike infrastructure',
    '08': 'Low-comfort bike infrastructure',
    '09': 'Can-BICS index',
    '10': 'Can-BICS category',
  },
  nhspw_ava: {
    '01': 'Sprawl score',
    '02': 'Sprawl lower credible interval',
    '03': 'Sprawl median',
    '04': 'Sprawl upper credible interval',
  },
  nhpmd_ann: {
    '01': 'Dissemination block ID',
    '02': 'Employment in block',
    '03': 'Proximity to employment',
    '04': 'Pharmacy in block',
    '05': 'Proximity to pharmacy',
    '06': 'Childcare in block',
    '07': 'Proximity to childcare',
    '08': 'Health facility in block',
    '09': 'Proximity to health facility',
    '10': 'Grocery store in block',
    '11': 'Proximity to grocery store',
    '12': 'Primary education in block',
    '13': 'Proximity to primary education',
    '14': 'Secondary education in block',
    '15': 'Proximity to secondary education',
    '16': 'Library in block',
    '17': 'Proximity to library',
    '18': 'Park in block',
    '19': 'Proximity to park',
    '20': 'Transit stop in block',
    '21': 'Proximity to transit trips',
  },
}

const BC_CENTER: [number, number] = [-124.6, 54.4]
const CANUE_MONTHS = [
  { value: 1, key: 'jan', label: 'January' },
  { value: 2, key: 'feb', label: 'February' },
  { value: 3, key: 'mar', label: 'March' },
  { value: 4, key: 'apr', label: 'April' },
  { value: 5, key: 'may', label: 'May' },
  { value: 6, key: 'jun', label: 'June' },
  { value: 7, key: 'jul', label: 'July' },
  { value: 8, key: 'aug', label: 'August' },
  { value: 9, key: 'sep', label: 'September' },
  { value: 10, key: 'oct', label: 'October' },
  { value: 11, key: 'nov', label: 'November' },
  { value: 12, key: 'dec', label: 'December' },
] as const

const CANUE_MONTH_BY_VALUE: Map<number, (typeof CANUE_MONTHS)[number]> = new Map(CANUE_MONTHS.map((month) => [month.value, month]))
const CANUE_MONTH_BY_KEY: Map<string, (typeof CANUE_MONTHS)[number]> = new Map(CANUE_MONTHS.map((month) => [month.key, month]))
const CANUE_MONTH_PATTERN = /_(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)_\d{2}$/i

function getCanueVariableLabel(file: CanueFile | null, variable: string): string {
  if (!file) return variable
  if (CANUE_EXACT_VARIABLE_LABELS[variable]) return CANUE_EXACT_VARIABLE_LABELS[variable]
  if (file.cadence === 'monthly') {
    if (variable === 'pm25') return 'Monthly PM2.5'
    if (variable.startsWith('aqsmk')) return 'Monthly smoke PM2.5'
    if (variable.startsWith('aqozn_8h')) return 'Monthly ozone 8-hour'
    if (variable.startsWith('aqozn_mn')) return 'Monthly ozone mean'
    if (variable.startsWith('aqno2')) return 'Monthly NO2'
    return `${file.label} monthly measure`
  }

  const match = variable.match(/_(\d+)$/)
  const suffix = match?.[1]
  const datasetLabel = suffix ? CANUE_SUFFIX_LABELS_BY_DATASET[file.datasetId]?.[suffix] : null
  if (datasetLabel) return datasetLabel

  if ((file.datasetId === 'nhbld_ava' || file.datasetId === 'nhfac_ava' || file.datasetId === 'nhscn_ava' || file.datasetId === 'nhtsp_ava') && suffix) {
    const buffers = ['100m', '250m', '300m', '500m', '750m', '1000m']
    const buffer = buffers[Number(suffix) - 1]
    if (file.datasetId === 'nhbld_ava' && buffer) return `Building density at ${buffer}`
    if (file.datasetId === 'nhscn_ava' && buffer) return `Intersections within ${buffer}`
    if (file.datasetId === 'nhtsp_ava' && buffer) return `Bus stops within ${buffer}`
    if (file.datasetId === 'nhfac_ava' && buffer) return `Facility richness at ${buffer}`
    if (file.datasetId === 'nhfac_ava' && Number(suffix) > 6) return `Facility density at ${buffers[Number(suffix) - 7]}`
  }

  const measure = suffix ? Number(suffix).toLocaleString(undefined, { minimumIntegerDigits: 2 }) : variable
  return `${file.label} measure ${measure}`
}

function getDefaultCanueVariable(file: CanueFile): string | null {
  const preferred = CANUE_DEFAULT_VARIABLE_BY_DATASET[file.datasetId]
  if (preferred && file.variables.includes(preferred)) return preferred
  return getSelectableCanueVariables(file)[0] ?? null
}

function getCanueVariableSuffix(variable: string | null): string | null {
  return variable?.match(/_(\d+)$/)?.[1] ?? null
}

function getCanueVariableFamily(variable: string): string {
  return variable.replace(CANUE_MONTH_PATTERN, '')
}

function getSelectableCanueVariables(file: CanueFile): string[] {
  if (file.cadence !== 'monthly') return file.variables
  return Array.from(new Set(file.variables.map(getCanueVariableFamily)))
}

function findCanueVariablesForFile(file: CanueFile, selectedVariable: string, month: number | null): string[] {
  if (file.cadence === 'monthly') {
    const family = getCanueVariableFamily(selectedVariable)
    const monthKey = month ? CANUE_MONTH_BY_VALUE.get(month)?.key : null
    return file.variables.filter((variable) => {
      if (getCanueVariableFamily(variable) !== family) return false
      return monthKey ? variable.toLowerCase().includes(`_${monthKey}_`) : true
    })
  }

  if (file.variables.includes(selectedVariable)) return [selectedVariable]
  const suffix = getCanueVariableSuffix(selectedVariable)
  if (!suffix) return []
  const matched = file.variables.find((variable) => getCanueVariableSuffix(variable) === suffix)
  return matched ? [matched] : []
}

function getCanuePeriodLabel(files: CanueFile[], mode: CanueYearMode, month: number | null): string {
  if (!files.length) return 'No years'
  if (mode === 'month') {
    const monthLabel = CANUE_MONTH_BY_VALUE.get(month ?? 1)?.label ?? 'Month'
    return `${monthLabel} ${files[0].year}`
  }
  if (files.length === 1) return files[0].cadence === 'monthly' ? `${files[0].year} average` : String(files[0].year)
  const years = files.map((file) => file.year).sort((a, b) => a - b)
  const range = `${years[0]}-${years[years.length - 1]}`
  return mode === 'single' ? String(files[0].year) : `${range} average`
}

function getCanueV2VariableLabel(selection: CanueVariableSelection | null): string {
  if (!selection) return 'CANUE grid'
  const variable = getCanueV2MeasureVariable(selection.variable)
  const suffix = getCanueVariableSuffix(variable)
  const datasetLabels = CANUE_SUFFIX_LABELS_BY_DATASET[selection.dataset]
  if (suffix && datasetLabels?.[suffix]) return datasetLabels[suffix]
  return variable
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function getCanueV2MonthKey(variable: string): string | null {
  return variable.match(CANUE_MONTH_PATTERN)?.[1]?.toLowerCase() ?? null
}

function getCanueV2MeasureVariable(variable: string): string {
  return variable.replace(CANUE_MONTH_PATTERN, '')
}

function getCanueV2MeasureKey(selection: Pick<CanueVariableSelection, 'dataset' | 'variable'>): string {
  return `${selection.dataset}__${getCanueV2MeasureVariable(selection.variable)}`
}

function canueV2Paint(selection: CanueVariableSelection | null) {
  if (!selection) return '#e5e7eb'
  const low = selection.min ?? 0
  const high = selection.max != null && selection.max !== low ? selection.max : low + 1
  const mid = low + ((high - low) / 2)

  return [
    'case',
    ['!', ['has', selection.property]],
    '#e5e7eb',
    ['==', ['get', selection.property], null],
    '#e5e7eb',
    [
      'interpolate',
      ['linear'],
      ['to-number', ['get', selection.property]],
      low,
      '#67e8f9',
      mid,
      '#facc15',
      high,
      '#ef4444',
    ],
  ]
}

function canueBoundaryPaint(property: string, minValue: number | null, maxValue: number | null) {
  const low = minValue ?? 0
  const high = maxValue != null && maxValue !== low ? maxValue : low + 1
  const mid = low + ((high - low) / 2)

  return [
    'case',
    ['!', ['has', property]],
    '#e5e7eb',
    ['==', ['get', property], null],
    '#e5e7eb',
    [
      'interpolate',
      ['linear'],
      ['to-number', ['get', property]],
      low,
      '#67e8f9',
      mid,
      '#facc15',
      high,
      '#ef4444',
    ],
  ]
}

function splitCsvLine(line: string): string[] {
  const values: string[] = []
  let value = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index + 1] === '"') {
      value += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(value)
      value = ''
    } else {
      value += char
    }
  }

  values.push(value)
  return values
}

function buildBoundaryIndex(boundaries: BoundaryFeatureCollection, config: BoundaryLevelConfig): BoundaryIndexEntry[] {
  return boundaries.features.filter((feature) => feature.geometry).map((feature, index) => ({
    feature,
    bbox: [0, 0, 0, 0],
    id: String(feature.properties?.[config.idField] ?? feature.id ?? index),
    name: String(feature.properties?.[config.nameField] ?? feature.properties?.name ?? feature.id ?? index),
  }))
}

async function fetchGzipText(path: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(path, { signal })
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)

  const DecompressionStreamCtor = (globalThis as typeof globalThis & {
    DecompressionStream?: new(format: 'gzip') => TransformStream<Uint8Array, Uint8Array>
  }).DecompressionStream

  if (response.headers.get('content-encoding') === 'gzip' || !path.endsWith('.gz') || !response.body || !DecompressionStreamCtor) {
    return response.text()
  }

  const stream = response.body.pipeThrough(new DecompressionStreamCtor('gzip'))
  return new Response(stream).text()
}

function useCanueBoundaryData(
  files: CanueFile[],
  variable: string | null,
  boundaries: BoundaryFeatureCollection | null,
  boundaryLevel: CanueBoundaryLevel,
  membership: CanuePostalMembership | null,
  yearMode: CanueYearMode,
  month: number | null,
): CanueBoundaryResult {
  const [result, setResult] = useState<CanueBoundaryResult>({
    data: { type: 'FeatureCollection', features: [] },
    loading: false,
    error: null,
    minValue: null,
    maxValue: null,
    validBoundaryCount: 0,
    matchedRowCount: 0,
  })

  useEffect(() => {
    if (!files.length || !variable || !boundaries || !membership) {
      setResult({
        data: { type: 'FeatureCollection', features: [] },
        loading: false,
        error: null,
        minValue: null,
        maxValue: null,
        validBoundaryCount: 0,
        matchedRowCount: 0,
      })
      return
    }

    const controller = new AbortController()
    const activeFiles = files
    const activeBoundaries = boundaries
    const activeMembership = membership
    const activeBoundaryLevel = boundaryLevel
    const boundaryConfig = CANUE_BOUNDARY_CONFIG[boundaryLevel]
    const activeVariable = variable
    const activeMonth = month

    async function load() {
      setResult((current) => ({ ...current, loading: true, error: null }))

      try {
        const usableBoundaries: BoundaryFeatureCollection = {
          type: 'FeatureCollection',
          features: activeBoundaries.features.filter((feature) => feature.geometry),
        }
        const boundaryIndex = buildBoundaryIndex(usableBoundaries, boundaryConfig)
        const buckets = new Map(boundaryIndex.map((boundary) => [
          boundary.id,
          {
            boundary,
            rowCount: 0,
            sum: 0,
            count: 0,
            min: null as number | null,
            max: null as number | null,
            years: new Map<number, { sum: number; count: number }>(),
          },
        ]))
        const membershipByPostalCode = new Map(
          activeMembership.records.map((record) => [record.postalcode, record.boundaries[activeBoundaryLevel] ?? '']),
        )
        let matchedRowCount = 0

        for (const activeFile of activeFiles) {
          const fileVariables = findCanueVariablesForFile(activeFile, activeVariable, activeFile.cadence === 'monthly' && yearMode === 'month' ? activeMonth : null)
          if (!fileVariables.length) throw new Error(`${activeFile.label} ${activeFile.year} is missing ${activeVariable}`)

          const text = await fetchGzipText(activeFile.output, controller.signal)
          const lines = text.split(/\r?\n/)
          const headers = splitCsvLine(lines[0] ?? '')
          const postalIndex = headers.indexOf('postalcode')
          const variableIndexes = fileVariables.map((fileVariable) => headers.indexOf(fileVariable))

          if (postalIndex < 0 || variableIndexes.some((variableIndex) => variableIndex < 0)) {
            throw new Error(`CANUE file is missing postalcode or ${fileVariables.join(', ')}`)
          }

          for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
            const line = lines[lineIndex]
            if (!line) continue
            const values = splitCsvLine(line)
            const boundaryId = membershipByPostalCode.get(String(values[postalIndex] || '').replace(/\s+/g, '').toUpperCase())
            if (!boundaryId) continue
            const bucket = buckets.get(boundaryId)
            if (!bucket) continue
            bucket.rowCount += 1
            matchedRowCount += 1

            for (const variableIndex of variableIndexes) {
              const value = Number(values[variableIndex])
              if (!Number.isFinite(value) || CANUE_INVALID_NUMERIC_VALUES.has(value)) continue
              bucket.sum += value
              bucket.count += 1
              bucket.min = bucket.min == null ? value : Math.min(bucket.min, value)
              bucket.max = bucket.max == null ? value : Math.max(bucket.max, value)
              const yearBucket = bucket.years.get(activeFile.year) ?? { sum: 0, count: 0 }
              yearBucket.sum += value
              yearBucket.count += 1
              bucket.years.set(activeFile.year, yearBucket)
            }
          }
        }

        let minValue: number | null = null
        let maxValue: number | null = null
        let validBoundaryCount = 0

        const features = usableBoundaries.features.map((feature, index) => {
          const boundary = boundaryIndex[index]
          const bucket = buckets.get(boundary.id)
          const yearlyMeans = bucket
            ? Array.from(bucket.years.values()).filter((yearBucket) => yearBucket.count > 0).map((yearBucket) => yearBucket.sum / yearBucket.count)
            : []
          const value = bucket && bucket.count > 0
            ? activeFiles.length > 1 && yearlyMeans.length > 0
              ? yearlyMeans.reduce((sum, yearMean) => sum + yearMean, 0) / yearlyMeans.length
              : bucket.sum / bucket.count
            : null

          return {
            ...feature,
            id: boundary.id,
            properties: {
              ...feature.properties,
              boundaryId: boundary.id,
              boundaryName: boundary.name,
              datasetId: activeFiles[0]?.datasetId,
              datasetLabel: activeFiles[0]?.label,
              category: activeFiles[0]?.category,
              year: activeFiles.length === 1 ? activeFiles[0].year : null,
              yearMode,
              yearLabel: getCanuePeriodLabel(activeFiles, yearMode, activeMonth),
              rowCount: bucket?.rowCount ?? 0,
              [activeVariable]: value,
              [`${activeVariable}_count`]: bucket?.count ?? 0,
              [`${activeVariable}_min`]: bucket?.min ?? null,
              [`${activeVariable}_max`]: bucket?.max ?? null,
            },
          }
        })

        const data: BoundaryFeatureCollection = {
          type: 'FeatureCollection',
          features,
        }

        for (const feature of data.features) {
          const value = Number(feature.properties?.[activeVariable])
          if (!Number.isFinite(value)) continue
          validBoundaryCount += 1
          minValue = minValue == null ? value : Math.min(minValue, value)
          maxValue = maxValue == null ? value : Math.max(maxValue, value)
        }

        setResult({
          data,
          loading: false,
          error: null,
          minValue,
          maxValue,
          validBoundaryCount,
          matchedRowCount,
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setResult({
          data: { type: 'FeatureCollection', features: [] },
          loading: false,
          error: (err as Error).message || 'Unable to load CANUE boundary data',
          minValue: null,
          maxValue: null,
          validBoundaryCount: 0,
          matchedRowCount: 0,
        })
      }
    }

    void load()
    return () => controller.abort()
  }, [boundaries, boundaryLevel, files, membership, month, variable, yearMode])

  return result
}

export default function MiscDataSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showSidebar, setShowSidebar] = useState(true)
  const [activeTab, setActiveTab] = useState<MiscDataTab>(() => {
    const tab = searchParams.get('tab')
    return tab === 'heatShade' || tab === 'icbc' || tab === 'wars' || tab === 'walkability' || tab === 'water' || tab === 'drought' ? tab : 'canue'
  })
  const [activeLayers, setActiveLayers] = useState<MiscLayerId[]>(['trees', 'forests', 'facilities'])
  const [showMobileLegend, setShowMobileLegend] = useState(false)
  const [canueBoundarySource, setCanueBoundarySource] = useState<CanueBoundarySource>('bcHealth')
  const [canueBoundaryLevel, setCanueBoundaryLevel] = useState<CanueBoundaryLevel>('chsa')
  const [showCanueBoundaries, setShowCanueBoundaries] = useState(true)
  const [selectedCanueDatasetId, setSelectedCanueDatasetId] = useState<string | null>(() => searchParams.get('dataset'))
  const [selectedCanueYear, setSelectedCanueYear] = useState<number | null>(() => {
    if (!searchParams.has('year')) return null
    const year = Number(searchParams.get('year'))
    return Number.isFinite(year) && year > 0 ? year : null
  })
  const [canueYearMode, setCanueYearMode] = useState<CanueYearMode>(() => (searchParams.get('years') as CanueYearMode) || 'single')
  const [canueRangeStartYear, setCanueRangeStartYear] = useState<number | null>(null)
  const [canueRangeEndYear, setCanueRangeEndYear] = useState<number | null>(null)
  const [selectedCanueMonth, setSelectedCanueMonth] = useState<number>(() => {
    const month = Number(searchParams.get('month'))
    return Number.isFinite(month) && month >= 1 && month <= 12 ? month : 1
  })
  const [selectedCanueVariable, setSelectedCanueVariable] = useState<string | null>(null)
  const [selectedCanueV2Family, setSelectedCanueV2Family] = useState<string | null>(() => searchParams.get('family'))
  const [selectedCanueV2Year, setSelectedCanueV2Year] = useState<number | null>(() => {
    if (!searchParams.has('gridYear')) return null
    const year = Number(searchParams.get('gridYear'))
    return Number.isFinite(year) && year > 0 ? year : null
  })
  const [selectedCanueV2Measure, setSelectedCanueV2Measure] = useState<string | null>(() => searchParams.get('measure'))
  const [selectedCanueV2Month, setSelectedCanueV2Month] = useState<string | null>(() => searchParams.get('gridMonth'))
  const [selectedCanueV2Property, setSelectedCanueV2Property] = useState<string | null>(() => searchParams.get('property'))
  const [selectedCanueBoundaryId, setSelectedCanueBoundaryId] = useState<string | null>(null)
  const { trees, forests, facilities, loading, error } = useHeatShadeData(activeTab === 'heatShade')
  const heatShadeManifest = useJsonManifest<HeatShadeManifest>(activeTab === 'heatShade' ? '/data/heat-shade/manifest.json' : null)
  const canueManifest = useJsonManifest<CanueManifest>(CANUE_V2_ENABLED ? null : '/data/canue/bc/annual-gzip/manifest.json')
  const canueV2Catalog = useJsonManifest<CanueV2Catalog>(CANUE_V2_ENABLED ? CANUE_V2_CATALOG_URL : null)
  const canueMembership = useJsonManifest<CanuePostalMembership>(CANUE_V2_ENABLED ? null : '/data/canue/bc/postal-boundary-membership.json')
  const canueBoundaryConfig = CANUE_BOUNDARY_CONFIG[canueBoundaryLevel]
  const canueBoundaries = useJsonManifest<BoundaryFeatureCollection>(canueBoundaryConfig.path)
  const icbc = useIcbcData(
    activeTab === 'icbc',
    searchParams.get('icbcDataset'),
    searchParams.get('icbcPoints'),
    searchParams.get('icbcHeatmap'),
  )
  const wars = useWarsData(
    activeTab === 'wars',
    searchParams.get('warsSpecies'),
    searchParams.get('warsPoints'),
    searchParams.get('warsHeatmap'),
  )
  const walkability = useWalkabilityData(
    activeTab === 'walkability',
    searchParams.get('walkability') || WALKABILITY_DEFAULT_VARIANT,
    searchParams.get('walkabilityMode') || WALKABILITY_DEFAULT_DISPLAY_MODE,
    searchParams.get('walkabilityHeatmap'),
  )
  const water = useWaterData(activeTab === 'water')

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    if (activeTab !== 'canue') params.set('tab', activeTab)
    else params.delete('tab')
    if (activeTab === 'canue') {
      if (selectedCanueDatasetId) params.set('dataset', selectedCanueDatasetId)
      else params.delete('dataset')
      if (selectedCanueYear != null) params.set('year', String(selectedCanueYear))
      else params.delete('year')
      if (canueYearMode !== 'single') params.set('years', canueYearMode)
      else params.delete('years')
      if (canueYearMode === 'month') params.set('month', String(selectedCanueMonth))
      else params.delete('month')
      if (selectedCanueV2Family) params.set('family', selectedCanueV2Family)
      else params.delete('family')
      if (selectedCanueV2Year != null) params.set('gridYear', String(selectedCanueV2Year))
      else params.delete('gridYear')
      if (selectedCanueV2Measure) params.set('measure', selectedCanueV2Measure)
      else params.delete('measure')
      if (selectedCanueV2Month) params.set('gridMonth', selectedCanueV2Month)
      else params.delete('gridMonth')
      if (selectedCanueV2Property) params.set('property', selectedCanueV2Property)
      else params.delete('property')
      params.set('boundary', canueBoundaryLevel)
    } else {
      params.delete('dataset')
      params.delete('year')
      params.delete('years')
      params.delete('month')
      params.delete('family')
      params.delete('gridYear')
      params.delete('measure')
      params.delete('gridMonth')
      params.delete('property')
      params.delete('boundary')
    }
    if (activeTab === 'icbc' && icbc.selectedDatasetId) params.set('icbcDataset', icbc.selectedDatasetId)
    else params.delete('icbcDataset')
    if (activeTab === 'icbc' && !icbc.showPoints) params.set('icbcPoints', '0')
    else params.delete('icbcPoints')
    if (activeTab === 'icbc' && icbc.showHeatmap) params.set('icbcHeatmap', '1')
    else params.delete('icbcHeatmap')
    if (activeTab === 'wars' && wars.selectedSpecies !== 'all') params.set('warsSpecies', wars.selectedSpecies)
    else params.delete('warsSpecies')
    if (activeTab === 'wars' && !wars.showPoints) params.set('warsPoints', '0')
    else params.delete('warsPoints')
    if (activeTab === 'wars' && wars.showHeatmap) params.set('warsHeatmap', '1')
    else params.delete('warsHeatmap')
    if (activeTab === 'walkability' && walkability.selectedVariantId !== WALKABILITY_DEFAULT_VARIANT) params.set('walkability', walkability.selectedVariantId)
    else params.delete('walkability')
    if (activeTab === 'walkability' && walkability.displayMode !== WALKABILITY_DEFAULT_DISPLAY_MODE) params.set('walkabilityMode', walkability.displayMode)
    else params.delete('walkabilityMode')
    if (activeTab === 'walkability' && walkability.displayMode === 'heatmap' && walkability.selectedHeatmapVariantId !== 'report_fidelity') {
      params.set('walkabilityHeatmap', walkability.selectedHeatmapVariantId)
    } else {
      params.delete('walkabilityHeatmap')
    }
    if (activeTab !== 'drought') {
      params.delete('droughtYear')
    }
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [activeTab, canueBoundaryLevel, canueYearMode, searchParams, selectedCanueDatasetId, selectedCanueMonth, selectedCanueV2Family, selectedCanueV2Measure, selectedCanueV2Month, selectedCanueV2Property, selectedCanueV2Year, selectedCanueYear, icbc.showHeatmap, icbc.showPoints, icbc.selectedDatasetId, wars.showHeatmap, wars.showPoints, wars.selectedSpecies, walkability.displayMode, walkability.selectedHeatmapVariantId, walkability.selectedVariantId, setSearchParams])

  const forestGeojson = useMemo<GeoJSON.FeatureCollection>(() => ({
    type: 'FeatureCollection',
    features: forests.map((forest) => ({
      type: 'Feature',
      id: forest.id,
      properties: {
        id: forest.id,
        name: forest.name,
        areaSqKm: forest.areaSqKm,
      },
      geometry: forest.geometry,
    })),
  }), [forests])

  const visibleTrees = useMemo(() => trees.slice(0, 900), [trees])
  const visibleFacilities = useMemo(() => facilities.slice(0, 350), [facilities])

  const canueFiles = canueManifest.data?.files ?? []
  const canueDatasetGroups = useMemo<CanueDatasetGroup[]>(() => {
    const groups = new Map<string, CanueDatasetGroup>()
    for (const file of canueFiles) {
      const group = groups.get(file.datasetId)
      if (group) {
        group.files.push(file)
        group.years.push(file.year)
      } else {
        groups.set(file.datasetId, {
          datasetId: file.datasetId,
          label: file.label,
          category: file.category,
          files: [file],
          years: [file.year],
        })
      }
    }

    return Array.from(groups.values()).map((group) => ({
      ...group,
      files: group.files.slice().sort((left, right) => left.year - right.year),
      years: Array.from(new Set(group.years)).sort((left, right) => left - right),
    })).sort((left, right) => {
      if (left.datasetId === 'pm25dale_a') return -1
      if (right.datasetId === 'pm25dale_a') return 1
      return left.label.localeCompare(right.label)
    })
  }, [canueFiles])
  const canueBoundaryLevelOptions = canueBoundarySource === 'bcHealth'
    ? CANUE_HEALTH_LEVEL_OPTIONS
    : canueBoundarySource === 'cityPG'
      ? CANUE_CITY_LEVEL_OPTIONS
      : CANUE_CENSUS_LEVEL_OPTIONS
  const selectedCanueDataset = useMemo(() => {
    if (!canueDatasetGroups.length) return null
    if (selectedCanueDatasetId) {
      const selected = canueDatasetGroups.find((dataset) => dataset.datasetId === selectedCanueDatasetId)
      if (selected) return selected
    }
    return canueDatasetGroups.find((dataset) => dataset.datasetId === 'pm25dale_a') ?? canueDatasetGroups[0]
  }, [canueDatasetGroups, selectedCanueDatasetId])
  const selectedCanueFile = useMemo(() => {
    if (!selectedCanueDataset) return null
    if (selectedCanueYear != null) {
      const selected = selectedCanueDataset.files.find((file) => file.year === selectedCanueYear)
      if (selected) return selected
    }
    return selectedCanueDataset.files[selectedCanueDataset.files.length - 1] ?? null
  }, [selectedCanueDataset, selectedCanueYear])
  const selectedCanueFiles = useMemo(() => {
    if (!selectedCanueDataset) return []
    if (canueYearMode === 'all') return selectedCanueDataset.files
    if (canueYearMode === 'range') {
      const start = canueRangeStartYear ?? selectedCanueDataset.years[0]
      const end = canueRangeEndYear ?? selectedCanueDataset.years[selectedCanueDataset.years.length - 1]
      const [minYear, maxYear] = start <= end ? [start, end] : [end, start]
      return selectedCanueDataset.files.filter((file) => file.year >= minYear && file.year <= maxYear)
    }
    return selectedCanueFile ? [selectedCanueFile] : []
  }, [canueRangeEndYear, canueRangeStartYear, canueYearMode, selectedCanueDataset, selectedCanueFile])
  const canueV2Families = canueV2Catalog.data?.families ?? []
  const selectedCanueV2FamilyEntry = useMemo(() => {
    if (!canueV2Families.length) return null
    return canueV2Families.find((family) => family.id === selectedCanueV2Family)
      ?? canueV2Families.find((family) => family.id === 'air-quality')
      ?? canueV2Families[0]
  }, [canueV2Families, selectedCanueV2Family])
  const selectedCanueV2FamilySelections = useMemo<CanueVariableSelection[]>(() => {
    if (!canueV2Catalog.data || !selectedCanueV2FamilyEntry) return []
    return listCanueV2Selections(canueV2Catalog.data).filter((selection) => selection.family === selectedCanueV2FamilyEntry.id)
  }, [canueV2Catalog.data, selectedCanueV2FamilyEntry])
  const canueV2MeasureOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string }>()
    for (const selection of selectedCanueV2FamilySelections) {
      const value = getCanueV2MeasureKey(selection)
      if (!options.has(value)) options.set(value, { value, label: `${selection.dataset}: ${getCanueV2VariableLabel(selection)}` })
    }
    return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label))
  }, [selectedCanueV2FamilySelections])
  const selectedCanueV2MeasureKey = useMemo(() => {
    if (selectedCanueV2Measure && canueV2MeasureOptions.some((option) => option.value === selectedCanueV2Measure)) return selectedCanueV2Measure
    if (selectedCanueV2Property) {
      const propertySelection = selectedCanueV2FamilySelections.find((selection) => selection.property === selectedCanueV2Property)
      if (propertySelection) return getCanueV2MeasureKey(propertySelection)
    }
    return canueV2MeasureOptions.find((option) => option.value.includes('pm25'))?.value ?? canueV2MeasureOptions[0]?.value ?? null
  }, [canueV2MeasureOptions, selectedCanueV2FamilySelections, selectedCanueV2Measure, selectedCanueV2Property])
  const selectedCanueV2MeasureSelections = useMemo(() => (
    selectedCanueV2MeasureKey
      ? selectedCanueV2FamilySelections.filter((selection) => getCanueV2MeasureKey(selection) === selectedCanueV2MeasureKey)
      : []
  ), [selectedCanueV2FamilySelections, selectedCanueV2MeasureKey])
  const canueV2YearOptions = useMemo(() => (
    Array.from(new Set(selectedCanueV2MeasureSelections.map((selection) => selection.year))).sort((left, right) => left - right)
  ), [selectedCanueV2MeasureSelections])
  const selectedCanueV2ResolvedYear = useMemo(() => (
    selectedCanueV2Year != null && canueV2YearOptions.includes(selectedCanueV2Year)
      ? selectedCanueV2Year
      : canueV2YearOptions[canueV2YearOptions.length - 1] ?? null
  ), [canueV2YearOptions, selectedCanueV2Year])
  const canueV2MonthOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: string }>()
    for (const selection of selectedCanueV2MeasureSelections) {
      if (selectedCanueV2ResolvedYear != null && selection.year !== selectedCanueV2ResolvedYear) continue
      const monthKey = getCanueV2MonthKey(selection.variable)
      if (monthKey && !options.has(monthKey)) {
        options.set(monthKey, { value: monthKey, label: CANUE_MONTH_BY_KEY.get(monthKey)?.label ?? monthKey.toUpperCase() })
      }
    }
    return Array.from(options.values()).sort((left, right) => {
      const leftMonth = CANUE_MONTH_BY_KEY.get(left.value)?.value ?? 99
      const rightMonth = CANUE_MONTH_BY_KEY.get(right.value)?.value ?? 99
      return leftMonth - rightMonth
    })
  }, [selectedCanueV2MeasureSelections, selectedCanueV2ResolvedYear])
  const selectedCanueV2ResolvedMonth = useMemo(() => {
    if (!canueV2MonthOptions.length) return null
    if (selectedCanueV2Month && canueV2MonthOptions.some((option) => option.value === selectedCanueV2Month)) return selectedCanueV2Month
    if (selectedCanueV2Property) {
      const propertySelection = selectedCanueV2MeasureSelections.find((selection) => selection.property === selectedCanueV2Property)
      const propertyMonth = propertySelection ? getCanueV2MonthKey(propertySelection.variable) : null
      if (propertyMonth && canueV2MonthOptions.some((option) => option.value === propertyMonth)) return propertyMonth
    }
    return canueV2MonthOptions[0].value
  }, [canueV2MonthOptions, selectedCanueV2MeasureSelections, selectedCanueV2Month, selectedCanueV2Property])
  const selectedCanueV2Layer = useMemo(() => {
    if (!selectedCanueV2FamilyEntry || selectedCanueV2ResolvedYear == null) return null
    return selectedCanueV2FamilyEntry.layers.find((layer) => layer.year === selectedCanueV2ResolvedYear)
      ?? selectedCanueV2FamilyEntry.layers[selectedCanueV2FamilyEntry.layers.length - 1]
      ?? null
  }, [selectedCanueV2FamilyEntry, selectedCanueV2ResolvedYear])
  const selectedCanueV2Selection = useMemo<CanueVariableSelection | null>(() => {
    if (!selectedCanueV2Layer || !selectedCanueV2MeasureKey) return null
    return selectedCanueV2MeasureSelections.find((selection) => (
      selection.year === selectedCanueV2Layer.year
      && getCanueV2MeasureKey(selection) === selectedCanueV2MeasureKey
      && (
        selectedCanueV2ResolvedMonth
          ? getCanueV2MonthKey(selection.variable) === selectedCanueV2ResolvedMonth
          : getCanueV2MonthKey(selection.variable) == null
      )
    )) ?? selectedCanueV2MeasureSelections.find((selection) => selection.year === selectedCanueV2Layer.year) ?? null
  }, [selectedCanueV2Layer, selectedCanueV2MeasureKey, selectedCanueV2MeasureSelections, selectedCanueV2ResolvedMonth])
  const canuePeriodLabel = getCanuePeriodLabel(selectedCanueFiles, canueYearMode, selectedCanueMonth)
  const canueBoundaryData = useCanueBoundaryData(
    selectedCanueFiles,
    selectedCanueVariable,
    canueBoundaries.data,
    canueBoundaryLevel,
    canueMembership.data,
    canueYearMode,
    selectedCanueMonth,
  )
  const canuePmtilesBoundaryData = useCanuePmtilesBoundaryData({
    selection: selectedCanueV2Selection,
    boundaries: canueBoundaries.data,
    idField: canueBoundaryConfig.idField,
    nameField: canueBoundaryConfig.nameField,
    enabled: activeTab === 'canue' && showCanueBoundaries && CANUE_V2_ENABLED,
  })
  const canueV2AggregateData = useCanueV2AggregateData({
    source: canueBoundarySource,
    level: canueBoundaryLevel,
    selection: selectedCanueV2Selection,
    boundaries: canueBoundaries.data,
    enabled: activeTab === 'canue' && showCanueBoundaries && CANUE_V2_ENABLED,
  })
  const activeCanueBoundaryData = CANUE_V2_ENABLED && selectedCanueV2Selection
    ? canueV2AggregateData.validBoundaryCount > 0 || canueV2AggregateData.loading || !canueV2AggregateData.error
      ? canueV2AggregateData
      : canuePmtilesBoundaryData
    : canueBoundaryData
  const activeCanueBoundaryProperty = selectedCanueV2Selection?.property ?? selectedCanueVariable ?? ''
  const selectedCanueBoundary = useMemo(() => {
    if (!selectedCanueBoundaryId) return null
    return activeCanueBoundaryData.data.features.find((feature) => {
      const featureId = feature.properties?.boundaryId ?? feature.id
      return featureId != null && String(featureId) === selectedCanueBoundaryId
    }) ?? null
  }, [activeCanueBoundaryData.data.features, selectedCanueBoundaryId])
  const canueFillColor = useMemo(() => {
    return canueBoundaryPaint(activeCanueBoundaryProperty, activeCanueBoundaryData.minValue, activeCanueBoundaryData.maxValue)
  }, [activeCanueBoundaryData.maxValue, activeCanueBoundaryData.minValue, activeCanueBoundaryProperty])
  const heatShadeSources = heatShadeManifest.data?.sources ?? []
  const landsatSource = heatShadeSources.find((source) => source.kind === 'historicalNdviLst')
  const canueMapCenter = canueBoundarySource === 'bcHealth' ? BC_CENTER : PG_CENTER
  const canueMapZoom = canueBoundarySource === 'bcHealth' ? 4.4 : canueBoundarySource === 'cityPG' ? 10.2 : 9.4
  const mapCenter = activeTab === 'canue' ? canueMapCenter : activeTab === 'water' ? BC_CENTER : PG_CENTER
  const mapZoom = activeTab === 'canue' ? canueMapZoom : activeTab === 'water' ? 4.4 : activeTab === 'icbc' || activeTab === 'wars' ? 10.5 : activeTab === 'walkability' ? 9.7 : 11
  const mapKey = activeTab === 'canue' ? `${activeTab}-${canueBoundarySource}` : activeTab === 'water' ? `${activeTab}-${water.boundarySource}` : activeTab

  useEffect(() => {
    if (!selectedCanueDataset || !selectedCanueFile) return
    if (selectedCanueDatasetId !== selectedCanueDataset.datasetId) setSelectedCanueDatasetId(selectedCanueDataset.datasetId)
    if (selectedCanueYear !== selectedCanueFile.year) setSelectedCanueYear(selectedCanueFile.year)
    if (selectedCanueFile.cadence !== 'monthly' && canueYearMode === 'month') setCanueYearMode('single')
    if (selectedCanueDataset.years.length <= 1 && canueYearMode !== 'single' && canueYearMode !== 'month') setCanueYearMode('single')
    if (canueRangeStartYear == null) setCanueRangeStartYear(selectedCanueDataset.years[0])
    if (canueRangeEndYear == null) setCanueRangeEndYear(selectedCanueDataset.years[selectedCanueDataset.years.length - 1])
    const selectableVariables = getSelectableCanueVariables(selectedCanueFile)
    if (!selectedCanueVariable || !selectableVariables.includes(selectedCanueVariable)) {
      setSelectedCanueVariable(getDefaultCanueVariable(selectedCanueFile))
    }
  }, [
    canueRangeEndYear,
    canueRangeStartYear,
    canueYearMode,
    selectedCanueDataset,
    selectedCanueDatasetId,
    selectedCanueFile,
    selectedCanueVariable,
    selectedCanueYear,
  ])

  useEffect(() => {
    if (!selectedCanueV2FamilyEntry || !selectedCanueV2Layer || !selectedCanueV2Selection) return
    if (selectedCanueV2Family !== selectedCanueV2FamilyEntry.id) setSelectedCanueV2Family(selectedCanueV2FamilyEntry.id)
    if (selectedCanueV2Measure !== selectedCanueV2MeasureKey) setSelectedCanueV2Measure(selectedCanueV2MeasureKey)
    if (selectedCanueV2Month !== selectedCanueV2ResolvedMonth) setSelectedCanueV2Month(selectedCanueV2ResolvedMonth)
    if (selectedCanueV2Year !== selectedCanueV2Layer.year) setSelectedCanueV2Year(selectedCanueV2Layer.year)
    if (selectedCanueV2Property !== selectedCanueV2Selection.property) setSelectedCanueV2Property(selectedCanueV2Selection.property)
  }, [
    selectedCanueV2Family,
    selectedCanueV2FamilyEntry,
    selectedCanueV2Layer,
    selectedCanueV2Measure,
    selectedCanueV2MeasureKey,
    selectedCanueV2Month,
    selectedCanueV2Property,
    selectedCanueV2ResolvedMonth,
    selectedCanueV2Selection,
    selectedCanueV2Year,
  ])

  useEffect(() => {
    setSelectedCanueBoundaryId(null)
  }, [canueBoundaryLevel, canuePeriodLabel, selectedCanueDatasetId, selectedCanueVariable])

  const handleCanueBoundarySourceChange = (source: CanueBoundarySource) => {
    setCanueBoundarySource(source)
    setCanueBoundaryLevel(source === 'bcHealth' ? 'chsa' : source === 'cityPG' ? 'elementarySchoolCatchment' : 'da')
    setSelectedCanueBoundaryId(null)
  }

  const toggleLayer = (layer: MiscLayerId) => {
    setActiveLayers((current) =>
      current.includes(layer)
        ? current.filter((item) => item !== layer)
        : [...current, layer]
    )
  }

  const sourceNotes = (
    <>
      {activeTab === 'heatShade' && <p>Heat/shade updated {formatDate(heatShadeManifest.data?.generatedAt)}.</p>}
      {activeTab === 'canue' && <p>CANUE raw extracts updated {formatDate(canueManifest.data?.generatedAt)}.</p>}
      {activeTab === 'icbc' && <IcbcSourceNotes icbc={icbc} />}
      {activeTab === 'wars' && <WarsSourceNotes wars={wars} />}
      {activeTab === 'walkability' && <WalkabilitySourceNotes walkability={walkability} />}
      {activeTab === 'water' && <WaterSourceNotes water={water} />}
      {activeTab === 'heatShade' && (heatShadeManifest.data?.caveats ?? []).slice(0, 2).map((caveat) => (
        <p key={caveat}>{caveat}</p>
      ))}
    </>
  )

  const sidebar = (
    <div className="z-10 flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">MISC Data</h1>
        {activeTab === 'icbc' && <IcbcLayerControls icbc={icbc} />}
        {activeTab === 'wars' && <WarsLayerControls wars={wars} />}
        {activeTab === 'water' && <WaterLayerControls water={water} />}
      </div>

      <DatasetInfo
        dataset={{
          ...(activeTab === 'heatShade'
            ? DATASETS.heatShade
            : activeTab === 'icbc'
              ? DATASETS.icbc
              : activeTab === 'wars'
                ? DATASETS.wars
              : activeTab === 'walkability'
                ? DATASETS.walkability
              : activeTab === 'water'
                ? DATASETS.water
                : DATASETS.canue),
          updated: activeTab === 'heatShade'
            ? heatShadeManifest.data?.generatedAt
            : activeTab === 'icbc'
              ? icbc.manifest.data?.generatedAt
              : activeTab === 'wars'
                ? wars.manifest.data?.generatedAt
              : activeTab === 'walkability'
                ? walkability.manifest.data?.generatedAt
              : activeTab === 'water'
                ? water.manifest.data?.generatedAt
                : canueManifest.data?.generatedAt,
        }}
        sourceNotes={sourceNotes}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {activeTab === 'heatShade' && (
        <>
        <div className="border-b border-border p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Map Layers</h2>
          <div className="space-y-2">
            {MISC_LAYERS.map((layer) => (
              <label key={layer.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={activeLayers.includes(layer.id)}
                    onChange={() => toggleLayer(layer.id)}
                    className="h-3.5 w-3.5 rounded border-input"
                    style={{ accentColor: layer.color }}
                  />
                  <span className="text-sm text-foreground">{layer.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {layer.id === 'trees'
                    ? trees.length.toLocaleString()
                    : layer.id === 'forests'
                      ? forests.length.toLocaleString()
                      : facilities.length.toLocaleString()}
                </span>
              </label>
            ))}
          </div>
          {loading && <div className="mt-3 text-xs text-muted-foreground">Loading heat and shade data...</div>}
          {error && <div className="mt-3 text-xs text-red-500">{error}</div>}
        </div>

        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Trees className="h-4 w-4 text-green-600" />
            <h2 className="text-sm font-semibold text-foreground">Heat, Shade, and Canopy</h2>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-foreground">{trees.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">tree points</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-foreground">{forests.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">forest areas</div>
            </div>
            <div className="rounded-md border border-border p-2">
              <div className="text-lg font-bold text-foreground">{facilities.length.toLocaleString()}</div>
              <div className="text-[10px] text-muted-foreground">facilities</div>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-muted-foreground">
            Tree points are shown as a canopy and shade proxy until a full canopy raster or canopy polygon layer is available.
          </p>
        </div>

        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Satellite className="h-4 w-4 text-violet-600" />
            <h2 className="text-sm font-semibold text-foreground">Remote Sensing Queue</h2>
          </div>
          <div className="rounded-md border border-border p-3 text-sm">
            <div className="font-medium text-foreground">{landsatSource?.name ?? 'Landsat warm-season scenes'}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {landsatSource?.sceneCount ?? 0} scenes
              {landsatSource?.years?.length ? ` across ${landsatSource.years.join(', ')}` : ''}
            </div>
          </div>
        </div>
        </>
        )}

        {activeTab === 'canue' && (
        <>
        <StudyAreaSelector<string, CanueBoundaryLevel>
          source={showCanueBoundaries ? canueBoundarySource : undefined}
          sourceOptions={CANUE_BOUNDARY_SOURCE_OPTIONS}
          level={canueBoundaryLevel}
          levelOptions={showCanueBoundaries ? canueBoundaryLevelOptions : []}
          onSourceChange={(value) => {
            if (CANUE_SUPPORTED_SOURCES.has(value)) {
              setShowCanueBoundaries(true)
              handleCanueBoundarySourceChange(value as CanueBoundarySource)
            }
          }}
          onSelectedSourceClick={() => setShowCanueBoundaries(false)}
          onLevelChange={setCanueBoundaryLevel}
          levelSelectId="canue-study-area-level"
        />

        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-600" />
            <h2 className="text-sm font-semibold text-foreground">CANUE Boundary Map</h2>
          </div>
          {CANUE_V2_ENABLED && selectedCanueV2FamilyEntry && selectedCanueV2Layer && selectedCanueV2Selection && (
            <div className="mb-4 space-y-3 rounded-md border border-border bg-muted/15 p-3">
              <div>
                <div className="text-xs font-semibold text-foreground">R2 PMTiles Grid</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  {canueV2Catalog.data ? `${canueV2Catalog.data.families.length} families from Cloudflare R2` : 'Loading R2 catalog...'}
                </div>
              </div>
              <label className="block text-xs font-medium text-foreground">
                Family
                <AppSelect
                  value={selectedCanueV2FamilyEntry.id}
                  onValueChange={(familyId) => {
                    const nextFamily = canueV2Families.find((family) => family.id === familyId)
                    const nextSelection = nextFamily && canueV2Catalog.data
                      ? listCanueV2Selections(canueV2Catalog.data).find((selection) => selection.family === nextFamily.id)
                      : null
                    setSelectedCanueV2Family(familyId)
                    setSelectedCanueV2Measure(nextSelection ? getCanueV2MeasureKey(nextSelection) : null)
                    setSelectedCanueV2Year(nextSelection?.year ?? nextFamily?.years[nextFamily.years.length - 1] ?? null)
                    setSelectedCanueV2Month(nextSelection ? getCanueV2MonthKey(nextSelection.variable) : null)
                    setSelectedCanueV2Property(nextSelection?.property ?? null)
                  }}
                  options={canueV2Families.map((family) => ({
                    value: family.id,
                    label: `${family.label} (${family.layerCount})`,
                  }))}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
              <label className="block text-xs font-medium text-foreground">
                Grid variable
                <AppSelect
                  value={selectedCanueV2MeasureKey ?? ''}
                  onValueChange={(measure) => {
                    const nextSelection = selectedCanueV2FamilySelections.find((selection) => getCanueV2MeasureKey(selection) === measure)
                    setSelectedCanueV2Measure(measure)
                    setSelectedCanueV2Year(nextSelection?.year ?? null)
                    setSelectedCanueV2Month(nextSelection ? getCanueV2MonthKey(nextSelection.variable) : null)
                    setSelectedCanueV2Property(nextSelection?.property ?? null)
                  }}
                  options={canueV2MeasureOptions}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
              <label className="block text-xs font-medium text-foreground">
                Grid year
                <AppSelect
                  value={selectedCanueV2ResolvedYear == null ? '' : String(selectedCanueV2ResolvedYear)}
                  onValueChange={(year) => {
                    setSelectedCanueV2Year(Number(year))
                    setSelectedCanueV2Property(null)
                  }}
                  options={canueV2YearOptions.map((year) => ({
                    value: String(year),
                    label: String(year),
                  }))}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
              {canueV2MonthOptions.length > 0 && (
                <label className="block text-xs font-medium text-foreground">
                  Grid month
                  <AppSelect
                    value={selectedCanueV2ResolvedMonth ?? canueV2MonthOptions[0]?.value ?? ''}
                    onValueChange={(month) => {
                      setSelectedCanueV2Month(month)
                      setSelectedCanueV2Property(null)
                    }}
                    options={canueV2MonthOptions}
                    className="mt-1"
                    triggerClassName="h-8 rounded-md text-xs"
                  />
                </label>
              )}
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded border border-border p-2">
                  <div className="text-sm font-bold text-foreground">{selectedCanueV2Layer.features.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">grid cells</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-sm font-bold text-foreground">
                    {formatNullableNumber(selectedCanueV2Selection.min)}-{formatNullableNumber(selectedCanueV2Selection.max)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">tile range</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded border border-border p-2">
                  <div className="text-sm font-bold text-foreground">{activeCanueBoundaryData.validBoundaryCount.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">areas with values</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-sm font-bold text-foreground">
                    {canueV2AggregateData.validBoundaryCount > 0 ? 'R2' : canuePmtilesBoundaryData.zoom == null ? '-' : `z${canuePmtilesBoundaryData.zoom}`}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {canueV2AggregateData.validBoundaryCount > 0
                      ? 'aggregate'
                      : `${canuePmtilesBoundaryData.tileCount.toLocaleString()} tiles${canuePmtilesBoundaryData.capped ? ' capped' : ''}`}
                  </div>
                </div>
              </div>
              {activeCanueBoundaryData.loading && (
                <div className="text-xs text-muted-foreground">Loading CANUE boundary averages...</div>
              )}
              {activeCanueBoundaryData.error && (
                <div className="text-xs text-red-500">{activeCanueBoundaryData.error}</div>
              )}
              {!activeCanueBoundaryData.loading && activeCanueBoundaryData.validBoundaryCount > 0 && (
                <div className="rounded-md border border-border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
                  {canueV2AggregateData.validBoundaryCount > 0
                    ? `Using precomputed R2 aggregate values for ${canueBoundaryConfig.label}; ${canueV2AggregateData.matchedFeatureCount.toLocaleString()} grid-cell values are represented.`
                    : `Experimental client-side score input from ${canuePmtilesBoundaryData.decodedFeatureCount.toLocaleString()} decoded tile features; ${canuePmtilesBoundaryData.matchedFeatureCount.toLocaleString()} matched to ${canueBoundaryConfig.label} boundaries by grid-cell centroid.`}
                </div>
              )}
              {selectedCanueBoundary && (
                <div className="rounded-md border border-border bg-background p-3 text-xs">
                  <div className="font-semibold text-foreground">
                    {String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary')}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{getCanueV2VariableLabel(selectedCanueV2Selection)}</span>
                    <span className="font-semibold text-foreground">
                      {formatNullableNumber(Number(selectedCanueBoundary.properties?.[selectedCanueV2Selection.property]))}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {Number(selectedCanueBoundary.properties?.rowCount ?? 0).toLocaleString()} decoded grid features
                  </div>
                </div>
              )}
            </div>
          )}
          {selectedCanueFile && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-foreground">
                Dataset
                <AppSelect
                  value={selectedCanueDataset?.datasetId ?? ''}
                  onValueChange={(datasetId) => {
                    const nextDataset = canueDatasetGroups.find((dataset) => dataset.datasetId === datasetId)
                    const nextFile = nextDataset?.files[nextDataset.files.length - 1] ?? null
                    setSelectedCanueDatasetId(datasetId)
                    setSelectedCanueYear(nextFile?.year ?? null)
                    setCanueYearMode('single')
                    setCanueRangeStartYear(nextDataset?.years[0] ?? null)
                    setCanueRangeEndYear(nextDataset?.years[nextDataset.years.length - 1] ?? null)
                    setSelectedCanueVariable(nextFile ? getDefaultCanueVariable(nextFile) : null)
                  }}
                  options={canueDatasetGroups.map((dataset) => ({
                    value: dataset.datasetId,
                    label: dataset.years.length > 1
                      ? `${dataset.label} (${dataset.years[0]}-${dataset.years[dataset.years.length - 1]})`
                      : `${dataset.label} (${dataset.years[0]})`,
                  }))}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
              {selectedCanueDataset && (selectedCanueDataset.years.length > 1 || selectedCanueFile.cadence === 'monthly') && (
                <div className="space-y-2 rounded-md border border-border bg-muted/15 p-2">
                  <label className="block text-xs font-medium text-foreground">
                    Time
                    <AppSelect
                      value={canueYearMode}
                      onValueChange={(value) => setCanueYearMode(value as CanueYearMode)}
                      options={[
                        { value: 'single', label: selectedCanueFile.cadence === 'monthly' ? 'Year average' : 'Single year' },
                        ...(selectedCanueFile.cadence === 'monthly' ? [{ value: 'month', label: 'Single month' }] : []),
                        { value: 'all', label: 'All years average' },
                        { value: 'range', label: 'Year range average' },
                      ]}
                      className="mt-1"
                      triggerClassName="h-8 rounded-md text-xs"
                    />
                  </label>
                  {(canueYearMode === 'single' || canueYearMode === 'month') && (
                    <label className="block text-xs font-medium text-foreground">
                      Year
                      <AppSelect
                        value={String(selectedCanueFile.year)}
                        onValueChange={(year) => {
                          const nextYear = Number(year)
                          const nextFile = selectedCanueDataset.files.find((file) => file.year === nextYear)
                          setSelectedCanueYear(nextYear)
                          setSelectedCanueVariable(nextFile ? getDefaultCanueVariable(nextFile) : selectedCanueVariable)
                        }}
                        options={selectedCanueDataset.years.map((year) => ({
                          value: String(year),
                          label: String(year),
                        }))}
                        className="mt-1"
                        triggerClassName="h-8 rounded-md text-xs"
                      />
                    </label>
                  )}
                  {canueYearMode === 'month' && selectedCanueFile.cadence === 'monthly' && (
                    <label className="block text-xs font-medium text-foreground">
                      Month
                      <AppSelect
                        value={String(selectedCanueMonth)}
                        onValueChange={(month) => setSelectedCanueMonth(Number(month))}
                        options={CANUE_MONTHS.map((month) => ({
                          value: String(month.value),
                          label: month.label,
                        }))}
                        className="mt-1"
                        triggerClassName="h-8 rounded-md text-xs"
                      />
                    </label>
                  )}
                  {canueYearMode === 'range' && (
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs font-medium text-foreground">
                        Start
                        <AppSelect
                          value={String(canueRangeStartYear ?? selectedCanueDataset.years[0])}
                          onValueChange={(year) => setCanueRangeStartYear(Number(year))}
                          options={selectedCanueDataset.years.map((year) => ({
                            value: String(year),
                            label: String(year),
                          }))}
                          className="mt-1"
                          triggerClassName="h-8 rounded-md text-xs"
                        />
                      </label>
                      <label className="block text-xs font-medium text-foreground">
                        End
                        <AppSelect
                          value={String(canueRangeEndYear ?? selectedCanueDataset.years[selectedCanueDataset.years.length - 1])}
                          onValueChange={(year) => setCanueRangeEndYear(Number(year))}
                          options={selectedCanueDataset.years.map((year) => ({
                            value: String(year),
                            label: String(year),
                          }))}
                          className="mt-1"
                          triggerClassName="h-8 rounded-md text-xs"
                        />
                      </label>
                    </div>
                  )}
                </div>
              )}
              <label className="block text-xs font-medium text-foreground">
                Map variable
                <AppSelect
                  value={selectedCanueVariable ?? ''}
                  onValueChange={setSelectedCanueVariable}
                  options={getSelectableCanueVariables(selectedCanueFile).map((variable) => ({
                    value: variable,
                    label: `${getCanueVariableLabel(selectedCanueFile, variable)} (${variable})`,
                  }))}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded border border-border p-2">
                  <div className="text-sm font-bold text-foreground">{activeCanueBoundaryData.validBoundaryCount.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">with values</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-sm font-bold text-foreground">
                    {formatNullableNumber(activeCanueBoundaryData.minValue)}-{formatNullableNumber(activeCanueBoundaryData.maxValue)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">sample range</div>
                </div>
              </div>
              {activeCanueBoundaryData.loading && <div className="text-xs text-muted-foreground">Aggregating CANUE records...</div>}
              {activeCanueBoundaryData.error && <div className="text-xs text-red-500">{activeCanueBoundaryData.error}</div>}
              <div className="rounded-md border border-border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
                {getCanueVariableLabel(selectedCanueFile, selectedCanueVariable ?? '')} is aggregated in the browser from raw boundary-clipped CANUE records for {canuePeriodLabel}.
              </div>
              {selectedCanueBoundary && selectedCanueVariable && (
                <div className="rounded-md border border-border bg-background p-3 text-xs">
                  <div className="font-semibold text-foreground">
                    {String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary')}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{getCanueVariableLabel(selectedCanueFile, selectedCanueVariable)}</span>
                    <span className="font-semibold text-foreground">
                      {formatNullableNumber(Number(selectedCanueBoundary.properties?.[activeCanueBoundaryProperty]))}
                    </span>
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    {Number(selectedCanueBoundary.properties?.rowCount ?? 0).toLocaleString()} source records
                  </div>
                </div>
              )}
            </div>
          )}
          {canueManifest.error && <div className="mb-2 text-xs text-red-500">{canueManifest.error}</div>}
          {canueMembership.error && <div className="mb-2 text-xs text-red-500">{canueMembership.error}</div>}
          {canueBoundaries.error && <div className="mb-2 text-xs text-red-500">{canueBoundaries.error}</div>}
        </div>
        </>
        )}

        {activeTab === 'icbc' && <IcbcSidebar icbc={icbc} />}

        {activeTab === 'wars' && <WarsSidebar wars={wars} />}

        {activeTab === 'walkability' && <WalkabilitySidebar walkability={walkability} />}

        {activeTab === 'water' && <WaterSidebar water={water} />}

      </div>
    </div>
  )

  const tabsBar = (
    <div className="min-w-0 shrink-0 overflow-x-auto border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:px-4">
      <div className="flex w-max rounded-lg border border-border bg-muted/40 p-1">
        {MISC_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors sm:px-3',
              activeTab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className={id === 'heatShade' ? 'hidden sm:inline' : ''}>{label}</span>
            {id === 'heatShade' && <span className="sm:hidden">Shade</span>}
          </button>
        ))}
      </div>
    </div>
  )

  if (activeTab === 'drought') {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        {tabsBar}
        <div className="min-h-0 flex-1">
          <DroughtSection yearParam="droughtYear" />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {tabsBar}
      <div className="min-h-0 flex-1">
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            MISC Data | {activeTab === 'canue' ? 'CANUE' : activeTab === 'icbc' ? 'ICBC' : activeTab === 'wars' ? 'WARS' : activeTab === 'walkability' ? 'Walkability' : activeTab === 'water' ? 'Water' : 'Heat/shade'}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {activeTab === 'canue'
              ? `${selectedCanueDataset?.label || 'Dataset'} | ${canuePeriodLabel}`
              : activeTab === 'icbc'
                ? `${icbc.selectedDataset?.title || 'Crash locations'} | ${icbc.crashFeatures.length.toLocaleString()} mapped`
                : activeTab === 'wars'
                  ? `${wars.selectedSpecies === 'all' ? 'All species' : wars.selectedSpecies} | ${wars.filteredFeatures.length.toLocaleString()} records`
                : activeTab === 'walkability'
                  ? walkability.displayMode === 'heatmap'
                    ? `${walkability.selectedHeatmapVariant?.label || 'Citywide MI grid'}`
                    : `${walkability.selectedVariant?.label || 'Variant'} | ${walkability.features.length.toLocaleString()} communities`
                  : activeTab === 'water'
                    ? `${water.facilities.length.toLocaleString()} facilities | ${water.filteredSamples.length.toLocaleString()} sample rows`
                  : `${trees.length.toLocaleString()} trees | ${forests.length.toLocaleString()} forests`}
          </div>
        </div>
      )}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <PgMap key={mapKey} center={mapCenter} zoom={mapZoom} styles={MAP_STYLES}>
          <MapControls position="top-right" showZoom showCompass />

          <MapFillLayer
            data={forestGeojson}
            fillColor="#15803d"
            fillOpacity={0.28}
            lineColor="#166534"
            lineWidth={1.2}
            lineOpacity={0.8}
            visible={activeTab === 'heatShade' && activeLayers.includes('forests')}
          />

          {activeTab === 'heatShade' && activeLayers.includes('trees') && visibleTrees.map((tree, index) => (
            <MapMarker key={`${tree.id}-${index}`} longitude={tree.longitude} latitude={tree.latitude}>
              <MarkerContent>
                <div className="h-2 w-2 rounded-full border border-white bg-green-600 shadow-sm" />
              </MarkerContent>
            </MapMarker>
          ))}

          {activeTab === 'heatShade' && activeLayers.includes('facilities') && visibleFacilities.map((facility, index) => (
            <MapMarker key={`${facility.id}-${index}`} longitude={facility.longitude} latitude={facility.latitude}>
              <MarkerContent>
                <div className="h-3 w-3 rounded-full border border-white bg-sky-500 shadow-sm" />
              </MarkerContent>
            </MapMarker>
          ))}

          {activeTab === 'canue' && CANUE_V2_ENABLED && selectedCanueV2Selection && (
            <MapPmtilesFillLayer
              key={`${selectedCanueV2Selection.pmtilesUrl}-${selectedCanueV2Selection.property}`}
              url={selectedCanueV2Selection.pmtilesUrl}
              sourceLayer="canue"
              fillColor={canueV2Paint(selectedCanueV2Selection)}
              fillOpacity={0.64}
              lineColor="#0f172a"
              lineWidth={0.18}
              lineOpacity={0.22}
            />
          )}

          {activeTab === 'canue' && showCanueBoundaries && activeCanueBoundaryData.data.features.length > 0 && (
            <MapFillLayer
              data={activeCanueBoundaryData.data}
              fillColor={canueFillColor}
              fillOpacity={0.74}
              lineColor="#0e7490"
              lineWidth={0.7}
              lineOpacity={0.58}
              idProperty="boundaryId"
              selectedId={selectedCanueBoundaryId}
              selectionColor="#111827"
              selectionWidth={2.1}
              onFeatureClick={setSelectedCanueBoundaryId}
            />
          )}

          {activeTab === 'walkability' && <WalkabilityLayer walkability={walkability} />}

          {activeTab === 'water' && <WaterLayer water={water} />}

          {activeTab === 'icbc' && <IcbcLayer icbc={icbc} />}

          {activeTab === 'wars' && <WarsLayer wars={wars} />}
        </PgMap>

        {activeTab === 'wars' && wars.timelineEnabled && wars.timelineDate && (
          <Timeline
            startDate={wars.accidentDateRange.start}
            endDate={wars.accidentDateRange.end}
            currentDate={wars.timelineDate}
            onDateChange={wars.setTimelineDate}
            onClose={wars.handleTimelineDisable}
            granularity="year"
            bucketCounts={wars.bucketCounts}
            compactBars
            windowMode={{
              size: wars.timelineWindowSize,
              onSizeChange: wars.setTimelineWindowSize,
              options: WARS_TIMELINE_WINDOW_OPTIONS,
            }}
          />
        )}

        {activeTab === 'icbc' && icbc.timelineEnabled && icbc.timelineDate && (
          <Timeline
            startDate={icbc.crashDateRange.start}
            endDate={icbc.crashDateRange.end}
            currentDate={icbc.timelineDate}
            onDateChange={icbc.setTimelineDate}
            onClose={icbc.handleTimelineDisable}
            granularity="year"
            windowMode={{
              size: icbc.timelineWindowSize,
              onSizeChange: icbc.setTimelineWindowSize,
              options: ICBC_TIMELINE_WINDOW_OPTIONS,
            }}
          />
        )}

        {activeTab === 'water' && water.timelineEnabled && water.timelineDate && (
          <Timeline
            startDate={water.sampleDateRange.start}
            endDate={water.sampleDateRange.end}
            currentDate={water.timelineDate}
            onDateChange={water.setTimelineDate}
            onClose={water.handleTimelineDisable}
            bucketCounts={water.bucketCounts}
            compactBars
            windowMode={{
              size: water.timelineWindowSize,
              onSizeChange: water.setTimelineWindowSize,
              options: WATER_TIMELINE_WINDOW_OPTIONS,
            }}
            statsLabel={`${water.filteredSamples.length.toLocaleString()} sample rows`}
          />
        )}

        <div
          className={cn(
            'absolute right-3 z-10 w-[min(16.5rem,calc(100vw-2rem))] rounded-lg border border-border bg-background/95 p-2 shadow-xl backdrop-blur md:right-6 md:w-auto md:rounded-xl md:p-4',
            (activeTab === 'wars' && wars.timelineEnabled) || (activeTab === 'icbc' && icbc.timelineEnabled) || (activeTab === 'water' && water.timelineEnabled)
              ? 'bottom-[calc(var(--map-mobile-sheet-visible-height,72px)_+_var(--map-timeline-height,5.5rem)_+_0.75rem)] md:bottom-[calc(var(--map-timeline-height,5.5rem)_+_1.5rem)]'
              : 'bottom-[calc(var(--map-mobile-sheet-visible-height,72px)_+_0.75rem)] md:bottom-6',
          )}
        >
          <div className="flex items-center justify-between gap-2 md:mb-2">
            <h4 className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold text-foreground">
              <Layers className="h-3.5 w-3.5 shrink-0" />
              <span>
                {activeTab === 'canue' ? 'CANUE Layer' : activeTab === 'icbc' ? 'ICBC Layer' : activeTab === 'wars' ? 'WARS Layer' : activeTab === 'walkability' ? 'Walkability Layer' : activeTab === 'water' ? 'Water Layer' : 'MISC Layers'}
              </span>
            </h4>
            <button
              type="button"
              onClick={() => setShowMobileLegend((current) => !current)}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground md:hidden"
              aria-label={showMobileLegend ? 'Hide map legend' : 'Show map legend'}
              aria-expanded={showMobileLegend}
            >
              {showMobileLegend ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className={cn('mt-2 space-y-1 md:mt-0 md:block', showMobileLegend ? 'block' : 'hidden')}>
            {activeTab === 'heatShade' && MISC_LAYERS.filter((layer) => activeLayers.includes(layer.id)).map((layer) => (
              <div key={layer.id} className="flex items-center gap-2">
                <span className={cn('h-3 w-3', layer.id === 'forests' ? 'rounded-sm' : 'rounded-full')} style={{ backgroundColor: layer.color }} />
                <span className="text-xs text-muted-foreground">{layer.label}</span>
              </div>
            ))}
            {activeTab === 'canue' && (
              <div className="w-full space-y-2 text-xs text-muted-foreground md:w-56">
                <div>
                  <div className="mb-1 flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-medium text-foreground">
                      {selectedCanueV2Selection ? getCanueV2VariableLabel(selectedCanueV2Selection) : selectedCanueFile ? getCanueVariableLabel(selectedCanueFile, selectedCanueVariable ?? '') : 'CANUE boundary layer'}
                    </span>
                    {activeCanueBoundaryData.loading && <span className="shrink-0 text-[10px]">Loading</span>}
                  </div>
                  <div
                    className="h-3 w-full rounded-sm border border-border bg-gradient-to-r from-cyan-300 via-yellow-300 to-red-500"
                    aria-hidden="true"
                  />
                  <div className="mt-1 flex items-center justify-between gap-2 text-[10px] tabular-nums">
                    <span>{formatNullableNumber(activeCanueBoundaryData.minValue ?? selectedCanueV2Selection?.min)}</span>
                    <span>{formatNullableNumber(activeCanueBoundaryData.maxValue ?? selectedCanueV2Selection?.max)}</span>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'icbc' && <IcbcLegend icbc={icbc} />}
            {activeTab === 'wars' && <WarsLegend wars={wars} />}
            {activeTab === 'walkability' && <WalkabilityLegend walkability={walkability} />}
            {activeTab === 'water' && <WaterLegend water={water} />}
          </div>
        </div>
      </div>
    </MapSectionLayout>
      </div>
    </div>
  )
}
