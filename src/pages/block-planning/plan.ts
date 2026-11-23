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
import { int, list, object, oneOf, optional, text, type JsonObject } from '@/lib/jsonGuards'
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
  sets: Record<string, unknown>
}

export interface LandscapeReview {
  /** The planner's draft D.5 rationale or recruitment strategy. */
  rationale?: string
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
}

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
    source: text(a.source, 'area.source', 2000),
    snapshotDate: optional(a, 'snapshotDate', (v) => {
      if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw Error('area.snapshotDate must be YYYY-MM-DD.')
      return v
    }),
    applicabilityEvidence: optionalText(a, 'applicabilityEvidence', 'area.applicabilityEvidence'),
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
  return { selected, date: r.date, sets: object(r.sets ?? {}, `${label} facts`) }
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
    landscape: { rationale: optionalText(l, 'rationale', 'landscape.rationale', 100_000) },
    zones: optional(p, 'zones', (v) => {
      const z = object(v, 'zones')
      return { source: text(z.source, 'zones.source', 2000), layer: z.layer }
    }),
    packs: list(p.packs ?? [], 'packs', 100),
  }
}
