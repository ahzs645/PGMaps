export type WaterBoundarySource = 'bcHealth' | 'regionalDistrict' | 'census' | 'watershed' | 'nrAdmin'
export type WaterBoundaryLevel =
  | 'healthAuthority'
  | 'hsda'
  | 'lha'
  | 'chsa'
  | 'regionalDistrict'
  | 'cd'
  | 'csd'
  | 'ct'
  | 'da'
  | 'majorWatershed'
  | 'watershedGroup'
  | 'assessmentWatershed'
  | 'nrArea'
  | 'nrRegion'
  | 'nrDistrict'
export type WaterLayerMode = 'facilities' | 'samples' | 'notices'
export type WaterBoundaryMetric = 'facilities' | 'sampleRows' | 'avgSamplesPerFacility' | 'activeNotices'
export type WaterPointCategory = 'facility' | 'samples' | 'notice'
export type WaterSampleKindFilter = 'all' | WaterSampleRow['kind']

export type BoundaryFeatureCollection = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>

export interface BoundaryLevelConfig {
  path: string
  idField: string
  nameField: string
}

export interface WaterFacility {
  id: string
  name: string
  operator: string
  type: string
  status: string
  hazardRating: string
  address: string
  community: string
  latitude: number | null
  longitude: number | null
  bacteriologicalSamples: number
  chemicalResults: number
  activeNotices: number
  lastSampleDate: Date | null
  geocodedAddress?: string
  geocodePartialMatch?: boolean
  noticeOnly?: boolean
  noticeIds?: string[]
  primarySource?: string
  mergeBucket?: string
  sourceCount?: number
  source: Record<string, unknown>
}

export interface WaterSampleRow {
  id: string
  facilityId: string
  facilityName: string
  kind: 'bacteriological' | 'chemical'
  date: Date | null
  parameter: string
  result: string
  source: Record<string, unknown>
}

export interface WaterNoticeRow {
  id: string
  facilityId: string
  facilityName: string
  type: string
  status: string
  date: Date | null
  latitude: number | null
  longitude: number | null
  locationSummary: string
  primarySource: string
  mergeBucket: string
  sourceCount: number
  source: Record<string, unknown>
}

export interface WaterManifest {
  generatedAt?: string
  files?: Array<{ file?: string; path?: string; rows?: number; records?: number; size?: string }>
  source?: string
  sourcePage?: string
  sourceLicense?: string
}

export interface CombinedWaterNoticesSummary {
  combined_count?: number
  healthspace_count?: number
  watertoday_count?: number
  with_coordinates?: number
  with_multiple_sources?: number
  record_type_counts?: Record<string, number>
  merge_bucket_counts?: Record<string, number>
  primary_source_counts?: Record<string, number>
}

export interface GeocodedLocation {
  dataset: string
  source_index: number
  source_name?: string
  source_details_url?: string
  latitude: number
  longitude: number
  google_geocoded_address?: string
  google_partial_match?: boolean
}

export interface GeocodedLocationsFile {
  summary?: unknown
  locations?: GeocodedLocation[]
}

export type WaterFacilityFeatureProperties = Record<string, unknown> & {
  id: string
  name: string
  category: WaterPointCategory
  hazardRating: string
  pointColor: string
}

export type WaterBoundaryAggregateProperties = Record<string, unknown> & {
  boundaryId: string
  boundaryName: string
  facilityCount: number
  sampleRows: number
  avgSamplesPerFacility: number
  activeNotices: number
  metricValue: number
}
