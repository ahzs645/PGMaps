/**
 * The block plan (`pgmaps-block-plan/v2`): what a planner makes in `/dev/forestry/block-planning`.
 *
 * - The **area** is the Objective C reporting unit (historic district and natural disturbance
 *   sub-unit), the projection's first year and where the inventory came from.
 * - The **baseline** is what already happened: harvests and stand-replacing disturbances every
 *   schedule shares. It is evidence with a date and a source, never a block.
 * - **Blocks** are the proponent's cutblocks: an identity and one or more shapes. A second shape
 *   is a reconfigured version of the same block, chosen per schedule.
 * - **Schedules** say when each block is cut (or that it is not), and which shape. A schedule may
 *   follow another one shifted by a number of years ("deferred ten years"); its own entries then
 *   override the followed schedule block by block.
 * - **Reviews** are kept per block, independent of the year shown on the map.
 *
 * DOM- and network-free. Parsed by hand (`src/lib/jsonGuards.ts`): a file that does not read is
 * refused with the field named, never repaired.
 */
import type { MultiPolygon, Polygon, Position } from 'geojson'
import { bool, int, list, object, oneOf, optional, text, type JsonObject } from '@/lib/jsonGuards'
import type {
  BoardCheckRecord,
  OldForestChoices,
  OldForestPoolUnit,
  OldForestRecord,
  OldForestYear,
  PlanChecks,
} from './records'
import type { FactSet } from '../../../packages/legal-rules/src/contract'
import { districts, table } from '../forest-patches/project'

export const PLAN_FORMAT = 'pgmaps-block-plan/v2'
export const YEAR_RANGE = [1600, 2250] as const
export const START_YEAR_RANGE = [1800, 2200] as const
/** Five-year periods over fifty years, the horizon the patch calculation reports. */
export const PERIOD_STEP_YEARS = 5
export const PERIOD_COUNT = 11

export const disturbanceKinds = ['harvest', 'fire', 'insect', 'other', 'unspecified'] as const
export type DisturbanceKind = (typeof disturbanceKinds)[number]
export const disturbanceKindLabels: Record<DisturbanceKind, string> = {
  harvest: 'Harvest',
  fire: 'Wildfire',
  insect: 'Insect',
  other: 'Other stand-replacing',
  unspecified: 'Not stated',
}
export const yearBases = ['editor-default', 'source-attribute', 'plan-entry'] as const
export type YearBasis = (typeof yearBases)[number]
export const yearBasisLabels: Record<YearBasis, string> = {
  'editor-default': 'Year assumed: the source gave none',
  'source-attribute': 'Year from the source',
  'plan-entry': 'Year entered in the plan',
}

export type Shape = Polygon | MultiPolygon

export interface Area {
  /** Historic forest district, or '' before the planner chooses one. */
  district: string
  /** Natural disturbance sub-unit (Table 7), or '' before the planner chooses one. */
  ndu: string
  startYear: number
  /** Where the inventory and disturbance history came from, and what they cover. */
  source: string
  /** The inventory's own date, when the planner has it (YYYY-MM-DD). */
  snapshotDate?: string
  /** Plan, tenure and order versions the planner relied on, for the reviewer to check. */
  applicabilityEvidence?: string
  /**
   * The reporting unit's boundary, supplied by the planner: the order's Map 1 sub-unit within the
   * historic district. Past disturbances read from DataBC are clipped to it.
   */
  unit?: { source: string; geometry: Shape }
  /**
   * With a unit: `whole` (the default) builds patches from disturbances inside the unit and beyond it,
   * classes each by its whole size and counts its young area inside; `clipped` cuts patches at the
   * boundary. Whole reproduced the Board's largest class for Prince George, Moist Interior - Mountain
   * within about a point in 2015 and 2018; clipped found none.
   */
  patchExtent?: 'whole' | 'clipped'
  /** The last DataBC read: from which year, how far past the unit, and when. */
  baselineRead?: { fromYear: number; marginMetres: number; readOn: string }
}

export interface Disturbance {
  id: string
  name: string
  kind: DisturbanceKind
  year: number
  yearBasis: YearBasis
  source?: string
  geometry: Shape
}

export interface BlockShape {
  id: string
  name: string
  geometry: Shape
}

export interface Block {
  id: string
  name: string
  /** The first shape is the block as proposed; the others are reconfigured versions. */
  shapes: BlockShape[]
  source?: string
}

/** `year: null` means the block is not cut in this schedule. */
export interface ScheduleEntry {
  year: number | null
  /** A shape id of the block; absent means the block's first shape. */
  shape?: string
}

export interface Schedule {
  id: string
  name: string
  note?: string
  /** Follow another schedule moved by a number of years. Own entries override it per block. */
  follows?: { schedule: string; years: number }
  entries: Record<string, ScheduleEntry>
}

/** One legal review case: the releases chosen, the assessment date and the facts entered per release. */
export interface ReviewCase {
  selected: string[]
  date: string
  /** Checked against their packs when the review opens (`parseFacts`). */
  sets: Record<string, FactSet>
}

/** D.5(a): the old-forest recruitment strategy, which the order has submitted, approved and followed. */
export interface RecruitmentRecord {
  /** The recruitment analysis relied on: PGMaps does not model old forest yet. */
  analysis?: string
  strategy?: string
  submitted?: string
  approved?: string
  /** Who approved it: the minister's designate the order names. */
  approver?: string
  reference?: string
}

/** D.5(b): the young-forest patch rationale, which the order has submitted (no approval step). */
export interface RationaleRecord {
  submitted?: string
  reference?: string
}

/** The landscape-level review: the order's pack, the measured trend and the D.5 records. */
export interface LandscapeReview {
  /** The planner's draft D.5(b) rationale. */
  rationale?: string
  /** The Prince George order's case: applicability, determinations and D.1–D.4 claims. */
  review?: ReviewCase
  /** The later year of the five-year interval the trend is measured over. */
  trendYear?: number
  pathways?: { a?: RecruitmentRecord; b?: RationaleRecord }
}

export interface Plan {
  format: typeof PLAN_FORMAT
  area: Area
  baseline: Disturbance[]
  blocks: Block[]
  schedules: Schedule[]
  /** The schedule a review reads its landscape figures from: the proposal under review. */
  reviewSchedule: string
  reviews: Record<string, ReviewCase>
  landscape: LandscapeReview
  /** Mapped riparian zones, as read (`riparian.ts`). */
  zones?: { source: string; layer: unknown }
  /** Rule pack releases the reviews use that are not built in, so the file opens anywhere. */
  packs: unknown[]
  /** The planning index's weights, by indicator (`planningIndex.ts`). Absent: equal weights. */
  indexWeights?: Record<string, number>
  /** The reviewer's choices for Objectives A and B (`oldForest/`). Absent: not assessed. */
  oldForest?: OldForestChoices
  /** Calculations kept with the plan, each keyed to its inputs (`records.ts`). */
  checks?: PlanChecks
}

/** The unit the patch calculation counts within, or none: the plan's unit unless patches are cut at it. */
export const countingUnit = (plan: Pick<Plan, 'area'>) =>
  plan.area.unit && plan.area.patchExtent !== 'clipped' ? plan.area.unit.geometry : undefined

export const periodYears = (start: number) =>
  Array.from({ length: PERIOD_COUNT }, (_, i) => start + i * PERIOD_STEP_YEARS)

// ---------------------------------------------------------------------------------------------
// Making plans

export function emptyPlan(startYear = new Date().getFullYear()): Plan {
  return {
    format: PLAN_FORMAT,
    area: { district: '', ndu: '', startYear, source: 'Inventory and disturbance history not yet stated.' },
    baseline: [],
    blocks: [],
    schedules: [
      { id: 'none', name: 'No further harvest', entries: {} },
      { id: 'proposed', name: 'Proposed', entries: {} },
    ],
    reviewSchedule: 'proposed',
    reviews: {},
    landscape: {},
    packs: [],
  }
}

function rectangle(west: number, south: number, width: number, height: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [west, south],
        [west + width, south],
        [west + width, south + height],
        [west, south + height],
        [west, south],
      ],
    ],
  }
}

/** The synthetic teaching landscape: two past openings, one block, cut now or ten years later. */
export function samplePlan(): Plan {
  const plan = emptyPlan(2026)
  return {
    ...plan,
    area: {
      district: 'Prince George',
      ndu: 'Moist Interior - Mountain',
      startYear: 2026,
      source: 'Synthetic demonstration near Prince George. Reporting unit chosen for illustration.',
    },
    baseline: [
      {
        id: 'opening-a',
        name: 'Opening A',
        kind: 'harvest',
        year: 2011,
        yearBasis: 'plan-entry',
        geometry: rectangle(-122.78, 53.99, 0.009, 0.005),
      },
      {
        id: 'opening-b',
        name: 'Opening B',
        kind: 'harvest',
        year: 2021,
        yearBasis: 'plan-entry',
        geometry: rectangle(-122.755, 53.991, 0.009, 0.005),
      },
    ],
    blocks: [
      {
        id: 'block-1',
        name: 'Block 1',
        shapes: [{ id: 'shape-1', name: 'As proposed', geometry: rectangle(-122.7701, 53.99, 0.009, 0.005) }],
      },
    ],
    schedules: [
      { id: 'none', name: 'No further harvest', entries: {} },
      { id: 'proposed', name: 'Proposed', entries: { 'block-1': { year: 2026 } } },
      { id: 'deferred', name: 'Deferred 10 years', follows: { schedule: 'proposed', years: 10 }, entries: {} },
    ],
  }
}

/** A short id not used by any of `taken`: `prefix-1`, `prefix-2`, … */
export function nextId(prefix: string, taken: Iterable<string>) {
  const used = new Set(taken)
  let n = 1
  while (used.has(`${prefix}-${n}`)) n++
  return `${prefix}-${n}`
}

// ---------------------------------------------------------------------------------------------
// Reading schedules

/**
 * When and in which shape `block` is cut under `schedule`. A followed schedule's year moves by
 * its offset; a block it does not cut stays uncut. A cycle of follows is refused by the parser,
 * and guarded here as well.
 */
export function entryOf(plan: Plan, scheduleId: string, blockId: string, seen: string[] = []): ScheduleEntry {
  const schedule = plan.schedules.find((s) => s.id === scheduleId)
  if (!schedule || seen.includes(scheduleId)) return { year: null }
  const own = schedule.entries[blockId]
  if (own) return own
  if (!schedule.follows) return { year: null }
  const base = entryOf(plan, schedule.follows.schedule, blockId, [...seen, scheduleId])
  return base.year === null ? base : { ...base, year: base.year + schedule.follows.years }
}

/** Whether a block's entry in a schedule is its own, or read through the schedule it follows. */
export function entryIsOwn(plan: Plan, scheduleId: string, blockId: string) {
  return Boolean(plan.schedules.find((s) => s.id === scheduleId)?.entries[blockId])
}

export function shapeOf(block: Block, entry: ScheduleEntry): BlockShape {
  return block.shapes.find((s) => s.id === entry.shape) ?? block.shapes[0]
}

/** The harvests a schedule adds to the baseline, in block order. */
export function scheduleHarvests(plan: Plan, scheduleId: string) {
  return plan.blocks.flatMap((block) => {
    const entry = entryOf(plan, scheduleId, block.id)
    if (entry.year === null) return []
    const shape = shapeOf(block, entry)
    return [{ block, shape, year: entry.year }]
  })
}

/** The engine's footprint ids, so a calculated patch can be traced to what the planner named. */
export const baselineFootprintId = (id: string) => 'd:' + id
export const blockFootprintId = (id: string) => 'b:' + id

/** A footprint id from the engine as the planner named it. */
export function footprintName(plan: Plan, id: string) {
  if (id.startsWith('d:')) return plan.baseline.find((d) => d.id === id.slice(2))?.name ?? id
  if (id.startsWith('b:')) return plan.blocks.find((b) => b.id === id.slice(2))?.name ?? id
  return id
}

// ---------------------------------------------------------------------------------------------
// Parsing

const IN_BC = { west: -140, east: -114, south: 48, north: 61 }

function ring(value: unknown, label: string): Position[] {
  const points = list(value, label, 100_000, 4)
  for (const p of points) {
    if (
      !Array.isArray(p) ||
      p.length < 2 ||
      !Number.isFinite(p[0]) ||
      !Number.isFinite(p[1]) ||
      p[0] < IN_BC.west ||
      p[0] > IN_BC.east ||
      p[1] < IN_BC.south ||
      p[1] > IN_BC.north
    )
      throw Error(`${label} must hold WGS84 longitude and latitude pairs inside British Columbia.`)
  }
  const first = points[0] as number[],
    last = points.at(-1) as number[]
  if (first[0] !== last[0] || first[1] !== last[1]) throw Error(`${label} must be closed.`)
  return points as Position[]
}

export function parseShape(value: unknown, label: string): Shape {
  const g = object(value, label)
  if (g.type === 'Polygon')
    return {
      type: 'Polygon',
      coordinates: list(g.coordinates, label, 1000, 1).map((r, i) => ring(r, `${label} ring ${i + 1}`)),
    }
  if (g.type === 'MultiPolygon')
    return {
      type: 'MultiPolygon',
      coordinates: list(g.coordinates, label, 10_000, 1).map((poly, j) =>
        list(poly, `${label} part ${j + 1}`, 1000, 1).map((r, i) => ring(r, `${label} part ${j + 1} ring ${i + 1}`)),
      ),
    }
  throw Error(`${label} must be a Polygon or MultiPolygon.`)
}

const optionalText = (source: JsonObject, key: string, label: string, max = 20_000) =>
  optional(source, key, (v) => {
    if (typeof v !== 'string' || v.length > max) throw Error(`${label} must be text of at most ${max} characters.`)
    return v
  })

function uniqueIds<T extends { id: string }>(items: T[], label: string) {
  const seen = new Set<string>()
  for (const item of items) {
    if (seen.has(item.id)) throw Error(`${label} ${item.id} appears twice.`)
    seen.add(item.id)
  }
  return items
}

const num = (v: unknown, label: string, min = 0, max = 1e9) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max)
    throw Error(`${label} must be a number from ${min} to ${max}.`)
  return v
}
const numOrNull = (v: unknown, label: string, min = 0, max = 1e9) => (v === null ? null : num(v, label, min, max))
const day = (v: unknown, label: string) => {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw Error(`${label} must be YYYY-MM-DD.`)
  return v
}

function parseOldForestChoices(value: unknown): OldForestChoices {
  const o = object(value, 'oldForest')
  return {
    district: oneOf(o.district, 'oldForest.district', districts),
    unit: text(o.unit, 'oldForest.unit', 10),
    countNonLegalOgmas: bool(o.countNonLegalOgmas, 'oldForest.countNonLegalOgmas'),
    countParks: bool(o.countParks, 'oldForest.countParks'),
    interiorMethod: oneOf(o.interiorMethod, 'oldForest.interiorMethod', ['2005', '2004'] as const),
    cflbEnteredHa: optional(o, 'cflbEnteredHa', (v) => num(v, 'oldForest.cflbEnteredHa', 1, 10_000_000)),
    cflbSource: optionalText(o, 'cflbSource', 'oldForest.cflbSource', 2000),
    retentionAreas: uniqueIds(
      list(o.retentionAreas ?? [], 'oldForest.retentionAreas', 5000).map((r, i) => {
        const a = object(r, `retention area ${i + 1}`)
        return {
          id: text(a.id, `retention area ${i + 1} id`),
          name: text(a.name, `retention area ${i + 1} name`, 500),
          reference: text(a.reference ?? '', `retention area ${i + 1} reference`, 2000),
          geometry: parseShape(a.geometry, `retention area ${i + 1}`),
        }
      }),
      'Retention area',
    ),
    // D.4 and D.2 are present only when the reviewer chose them, so older plans read exactly as before.
    ...(o.younger === undefined ? {} : { younger: parseYoungerChoice(o.younger) }),
    ...(o.pooledWith === undefined ? {} : { pooledWith: parsePooledWith(o.pooledWith, o) }),
  }
}

/** D.4 as the reviewer left it: the age may still be blank and the benefit empty while it is being written. */
function parseYoungerChoice(value: unknown): NonNullable<OldForestChoices['younger']> {
  const y = object(value, 'oldForest.younger')
  if (typeof y.benefit !== 'string' || y.benefit.length > 20_000)
    throw Error('oldForest.younger.benefit must be text of at most 20000 characters.')
  const fromAge = optional(y, 'fromAge', (v) => int(v, 'oldForest.younger.fromAge', 1, 1000))
  return fromAge === undefined ? { benefit: y.benefit } : { fromAge, benefit: y.benefit }
}

/** D.2's pooled units: each named once, never the chosen unit itself. */
function parsePooledWith(value: unknown, choices: JsonObject): NonNullable<OldForestChoices['pooledWith']> {
  const pooled = list(value, 'oldForest.pooledWith', 47).map((v, i) => {
    const label = `oldForest.pooledWith ${i + 1}`
    const u = object(v, label)
    const cflbEnteredHa = optional(u, 'cflbEnteredHa', (x) => num(x, `${label} cflbEnteredHa`, 1, 10_000_000))
    const cflbSource = optionalText(u, 'cflbSource', `${label} cflbSource`, 2000)
    return {
      district: oneOf(u.district, `${label} district`, districts),
      unit: text(u.unit, `${label} unit`, 10),
      ...(cflbEnteredHa === undefined ? {} : { cflbEnteredHa }),
      ...(cflbSource ? { cflbSource } : {}),
    }
  })
  const keys = [`${choices.district}|${choices.unit}`, ...pooled.map((u) => `${u.district}|${u.unit}`)]
  if (new Set(keys).size !== keys.length) throw Error('oldForest.pooledWith names a unit twice.')
  return pooled
}

function parseOldForestCounts(value: unknown, label: string): OldForestRecord['counts'] {
  const counts = object(value, label)
  return {
    stands: int(counts.stands, `${label}.stands`, 0, 1e7),
    ogmas: int(counts.ogmas, `${label}.ogmas`, 0, 1e7),
    parks: int(counts.parks, `${label}.parks`, 0, 1e7),
    retention: int(counts.retention, `${label}.retention`, 0, 1e7),
    corridors: int(counts.corridors, `${label}.corridors`, 0, 1e7),
  }
}

function parseOldForestSchedules(value: unknown, label: string): OldForestRecord['schedules'] {
  return list(value, `${label}.schedules`, 50).map((s, i) => {
    const o = object(s, `${label} schedule ${i + 1}`)
    return {
      schedule: text(o.schedule, `${label} schedule ${i + 1}`),
      years: list(o.years, `${label} schedule ${i + 1} years`, 50).map((y, j) =>
        parseOldForestYear(y, `${label} schedule ${i + 1} year ${j + 1}`),
      ),
    }
  })
}

/** D.4 and D.2 parts of a kept record; absent when neither was used, so older records read as before. */
function parseOldForestExtras(r: JsonObject): Pick<OldForestRecord, 'younger' | 'pool'> {
  const younger = optional(r, 'younger', (v) => {
    const y = object(v, 'checks.oldForest.younger')
    return {
      fromAge: int(y.fromAge, 'checks.oldForest.younger.fromAge', 1, 1000),
      benefit: text(y.benefit, 'checks.oldForest.younger.benefit', 20_000),
    }
  })
  const pool = optional(r, 'pool', (v) =>
    list(v, 'checks.oldForest.pool', 48, 2).map((u, i): OldForestPoolUnit => {
      const label = `checks.oldForest.pool ${i + 1}`
      const o = object(u, label)
      const cflbEnteredHa = optional(o, 'cflbEnteredHa', (x) => num(x, `${label} cflbEnteredHa`, 1, 10_000_000))
      return {
        district: oneOf(o.district, `${label} district`, districts),
        unit: text(o.unit, `${label} unit`, 10),
        source: text(o.source, `${label} source`, 2000),
        cflbProxyHa: num(o.cflbProxyHa, `${label} cflbProxyHa`),
        ...(cflbEnteredHa === undefined ? {} : { cflbEnteredHa }),
        gisFraction: numOrNull(o.gisFraction, `${label} gisFraction`, 0, 1),
        projectedYear: int(o.projectedYear, `${label} projectedYear`, ...YEAR_RANGE),
        counts: parseOldForestCounts(o.counts, `${label} counts`),
        schedules: parseOldForestSchedules(o.schedules, label),
        calibration2019:
          o.calibration2019 === null ? null : parseOldForestYear(o.calibration2019, `${label} calibration2019`),
      }
    }),
  )
  return { ...(younger ? { younger } : {}), ...(pool ? { pool } : {}) }
}

function parseOldForestYear(value: unknown, label: string): OldForestYear {
  const y = object(value, label)
  return {
    year: int(y.year, `${label} year`, ...YEAR_RANGE),
    cflbHa: num(y.cflbHa, `${label} cflbHa`),
    requiredOldHa: num(y.requiredOldHa, `${label} requiredOldHa`),
    oldHa: num(y.oldHa, `${label} oldHa`),
    countedNotOldHa: num(y.countedNotOldHa, `${label} countedNotOldHa`),
    requiredNonPineHa: numOrNull(y.requiredNonPineHa, `${label} requiredNonPineHa`),
    nonPineOldHa: num(y.nonPineOldHa, `${label} nonPineOldHa`),
    unknownAgeHa: num(y.unknownAgeHa, `${label} unknownAgeHa`),
    requiredInteriorHa: num(y.requiredInteriorHa, `${label} requiredInteriorHa`),
    interiorHa: numOrNull(y.interiorHa, `${label} interiorHa`),
    ...parseYoungerYear(y, label),
  }
}

/** D.4's figures for a year, present only when it was on. */
function parseYoungerYear(y: JsonObject, label: string): Partial<OldForestYear> {
  if (y.d4OldSupplyHa === undefined) return {}
  return {
    d4OldSupplyHa: num(y.d4OldSupplyHa, `${label} d4OldSupplyHa`),
    d4OldHa: num(y.d4OldHa, `${label} d4OldHa`),
    d4InteriorSupplyHa: numOrNull(y.d4InteriorSupplyHa, `${label} d4InteriorSupplyHa`),
    d4InteriorHa: numOrNull(y.d4InteriorHa, `${label} d4InteriorHa`),
  }
}

function parseChecks(value: unknown): PlanChecks {
  const c = object(value, 'checks')
  return {
    board: optional(c, 'board', (v): BoardCheckRecord => {
      const b = object(v, 'checks.board')
      return {
        ranOn: day(b.ranOn, 'checks.board.ranOn'),
        key: text(b.key, 'checks.board.key', 40),
        firesLeftOut: optional(b, 'firesLeftOut', (v) => int(v, 'checks.board.firesLeftOut', 0, 1e7)),
        years: list(b.years, 'checks.board.years', 10).map((y, i) => {
          const o = object(y, `checks.board year ${i + 1}`)
          return {
            year: int(o.year, `checks.board year ${i + 1}`, ...YEAR_RANGE),
            shares: list(o.shares, `checks.board year ${i + 1} shares`, 10).map((s) =>
              numOrNull(s, `checks.board year ${i + 1} share`, 0, 100),
            ),
            totalHa: num(o.totalHa, `checks.board year ${i + 1} totalHa`),
          }
        }),
      }
    }),
    oldForest: optional(c, 'oldForest', (v): OldForestRecord => {
      const r = object(v, 'checks.oldForest')
      const counts = object(r.counts, 'checks.oldForest.counts')
      return {
        ranOn: day(r.ranOn, 'checks.oldForest.ranOn'),
        readOn: day(r.readOn, 'checks.oldForest.readOn'),
        key: text(r.key, 'checks.oldForest.key', 40),
        district: oneOf(r.district, 'checks.oldForest.district', districts),
        unit: text(r.unit, 'checks.oldForest.unit', 10),
        source: text(r.source, 'checks.oldForest.source', 2000),
        cflbProxyHa: num(r.cflbProxyHa, 'checks.oldForest.cflbProxyHa'),
        gisFraction: numOrNull(r.gisFraction, 'checks.oldForest.gisFraction', 0, 1),
        projectedYear: int(r.projectedYear, 'checks.oldForest.projectedYear', ...YEAR_RANGE),
        counts: {
          stands: int(counts.stands, 'checks.oldForest.counts.stands', 0, 1e7),
          ogmas: int(counts.ogmas, 'checks.oldForest.counts.ogmas', 0, 1e7),
          parks: int(counts.parks, 'checks.oldForest.counts.parks', 0, 1e7),
          retention: int(counts.retention, 'checks.oldForest.counts.retention', 0, 1e7),
          corridors: int(counts.corridors, 'checks.oldForest.counts.corridors', 0, 1e7),
        },
        schedules: list(r.schedules, 'checks.oldForest.schedules', 50).map((s, i) => {
          const o = object(s, `checks.oldForest schedule ${i + 1}`)
          return {
            schedule: text(o.schedule, `checks.oldForest schedule ${i + 1}`),
            years: list(o.years, `checks.oldForest schedule ${i + 1} years`, 50).map((y, j) =>
              parseOldForestYear(y, `checks.oldForest schedule ${i + 1} year ${j + 1}`),
            ),
          }
        }),
        calibration2019:
          r.calibration2019 === null ? null : parseOldForestYear(r.calibration2019, 'checks.oldForest.calibration2019'),
        ...parseOldForestExtras(r),
      }
    }),
  }
}

function parseArea(value: unknown): Area {
  const a = object(value, 'area')
  const district = typeof a.district === 'string' ? a.district : ''
  const ndu = typeof a.ndu === 'string' ? a.ndu : ''
  if (district && !districts.includes(district))
    throw Error(`area.district ${district} is not a historic district of the order.`)
  if (ndu && !table.targets.some((t) => t.ndu === ndu)) throw Error(`area.ndu ${ndu} has no Table 7 target.`)
  return {
    district,
    ndu,
    startYear: int(a.startYear, 'area.startYear', ...START_YEAR_RANGE),
    source: (() => {
      if (typeof a.source !== 'string' || a.source.length > 2000)
        throw Error('area.source must be text of at most 2000 characters.')
      return a.source
    })(),
    snapshotDate: optional(a, 'snapshotDate', (v) => {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw Error('area.snapshotDate must be YYYY-MM-DD.')
      return v
    }),
    applicabilityEvidence: optionalText(a, 'applicabilityEvidence', 'area.applicabilityEvidence'),
    patchExtent: optional(a, 'patchExtent', (v) => oneOf(v, 'area.patchExtent', ['whole', 'clipped'] as const)),
    baselineRead: optional(a, 'baselineRead', (v) => {
      const r = object(v, 'area.baselineRead')
      if (typeof r.readOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.readOn))
        throw Error('area.baselineRead.readOn must be YYYY-MM-DD.')
      return {
        fromYear: int(r.fromYear, 'area.baselineRead.fromYear', ...YEAR_RANGE),
        marginMetres: int(r.marginMetres, 'area.baselineRead.marginMetres', 0, 50_000),
        readOn: r.readOn,
      }
    }),
    unit: optional(a, 'unit', (v) => {
      const u = object(v, 'area.unit')
      return {
        source: text(u.source, 'area.unit.source', 2000),
        geometry: parseShape(u.geometry, 'area.unit.geometry'),
      }
    }),
  }
}

function parseDisturbance(value: unknown, i: number): Disturbance {
  const label = `baseline ${i + 1}`
  const d = object(value, label)
  return {
    id: text(d.id, `${label} id`),
    name: text(d.name, `${label} name`),
    kind: oneOf(d.kind, `${label} kind`, disturbanceKinds),
    year: int(d.year, `${label} year`, ...YEAR_RANGE),
    yearBasis: oneOf(d.yearBasis, `${label} yearBasis`, yearBases),
    source: optionalText(d, 'source', `${label} source`, 2000),
    geometry: parseShape(d.geometry, `${label} geometry`),
  }
}

function parseBlock(value: unknown, i: number): Block {
  const label = `block ${i + 1}`
  const b = object(value, label)
  return {
    id: text(b.id, `${label} id`),
    name: text(b.name, `${label} name`),
    shapes: uniqueIds(
      list(b.shapes, `${label} shapes`, 20, 1).map((s, j) => {
        const shape = object(s, `${label} shape ${j + 1}`)
        return {
          id: text(shape.id, `${label} shape ${j + 1} id`),
          name: text(shape.name, `${label} shape ${j + 1} name`),
          geometry: parseShape(shape.geometry, `${label} shape ${j + 1} geometry`),
        }
      }),
      `${label} shape`,
    ),
    source: optionalText(b, 'source', `${label} source`, 2000),
  }
}

function parseSchedule(value: unknown, i: number, blocks: Block[]): Schedule {
  const label = `schedule ${i + 1}`
  const s = object(value, label)
  const entries: Record<string, ScheduleEntry> = {}
  for (const [blockId, raw] of Object.entries(object(s.entries ?? {}, `${label} entries`))) {
    const block = blocks.find((b) => b.id === blockId)
    if (!block) throw Error(`${label} names a block that is not in the plan: ${blockId}.`)
    const e = object(raw, `${label} entry for ${blockId}`)
    const year = e.year === null ? null : int(e.year, `${label} year for ${blockId}`, ...YEAR_RANGE)
    const shape = optional(e, 'shape', (v) => text(v, `${label} shape for ${blockId}`))
    if (shape !== undefined && !block.shapes.some((sh) => sh.id === shape))
      throw Error(`${label} names a shape ${shape} that block ${blockId} does not have.`)
    entries[blockId] = shape === undefined ? { year } : { year, shape }
  }
  return {
    id: text(s.id, `${label} id`),
    name: text(s.name, `${label} name`),
    note: optionalText(s, 'note', `${label} note`, 2000),
    follows: optional(s, 'follows', (v) => {
      const f = object(v, `${label} follows`)
      return {
        schedule: text(f.schedule, `${label} follows.schedule`),
        years: int(f.years, `${label} follows.years`, -200, 200),
      }
    }),
    entries,
  }
}

function checkFollows(schedules: Schedule[]) {
  for (const start of schedules) {
    const seen = [start.id]
    let next = start.follows?.schedule
    while (next) {
      if (seen.includes(next)) throw Error(`Schedule ${start.id} follows itself through ${seen.join(' → ')}.`)
      const followed = schedules.find((s) => s.id === next)
      if (!followed) throw Error(`Schedule ${seen.at(-1)} follows ${next}, which is not in the plan.`)
      seen.push(next)
      next = followed.follows?.schedule
    }
  }
}

function parseReview(value: unknown, label: string): ReviewCase {
  const r = object(value, label)
  const selected = list(r.selected, `${label} releases`, 100).map((v) => text(v, `${label} release`))
  if (typeof r.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.date))
    throw Error(`${label} date must be YYYY-MM-DD.`)
  return { selected, date: r.date, sets: object(r.sets ?? {}, `${label} facts`) as Record<string, FactSet> }
}

/** Reads a v2 plan. Fact sets inside reviews are checked against their packs by the caller. */
export function parsePlan(value: unknown): Plan {
  const p = object(value, 'plan')
  if (p.format !== PLAN_FORMAT) throw Error(`This is not a ${PLAN_FORMAT} file.`)
  const area = parseArea(p.area)
  const baseline = uniqueIds(list(p.baseline, 'baseline', 50_000).map(parseDisturbance), 'Baseline disturbance')
  const blocks = uniqueIds(list(p.blocks, 'blocks', 5_000).map(parseBlock), 'Block')
  const schedules = uniqueIds(
    list(p.schedules, 'schedules', 50, 1).map((s, i) => parseSchedule(s, i, blocks)),
    'Schedule',
  )
  checkFollows(schedules)
  const reviewSchedule = text(p.reviewSchedule, 'reviewSchedule')
  if (!schedules.some((s) => s.id === reviewSchedule))
    throw Error(`reviewSchedule ${reviewSchedule} is not in the plan.`)
  const reviews: Record<string, ReviewCase> = {}
  for (const [blockId, review] of Object.entries(object(p.reviews ?? {}, 'reviews'))) {
    if (!blocks.some((b) => b.id === blockId))
      throw Error(`A review names a block that is not in the plan: ${blockId}.`)
    reviews[blockId] = parseReview(review, `review of ${blockId}`)
  }
  const l = object(p.landscape ?? {}, 'landscape')
  return {
    format: PLAN_FORMAT,
    area,
    baseline,
    blocks,
    schedules,
    reviewSchedule,
    reviews,
    landscape: {
      rationale: optionalText(l, 'rationale', 'landscape.rationale', 100_000),
      review: optional(l, 'review', (v) => parseReview(v, 'landscape review')),
      trendYear: optional(l, 'trendYear', (v) => int(v, 'landscape.trendYear', ...YEAR_RANGE)),
      pathways: optional(l, 'pathways', (v) => {
        const w = object(v, 'landscape.pathways')
        const record = (key: 'a' | 'b', fields: string[]) =>
          optional(w, key, (r) => {
            const o = object(r, `landscape.pathways.${key}`)
            return Object.fromEntries(
              fields.flatMap((f) => {
                const value = optionalText(o, f, `landscape.pathways.${key}.${f}`, 100_000)
                return value === undefined ? [] : [[f, value]]
              }),
            )
          })
        return {
          a: record('a', ['analysis', 'strategy', 'submitted', 'approved', 'approver', 'reference']),
          b: record('b', ['submitted', 'reference']),
        }
      }),
    },
    zones: optional(p, 'zones', (v) => {
      const z = object(v, 'zones')
      return { source: text(z.source, 'zones.source', 2000), layer: z.layer }
    }),
    packs: list(p.packs ?? [], 'packs', 100),
    indexWeights: optional(p, 'indexWeights', (v) =>
      Object.fromEntries(
        Object.entries(object(v, 'indexWeights')).map(([k, w]) => [k, int(w, `indexWeights.${k}`, 0, 5)]),
      ),
    ),
    oldForest: optional(p, 'oldForest', parseOldForestChoices),
    checks: optional(p, 'checks', parseChecks),
  }
}
