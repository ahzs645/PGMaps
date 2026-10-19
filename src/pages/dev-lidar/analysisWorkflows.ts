import {
  speciesFeatures,
  isSpeciesMode,
  SPECIES_VIEWS,
  type SpeciesContext,
  type SpeciesMode,
  type SpeciesData,
} from './species'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { forestFeatures, isForestMode, type ForestData, type ReturnMode } from './forestry'
import type { Basemap } from './basemaps'

export type AnalysisMode =
  | 'gaps'
  | 'plots'
  | 'clearance'
  | 'models'
  | 'strata'
  | 'texture'
  | 'edges'
  | 'canopy-height'
  | 'canopy-density'
  | SpeciesMode
export interface WorkflowOptions {
  speciesCode: string
  speciesCompare: string
  speciesFilter: string
  speciesShareMinimum: number
  speciesHeightMinimum: number
  speciesCoverMinimum: number
  speciesLowMaximum: number
  speciesLowCoverMaximum: number
  speciesColour: 'species' | 'metric'
  speciesStructureMetric: 'height' | 'density' | 'texture' | 'layers'
  speciesDifferenceMinimum: number
  speciesOpacity: number
  heatOpacity: number
  returnMode: ReturnMode
  canopyMinimum: number
  edgeDistance: 10 | 20 | 30
  mode: AnalysisMode | null
  threshold: 2 | 5
  minGap: number
  enclosed: boolean
  plotSize: 25 | 50
  support: number
  clearance: number
  selectedId: string | null
}
export const INITIAL_ANALYSIS: WorkflowOptions = {
  speciesCode: 'EP',
  speciesCompare: 'broadleaf',
  speciesFilter: 'all',
  speciesShareMinimum: 0,
  speciesHeightMinimum: 20,
  speciesCoverMinimum: 70,
  speciesLowMaximum: 10,
  speciesLowCoverMaximum: 40,
  speciesColour: 'species',
  speciesStructureMetric: 'height',
  speciesDifferenceMinimum: 0,
  speciesOpacity: 0.72,
  heatOpacity: 0.8,
  returnMode: 'all',
  canopyMinimum: 40,
  edgeDistance: 20,
  mode: null,
  threshold: 2,
  minGap: 25,
  enclosed: true,
  plotSize: 50,
  support: 95,
  clearance: 10,
  selectedId: null,
}
export type WorkflowFeature = Feature<
  Geometry,
  {
    id: string
    leading?: string | null
    stand_id?: string | null
    focus?: [number, number]
    difference_pp?: number | null
    map_value?: number | null
    area_m2?: number
    threshold_m?: number
    canopy_edge_percent?: number
    enclosed_candidate?: boolean
    boundary_clipped?: boolean
    near_roof?: boolean
    sampled_m2?: number
    size_m?: number
    support_percent?: number
    mean_m?: number
    median_m?: number
    p95_m?: number
    sd_m?: number
    above_2m_percent?: number
    crown_candidates?: number
    crown_candidates_per_ha?: number
    ground_support_p95_m?: number
    distance_m?: number | null
    cell_distance_min_m?: number | null
    cell_distance_max_m?: number | null
    candidate_height_m?: number | null
  }
>
export interface WorkflowData {
  schema_version: number
  source_sha256: string
  input_sha256: Record<string, string>
  methods: Record<'gaps' | 'plots' | 'clearance', string>
  gaps: Record<string, FeatureCollection<Geometry, WorkflowFeature['properties']>>
  plots: Record<string, FeatureCollection<Geometry, WorkflowFeature['properties']>>
  clearance: Record<string, FeatureCollection<Geometry, WorkflowFeature['properties']>>
}
export interface ModelTriangle {
  kind: string
  vertices: [number, number, number][]
}
export interface BuildingModel {
  id: string
  centre: [number, number]
  area_m2: number
  ground_m: number
  success: boolean
  mode: string
  rmse_m: number | null
  roof_planes: number
  roof_type: string
  closed_edge_incidence: boolean
  nonmanifold_edges: number
  facets: { pitch_deg: number; surface_index: number }[]
  triangles: ModelTriangle[]
}
export interface ModelData {
  schema_version: number
  source_sha256: string
  candidate_sha256: string
  cityjson_sha256: string
  engine: { version: string; screened_points: number; screened_roof_points: number; classified_ground_points: number }
  records: BuildingModel[]
  limitations: string[]
}
export const ANALYSIS_MODES: { id: AnalysisMode; label: string; basemap: Basemap; note: string }[] = [
  ...SPECIES_VIEWS.map((view) => ({
    ...view,
    basemap: (view.id === 'species-structure' || view.id === 'species-regeneration'
      ? 'satellite'
      : 'vector') as Basemap,
  })),
  {
    id: 'canopy-height',
    label: 'Canopy height heatmap',
    basemap: 'satellite',
    note: 'Continuous height colours · blue/purple low, yellow/red tall · 0–40+ m above terrain.',
  },
  {
    id: 'canopy-density',
    label: 'Canopy density heatmap',
    basemap: 'satellite',
    note: 'Continuous canopy cover · 0–100% of eligible area above the selected height within 21 m neighbourhoods.',
  },
  {
    id: 'strata',
    label: 'Vertical layers',
    basemap: 'vector',
    note: 'Orange: dispersion of original return heights. Compare lower and upper layers; returns are not vegetation volume.',
  },
  {
    id: 'texture',
    label: 'Canopy texture',
    basemap: 'satellite',
    note: 'Green: 5 m height-surface variability, aggregated to 50 m plots. More texture is not automatically better forest.',
  },
  {
    id: 'edges',
    label: 'Edges & interior',
    basemap: 'satellite',
    note: 'Blue: taller-canopy interior proxy beyond low openings. Unknown and tile boundaries are censored.',
  },
  {
    id: 'gaps',
    label: 'Canopy gaps',
    basemap: 'satellite',
    note: 'Cyan: low-height openings. Enclosed candidates still need a forest mask and imagery review.',
  },
  {
    id: 'plots',
    label: 'Plot statistics',
    basemap: 'vector',
    note: 'Purple: source-grid plot P95 height. Surface-cell metrics include structures; crown candidates are not stems.',
  },
  {
    id: 'clearance',
    label: 'Vegetation proximity',
    basemap: 'satellite',
    note: 'Pink: nearest elevated-cell connections to roof patches. Horizontal screening only; roof buffer hides the first 2 m.',
  },
  {
    id: 'models',
    label: 'Building models',
    basemap: 'none',
    note: 'Experimental Roofer LoD2.2 mesh. Amber roofs, blue walls. Unverified patch inputs; not validated buildings.',
  },
]

export function workflowFeatures(data: WorkflowData, options: WorkflowOptions): WorkflowFeature[] {
  if (options.mode === 'gaps')
    return data.gaps[String(options.threshold)].features.filter(
      (f) => (f.properties.area_m2 ?? 0) >= options.minGap && (!options.enclosed || f.properties.enclosed_candidate),
    )
  if (options.mode === 'plots')
    return data.plots[String(options.plotSize)].features.filter(
      (f) => (f.properties.support_percent ?? 0) >= options.support,
    )
  if (options.mode === 'clearance')
    return data.clearance[String(options.threshold)].features.filter(
      (f) =>
        f.properties.distance_m !== null &&
        f.properties.distance_m !== undefined &&
        f.properties.distance_m <= options.clearance,
    )
  return []
}
export function featureCentre(feature: WorkflowFeature): [number, number] {
  if (feature.properties.focus) return feature.properties.focus
  const points: number[][] = []
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return
    if (typeof value[0] === 'number') points.push(value as number[])
    else value.forEach(collect)
  }
  if ('coordinates' in feature.geometry) collect(feature.geometry.coordinates)
  if (!points.length) throw Error('Feature has no coordinates')
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity
  for (const [x, y] of points) {
    west = Math.min(west, x)
    east = Math.max(east, x)
    south = Math.min(south, y)
    north = Math.max(north, y)
  }
  return [(west + east) / 2, (south + north) / 2]
}

export type ReviewDecision = { decision: 'unreviewed' | 'retain' | 'reject'; note: string }
export type ReviewLedger = Record<string, ReviewDecision>
export function readReviewLedger(value: string, sourceHash: string, ids: Set<string>): ReviewLedger {
  const parsed = JSON.parse(value)
  if (
    parsed.schema_version !== 1 ||
    parsed.source_sha256 !== sourceHash ||
    typeof parsed.records !== 'object' ||
    !parsed.records
  )
    throw Error('Review file belongs to another source or schema')
  const result: ReviewLedger = {}
  for (const [id, entry] of Object.entries(parsed.records)) {
    const row = entry as ReviewDecision
    if (
      !ids.has(id) ||
      !['unreviewed', 'retain', 'reject'].includes(row.decision) ||
      typeof row.note !== 'string' ||
      row.note.length > 2000
    )
      throw Error('Review file contains invalid IDs or decisions')
    result[id] = { decision: row.decision, note: row.note }
  }
  return result
}

export function sortedWorkflowFeatures(
  data: WorkflowData,
  options: WorkflowOptions,
  forest?: ForestData,
  species?: SpeciesData,
  context?: SpeciesContext,
) {
  if (isSpeciesMode(options.mode)) return species ? speciesFeatures(species, options, forest, context) : []
  if (isForestMode(options.mode)) return forest ? forestFeatures(forest, options) : []
  return workflowFeatures(data, options)
    .slice()
    .sort((a, b) =>
      options.mode === 'gaps'
        ? (b.properties.area_m2 ?? 0) - (a.properties.area_m2 ?? 0)
        : options.mode === 'plots'
          ? (b.properties.p95_m ?? 0) - (a.properties.p95_m ?? 0)
          : (a.properties.distance_m ?? Infinity) - (b.properties.distance_m ?? Infinity),
    )
}

export function analysisPresentation(mode: AnalysisMode) {
  return {
    basemap: ANALYSIS_MODES.find((item) => item.id === mode)!.basemap,
    labels: isSpeciesMode(mode) || mode === 'plots' || mode === 'strata',
    surfaceVisible: false,
    surfaceOpacity: 0.65,
    trees: false,
    buildings: mode === 'clearance',
    cloud: false,
    reference: false,
    toolsOpen: false,
    minTreeHeight: 5,
    color: 'elevation' as const,
  }
}
