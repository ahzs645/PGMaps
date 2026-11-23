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
 * DOM- and network-free.
 */
import { object, text } from '@/lib/jsonGuards'
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

/** Reads a plan file of any version the planner has written. */
export function openPlanFile(raw: unknown): Opened {
  const data = object(raw, 'file')
  if (data.format === PLAN_FORMAT) return { plan: parsePlan(raw), notes: [] }
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
          sets: object(r.sets ?? {}, 'facts'),
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
