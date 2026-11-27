/**
 * Opens the two formats the planner wrote before blocks and schedules were separate
 * (`pgmaps-patches-v1` and `pgmaps-block-plan/v1`) as a v2 plan, and says what changed.
 *
 * In those files every polygon carried a schedule (`reference`, `proposed` or `alternative`) and
 * a year. Here `reference` polygons become the baseline; `proposed` and `alternative` polygons
 * become blocks, and one polygon drawn identically in both becomes one block cut in two years,
 * which is what the old files had to fake. Reviews were kept per block, schedule and map year;
 * a block keeps its proposed-schedule review where it had one, else its latest.
 *
 * A v2 plan whose block reviews answered stream crossings once for the block (`bc.water-crossings`
 * 1.0.0) opens with that answer set as one crossing record (`migrateCrossings`), and the block's
 * one question under `bc.block-crossings` in its place.
 *
 * DOM- and network-free.
 */
import { object, text } from '@/lib/jsonGuards'
import type { FactSet } from '../../../packages/legal-rules/src/contract'
import { blankCrossing, type CrossingRecord } from './crossings/record'
import { parseAcquisition } from './acquire/record'
import { parseProject, type Footprint, type Project } from '../forest-patches/project'
import {
  emptyPlan,
  nextId,
  PLAN_FORMAT,
  parsePlan,
  type Block,
  type Disturbance,
  type Plan,
  type ReviewCase,
  type Schedule,
} from './plan'

export interface Opened {
  plan: Plan
  /** What the reader changed to open an older file, for the person to read. */
  notes: string[]
}

function fromProject(project: Project): { plan: Plan; blockOf: Map<string, string>; notes: string[] } {
  const notes: string[] = []
  const plan = emptyPlan(project.startYear)
  plan.area = {
    district: project.district,
    ndu: project.ndu,
    startYear: project.startYear,
    source: project.source,
    applicabilityEvidence: project.applicabilityEvidence,
  }
  plan.landscape = { rationale: project.rationale }
  const baseline: Disturbance[] = []
  const blocks: Block[] = []
  const blockOf = new Map<string, string>()
  const byGeometry = new Map<string, { block: Block; scenarios: Set<string> }>()
  const entries: Record<'proposed' | 'alternative', Schedule['entries']> = { proposed: {}, alternative: {} }
  const feature = (f: Footprint) => f.properties
  for (const f of project.features) {
    const p = feature(f)
    if (p.scenario === 'reference') {
      baseline.push({
        id: nextId(
          'disturbance',
          baseline.map((d) => d.id),
        ),
        name: p.id,
        kind: 'unspecified',
        year: p.year,
        yearBasis: p.yearBasis ?? 'plan-entry',
        source: p.source,
        geometry: f.geometry,
      })
      continue
    }
    const key = JSON.stringify(f.geometry)
    const twin = byGeometry.get(key)
    let block: Block
    if (twin && !twin.scenarios.has(p.scenario)) {
      block = twin.block
      twin.scenarios.add(p.scenario)
      notes.push(`“${p.id}” has the same outline as “${block.name}”, so both are one block in two schedules.`)
    } else {
      block = {
        id: nextId(
          'block',
          blocks.map((b) => b.id),
        ),
        name: p.id,
        shapes: [{ id: 'shape-1', name: 'As proposed', geometry: f.geometry }],
        source: p.source,
      }
      blocks.push(block)
      byGeometry.set(key, { block, scenarios: new Set([p.scenario]) })
    }
    blockOf.set(p.id, block.id)
    entries[p.scenario][block.id] = { year: p.year }
  }
  if (baseline.some((d) => d.kind === 'unspecified'))
    notes.push('Earlier files did not record what kind of disturbance a baseline polygon was; each reads “Not stated”.')
  plan.baseline = baseline
  plan.blocks = blocks
  plan.schedules = [
    { id: 'none', name: 'No further harvest', entries: {} },
    { id: 'proposed', name: 'Proposed', entries: entries.proposed },
    ...(Object.keys(entries.alternative).length
      ? [{ id: 'alternative', name: 'Alternative', entries: entries.alternative }]
      : []),
  ]
  return { plan, blockOf, notes }
}

function oldReviewKey(key: string): { footprint: string | null; scenario: string } | null {
  try {
    const parsed: unknown = JSON.parse(key)
    if (Array.isArray(parsed) && (typeof parsed[0] === 'string' || parsed[0] === null) && typeof parsed[1] === 'string')
      return { footprint: parsed[0], scenario: parsed[1] }
  } catch {
    // An unreadable key is reported below as a review that could not be placed.
  }
  return null
}

/** The release that answered stream crossings once per block, and the block release in its place. */
export const BLOCK_WATER_RELEASE = 'bc.water-crossings@1.0.0'
export const BLOCK_CROSSINGS_RELEASE = 'bc.block-crossings@1.0.0'
export const MIGRATED_CROSSING_LABEL = 'All crossings, answered for the block before crossings were listed'

/**
 * Turns each block review's `bc.water-crossings` 1.0.0 answer set into one crossing record under
 * the schedule under review, kept on release 1.0.0 with its answers and exceptions claimed, and puts
 * `bc.block-crossings` 1.0.0 in the block review in its place, with the block's own answer to
 * whether it changes a stream carried over (the same question, asked of the block). A release that
 * was chosen with nothing answered is only replaced. Running it again changes nothing.
 */
export function migrateCrossings(plan: Plan): Opened {
  const notes: string[] = []
  let next = plan
  let moved = 0,
    replaced = 0,
    carried = 0
  for (const [blockId, review] of Object.entries(plan.reviews)) {
    if (!review.selected.includes(BLOCK_WATER_RELEASE)) continue
    const block = next.blocks.find((b) => b.id === blockId)
    if (!block) continue
    const set = review.sets[BLOCK_WATER_RELEASE]
    const answered = Boolean(set && (set.facts.some((f) => f.value !== null) || set.claims?.length))
    const sets = { ...review.sets }
    delete sets[BLOCK_WATER_RELEASE]
    const changes = set?.facts.find((f) => f.id === 'stream-changes' && f.value !== null)
    if (changes && !sets[BLOCK_CROSSINGS_RELEASE]) {
      const [id, version] = BLOCK_CROSSINGS_RELEASE.split('@')
      sets[BLOCK_CROSSINGS_RELEASE] = {
        format: 'pgmaps-legal-facts/v1',
        pack: id,
        version,
        source: 'Entered in the block planner',
        facts: [
          {
            id: 'stream-changes',
            value: changes.value,
            evidence: `Carried from the block’s answer under BC stream crossings 1.0.0${changes.evidence ? `: ${changes.evidence}` : ''}`,
          },
        ],
      } satisfies FactSet
      carried++
    }
    const selected = review.selected.filter((k) => k !== BLOCK_WATER_RELEASE)
    if (!selected.includes(BLOCK_CROSSINGS_RELEASE)) selected.push(BLOCK_CROSSINGS_RELEASE)
    next = { ...next, reviews: { ...next.reviews, [blockId]: { ...review, selected, sets } } }
    if (!answered) {
      replaced++
      continue
    }
    const record: CrossingRecord = blankCrossing(next, block, next.reviewSchedule, MIGRATED_CROSSING_LABEL, {
      selected: [BLOCK_WATER_RELEASE],
      date: review.date,
      sets: { [BLOCK_WATER_RELEASE]: set },
    })
    next = { ...next, crossings: [...(next.crossings ?? []), record] }
    moved++
  }
  const schedule = plan.schedules.find((s) => s.id === plan.reviewSchedule)?.name ?? plan.reviewSchedule
  if (moved)
    notes.push(
      `${moved} block review${moved === 1 ? '' : 's'} answered stream crossings once for the whole block (BC stream crossings 1.0.0). Each is now one crossing, “${MIGRATED_CROSSING_LABEL}”, under the schedule ${schedule}, with its answers and exceptions on release 1.0.0. List the crossings one by one to answer each on its own.`,
    )
  if (replaced)
    notes.push(
      `${replaced} block review${replaced === 1 ? '' : 's'} chose BC stream crossings 1.0.0 with nothing answered; ${replaced === 1 ? 'it now asks' : 'they now ask'} the block’s one question under Stream crossings on the block 1.0.0 instead.`,
    )
  if (carried)
    notes.push(
      `The answer to whether the block changes a stream was carried to Stream crossings on the block 1.0.0, which asks the same of the block, for ${carried} block${carried === 1 ? '' : 's'}.`,
    )
  return { plan: next, notes }
}

/** A v2 plan as read, its older stream crossing answers moved, and a note for records left out. */
function openV2(raw: unknown, data: Record<string, unknown>): Opened {
  const parsed = parsePlan(raw)
  const notes: string[] = []
  const given = Array.isArray(data.crossings) ? data.crossings.length : 0
  const kept = parsed.crossings?.length ?? 0
  if (given > kept)
    notes.push(
      `${given - kept} stream crossing${given - kept === 1 ? '' : 's'} could not be read, or named a block or schedule the plan no longer has, and ${given - kept === 1 ? 'was' : 'were'} left out.`,
    )
  const { dropped } = parseAcquisition(data.acquisition, parsed.blocks, parsed.schedules)
  if (dropped)
    notes.push(
      `${dropped} record${dropped === 1 ? '' : 's'} of the records asked for or received could not be read, or named a block or schedule the plan no longer has, and ${dropped === 1 ? 'was' : 'were'} left out.`,
    )
  const migrated = migrateCrossings(parsed)
  return { plan: migrated.plan, notes: [...notes, ...migrated.notes] }
}

/** Reads a plan file of any version the planner has written. */
export function openPlanFile(raw: unknown): Opened {
  const data = object(raw, 'file')
  if (data.format === PLAN_FORMAT) return openV2(raw, data)
  if (data.format === 'pgmaps-patches-v1') {
    const { plan, notes } = fromProject(parseProject(raw))
    return { plan: parsePlan(plan), notes: ['Opened a patch project from an earlier version.', ...notes] }
  }
  if (data.format !== 'pgmaps-block-plan/v1')
    throw Error('Open a block plan (pgmaps-block-plan) or a patch project (pgmaps-patches-v1).')
  const { plan, blockOf, notes } = fromProject(parseProject(data.project))
  notes.unshift('Opened a block plan from an earlier version.')
  const reviews = object(data.reviews ?? {}, 'reviews')
  let placed = 0,
    dropped = 0
  const chosen = new Map<string, { scenario: string; review: ReviewCase }>()
  for (const [key, review] of Object.entries(reviews)) {
    const parsedKey = oldReviewKey(key)
    const block = parsedKey?.footprint ? blockOf.get(parsedKey.footprint) : undefined
    if (!parsedKey || !block) {
      dropped++
      continue
    }
    const r = object(review, 'review')
    const current = chosen.get(block)
    if (!current || current.scenario !== 'proposed' || parsedKey.scenario === 'proposed') {
      chosen.set(block, {
        scenario: parsedKey.scenario,
        review: {
          selected: r.selected as string[],
          date: text(r.date, 'review date'),
          sets: object(r.sets ?? {}, 'facts') as ReviewCase['sets'],
        },
      })
    }
    placed++
  }
  for (const [block, { review }] of chosen) plan.reviews[block] = review
  if (placed > chosen.size)
    notes.push(
      `Reviews were kept per block, schedule and map year; ${chosen.size} of ${placed} are kept, one per block (the proposed schedule's where there was one).`,
    )
  if (dropped)
    notes.push(`${dropped} review(s) of a baseline polygon or of no block could not be placed and were left out.`)
  if (data.zones) plan.zones = data.zones as Plan['zones']
  if (Array.isArray(data.packs)) plan.packs = data.packs
  return { plan: parsePlan(plan), notes }
}
