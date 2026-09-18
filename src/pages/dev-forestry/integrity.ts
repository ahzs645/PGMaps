/** Shared integrity rules. No DOM, network, or hidden current-date assumptions. */
import type { AnalysisInput, AnalysisResult, TargetPolygon } from './types'
import { DEFAULT_VISUAL_QUALITY_THRESHOLDS, vacDenudationPercent, type AlterationBasis, type VisualQualityClassId, type VisualQualityThresholds, type VacRating } from './vqo'

/** Canonical input comparison, not a cryptographic signature. It deliberately keeps the full value. */
export function canonicalInput(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('A scenario contains a non-finite input.')
    const scalar = JSON.stringify(value)
    if (scalar === undefined) throw new Error('A scenario contains a non-JSON value.')
    return scalar
  }
  if (Array.isArray(value)) return `[${value.map(canonicalInput).join(',')}]`
  const object = value as Record<string, unknown>
  return `{${Object.keys(object).filter((key) => object[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalInput(object[key])}`).join(',')}}`
}

export function activeLandform<T extends { id: string; role: string }>(targets: readonly T[], id?: string | null): T | null {
  const forms = targets.filter((target) => target.role === 'landscape')
  if (id) {
    const selected = forms.find((target) => target.id === id)
    if (!selected) throw new Error('The active landform no longer exists. Select a landform and run again.')
    return selected
  }
  if (forms.length > 1) throw new Error('Select one active landform. Unrelated landforms cannot share a denominator.')
  return forms[0] ?? null
}

/** Existing alteration is a planning estimate unless recovery was explicitly assessed. */
export function alterationWeight(target: Pick<TargetPolygon, 'role' | 'harvestYear' | 'clearcutPercent' | 'siteDisturbance'> & { recoveryPercent?: number | null }, assessmentYear: number, greenUpAgeYears: number): number {
  if (target.role === 'landscape') return 0
  if (target.role === 'block' || target.siteDisturbance) return 1
  const clearcut = target.clearcutPercent == null ? 1 : Math.min(1, Math.max(0, target.clearcutPercent / 100))
  if (target.harvestYear != null && target.harvestYear > assessmentYear) return 0
  if (target.recoveryPercent != null) return clearcut * (1 - Math.min(1, Math.max(0, target.recoveryPercent / 100)))
  const recovered = target.harvestYear != null && assessmentYear - target.harvestYear >= greenUpAgeYears
  return recovered ? 0 : clearcut
}

/** Union accounting at one shared ground sample. Duplicate polygons never add area. */
export function unionContributions(existingWeights: readonly number[], proposed: boolean, road: boolean): { existing: number; proposed: number; disturbance: number } {
  const existing = existingWeights.reduce((best, weight) => Math.max(best, Math.min(1, Math.max(0, weight))), 0)
  const increment = proposed ? 1 - existing : 0
  // Line b is outside openings. A road within an opening is not counted a second time.
  const disturbance = road && !proposed && existingWeights.length === 0 ? 1 : 0
  return { existing, proposed: increment, disturbance }
}

export type ResolvedThreshold = { value: number; source: 'user-override' | 'VAC' | 'midpoint-assumption' | 'perspective-range'; note: string }
/** The number used by the badge MUST be the number reported in the worksheet. */
export function resolveThreshold(id: VisualQualityClassId, basis: AlterationBasis, thresholds: VisualQualityThresholds, vac: VacRating | null): ResolvedThreshold {
  const configured = thresholds[basis]?.[id]
  const original = DEFAULT_VISUAL_QUALITY_THRESHOLDS[basis][id]
  if (Number.isFinite(configured) && configured !== original) {
    if (configured < 0 || configured > 100) throw new Error('A threshold must be between 0 and 100%.')
    return { value: configured, source: 'user-override', note: 'Explicit custom planning threshold; not an automatically verified site requirement.' }
  }
  if (basis === 'perspective') return { value: original, source: 'perspective-range', note: 'Research range in perspective view; numerical screening only, not a final VQO determination.' }
  if (vac) return { value: vacDenudationPercent(id, vac), source: 'VAC', note: `1998 Table 4, ${vac} VAC; timber-supply planning only.` }
  // March 1998 Procedures p.6 recommends the mid-point when a full inventory is lacking.
  // These are the documented Table 4 medium figures, not the generic class maximum.
  return { value: vacDenudationPercent(id, 'medium'), source: 'midpoint-assumption', note: 'No VAC supplied: Table 4 medium/mid-range planning assumption. Confirm the applicable management assumption.' }
}

export function resolvedThresholds(id: VisualQualityClassId, basis: AlterationBasis, thresholds: VisualQualityThresholds, vac: VacRating | null): VisualQualityThresholds {
  const ids = Object.keys(DEFAULT_VISUAL_QUALITY_THRESHOLDS[basis]) as VisualQualityClassId[]
  // Resolve every class on the same basis, so the supporting class label cannot
  // mix a low-VAC objective with generic maximum thresholds for the other classes.
  const values = Object.fromEntries(ids.map((classId) => [classId, resolveThreshold(classId, basis, thresholds, vac).value]))
  return { ...thresholds, [basis]: { ...thresholds[basis], ...values, [id]: resolveThreshold(id, basis, thresholds, vac).value } }
}

export function resultMatchesInput(result: AnalysisResult | null, input: AnalysisInput): boolean {
  return !!result?.inputSignature && result.inputSignature === canonicalInput(input)
}
