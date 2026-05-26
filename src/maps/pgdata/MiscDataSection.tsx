import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ElementType, ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { BarChart3, CalendarDays, Database, Droplets, Footprints, Info, Layers, PawPrint, RadioTower, Satellite, ShieldAlert, Trees, Waves, X } from 'lucide-react'
import { Map as PgMap, MapControls, MapMarker, MarkerContent } from '@/components/ui/map'
import { MapFillLayer, MapPmtilesFillLayer } from '@/components/ui/map-layers'
import { MAP_STYLES, PG_CENTER } from '@/components/ui/map-styles'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { DatasetInfo } from '@/components/DatasetInfo'
import { StudyAreaSelector, type StudyAreaLevelOption, type StudyAreaSourceOption } from '@/components/StudyAreaSelector'
import { BOUNDARY_SOURCE_OPTIONS as ALL_BOUNDARY_SOURCE_OPTIONS } from '@/lib/studyArea'
import { AppSelect } from '@/components/ui/select'
import { LegendItem, MapGradientLegendItem, MapLegendPanel } from '@/components/ui/map-panels'
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
import { FloodLayer, FloodLayerControls, FloodLegend, FloodSidebar, FloodSourceNotes, useFloodData } from './flood'
import { Timeline } from '@/components/ui/timeline'
import { DroughtSection } from '@/maps/drought'
import {
  CANUE_V2_CATALOG_URL,
  CANUE_V2_ENABLED,
  listCanueV2Selections,
  type CanueV2Catalog,
  type CanueVariableSelection,
} from './canueV2'
import { useCanueV2AggregateData, useCanueV2AggregatePrefetch, type CanueAggregateRow } from './canueV2Aggregates'
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

interface NetworkAvailabilityDataset {
  id: string
  title: string
  source: string
  category: string
  geometry: string
  formats: string[]
  url: string
  apiUrl?: string
  schemaUrl?: string
  notes?: string
  http?: {
    ok?: boolean
    status?: number | null
    contentType?: string | null
    contentLength?: number | null
    lastModified?: string | null
    etag?: string | null
    error?: string
  }
}

interface NetworkAvailabilityCarrierFinding {
  provider: string
  vectorStatus: string
  recommendedUse: string
  endpoints: string[]
}

interface NetworkAvailabilityManifest {
  generatedAt: string
  title: string
  description: string
  recommendedUse?: string
  datasets: NetworkAvailabilityDataset[]
  carrierFindings: NetworkAvailabilityCarrierFinding[]
}

type NetworkAvailabilityFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>

type BoundaryFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>

type MiscLayerId = 'trees' | 'forests' | 'facilities'
type MiscDataTab = 'heatShade' | 'canue' | 'network' | 'icbc' | 'wars' | 'walkability' | 'water' | 'flood' | 'drought'
type CanueYearMode = 'single' | 'month' | 'all' | 'range'
type CanueV2Cadence = 'annual' | 'monthly'
type CanueBoundarySource = 'bcHealth' | 'regionalDistrict' | 'census' | 'cityPG' | 'watershed' | 'nrAdmin'
type CanueBoundaryLevel =
  | 'healthAuthority'
  | 'hsda'
  | 'lha'
  | 'chsa'
  | 'regionalDistrict'
  | 'cd'
  | 'csd'
  | 'ct'
  | 'da'
  | 'db'
  | 'elementarySchoolCatchment'
  | 'secondarySchoolCatchment'
  | 'majorWatershed'
  | 'watershedGroup'
  | 'assessmentWatershed'
  | 'nrArea'
  | 'nrRegion'
  | 'nrDistrict'

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

interface CanueV2DatasetMetadataEntry {
  label?: string
  metadata?: {
    portalNames?: string[]
    downloadNames?: string[]
    shortCodes?: string[]
    yearCoverage?: string[]
    samplingFrequency?: string[]
    descriptions?: string[]
  }
}

interface CanueV2MetadataLookup {
  datasets?: Record<string, CanueV2DatasetMetadataEntry>
}

const MISC_LAYERS: Array<{ id: MiscLayerId; label: string; color: string }> = [
  { id: 'trees', label: 'Tree canopy proxy', color: '#16a34a' },
  { id: 'forests', label: 'Forests', color: '#15803d' },
  { id: 'facilities', label: 'Cooling access proxy', color: '#0ea5e9' },
]

const NRCAN_WIRELESS_GEOJSON_URL =
  'https://maps-cartes.services.geo.ca/server_serveur/rest/services/NRCan/Wireless_Data_Network_Reseau_donnees_sans_fil/MapServer/0/query?where=1%3D1&outFields=OBJECTID%2CYear%2CSpeed&returnGeometry=true&outSR=4326&geometryPrecision=5&maxAllowableOffset=0.01&f=geojson'

const MISC_TABS: Array<{ id: MiscDataTab; label: string; icon: ElementType }> = [
  { id: 'heatShade', label: 'Heat & Shade', icon: Trees },
  { id: 'canue', label: 'CANUE', icon: Database },
  { id: 'network', label: 'Network', icon: RadioTower },
  { id: 'icbc', label: 'ICBC', icon: ShieldAlert },
  { id: 'wars', label: 'WARS', icon: PawPrint },
  { id: 'walkability', label: 'Walkability', icon: Footprints },
  { id: 'water', label: 'Water', icon: Droplets },
  { id: 'flood', label: 'Flood', icon: Waves },
  { id: 'drought', label: 'Drought', icon: Droplets },
]

function parseMiscDataTab(tab: string | null): MiscDataTab {
  return tab === 'heatShade' || tab === 'network' || tab === 'icbc' || tab === 'wars' || tab === 'walkability' || tab === 'water' || tab === 'flood' || tab === 'drought' ? tab : 'canue'
}

const CANUE_SUPPORTED_SOURCES = new Set<string>(['bcHealth', 'regionalDistrict', 'census', 'cityPG', 'watershed', 'nrAdmin'])

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

const CANUE_REGIONAL_DISTRICT_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'regionalDistrict', label: 'Regional District' },
]

const CANUE_WATERSHED_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'majorWatershed', label: 'Major Watershed' },
  { value: 'watershedGroup', label: 'Watershed Group' },
  { value: 'assessmentWatershed', label: 'Assessment Watershed' },
]

const CANUE_NR_ADMIN_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'nrArea', label: 'NR Area' },
  { value: 'nrRegion', label: 'NR Region' },
  { value: 'nrDistrict', label: 'NR District' },
]

const CANUE_BOUNDARY_LEVEL_TO_SOURCE: Record<CanueBoundaryLevel, CanueBoundarySource> = {
  healthAuthority: 'bcHealth',
  hsda: 'bcHealth',
  lha: 'bcHealth',
  chsa: 'bcHealth',
  regionalDistrict: 'regionalDistrict',
  cd: 'census',
  csd: 'census',
  ct: 'census',
  da: 'census',
  db: 'census',
  elementarySchoolCatchment: 'cityPG',
  secondarySchoolCatchment: 'cityPG',
  majorWatershed: 'watershed',
  watershedGroup: 'watershed',
  assessmentWatershed: 'watershed',
  nrArea: 'nrAdmin',
  nrRegion: 'nrAdmin',
  nrDistrict: 'nrAdmin',
}

function parseCanueBoundaryLevel(value: string | null): CanueBoundaryLevel {
  return value && value in CANUE_BOUNDARY_LEVEL_TO_SOURCE ? value as CanueBoundaryLevel : 'chsa'
}

function getDefaultCanueBoundaryLevel(source: CanueBoundarySource): CanueBoundaryLevel {
  if (source === 'bcHealth') return 'chsa'
  if (source === 'regionalDistrict') return 'regionalDistrict'
  if (source === 'cityPG') return 'elementarySchoolCatchment'
  if (source === 'watershed') return 'watershedGroup'
  if (source === 'nrAdmin') return 'nrArea'
  return 'da'
}

function formatFileSize(bytes?: number | null): string {
  if (!Number.isFinite(bytes ?? NaN)) return 'Unknown size'
  const value = bytes ?? 0
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`
  if (value >= 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${value} B`
}

function formatVectorStatus(status: string): string {
  return status
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function useNetworkAvailabilityLayer(enabled: boolean) {
  const [data, setData] = useState<NetworkAvailabilityFeatureCollection | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()

    async function load() {
      try {
        setError(null)
        const response = await fetch(NRCAN_WIRELESS_GEOJSON_URL, { signal: controller.signal, cache: 'no-store' })
        if (!response.ok) throw new Error(`Failed to fetch NRCan wireless layer: ${response.status}`)
        const geojson = await response.json() as NetworkAvailabilityFeatureCollection
        setData({
          ...geojson,
          features: geojson.features.map((feature, index) => ({
            ...feature,
            properties: {
              ...(feature.properties ?? {}),
              id: feature.properties?.OBJECTID ?? index,
            },
          })),
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load network availability geometry')
      }
    }

    void load()
    return () => controller.abort()
  }, [enabled])

  return { data, error }
}

function NetworkAvailabilitySidebar({ manifest }: { manifest: ReturnType<typeof useJsonManifest<NetworkAvailabilityManifest>> }) {
  const mapDatasets = manifest.data?.datasets.filter((dataset) => dataset.geometry !== 'table') ?? []
  const carrierFindings = manifest.data?.carrierFindings ?? []

  return (
    <div className="space-y-4 p-4">
      {!manifest.data && !manifest.error && <div className="text-sm text-muted-foreground">Loading network availability manifest...</div>}
      {manifest.error && <div className="text-sm text-red-500">{manifest.error}</div>}
      {manifest.data?.recommendedUse && (
        <section className="rounded border border-border bg-muted/30 p-3">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Recommended Source Strategy</h2>
          <p className="text-xs leading-relaxed text-muted-foreground">{manifest.data.recommendedUse}</p>
        </section>
      )}
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Map Availability Sources</h2>
        <div className="space-y-2">
          {mapDatasets.map((dataset) => (
            <article key={dataset.id} className="rounded border border-border bg-card p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{dataset.title}</div>
                  <div className="text-xs text-muted-foreground">{dataset.source} | {dataset.geometry} | {dataset.formats.join(', ')}</div>
                </div>
                <div className="shrink-0 text-right text-xs text-muted-foreground">
                  <div>{formatFileSize(dataset.http?.contentLength)}</div>
                  <div>{dataset.http?.lastModified ? formatDate(dataset.http.lastModified) : 'No date'}</div>
                </div>
              </div>
              {dataset.notes && <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{dataset.notes}</p>}
              <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                <a className="font-medium text-primary hover:underline" href={dataset.url} target="_blank" rel="noreferrer">Download</a>
                {dataset.apiUrl && <a className="font-medium text-primary hover:underline" href={dataset.apiUrl} target="_blank" rel="noreferrer">API</a>}
                {dataset.schemaUrl && <a className="font-medium text-primary hover:underline" href={dataset.schemaUrl} target="_blank" rel="noreferrer">Schema</a>}
              </div>
            </article>
          ))}
        </div>
      </section>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-foreground">Carrier API Findings</h2>
        <div className="space-y-2">
          {carrierFindings.map((finding) => (
            <article key={finding.provider} className="rounded border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium text-foreground">{finding.provider}</div>
                <div className="text-[11px] font-medium text-muted-foreground">{formatVectorStatus(finding.vectorStatus)}</div>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{finding.recommendedUse}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}

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
  regionalDistrict: {
    path: '/data/boundaries/BC/regional_districts.geojson',
    idField: 'LGL_ADMIN_AREA_ID',
    nameField: 'ADMIN_AREA_NAME',
    label: 'Regional District',
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
  majorWatershed: {
    path: '/data/boundaries/BCFWA/major_watersheds_province_simplified.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
    label: 'Major Watershed',
  },
  watershedGroup: {
    path: '/data/boundaries/BCFWA/watershed_groups_province_simplified.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
    label: 'Watershed Group',
  },
  assessmentWatershed: {
    path: '/data/boundaries/BCFWA/assessment_watersheds.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
    label: 'Assessment Watershed',
  },
  nrArea: {
    path: '/data/boundaries/BCNR/nr_areas.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
    label: 'Natural Resource Area',
  },
  nrRegion: {
    path: '/data/boundaries/BCNR/nr_regions.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
    label: 'Natural Resource Region',
  },
  nrDistrict: {
    path: '/data/boundaries/BCNR/nr_districts.geojson',
    idField: 'boundaryCode',
    nameField: 'boundaryName',
    label: 'Natural Resource District',
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
  no2lur_a: {
    '01': 'Original annual NO2 concentration, circa 2006',
    '02': 'Annual average NO2 concentration for selected year',
    '03': 'Census division identifier',
    '05': 'Distance to census division boundary',
  },
  aqaix_ava: {
    '01': 'Index 1 - combustion mixture',
    '02': 'Index 2 - ozone/ammonia mixture',
    '03': 'Index 3 - ammonia/agriculture mixture',
    '04': 'Carbon monoxide (CO)',
    '05': 'Formaldehyde column (HCHO)',
    '06': 'Ammonia (NH3)',
    '07': 'Nitrogen dioxide (NO2)',
    '08': 'Ozone (O3)',
    '09': 'Fine particulate matter (PM2.5)',
    '10': 'Sulfur dioxide (SO2)',
  },
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
  aqsmk_avc: {
    '01': 'Smoke PM2.5 mean',
    '02': 'Smoke PM2.5 median',
    '03': 'Smoke PM2.5 minimum',
    '04': 'Smoke PM2.5 maximum',
    '05': 'Smoke PM2.5 standard deviation',
  },
  aqsmk_ava: {
    '01': 'Annual smoke PM2.5',
    '02': 'Autumn smoke PM2.5',
    '03': 'Spring smoke PM2.5',
    '04': 'Summer smoke PM2.5',
    '05': 'Winter smoke PM2.5',
  },
  o3chg_a: {
    '01': 'Annual average O3',
    '02': 'Warm-season average O3',
    '03': 'Annual highest rolling 8-hour O3 average',
    '04': 'Warm-season highest rolling 8-hour O3 average',
  },
  dtw_a: {
    '02': 'Distance to reservoir, pond, or lake',
    '03': 'Distance to watercourse, tidal river, or side channel',
    '04': 'Distance to canal',
    '05': 'Distance to other water bodies',
  },
  wbnrc_a: {
    '01': 'Annual minimum of monthly lowest daily maximum temperature',
    '02': 'Annual maximum of monthly highest daily minimum temperature',
    '03': 'Annual total precipitation',
    '04': 'Annual total rainfall',
    '05': 'Annual total snowfall',
    '06': 'Snow-to-rain ratio',
    '07': 'Annual total snow melt',
    '08': 'Maximum monthly snow-pack thickness',
    '09': 'Days with snowfall',
    '10': 'Days with snow on the ground',
    '11': 'Days with precipitation',
    '12': 'Potential evapotranspiration / water demand',
    '13': 'Actual evapotranspiration',
    '14': 'Water surplus',
    '15': 'Water deficit',
    '16': 'Days with water surplus',
    '17': 'Days with water deficit',
    '18': 'Sum of monthly average soil moisture',
    '19': 'Average monthly minimum soil moisture',
    '20': 'Minimum monthly soil moisture',
    '21': 'Wetness/dryness index',
  },
  wthnrc_a: {
    '01': 'Climate metric 01 - temperature',
    '02': 'Climate metric 02 - temperature',
    '03': 'Climate metric 03 - temperature',
    '04': 'Climate metric 04 - precipitation',
    '05': 'Climate metric 05 - precipitation',
    '06': 'Climate metric 06 - precipitation',
    '07': 'Climate metric 07 - temperature extreme',
    '08': 'Climate metric 08 - temperature extreme',
    '09': 'Climate metric 09 - heat days',
    '10': 'Climate metric 10 - cold days',
    '11': 'Climate metric 11 - degree days',
    '12': 'Climate metric 12 - degree days',
    '13': 'Climate metric 13 - degree days',
    '14': 'Climate metric 14 - seasonal temperature',
    '15': 'Climate metric 15 - seasonal temperature',
    '16': 'Climate metric 16 - wet days',
    '17': 'Climate metric 17 - heavy precipitation',
    '18': 'Climate metric 18 - snowfall days',
    '19': 'Climate metric 19 - rainfall days',
    '20': 'Climate metric 20 - dry spell',
    '21': 'Climate metric 21 - wet spell',
    '22': 'Climate metric 22 - spring temperature',
    '23': 'Climate metric 23 - summer temperature',
    '24': 'Climate metric 24 - autumn temperature',
    '25': 'Climate metric 25 - winter temperature',
    '26': 'Climate metric 26 - spring precipitation',
    '27': 'Climate metric 27 - summer precipitation',
    '28': 'Climate metric 28 - autumn precipitation',
    '29': 'Climate metric 29 - winter precipitation',
    '30': 'Climate metric 30 - heat index',
    '31': 'Climate metric 31 - cold index',
    '32': 'Climate metric 32 - temperature variability',
    '33': 'Climate metric 33 - precipitation variability',
    '34': 'Climate metric 34 - snow/rain',
    '35': 'Climate metric 35 - climate summary',
  },
  wtlst_ava: {
    '01': 'Land surface temperature at postal code',
    '02': '3-year annual max of 100m means',
    '03': '3-year annual max of 250m means',
    '04': '3-year annual max of 500m means',
    '05': '3-year annual max of 750m means',
    '06': '3-year annual max of 1km means',
  },
  wtfsi_ava: {
    '01': 'Flood susceptibility index',
    '02': 'Flood susceptibility lower estimate',
    '03': 'Flood susceptibility median estimate',
    '04': 'Flood susceptibility upper estimate',
    '05': 'Flood susceptibility class',
  },
  grlan_amn: {
    '01': 'Annual mean NDVI at postal code',
    '02': 'Annual mean NDVI within 100m',
    '03': 'Annual mean NDVI within 250m',
    '04': 'Annual mean NDVI within 500m',
    '05': 'Annual mean NDVI within 1km',
    '06': 'Annual maximum mean NDVI within 100m',
    '07': 'Annual maximum mean NDVI within 250m',
    '08': 'Annual maximum mean NDVI within 500m',
    '09': 'Annual maximum mean NDVI within 1km',
  },
  grlan_gmn: {
    '10': 'Growing-season mean NDVI at postal code',
    '11': 'Growing-season mean NDVI within 100m',
    '12': 'Growing-season mean NDVI within 250m',
    '13': 'Growing-season mean NDVI within 500m',
    '14': 'Growing-season mean NDVI within 1km',
    '15': 'Growing-season maximum mean NDVI within 100m',
    '16': 'Growing-season maximum mean NDVI within 250m',
    '17': 'Growing-season maximum mean NDVI within 500m',
    '18': 'Growing-season maximum mean NDVI within 1km',
  },
  grlan_gp: {
    '19': 'Greenest-pixel NDVI at postal code',
    '20': 'Mean greenest-pixel NDVI within 100m',
    '21': 'Mean greenest-pixel NDVI within 250m',
    '22': 'Mean greenest-pixel NDVI within 500m',
    '23': 'Mean greenest-pixel NDVI within 1km',
    '24': 'Maximum greenest-pixel NDVI within 100m',
    '25': 'Maximum greenest-pixel NDVI within 250m',
    '26': 'Maximum greenest-pixel NDVI within 500m',
    '27': 'Maximum greenest-pixel NDVI within 1km',
  },
  gravh_amn: {
    '01': 'AVHRR NDVI at postal code',
    '02': 'AVHRR NDVI within 100m',
    '03': 'AVHRR NDVI within 250m',
  },
  grmod_amnb: {
    '01': 'Modeled annual mean greenness at postal code',
    '02': 'Modeled annual mean greenness within 100m',
    '03': 'Modeled annual mean greenness within 250m',
    '04': 'Modeled annual mean greenness within 500m',
    '05': 'Modeled annual mean greenness within 1km',
  },
  grmod_amxb: {
    '06': 'Modeled annual maximum greenness at postal code',
    '07': 'Modeled annual maximum greenness within 100m',
    '08': 'Modeled annual maximum greenness within 250m',
    '09': 'Modeled annual maximum greenness within 500m',
    '10': 'Modeled annual maximum greenness within 1km',
  },
  grmod_gmnb: {
    '11': 'Modeled growing-season mean greenness at postal code',
    '12': 'Modeled growing-season mean greenness within 100m',
    '13': 'Modeled growing-season mean greenness within 250m',
    '14': 'Modeled growing-season mean greenness within 500m',
    '15': 'Modeled growing-season mean greenness within 1km',
  },
  grmod_gmxb: {
    '16': 'Modeled growing-season maximum greenness at postal code',
    '17': 'Modeled growing-season maximum greenness within 100m',
    '18': 'Modeled growing-season maximum greenness within 250m',
    '19': 'Modeled growing-season maximum greenness within 500m',
    '20': 'Modeled growing-season maximum greenness within 1km',
  },
  grtcc_ava: {
    '01': 'Tree canopy cover',
    '02': 'Tree canopy cover within 100m',
    '03': 'Tree canopy cover within 250m',
    '04': 'Tree canopy cover within 500m',
    '05': 'Tree canopy cover within 1km',
  },
  lcz_a: {
    '02': 'Dense urban percentage within 1km',
    '03': 'Open urban percentage within 1km',
    '04': 'Residential percentage within 1km',
    '05': 'Industrial/commercial/paved percentage within 1km',
    '06': 'Natural percentage within 1km',
    '07': 'Water percentage within 1km',
    '08': 'Unknown land-cover percentage within 1km',
  },
  cmg_a: {
    '04': 'Dissemination/enumeration area identifier',
    '05': 'Distance to nearest dissemination area',
    '06': 'Instability quintile',
    '07': 'Deprivation quintile',
    '08': 'Dependency quintile',
    '09': 'Ethnic concentration quintile',
    '10': 'Instability factor score',
    '11': 'Deprivation factor score',
    '12': 'Dependency factor score',
    '13': 'Ethnic concentration factor score',
  },
  indmsd_a: {
    '01': 'Dissemination area identifier',
    '02': 'Dissemination area population',
    '03': 'Census subdivision',
    '04': 'Province',
    '08': 'Material deprivation factor score',
    '09': 'Social deprivation factor score',
    '10': 'Material deprivation quintile within Canada',
    '11': 'Social deprivation quintile within Canada',
    '12': 'Material deprivation percentile within Canada',
    '13': 'Social deprivation percentile within Canada',
    '14': 'Material deprivation quintile within region',
    '15': 'Social deprivation quintile within region',
    '16': 'Material deprivation quintile within zone',
    '17': 'Social deprivation quintile within zone',
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
const CANUE_ANNUAL_YEAR_PATTERN = /^(.*?)(\d{2})(_\d+)$/

const CANUE_DATASET_SUFFIX_LABELS: Record<string, Record<string, string>> = {
  wtutv: {
    '01': 'Mean daily Vitamin D dose at sea level',
    '02': 'Mean daily Vitamin D dose at altitude',
    '03': 'Mean noon Vitamin D index at sea level',
    '04': 'Mean noon Vitamin D index at altitude',
    '05': '95th percentile noon Vitamin D index at sea level',
    '06': '95th percentile noon Vitamin D index at altitude',
  },
  wtwbm: {
    '01': 'Average daily maximum temperature',
    '02': 'Highest daily maximum temperature',
    '03': 'Lowest daily maximum temperature',
    '04': 'Average daily minimum temperature',
    '05': 'Highest daily minimum temperature',
    '06': 'Lowest daily minimum temperature',
    '07': 'Monthly mean temperature',
    '08': 'Monthly total precipitation',
    '09': 'Monthly total rainfall',
    '10': 'Monthly total snowfall',
    '11': 'Days with precipitation',
    '12': 'Days with snowfall',
    '13': 'Days with snow on the ground',
    '14': 'Average snow-pack thickness',
    '15': 'Monthly total snow melt',
    '16': 'Potential evapotranspiration / water demand',
    '17': 'Actual evapotranspiration',
    '18': 'Water surplus',
    '19': 'Days with water surplus',
    '20': 'Water deficit',
    '21': 'Days with water deficit',
    '22': 'Average soil moisture',
    '23': 'Minimum soil moisture',
    '24': 'Wetness/dryness index',
  },
}

const CANUE_V2_DATASET_LABELS: Record<string, string> = {
  aqaix_ava: 'Annual air quality health index',
  aqfpm_01: 'Monthly PM2.5',
  aqfpm_avf: 'Annual PM2.5 v6',
  aqno2_ra: 'Monthly NO2 land-use regression',
  aqozn_8h: 'Monthly O3 8-hour',
  aqozn_mn: 'Monthly O3 mean',
  aqsmk_01: 'Monthly smoke PM2.5',
  aqsmk_ava: 'Annual smoke PM2.5',
  aqsmk_avb: 'Annual smoke PM2.5 v2',
  aqsmk_avc: 'Annual smoke PM2.5 v3',
  no2lur_a: 'Annual NO2 land-use regression',
  o3chg_a: 'Annual O3 concentration',
  pm25dal_a: 'Annual PM2.5 DAL',
  pm25dalb_a: 'Annual PM2.5 DAL v2',
  pm25dalc_a: 'Annual PM2.5 DAL v3',
  pm25dald_a: 'Annual PM2.5 DAL v4',
  pm25dale_a: 'Annual PM2.5 DAL v5',
  so2omi_a: 'Annual SO2 OMI',
  dtw_a: 'Distance to water',
  wthnrc_a: 'Climate metrics',
  wtutv_01: 'Ultraviolet',
  wtutv_02: 'Ultraviolet',
  wtutv_03: 'Ultraviolet',
  wtutv_04: 'Ultraviolet',
  wtutv_05: 'Ultraviolet',
  wtutv_06: 'Ultraviolet',
  wbnrc_a: 'Annual water balance metrics',
  dtr_a: 'Distance to roads',
  wtlst_ava: 'Land surface temperature',
  wtfsi_ava: 'Flood susceptibility index',
  wtwbm_01: 'Monthly water balance metrics',
  wtwbm_02: 'Monthly water balance metrics',
  wtwbm_03: 'Monthly water balance metrics',
  wtwbm_04: 'Monthly water balance metrics',
  wtwbm_05: 'Monthly water balance metrics',
  wtwbm_06: 'Monthly water balance metrics',
  wtwbm_07: 'Monthly water balance metrics',
  wtwbm_08: 'Monthly water balance metrics',
  wtwbm_09: 'Monthly water balance metrics',
  wtwbm_10: 'Monthly water balance metrics',
  wtwbm_11: 'Monthly water balance metrics',
  wtwbm_12: 'Monthly water balance metrics',
  wtwbm_14: 'Monthly water balance metrics',
  wtwbm_15: 'Monthly water balance metrics',
  wtwbm_16: 'Monthly water balance metrics',
  wtwbm_17: 'Monthly water balance metrics',
  wtwbm_18: 'Monthly water balance metrics',
  wtwbm_19: 'Monthly water balance metrics',
  wtwbm_20: 'Monthly water balance metrics',
  wtwbm_21: 'Monthly water balance metrics',
  wtwbm_22: 'Monthly water balance metrics',
  wtwbm_23: 'Monthly water balance metrics',
  wtwbm_24: 'Monthly water balance metrics',
  grlan_amn: 'Land greenness - annual mean NDVI',
  grlan_gmn: 'Land greenness - growing-season mean NDVI',
  grlan_gp: 'Land greenness - greenest-pixel NDVI',
  gravh_amn: 'AVHRR NDVI',
  grmod_amnb: 'Modeled greenness - annual mean',
  grmod_amxb: 'Modeled greenness - annual maximum',
  grmod_gmnb: 'Modeled greenness - growing-season mean',
  grmod_gmxb: 'Modeled greenness - growing-season maximum',
  grtcc_ava: 'Tree canopy cover',
  lcz_a: 'Local climate zone',
  cmg_a: 'Canadian marginalization index',
  indmsd_a: 'Material and social deprivation',
  ale_a: 'Active living environment',
  nae_a: 'Employment accessibility',
  nhnse_ava: 'Neighborhood socioeconomic status',
  nhspw_ava: 'Urban sprawl',
  nhdwl_ava: 'Dwelling density',
  nhgrd_ava: 'Green roads',
  nhfed_ava: 'Food environment density',
  nhbld_ava: 'Building density',
  nhfac_ava: 'Facility richness and density',
  nhpmd_ann: 'Proximity to amenities',
  nhscn_ava: 'Street connectivity',
  nhtsp_ava: 'Transit stop access',
  nhacs_ava: 'Spatial accessibility measures',
  nhbic_ava: 'Bikeability',
  nhcmd_ann: 'Complete communities',
  nhhpp_ava: 'Healthy places priority',
  nhnse_avb: 'Neighborhood socioeconomic status v2',
  nhply_ann: 'Playability',
  lgtnlt_a: 'Night-time light brightness',
}

const CANUE_V2_PREFERRED_MEASURE_KEYS = [
  'aqfpm_01__pm25',
  'aqsmk_01__aqsmk_01',
  'pm25dale_a__pm25dal_01',
]

const CANUE_TIMELINE_WINDOW_OPTIONS = [
  { value: 1, label: '1' },
  { value: 3, label: '3' },
  { value: 5, label: '5' },
  { value: -1, label: 'Cumul.' },
]

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

function getCanueDatasetSuffixLabel(dataset: string): string | null {
  const match = dataset.match(/^([a-z]+)_(\d+)$/i)
  if (!match) return null
  return CANUE_DATASET_SUFFIX_LABELS[match[1].toLowerCase()]?.[match[2]] ?? null
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
  const datasetSuffixLabel = getCanueDatasetSuffixLabel(selection.dataset)
  if (datasetSuffixLabel) return datasetSuffixLabel
  if (variable === 'pm25') return 'PM2.5'
  if (variable === 'aqsmk_01') return 'Smoke PM2.5'
  if (variable === 'aqsmk_02') return 'Smoke PM2.5 median'
  if (variable === 'aqsmk_03') return 'Smoke PM2.5 minimum'
  if (variable === 'aqsmk_04') return 'Smoke PM2.5 maximum'
  if (variable === 'aqsmk_05') return 'Smoke PM2.5 standard deviation'
  if (variable === 'no2_lur') return 'NO2 land-use regression'
  if (variable === 'o3_8h') return 'O3 8-hour'
  if (variable === 'o3_mn') return 'O3 mean'
  if (variable.startsWith('pm25dal') && suffix === '01') return 'Annual mean PM2.5'
  if (variable.startsWith('aqfpm_avf') && suffix === '01') return 'Annual mean PM2.5'
  if (variable.startsWith('so2omi') && suffix === '01') return 'SO2 OMI'
  return variable
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function resolveCanueV2AssetUrl(path: string | null | undefined): string | null {
  if (!path) return null
  try {
    return new URL(path, CANUE_V2_CATALOG_URL).href
  } catch {
    return null
  }
}

function cleanCanueV2DatasetName(name: string): string {
  return name
    .replace(/\s+v\d+\)/gi, ')')
    .replace(/\s+v\d+\b/gi, '')
    .replace(/\bPM2\.5\b/g, 'PM2.5')
    .replace(/\s+/g, ' ')
    .trim()
}

function humanizeCanueDatasetCode(dataset: string): string {
  return dataset
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function firstMetadataValue(values: string[] | undefined): string | null {
  return values?.find((value) => value.trim())?.trim() ?? null
}

function getCanueV2DatasetLabel(dataset: string, metadataLookup: CanueV2MetadataLookup | null | undefined): string {
  if (CANUE_V2_DATASET_LABELS[dataset]) return CANUE_V2_DATASET_LABELS[dataset]
  const metadata = metadataLookup?.datasets?.[dataset]
  const label = firstMetadataValue(metadata?.metadata?.portalNames)
    ?? firstMetadataValue(metadata?.metadata?.downloadNames)
    ?? metadata?.label
    ?? humanizeCanueDatasetCode(dataset)
  return cleanCanueV2DatasetName(label)
}

function getCanueV2DatasetTitle(selection: CanueVariableSelection, metadataLookup: CanueV2MetadataLookup | null | undefined): string {
  const metadata = metadataLookup?.datasets?.[selection.dataset]?.metadata
  const parts = [
    `CANUE code: ${selection.dataset}`,
    firstMetadataValue(metadata?.shortCodes) ? `Source code: ${firstMetadataValue(metadata?.shortCodes)}` : null,
    firstMetadataValue(metadata?.samplingFrequency) ? `Frequency: ${firstMetadataValue(metadata?.samplingFrequency)}` : null,
    firstMetadataValue(metadata?.yearCoverage) ? `Coverage: ${firstMetadataValue(metadata?.yearCoverage)}` : null,
    `Grid property: ${selection.property}`,
  ]
  return parts.filter(Boolean).join(' | ')
}

function getCanueV2DatasetHelp(selection: CanueVariableSelection, metadataLookup: CanueV2MetadataLookup | null | undefined): string {
  const metadata = metadataLookup?.datasets?.[selection.dataset]?.metadata
  const description = firstMetadataValue(metadata?.descriptions)
  if (selection.dataset.startsWith('pm25dal') || selection.dataset === 'aqfpm_avf') {
    return 'PM2.5 DAL is the van Donkelaar/Dalhousie satellite-derived PM2.5 product indexed by CANUE. It combines satellite aerosol optical depth, GEOS-Chem chemical transport modelling, and ground-monitor calibration. The v2-v5 choices are successive product releases with different source years and method updates.'
  }
  if (selection.dataset === 'aqfpm_01') {
    return 'Monthly PM2.5 estimates from the same satellite/model/ground-monitor family, provided as month-specific values instead of annual averages.'
  }
  if (selection.dataset === 'no2lur_a' || selection.dataset === 'aqno2_ra') {
    return 'NO2 land-use regression estimates nitrogen dioxide using monitoring data plus land-use, traffic, satellite, industrial land-use, and weather predictors.'
  }
  if (selection.dataset === 'aqaix_ava') {
    return 'Air quality health index variables include three combined pollution principal-component indices plus individual pollutants such as CO, HCHO, NH3, NO2, O3, PM2.5, and SO2.'
  }
  if (selection.dataset.startsWith('wtutv')) {
    return 'Ultraviolet variables are long-term monthly UV/Vitamin-D exposure estimates. The metric number chooses dose/index, sea-level/altitude adjustment, and mean versus 95th percentile.'
  }
  if (selection.dataset === 'wbnrc_a' || selection.dataset.startsWith('wtwbm')) {
    return 'Water-balance variables describe precipitation, rainfall, snowfall, snowpack, evapotranspiration, soil moisture, surplus, deficit, and wetness/dryness.'
  }
  if (selection.dataset.startsWith('grlan') || selection.dataset.startsWith('grmod') || selection.dataset === 'gravh_amn' || selection.dataset === 'grtcc_ava') {
    return 'Greenness variables differ by vegetation source, season, summary statistic, and buffer distance around the postal/grid location.'
  }
  return description
    ? description.replace(/\s+/g, ' ').trim()
    : getCanueV2DatasetTitle(selection, metadataLookup)
}

function getCanueV2GraphVariableLabel(selection: CanueVariableSelection, metadataLookup: CanueV2MetadataLookup | null | undefined): string {
  const datasetLabel = getCanueV2DatasetLabel(selection.dataset, metadataLookup)
  const variableLabel = getCanueV2VariableLabel(selection)
  const baseLabel = normalizedCanueLabelToken(datasetLabel).includes(normalizedCanueLabelToken(variableLabel))
    ? datasetLabel
    : `${datasetLabel} - ${variableLabel}`
  const monthKey = getCanueV2MonthKey(selection.variable)
  const monthLabel = monthKey ? CANUE_MONTH_BY_KEY.get(monthKey)?.label ?? monthKey.toUpperCase() : null
  return monthLabel ? `${baseLabel} - ${monthLabel}` : baseLabel
}

function normalizedCanueLabelToken(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function formatCanueDisplayLabel(label: string): string {
  return label
}

function renderCanueDisplayLabel(label: string): ReactNode {
  return label.split(/\b(PM2\.5|NO2|SO2|CO2|O3|NH3|m3|cm2)\b/gi).map((part, index) => {
    const normalized = part.toLowerCase()
    if (normalized === 'pm2.5') return <span key={index}>PM<sub>2.5</sub></span>
    if (normalized === 'no2') return <span key={index}>NO<sub>2</sub></span>
    if (normalized === 'so2') return <span key={index}>SO<sub>2</sub></span>
    if (normalized === 'co2') return <span key={index}>CO<sub>2</sub></span>
    if (normalized === 'o3') return <span key={index}>O<sub>3</sub></span>
    if (normalized === 'nh3') return <span key={index}>NH<sub>3</sub></span>
    if (normalized === 'm3') return <span key={index}>m<sup>3</sup></span>
    if (normalized === 'cm2') return <span key={index}>cm<sup>2</sup></span>
    return part
  })
}

function CanueHelpIcon({ label, help }: { label: string; help: string | null | undefined }) {
  if (!help) return null
  return (
    <span
      className="inline-flex h-4 w-4 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
      title={help}
      aria-label={`${label} help: ${help}`}
    >
      <Info className="h-3.5 w-3.5" />
    </span>
  )
}

function getCanueV2MonthKey(variable: string): string | null {
  return variable.match(CANUE_MONTH_PATTERN)?.[1]?.toLowerCase() ?? null
}

function getCanueV2SelectionDate(selection: CanueVariableSelection): Date {
  const month = getCanueV2MonthKey(selection.variable)
  return new Date(selection.year, month ? (CANUE_MONTH_BY_KEY.get(month)?.value ?? 1) - 1 : 0, 1)
}

function getCanueV2TimelineKey(selection: CanueVariableSelection, monthly: boolean): string {
  if (!monthly) return String(selection.year)
  const month = getCanueV2MonthKey(selection.variable)
  const monthIndex = month ? (CANUE_MONTH_BY_KEY.get(month)?.value ?? 1) - 1 : 0
  return `${selection.year}-${String(monthIndex).padStart(2, '0')}`
}

function getCanueV2Cadence(selection: CanueVariableSelection): CanueV2Cadence {
  return getCanueV2MonthKey(selection.variable) ? 'monthly' : 'annual'
}

function getCanueV2MeasureVariable(variable: string): string {
  return variable
    .replace(CANUE_MONTH_PATTERN, '')
    .replace(CANUE_ANNUAL_YEAR_PATTERN, '$1$3')
}

function getCanueV2MeasureKey(selection: Pick<CanueVariableSelection, 'dataset' | 'variable'>): string {
  return `${selection.dataset}__${getCanueV2MeasureVariable(selection.variable)}`
}

function stripCanueV2DatasetVersion(label: string): string {
  return label
    .replace(/\s+\(?v\d+\)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function getCanueV2GridVariableLabel(selection: CanueVariableSelection, metadataLookup: CanueV2MetadataLookup | null | undefined): string {
  return stripCanueV2DatasetVersion(getCanueV2DatasetLabel(selection.dataset, metadataLookup))
    .replace(/^(annual|monthly|daily|yearly)\s+/i, '')
    .trim()
}

function getCanueV2GridVariableKey(selection: CanueVariableSelection, metadataLookup: CanueV2MetadataLookup | null | undefined): string {
  return normalizedCanueLabelToken(getCanueV2GridVariableLabel(selection, metadataLookup))
}

function getCanueV2VariableOptionLabel(selection: CanueVariableSelection, metadataLookup: CanueV2MetadataLookup | null | undefined): string {
  const datasetLabel = getCanueV2DatasetLabel(selection.dataset, metadataLookup)
  const gridVariableLabel = getCanueV2GridVariableLabel(selection, metadataLookup)
  const datasetVersion = datasetLabel.match(/\bv\d+\b/i)?.[0] ?? null
  const topicLabel = gridVariableLabel
    .replace(/\b(annual|monthly|daily|yearly)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  const escapedTopic = topicLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const variableLabel = getCanueV2VariableLabel(selection)
  const measureLabel = escapedTopic
    ? variableLabel.replace(new RegExp(`^${escapedTopic}\\s*`, 'i'), '').trim()
    : variableLabel
  const inferredMeanLabel = !measureLabel && getCanueVariableSuffix(getCanueV2MeasureVariable(selection.variable)) === '01'
    ? 'mean'
    : null
  const normalizedMeasure = inferredMeanLabel ?? (measureLabel && normalizedCanueLabelToken(measureLabel) !== normalizedCanueLabelToken(gridVariableLabel)
    ? measureLabel
    : null)

  return [datasetVersion, normalizedMeasure ?? variableLabel].filter(Boolean).join(' - ')
}

function getPreferredCanueV2MeasureKey(options: Array<{ value: string }>): string | null {
  return CANUE_V2_PREFERRED_MEASURE_KEYS.find((key) => options.some((option) => option.value === key))
    ?? options.find((option) => option.value.includes('pm25'))?.value
    ?? options[0]?.value
    ?? null
}

function getPreferredCanueV2Selection(selections: CanueVariableSelection[]): CanueVariableSelection | null {
  const preferredKey = getPreferredCanueV2MeasureKey(
    selections.map((selection) => ({ value: getCanueV2MeasureKey(selection) })),
  )
  return preferredKey
    ? selections.find((selection) => getCanueV2MeasureKey(selection) === preferredKey) ?? null
    : selections[0] ?? null
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

interface CanueGraphVariableOption {
  key: string
  label: string
}

interface CanueGraphPoint {
  id: string
  name: string
  value: number
}

interface CanueGraphSeries {
  key: string
  label: string
  color: string
  points: CanueGraphPoint[]
  min: number
  max: number
  mean: number
}

const CANUE_GRAPH_COLORS = ['#0891b2', '#ea580c', '#16a34a', '#7c3aed']

function makeCanueGraphSeries(
  rows: CanueAggregateRow[],
  variables: CanueGraphVariableOption[],
): CanueGraphSeries[] {
  return variables.map((variable, index) => {
    const points = rows.flatMap((row) => {
      const value = Number(row.values[variable.key])
      if (!Number.isFinite(value)) return []
      return [{
        id: row.boundaryId,
        name: row.boundaryName,
        value,
      }]
    })
    const values = points.map((point) => point.value)
    const min = Math.min(...values)
    const max = Math.max(...values)
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    return {
      key: variable.key,
      label: variable.label,
      color: CANUE_GRAPH_COLORS[index % CANUE_GRAPH_COLORS.length],
      points,
      min,
      max,
      mean,
    }
  }).filter((series) => series.points.length > 0 && Number.isFinite(series.min) && Number.isFinite(series.max))
}

function makeHistogram(values: number[], min: number, max: number, bucketCount = 10) {
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    index,
    count: 0,
    start: min,
    end: max,
  }))
  if (!values.length) return buckets
  if (min === max) {
    buckets[0].count = values.length
    return buckets
  }
  const span = max - min
  for (const value of values) {
    const bucketIndex = Math.min(bucketCount - 1, Math.max(0, Math.floor(((value - min) / span) * bucketCount)))
    buckets[bucketIndex].count += 1
  }
  return buckets.map((bucket) => ({
    ...bucket,
    start: min + (span * bucket.index) / bucketCount,
    end: min + (span * (bucket.index + 1)) / bucketCount,
  }))
}

function CanueGraphDrawer({
  rows,
  options,
  selectedKeys,
  selectedBoundaryId,
  boundaryLevelLabel,
  loading,
  elevated,
  onToggleVariable,
  onClose,
}: {
  rows: CanueAggregateRow[]
  options: CanueGraphVariableOption[]
  selectedKeys: string[]
  selectedBoundaryId: string | null
  boundaryLevelLabel: string
  loading: boolean
  elevated?: boolean
  onToggleVariable: (key: string) => void
  onClose: () => void
}) {
  const selectedOptions = options.filter((option) => selectedKeys.includes(option.key))
  const series = makeCanueGraphSeries(rows, selectedOptions)
  const selectedBoundaryName = selectedBoundaryId
    ? rows.find((row) => row.boundaryId === selectedBoundaryId)?.boundaryName ?? null
    : null

  return (
    <div
      className={cn(
        'absolute inset-x-3 z-20 mx-auto max-h-[50vh] max-w-5xl overflow-hidden rounded-lg border border-border bg-background/95 shadow-2xl backdrop-blur md:max-h-[22rem]',
        elevated
          ? 'bottom-[calc(var(--map-mobile-sheet-visible-height,72px)_+_var(--map-timeline-height,5.5rem)_+_0.75rem)] md:bottom-[calc(var(--map-timeline-height,5.5rem)_+_1.5rem)]'
          : 'bottom-[calc(var(--map-mobile-sheet-visible-height,72px)_+_0.75rem)] md:bottom-6',
      )}
    >
      <div className="flex items-start justify-between gap-3 border-b border-border px-3 py-2.5 md:px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 shrink-0 text-cyan-600" />
            <h3 className="truncate text-sm font-semibold text-foreground">CANUE graphs</h3>
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {rows.length.toLocaleString()} {boundaryLevelLabel} areas{selectedBoundaryName ? ` | selected: ${selectedBoundaryName}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input text-muted-foreground hover:text-foreground"
          aria-label="Close CANUE graphs"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid max-h-[calc(50vh-3.25rem)] min-h-0 grid-cols-1 overflow-y-auto md:max-h-[18.5rem] md:grid-cols-[16rem_1fr] md:overflow-hidden">
        <div className="border-b border-border p-3 md:border-b-0 md:border-r md:p-4">
          <div className="mb-2 text-xs font-medium text-foreground">Variables</div>
          <div className="flex gap-1.5 overflow-x-auto pb-1 md:max-h-56 md:flex-col md:overflow-y-auto md:pb-0">
            {options.slice(0, 60).map((option) => {
              const active = selectedKeys.includes(option.key)
              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => onToggleVariable(option.key)}
                  className={cn(
                    'shrink-0 rounded-md border px-2.5 py-1.5 text-left text-[11px] leading-4 transition-colors md:shrink',
                    active
                      ? 'border-cyan-600 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/30 dark:text-cyan-100'
                      : 'border-input text-muted-foreground hover:text-foreground',
                  )}
                >
                  <span className="line-clamp-2">{option.label}</span>
                </button>
              )
            })}
          </div>
          <div className="mt-2 text-[10px] text-muted-foreground">Pick up to four variables.</div>
        </div>
        <div className="min-h-0 p-3 md:overflow-y-auto md:p-4">
          {loading && <div className="text-xs text-muted-foreground">Loading graph values...</div>}
          {!loading && !series.length && (
            <div className="text-xs text-muted-foreground">No graphable values are available for the selected variables.</div>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {series.map((item) => {
              const histogram = makeHistogram(item.points.map((point) => point.value), item.min, item.max)
              const maxBucket = Math.max(...histogram.map((bucket) => bucket.count), 1)
              const topPoints = item.points.slice().sort((left, right) => right.value - left.value).slice(0, 5)
              const selectedPoint = selectedBoundaryId
                ? item.points.find((point) => point.id === selectedBoundaryId)
                : null
              const selectedOffset = selectedPoint && item.max !== item.min
                ? ((selectedPoint.value - item.min) / (item.max - item.min)) * 100
                : null

              return (
                <section key={item.key} className="rounded-md border border-border bg-background p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="line-clamp-2 text-xs font-semibold leading-4 text-foreground">{item.label}</h4>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        mean {formatNullableNumber(item.mean)} | {formatNullableNumber(item.min)}-{formatNullableNumber(item.max)}
                      </div>
                    </div>
                    <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                  </div>
                  <div className="relative mt-3 h-24 border-b border-l border-border px-1">
                    <div className="flex h-full items-end gap-1">
                      {histogram.map((bucket) => (
                        <div
                          key={bucket.index}
                          className="min-w-0 flex-1 rounded-t-sm"
                          style={{
                            height: `${Math.max(4, (bucket.count / maxBucket) * 100)}%`,
                            backgroundColor: item.color,
                            opacity: 0.28 + (bucket.count / maxBucket) * 0.54,
                          }}
                          title={`${formatNullableNumber(bucket.start)}-${formatNullableNumber(bucket.end)}: ${bucket.count}`}
                        />
                      ))}
                    </div>
                    {selectedOffset != null && (
                      <div
                        className="absolute bottom-0 top-0 w-0.5 bg-foreground"
                        style={{ left: `calc(${selectedOffset}% + 0.25rem)` }}
                        title={selectedBoundaryName ?? 'Selected boundary'}
                      />
                    )}
                  </div>
                  <div className="mt-2 flex justify-between gap-3 text-[10px] text-muted-foreground">
                    <span>{formatNullableNumber(item.min)}</span>
                    <span>{formatNullableNumber(item.max)}</span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {topPoints.map((point) => (
                      <div key={point.id} className="grid grid-cols-[1fr_auto] items-center gap-2 text-[11px]">
                        <span className="truncate text-muted-foreground">{point.name}</span>
                        <span className="font-medium tabular-nums text-foreground">{formatNullableNumber(point.value)}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function MiscDataSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showSidebar, setShowSidebar] = useState(true)
  const activeTab = parseMiscDataTab(searchParams.get('tab'))
  const setActiveTab = useCallback((tab: MiscDataTab) => {
    const params = new URLSearchParams(searchParams)
    if (tab === 'canue') params.delete('tab')
    else params.set('tab', tab)
    setSearchParams(params)
  }, [searchParams, setSearchParams])
  const [activeLayers, setActiveLayers] = useState<MiscLayerId[]>(['trees', 'forests', 'facilities'])
  const [showMobileLegend, setShowMobileLegend] = useState(false)
  const [canueBoundaryLevel, setCanueBoundaryLevel] = useState<CanueBoundaryLevel>(() => parseCanueBoundaryLevel(searchParams.get('boundary')))
  const [canueBoundarySource, setCanueBoundarySource] = useState<CanueBoundarySource>(() => (
    CANUE_BOUNDARY_LEVEL_TO_SOURCE[parseCanueBoundaryLevel(searchParams.get('boundary'))]
  ))
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
  const [selectedCanueV2Cadence, setSelectedCanueV2Cadence] = useState<CanueV2Cadence>(() => (
    searchParams.get('cadence') === 'monthly' || searchParams.has('gridMonth') ? 'monthly' : 'annual'
  ))
  const [selectedCanueV2Month, setSelectedCanueV2Month] = useState<string | null>(() => searchParams.get('gridMonth'))
  const [selectedCanueV2Property, setSelectedCanueV2Property] = useState<string | null>(() => searchParams.get('property'))
  const [selectedCanueBoundaryId, setSelectedCanueBoundaryId] = useState<string | null>(null)
  const [showCanueGraphs, setShowCanueGraphs] = useState(false)
  const [canueTimelineEnabled, setCanueTimelineEnabled] = useState(false)
  const [canueTimelineWindowSize, setCanueTimelineWindowSize] = useState(1)
  const [selectedCanueGraphKeys, setSelectedCanueGraphKeys] = useState<string[]>([])
  const { trees, forests, facilities, loading, error } = useHeatShadeData(activeTab === 'heatShade')
  const heatShadeManifest = useJsonManifest<HeatShadeManifest>(activeTab === 'heatShade' ? '/data/heat-shade/manifest.json' : null)
  const networkAvailabilityManifest = useJsonManifest<NetworkAvailabilityManifest>(activeTab === 'network' ? '/data/network-availability/manifest.json' : null)
  const networkAvailabilityLayer = useNetworkAvailabilityLayer(activeTab === 'network')
  const canueManifest = useJsonManifest<CanueManifest>(CANUE_V2_ENABLED ? null : '/data/canue/bc/annual-gzip/manifest.json')
  const canueV2Catalog = useJsonManifest<CanueV2Catalog>(CANUE_V2_ENABLED ? CANUE_V2_CATALOG_URL : null)
  const canueV2MetadataUrl = useMemo(
    () => resolveCanueV2AssetUrl(canueV2Catalog.data?.metadataLookup),
    [canueV2Catalog.data?.metadataLookup],
  )
  const canueV2Metadata = useJsonManifest<CanueV2MetadataLookup>(CANUE_V2_ENABLED ? canueV2MetadataUrl : null)
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
  const flood = useFloodData(activeTab === 'flood')

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
      if (selectedCanueV2Cadence === 'monthly') params.set('cadence', selectedCanueV2Cadence)
      else params.delete('cadence')
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
      params.delete('cadence')
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
  }, [activeTab, canueBoundaryLevel, canueYearMode, searchParams, selectedCanueDatasetId, selectedCanueMonth, selectedCanueV2Cadence, selectedCanueV2Family, selectedCanueV2Measure, selectedCanueV2Month, selectedCanueV2Property, selectedCanueV2Year, selectedCanueYear, icbc.showHeatmap, icbc.showPoints, icbc.selectedDatasetId, wars.showHeatmap, wars.showPoints, wars.selectedSpecies, walkability.displayMode, walkability.selectedHeatmapVariantId, walkability.selectedVariantId, setSearchParams])

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
    : canueBoundarySource === 'regionalDistrict'
      ? CANUE_REGIONAL_DISTRICT_LEVEL_OPTIONS
    : canueBoundarySource === 'cityPG'
      ? CANUE_CITY_LEVEL_OPTIONS
      : canueBoundarySource === 'watershed'
        ? CANUE_WATERSHED_LEVEL_OPTIONS
        : canueBoundarySource === 'nrAdmin'
          ? CANUE_NR_ADMIN_LEVEL_OPTIONS
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
  const canueV2GridVariableOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: ReactNode; sortLabel: string; title: string }>()
    for (const selection of selectedCanueV2FamilySelections) {
      const value = getCanueV2GridVariableKey(selection, canueV2Metadata.data)
      if (!options.has(value)) {
        const label = getCanueV2GridVariableLabel(selection, canueV2Metadata.data)
        const help = getCanueV2DatasetHelp(selection, canueV2Metadata.data)
        options.set(value, {
          value,
          label: renderCanueDisplayLabel(label),
          sortLabel: label,
          title: `${getCanueV2DatasetTitle(selection, canueV2Metadata.data)} | ${help}`,
        })
      }
    }
    return Array.from(options.values()).sort((left, right) => left.sortLabel.localeCompare(right.sortLabel))
  }, [canueV2Metadata.data, selectedCanueV2FamilySelections])
  const selectedCanueV2GridVariableKey = useMemo(() => {
    if (selectedCanueV2Measure) {
      const measureSelection = selectedCanueV2FamilySelections.find((selection) => getCanueV2MeasureKey(selection) === selectedCanueV2Measure)
      if (measureSelection) return getCanueV2GridVariableKey(measureSelection, canueV2Metadata.data)
    }
    if (selectedCanueV2Property) {
      const propertySelection = selectedCanueV2FamilySelections.find((selection) => selection.property === selectedCanueV2Property)
      if (propertySelection) return getCanueV2GridVariableKey(propertySelection, canueV2Metadata.data)
    }
    const preferredSelection = getPreferredCanueV2Selection(selectedCanueV2FamilySelections)
    return preferredSelection ? getCanueV2GridVariableKey(preferredSelection, canueV2Metadata.data) : canueV2GridVariableOptions[0]?.value ?? null
  }, [canueV2GridVariableOptions, canueV2Metadata.data, selectedCanueV2FamilySelections, selectedCanueV2Measure, selectedCanueV2Property])
  const selectedCanueV2GridVariableSelections = useMemo(() => (
    selectedCanueV2GridVariableKey
      ? selectedCanueV2FamilySelections.filter((selection) => getCanueV2GridVariableKey(selection, canueV2Metadata.data) === selectedCanueV2GridVariableKey)
      : []
  ), [canueV2Metadata.data, selectedCanueV2FamilySelections, selectedCanueV2GridVariableKey])
  const canueV2CadenceOptions = useMemo(() => {
    const available = new Set(selectedCanueV2GridVariableSelections.map(getCanueV2Cadence))
    return ([
      { value: 'annual' as const, label: 'Annual' },
      { value: 'monthly' as const, label: 'Monthly' },
    ]).filter((option) => available.has(option.value))
  }, [selectedCanueV2GridVariableSelections])
  const selectedCanueV2ResolvedCadence = useMemo<CanueV2Cadence>(() => {
    if (selectedCanueV2Property) {
      const propertySelection = selectedCanueV2GridVariableSelections.find((selection) => selection.property === selectedCanueV2Property)
      if (propertySelection) return getCanueV2Cadence(propertySelection)
    }
    if (selectedCanueV2Measure) {
      const measureSelection = selectedCanueV2GridVariableSelections.find((selection) => getCanueV2MeasureKey(selection) === selectedCanueV2Measure)
      if (measureSelection) return getCanueV2Cadence(measureSelection)
    }
    if (canueV2CadenceOptions.some((option) => option.value === selectedCanueV2Cadence)) return selectedCanueV2Cadence
    return canueV2CadenceOptions[0]?.value ?? 'annual'
  }, [canueV2CadenceOptions, selectedCanueV2Cadence, selectedCanueV2GridVariableSelections, selectedCanueV2Measure, selectedCanueV2Property])
  const selectedCanueV2CadenceSelections = useMemo(() => (
    selectedCanueV2GridVariableSelections.filter((selection) => getCanueV2Cadence(selection) === selectedCanueV2ResolvedCadence)
  ), [selectedCanueV2GridVariableSelections, selectedCanueV2ResolvedCadence])
  const canueV2MeasureOptions = useMemo(() => {
    const options = new Map<string, { value: string; label: ReactNode; sortLabel: string; title: string }>()
    for (const selection of selectedCanueV2CadenceSelections) {
      const value = getCanueV2MeasureKey(selection)
      if (!options.has(value)) {
        const label = getCanueV2VariableOptionLabel(selection, canueV2Metadata.data)
        const variableLabel = getCanueV2VariableLabel(selection)
        const help = getCanueV2DatasetHelp(selection, canueV2Metadata.data)
        options.set(value, {
          value,
          label: renderCanueDisplayLabel(label),
          sortLabel: label,
          title: `${variableLabel}: ${help}`,
        })
      }
    }
    return Array.from(options.values()).sort((left, right) => left.sortLabel.localeCompare(right.sortLabel))
  }, [canueV2Metadata.data, selectedCanueV2CadenceSelections])
  const selectedCanueV2MeasureKey = useMemo(() => {
    if (selectedCanueV2Measure && canueV2MeasureOptions.some((option) => option.value === selectedCanueV2Measure)) return selectedCanueV2Measure
    if (selectedCanueV2Property) {
      const propertySelection = selectedCanueV2CadenceSelections.find((selection) => selection.property === selectedCanueV2Property)
      if (propertySelection) return getCanueV2MeasureKey(propertySelection)
    }
    return getPreferredCanueV2MeasureKey(canueV2MeasureOptions)
  }, [canueV2MeasureOptions, selectedCanueV2CadenceSelections, selectedCanueV2Measure, selectedCanueV2Property])
  const selectedCanueV2MeasureSelections = useMemo(() => (
    selectedCanueV2MeasureKey
      ? selectedCanueV2CadenceSelections.filter((selection) => getCanueV2MeasureKey(selection) === selectedCanueV2MeasureKey)
      : []
  ), [selectedCanueV2CadenceSelections, selectedCanueV2MeasureKey])
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
  const selectedCanueV2DatasetHelp = useMemo(() => (
    selectedCanueV2Selection ? getCanueV2DatasetHelp(selectedCanueV2Selection, canueV2Metadata.data) : null
  ), [canueV2Metadata.data, selectedCanueV2Selection])
  const canueTimelineIsMonthly = canueV2MonthOptions.length > 0
  const canueTimelineSelections = useMemo(() => {
    if (!selectedCanueV2MeasureSelections.length) return []
    return selectedCanueV2MeasureSelections
      .filter((selection) => canueTimelineIsMonthly ? getCanueV2MonthKey(selection.variable) : getCanueV2MonthKey(selection.variable) == null)
      .sort((left, right) => getCanueV2SelectionDate(left).getTime() - getCanueV2SelectionDate(right).getTime())
  }, [canueTimelineIsMonthly, selectedCanueV2MeasureSelections])
  const canueTimelineBucketKeys = useMemo(() => (
    new Set(canueTimelineSelections.map((selection) => getCanueV2TimelineKey(selection, canueTimelineIsMonthly)))
  ), [canueTimelineIsMonthly, canueTimelineSelections])
  const canueTimelineDateRange = useMemo(() => {
    const first = canueTimelineSelections[0]
    const last = canueTimelineSelections[canueTimelineSelections.length - 1]
    if (!first || !last) return null
    return {
      start: getCanueV2SelectionDate(first),
      end: getCanueV2SelectionDate(last),
    }
  }, [canueTimelineSelections])
  const canueTimelineDate = useMemo(() => {
    if (!selectedCanueV2Selection) return null
    return getCanueV2SelectionDate(selectedCanueV2Selection)
  }, [selectedCanueV2Selection])
  const canueTimelineBucketCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const selection of canueTimelineSelections) {
      counts.set(
        getCanueV2TimelineKey(selection, canueTimelineIsMonthly),
        selection.count ?? selectedCanueV2FamilyEntry?.layers.find((layer) => layer.year === selection.year)?.features ?? 1,
      )
    }
    return counts
  }, [canueTimelineIsMonthly, canueTimelineSelections, selectedCanueV2FamilyEntry?.layers])
  const canueTimelineAvailable = CANUE_V2_ENABLED && canueTimelineBucketKeys.size > 1 && selectedCanueV2Selection != null
  const canueTimelineActive = canueTimelineEnabled && canueTimelineAvailable
  const handleCanueTimelineDateChange = useCallback((date: Date) => {
    const targetTime = date.getTime()
    const nextSelection = canueTimelineSelections.find((selection) => getCanueV2SelectionDate(selection).getTime() === targetTime)
      ?? canueTimelineSelections.reduce<CanueVariableSelection | null>((closest, selection) => {
        if (!closest) return selection
        const currentDistance = Math.abs(getCanueV2SelectionDate(selection).getTime() - targetTime)
        const closestDistance = Math.abs(getCanueV2SelectionDate(closest).getTime() - targetTime)
        return currentDistance < closestDistance ? selection : closest
      }, null)
    if (!nextSelection) return
    setSelectedCanueV2Year(nextSelection.year)
    setSelectedCanueV2Month(getCanueV2MonthKey(nextSelection.variable))
    setSelectedCanueV2Property(nextSelection.property)
  }, [canueTimelineSelections])
  const handleCanueTimelineDisable = useCallback(() => {
    setCanueTimelineEnabled(false)
  }, [])
  const canueTimelinePrefetch = useCanueV2AggregatePrefetch({
    source: canueBoundarySource,
    level: canueBoundaryLevel,
    selections: canueTimelineSelections,
    enabled: activeTab === 'canue' && showCanueBoundaries && canueTimelineActive,
  })
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
    idField: canueBoundaryConfig.idField,
    nameField: canueBoundaryConfig.nameField,
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
  const canueGraphVariableOptions = useMemo<CanueGraphVariableOption[]>(() => {
    if (CANUE_V2_ENABLED && selectedCanueV2Layer && selectedCanueV2FamilySelections.length) {
      const options = new Map<string, CanueGraphVariableOption>()
      for (const selection of selectedCanueV2FamilySelections) {
        if (selection.year !== selectedCanueV2Layer.year) continue
        options.set(selection.property, {
          key: selection.property,
          label: formatCanueDisplayLabel(getCanueV2GraphVariableLabel(selection, canueV2Metadata.data)),
        })
      }
      return Array.from(options.values()).sort((left, right) => left.label.localeCompare(right.label))
    }

    if (selectedCanueFile && selectedCanueVariable) {
      return [{
        key: selectedCanueVariable,
        label: formatCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable)),
      }]
    }

    return []
  }, [canueV2Metadata.data, selectedCanueFile, selectedCanueV2FamilySelections, selectedCanueV2Layer, selectedCanueVariable])
  const activeCanueGraphRows = useMemo<CanueAggregateRow[]>(() => {
    if (canueV2AggregateData.aggregateRows.length) return canueV2AggregateData.aggregateRows
    return activeCanueBoundaryData.data.features.flatMap((feature, index) => {
      const boundaryId = String(feature.properties?.boundaryId ?? feature.id ?? index)
      const boundaryName = String(feature.properties?.boundaryName ?? feature.properties?.name ?? feature.id ?? index)
      const value = Number(feature.properties?.[activeCanueBoundaryProperty])
      if (!Number.isFinite(value)) return []
      return [{
        boundaryId,
        boundaryName,
        values: { [activeCanueBoundaryProperty]: value },
      }]
    })
  }, [activeCanueBoundaryData.data.features, activeCanueBoundaryProperty, canueV2AggregateData.aggregateRows])
  const canueGraphsAvailable = activeTab === 'canue' && showCanueBoundaries && canueGraphVariableOptions.length > 0
  const canueBoundaryLayerReady = useMemo(() => (
    activeCanueBoundaryData.data.features.some((feature) => (
      Number.isFinite(Number(feature.properties?.[activeCanueBoundaryProperty]))
    ))
  ), [activeCanueBoundaryData.data.features, activeCanueBoundaryProperty])
  const [stableCanueBoundaryLayer, setStableCanueBoundaryLayer] = useState<{
    data: BoundaryFeatureCollection
    property: string
    minValue: number | null
    maxValue: number | null
    boundaryLevel: CanueBoundaryLevel
  } | null>(null)

  useEffect(() => {
    if (canueBoundaryLayerReady) {
      setStableCanueBoundaryLayer({
        data: activeCanueBoundaryData.data,
        property: activeCanueBoundaryProperty,
        minValue: activeCanueBoundaryData.minValue,
        maxValue: activeCanueBoundaryData.maxValue,
        boundaryLevel: canueBoundaryLevel,
      })
      return
    }

    const waitingForNextCanueAggregate = CANUE_V2_ENABLED
      && selectedCanueV2Selection
      && activeCanueBoundaryData === canueV2AggregateData
      && canueV2AggregateData.property != null
      && canueV2AggregateData.property !== activeCanueBoundaryProperty

    if (!activeCanueBoundaryData.loading && !waitingForNextCanueAggregate) {
      setStableCanueBoundaryLayer(null)
    }
  }, [
    activeCanueBoundaryData.data,
    activeCanueBoundaryData.loading,
    activeCanueBoundaryData.maxValue,
    activeCanueBoundaryData.minValue,
    activeCanueBoundaryProperty,
    canueBoundaryLayerReady,
    canueBoundaryLevel,
    canueV2AggregateData,
    selectedCanueV2Selection,
  ])

  useEffect(() => {
    if (!canueTimelineAvailable && canueTimelineEnabled) {
      setCanueTimelineEnabled(false)
    }
  }, [canueTimelineAvailable, canueTimelineEnabled])

  const renderedCanueBoundaryLayer = stableCanueBoundaryLayer?.boundaryLevel === canueBoundaryLevel
    ? stableCanueBoundaryLayer
    : null
  const renderedCanueFillColor = useMemo(() => {
    if (!renderedCanueBoundaryLayer) return '#e5e7eb'
    return canueBoundaryPaint(
      renderedCanueBoundaryLayer.property,
      renderedCanueBoundaryLayer.minValue,
      renderedCanueBoundaryLayer.maxValue,
    )
  }, [renderedCanueBoundaryLayer])
  const heatShadeSources = heatShadeManifest.data?.sources ?? []
  const landsatSource = heatShadeSources.find((source) => source.kind === 'historicalNdviLst')
  const canueMapCenter = canueBoundarySource === 'bcHealth'
    || canueBoundarySource === 'regionalDistrict'
    || canueBoundarySource === 'watershed'
    || canueBoundarySource === 'nrAdmin'
    ? BC_CENTER
    : PG_CENTER
  const canueMapZoom = canueBoundarySource === 'bcHealth'
    || canueBoundarySource === 'regionalDistrict'
    || canueBoundarySource === 'watershed'
    || canueBoundarySource === 'nrAdmin'
    ? 4.4
    : canueBoundarySource === 'cityPG'
      ? 10.2
      : 9.4
  const mapCenter = activeTab === 'canue' ? canueMapCenter : activeTab === 'water' || activeTab === 'network' ? BC_CENTER : PG_CENTER
  const mapZoom = activeTab === 'canue' ? canueMapZoom : activeTab === 'water' || activeTab === 'network' ? 4.4 : activeTab === 'icbc' || activeTab === 'wars' ? 10.5 : activeTab === 'walkability' ? 9.7 : 11
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
    if (selectedCanueV2Cadence !== selectedCanueV2ResolvedCadence) setSelectedCanueV2Cadence(selectedCanueV2ResolvedCadence)
    if (selectedCanueV2Measure !== selectedCanueV2MeasureKey) setSelectedCanueV2Measure(selectedCanueV2MeasureKey)
    if (selectedCanueV2Month !== selectedCanueV2ResolvedMonth) setSelectedCanueV2Month(selectedCanueV2ResolvedMonth)
    if (selectedCanueV2Year !== selectedCanueV2Layer.year) setSelectedCanueV2Year(selectedCanueV2Layer.year)
    if (selectedCanueV2Property !== selectedCanueV2Selection.property) setSelectedCanueV2Property(selectedCanueV2Selection.property)
  }, [
    selectedCanueV2Family,
    selectedCanueV2FamilyEntry,
    selectedCanueV2Cadence,
    selectedCanueV2Layer,
    selectedCanueV2Measure,
    selectedCanueV2MeasureKey,
    selectedCanueV2Month,
    selectedCanueV2Property,
    selectedCanueV2ResolvedCadence,
    selectedCanueV2ResolvedMonth,
    selectedCanueV2Selection,
    selectedCanueV2Year,
  ])

  useEffect(() => {
    const availableKeys = new Set(canueGraphVariableOptions.map((option) => option.key))
    const nextKeys = selectedCanueGraphKeys.filter((key) => availableKeys.has(key)).slice(0, 4)
    if (!nextKeys.length) {
      const preferredKeys = [
        activeCanueBoundaryProperty,
        ...canueGraphVariableOptions.map((option) => option.key),
      ].filter((key, index, keys) => key && availableKeys.has(key) && keys.indexOf(key) === index)
      nextKeys.push(...preferredKeys.slice(0, 3))
    }
    if (nextKeys.join('|') !== selectedCanueGraphKeys.join('|')) {
      setSelectedCanueGraphKeys(nextKeys)
    }
  }, [activeCanueBoundaryProperty, canueGraphVariableOptions, selectedCanueGraphKeys])

  useEffect(() => {
    setSelectedCanueBoundaryId(null)
  }, [canueBoundaryLevel, canuePeriodLabel, selectedCanueDatasetId, selectedCanueVariable])

  const handleCanueBoundarySourceChange = (source: CanueBoundarySource) => {
    setCanueBoundarySource(source)
    setCanueBoundaryLevel(getDefaultCanueBoundaryLevel(source))
    setSelectedCanueBoundaryId(null)
  }

  const handleCanueGraphVariableToggle = (key: string) => {
    setSelectedCanueGraphKeys((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key)
      return [...current, key].slice(-4)
    })
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
      {activeTab === 'network' && <p>Network availability inventory updated {formatDate(networkAvailabilityManifest.data?.generatedAt)}.</p>}
      {activeTab === 'network' && networkAvailabilityLayer.error && <p>{networkAvailabilityLayer.error}</p>}
      {activeTab === 'icbc' && <IcbcSourceNotes icbc={icbc} />}
      {activeTab === 'wars' && <WarsSourceNotes wars={wars} />}
      {activeTab === 'walkability' && <WalkabilitySourceNotes walkability={walkability} />}
      {activeTab === 'water' && <WaterSourceNotes water={water} />}
      {activeTab === 'flood' && <FloodSourceNotes flood={flood} />}
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
        {activeTab === 'flood' && <FloodLayerControls flood={flood} />}
      </div>

      <DatasetInfo
        dataset={{
          ...(activeTab === 'heatShade'
              ? DATASETS.heatShade
            : activeTab === 'network'
              ? DATASETS.networkAvailability
            : activeTab === 'icbc'
              ? DATASETS.icbc
              : activeTab === 'wars'
                ? DATASETS.wars
              : activeTab === 'walkability'
                ? DATASETS.walkability
              : activeTab === 'water'
                ? DATASETS.water
              : activeTab === 'flood'
                ? DATASETS.flood
                : DATASETS.canue),
          updated: activeTab === 'heatShade'
            ? heatShadeManifest.data?.generatedAt
            : activeTab === 'network'
              ? networkAvailabilityManifest.data?.generatedAt
            : activeTab === 'icbc'
              ? icbc.manifest.data?.generatedAt
              : activeTab === 'wars'
                ? wars.manifest.data?.generatedAt
              : activeTab === 'walkability'
                ? walkability.manifest.data?.generatedAt
              : activeTab === 'water'
                ? water.manifest.data?.generatedAt
              : activeTab === 'flood'
                ? undefined
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
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Database className="h-4 w-4 shrink-0 text-cyan-600" />
              <h2 className="truncate text-sm font-semibold text-foreground">CANUE Boundary Map</h2>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              {canueTimelineAvailable && (
                <button
                  type="button"
                  onClick={() => setCanueTimelineEnabled((current) => !current)}
                  className={cn(
                    'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors',
                    canueTimelineActive
                      ? 'border-cyan-600 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/30 dark:text-cyan-100'
                      : 'border-input text-muted-foreground hover:text-foreground',
                  )}
                  aria-pressed={canueTimelineActive}
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  Timeline
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowCanueGraphs((current) => !current)}
                disabled={!canueGraphsAvailable}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
                aria-pressed={showCanueGraphs}
              >
                <BarChart3 className="h-3.5 w-3.5" />
                Graphs
              </button>
            </div>
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
                    const nextSelections = nextFamily && canueV2Catalog.data
                      ? listCanueV2Selections(canueV2Catalog.data).filter((selection) => selection.family === nextFamily.id)
                      : []
                    const nextSelection = getPreferredCanueV2Selection(nextSelections)
                    const nextCadence = nextSelection ? getCanueV2Cadence(nextSelection) : selectedCanueV2ResolvedCadence
                    setSelectedCanueV2Family(familyId)
                    setSelectedCanueV2Cadence(nextCadence)
                    setSelectedCanueV2Measure(nextSelection ? getCanueV2MeasureKey(nextSelection) : null)
                    setSelectedCanueV2Year(nextFamily?.years[nextFamily.years.length - 1] ?? nextSelection?.year ?? null)
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
                <span className="flex items-center gap-1.5">
                  Grid variable
                  <CanueHelpIcon label="Grid variable" help={selectedCanueV2DatasetHelp} />
                </span>
                <AppSelect
                  value={selectedCanueV2GridVariableKey ?? ''}
                  onValueChange={(gridVariable) => {
                    const nextSelections = selectedCanueV2FamilySelections.filter((selection) => (
                      getCanueV2GridVariableKey(selection, canueV2Metadata.data) === gridVariable
                    ))
                    const nextSelection = getPreferredCanueV2Selection(nextSelections)
                    const nextCadence = nextSelection ? getCanueV2Cadence(nextSelection) : selectedCanueV2ResolvedCadence
                    setSelectedCanueV2Cadence(nextCadence)
                    setSelectedCanueV2Measure(nextSelection ? getCanueV2MeasureKey(nextSelection) : null)
                    setSelectedCanueV2Year(nextSelection?.year ?? null)
                    setSelectedCanueV2Month(nextCadence === 'monthly' && nextSelection ? getCanueV2MonthKey(nextSelection.variable) : null)
                    setSelectedCanueV2Property(nextSelection?.property ?? null)
                  }}
                  options={canueV2GridVariableOptions}
                  className="mt-1"
                  triggerClassName="h-8 rounded-md text-xs"
                />
              </label>
              {canueV2CadenceOptions.length > 1 && (
                <div className="block text-xs font-medium text-foreground">
                  Time scale
                  <div className="mt-1 grid grid-cols-2 rounded-md border border-input bg-background p-0.5">
                    {canueV2CadenceOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => {
                          const nextSelections = selectedCanueV2GridVariableSelections.filter((selection) => getCanueV2Cadence(selection) === option.value)
                          const nextSelection = getPreferredCanueV2Selection(nextSelections)
                          setSelectedCanueV2Cadence(option.value)
                          setSelectedCanueV2Measure(nextSelection ? getCanueV2MeasureKey(nextSelection) : null)
                          setSelectedCanueV2Year(nextSelection?.year ?? null)
                          setSelectedCanueV2Month(option.value === 'monthly' && nextSelection ? getCanueV2MonthKey(nextSelection.variable) : null)
                          setSelectedCanueV2Property(nextSelection?.property ?? null)
                        }}
                        className={cn(
                          'h-7 rounded px-2 text-xs font-medium transition-colors',
                          selectedCanueV2ResolvedCadence === option.value
                            ? 'bg-cyan-600 text-white shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                        aria-pressed={selectedCanueV2ResolvedCadence === option.value}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {canueV2MeasureOptions.length > 1 && (
                <label className="block text-xs font-medium text-foreground">
                  <span className="flex items-center gap-1.5">
                    Sub-variable
                    <CanueHelpIcon label="Sub-variable" help={selectedCanueV2DatasetHelp} />
                  </span>
                  <AppSelect
                    value={selectedCanueV2MeasureKey ?? ''}
                    onValueChange={(measure) => {
                      const nextSelection = selectedCanueV2CadenceSelections.find((selection) => getCanueV2MeasureKey(selection) === measure)
                      setSelectedCanueV2Measure(measure)
                      setSelectedCanueV2Year(nextSelection?.year ?? null)
                      setSelectedCanueV2Month(selectedCanueV2ResolvedCadence === 'monthly' && nextSelection ? getCanueV2MonthKey(nextSelection.variable) : null)
                      setSelectedCanueV2Property(nextSelection?.property ?? null)
                    }}
                    options={canueV2MeasureOptions}
                    className="mt-1"
                    triggerClassName="h-8 rounded-md text-xs"
                  />
                </label>
              )}
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
                    <span className="text-muted-foreground">{renderCanueDisplayLabel(getCanueV2VariableLabel(selectedCanueV2Selection))}</span>
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
                    label: <>{renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, variable))} ({variable})</>,
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
                {renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable ?? ''))} is aggregated in the browser from raw boundary-clipped CANUE records for {canuePeriodLabel}.
              </div>
              {selectedCanueBoundary && selectedCanueVariable && (
                <div className="rounded-md border border-border bg-background p-3 text-xs">
                  <div className="font-semibold text-foreground">
                    {String(selectedCanueBoundary.properties?.boundaryName ?? 'Selected boundary')}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable))}</span>
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

        {activeTab === 'network' && <NetworkAvailabilitySidebar manifest={networkAvailabilityManifest} />}

        {activeTab === 'icbc' && <IcbcSidebar icbc={icbc} />}

        {activeTab === 'wars' && <WarsSidebar wars={wars} />}

        {activeTab === 'walkability' && <WalkabilitySidebar walkability={walkability} />}

        {activeTab === 'water' && <WaterSidebar water={water} />}
        {activeTab === 'flood' && <FloodSidebar flood={flood} />}

      </div>
    </div>
  )

  const tabsBar = (
    <div className="hidden min-w-0 shrink-0 overflow-x-auto border-b border-border bg-background/95 px-2 py-1 backdrop-blur [scrollbar-width:none] md:block md:px-4 md:py-2 [&::-webkit-scrollbar]:hidden">
      <div className="flex w-max rounded-md border border-border bg-muted/40 p-0.5 md:rounded-lg md:p-1">
        {MISC_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={cn(
              'inline-flex h-6 shrink-0 items-center gap-1 rounded px-2 text-[10px] font-medium transition-colors sm:h-7 sm:gap-1.5 sm:px-2.5 sm:text-xs md:h-8 md:rounded-md md:px-3',
              activeTab === id
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
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
            MISC Data | {activeTab === 'canue' ? 'CANUE' : activeTab === 'network' ? 'Network' : activeTab === 'icbc' ? 'ICBC' : activeTab === 'wars' ? 'WARS' : activeTab === 'walkability' ? 'Walkability' : activeTab === 'water' ? 'Water' : activeTab === 'flood' ? 'Flood' : 'Heat/shade'}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {activeTab === 'canue'
              ? `${selectedCanueDataset?.label || 'Dataset'} | ${canuePeriodLabel}`
              : activeTab === 'network'
                ? `${networkAvailabilityLayer.data?.features.length ?? 0} coverage features | ${networkAvailabilityManifest.data?.datasets.length ?? 0} sources`
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
                  : activeTab === 'flood'
                    ? `${flood.filteredStations.length.toLocaleString()} stations | ${flood.highRiskCount.toLocaleString()} above 2 year`
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

          {activeTab === 'canue' && CANUE_V2_ENABLED && selectedCanueV2Selection && !showCanueBoundaries && (
            <MapPmtilesFillLayer
              key={selectedCanueV2Selection.pmtilesUrl}
              url={selectedCanueV2Selection.pmtilesUrl}
              sourceLayer="canue"
              fillColor={canueV2Paint(selectedCanueV2Selection)}
              fillOpacity={0.64}
              lineColor="#0f172a"
              lineWidth={0.18}
              lineOpacity={0.22}
            />
          )}

          {activeTab === 'canue' && showCanueBoundaries && renderedCanueBoundaryLayer && renderedCanueBoundaryLayer.data.features.length > 0 && (
            <MapFillLayer
              data={renderedCanueBoundaryLayer.data}
              fillColor={renderedCanueFillColor}
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

          {activeTab === 'network' && networkAvailabilityLayer.data && (
            <MapFillLayer
              data={networkAvailabilityLayer.data}
              fillColor={['match', ['get', 'Speed'], '5G', '#0f766e', 'LTE', '#2563eb', '#64748b']}
              fillOpacity={0.46}
              lineColor="#083344"
              lineWidth={0.5}
              lineOpacity={0.38}
              idProperty="id"
            />
          )}

          {activeTab === 'walkability' && <WalkabilityLayer walkability={walkability} />}

          {activeTab === 'water' && <WaterLayer water={water} />}
          {activeTab === 'flood' && <FloodLayer flood={flood} />}

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

        {activeTab === 'canue' && canueTimelineActive && canueTimelineDateRange && canueTimelineDate && (
          <Timeline
            startDate={canueTimelineDateRange.start}
            endDate={canueTimelineDateRange.end}
            currentDate={canueTimelineDate}
            onDateChange={handleCanueTimelineDateChange}
            onClose={handleCanueTimelineDisable}
            granularity={canueTimelineIsMonthly ? 'month' : 'year'}
            bucketCounts={canueTimelineBucketCounts}
            compactBars
            windowMode={{
              size: canueTimelineWindowSize,
              onSizeChange: setCanueTimelineWindowSize,
              options: CANUE_TIMELINE_WINDOW_OPTIONS.map((option) => ({
                ...option,
                label: option.value === -1 ? option.label : `${option.value} ${canueTimelineIsMonthly ? 'mo' : 'yr'}`,
              })),
            }}
            statsLabel={
              canueTimelinePrefetch.loading
                ? `Loading timeline ${canueTimelinePrefetch.loaded}/${canueTimelinePrefetch.total} | ${activeCanueBoundaryData.validBoundaryCount.toLocaleString()} areas`
                : `${activeCanueBoundaryData.validBoundaryCount.toLocaleString()} areas with values`
            }
          />
        )}

        {activeTab === 'canue' && showCanueGraphs && canueGraphsAvailable && (
          <CanueGraphDrawer
            rows={activeCanueGraphRows}
            options={canueGraphVariableOptions}
            selectedKeys={selectedCanueGraphKeys}
            selectedBoundaryId={selectedCanueBoundaryId}
            boundaryLevelLabel={canueBoundaryConfig.label}
            loading={activeCanueBoundaryData.loading}
            elevated={canueTimelineActive}
            onToggleVariable={handleCanueGraphVariableToggle}
            onClose={() => setShowCanueGraphs(false)}
          />
        )}

        <MapLegendPanel
          title={activeTab === 'canue' ? 'CANUE Layer' : activeTab === 'network' ? 'Network Sources' : activeTab === 'icbc' ? 'ICBC Layer' : activeTab === 'wars' ? 'WARS Layer' : activeTab === 'walkability' ? 'Walkability Layer' : activeTab === 'water' ? 'Water Layer' : activeTab === 'flood' ? 'Flood Layer' : 'MISC Layers'}
          icon={<Layers className="h-3.5 w-3.5" />}
          collapsible
          collapsed={!showMobileLegend}
          onCollapsedChange={(collapsed) => setShowMobileLegend(!collapsed)}
          contentClassName="space-y-1"
          elevated={(activeTab === 'wars' && wars.timelineEnabled) || (activeTab === 'icbc' && icbc.timelineEnabled) || (activeTab === 'water' && water.timelineEnabled) || (activeTab === 'canue' && canueTimelineActive)}
          width="sm"
          className={cn(
            'w-[min(16.5rem,calc(100vw-2rem))] md:w-auto',
          )}
        >
            {activeTab === 'heatShade' && (
              <div className="w-full space-y-1 text-xs text-muted-foreground md:w-56">
                {MISC_LAYERS.map((layer) => (
                  <LegendItem
                    key={layer.id}
                    color={layer.color}
                    label={layer.label}
                    active={activeLayers.includes(layer.id)}
                    swatchShape={layer.id === 'forests' ? 'square' : 'circle'}
                    onClick={() => toggleLayer(layer.id)}
                  />
                ))}
              </div>
            )}
            {activeTab === 'canue' && (
              <div className="w-full space-y-2 text-xs text-muted-foreground md:w-56">
                <div>
                  <LegendItem
                    color="#fde047"
                    label={selectedCanueV2Selection ? renderCanueDisplayLabel(getCanueV2VariableLabel(selectedCanueV2Selection)) : selectedCanueFile ? renderCanueDisplayLabel(getCanueVariableLabel(selectedCanueFile, selectedCanueVariable ?? '')) : 'CANUE boundary layer'}
                    value={activeCanueBoundaryData.loading ? 'Loading' : undefined}
                    swatchShape="square"
                  />
                  <MapGradientLegendItem
                    className="mt-1 px-1"
                    colors={['#67e8f9', '#fde047', '#ef4444']}
                    minLabel={formatNullableNumber(activeCanueBoundaryData.minValue ?? selectedCanueV2Selection?.min)}
                    maxLabel={formatNullableNumber(activeCanueBoundaryData.maxValue ?? selectedCanueV2Selection?.max)}
                  />
                </div>
              </div>
            )}
            {activeTab === 'network' && (
              <div className="w-full space-y-1 text-xs text-muted-foreground md:w-56">
                <LegendItem color="#0f766e" label="CRTC/NRCan vector coverage" active swatchShape="square" />
                <LegendItem color="#64748b" label="ISED site points" active />
                <LegendItem color="#f97316" label="Carrier raster-only caveat" active swatchShape="square" />
              </div>
            )}
            {activeTab === 'icbc' && <IcbcLegend icbc={icbc} />}
            {activeTab === 'wars' && <WarsLegend wars={wars} />}
            {activeTab === 'walkability' && <WalkabilityLegend walkability={walkability} />}
            {activeTab === 'water' && <WaterLegend water={water} />}
            {activeTab === 'flood' && <FloodLegend flood={flood} />}
        </MapLegendPanel>
      </div>
    </MapSectionLayout>
      </div>
    </div>
  )
}
