export type CensusMetricKey =
  | 'daCount'
  | 'dbCount'
  | 'population'
  | 'populationDensity'
  | 'households'
  | 'dwellings'
  | 'areaSqKm'

export type CensusHierarchyLevel = 'cd' | 'csd' | 'ct' | 'da' | 'db'

export interface CensusUnit {
  id: string
  name: string
  level: CensusHierarchyLevel
  population: number | null
  populationDensity: number | null
  households: number | null
  dwellings: number | null
  areaSqKm: number | null
  daCount: number
  dbCount: number
  parentCdId: string | null
  parentCsdId: string | null
  parentCtId: string | null
  parentDaId: string | null
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon
}

export interface CensusBounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

export interface CensusMetricOption {
  key: CensusMetricKey
  label: string
  format: 'int' | 'decimal'
  levels: CensusHierarchyLevel[]
}

export interface CensusHierarchyOption {
  key: CensusHierarchyLevel
  label: string
}
