export type LayerId = 'parks' | 'routes' | 'neighbourhoods'

export interface InteractFeatureProperties extends Record<string, unknown> {
  id: string
  name: string
  layer: LayerId
  description: string
  value?: string
  issuedYear: number
  cost: number
  properties: Array<{ label: string; value: string }>
}

export type PolygonFeature = GeoJSON.Feature<GeoJSON.Polygon, InteractFeatureProperties>
export type LineFeature = GeoJSON.Feature<GeoJSON.LineString, InteractFeatureProperties>
export type InteractFeature = PolygonFeature | LineFeature
export type MeasurementMode = 'idle' | 'drawing' | 'complete'
export type MeasurementShape = 'polygon' | 'circle'
export type MeasurementMapAction = { type: 'add'; point: [number, number] } | { type: 'close' }
export type OpenInTarget = 'pgdata' | 'explorer' | 'osm'
export type FeatureAction = 'hide' | 'zoom' | 'show-only' | 'show-others' | 'open-table'

export type MeasurementStats = { perimeter: number; area: number; radius?: number } | null
export type YearRange = [number, number]
export type ScalePosition = 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right'
