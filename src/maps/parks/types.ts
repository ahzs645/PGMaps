export interface Park {
  id: number
  name: string
  classification: ParkClassification | null
  subType: 'Park' | 'Open Space' | null
  developed: boolean
  area: number | null
  longitude: number
  latitude: number
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon
}

export interface Trail {
  id: number
  name: string
  parkName: string | null
  userClass: TrailUserClass | null
  surfaceClass: TrailSurfaceClass | null
  surfaceMaterial: string | null
  winterMaintenance: boolean
  length: number | null
  coordinates: [number, number][]
}

export interface ParkAmenity {
  id: number
  type: string | null
  location: string | null
  parkName: string | null
  longitude: number
  latitude: number
}

export type ParkClassification =
  | 'Athletic'
  | 'Community'
  | 'Downtown'
  | 'Green Space'
  | 'Major'
  | 'Nature'
  | 'Neighbourhood'
  | 'Public'
  | 'Special Purpose'

export type TrailUserClass =
  | 'Walking'
  | 'Multiuse'
  | 'Equine'

export type TrailSurfaceClass =
  | 'Hard Surface'
  | 'Soft Surface'
  | 'Granular'

export type ActiveLayer = 'parks' | 'trails' | 'amenities'
