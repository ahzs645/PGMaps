import type { ForestData } from './forestry'
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
export function isSpeciesMode(value: unknown): value is SpeciesMode {
  return SPECIES_VIEWS.some((view) => view.id === value)
}
export const SPECIES_PALETTE = {
  label: 'Broadleaf inventory composition · grey: unavailable',
  min: 0,
  max: 100,
  colors: ['#6d28d9', '#f8fafc', '#15803d'],
}
export function speciesFeatures(
  data: SpeciesData,
  options: WorkflowOptions,
  forest?: ForestData,
  context?: SpeciesContext,
): WorkflowFeature[] {
  const allowed = (p: SpeciesProperties) =>
    options.speciesFilter === 'all' || (p.labelled && p.leading === options.speciesFilter)
  if (isSpeciesPlotMode(options.mode)) {
    if (!forest || !context) return []
    const stands = new Map(data.stands.features.map((f) => [f.properties.id, f.properties]))
    return forest.plots.features
      .flatMap((f) => {
        const p = f.properties,
          link = context.plots[p.id],
          stand = link?.stand_id ? stands.get(link.stand_id) : null
        if (p.support_percent < 95 || (options.speciesFilter !== 'all' && (!stand || !allowed(stand)))) return []
        if (
          options.mode === 'species-structure' &&
          (p.surface_p95_m < options.speciesHeightMinimum || p.canopy_percent < options.speciesCoverMinimum)
        )
          return []
        if (
          options.mode === 'species-regeneration' &&
          (p.surface_p95_m > options.speciesLowMaximum || p.canopy_percent > options.speciesLowCoverMaximum)
        )
          return []
        const value = {
          height: p.surface_p95_m,
          density: p.canopy_percent,
          texture: p.rugosity_m,
          layers: p.profiles.all.height_entropy,
        }[options.speciesStructureMetric]
        return [
          {
            ...f,
            properties: {
              ...p,
              stand_id: stand?.id ?? null,
              leading: stand?.labelled ? stand.leading : null,
              map_value: value,
              area_m2: p.sampled_m2,
            },
          },
        ]
      })
      .sort((a, b) => (b.properties.map_value ?? -1) - (a.properties.map_value ?? -1))
  }
  const rows =
    options.mode === 'species-field'
      ? fieldShortlist(data, options)
      : data.stands.features.filter((f) => allowed(f.properties))
  return rows
    .flatMap((f) => {
      const p = f.properties
      let value: number | null = p.broadleaf_percent
      if (options.mode === 'species-share') value = inventoryShare(p, options.speciesCode)
      if (options.mode === 'species-mixture') value = p.labelled ? effectiveSpecies(p.composition) : null
      if (options.mode === 'species-model') value = predictedShare(data, p, options.speciesCompare)
      const difference = disagreement(data, p, options.speciesCompare)
      if (options.mode === 'species-disagreement') {
        value = difference === null ? null : Math.abs(difference)
        if (options.speciesDifferenceMinimum > 0 && (value === null || value < options.speciesDifferenceMinimum))
          return []
      }
      if (
        options.mode === 'species-share' &&
        options.speciesShareMinimum > 0 &&
        (value === null || value < options.speciesShareMinimum)
      )
        return []
      return [
        {
          ...f,
          properties: {
            ...p,
            leading: p.labelled ? p.leading : null,
            map_value: value,
            difference_pp: difference,
            focus: context?.field_points[p.id],
          },
        },
      ]
    })
    .sort((a, b) =>
      options.mode === 'species-field'
        ? 0
        : options.mode === 'species-disagreement'
          ? (b.properties.map_value ?? -1) - (a.properties.map_value ?? -1)
          : b.properties.area_m2 - a.properties.area_m2,
    )
}

export const SPECIES_COLOURS: Record<string, string> = {
  EP: '#e69f00',
  AT: '#56b4e9',
  AC: '#cc79a7',
  FDI: '#0072b2',
  SX: '#009e73',
  BL: '#d55e00',
  PLI: '#7366bd',
}
export interface SpeciesContext {
  schema_version: number
  source_sha256: string
  species_sha256: string
  forestry_sha256: string
  plots: Record<string, { stand_id: string | null; overlap_percent: number }>
  field_points: Record<string, [number, number]>
}
export const SPECIES_VIEWS = [
  {
    id: 'species',
    label: 'Leading species',
    note: 'Distinct species colours show the leading recorded VRI species. A stand can contain several species.',
  },
  {
    id: 'species-share',
    label: 'Species share',
    note: 'Recorded proportion of one selected species in each VRI stand. Zero is a recorded absence; grey is unavailable.',
  },
  {
    id: 'species-broadleaf',
    label: 'Broadleaf / conifer',
    note: 'Broadleaf composition recorded in VRI: paper birch + aspen + poplar. This is separate from canopy cover.',
  },
  {
    id: 'species-mixture',
    label: 'Stand mixture',
    note: 'Effective number of recorded species: 1 / sum of squared composition fractions. This describes inventory mixture, not biodiversity.',
  },
  {
    id: 'species-structure',
    label: 'Species & canopy structure',
    note: '50 m LiDAR plots with inventory species context. Filter height and cover, then compare texture and vertical profiles.',
  },
  {
    id: 'species-regeneration',
    label: 'Low-canopy survey',
    note: 'Supported low-height, open plots for imagery or field inspection. These are not detected seedlings or regeneration success.',
  },
  {
    id: 'species-disagreement',
    label: 'Model disagreement',
    note: 'Absolute difference between held-out predictions and inventory composition. A large difference can reflect model error or label mismatch.',
  },
  {
    id: 'species-field',
    label: 'Field-review shortlist',
    note: 'Up to eight stand candidates: represent leading species, include missing holdout coverage, then large disagreements. Not a probability sample.',
  },
  {
    id: 'species-model',
    label: 'Held-out species model',
    note: 'Experimental held-out composition estimates. The model does not beat the broadleaf mean-composition baseline.',
  },
] as const
export type SpeciesMode = (typeof SPECIES_VIEWS)[number]['id']
export function isSpeciesPlotMode(mode: unknown) {
  return mode === 'species-structure' || mode === 'species-regeneration'
}
export function effectiveSpecies(composition: Record<string, number>): number | null {
  const total = Object.values(composition).reduce((a, b) => a + b, 0)
  return total > 0 ? 1 / Object.values(composition).reduce((s, n) => s + (n / total) ** 2, 0) : null
}
export function inventoryShare(p: SpeciesProperties, code: string) {
  return p.labelled ? (code === 'broadleaf' ? p.broadleaf_percent : (p.composition[code] ?? null)) : null
}
export function predictedShare(data: SpeciesData, p: SpeciesProperties, code: string) {
  if (!p.model) return null
  return code === 'broadleaf'
    ? p.model.broadleaf_percent
    : (p.model.predicted[data.species_order.indexOf(code)] ?? null)
}
export function disagreement(data: SpeciesData, p: SpeciesProperties, code: string) {
  const actual = inventoryShare(p, code),
    estimate = predictedShare(data, p, code)
  return actual === null || estimate === null ? null : estimate - actual
}
export function fieldShortlist(data: SpeciesData, options: WorkflowOptions, limit = 8) {
  const candidates = data.stands.features
    .filter(
      (f) =>
        f.properties.labelled && (options.speciesFilter === 'all' || f.properties.leading === options.speciesFilter),
    )
    .sort(
      (a, b) =>
        (disagreement(data, b.properties, options.speciesCompare) === null
          ? -1
          : Math.abs(disagreement(data, b.properties, options.speciesCompare)!)) -
          (disagreement(data, a.properties, options.speciesCompare) === null
            ? -1
            : Math.abs(disagreement(data, a.properties, options.speciesCompare)!)) ||
        a.properties.id.localeCompare(b.properties.id),
    )
  const chosen: typeof candidates = []
  const add = (f: (typeof candidates)[number] | undefined) => {
    if (f && !chosen.some((c) => c.properties.id === f.properties.id) && chosen.length < limit) chosen.push(f)
  }
  for (const leading of [...new Set(candidates.map((f) => f.properties.leading))])
    add(candidates.find((f) => f.properties.leading === leading))
  add(candidates.find((f) => !f.properties.model))
  candidates.forEach(add)
  return chosen
}
export function speciesLegend(options: WorkflowOptions) {
  const mode = options.mode
  const categorical =
    mode === 'species' || mode === 'species-field' || (isSpeciesPlotMode(mode) && options.speciesColour === 'species')
  if (categorical)
    return {
      label: 'Leading VRI species · grey: unavailable',
      min: 0,
      max: 100,
      unit: '',
      colors: Object.values(SPECIES_COLOURS),
      categorical: true,
    }
  if (mode === 'species-mixture')
    return {
      label: 'Effective recorded species · not biodiversity',
      min: 1,
      max: 7,
      unit: '',
      colors: ['#fff7ed', '#fb923c', '#7c2d12'],
      categorical: false,
    }
  if (mode === 'species-disagreement')
    return {
      label: 'Held-out model disagreement · grey: unavailable',
      min: 0,
      max: 100,
      unit: ' pp',
      colors: ['#fff7ec', '#f59e0b', '#991b1b'],
      categorical: false,
    }
  if (mode === 'species-share')
    return {
      label: `${options.speciesCode} · recorded inventory share`,
      min: 0,
      max: 100,
      unit: '%',
      colors: ['#f8fafc', '#cbd5e1', SPECIES_COLOURS[options.speciesCode]],
      categorical: false,
    }
  if (isSpeciesPlotMode(mode)) {
    const p = {
      height: { label: 'Plot surface P95 height', max: 40, unit: ' m', colors: ['#fef3c7', '#f59e0b', '#78350f'] },
      density: { label: 'Plot canopy cover above 5 m', max: 100, unit: '%', colors: ['#eff6ff', '#38bdf8', '#1e3a8a'] },
      texture: {
        label: 'Mean complete 5 m height-surface SD',
        max: 10,
        unit: ' m',
        colors: ['#f0fdf4', '#4ade80', '#14532d'],
      },
      layers: {
        label: 'All-return height dispersion · fixed bins',
        max: 1,
        unit: '',
        colors: ['#fff7ed', '#fb923c', '#7c2d12'],
      },
    }[options.speciesStructureMetric]
    return { ...p, min: 0, categorical: false }
  }
  return {
    ...SPECIES_PALETTE,
    label:
      mode === 'species-model' ? `Held-out ${options.speciesCompare} composition` : 'Recorded broadleaf composition',
    unit: '%',
    categorical: false,
  }
}

export function fieldShortlistCSV(data: SpeciesData, context: SpeciesContext, options: WorkflowOptions) {
  const rows = fieldShortlist(data, options).map((f) => {
    const p = f.properties,
      point = context.field_points[p.id],
      delta = disagreement(data, p, options.speciesCompare)
    return [
      p.id,
      p.leading,
      ...point.map((n) => n.toFixed(7)),
      (p.area_m2 / 10000).toFixed(2),
      delta?.toFixed(2) ?? '',
      p.model ? 'Species representation / model disagreement' : 'Missing held-out coverage',
    ].join(',')
  })
  return (
    'stand_id,leading_species,longitude,latitude,supported_ha,model_minus_inventory_pp,selection_reason\n' +
    rows.join('\n')
  )
}
