import { useEffect, useState, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import type { StudyAreaLevelOption, StudyAreaSourceOption } from '@/components/StudyAreaSelector'
import { BOUNDARY_SOURCE_OPTIONS as ALL_BOUNDARY_SOURCE_OPTIONS } from '@/lib/studyArea'
import { CANUE_V2_CATALOG_URL, type CanueVariableSelection } from './canueV2'

export type BoundaryFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>

export type MiscLayerId = 'trees' | 'forests' | 'facilities'
export type CanueYearMode = 'single' | 'month' | 'all' | 'range'
export type CanueV2Cadence = 'annual' | 'monthly'
export type CanueBoundarySource = 'bcHealth' | 'regionalDistrict' | 'census' | 'cityPG' | 'watershed' | 'nrAdmin'
export type CanueBoundaryLevel =
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

export interface CanueFile {
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

export interface CanueManifest {
  generatedAt: string
  province?: string
  boundaryClip?: string | null
  files: CanueFile[]
}

export interface CanueBoundaryResult {
  data: BoundaryFeatureCollection
  loading: boolean
  error: string | null
  minValue: number | null
  maxValue: number | null
  validBoundaryCount: number
  matchedRowCount: number
}

export interface CanueBoundaryFeatureCardData {
  title: string
  metricLabel: ReactNode
  metricValue: string
  recordCount: number
  recordLabel: string
}

export interface CanueDatasetGroup {
  datasetId: string
  label: string
  category: string
  files: CanueFile[]
  years: number[]
}

export interface BoundaryIndexEntry {
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  bbox: [number, number, number, number]
  id: string
  name: string
}

export interface BoundaryLevelConfig {
  path: string
  idField: string
  nameField: string
  label: string
}

export interface CanuePostalMembershipRecord {
  postalcode: string
  boundaries: Partial<Record<CanueBoundaryLevel, string>>
}

export interface CanuePostalMembership {
  generatedAt: string
  records: CanuePostalMembershipRecord[]
}

export interface CanueV2DatasetMetadataEntry {
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

export interface CanueV2MetadataLookup {
  datasets?: Record<string, CanueV2DatasetMetadataEntry>
}

export const MISC_LAYERS: Array<{ id: MiscLayerId; label: string; color: string }> = [
  { id: 'trees', label: 'Tree canopy proxy', color: '#16a34a' },
  { id: 'forests', label: 'Forests', color: '#15803d' },
  { id: 'facilities', label: 'Cooling access proxy', color: '#0ea5e9' },
]

export const CANUE_SUPPORTED_SOURCES = new Set<string>([
  'bcHealth',
  'regionalDistrict',
  'census',
  'cityPG',
  'watershed',
  'nrAdmin',
])

export const CANUE_BOUNDARY_SOURCE_OPTIONS: Array<StudyAreaSourceOption<string>> = ALL_BOUNDARY_SOURCE_OPTIONS.map(
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

export const CANUE_HEALTH_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'healthAuthority', label: 'Health Authority' },
  { value: 'hsda', label: 'Health Service Delivery Area' },
  { value: 'lha', label: 'Local Health Area' },
  { value: 'chsa', label: 'Community Health Service Area' },
]

export const CANUE_CENSUS_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'cd', label: 'Census Division' },
  { value: 'csd', label: 'Census Subdivision' },
  { value: 'ct', label: 'Census Tract' },
  { value: 'da', label: 'Dissemination Area' },
  { value: 'db', label: 'Dissemination Block' },
]

export const CANUE_CITY_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'elementarySchoolCatchment', label: 'Elementary School Catchment' },
  { value: 'secondarySchoolCatchment', label: 'Secondary School Catchment' },
]

export const CANUE_REGIONAL_DISTRICT_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'regionalDistrict', label: 'Regional District' },
]

export const CANUE_WATERSHED_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'majorWatershed', label: 'Major Watershed' },
  { value: 'watershedGroup', label: 'Watershed Group' },
  { value: 'assessmentWatershed', label: 'Assessment Watershed' },
]

export const CANUE_NR_ADMIN_LEVEL_OPTIONS: Array<StudyAreaLevelOption<CanueBoundaryLevel>> = [
  { value: 'nrArea', label: 'NR Area' },
  { value: 'nrRegion', label: 'NR Region' },
  { value: 'nrDistrict', label: 'NR District' },
]

export const CANUE_BOUNDARY_LEVEL_TO_SOURCE: Record<CanueBoundaryLevel, CanueBoundarySource> = {
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

export function parseCanueBoundaryLevel(value: string | null): CanueBoundaryLevel {
  return value && value in CANUE_BOUNDARY_LEVEL_TO_SOURCE ? (value as CanueBoundaryLevel) : 'chsa'
}

export function getDefaultCanueBoundaryLevel(source: CanueBoundarySource): CanueBoundaryLevel {
  if (source === 'bcHealth') return 'chsa'
  if (source === 'regionalDistrict') return 'regionalDistrict'
  if (source === 'cityPG') return 'elementarySchoolCatchment'
  if (source === 'watershed') return 'watershedGroup'
  if (source === 'nrAdmin') return 'nrArea'
  return 'da'
}

export const CANUE_BOUNDARY_CONFIG: Record<CanueBoundaryLevel, BoundaryLevelConfig> = {
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

export const CANUE_DEFAULT_VARIABLE_BY_DATASET: Partial<Record<string, string>> = {
  ale_a: 'ale16_06',
  nhbic_ava: 'nhbic21_09',
  nhpmd_ann: 'nhpmd19_03',
}

export const CANUE_INVALID_NUMERIC_VALUES = new Set([-9999, -1111])

export const CANUE_EXACT_VARIABLE_LABELS: Record<string, string> = {
  pm25dal21_01: 'Annual mean PM2.5',
  lgtnlt13_01: 'Night-time light intensity',
  aqsmk22_01: 'Smoke PM2.5 mean',
  aqsmk22_02: 'Smoke PM2.5 median',
  aqsmk22_03: 'Smoke PM2.5 minimum',
  aqsmk22_04: 'Smoke PM2.5 maximum',
  aqsmk22_05: 'Smoke PM2.5 standard deviation',
}

export const CANUE_SUFFIX_LABELS_BY_DATASET: Record<string, Record<string, string>> = {
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

export const BC_CENTER: [number, number] = [-124.6, 54.4]
export const CANUE_MONTHS = [
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

export const CANUE_MONTH_BY_VALUE: Map<number, (typeof CANUE_MONTHS)[number]> = new Map(
  CANUE_MONTHS.map((month) => [month.value, month]),
)
export const CANUE_MONTH_BY_KEY: Map<string, (typeof CANUE_MONTHS)[number]> = new Map(
  CANUE_MONTHS.map((month) => [month.key, month]),
)
export const CANUE_MONTH_PATTERN = /_(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)_\d{2}$/i
export const CANUE_ANNUAL_YEAR_PATTERN = /^(.*?)(\d{2})(_\d+)$/

export const CANUE_DATASET_SUFFIX_LABELS: Record<string, Record<string, string>> = {
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

export const CANUE_V2_DATASET_LABELS: Record<string, string> = {
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

export const CANUE_V2_PREFERRED_MEASURE_KEYS = ['aqfpm_01__pm25', 'aqsmk_01__aqsmk_01', 'pm25dale_a__pm25dal_01']

export const CANUE_TIMELINE_WINDOW_OPTIONS = [
  { value: 1, label: '1' },
  { value: 3, label: '3' },
  { value: 5, label: '5' },
  { value: -1, label: 'Cumul.' },
]

export function getCanueVariableLabel(file: CanueFile | null, variable: string): string {
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

  if (
    (file.datasetId === 'nhbld_ava' ||
      file.datasetId === 'nhfac_ava' ||
      file.datasetId === 'nhscn_ava' ||
      file.datasetId === 'nhtsp_ava') &&
    suffix
  ) {
    const buffers = ['100m', '250m', '300m', '500m', '750m', '1000m']
    const buffer = buffers[Number(suffix) - 1]
    if (file.datasetId === 'nhbld_ava' && buffer) return `Building density at ${buffer}`
    if (file.datasetId === 'nhscn_ava' && buffer) return `Intersections within ${buffer}`
    if (file.datasetId === 'nhtsp_ava' && buffer) return `Bus stops within ${buffer}`
    if (file.datasetId === 'nhfac_ava' && buffer) return `Facility richness at ${buffer}`
    if (file.datasetId === 'nhfac_ava' && Number(suffix) > 6)
      return `Facility density at ${buffers[Number(suffix) - 7]}`
  }

  const measure = suffix ? Number(suffix).toLocaleString(undefined, { minimumIntegerDigits: 2 }) : variable
  return `${file.label} measure ${measure}`
}

export function getDefaultCanueVariable(file: CanueFile): string | null {
  const preferred = CANUE_DEFAULT_VARIABLE_BY_DATASET[file.datasetId]
  if (preferred && file.variables.includes(preferred)) return preferred
  return getSelectableCanueVariables(file)[0] ?? null
}

export function getCanueVariableSuffix(variable: string | null): string | null {
  return variable?.match(/_(\d+)$/)?.[1] ?? null
}

export function getCanueDatasetSuffixLabel(dataset: string): string | null {
  const match = dataset.match(/^([a-z]+)_(\d+)$/i)
  if (!match) return null
  return CANUE_DATASET_SUFFIX_LABELS[match[1].toLowerCase()]?.[match[2]] ?? null
}

export function getCanueVariableFamily(variable: string): string {
  return variable.replace(CANUE_MONTH_PATTERN, '')
}

export function getSelectableCanueVariables(file: CanueFile): string[] {
  if (file.cadence !== 'monthly') return file.variables
  return Array.from(new Set(file.variables.map(getCanueVariableFamily)))
}

export function findCanueVariablesForFile(file: CanueFile, selectedVariable: string, month: number | null): string[] {
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

export function getCanuePeriodLabel(files: CanueFile[], mode: CanueYearMode, month: number | null): string {
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

export function getCanueV2VariableLabel(selection: CanueVariableSelection | null): string {
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
  return variable.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function resolveCanueV2AssetUrl(path: string | null | undefined): string | null {
  if (!path) return null
  try {
    return new URL(path, CANUE_V2_CATALOG_URL).href
  } catch {
    return null
  }
}

export function cleanCanueV2DatasetName(name: string): string {
  return name
    .replace(/\s+v\d+\)/gi, ')')
    .replace(/\s+v\d+\b/gi, '')
    .replace(/\bPM2\.5\b/g, 'PM2.5')
    .replace(/\s+/g, ' ')
    .trim()
}

export function humanizeCanueDatasetCode(dataset: string): string {
  return dataset.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export function firstMetadataValue(values: string[] | undefined): string | null {
  return values?.find((value) => value.trim())?.trim() ?? null
}

export function getCanueV2DatasetLabel(
  dataset: string,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  if (CANUE_V2_DATASET_LABELS[dataset]) return CANUE_V2_DATASET_LABELS[dataset]
  const metadata = metadataLookup?.datasets?.[dataset]
  const label =
    firstMetadataValue(metadata?.metadata?.portalNames) ??
    firstMetadataValue(metadata?.metadata?.downloadNames) ??
    metadata?.label ??
    humanizeCanueDatasetCode(dataset)
  return cleanCanueV2DatasetName(label)
}

export function getCanueV2DatasetTitle(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  const metadata = metadataLookup?.datasets?.[selection.dataset]?.metadata
  const parts = [
    `CANUE code: ${selection.dataset}`,
    firstMetadataValue(metadata?.shortCodes) ? `Source code: ${firstMetadataValue(metadata?.shortCodes)}` : null,
    firstMetadataValue(metadata?.samplingFrequency)
      ? `Frequency: ${firstMetadataValue(metadata?.samplingFrequency)}`
      : null,
    firstMetadataValue(metadata?.yearCoverage) ? `Coverage: ${firstMetadataValue(metadata?.yearCoverage)}` : null,
    `Grid property: ${selection.property}`,
  ]
  return parts.filter(Boolean).join(' | ')
}

export function getCanueV2DatasetHelp(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
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
  if (
    selection.dataset.startsWith('grlan') ||
    selection.dataset.startsWith('grmod') ||
    selection.dataset === 'gravh_amn' ||
    selection.dataset === 'grtcc_ava'
  ) {
    return 'Greenness variables differ by vegetation source, season, summary statistic, and buffer distance around the postal/grid location.'
  }
  return description ? description.replace(/\s+/g, ' ').trim() : getCanueV2DatasetTitle(selection, metadataLookup)
}

export function getCanueV2GraphVariableLabel(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  const datasetLabel = getCanueV2DatasetLabel(selection.dataset, metadataLookup)
  const variableLabel = getCanueV2VariableLabel(selection)
  const baseLabel = normalizedCanueLabelToken(datasetLabel).includes(normalizedCanueLabelToken(variableLabel))
    ? datasetLabel
    : `${datasetLabel} - ${variableLabel}`
  const monthKey = getCanueV2MonthKey(selection.variable)
  const monthLabel = monthKey ? (CANUE_MONTH_BY_KEY.get(monthKey)?.label ?? monthKey.toUpperCase()) : null
  return monthLabel ? `${baseLabel} - ${monthLabel}` : baseLabel
}

export function normalizedCanueLabelToken(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function formatCanueDisplayLabel(label: string): string {
  return label
}

export function renderCanueDisplayLabel(label: string): ReactNode {
  return label.split(/\b(PM2\.5|NO2|SO2|CO2|O3|NH3|m3|cm2)\b/gi).map((part, index) => {
    const normalized = part.toLowerCase()
    if (normalized === 'pm2.5')
      return (
        <span key={index}>
          PM<sub>2.5</sub>
        </span>
      )
    if (normalized === 'no2')
      return (
        <span key={index}>
          NO<sub>2</sub>
        </span>
      )
    if (normalized === 'so2')
      return (
        <span key={index}>
          SO<sub>2</sub>
        </span>
      )
    if (normalized === 'co2')
      return (
        <span key={index}>
          CO<sub>2</sub>
        </span>
      )
    if (normalized === 'o3')
      return (
        <span key={index}>
          O<sub>3</sub>
        </span>
      )
    if (normalized === 'nh3')
      return (
        <span key={index}>
          NH<sub>3</sub>
        </span>
      )
    if (normalized === 'm3')
      return (
        <span key={index}>
          m<sup>3</sup>
        </span>
      )
    if (normalized === 'cm2')
      return (
        <span key={index}>
          cm<sup>2</sup>
        </span>
      )
    return part
  })
}

export function CanueHelpIcon({ label, help }: { label: string; help: string | null | undefined }) {
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

export function getCanueV2MonthKey(variable: string): string | null {
  return variable.match(CANUE_MONTH_PATTERN)?.[1]?.toLowerCase() ?? null
}

export function getCanueV2SelectionDate(selection: CanueVariableSelection): Date {
  const month = getCanueV2MonthKey(selection.variable)
  return new Date(selection.year, month ? (CANUE_MONTH_BY_KEY.get(month)?.value ?? 1) - 1 : 0, 1)
}

export function getCanueV2TimelineKey(selection: CanueVariableSelection, monthly: boolean): string {
  if (!monthly) return String(selection.year)
  const month = getCanueV2MonthKey(selection.variable)
  const monthIndex = month ? (CANUE_MONTH_BY_KEY.get(month)?.value ?? 1) - 1 : 0
  return `${selection.year}-${String(monthIndex).padStart(2, '0')}`
}

export function getCanueV2Cadence(selection: CanueVariableSelection): CanueV2Cadence {
  return getCanueV2MonthKey(selection.variable) ? 'monthly' : 'annual'
}

export function getCanueV2MeasureVariable(variable: string): string {
  return variable.replace(CANUE_MONTH_PATTERN, '').replace(CANUE_ANNUAL_YEAR_PATTERN, '$1$3')
}

export function getCanueV2MeasureKey(selection: Pick<CanueVariableSelection, 'dataset' | 'variable'>): string {
  return `${selection.dataset}__${getCanueV2MeasureVariable(selection.variable)}`
}

export function stripCanueV2DatasetVersion(label: string): string {
  return label
    .replace(/\s+\(?v\d+\)?\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getCanueV2GridVariableLabel(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  return stripCanueV2DatasetVersion(getCanueV2DatasetLabel(selection.dataset, metadataLookup))
    .replace(/^(annual|monthly|daily|yearly)\s+/i, '')
    .trim()
}

export function getCanueV2GridVariableKey(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
  return normalizedCanueLabelToken(getCanueV2GridVariableLabel(selection, metadataLookup))
}

export function getCanueV2VariableOptionLabel(
  selection: CanueVariableSelection,
  metadataLookup: CanueV2MetadataLookup | null | undefined,
): string {
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
  const inferredMeanLabel =
    !measureLabel && getCanueVariableSuffix(getCanueV2MeasureVariable(selection.variable)) === '01' ? 'mean' : null
  const normalizedMeasure =
    inferredMeanLabel ??
    (measureLabel && normalizedCanueLabelToken(measureLabel) !== normalizedCanueLabelToken(gridVariableLabel)
      ? measureLabel
      : null)

  return [datasetVersion, normalizedMeasure ?? variableLabel].filter(Boolean).join(' - ')
}

export function getPreferredCanueV2MeasureKey(options: Array<{ value: string }>): string | null {
  return (
    CANUE_V2_PREFERRED_MEASURE_KEYS.find((key) => options.some((option) => option.value === key)) ??
    options.find((option) => option.value.includes('pm25'))?.value ??
    options[0]?.value ??
    null
  )
}

export function getPreferredCanueV2Selection(selections: CanueVariableSelection[]): CanueVariableSelection | null {
  const preferredKey = getPreferredCanueV2MeasureKey(
    selections.map((selection) => ({ value: getCanueV2MeasureKey(selection) })),
  )
  return preferredKey
    ? (selections.find((selection) => getCanueV2MeasureKey(selection) === preferredKey) ?? null)
    : (selections[0] ?? null)
}

export function canueV2Paint(selection: CanueVariableSelection | null) {
  if (!selection) return '#e5e7eb'
  const low = selection.min ?? 0
  const high = selection.max != null && selection.max !== low ? selection.max : low + 1
  const mid = low + (high - low) / 2

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

export function canueBoundaryPaint(property: string, minValue: number | null, maxValue: number | null) {
  const low = minValue ?? 0
  const high = maxValue != null && maxValue !== low ? maxValue : low + 1
  const mid = low + (high - low) / 2

  return [
    'case',
    ['!', ['has', property]],
    '#e5e7eb',
    ['==', ['get', property], null],
    '#e5e7eb',
    ['interpolate', ['linear'], ['to-number', ['get', property]], low, '#67e8f9', mid, '#facc15', high, '#ef4444'],
  ]
}

export function splitCsvLine(line: string): string[] {
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

export function buildBoundaryIndex(
  boundaries: BoundaryFeatureCollection,
  config: BoundaryLevelConfig,
): BoundaryIndexEntry[] {
  return boundaries.features
    .filter((feature) => feature.geometry)
    .map((feature, index) => ({
      feature,
      bbox: [0, 0, 0, 0],
      id: String(feature.properties?.[config.idField] ?? feature.id ?? index),
      name: String(feature.properties?.[config.nameField] ?? feature.properties?.name ?? feature.id ?? index),
    }))
}

export async function fetchGzipText(path: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(path, { signal })
  if (!response.ok) throw new Error(`Failed to fetch ${path}: ${response.status}`)

  const DecompressionStreamCtor = (
    globalThis as typeof globalThis & {
      DecompressionStream?: new (format: 'gzip') => TransformStream<Uint8Array, Uint8Array>
    }
  ).DecompressionStream

  if (
    response.headers.get('content-encoding') === 'gzip' ||
    !path.endsWith('.gz') ||
    !response.body ||
    !DecompressionStreamCtor
  ) {
    return response.text()
  }

  const stream = response.body.pipeThrough(new DecompressionStreamCtor('gzip'))
  return new Response(stream).text()
}

export function useCanueBoundaryData(
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
        const buckets = new Map(
          boundaryIndex.map((boundary) => [
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
          ]),
        )
        const membershipByPostalCode = new Map(
          activeMembership.records.map((record) => [record.postalcode, record.boundaries[activeBoundaryLevel] ?? '']),
        )
        let matchedRowCount = 0

        for (const activeFile of activeFiles) {
          const fileVariables = findCanueVariablesForFile(
            activeFile,
            activeVariable,
            activeFile.cadence === 'monthly' && yearMode === 'month' ? activeMonth : null,
          )
          if (!fileVariables.length)
            throw new Error(`${activeFile.label} ${activeFile.year} is missing ${activeVariable}`)

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
            const boundaryId = membershipByPostalCode.get(
              String(values[postalIndex] || '')
                .replace(/\s+/g, '')
                .toUpperCase(),
            )
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
            ? Array.from(bucket.years.values())
                .filter((yearBucket) => yearBucket.count > 0)
                .map((yearBucket) => yearBucket.sum / yearBucket.count)
            : []
          const value =
            bucket && bucket.count > 0
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
