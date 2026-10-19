import type { FeatureCollection, Geometry } from 'geojson'
import type { WorkflowFeature, WorkflowOptions } from './analysisWorkflows'
export interface SpeciesProperties {
  id: string
  feature_id: string
  area_m2: number
  treed: boolean
  labelled: boolean
  composition: Record<string, number>
  leading: string | null
  broadleaf_percent: number | null
  reference_year: number | null
  interpretation_date: string | null
  projected_date: string | null
  model: null | {
    plots: number
    train_groups: string[]
    observed: number[]
    predicted: number[]
    baseline: number[]
    broadleaf_percent: number
    baseline_broadleaf_percent: number
  }
}
export interface SpeciesData {
  schema_version: number
  source_sha256: string
  input_sha256: Record<string, string>
  forestry_sha256: string
  inventory_sha256: string
  inventory_metadata: { catalogue: string; retrieved_utc: string }
  species: Record<string, string>
  species_order: string[]
  coverage: { supported_m2: number; labelled_m2: number; other_m2: number; unmapped_m2: number }
  area_weighted_inventory_index: Record<string, number>
  experiment: {
    algorithm: string
    plots: number
    stands: number
    model: { species_mae_pp: number; broadleaf_mae_pp: number }
    baseline: { species_mae_pp: number; broadleaf_mae_pp: number }
    status: string
  }
  stands: FeatureCollection<Geometry, SpeciesProperties>
}
export function isSpeciesMode(value: unknown): value is 'species' | 'species-model' {
  return value === 'species' || value === 'species-model'
}
export const SPECIES_PALETTE = {
  label: 'Broadleaf inventory composition · grey: unavailable',
  min: 0,
  max: 100,
  colors: ['#6d28d9', '#f8fafc', '#15803d'],
}
export function speciesFeatures(data: SpeciesData, options: WorkflowOptions): WorkflowFeature[] {
  return data.stands.features
    .map((f) => ({
      ...f,
      properties: {
        ...f.properties,
        map_value:
          options.mode === 'species-model'
            ? (f.properties.model?.broadleaf_percent ?? null)
            : f.properties.broadleaf_percent,
      },
    }))
    .sort((a, b) => b.properties.area_m2 - a.properties.area_m2)
}
