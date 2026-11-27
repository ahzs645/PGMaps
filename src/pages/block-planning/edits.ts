/**
 * Every change a planner makes to a plan, as a function from plan to plan. The page and every
 * interface (guided, ribbon, workbench, dashboard) call these and nothing else writes a plan, so
 * one edit behaves the same wherever it is started.
 *
 * DOM- and network-free.
 */
import { withDocumentTitle } from '@/lib/documentTitle'
import {
  entryOf,
  nextId,
  type Area,
  type Disturbance,
  type Plan,
  type RangeReview,
  type ReviewCase,
  type Schedule,
  type ScheduleEntry,
  type Shape,
} from './plan'
import type { OldForestChoices, PlanChecks } from './records'
import type { MackenzieOldForestChoices } from './oldForest/mackenzieRecord'
import { rangeReviewCurrent } from './review/rangeReview'
import { blankCrossing, crossingFootprint, type CrossingRecord } from './crossings/record'

/** Keeps one grazing review per block and schedule if the evidence still describes its footprint. */
export function saveRangeReview(plan: Plan, record: RangeReview): Plan {
  if (!rangeReviewCurrent(plan, record)) return plan
  return {
    ...plan,
    rangeReviews: [
      ...(plan.rangeReviews ?? []).filter((r) => r.block !== record.block || r.schedule !== record.schedule),
      record,
    ],
  }
}

/** Changes the A/B choices; a plan without them gets the defaults for the given district and unit first. */
export function setOldForest(plan: Plan, change: Partial<OldForestChoices>): Plan {
  const base: OldForestChoices = plan.oldForest ?? {
    district: change.district ?? plan.area.district,
    unit: change.unit ?? '',
    countNonLegalOgmas: true,
    countParks: false,
    interiorMethod: '2005',
    retentionAreas: [],
  }
  const next: OldForestChoices = { ...base, ...change }
  if (next.cflbEnteredHa === undefined) delete next.cflbEnteredHa
  if (!next.cflbSource) delete next.cflbSource
  if (next.younger === undefined) delete next.younger
  // D.2: the chosen unit is never pooled with itself, and an empty pool is no pool.
  if (next.pooledWith)
    next.pooledWith = next.pooledWith.filter((u) => u.district !== next.district || u.unit !== next.unit)
  if (!next.pooledWith?.length) delete next.pooledWith
  return { ...plan, oldForest: next }
}

/** Changes the Mackenzie calculation's choices; a plan without them starts at the given unit with the park off. */
export function setMackenzieOldForest(plan: Plan, change: Partial<MackenzieOldForestChoices>): Plan {
  const next: MackenzieOldForestChoices = {
    ...(plan.mackenzieOldForest ?? { unit: change.unit ?? '', countPark: false }),
    ...change,
  }
  if (next.affectedPercent === undefined) delete next.affectedPercent
  if (!next.affectedSource) delete next.affectedSource
  if (next.younger === undefined) delete next.younger
  return { ...plan, mackenzieOldForest: next }
}

/** Keeps a calculation with the plan (`records.ts`). */
export function setCheck<K extends keyof PlanChecks>(plan: Plan, kind: K, record: PlanChecks[K]): Plan {
  return { ...plan, checks: { ...plan.checks, [kind]: record } }
}

/** The summary's title as typed; blank removes it, so the summary follows its default heading again. */
export function setTitle(plan: Plan, title: string | undefined): Plan {
  const next: Plan = { ...plan }
  delete next.title
  return { ...next, ...withDocumentTitle('title', title) }
}

export function setArea(plan: Plan, change: Partial<Area>): Plan {
  return { ...plan, area: { ...plan.area, ...change } }
}

/** A new block is cut at the first projection year in the schedule under review. */
export function addBlock(plan: Plan, name: string, geometry: Shape): { plan: Plan; id: string } {
  const id = nextId(
    'block',
    plan.blocks.map((b) => b.id),
  )
  const block = {
    id,
    name: name.trim() || `Block ${plan.blocks.length + 1}`,
    shapes: [{ id: 'shape-1', name: 'As proposed', geometry }],
  }
  const schedules = plan.schedules.map((s) =>
    s.id === plan.reviewSchedule ? { ...s, entries: { ...s.entries, [id]: { year: plan.area.startYear } } } : s,
  )
  return { plan: { ...plan, blocks: [...plan.blocks, block], schedules }, id }
}

export function renameBlock(plan: Plan, id: string, name: string): Plan {
  if (!name.trim()) return plan
  return { ...plan, blocks: plan.blocks.map((b) => (b.id === id ? { ...b, name: name.trim() } : b)) }
}

export function setShapeGeometry(plan: Plan, blockId: string, shapeId: string, geometry: Shape): Plan {
  return {
    ...plan,
    blocks: plan.blocks.map((b) =>
      b.id === blockId ? { ...b, shapes: b.shapes.map((s) => (s.id === shapeId ? { ...s, geometry } : s)) } : b,
    ),
  }
}

/** Adds a reconfigured version of a block. Schedules keep the shape they had until told otherwise. */
export function addShape(plan: Plan, blockId: string, name: string, geometry: Shape): { plan: Plan; id: string } {
  const block = plan.blocks.find((b) => b.id === blockId)
  if (!block) return { plan, id: '' }
  const id = nextId(
    'shape',
    block.shapes.map((s) => s.id),
  )
  const shape = { id, name: name.trim() || `Version ${block.shapes.length + 1}`, geometry }
  return {
    plan: { ...plan, blocks: plan.blocks.map((b) => (b.id === blockId ? { ...b, shapes: [...b.shapes, shape] } : b)) },
    id,
  }
}

/** The first shape cannot be removed; entries that used a removed shape go back to the first. */
export function removeShape(plan: Plan, blockId: string, shapeId: string): Plan {
  const block = plan.blocks.find((b) => b.id === blockId)
  if (!block || block.shapes[0].id === shapeId) return plan
  return {
    ...plan,
    blocks: plan.blocks.map((b) => (b.id === blockId ? { ...b, shapes: b.shapes.filter((s) => s.id !== shapeId) } : b)),
    schedules: plan.schedules.map((s) => {
      const entry = s.entries[blockId]
      if (entry?.shape !== shapeId) return s
      return { ...s, entries: { ...s.entries, [blockId]: { year: entry.year } } }
    }),
  }
}

export function removeBlock(plan: Plan, id: string): Plan {
  const reviews = { ...plan.reviews }
  delete reviews[id]
  return {
    ...plan,
    blocks: plan.blocks.filter((b) => b.id !== id),
    schedules: plan.schedules.map((s) => {
      if (!(id in s.entries)) return s
      const entries = { ...s.entries }
      delete entries[id]
      return { ...s, entries }
    }),
    reviews,
    rangeReviews: plan.rangeReviews?.filter((review) => review.block !== id),
    groundReads: plan.groundReads?.filter((read) => read.block !== id),
    ...withCrossings(plan, (c) => c.block !== id),
  }
}

export function addDisturbance(plan: Plan, disturbance: Omit<Disturbance, 'id'>): { plan: Plan; id: string } {
  const id = nextId(
    'disturbance',
    plan.baseline.map((d) => d.id),
  )
  return { plan: { ...plan, baseline: [...plan.baseline, { ...disturbance, id }] }, id }
}

export function updateDisturbance(plan: Plan, id: string, change: Partial<Omit<Disturbance, 'id'>>): Plan {
  return { ...plan, baseline: plan.baseline.map((d) => (d.id === id ? { ...d, ...change } : d)) }
}

/**
 * Puts a fresh read of some sources in place of what those sources wrote before, so reading again
 * replaces rather than duplicates. Disturbances the planner drew or imported are kept.
 */
export function replaceBaseline(
  plan: Plan,
  isReplaced: (d: Disturbance) => boolean,
  fresh: Omit<Disturbance, 'id'>[],
): Plan {
  let next: Plan = { ...plan, baseline: plan.baseline.filter((d) => !isReplaced(d)) }
  for (const d of fresh) next = addDisturbance(next, d).plan
  return next
}

export function removeDisturbance(plan: Plan, id: string): Plan {
  return { ...plan, baseline: plan.baseline.filter((d) => d.id !== id) }
}

/**
 * Sets a block's own entry in a schedule. `undefined` clears it, so a schedule that follows
 * another reads the block through it again.
 */
export function setEntry(plan: Plan, scheduleId: string, blockId: string, entry: ScheduleEntry | undefined): Plan {
  return {
    ...plan,
    schedules: plan.schedules.map((s) => {
      if (s.id !== scheduleId) return s
      const entries = { ...s.entries }
      if (entry) entries[blockId] = entry.shape ? entry : { year: entry.year }
      else delete entries[blockId]
      return { ...s, entries }
    }),
  }
}

export type NewSchedule =
  | { kind: 'empty'; name: string }
  | { kind: 'copy'; name: string; from: string }
  | { kind: 'follow'; name: string; from: string; years: number }

export function addSchedule(plan: Plan, spec: NewSchedule): { plan: Plan; id: string } {
  const id = nextId(
    'schedule',
    plan.schedules.map((s) => s.id),
  )
  const name = spec.name.trim() || `Schedule ${plan.schedules.length + 1}`
  let schedule: Schedule
  if (spec.kind === 'follow') schedule = { id, name, follows: { schedule: spec.from, years: spec.years }, entries: {} }
  else if (spec.kind === 'copy')
    schedule = {
      id,
      name,
      entries: Object.fromEntries(
        plan.blocks.map((b) => [b.id, entryOf(plan, spec.from, b.id)] as const).filter(([, e]) => e.year !== null),
      ),
    }
  else schedule = { id, name, entries: {} }
  return { plan: { ...plan, schedules: [...plan.schedules, schedule] }, id }
}

export function updateSchedule(
  plan: Plan,
  id: string,
  change: Partial<Pick<Schedule, 'name' | 'note' | 'follows'>>,
): Plan {
  return {
    ...plan,
    schedules: plan.schedules.map((s) => {
      if (s.id !== id) return s
      const next = { ...s, ...change }
      if (change.name !== undefined && !change.name.trim()) next.name = s.name
      if ('follows' in change && !change.follows) delete next.follows
      return next
    }),
  }
}

/**
 * Removes a schedule. Schedules that followed it keep what they read through it, written as their
 * own entries, so removing one never changes another's figures. The last schedule stays.
 */
export function removeSchedule(plan: Plan, id: string): Plan {
  if (plan.schedules.length <= 1 || !plan.schedules.some((s) => s.id === id)) return plan
  const schedules = plan.schedules
    .filter((s) => s.id !== id)
    .map((s) => {
      if (s.follows?.schedule !== id) return s
      const entries: Schedule['entries'] = {}
      for (const block of plan.blocks) {
        const entry = entryOf(plan, s.id, block.id)
        if (entry.year !== null || s.entries[block.id]) entries[block.id] = entry
      }
      const kept = { ...s, entries }
      delete kept.follows
      return kept
    })
  return {
    ...plan,
    schedules,
    reviewSchedule: plan.reviewSchedule === id ? schedules[0].id : plan.reviewSchedule,
    rangeReviews: plan.rangeReviews?.filter((review) => review.schedule !== id),
    groundReads: plan.groundReads?.filter((read) => read.schedule !== id),
    ...withCrossings(plan, (c) => c.schedule !== id),
  }
}

export function setReviewSchedule(plan: Plan, id: string): Plan {
  return plan.schedules.some((s) => s.id === id) ? { ...plan, reviewSchedule: id } : plan
}

/** Would following `from` make `id` follow itself? */
export function followWouldLoop(plan: Plan, id: string, from: string) {
  let next: string | undefined = from
  const seen = new Set<string>()
  while (next && !seen.has(next)) {
    if (next === id) return true
    seen.add(next)
    next = plan.schedules.find((s) => s.id === next)?.follows?.schedule
  }
  return false
}

// ---------------------------------------------------------------------------------------------
// Stream crossings (`crossings/`)

/** The plan's crossings that `keep` keeps; a plan that had none stays without the key. */
function withCrossings(plan: Plan, keep: (c: CrossingRecord) => boolean): Pick<Plan, 'crossings'> {
  return plan.crossings ? { crossings: plan.crossings.filter(keep) } : {}
}

/** Lists a crossing the reviewer entered for a block under a schedule, with nothing answered. */
export function addCrossing(plan: Plan, blockId: string, schedule: string, label: string): { plan: Plan; key: string } {
  const block = plan.blocks.find((b) => b.id === blockId)
  if (!block || !plan.schedules.some((s) => s.id === schedule)) return { plan, key: '' }
  const record = blankCrossing(plan, block, schedule, label)
  return { plan: { ...plan, crossings: [...(plan.crossings ?? []), record] }, key: record.key }
}

export type CrossingChange = Partial<Pick<CrossingRecord, 'label' | 'role' | 'structure' | 'at' | 'note'>>

/**
 * Renames a crossing or changes what is recorded about it. A blank label keeps the old one; a
 * structure, place or note set to `undefined` (or a blank note) is removed, not stored empty.
 */
export function updateCrossing(plan: Plan, key: string, change: CrossingChange): Plan {
  if (!plan.crossings?.some((c) => c.key === key)) return plan
  return {
    ...plan,
    crossings: plan.crossings.map((c) => {
      if (c.key !== key) return c
      const next: CrossingRecord = { ...c, ...change }
      if (change.label !== undefined) next.label = change.label.trim() || c.label
      for (const field of ['structure', 'at', 'note'] as const)
        if (field in change && (next[field] === undefined || (field === 'note' && !next.note?.trim())))
          delete next[field]
      if (next.note) next.note = next.note.trim()
      return next
    }),
  }
}

/** Keeps a crossing's own answers, exceptions claimed and releases chosen. */
export function setCrossingReview(plan: Plan, key: string, review: ReviewCase): Plan {
  if (!plan.crossings?.some((c) => c.key === key)) return plan
  return { ...plan, crossings: plan.crossings.map((c) => (c.key === key ? { ...c, review } : c)) }
}

/**
 * Keys a crossing to its block's footprint as it stands now: the reviewer's word that the crossing
 * is still made after the block's shape or schedule changed. Its answers are kept.
 */
export function confirmCrossing(plan: Plan, key: string): Plan {
  const record = plan.crossings?.find((c) => c.key === key)
  const block = record && plan.blocks.find((b) => b.id === record.block)
  if (!record || !block || !plan.schedules.some((s) => s.id === record.schedule)) return plan
  const { shape, signature } = crossingFootprint(plan, block, record.schedule)
  return {
    ...plan,
    crossings: plan.crossings!.map((c) => (c.key === key ? { ...c, shape: shape.id, footprint: signature } : c)),
  }
}

export function removeCrossing(plan: Plan, key: string): Plan {
  return plan.crossings ? { ...plan, crossings: plan.crossings.filter((c) => c.key !== key) } : plan
}
