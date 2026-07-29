import type {
  BoundaryIndex,
  BoundaryLevel,
  BoundarySource,
  BcRfcBoundaryLevel,
  CensusBoundaryLevel,
  CommunityBoundaryLevel,
  CityBoundaryLevel,
  CrownTenureBoundaryLevel,
  DrainageBoundaryLevel,
  FireZoneBoundaryLevel,
  MineralTenureBoundaryLevel,
  MunicipalityBoundaryLevel,
  NrAdminBoundaryLevel,
  RangeTenureBoundaryLevel,
  RegionLevel,
  RegionalDistrictBoundaryLevel,
  UwrBoundaryLevel,
  WalkabilityCommunityBoundaryLevel,
  WatershedBoundaryLevel,
} from '@/maps/airquality/types'
import type { StudyAreaLevelOption, StudyAreaSourceOption } from './types'

export type BoundarySourceOption = StudyAreaSourceOption<BoundarySource>

export type StudyAreaLevelWithDb = RegionLevel | 'db'
export type BoundaryLevelOption<T extends string = RegionLevel> = StudyAreaLevelOption<T>

export const BOUNDARY_SOURCE_OPTIONS: BoundarySourceOption[] = [
  {
    value: 'cityCommunity',
    label: 'Community polygons',
    description: 'CityPG community / neighbourhood boundaries',
    group: 'Local',
  },
  {
    value: 'cityPG',
    label: 'School catchments',
    description: 'Elementary and secondary catchments',
    group: 'Local',
  },
  {
    value: 'bcHealth',
    label: 'Health boundaries',
    description: 'Health Authority -> CHSA hierarchy',
    group: 'Administrative',
  },
  {
    value: 'regionalDistrict',
    label: 'Regional district',
    description: 'Large local-government region - Fraser-Fort George, Cariboo RD, Bulkley-Nechako RD',
    group: 'Administrative',
  },
  {
    value: 'bcMunicipality',
    label: 'Municipalities',
    description: 'Legally defined BC municipality boundaries',
    group: 'Administrative',
  },
  {
    value: 'census',
    label: 'Census boundaries',
    description: 'Census hierarchy plus national North/South CSDs',
    group: 'Administrative',
  },
  {
    value: 'watershed',
    label: 'Watershed boundaries',
    description: 'BC Freshwater Atlas hierarchy',
    group: 'Natural / resource',
  },
  {
    value: 'bcDrainage',
    label: 'BC drainage basins',
    description: 'BC drainage basin and ocean-drainage-area boundaries',
    group: 'Natural / resource',
  },
  {
    value: 'bcWildfire',
    label: 'BC fire zones',
    description: 'BC Wildfire Service fire-zone boundaries',
    group: 'Natural / resource',
  },
  {
    value: 'bcRfc',
    label: 'BC RFC basins',
    description: 'BC River Forecast Centre snow-basin polygons',
    group: 'Natural / resource',
  },
  {
    value: 'nrAdmin',
    label: 'Natural Resource admin',
    description: 'BC NR Areas, Regions, and Districts',
    group: 'Natural / resource',
  },
  // crownTenure / rangeTenure / mineralTenure are intentionally hidden from
  // the sidebar: at PG-region scale they return 6k-8k polygons each (~7MB
  // geojson), which the client-side fetch + render pipeline can't handle
  // without crashing. Sync scripts, types, and loader entries are kept so the
  // sources can be re-enabled once vector tiles or server-side filtering
  // exists. To bring one back, add its entry here.
]

export const STUDY_AREA_LEVEL_LABELS: Record<StudyAreaLevelWithDb, string> = {
  healthAuthority: 'Health Authority',
  hsda: 'HSDA',
  lha: 'LHA',
  chsa: 'CHSA',
  regionalDistrict: 'Regional District',
  municipality: 'Municipality',
  cd: 'Census Division',
  csd: 'Census Subdivision',
  northSouthCsd: 'North / South CSDs',
  ct: 'Census Tract',
  da: 'Dissemination Area',
  bcDaSimplified: 'BC-wide DA chunks',
  db: 'Dissemination Block',
  communityPolygon: 'Community polygons',
  elementarySchoolCatchment: 'Elementary School Catchment',
  secondarySchoolCatchment: 'Secondary School Catchment',
  majorWatershed: 'Major River Basin',
  watershedGroup: 'Watershed Group',
  assessmentWatershed: 'Assessment Watershed',
  oceanDrainageArea: 'Ocean Drainage Area',
  drainageRegion: 'Drainage Region',
  fireCentre: 'Fire Centre',
  fireZone: 'Fire Zone',
  rfcSnowBasin: 'RFC Snow Basin',
  nrArea: 'NR Area',
  nrRegion: 'NR Region',
  nrDistrict: 'NR District',
  ungulateWinterRange: 'Ungulate Winter Range',
  crownTenure: 'Crown Tenure',
  rangeTenurePolygon: 'Range Tenure',
  rangePasture: 'Range Pasture',
  mineralTenure: 'Mineral / Placer / Coal Tenure',
  walkabilityCommunity: 'PG Community',
}

export function getStudyAreaLevelLabel(level: string): string {
  return STUDY_AREA_LEVEL_LABELS[level as StudyAreaLevelWithDb] ?? level
}

export function createStudyAreaLevelOptions<TLevel extends string>(
  levels: readonly TLevel[],
): Array<StudyAreaLevelOption<TLevel>> {
  return levels.map((value) => ({
    value,
    label: getStudyAreaLevelLabel(value),
  }))
}

export const HEALTH_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<BoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['healthAuthority', 'hsda', 'lha', 'chsa'] as const),
]

export const REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<RegionalDistrictBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['regionalDistrict'] as const),
]

export const MUNICIPALITY_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<MunicipalityBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['municipality'] as const),
]

export const CENSUS_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<CensusBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['cd', 'csd', 'northSouthCsd', 'ct', 'da', 'db'] as const),
]

export const COMMUNITY_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<CommunityBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['communityPolygon'] as const),
]

export const CITY_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<CityBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['elementarySchoolCatchment', 'secondarySchoolCatchment'] as const),
]

export const WATERSHED_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<WatershedBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['majorWatershed', 'watershedGroup', 'assessmentWatershed'] as const),
]

export const DRAINAGE_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<DrainageBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['oceanDrainageArea', 'drainageRegion'] as const),
]

export const FIRE_ZONE_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<FireZoneBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['fireCentre', 'fireZone'] as const),
]

export const BC_RFC_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<BcRfcBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['rfcSnowBasin'] as const),
]

export const NR_ADMIN_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<NrAdminBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['nrArea', 'nrRegion', 'nrDistrict'] as const),
]

export const UWR_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<UwrBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['ungulateWinterRange'] as const),
]

export const CROWN_TENURE_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<CrownTenureBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['crownTenure'] as const),
]

export const RANGE_TENURE_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<RangeTenureBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['rangeTenurePolygon', 'rangePasture'] as const),
]

export const MINERAL_TENURE_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<MineralTenureBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['mineralTenure'] as const),
]

export const WALKABILITY_COMMUNITY_BOUNDARY_LEVEL_OPTIONS: BoundaryLevelOption<WalkabilityCommunityBoundaryLevel>[] = [
  ...createStudyAreaLevelOptions(['walkabilityCommunity'] as const),
]

export function getLevelOptionsForSource(source: BoundarySource): BoundaryLevelOption[] {
  switch (source) {
    case 'bcHealth':
      return HEALTH_BOUNDARY_LEVEL_OPTIONS
    case 'regionalDistrict':
      return REGIONAL_DISTRICT_BOUNDARY_LEVEL_OPTIONS
    case 'bcMunicipality':
      return MUNICIPALITY_BOUNDARY_LEVEL_OPTIONS
    case 'census':
      return CENSUS_BOUNDARY_LEVEL_OPTIONS
    case 'cityCommunity':
      return COMMUNITY_BOUNDARY_LEVEL_OPTIONS
    case 'cityPG':
      return CITY_BOUNDARY_LEVEL_OPTIONS
    case 'watershed':
      return WATERSHED_BOUNDARY_LEVEL_OPTIONS
    case 'bcDrainage':
      return DRAINAGE_BOUNDARY_LEVEL_OPTIONS
    case 'bcWildfire':
      return FIRE_ZONE_BOUNDARY_LEVEL_OPTIONS
    case 'bcRfc':
      return BC_RFC_BOUNDARY_LEVEL_OPTIONS
    case 'nrAdmin':
      return NR_ADMIN_BOUNDARY_LEVEL_OPTIONS
    case 'uwr':
      return UWR_BOUNDARY_LEVEL_OPTIONS
    case 'crownTenure':
      return CROWN_TENURE_BOUNDARY_LEVEL_OPTIONS
    case 'rangeTenure':
      return RANGE_TENURE_BOUNDARY_LEVEL_OPTIONS
    case 'mineralTenure':
      return MINERAL_TENURE_BOUNDARY_LEVEL_OPTIONS
    case 'walkabilityCommunity':
      return WALKABILITY_COMMUNITY_BOUNDARY_LEVEL_OPTIONS
  }
}

export function getDefaultLevelForSource(source: BoundarySource): RegionLevel {
  // The default is the top of each source's hierarchy (the coarsest level),
  // which is the first entry in every level list — including census, whose
  // top level is the Census Division.
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
