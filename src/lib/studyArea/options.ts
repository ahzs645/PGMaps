import type {
  BoundaryIndex,
  BoundaryLevel,
  BoundarySource,
  CensusBoundaryLevel,
  CityBoundaryLevel,
  RegionLevel,
  RegionalDistrictBoundaryLevel,
  WatershedBoundaryLevel,
} from '@/maps/airquality/types'

export interface BoundarySourceOption {
  value: BoundarySource
  label: string
  description: string
}

export interface BoundaryLevelOption<T extends RegionLevel = RegionLevel> {
  value: T
  label: string
}

export const BOUNDARY_SOURCE_OPTIONS: BoundarySourceOption[] = [
  {
    value: 'bcHealth',
    label: 'CHSA health boundaries',
    description: 'Community Health Service Areas',
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
    value: 'cityPG',
    label: 'School catchments',
    description: 'Elementary and secondary catchments',
  },
  {
    value: 'watershed',
    label: 'Watershed boundaries',
    description: 'BC Freshwater Atlas hierarchy',
  },
]

export const HEALTH_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<BoundaryLevel>[] = [
  { value: 'healthAuthority', label: 'Health Authority' },
  { value: 'hsda', label: 'HSDA' },
  { value: 'lha', label: 'LHA' },
  { value: 'chsa', label: 'CHSA' },
]

export const REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<RegionalDistrictBoundaryLevel>[] = [
  { value: 'regionalDistrict', label: 'Regional District' },
]

export const CENSUS_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<CensusBoundaryLevel>[] = [
  { value: 'ct', label: 'Census Tract' },
  { value: 'da', label: 'Dissemination Area' },
]

export const CITY_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<CityBoundaryLevel>[] = [
  { value: 'elementarySchoolCatchment', label: 'Elementary School Catchment' },
  { value: 'secondarySchoolCatchment', label: 'Secondary School Catchment' },
]

export const WATERSHED_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<WatershedBoundaryLevel>[] = [
  { value: 'majorWatershed', label: 'Major River Basin' },
  { value: 'watershedGroup', label: 'Watershed Group' },
  { value: 'assessmentWatershed', label: 'Assessment Watershed' },
]

export function getLevelOptionsForSource(source: BoundarySource): BoundaryLevelOption[] {
  switch (source) {
    case 'bcHealth':
      return HEALTH_BOUNDARY_LEVEL_OPTIONS
    case 'regionalDistrict':
      return REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS
    case 'census':
      return CENSUS_BOUNDARY_LEVEL_OPTIONS
    case 'cityPG':
      return CITY_BOUNDARY_LEVEL_OPTIONS
    case 'watershed':
      return WATERSHED_BOUNDARY_LEVEL_OPTIONS
  }
}

export function getDefaultLevelForSource(source: BoundarySource): RegionLevel {
  return getLevelOptionsForSource(source)[0].value
}

export function isValidLevelForSource(source: BoundarySource, level: RegionLevel): boolean {
  return getLevelOptionsForSource(source).some((option) => option.value === level)
}

// Loader-internal constants for the BC Ministry of Health boundary index
export const BOUNDARY_FILE_BY_LEVEL: Record<BoundaryLevel, string> = {
  healthAuthority: 'simplified/health_authorities.json',
  hsda: 'simplified/health_service_delivery_areas.json',
  lha: 'simplified/local_health_areas.json',
  chsa: 'simplified/community_health_service_areas.json',
}

export const BOUNDARY_INDEX_KEY_BY_LEVEL: Record<BoundaryLevel, keyof BoundaryIndex> = {
  healthAuthority: 'healthAuthorities',
  hsda: 'healthServiceDeliveryAreas',
  lha: 'localHealthAreas',
  chsa: 'communityHealthServiceAreas',
}

export const BOUNDARY_CODE_PROPERTY_BY_LEVEL: Record<BoundaryLevel, string> = {
  healthAuthority: 'HLTH_AUTHORITY_CODE',
  hsda: 'HLTH_SERVICE_DLVR_AREA_CODE',
  lha: 'LOCAL_HLTH_AREA_CODE',
  chsa: 'CMNTY_HLTH_SERV_AREA_CODE',
}

export const BOUNDARY_NAME_PROPERTY_BY_LEVEL: Record<BoundaryLevel, string> = {
  healthAuthority: 'HLTH_AUTHORITY_NAME',
  hsda: 'HLTH_SERVICE_DLVR_AREA_NAME',
  lha: 'LOCAL_HLTH_AREA_NAME',
  chsa: 'CMNTY_HLTH_SERV_AREA_NAME',
}
