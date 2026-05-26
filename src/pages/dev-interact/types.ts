export type LayerId = 'parks' | 'routes' | 'neighbourhoods' | 'catchments'

export interface InteractFeatureProperties extends Record<string, unknown> {
  id: string
  name: string
  layer: LayerId
  description: string
  value?: string
  spillHours?: number
  riskClass?: RiskClass
  dischargeType?: DischargeType
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

// ── Data-driven styling scenario ───────────────────────────────────────────
export type RiskClass = 'Low' | 'Moderate' | 'High' | 'Severe'
export type DischargeType = 'Storm overflow' | 'Treated effluent' | 'Industrial' | 'Agricultural'
export type StyleAttributeId = 'spillHours' | 'riskClass' | 'dischargeType'
export type StyleAttributeKind = 'graduated' | 'categorical'
export interface StyleAttribute {
  id: StyleAttributeId
  label: string
  kind: StyleAttributeKind
}
export type GraduatedRampName = 'red' | 'amber' | 'blue'
export interface LegendItem {
  key: string
  color: string
  label: string
  count: number
}
