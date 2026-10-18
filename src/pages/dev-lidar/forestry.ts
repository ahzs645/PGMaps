import type { FeatureCollection, Polygon } from 'geojson'
import type { WorkflowFeature, WorkflowOptions } from './analysisWorkflows'
export type ForestMode = 'strata' | 'texture' | 'edges'
export type ReturnMode = 'all' | 'first'
export interface ReturnProfile {
  returns: number
  bands: number[]
  elevated_returns: number
  low_layer_percent: number | null
  height_entropy: number | null
}
export interface ForestProperties {
  id: string
  centre_utm: [number, number]
  sampled_m2: number
  support_percent: number
  canopy_percent: number
  canopy_m2: number
  surface_p95_m: number
  surface_sd_m: number
  rugosity_m: number | null
  texture_supported_m2: number
  ground_m: number
  ground_support_p95_m: number
  profiles: Record<ReturnMode, ReturnProfile>
  edge_10: { counts: number[]; percent: (number | null)[] }
  edge_20: { counts: number[]; percent: (number | null)[] }
  edge_30: { counts: number[]; percent: (number | null)[] }
}
export interface ForestData {
  schema_version: number
  source_sha256: string
  input_sha256: Record<string, string>
  counts: {
    source_points: number
    accepted_returns: number
    excluded_returns: number
    first_returns: number
    eligible_cells: number
    canopy_cells: number
  }
  bands: string[]
  methods: { strata: string; texture: string; edges: string }
  limitations: string[]
  plots: FeatureCollection<Polygon, ForestProperties>
}
export function isForestMode(value: unknown): value is ForestMode {
  return value === 'strata' || value === 'texture' || value === 'edges'
}
export function forestValue(plot: ForestProperties, options: WorkflowOptions): number | null {
  if (options.mode === 'strata') return plot.profiles[options.returnMode].height_entropy
  if (options.mode === 'texture') return plot.rugosity_m
  if (options.mode === 'edges') return plot[`edge_${options.edgeDistance}`].percent[1]
  return null
}
export function forestFeatures(data: ForestData, options: WorkflowOptions): WorkflowFeature[] {
  return data.plots.features
    .filter((feature) => {
      const p = feature.properties
      return (
        p.support_percent >= options.support &&
        p.canopy_percent >= options.canopyMinimum &&
        forestValue(p, options) !== null
      )
    })
    .map((feature) => ({
      ...feature,
      properties: { ...feature.properties, map_value: forestValue(feature.properties, options) },
    }))
    .sort((a, b) => (b.properties.map_value ?? 0) - (a.properties.map_value ?? 0))
}
export function forestShortlist(data: ForestData, options: WorkflowOptions, limit = 8) {
  // Spatially spread high-value candidates: avoid selecting only one adjacent patch.
  const ranked = forestFeatures(data, options)
  const chosen: WorkflowFeature[] = []
  for (const feature of ranked) {
    const candidate = data.plots.features.find((row) => row.properties.id === feature.properties.id)!.properties
      .centre_utm
    const separated = chosen.every((other) => {
      const centre = data.plots.features.find((row) => row.properties.id === other.properties.id)!.properties.centre_utm
      return Math.hypot(candidate[0] - centre[0], candidate[1] - centre[1]) >= 100
    })
    if (separated) chosen.push(feature)
    if (chosen.length === limit) break
  }
  return chosen
}
export function profilePercentages(profile: ReturnProfile): number[] {
  return profile.returns ? profile.bands.map((count) => (100 * count) / profile.returns) : profile.bands.map(() => 0)
}
export function compareForestPlots(
  a: ForestProperties,
  b: ForestProperties,
  mode: ForestMode,
  options: WorkflowOptions,
) {
  const av = forestValue(a, { ...options, mode }),
    bv = forestValue(b, { ...options, mode })
  return av === null || bv === null ? null : av - bv
}
export const FOREST_PALETTES = {
  strata: { min: 0, max: 1, colors: ['#fff7ed', '#fb923c', '#7c2d12'], label: 'Return-height entropy · 0–1' },
  texture: {
    min: 0,
    max: 8,
    colors: ['#f0fdf4', '#4ade80', '#14532d'],
    label: 'Mean 5 m surface SD · 0–8 m (clipped colour)',
  },
  edges: {
    min: 0,
    max: 100,
    colors: ['#eff6ff', '#60a5fa', '#1e3a8a'],
    label: 'Interior proxy · 0–100% of taller canopy',
  },
} as const
