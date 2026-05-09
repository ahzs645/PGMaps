export type {
  BoundaryIndex,
  BoundaryLevel,
  BoundaryRegionRecord,
  BoundarySource,
  CensusBoundaryLevel,
  CityBoundaryLevel,
  RegionLevel,
  RegionalDistrictBoundaryLevel,
  SelectedBoundaryRegion,
  WatershedBoundaryLevel,
} from '@/maps/airquality/types'

import type {
  BoundarySource,
  RegionLevel,
} from '@/maps/airquality/types'

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
