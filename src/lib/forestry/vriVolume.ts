/** Inventory volume conventions aligned with main's dev-avast/vriFill.ts.
 * Pure arithmetic and null-preserving parsing; no map, network or LiDAR factor.
 */
export type VriUtilization = 125 | 175 | 225
export type VriUtilizationRule = VriUtilization | 'species'
export type VriDeadRule = 'none' | 'full' | 'shelf'
export interface VriVolumeAttributes {
  featureId: string
  treed: boolean
  speciesCode: string | null
  ageYears: number | null
  referenceYear: number | null
  projectedDate: string | null
  interpretationDate: string | null
  heightMeters: number | null
  basalAreaM2Ha: number | null
  stemsPerHa: number | null
  crownClosurePercent: number | null
  disturbanceType: string | null
  disturbanceYear: number | null
  live: Record<VriUtilization, number | null>
  dead: Record<VriUtilization, number | null>
}
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null)
const string = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
export function parseVriVolumeProperties(p: Record<string, unknown>): VriVolumeAttributes {
  const year = Number.parseInt(String(p.EARLIEST_NONLOGGING_DIST_DATE ?? ''), 10)
  return {
    featureId: String(p.FEATURE_ID ?? ''),
    treed: string(p.BCLCS_LEVEL_2)?.toUpperCase() === 'T',
    speciesCode: string(p.SPECIES_CD_1)?.toUpperCase() ?? null,
    ageYears: finite(p.PROJ_AGE_1),
    referenceYear: finite(p.REFERENCE_YEAR),
    projectedDate: string(p.PROJECTED_DATE)?.replace(/Z$/, '') ?? null,
    interpretationDate: string(p.INTERPRETATION_DATE)?.replace(/Z$/, '') ?? null,
    heightMeters: finite(p.PROJ_HEIGHT_1),
    basalAreaM2Ha: finite(p.BASAL_AREA),
    stemsPerHa: finite(p.VRI_LIVE_STEMS_PER_HA),
    crownClosurePercent: finite(p.CROWN_CLOSURE),
    disturbanceType: string(p.EARLIEST_NONLOGGING_DIST_TYPE),
    disturbanceYear: Number.isFinite(year) && year >= 1800 && year <= 2200 ? year : null,
    live: {
      125: finite(p.LIVE_STAND_VOLUME_125),
      175: finite(p.LIVE_STAND_VOLUME_175),
      225: finite(p.LIVE_STAND_VOLUME_225),
    },
    dead: {
      125: finite(p.DEAD_STAND_VOLUME_125),
      175: finite(p.DEAD_STAND_VOLUME_175),
      225: finite(p.DEAD_STAND_VOLUME_225),
    },
  }
}
export function vriUtilizationFor(species: string | null, rule: VriUtilizationRule): VriUtilization | null {
  if (rule !== 'species') return rule
  return species ? (species.toUpperCase().startsWith('P') ? 125 : 175) : null
}
/** Same historical PG TSA scenario curve as AVAST: year 1=100%, 2=80%, 15+=40%. */
export function pgShelfLife(years: number): number {
  if (!Number.isFinite(years) || years < 0) throw Error('Years since death must be nonnegative')
  return years <= 1 ? 1 : years >= 15 ? 0.4 : 0.8 - (0.4 * (years - 2)) / 13
}
/** Historical ground/inventory ratios used by AVAST, not a validation of this tile. */
export function pgAuditRatio(species: string | null): number | null {
  if (!species) return null
  const code = species.toUpperCase()
  return code.startsWith('P') ? 0.836 : code.startsWith('S') ? 0.946 : code.startsWith('B') ? 1.246 : 1.159
}
export interface VriVolumeRules {
  utilization: VriUtilizationRule
  dead: VriDeadRule
  minAge: number
  asOfYear: number
  unknownDeathYears: number
}
export const VRI_BASELINE_RULES: VriVolumeRules = {
  utilization: 175,
  dead: 'none',
  minAge: 0,
  asOfYear: 2026,
  unknownDeathYears: 10,
}
export const VRI_PG_SCENARIO: VriVolumeRules = {
  ...VRI_BASELINE_RULES,
  utilization: 'species',
  dead: 'shelf',
  minAge: 60,
}
export interface VriDensityResult {
  density: number | null
  complete: boolean
  status: string
  utilization: VriUtilization | null
  live: number | null
  reportedDead: number | null
  includedDead: number | null
  assumedDeathYears: boolean
}
export function inventoryDensity(p: VriVolumeAttributes, rules: VriVolumeRules): VriDensityResult {
  if (
    !Number.isFinite(rules.minAge) ||
    rules.minAge < 0 ||
    !Number.isFinite(rules.asOfYear) ||
    !Number.isFinite(rules.unknownDeathYears) ||
    rules.unknownDeathYears < 0
  )
    throw Error('Invalid VRI planning rules')
  const utilization = vriUtilizationFor(p.speciesCode, rules.utilization)
  const base = {
    utilization,
    live: utilization ? p.live[utilization] : null,
    reportedDead: utilization ? p.dead[utilization] : null,
    includedDead: null,
    assumedDeathYears: false,
  }
  if (!p.treed) return { ...base, density: null, complete: false, status: 'Non-treed inventory polygon' }
  if (rules.minAge > 0 && p.ageYears === null)
    return { ...base, density: null, complete: false, status: 'Stand age unavailable' }
  if (rules.minAge > 0 && p.ageYears! < rules.minAge)
    return { ...base, density: null, complete: false, status: 'Excluded by age filter' }
  if (utilization === null || base.live === null)
    return { ...base, density: null, complete: false, status: 'Live volume unavailable for utilization' }
  if (rules.dead === 'none')
    return { ...base, density: base.live, includedDead: 0, complete: true, status: 'Inventory net live volume' }
  if (base.reportedDead === null)
    return { ...base, density: base.live, complete: false, status: 'Known live volume only; dead volume unreported' }
  let fraction = 1,
    assumedDeathYears = false
  if (rules.dead === 'shelf' && base.reportedDead > 0) {
    // An earliest disturbance date is a scenario proxy for death, not a verified tree death year.
    const years =
      p.disturbanceYear !== null && p.disturbanceYear <= rules.asOfYear
        ? rules.asOfYear - p.disturbanceYear
        : rules.unknownDeathYears
    assumedDeathYears = p.disturbanceYear === null || p.disturbanceYear > rules.asOfYear
    fraction = pgShelfLife(years)
  }
  const includedDead = base.reportedDead * fraction
  return {
    ...base,
    density: base.live + includedDead,
    includedDead,
    assumedDeathYears,
    complete: true,
    status: rules.dead === 'shelf' ? 'Live + shelf-life scenario for reported dead' : 'Live + reported net dead volume',
  }
}
