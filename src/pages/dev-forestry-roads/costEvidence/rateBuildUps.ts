/**
 * Saved rate build-ups: the material, truck-cycle and equipment calculators' inputs kept in the
 * project, so a reopened estimate can answer "why this rate, and what changes if the pit or the
 * truck changes?". A build-up is applied to a rate the same way an evidence record is adopted
 * (`rateAdoption.ts`): the rate stores a snapshot of the build-up's formula and result, and a later
 * edit to the build-up flags the rate as out of step instead of moving it. A truck cycle can be
 * entered whole or from its parts (load, loaded travel, unload, empty return, queue). Free of DOM
 * and network access.
 */
import { list, object, oneOf, optional, text } from '@/lib/jsonGuards'
import {
  calculateEquipmentUnitCost,
  calculateMaterialUnitCost,
  calculateTruckCycleUnitCost,
  type CostUnitRateResult,
  type EquipmentUnitCostInput,
  type MaterialUnitCostInput,
  type TruckCycleUnitCostInput,
} from '../costRateTools'
import type { MeasureBasis } from './adoptionTargets'

export type BuildUpKind = 'material' | 'truck-cycle' | 'equipment'

export const BUILD_UP_KINDS: Record<BuildUpKind, { label: string; basis: MeasureBasis; unit: string }> = {
  material: { label: 'Material price', basis: 'compacted-m3', unit: '/m³' },
  'truck-cycle': { label: 'Truck cycle', basis: 'compacted-m3', unit: '/m³' },
  equipment: { label: 'Equipment and crew', basis: 'bank-m3', unit: '/m³' },
}

/** One truck trip, part by part. Travel is one-way km at each direction's average speed. */
export interface TruckCycleParts {
  loadMinutes: number | null
  haulKm: number | null
  loadedKmh: number | null
  unloadMinutes: number | null
  emptyKmh: number | null
  queueMinutes: number | null
}

export interface RateBuildUp {
  id: string
  name: string
  kind: BuildUpKind
  material?: MaterialUnitCostInput
  truck?: TruckCycleUnitCostInput & { parts?: TruckCycleParts }
  equipment?: EquipmentUnitCostInput
  /** Where the input prices came from: "Quote 2026-118, Smith Gravel". */
  quote?: string
  notes?: string
  savedOn: string
}

/** What a rate keeps of the build-up it was set from. */
export interface BuildUpSnapshot {
  id: string
  name: string
  kind: BuildUpKind
  formula: string
  result: number
}

export const BUILD_UP_LIMITS = { maxBuildUps: 50, maxText: 300, maxValue: 1e7 } as const

const n = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined
    ? '?'
    : value.toLocaleString('en-CA', { maximumFractionDigits: digits, minimumFractionDigits: 0 })

const positive = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
const nonNegative = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0

/** Minutes for one complete trip from its parts, or null while any part is missing. */
export function truckCycleMinutes(parts: TruckCycleParts): number | null {
  const { loadMinutes, haulKm, loadedKmh, unloadMinutes, emptyKmh, queueMinutes } = parts
  if (!nonNegative(loadMinutes) || !nonNegative(unloadMinutes) || !nonNegative(queueMinutes)) return null
  if (!nonNegative(haulKm) || !positive(loadedKmh) || !positive(emptyKmh)) return null
  return loadMinutes + (60 * haulKm) / loadedKmh + unloadMinutes + (60 * haulKm) / emptyKmh + queueMinutes
}

export interface BuildUpResult {
  result: CostUnitRateResult
  /** "165 × 42 min ÷ 60 ÷ 10 m³ = 11.55 per compacted m³". */
  formula: string
  /** The cycle from its parts, when entered that way. */
  cycleMinutes?: number | null
}

export function calculateBuildUp(
  buildUp: Pick<RateBuildUp, 'kind' | 'material' | 'truck' | 'equipment'>,
): BuildUpResult {
  if (buildUp.kind === 'material') {
    const input = buildUp.material ?? {
      quoteUnit: null,
      priceCad: null,
      tonnesPerCompactedM3: null,
      looseM3PerCompactedM3: null,
    }
    const result = calculateMaterialUnitCost(input)
    const formula =
      input.quoteUnit === 'tonne'
        ? `${n(input.priceCad)}/t × ${n(input.tonnesPerCompactedM3, 3)} t per compacted m³`
        : input.quoteUnit === 'loose-yd3'
          ? `${n(input.priceCad)}/loose yd³ ÷ 0.7646 × ${n(input.looseM3PerCompactedM3, 3)} loose m³ per compacted m³`
          : 'Choose the quote unit'
    return { result, formula: withResult(formula, result, 'per compacted m³') }
  }
  if (buildUp.kind === 'truck-cycle') {
    const truck = buildUp.truck ?? { allInRateCadPerHour: null, cycleMinutes: null, compactedPayloadM3: null }
    const fromParts = truck.parts ? truckCycleMinutes(truck.parts) : undefined
    const cycleMinutes = truck.parts ? (fromParts ?? null) : truck.cycleMinutes
    const result = calculateTruckCycleUnitCost({ ...truck, cycleMinutes })
    if (truck.parts && fromParts === null) result.errors.unshift('Enter every part of the cycle.')
    const p = truck.parts
    const cycle = p
      ? `(${n(p.loadMinutes, 1)} load + 60 × ${n(p.haulKm, 2)} km ÷ ${n(p.loadedKmh, 0)} km/h + ${n(p.unloadMinutes, 1)} unload + 60 × ${n(p.haulKm, 2)} km ÷ ${n(p.emptyKmh, 0)} km/h + ${n(p.queueMinutes, 1)} queue = ${n(cycleMinutes, 1)} min)`
      : `${n(cycleMinutes, 1)} min`
    const formula = `${n(truck.allInRateCadPerHour)}/h × ${cycle} ÷ 60 ÷ ${n(truck.compactedPayloadM3, 2)} compacted m³ a load`
    return { result, formula: withResult(formula, result, 'per compacted m³'), cycleMinutes }
  }
  const input = buildUp.equipment ?? { allInCrewCadPerHour: null, netBankM3PerHour: null }
  const result = calculateEquipmentUnitCost(input)
  const formula = `${n(input.allInCrewCadPerHour)}/h ÷ ${n(input.netBankM3PerHour, 1)} bank m³ an hour`
  return { result, formula: withResult(formula, result, 'per bank m³') }
}

const withResult = (formula: string, result: CostUnitRateResult, unit: string) =>
  result.valid && result.unitCostCad !== null ? `${formula} = ${n(result.unitCostCad)} ${unit}` : formula

/** The snapshot a rate keeps, or null while the build-up does not calculate. */
export function buildUpSnapshot(buildUp: RateBuildUp): BuildUpSnapshot | null {
  const { result, formula } = calculateBuildUp(buildUp)
  if (!result.valid || result.unitCostCad === null) return null
  return { id: buildUp.id, name: buildUp.name, kind: buildUp.kind, formula, result: result.unitCostCad }
}

export function withBuildUp(buildUps: readonly RateBuildUp[] | undefined, buildUp: RateBuildUp): RateBuildUp[] {
  const list = buildUps ?? []
  const at = list.findIndex((item) => item.id === buildUp.id)
  return at < 0 ? [...list, buildUp] : list.map((item, i) => (i === at ? buildUp : item))
}

export function withoutBuildUp(buildUps: readonly RateBuildUp[] | undefined, id: string): RateBuildUp[] | undefined {
  const rest = (buildUps ?? []).filter((item) => item.id !== id)
  return rest.length ? rest : undefined
}

function value(raw: unknown, label: string): number | null {
  if (raw === null) return null
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > BUILD_UP_LIMITS.maxValue)
    throw Error(`${label} must be empty or between 0 and ${BUILD_UP_LIMITS.maxValue}.`)
  return raw
}

export function parseRateBuildUps(raw: unknown): RateBuildUp[] | undefined {
  if (raw === undefined) return undefined
  const items = list(raw, 'Rate build-ups', BUILD_UP_LIMITS.maxBuildUps).map((entry, index): RateBuildUp => {
    const label = `Rate build-up ${index + 1}`
    const r = object(entry, label)
    const kind = oneOf(r.kind, `${label} kind`, Object.keys(BUILD_UP_KINDS) as BuildUpKind[])
    const savedOn = text(r.savedOn, `${label} date`, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(savedOn)) throw Error(`${label} date must be YYYY-MM-DD.`)
    const field = (o: Record<string, unknown>, key: string) => value(o[key] ?? null, `${label} ${key}`)
    const material = optional(r, 'material', (v) => {
      const o = object(v, `${label} material`)
      return {
        quoteUnit:
          o.quoteUnit === null ? null : oneOf(o.quoteUnit, `${label} quote unit`, ['tonne', 'loose-yd3'] as const),
        priceCad: field(o, 'priceCad'),
        tonnesPerCompactedM3: field(o, 'tonnesPerCompactedM3'),
        looseM3PerCompactedM3: field(o, 'looseM3PerCompactedM3'),
      }
    })
    const truck = optional(r, 'truck', (v) => {
      const o = object(v, `${label} truck`)
      const parts = optional(o, 'parts', (p) => {
        const q = object(p, `${label} cycle parts`)
        return {
          loadMinutes: field(q, 'loadMinutes'),
          haulKm: field(q, 'haulKm'),
          loadedKmh: field(q, 'loadedKmh'),
          unloadMinutes: field(q, 'unloadMinutes'),
          emptyKmh: field(q, 'emptyKmh'),
          queueMinutes: field(q, 'queueMinutes'),
        }
      })
      return {
        allInRateCadPerHour: field(o, 'allInRateCadPerHour'),
        cycleMinutes: field(o, 'cycleMinutes'),
        compactedPayloadM3: field(o, 'compactedPayloadM3'),
        ...(parts ? { parts } : {}),
      }
    })
    const equipment = optional(r, 'equipment', (v) => {
      const o = object(v, `${label} equipment`)
      return { allInCrewCadPerHour: field(o, 'allInCrewCadPerHour'), netBankM3PerHour: field(o, 'netBankM3PerHour') }
    })
    const quote = optional(r, 'quote', (v) => text(v, `${label} quote`, BUILD_UP_LIMITS.maxText))
    const notes = optional(r, 'notes', (v) => text(v, `${label} notes`, BUILD_UP_LIMITS.maxText))
    return {
      id: text(r.id, `${label} ID`, 80),
      name: text(r.name, `${label} name`, 120),
      kind,
      ...(material ? { material } : {}),
      ...(truck ? { truck } : {}),
      ...(equipment ? { equipment } : {}),
      ...(quote ? { quote } : {}),
      ...(notes ? { notes } : {}),
      savedOn,
    }
  })
  const ids = items.map((item) => item.id)
  if (new Set(ids).size !== ids.length) throw Error('Rate build-ups must have distinct IDs.')
  return items.length ? items : undefined
}
