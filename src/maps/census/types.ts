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

// Census variable types for the full variable data

export interface CensusVariable {
  id: string
  label: string
  type: 'Total' | 'Male' | 'Female' | ''
}

export interface CensusCategory {
  id: string
  name: string
  group: string
  variableCount: number
  variables: CensusVariable[]
}

export interface CensusCatalog {
  totalVariables: number
  categories: CensusCategory[]
  levels: string[]
}

/** Compact data for a single category at a single level. */
export interface CensusCategoryData {
  vectors: string[]
  data: Record<string, (number | null)[]>
}

/** Active variable selection for the choropleth. */
export interface CensusVariableSelection {
  categoryId: string
  variableId: string
}
