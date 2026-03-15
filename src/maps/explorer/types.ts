export type ExplorerGeometryType = 'point' | 'line' | 'polygon'

export type ExplorerDatasetId =
  | 'airMonitors'
  | 'restaurants'
  | 'parkAmenities'
  | 'trails'
  | 'parks'
  | 'censusDa'
  | 'censusCt'
  | 'censusCsd'

export interface GeometryBounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}

export interface ExplorerDetailRow {
  label: string
  value: string
}

export interface RelevanceBreakdown {
  label: string
  points: number
}

export interface ExplorerItem {
  id: string
  datasetId: ExplorerDatasetId
  geometryType: ExplorerGeometryType
  name: string
  subtitle: string
  relevance: number
  relevanceBreakdown: RelevanceBreakdown[]
  summary: string
  bounds: GeometryBounds
  geometry: GeoJSON.Geometry
  details: ExplorerDetailRow[]
  timestamp?: number
}

export interface ExplorerDatasetDefinition {
  id: ExplorerDatasetId
  label: string
  geometryType: ExplorerGeometryType
  color: string
  description: string
  source: string
}

export interface ExplorerDatasetStat {
  dataset: ExplorerDatasetDefinition
  count: number
  averageRelevance: number
  maxRelevance: number
}

export interface ExplorerFeatureProperties {
  itemId: string
  datasetId: ExplorerDatasetId
  name: string
  subtitle: string
  relevance: number
}

export interface ExplorerPointCollection {
  datasetId: ExplorerDatasetId
  color: string
  data: GeoJSON.FeatureCollection<GeoJSON.Point, ExplorerFeatureProperties>
  visible: boolean
}

export interface ExplorerLineCollection {
  datasetId: ExplorerDatasetId
  color: string
  data: GeoJSON.FeatureCollection<GeoJSON.LineString | GeoJSON.MultiLineString, ExplorerFeatureProperties>
  visible: boolean
}

export interface ExplorerPolygonCollection {
  datasetId: ExplorerDatasetId
  color: string
  data: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, ExplorerFeatureProperties>
  visible: boolean
}

export interface SpatialFilter {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
}
