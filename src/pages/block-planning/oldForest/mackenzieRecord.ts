/**
 * The Mackenzie calculation's choices and record, kept with the plan (`plan.mackenzieOldForest`,
 * `checks.mackenzieOldForest`) as the Prince George one is: keyed to the choices, the baseline, the
 * blocks, the schedules and the first year, so a changed input shows it out of date. It never feeds
 * the patch run or a review: the Mackenzie pack's margins stay the reviewer's answers, with this
 * record shown beside them as evidence (`mackenzieEvidence.ts`).
 *
 * DOM- and network-free.
 */
import { int, list, object, oneOf, optional, text, type JsonObject } from '@/lib/jsonGuards'
import type { Plan } from '../plan'
import { hashKey, shapeSignature, type OldForestExclusion } from '../records'
import type { KeptTenure } from './mackenzieReads'
import type { MackenzieRowYear, MackenzieYear, OutsideRows } from './mackenzie'
import { mackenzieUnit, MACKENZIE_UNITS, type BecGroup } from './mackenzieUnits'

/** The calculation's version, part of the key: a record from another one is out of date. */
export const MACKENZIE_OLD_FOREST_CALCULATION = 1

/** Ground the Mackenzie order does not apply to (`mackenzieReads.ts`); TFLs stay. */
export const MACKENZIE_EXCLUDED_KINDS = ['non-crown', 'woodlot', 'community-forest'] as const

/** What the reviewer chooses for the Mackenzie calculation. */
export interface MackenzieOldForestChoices {
  /** A unit or group of the 2010 Table 2 (`MackenzieUnit.id`). */
  unit: string
  /** Objective 2(d) and 3(b): the named park joins its unit. Off by default. */
  countPark: boolean
  /** 2(a): the share of the area the epidemic affected, and where it comes from. Absent: no cap stated. */
  affectedPercent?: number
  affectedSource?: string
  /** 2(b): switched on by the reviewer, with the age younger stands count from (no default) and the benefit. */
  younger?: { fromAge?: number; benefit: string }
}

export interface MackenzieOldForestRecord {
  ranOn: string
  readOn: string
  key: string
  unit: string
  source: string
  /** The 2(d) park that joined the unit, as the order names it; null when none did. */
  park: string | null
  cflbProxyHa: number
  projectedYear: number
  counts: { stands: number; corridors: number; lakes: number }
  excluded: OldForestExclusion[]
  /** Community forests larger than 600 ha: the order applies to them, so they stay in. */
  keptCommunityForests: KeptTenure[]
  /** CFLB no row of the unit holds, by BEC label. */
  outsideRows: OutsideRows[]
  affected?: { percent: number; source: string }
  younger?: { fromAge: number; benefit: string }
  schedules: { schedule: string; years: MackenzieYear[] }[]
  /** The baseline alone in the published figure's year, for a unit with a published row. */
  published?: MackenzieYear
}

/** Why the 2(b) choice cannot calculate yet, or null. */
export function mackenzieYoungerProblem(younger: MackenzieOldForestChoices['younger']): string | null {
  if (!younger) return null
  if (younger.fromAge === undefined) return 'State the age younger stands count from: there is no default.'
  if (younger.fromAge >= 141)
    return 'Younger stands are less than the age of old: the age they count from must be below 141.'
  if (!younger.benefit.trim())
    return 'State the equal or better conservation benefit 2(b) requires before younger stands count.'
  return null
}

const baselineSignature = (plan: Pick<Plan, 'baseline'>) =>
  plan.baseline.map((d) => `${d.id}|${d.year}|${d.kind}|${shapeSignature(d.geometry)}`).join(';')

/** The calculation's inputs: the choices, the baseline, the blocks, the schedules and the first year. */
export const mackenzieOldForestKey = (
  plan: Pick<Plan, 'area' | 'baseline' | 'blocks' | 'schedules' | 'mackenzieOldForest'>,
) =>
  hashKey(
    JSON.stringify({
      calculation: MACKENZIE_OLD_FOREST_CALCULATION,
      // Field by field, so a choice read back from a saved plan keys the same whatever its member order.
      choices: plan.mackenzieOldForest
        ? {
            unit: plan.mackenzieOldForest.unit,
            countPark: plan.mackenzieOldForest.countPark,
            affectedPercent: plan.mackenzieOldForest.affectedPercent ?? null,
            affectedSource: plan.mackenzieOldForest.affectedSource ?? null,
            younger: plan.mackenzieOldForest.younger
              ? {
                  fromAge: plan.mackenzieOldForest.younger.fromAge ?? null,
                  benefit: plan.mackenzieOldForest.younger.benefit,
                }
              : null,
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

export const mackenzieOldForestCurrent = (plan: Plan) =>
  !!plan.checks?.mackenzieOldForest && plan.checks.mackenzieOldForest.key === mackenzieOldForestKey(plan)

// ---------------------------------------------------------------------------------------------
// Parsing

const num = (v: unknown, label: string, min = 0, max = 1e9) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error(`${label} must be a number from ${min} to ${max}.`)
  return v
}
const numOrNull = (v: unknown, label: string) => (v === null ? null : num(v, label))
const day = (v: unknown, label: string) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw Error(`${label} must be YYYY-MM-DD.`)
  return v
}
const words = (v: unknown, label: string, max = 20_000) => {
  if (typeof v !== 'string' || v.length > max) throw Error(`${label} must be text of at most ${max} characters.`)
  return v
}
const UNIT_IDS = MACKENZIE_UNITS.map((u) => u.id)
const GROUPS: BecGroup[] = ['1', '2', '3', '4', '5', '6', '7', '6&7']
const YEARS = [1600, 2250] as const

export function parseMackenzieChoices(value: unknown): MackenzieOldForestChoices {
  const o = object(value, 'mackenzieOldForest')
  const choices: MackenzieOldForestChoices = {
    unit: oneOf(o.unit, 'mackenzieOldForest.unit', UNIT_IDS),
    countPark: typeof o.countPark === 'boolean' ? o.countPark : false,
  }
  const affected = optional(o, 'affectedPercent', (v) => num(v, 'mackenzieOldForest.affectedPercent', 0, 100))
  if (affected !== undefined) choices.affectedPercent = affected
  const source = optional(o, 'affectedSource', (v) => words(v, 'mackenzieOldForest.affectedSource', 2000))
  if (source) choices.affectedSource = source
  const younger = optional(o, 'younger', (v) => {
    const y = object(v, 'mackenzieOldForest.younger')
    const fromAge = optional(y, 'fromAge', (a) => int(a, 'mackenzieOldForest.younger.fromAge', 1, 1000))
    return {
      benefit: words(y.benefit ?? '', 'mackenzieOldForest.younger.benefit'),
      ...(fromAge === undefined ? {} : { fromAge }),
    }
  })
  if (younger) choices.younger = younger
  return choices
}

function parseRowYear(value: unknown, label: string): MackenzieRowYear {
  const r = object(value, label)
  const out: MackenzieRowYear = {
    row: text(r.row, `${label} row`, 40),
    cflbHa: num(r.cflbHa, `${label} cflbHa`),
    requiredOldHa: num(r.requiredOldHa, `${label} requiredOldHa`),
    oldHa: num(r.oldHa, `${label} oldHa`),
    deadOldHa: num(r.deadOldHa, `${label} deadOldHa`),
    nfaHa: num(r.nfaHa, `${label} nfaHa`),
    unknownAgeHa: num(r.unknownAgeHa, `${label} unknownAgeHa`),
    requiredInteriorHa: numOrNull(r.requiredInteriorHa, `${label} requiredInteriorHa`),
    interiorHa: numOrNull(r.interiorHa, `${label} interiorHa`),
  }
  if (r.youngerSupplyHa !== undefined) out.youngerSupplyHa = num(r.youngerSupplyHa, `${label} youngerSupplyHa`)
  if (r.youngerHa !== undefined) out.youngerHa = num(r.youngerHa, `${label} youngerHa`)
  return out
}

function parseYear(value: unknown, label: string): MackenzieYear {
  const y = object(value, label)
  return {
    year: int(y.year, `${label} year`, ...YEARS),
    rows: list(y.rows, `${label} rows`, 20).map((r, i) => parseRowYear(r, `${label} row ${i + 1}`)),
  }
}

export function parseMackenzieRecord(value: unknown): MackenzieOldForestRecord {
  const label = 'checks.mackenzieOldForest'
  const r: JsonObject = object(value, label)
  const counts = object(r.counts, `${label}.counts`)
  const record: MackenzieOldForestRecord = {
    ranOn: day(r.ranOn, `${label}.ranOn`),
    readOn: day(r.readOn, `${label}.readOn`),
    key: text(r.key, `${label}.key`, 40),
    unit: oneOf(r.unit, `${label}.unit`, UNIT_IDS),
    source: text(r.source, `${label}.source`, 2000),
    park: r.park === null ? null : text(r.park, `${label}.park`, 200),
    cflbProxyHa: num(r.cflbProxyHa, `${label}.cflbProxyHa`),
    projectedYear: int(r.projectedYear, `${label}.projectedYear`, ...YEARS),
    counts: {
      stands: int(counts.stands, `${label}.counts.stands`, 0, 1e7),
      corridors: int(counts.corridors, `${label}.counts.corridors`, 0, 1e7),
      lakes: int(counts.lakes, `${label}.counts.lakes`, 0, 1e7),
    },
    excluded: list(r.excluded, `${label}.excluded`, MACKENZIE_EXCLUDED_KINDS.length).map((e, i) => {
      const o = object(e, `${label}.excluded ${i + 1}`)
      return {
        kind: oneOf(o.kind, `${label}.excluded ${i + 1} kind`, MACKENZIE_EXCLUDED_KINDS),
        records: int(o.records, `${label}.excluded ${i + 1} records`, 0, 1e7),
        grossHa: num(o.grossHa, `${label}.excluded ${i + 1} grossHa`),
        cflbHa: num(o.cflbHa, `${label}.excluded ${i + 1} cflbHa`),
      }
    }),
    keptCommunityForests: list(r.keptCommunityForests, `${label}.keptCommunityForests`, 100).map((k, i) => {
      const o = object(k, `${label}.keptCommunityForests ${i + 1}`)
      return { file: text(o.file, `${label}.keptCommunityForests ${i + 1} file`, 20), areaHa: num(o.areaHa, 'areaHa') }
    }),
    outsideRows: list(r.outsideRows, `${label}.outsideRows`, 500).map((x, i) => {
      const o = object(x, `${label}.outsideRows ${i + 1}`)
      return {
        label: text(o.label, `${label}.outsideRows ${i + 1} label`, 80),
        group: o.group === null ? null : oneOf(o.group, `${label}.outsideRows ${i + 1} group`, GROUPS),
        cflbHa: num(o.cflbHa, `${label}.outsideRows ${i + 1} cflbHa`),
      }
    }),
    schedules: list(r.schedules, `${label}.schedules`, 50).map((s, i) => {
      const o = object(s, `${label} schedule ${i + 1}`)
      return {
        schedule: text(o.schedule, `${label} schedule ${i + 1}`),
        years: list(o.years, `${label} schedule ${i + 1} years`, 50).map((y, j) =>
          parseYear(y, `${label} schedule ${i + 1} year ${j + 1}`),
        ),
      }
    }),
  }
  const affected = optional(r, 'affected', (v) => {
    const o = object(v, `${label}.affected`)
    return { percent: num(o.percent, `${label}.affected.percent`, 0, 100), source: words(o.source, 'source', 2000) }
  })
  if (affected) record.affected = affected
  const younger = optional(r, 'younger', (v) => {
    const o = object(v, `${label}.younger`)
    return { fromAge: int(o.fromAge, `${label}.younger.fromAge`, 1, 1000), benefit: words(o.benefit, 'benefit') }
  })
  if (younger) record.younger = younger
  const published = optional(r, 'published', (v) => parseYear(v, `${label}.published`))
  if (published) record.published = published
  return record
}

/** The unit a record or choice names; null for an id the tables no longer hold. */
export const recordUnit = (record: Pick<MackenzieOldForestRecord, 'unit'>) => mackenzieUnit(record.unit)
