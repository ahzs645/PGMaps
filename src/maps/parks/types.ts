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

export interface CityPgOverlayData {
  parkAssets: GeoJSON.FeatureCollection<GeoJSON.Point>
  parkLines: GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>
  parkAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  mobilityLines: GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>
  mobilityPoints: GeoJSON.FeatureCollection<GeoJSON.Point>
  ecologyAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  communityAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  civicAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  serviceLines: GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>
  serviceAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
  planningLines: GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString>
  planningPoints: GeoJSON.FeatureCollection<GeoJSON.Point>
  planningAreas: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon>
}

export interface CityPgOverlaySummary {
  parkAssets: number
  parkLines: number
  parkAreas: number
  mobility: number
  ecology: number
  community: number
  services: number
  planning: number
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

export type ActiveLayer =
  | 'parks'
  | 'trails'
  | 'amenities'
  | 'parkAssets'
  | 'mobility'
  | 'ecology'
  | 'community'
  | 'services'
  | 'planning'
