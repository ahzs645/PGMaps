export type RasterKey = 'height' | 'terrain' | 'slope' | 'cover' | 'crowns' | 'support'
export interface RasterPreview {
  file: string
  title: string
  min: number
  max: number
  unit: string
  colors: string[]
}
export interface AnalysisSummary {
  source_points: number
  source_sha256: string
  observed_area_ha: number
  supported_area_ha: number
  ground_supported_percent: number
  tree_candidate_count: number
  building_candidate_count: number
  elevated_area_percent: number
  elevated_first_return_cover_percent: number
  height_stats_m: { median: number; p95: number; max: number }
  elevated_surface_height_stats_m: { median: number; p95: number }
  tree_detection_sensitivity: { minimum_separation_m: number; local_maxima: number }[]
  return_height_profile: { bins_m: string[]; counts: number[] }
  limitations: string[]
  bounds_wgs84: [number, number, number, number]
  rasters: Record<RasterKey, RasterPreview>
  image_coordinates: [number, number][]
  sample_grid: { file: string; width: number; height: number; bounds_mercator: number[] }
  highlights: { label: string; center: [number, number]; zoom: number; note: string }[]
  downloads: { file: string; label: string }[]
  geolibre?: { tools: string[]; tree_candidate_count?: number; tree_scope?: string }
}
