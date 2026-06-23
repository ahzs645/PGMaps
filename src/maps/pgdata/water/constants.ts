import type { StudyAreaLevelOption, StudyAreaSourceOption } from '@/components/StudyAreaSelector'
import type { TimelineWindowOption } from '@/components/ui/timeline'
import type {
  BoundaryLevelConfig,
  WaterBoundaryLevel,
  WaterBoundaryMetric,
  WaterBoundarySource,
  WaterPointCategory,
} from './types'

export const WATER_TIMELINE_WINDOW_OPTIONS: TimelineWindowOption[] = [
  { value: 1, label: '1 mo' },
  { value: 12, label: '1 yr' },
  { value: 60, label: '5 yr' },
  { value: -1, label: 'Cumul.' },
]

export const WATER_ROOT = '/data/water'

export const WATER_POINT_COLORS: Record<WaterPointCategory, string> = {
  facility: '#2563eb',
  samples: '#0891b2',
  notice: '#dc2626',
}

export const WATER_POINT_CATEGORIES: WaterPointCategory[] = ['facility', 'samples', 'notice']

export const WATER_HAZARD_DOT_COLORS: Record<string, string> = {
  Low: '#22c55e',
  Moderate: '#f59e0b',
  High: '#dc2626',
  Unknown: '#6b7280',
  'Boil Water Notice': '#dc2626',
  'Water Quality Advisory': '#f97316',
}

export const WATER_BOUNDARY_METRIC_OPTIONS: Array<{ value: WaterBoundaryMetric; label: string }> = [
  { value: 'avgSamplesPerFacility', label: 'Avg sample rows / facility' },
  { value: 'sampleRows', label: 'Sample rows' },
  { value: 'facilities', label: 'Facilities' },
  { value: 'activeNotices', label: 'Active notices' },
]

export const WATER_HAZARD_COLORS: Record<string, string> = {
  Low: 'bg-green-500',
  Moderate: 'bg-amber-500',
  High: 'bg-red-600',
  Unknown: 'bg-gray-500',
}

export const WATER_DATE_MIN_YEAR = 1900
export const WATER_DATE_MAX_YEAR = new Date().getFullYear() + 1
export const WATER_MONTH_INDEX: Record<string, number> = {
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

export const WATER_SOURCE_OPTIONS: Array<StudyAreaSourceOption<WaterBoundarySource>> = [
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

export const WATER_HEALTH_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'healthAuthority', label: 'Health Authority' },
  { value: 'hsda', label: 'Health Service Delivery Area' },
  { value: 'lha', label: 'Local Health Area' },
  { value: 'chsa', label: 'Community Health Service Area' },
]

export const WATER_CENSUS_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'cd', label: 'Census Division' },
  { value: 'ct', label: 'Census Tract' },
  { value: 'da', label: 'Dissemination Area' },
]

export const WATER_REGIONAL_DISTRICT_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'regionalDistrict', label: 'Regional District' },
]

export const WATER_WATERSHED_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'majorWatershed', label: 'Major Watershed' },
  { value: 'watershedGroup', label: 'Watershed Group' },
  { value: 'assessmentWatershed', label: 'Assessment Watershed' },
]

export const WATER_NR_ADMIN_LEVEL_OPTIONS: Array<StudyAreaLevelOption<WaterBoundaryLevel>> = [
  { value: 'nrArea', label: 'NR Area' },
  { value: 'nrRegion', label: 'NR Region' },
  { value: 'nrDistrict', label: 'NR District' },
]

export const WATER_BOUNDARY_CONFIG: Record<WaterBoundaryLevel, BoundaryLevelConfig> = {
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
