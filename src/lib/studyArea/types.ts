export type {
  BoundaryIndex,
  BoundaryLevel,
  BoundaryRegionRecord,
  BoundarySource,
  CensusBoundaryLevel,
  CommunityBoundaryLevel,
  CityBoundaryLevel,
  CrownTenureBoundaryLevel,
  MineralTenureBoundaryLevel,
  NrAdminBoundaryLevel,
  RangeTenureBoundaryLevel,
  RegionLevel,
  RegionalDistrictBoundaryLevel,
  SelectedBoundaryRegion,
  UwrBoundaryLevel,
  WalkabilityCommunityBoundaryLevel,
  WatershedBoundaryLevel,
} from '@/maps/airquality/types'

import type {
  BoundarySource,
  RegionLevel,
} from '@/maps/airquality/types'

export interface StudyAreaSourceOption<TSource extends string = string> {
  value: TSource
  label: string
  description: string
  group?: string
  disabled?: boolean
  disabledReason?: string
}

export interface StudyAreaLevelOption<TLevel extends string = string> {
  value: TLevel
  label: string
}

export interface StudyAreaRegion {
  id: string
  code: string
  name: string
  source: BoundarySource
  level: RegionLevel
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  bounds: [number, number, number, number]
  areaKm2: number
}
