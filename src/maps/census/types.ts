export type CensusMetricKey =
  | 'population'
  | 'populationDensity'
  | 'households'
  | 'dwellings'
  | 'areaSqKm'

export type CensusHierarchyLevel = 'da' | 'rpid' | 'rgid' | 'ruid' | 'rguid'

export interface CensusArea {
  id: string
  name: string
  type: string
  rpid: string | null
  rgid: string | null
  ruid: string | null
  rguid: string | null
  population: number | null
  populationDensity: number | null
  households: number | null
  dwellings: number | null
  areaSqKm: number | null
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon
}

export interface CensusUnit {
  id: string
  level: CensusHierarchyLevel
  name: string
  daCount: number
  population: number | null
  populationDensity: number | null
  households: number | null
  dwellings: number | null
  areaSqKm: number | null
}

export interface CensusMetricOption {
  key: CensusMetricKey
  label: string
  format: 'int' | 'decimal'
}

export interface CensusHierarchyOption {
  key: CensusHierarchyLevel
  label: string
}
