/**
 * Calculations kept with the plan so they travel with it into the assessment record and the
 * printed summary: the Board check (`boardCheck.ts`) and Objectives A and B (`oldForest/`). Each
 * record carries the key of the inputs it was calculated from; a record whose key no longer matches
 * the plan is shown and exported as out of date, never as current. Neither starts or feeds a run.
 *
 * DOM- and network-free.
 */
import type { Plan, Shape } from './plan'

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
}

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
  schedules: { schedule: string; years: OldForestYear[] }[]
  /** The baseline alone in 2019, beside the Board's 2019 figures. Null when the unit has none. */
  calibration2019: OldForestYear | null
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

/** The first year at which old, non-pine or interior forest falls short, or null. */
export function firstShortfall(years: OldForestYear[]): { year: number; what: string[] } | null {
  for (const y of years) {
    const what: string[] = []
    if (y.oldHa < y.requiredOldHa) what.push('old')
    if (y.requiredNonPineHa !== null && y.nonPineOldHa < y.requiredNonPineHa) what.push('old non-pine')
    if (y.interiorHa !== null && y.interiorHa < y.requiredInteriorHa) what.push('old interior')
    if (what.length) return { year: y.year, what }
  }
  return null
}
