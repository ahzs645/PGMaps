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
  longitude: number
  latitude: number
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
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

export type BoundaryLevel = 'none' | 'ct' | 'da' | 'db'
