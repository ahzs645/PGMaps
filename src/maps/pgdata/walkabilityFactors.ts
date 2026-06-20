/**
 * Shared walkability Mobility Index (MI) factor model.
 *
 * These definitions describe the 2017 Pedestrian Network Study factor
 * references (A0–G5), the variant config toggles, and the helpers that map
 * between them. They are consumed both by the MISC > Walkability tab
 * (`walkability.tsx`) and by the Index Lab / score builder walkability source
 * surface, so they live in one place to stay in sync.
 */

export type HeatmapOptionKey =
  | 'dropGtfsHf'
  | 'narrowCivic'
  | 'narrowGrowth'
  | 'dropPopAge'
  | 'dropF0'
  | 'dropC0'
  | 'dropF8'
  | 'dropSuppPoi'
  | 'tightBuffer'

export type HeatmapOptionState = Record<HeatmapOptionKey, boolean>
export type HeatmapFactorWeightState = Record<string, number>

export const HEATMAP_EMPTY_OPTIONS: HeatmapOptionState = {
  dropGtfsHf: false,
  narrowCivic: false,
  narrowGrowth: false,
  dropPopAge: false,
  dropF0: false,
  dropC0: false,
  dropF8: false,
  dropSuppPoi: false,
  tightBuffer: false,
}

export const HEATMAP_REPORT_FIDELITY_OPTIONS: HeatmapOptionState = {
  ...HEATMAP_EMPTY_OPTIONS,
  dropGtfsHf: true,
  narrowCivic: true,
  narrowGrowth: true,
  dropPopAge: true,
}

export const HEATMAP_OPTIONS: Array<{ key: HeatmapOptionKey; label: string; description: string }> = [
  { key: 'dropGtfsHf', label: 'Remove GTFS high-frequency bonus', description: 'Drops the extra band 4-5 transit stop bonus.' },
  { key: 'narrowCivic', label: 'Narrow civic factors', description: 'Keeps Cultural, Aquatic, and Administration only.' },
  { key: 'narrowGrowth', label: 'Narrow growth factors', description: 'Keeps Growth Priority and Future growth only.' },
  { key: 'dropPopAge', label: 'Drop population and age factors', description: 'Removes F2/F3/F4/F6/F7 for report fidelity.' },
  { key: 'dropF0', label: 'Drop crosswalks', description: 'Removes F0 crosswalk scoring.' },
  { key: 'dropC0', label: 'Drop daycares', description: 'Removes C0 daycare scoring.' },
  { key: 'dropF8', label: 'Drop intercity bus', description: 'Removes F8 intercity bus scoring.' },
  { key: 'dropSuppPoi', label: 'Drop supplemental POIs', description: 'Removes A1/E0/E1/E2/E3 supplemental POIs.' },
  { key: 'tightBuffer', label: 'Use 10m area buffer', description: 'Uses 10m instead of the default 20m area/line buffer.' },
]

export interface WalkabilityFactorGroup {
  ref: string
  label: string
  group: string
  method: string
}

export const WALKABILITY_FACTOR_GROUPS: WalkabilityFactorGroup[] = [
  { ref: 'A0', label: 'Community space', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A1', label: 'Entertainment', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A2', label: 'Parks', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A3', label: 'Activity areas', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A4', label: 'Playgrounds', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'A5', label: 'Recreation facilities', group: 'Community activities', method: '400/250/100m proximity' },
  { ref: 'B0', label: 'Community centres', group: 'Community facilities', method: '400/250/100m proximity' },
  { ref: 'B1', label: 'Future community facility', group: 'Community facilities', method: '400/250/100m proximity' },
  { ref: 'B2', label: 'Religious assembly', group: 'Community facilities', method: '400/250/100m proximity' },
  { ref: 'B3', label: 'Schools', group: 'Community facilities', method: '400/250/100m proximity' },
  { ref: 'C0', label: 'Daycares', group: 'Community services', method: '400/250/100m proximity' },
  { ref: 'C1', label: 'Government services', group: 'Community services', method: '400/250/100m proximity' },
  { ref: 'C2', label: 'Health centres', group: 'Community services', method: '400/250/100m proximity' },
  { ref: 'C3', label: 'Commercial land use', group: 'Community services', method: 'area association' },
  { ref: 'C4', label: 'Recreation/institutional', group: 'Community services', method: 'area association' },
  { ref: 'C5', label: 'Business industrial', group: 'Community services', method: 'area association' },
  { ref: 'C6', label: 'Residential land use', group: 'Community services', method: 'area association' },
  { ref: 'D0', label: 'Downtown commercial', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'D1', label: 'Service commercial', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'D2', label: 'Corridor commercial', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'D3', label: 'Commercial recreation', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'D4', label: 'Regional commercial', group: 'Economic commerce', method: '400/250/100m proximity' },
  { ref: 'E0', label: 'Low-income housing', group: 'Economic housing', method: '400/250/100m proximity' },
  { ref: 'E1', label: 'Apartment buildings', group: 'Economic housing', method: '400/250/100m proximity' },
  { ref: 'E2', label: 'Assisted housing', group: 'Economic housing', method: '400/250/100m proximity' },
  { ref: 'E3', label: 'Senior housing', group: 'Economic housing', method: '400/250/100m proximity' },
  { ref: 'E4', label: 'Growth priority areas', group: 'Economic housing', method: 'area association' },
  { ref: 'E5', label: 'Future growth areas', group: 'Economic housing', method: 'area association' },
  { ref: 'E6', label: 'Intensive residential', group: 'Economic housing', method: 'area association' },
  { ref: 'F0', label: 'Crosswalks', group: 'Environment mobility', method: '400/250/100m proximity' },
  { ref: 'F1', label: 'Traffic signals', group: 'Environment mobility', method: '400/250/100m proximity' },
  { ref: 'F2', label: 'High population density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F3', label: 'Medium population density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F4', label: 'Low population density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F6', label: 'Senior density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F7', label: 'Youth density', group: 'Environment mobility', method: 'area association' },
  { ref: 'F8', label: 'Intercity bus', group: 'Environment mobility', method: '400/250/100m proximity' },
  { ref: 'F9', label: 'Transit stops', group: 'Environment mobility', method: '400/250/100m proximity' },
  { ref: 'G0', label: 'Transit corridors', group: 'Environment routes', method: '400/250/100m proximity' },
  { ref: 'G1', label: 'Active corridors', group: 'Environment routes', method: 'line association' },
  { ref: 'G2', label: 'Arterial/freeway roads', group: 'Environment routes', method: 'line association' },
  { ref: 'G3', label: 'Major collectors', group: 'Environment routes', method: 'line association' },
  { ref: 'G4', label: 'Minor collectors', group: 'Environment routes', method: 'line association' },
  { ref: 'G5', label: 'Local roads', group: 'Environment routes', method: 'line association' },
]

/** Flat list of report factor references (A0–G5), in canonical order. */
export const WALKABILITY_REPORT_FACTOR_REFS: string[] = WALKABILITY_FACTOR_GROUPS.map((factor) => factor.ref)

export const HEATMAP_DEFAULT_FACTOR_WEIGHTS: HeatmapFactorWeightState = Object.fromEntries(
  WALKABILITY_FACTOR_GROUPS.map((factor) => [factor.ref, 1]),
)

export const WALKABILITY_HEATMAP_BASE_LOGIC = [
  'Uses all report factor references A0-G5 where public or reconstructed layers are available.',
  'Proximity layers use cumulative 400m / 250m / 100m buffers worth 1 / 2 / 2 points.',
  'Area and line layers use source geometry buffers, defaulting to 20m unless the tight-buffer option is active.',
]

export function describeHeatmapLogic(options: HeatmapOptionState): string[] {
  const logic = [...WALKABILITY_HEATMAP_BASE_LOGIC]
  if (options.dropGtfsHf) logic.push('F9 high-frequency GTFS bonus is removed.')
  if (options.narrowCivic) logic.push('A0/A5/C1 civic groups are narrowed to the closest report-matching facility classes.')
  if (options.narrowGrowth) logic.push('E4/E5 growth-area groups are narrowed to Growth Priority and Future growth classes.')
  if (options.dropPopAge) logic.push('F2/F3/F4 population-density and F6/F7 age-density factors are dropped for report fidelity.')
  if (options.dropF0) logic.push('F0 crosswalk proximity is excluded.')
  if (options.dropC0) logic.push('C0 daycare proximity is excluded.')
  if (options.dropF8) logic.push('F8 intercity bus proximity is excluded.')
  if (options.dropSuppPoi) logic.push('A1/E0/E1/E2/E3 supplemental housing and entertainment POIs are excluded.')
  if (options.tightBuffer) logic.push('Area and line association buffer is 10m instead of 20m.')
  return logic
}

export function isFactorDroppedByOptions(ref: string, options: HeatmapOptionState): boolean {
  if (options.dropPopAge && ['F2', 'F3', 'F4', 'F6', 'F7'].includes(ref)) return true
  if (options.dropF0 && ref === 'F0') return true
  if (options.dropC0 && ref === 'C0') return true
  if (options.dropF8 && ref === 'F8') return true
  if (options.dropSuppPoi && ['A1', 'E0', 'E1', 'E2', 'E3'].includes(ref)) return true
  return false
}

export function factorWeightKey(weights: HeatmapFactorWeightState): string {
  return WALKABILITY_FACTOR_GROUPS
    .map((factor) => `${factor.ref}:${Number(weights[factor.ref] ?? 1).toFixed(2)}`)
    .join('|')
}

/** Minimal shape of a prebuilt grid variant needed to recover its option state. */
export interface HeatmapVariantConfigLike {
  config: Record<string, boolean>
  areaBufferM: number
}

export function optionsForHeatmapVariant(variant?: HeatmapVariantConfigLike | null): HeatmapOptionState {
  if (!variant) return HEATMAP_EMPTY_OPTIONS
  return {
    dropGtfsHf: Boolean(variant.config.drop_gtfs_hf),
    narrowCivic: Boolean(variant.config.narrow_civic),
    narrowGrowth: Boolean(variant.config.narrow_growth),
    dropPopAge: Boolean(variant.config.drop_pop_age),
    dropF0: Boolean(variant.config.drop_f0),
    dropC0: Boolean(variant.config.drop_c0),
    dropF8: Boolean(variant.config.drop_f8),
    dropSuppPoi: Boolean(variant.config.drop_supp_poi),
    tightBuffer: variant.areaBufferM === 10,
  }
}

export function normalizeHeatmapOptions(options: HeatmapOptionState): HeatmapOptionState {
  return { ...HEATMAP_EMPTY_OPTIONS, ...options }
}

export function variantKeyForHeatmapOptions(options: HeatmapOptionState): string {
  const extraDrops = [options.dropF0, options.dropC0, options.dropF8, options.dropSuppPoi].filter(Boolean).length
  if (options.dropPopAge && options.tightBuffer && options.dropF0 && options.dropC0 && options.dropF8 && options.dropSuppPoi) return 'most_conservative'
  if (options.dropPopAge && options.tightBuffer && extraDrops === 0) return 'rf_tight_buffer_10m'
  if (options.dropPopAge && !options.tightBuffer && extraDrops === 1) {
    if (options.dropF0) return 'rf_drop_f0'
    if (options.dropC0) return 'rf_drop_c0'
    if (options.dropF8) return 'rf_drop_f8'
    return 'rf_drop_supp_poi'
  }
  if (options.dropPopAge) return 'report_fidelity'
  if (options.narrowGrowth) return 'narrow_growth'
  if (options.narrowCivic) return 'narrow_civic'
  if (options.dropGtfsHf) return 'no_gtfs_hf'
  return 'full'
}
