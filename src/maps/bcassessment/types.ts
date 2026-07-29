import type {
  BoundaryLevel as HealthBoundaryLevel,
  CityBoundaryLevel,
  RegionalDistrictBoundaryLevel,
  WatershedBoundaryLevel,
} from '@/lib/studyArea'

// BC Assessment property data is only spatially joined against the boundary
// systems that existed before the BC GIS overlays were added. The newer
// nrAdmin / uwr / crownTenure / rangeTenure / mineralTenure sources do not
// have aggregate data and are excluded here.
export type AssessmentBoundaryLevel =
  | HealthBoundaryLevel
  | RegionalDistrictBoundaryLevel
  | 'ct'
  | 'da'
  | 'db'
  | CityBoundaryLevel
  | Exclude<WatershedBoundaryLevel, 'namedWatershed'>
export type AssessmentBoundarySelection = AssessmentBoundaryLevel | 'none'
export type AssessmentBoundarySource =
  | 'bcHealth'
  | 'regionalDistrict'
  | 'census'
  | 'cityPG'
  | 'watershed'

export interface Property {
  id: string
  address: string
  roll: string
  description: string
  category: PropertyCategory
  totalAssessed: number
  totalLand: number
  totalBuilding: number
  yearBuilt: number | null
  bedrooms: number | null
  bathrooms: number | null
  landSize: string | null
  totalFinishedArea: number | null
  pid: string | null
  salePrice: number | null
  saleDate: string | null
  histValues: number[] | null
  /** Census boundary IDs (assigned via spatial join) */
  ct: string | null
  da: string | null
  db: string | null
  /** Study-area boundary IDs (assigned via spatial join) */
  healthAuthority: string | null
  hsda: string | null
  lha: string | null
  chsa: string | null
  regionalDistrict: string | null
  elementarySchoolCatchment: string | null
  secondarySchoolCatchment: string | null
  majorWatershed: string | null
  watershedGroup: string | null
  assessmentWatershed: string | null
  longitude: number
  latitude: number
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
}

export interface BoundaryAggregate {
  boundaryId: string
  boundaryName: string
  count: number
  avgAssessed: number
  avgLand: number
  avgBuilding: number
  avgYearBuilt: number | null
  categoryCounts: Partial<Record<PropertyCategory, number>>
  avgHistory: number[] | null
}

export type PropertyCategory =
  | 'residential'
  | 'multi-family'
  | 'commercial'
  | 'industrial'
  | 'institutional'
  | 'vacant'
  | 'farm'
  | 'other'

export type ColorMetric = 'totalAssessed' | 'totalLand' | 'totalBuilding' | 'yearBuilt'

export type BoundaryLevel = AssessmentBoundarySelection
