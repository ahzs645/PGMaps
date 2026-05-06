import { useEffect, useMemo, useState } from 'react'
import type { ElementType } from 'react'
import { Database, Flame, Satellite, Trees } from 'lucide-react'
import { Map as PgMap, MapControls, MapMarker, MarkerContent } from '@/components/ui/map'
import { MapFillLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { StudyAreaSelector, type StudyAreaLevelOption, type StudyAreaSourceOption } from '@/components/StudyAreaSelector'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useHeatShadeData } from '@/maps/scorebuilder/hooks/useHeatShadeData'

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
type MiscDataTab = 'heatShade' | 'canue'
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
]

const CANUE_BOUNDARY_SOURCE_OPTIONS: Array<StudyAreaSourceOption<CanueBoundarySource>> = [
  {
    value: 'bcHealth',
    label: 'CHSA health boundaries',
    description: 'Community Health Service Areas',
  },
  {
    value: 'census',
    label: 'Census boundaries',
    description: 'PG census tract -> dissemination area',
  },
  {
    value: 'cityPG',
    label: 'School catchments',
    description: 'Elementary and secondary catchments',
  },
]

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

function formatDate(value: string | undefined): string {
  if (!value) return 'Unknown'
  return new Date(value).toLocaleDateString('en-CA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatNullableNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'No value'
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function getCanueVariableLabel(file: CanueFile | null, variable: string): string {
  if (!file) return variable
  if (CANUE_EXACT_VARIABLE_LABELS[variable]) return CANUE_EXACT_VARIABLE_LABELS[variable]

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
  return file.variables[0] ?? null
}

function useJsonManifest<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        setError(null)
        const response = await fetch(path, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)
        const contentType = response.headers.get('content-type') ?? ''
        const text = await response.text()
        if (!contentType.includes('json') && text.trimStart().startsWith('<')) {
          throw new Error(`Expected JSON from ${path}, but received ${contentType || 'unknown content type'}`)
        }
        setData(JSON.parse(text) as T)
        setError(null)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setData(null)
        setError((err as Error).message || `Unable to load ${path}`)
      }
    }

    void load()
    return () => controller.abort()
  }, [path])

  return { data, error }
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
  file: CanueFile | null,
  variable: string | null,
  boundaries: BoundaryFeatureCollection | null,
  boundaryLevel: CanueBoundaryLevel,
  membership: CanuePostalMembership | null,
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
    if (!file?.output || !variable || !boundaries || !membership) {
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
    const activeFile = file
    const activeBoundaries = boundaries
    const activeMembership = membership
    const activeBoundaryLevel = boundaryLevel
    const boundaryConfig = CANUE_BOUNDARY_CONFIG[boundaryLevel]
    const output = file.output
    const activeVariable = variable

    async function load() {
      setResult((current) => ({ ...current, loading: true, error: null }))

      try {
        const text = await fetchGzipText(output, controller.signal)
        const usableBoundaries: BoundaryFeatureCollection = {
          type: 'FeatureCollection',
          features: activeBoundaries.features.filter((feature) => feature.geometry),
        }
        const boundaryIndex = buildBoundaryIndex(usableBoundaries, boundaryConfig)
        const buckets = new Map(boundaryIndex.map((boundary) => [
          boundary.id,
          { boundary, rowCount: 0, sum: 0, count: 0, min: null as number | null, max: null as number | null },
        ]))
        const membershipByPostalCode = new Map(
          activeMembership.records.map((record) => [record.postalcode, record.boundaries[activeBoundaryLevel] ?? '']),
        )
        const lines = text.split(/\r?\n/)
        const headers = splitCsvLine(lines[0] ?? '')
        const postalIndex = headers.indexOf('postalcode')
        const variableIndex = headers.indexOf(activeVariable)
        let matchedRowCount = 0

        if (postalIndex < 0 || variableIndex < 0) {
          throw new Error(`CANUE file is missing postalcode or ${activeVariable}`)
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

          const value = Number(values[variableIndex])
          if (!Number.isFinite(value) || value === -9999) continue
          bucket.sum += value
          bucket.count += 1
          bucket.min = bucket.min == null ? value : Math.min(bucket.min, value)
          bucket.max = bucket.max == null ? value : Math.max(bucket.max, value)
        }

        let minValue: number | null = null
        let maxValue: number | null = null
        let validBoundaryCount = 0

        const features = usableBoundaries.features.map((feature, index) => {
          const boundary = boundaryIndex[index]
          const bucket = buckets.get(boundary.id)
          const value = bucket && bucket.count > 0 ? bucket.sum / bucket.count : null

          return {
            ...feature,
            id: boundary.id,
            properties: {
              ...feature.properties,
              boundaryId: boundary.id,
              boundaryName: boundary.name,
              datasetId: activeFile.datasetId,
              datasetLabel: activeFile.label,
              category: activeFile.category,
              year: activeFile.year,
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
  }, [boundaries, boundaryLevel, file, membership, variable])

  return result
}

export default function MiscDataSection() {
  const [showSidebar, setShowSidebar] = useState(true)
  const [activeTab, setActiveTab] = useState<MiscDataTab>('canue')
  const [activeLayers, setActiveLayers] = useState<MiscLayerId[]>(['trees', 'forests', 'facilities'])
  const [canueBoundarySource, setCanueBoundarySource] = useState<CanueBoundarySource>('bcHealth')
  const [canueBoundaryLevel, setCanueBoundaryLevel] = useState<CanueBoundaryLevel>('chsa')
  const [showCanueBoundaries, setShowCanueBoundaries] = useState(true)
  const [selectedCanueFileKey, setSelectedCanueFileKey] = useState<string | null>(null)
  const [selectedCanueVariable, setSelectedCanueVariable] = useState<string | null>(null)
  const [selectedCanueBoundaryId, setSelectedCanueBoundaryId] = useState<string | null>(null)
  const { trees, forests, facilities, loading, error } = useHeatShadeData(true)
  const heatShadeManifest = useJsonManifest<HeatShadeManifest>('/data/heat-shade/manifest.json')
  const canueManifest = useJsonManifest<CanueManifest>('/data/canue/bc/annual-gzip/manifest.json')
  const canueMembership = useJsonManifest<CanuePostalMembership>('/data/canue/bc/postal-boundary-membership.json')
  const canueBoundaryConfig = CANUE_BOUNDARY_CONFIG[canueBoundaryLevel]
  const canueBoundaries = useJsonManifest<BoundaryFeatureCollection>(canueBoundaryConfig.path)

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
  const canueBoundaryLevelOptions = canueBoundarySource === 'bcHealth'
    ? CANUE_HEALTH_LEVEL_OPTIONS
    : canueBoundarySource === 'cityPG'
      ? CANUE_CITY_LEVEL_OPTIONS
      : CANUE_CENSUS_LEVEL_OPTIONS
  const selectedCanueFile = useMemo(() => {
    if (!canueFiles.length) return null
    if (selectedCanueFileKey) {
      const selected = canueFiles.find((file) => `${file.datasetId}-${file.year}` === selectedCanueFileKey)
      if (selected) return selected
    }
    return canueFiles.find((file) => file.datasetId === 'pm25dale_a') ?? canueFiles[0]
  }, [canueFiles, selectedCanueFileKey])
  const canueBoundaryData = useCanueBoundaryData(
    selectedCanueFile,
    selectedCanueVariable,
    canueBoundaries.data,
    canueBoundaryLevel,
    canueMembership.data,
  )
  const selectedCanueBoundary = useMemo(() => {
    if (!selectedCanueBoundaryId) return null
    return canueBoundaryData.data.features.find((feature) => {
      const featureId = feature.properties?.boundaryId ?? feature.id
      return featureId != null && String(featureId) === selectedCanueBoundaryId
    }) ?? null
  }, [canueBoundaryData.data.features, selectedCanueBoundaryId])
  const canueFillColor = useMemo(() => {
    const variable = selectedCanueVariable ?? ''
    const low = canueBoundaryData.minValue ?? 0
    const high = canueBoundaryData.maxValue != null && canueBoundaryData.maxValue !== low
      ? canueBoundaryData.maxValue
      : low + 1
    const mid = low + ((high - low) / 2)

    return [
      'case',
      ['!', ['has', variable]],
      '#e5e7eb',
      ['==', ['get', variable], null],
      '#e5e7eb',
      [
        'interpolate',
        ['linear'],
        ['to-number', ['get', variable]],
        low,
        '#67e8f9',
        mid,
        '#facc15',
        high,
        '#ef4444',
      ],
    ]
  }, [canueBoundaryData.maxValue, canueBoundaryData.minValue, selectedCanueVariable])
  const heatShadeSources = heatShadeManifest.data?.sources ?? []
  const landsatSource = heatShadeSources.find((source) => source.kind === 'historicalNdviLst')
  const mapCenter = activeTab === 'canue' ? BC_CENTER : PG_CENTER
  const mapZoom = activeTab === 'canue' ? 4.4 : 11

  useEffect(() => {
    if (!selectedCanueFile) return
    const fileKey = `${selectedCanueFile.datasetId}-${selectedCanueFile.year}`
    if (selectedCanueFileKey !== fileKey) setSelectedCanueFileKey(fileKey)
    if (!selectedCanueVariable || !selectedCanueFile.variables.includes(selectedCanueVariable)) {
      setSelectedCanueVariable(getDefaultCanueVariable(selectedCanueFile))
    }
  }, [selectedCanueFile, selectedCanueFileKey, selectedCanueVariable])

  useEffect(() => {
    setSelectedCanueBoundaryId(null)
  }, [canueBoundaryLevel, selectedCanueFileKey, selectedCanueVariable])

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

  const sidebar = (
    <div className="z-10 flex h-full w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur">
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">MISC Data</h1>
      </div>

      <div className="flex-1 overflow-y-auto">
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
        <StudyAreaSelector<CanueBoundarySource, CanueBoundaryLevel>
          source={canueBoundarySource}
          sourceOptions={CANUE_BOUNDARY_SOURCE_OPTIONS}
          level={canueBoundaryLevel}
          levelOptions={canueBoundaryLevelOptions}
          onSourceChange={handleCanueBoundarySourceChange}
          onLevelChange={setCanueBoundaryLevel}
          showPoints={showCanueBoundaries}
          onTogglePoints={() => setShowCanueBoundaries((current) => !current)}
          toggleOnLabel="Hide boundaries"
          toggleOffLabel="Show boundaries"
          levelSelectId="canue-study-area-level"
        />

        <div className="border-b border-border p-4">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-cyan-600" />
            <h2 className="text-sm font-semibold text-foreground">CANUE Boundary Map</h2>
          </div>
          {selectedCanueFile && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-foreground">
                Dataset
                <AppSelect
                  value={`${selectedCanueFile.datasetId}-${selectedCanueFile.year}`}
                  onValueChange={(fileKey) => {
                    const nextFile = canueFiles.find((file) => `${file.datasetId}-${file.year}` === fileKey)
                    setSelectedCanueFileKey(fileKey)
                    setSelectedCanueVariable(nextFile ? getDefaultCanueVariable(nextFile) : null)
                  }}
                  options={canueFiles.map((file) => ({
                    value: `${file.datasetId}-${file.year}`,
                    label: `${file.label} (${file.year})`,
                  }))}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
              <label className="block text-xs font-medium text-foreground">
                Map variable
                <AppSelect
                  value={selectedCanueVariable ?? ''}
                  onValueChange={setSelectedCanueVariable}
                  options={selectedCanueFile.variables.map((variable) => ({
                    value: variable,
                    label: `${getCanueVariableLabel(selectedCanueFile, variable)} (${variable})`,
                  }))}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded border border-border p-2">
                  <div className="text-sm font-bold text-foreground">{canueBoundaryData.validBoundaryCount.toLocaleString()}</div>
                  <div className="text-[10px] text-muted-foreground">with values</div>
                </div>
                <div className="rounded border border-border p-2">
                  <div className="text-sm font-bold text-foreground">
                    {formatNullableNumber(canueBoundaryData.minValue)}-{formatNullableNumber(canueBoundaryData.maxValue)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">sample range</div>
                </div>
              </div>
              {canueBoundaryData.loading && <div className="text-xs text-muted-foreground">Aggregating CANUE records...</div>}
              {canueBoundaryData.error && <div className="text-xs text-red-500">{canueBoundaryData.error}</div>}
              <div className="rounded-md border border-border bg-muted/20 p-2 text-xs leading-5 text-muted-foreground">
                {getCanueVariableLabel(selectedCanueFile, selectedCanueVariable ?? '')} is aggregated in the browser from raw boundary-clipped CANUE records.
              </div>
              {selectedCanueBoundary && selectedCanueVariable && (
                <div className="rounded-md border border-border bg-background p-3 text-xs">
                  <div className="font-semibold text-foreground">
                    {String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary')}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{getCanueVariableLabel(selectedCanueFile, selectedCanueVariable)}</span>
                    <span className="font-semibold text-foreground">
                      {formatNullableNumber(Number(selectedCanueBoundary.properties?.[selectedCanueVariable]))}
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

        <div className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <Flame className="h-4 w-4 text-orange-600" />
            <h2 className="text-sm font-semibold text-foreground">Source Notes</h2>
          </div>
          <div className="space-y-2 text-xs leading-5 text-muted-foreground">
            {activeTab === 'heatShade' && <p>Heat/shade updated {formatDate(heatShadeManifest.data?.generatedAt)}.</p>}
            {activeTab === 'canue' && <p>CANUE raw extracts updated {formatDate(canueManifest.data?.generatedAt)}.</p>}
            {activeTab === 'heatShade' && (heatShadeManifest.data?.caveats ?? []).slice(0, 2).map((caveat) => (
              <p key={caveat}>{caveat}</p>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex shrink-0 items-center justify-start gap-3 border-b border-border bg-background/95 px-3 py-2 backdrop-blur md:px-4">
        <div className="flex shrink-0 rounded-lg border border-border bg-muted/40 p-1">
          {MISC_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors sm:px-3',
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
      <div className="min-h-0 flex-1">
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      sidebar={sidebar}
    >
      <div className="relative h-full">
        <PgMap key={activeTab} center={mapCenter} zoom={mapZoom} styles={MAP_STYLES}>
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

          {activeTab === 'heatShade' && activeLayers.includes('trees') && visibleTrees.map((tree) => (
            <MapMarker key={tree.id} longitude={tree.longitude} latitude={tree.latitude}>
              <MarkerContent>
                <div className="h-2 w-2 rounded-full border border-white bg-green-600 shadow-sm" />
              </MarkerContent>
            </MapMarker>
          ))}

          {activeTab === 'heatShade' && activeLayers.includes('facilities') && visibleFacilities.map((facility) => (
            <MapMarker key={facility.id} longitude={facility.longitude} latitude={facility.latitude}>
              <MarkerContent>
                <div className="h-3 w-3 rounded-full border border-white bg-sky-500 shadow-sm" />
              </MarkerContent>
            </MapMarker>
          ))}

          {activeTab === 'canue' && showCanueBoundaries && canueBoundaryData.data.features.length > 0 && (
            <MapFillLayer
              data={canueBoundaryData.data}
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
        </PgMap>

        <div className="absolute bottom-36 right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
          <h4 className="mb-2 text-xs font-semibold text-foreground">
            {activeTab === 'canue' ? 'CANUE Layer' : 'MISC Layers'}
          </h4>
          <div className="space-y-1">
            {activeTab === 'heatShade' && MISC_LAYERS.filter((layer) => activeLayers.includes(layer.id)).map((layer) => (
              <div key={layer.id} className="flex items-center gap-2">
                <span className={cn('h-3 w-3', layer.id === 'forests' ? 'rounded-sm' : 'rounded-full')} style={{ backgroundColor: layer.color }} />
                <span className="text-xs text-muted-foreground">{layer.label}</span>
              </div>
            ))}
            {activeTab === 'canue' && (
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 rounded-sm bg-gradient-to-r from-cyan-300 via-yellow-300 to-red-500" />
                  <span>{selectedCanueFile?.label ?? 'CANUE boundary layer'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Database className="h-3 w-3" />
                  <span>
                    {showCanueBoundaries
                      ? `${canueBoundaryData.validBoundaryCount.toLocaleString()} ${canueBoundaryConfig.label} boundaries`
                      : 'Boundaries hidden'}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </MapSectionLayout>
      </div>
    </div>
  )
}
