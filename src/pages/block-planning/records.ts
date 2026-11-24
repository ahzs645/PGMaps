/**
 * Calculations kept with the plan so they travel with it into the assessment record and the
 * printed summary: the Board check (`boardCheck.ts`) and Objectives A and B (`oldForest/`). Each
 * record carries the key of the inputs it was calculated from; a record whose key no longer matches
 * the plan is shown and exported as out of date, never as current. Neither starts or feeds a run.
 *
 * DOM- and network-free.
 */
import type { Plan, Shape } from './plan'
import type { OldForestRepresentation } from './oldForest/representation'

export interface BoardCheckRecord {
  ranOn: string
  key: string
  /** Fires left out of the check (harvests only, as the Board's figures were built). */
  firesLeftOut?: number
  years: { year: number; shares: (number | null)[]; totalHa: number }[]
}

export interface OldForestYear {
  year: number
  cflbHa: number
  requiredOldHa: number
  oldHa: number
  countedNotOldHa: number
  requiredNonPineHa: number | null
  nonPineOldHa: number
  unknownAgeHa: number
  requiredInteriorHa: number
  interiorHa: number | null
  /** D.4 (`oldForest/youngerStands.ts`), present only when it was on: supplies uncapped, the rest capped at 20%. */
  d4OldSupplyHa?: number
  d4OldHa?: number
  d4InteriorSupplyHa?: number | null
  d4InteriorHa?: number | null
}

/** One unit of a D.2 pool (`oldForest/pooling.ts`), with its own figures beside the pool's. */
export interface OldForestPoolUnit {
  district: string
  unit: string
  source: string
  cflbProxyHa: number
  /** The CFLB stated for this unit, if any. */
  cflbEnteredHa?: number
  gisFraction: number | null
  projectedYear: number
  counts: OldForestRecord['counts']
  schedules: { schedule: string; years: OldForestYear[] }[]
  calibration2019: OldForestYear | null
  /** D.3's summary for this unit (`oldForest/representation.ts`); absent in a record made before it. */
  representation?: OldForestRepresentation
}

export const OLD_FOREST_EXCLUDED_KINDS = ['non-crown', 'tfl', 'woodlot', 'community-forest'] as const
export const CORRIDOR_KINDS = ['fsr', 'railway', 'transmission', 'pipeline'] as const
export type CorridorKind = (typeof CORRIDOR_KINDS)[number]

export interface OldForestExclusion {
  kind: (typeof OLD_FOREST_EXCLUDED_KINDS)[number]
  records: number
  grossHa: number
  cflbHa: number
}

/**
 * The calculation's version, part of the key: a record from an earlier one is out of date. 1 counted
 * the unit's whole ground; 2 leaves out ground the order does not apply to and reads pipelines.
 */
export const OLD_FOREST_CALCULATION = 2

export interface OldForestRecord {
  ranOn: string
  readOn: string
  key: string
  district: string
  unit: string
  source: string
  cflbProxyHa: number
  gisFraction: number | null
  projectedYear: number
  counts: { stands: number; ogmas: number; parks: number; retention: number; corridors: number }
  /**
   * Ground left out of the unit because the order does not apply there (`oldForest/landBase.ts`),
   * by kind: its area in the unit and the proxy CFLB on it. Absent in a record made before it was read.
   */
  excluded?: OldForestExclusion[]
  /** Corridor features read, by kind. Absent in a record made before pipelines were read. */
  corridorKinds?: Partial<Record<CorridorKind, number>>
  schedules: { schedule: string; years: OldForestYear[] }[]
  /** The baseline alone in 2019, beside the Board's 2019 figures. Null when the unit has none. */
  calibration2019: OldForestYear | null
  /** D.4 as stated when it was on: the age from which younger stands counted and the benefit relied on. */
  younger?: { fromAge: number; benefit: string }
  /**
   * D.2: every unit pooled, the chosen one first, each with its own figures. Present only when
   * pooled; `schedules` are then the pool's sums, and the fields above the chosen unit's own.
   */
  pool?: OldForestPoolUnit[]
  /**
   * D.3's summary for the chosen unit, the schedule under review, every year: old forest beside the
   * CFLB proxy by BEC variant, leading species, age class and site index. An output, never a key's
   * input; absent in a record made before it, which stays current.
   */
  representation?: OldForestRepresentation
}

/** What the reviewer chooses for Objectives A and B (docs/forestry-old-forest.md). */
export interface OldForestChoices {
  district: string
  unit: string
  countNonLegalOgmas: boolean
  countParks: boolean
  interiorMethod: '2005' | '2004'
  /** A CFLB the reviewer states, with where it came from. Absent: the VRI proxy. */
  cflbEnteredHa?: number
  cflbSource?: string
  /** Spatial retention or recruitment areas D.1 counts whole, each with its approval reference. */
  retentionAreas: { id: string; name: string; reference: string; geometry: Shape }[]
  /** D.4, switched on by the reviewer: the age younger stands count from (no default) and the benefit. */
  younger?: { fromAge?: number; benefit: string }
  /** D.2: units pooled with this one, the reviewer's choice; never pooled by default (decision 5). */
  pooledWith?: { district: string; unit: string; cflbEnteredHa?: number; cflbSource?: string }[]
}

export interface PlanChecks {
  board?: BoardCheckRecord
  oldForest?: OldForestRecord
}

/** FNV-1a over a string: a short, stable key for "were these the inputs". */
export function hashKey(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export const shapeSignature = (g: Shape) => {
  const flat = JSON.stringify(g.coordinates)
  return `${g.type}:${flat.length}:${hashKey(flat)}`
}

const baselineSignature = (plan: Pick<Plan, 'baseline'>) =>
  plan.baseline.map((d) => `${d.id}|${d.year}|${d.kind}|${shapeSignature(d.geometry)}`).join(';')

/** The Board check's inputs: the area and the baseline. */
export const boardCheckKey = (plan: Pick<Plan, 'area' | 'baseline'>) =>
  hashKey(
    JSON.stringify({
      district: plan.area.district,
      ndu: plan.area.ndu,
      unit: plan.area.unit ? shapeSignature(plan.area.unit.geometry) : null,
      patchExtent: plan.area.patchExtent ?? 'whole',
      baseline: baselineSignature(plan),
    }),
  )

/** A and B's inputs: the choices, the baseline, the blocks, the schedules and the first year. */
export const oldForestKey = (plan: Pick<Plan, 'area' | 'baseline' | 'blocks' | 'schedules' | 'oldForest'>) =>
  hashKey(
    JSON.stringify({
      calculation: OLD_FOREST_CALCULATION,
      choices: plan.oldForest
        ? {
            ...plan.oldForest,
            retentionAreas: plan.oldForest.retentionAreas.map((r) => `${r.id}|${shapeSignature(r.geometry)}`),
          }
        : null,
      startYear: plan.area.startYear,
      baseline: baselineSignature(plan),
      blocks: plan.blocks.map(
        (b) => `${b.id}|${b.shapes.map((s) => `${s.id}:${shapeSignature(s.geometry)}`).join(',')}`,
      ),
      schedules: plan.schedules,
    }),
  )

export const boardCheckCurrent = (plan: Plan) => plan.checks?.board?.key === boardCheckKey(plan)
export const oldForestCurrent = (plan: Plan) => plan.checks?.oldForest?.key === oldForestKey(plan)

export interface Shortfall {
  year: number
  what: string[]
}

/** Old forest held, with what D.4 counts (capped) when it was on. */
const oldHeld = (y: OldForestYear) => y.oldHa + (y.d4OldHa ?? 0)
const interiorHeld = (y: OldForestYear) => (y.interiorHa === null ? null : y.interiorHa + (y.d4InteriorHa ?? 0))

/**
 * The first year at which old, non-pine or interior forest falls short, or null. D.4's younger
 * stands count toward old and interior when it was on; `metOnlyWithD4` says where they made the
 * difference, and `shortfallText` puts both in words.
 */
export function firstShortfall(years: OldForestYear[]): Shortfall | null {
  for (const y of years) {
    const what: string[] = []
    if (oldHeld(y) < y.requiredOldHa) what.push('old')
    if (y.requiredNonPineHa !== null && y.nonPineOldHa < y.requiredNonPineHa) what.push('old non-pine')
    const interior = interiorHeld(y)
    if (interior !== null && interior < y.requiredInteriorHa) what.push('old interior')
    if (what.length) return { year: y.year, what }
  }
  return null
}

/** The first year an objective is met only because D.4's younger stands were counted, or null. */
export function metOnlyWithD4(years: OldForestYear[]): Shortfall | null {
  for (const y of years) {
    const what: string[] = []
    if (y.oldHa < y.requiredOldHa && oldHeld(y) >= y.requiredOldHa) what.push('old')
    const interior = interiorHeld(y)
    if (y.interiorHa !== null && y.interiorHa < y.requiredInteriorHa && interior! >= y.requiredInteriorHa)
      what.push('old interior')
    if (what.length) return { year: y.year, what }
  }
  return null
}

/** The one wording of a schedule's outcome, for the panel, the summary, the record and D.5(a). */
export function shortfallText(years: OldForestYear[]): string {
  const short = firstShortfall(years)
  const d4 = metOnlyWithD4(years)
  const base = short ? `short of ${short.what.join(', ')} from ${short.year}` : 'no shortfall over the projection'
  return d4 ? `${base}; ${d4.what.join(' and ')} met only with D.4 from ${d4.year}` : base
}
