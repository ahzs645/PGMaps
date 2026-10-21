import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson'
export type InventoryGeometry = Point | Polygon | MultiPolygon
export interface TreeAttributes {
  id: string
  local_id: string
  method: string
  chunk: string
  label: number
  lon: number
  lat: number
  height_m: number
  p95_m: number | null
  crown_area_m2: number | null
  crown_diameter_m: number | null
  point_count: number | null
  ground_m: number
  slope_deg: number
  aspect_deg: number
  boundary: boolean
  breast_height_returns: number | null
  stem_band_returns: number | null
  vri_id: number | null
  vri_species: string | null
  vri_species_pct: number | null
  vri_net_m3_ha: number | null
  vri_basal_area_m2_ha: number | null
  texture_entropy: number | null
  detection_window_radius_m: number | null
  geometry_method: string
  sample_key: string | null
}
export type InventoryTree = Feature<InventoryGeometry, TreeAttributes>
export interface InventoryData {
  schema_version: number
  run_id: string
  source_sha256: string
  snapshot_utc: string
  scope: string
  height_sha256: string
  fora: { commit: string; source_sha256: string; note: string }
  area_method: string
  support: FeatureCollection<Polygon>
  outline: FeatureCollection
  bounds: [number, number, number, number]
  methods: { id: string; name: string; parameters: Record<string, number> }[]
  foresttools: {
    version: string
    runs: { chunk: string; variant: string; treetops: number; crowns: number; seconds: number; raster_labels: number }[]
  }
  crowns: FeatureCollection<InventoryGeometry, TreeAttributes>
}
export interface TreeReview {
  status: 'unreviewed' | 'accepted' | 'excluded' | 'split' | 'merged'
  species: string
  dbh_cm: number | null
  note: string
}
export const EMPTY_REVIEW: TreeReview = { status: 'unreviewed', species: '', dbh_cm: null, note: '' }
export interface InventoryRules {
  speciesMode: 'vri' | 'reviewed'
  minHeight: number
  minPoints: number
  minDbh: number
  dbhFactor: number
  retention: number
  recovery: number
}
export const DEFAULT_RULES: InventoryRules = {
  speciesMode: 'vri',
  minHeight: 5,
  minPoints: 0,
  minDbh: 12.5,
  dbhFactor: 1,
  retention: 20,
  recovery: 90,
}
