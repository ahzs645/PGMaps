/**
 * **Use this section for…**: the section at one station given to a range of stations through the
 * road's template station assignments, and the stations of that range whose cut or fill batter
 * never met the ground. No DOM.
 *
 * The section at a station is what `templateAt` resolves there. A named template on both sides is
 * assigned by name; the base section clears the range back to the base; anything else (one side
 * different, or a station inside a transition) is saved as a new named template, "Section at …",
 * so the range is built from exactly the section shown.
 */
import { isBeyondReachFlag } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { templateAt, validateEngineering } from './templates'
import type { Alignment, AlignmentEngineering, RoadStation, RoadTemplate, TemplateAssignment } from './types'

/** The shortest range a section is given to. */
export const MIN_SECTION_RANGE_M = 1
/** A trimmed existing range shorter than this is removed rather than kept as a sliver. */
export const MIN_TRIMMED_PIECE_M = 0.5
/** Matches the library limits `validateEngineering` enforces. */
export const MAX_TEMPLATES = 50
export const MAX_ASSIGNMENTS = 200

const EPS = 1e-6

export type SectionSource =
  | { kind: 'base'; name: string }
  | { kind: 'named'; templateId: string; name: string }
  | { kind: 'snapshot'; template: RoadTemplate; name: string }

/**
 * What the section at `chainage` is made of. `stationLabel` names a snapshot ("Section at 0+120.0");
 * a name the library already holds gets a number after it.
 */
export function sectionSourceAt(
  alignment: Alignment,
  chainage: number,
  stationLabel: (chainage: number) => string,
): SectionSource {
  const resolved = templateAt(alignment, chainage)
  const e = alignment.engineering
  if (!resolved.assignmentIds.length || !e) return { kind: 'base', name: 'Base section' }
  const assigned = resolved.assignmentIds.map((id) => e.assignments.find((a) => a.id === id))
  const templateIds = new Set(assigned.map((a) => a?.templateId))
  const both = assigned.some((a) => a?.side === 'both') || assigned.length === 2
  const transition = /· transition$/.test(resolved.leftName) || /· transition$/.test(resolved.rightName)
  const [only] = templateIds
  const named = templateIds.size === 1 && only ? e.templates.find((t) => t.id === only) : undefined
  if (named && both && !transition) return { kind: 'named', templateId: named.id, name: named.name }
  const taken = new Set(e.templates.map((t) => t.name))
  const base = `Section at ${stationLabel(chainage)}`
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} (${n})`
  return { kind: 'snapshot', template: structuredClone(resolved.template), name }
}

export interface AffectedRange {
  /** Its place in the assignment list, counted from 1 as the editor shows it. */
  number: number
  assignment: TemplateAssignment
  templateName: string
  outcome: 'replaced' | 'trimmed' | 'split'
  /** Set when a trimmed range keeps a transition, which now blends back to the base at the cut. */
  transitionNote?: string
}

export interface SectionRangePlan {
  from: number
  to: number
  source: SectionSource
  /** Existing ranges the new one replaces, trims or splits. Applying them needs the reader's yes. */
  affected: AffectedRange[]
  engineering: AlignmentEngineering
  /** False when the range already holds this section, so applying would change nothing. */
  changed: boolean
}

/**
 * The road's engineering with the section at `chainage` given to `from`–`to` on both sides. Ranges
 * already there are trimmed to make room (split when they span it) and the result is validated, so
 * a plan either applies cleanly or returns the reason it cannot.
 */
export function planSectionRange(
  alignment: Alignment,
  chainage: number,
  range: readonly [number, number],
  roadLength: number,
  options: { id: () => string; stationLabel: (chainage: number) => string },
): { plan: SectionRangePlan } | { error: string } {
  const from = Math.min(range[0], range[1]),
    to = Math.max(range[0], range[1])
  const label = options.stationLabel
  if (![from, to, chainage].every(Number.isFinite)) return { error: 'Enter a from and a to station.' }
  if (from < -EPS || to > roadLength + EPS)
    return { error: `Choose a range on the road, between ${label(0)} and ${label(roadLength)}.` }
  if (to - from < MIN_SECTION_RANGE_M) return { error: `Choose a range at least ${MIN_SECTION_RANGE_M} m long.` }
  const source = sectionSourceAt(alignment, chainage, label)
  const e = alignment.engineering ?? createEngineeringDesign()
  const names = new Map(e.templates.map((t) => [t.id, t.name]))
  const templates = [...e.templates]
  let templateId: string | null = null
  if (source.kind === 'named') templateId = source.templateId
  if (source.kind === 'snapshot') {
    if (templates.length >= MAX_TEMPLATES)
      return {
        error: `This section mixes templates, so it is saved as a new one, but the library already holds ${MAX_TEMPLATES}. Remove one first.`,
      }
    templateId = options.id()
    templates.push({ id: templateId, name: source.name, template: source.template })
  }
  const affected: AffectedRange[] = []
  const kept: TemplateAssignment[] = []
  e.assignments.forEach((a, index) => {
    if (a.end <= from + EPS || a.start >= to - EPS) {
      kept.push(a)
      return
    }
    const pieces: TemplateAssignment[] = []
    if (from - a.start >= MIN_TRIMMED_PIECE_M) pieces.push({ ...a, end: from })
    if (a.end - to >= MIN_TRIMMED_PIECE_M)
      pieces.push({ ...a, ...(pieces.length ? { id: options.id() } : {}), start: to })
    const capped = pieces.map((p) => ({ ...p, transitionM: Math.min(p.transitionM, (p.end - p.start) / 2) }))
    kept.push(...capped)
    affected.push({
      number: index + 1,
      assignment: a,
      templateName: names.get(a.templateId) ?? 'Template',
      outcome: pieces.length === 0 ? 'replaced' : pieces.length === 2 ? 'split' : 'trimmed',
      ...(pieces.length && a.transitionM > 0
        ? {
            transitionNote: `its ${Number(a.transitionM.toFixed(1))} m transition now blends back to the base section at the cut`,
          }
        : {}),
    })
  })
  let assignments = kept
  if (templateId) {
    const added: TemplateAssignment = {
      id: options.id(),
      start: from,
      end: to,
      templateId,
      side: 'both',
      transitionM: 0,
    }
    // A plain range of the same template that touches the new one becomes part of it.
    const joins = (a: TemplateAssignment) =>
      a.templateId === templateId &&
      a.side === 'both' &&
      a.transitionM === 0 &&
      (Math.abs(a.end - added.start) <= EPS || Math.abs(a.start - added.end) <= EPS)
    const joined = assignments.filter(joins)
    for (const a of joined) {
      added.start = Math.min(added.start, a.start)
      added.end = Math.max(added.end, a.end)
    }
    const first = joined[0]
    assignments = [...assignments.filter((a) => !joined.includes(a)), first ? { ...added, id: first.id } : added]
  }
  if (assignments.length > MAX_ASSIGNMENTS)
    return {
      error: `The road would hold more than ${MAX_ASSIGNMENTS} template ranges. Join or remove some first.`,
    }
  assignments.sort((a, b) => a.start - b.start)
  const engineering: AlignmentEngineering = { ...e, templates, assignments }
  try {
    validateEngineering(engineering)
  } catch (error) {
    return {
      error: `The template ranges cannot take this section: ${error instanceof Error ? error.message : 'invalid ranges.'}`,
    }
  }
  const before = alignment.engineering ?? createEngineeringDesign()
  const changed =
    templates.length !== before.templates.length ||
    JSON.stringify(normalised(assignments)) !== JSON.stringify(normalised(before.assignments))
  return { plan: { from, to, source, affected, engineering, changed } }
}

const normalised = (list: readonly TemplateAssignment[]) =>
  [...list]
    .map(({ start, end, templateId, side, transitionM }) => ({ start, end, templateId, side, transitionM }))
    .sort((a, b) => a.start - b.start || a.side.localeCompare(b.side))

export interface BatterMiss {
  chainage: number
  side: 'left' | 'right'
  /** What the batter was doing where the section stopped: cutting, filling, or unknown with no ground. */
  batter: 'cut' | 'fill' | 'unknown'
  /** `reach`: the batter ran past the section reach; `terrain`: the ground ran out first. */
  cause: 'reach' | 'terrain'
}

const DAYLIGHT_FLAG = /^(Left|Right) daylight unresolved/

/**
 * Stations from `from` to `to` where a cut or fill batter never met the ground, side by side. The
 * batter is called cut where the ground at its last designed point stands above it and fill where
 * it lies below.
 */
export function batterMisses(
  stations: readonly Pick<RoadStation, 'chainage' | 'flags' | 'section'>[],
  from: number,
  to: number,
): BatterMiss[] {
  const out: BatterMiss[] = []
  for (const station of stations) {
    if (station.chainage < from - EPS || station.chainage > to + EPS) continue
    for (const flag of station.flags) {
      const match = DAYLIGHT_FLAG.exec(flag)
      if (!match) continue
      const side = match[1] === 'Left' ? ('left' as const) : ('right' as const)
      // The outermost designed point on that side: where the batter stopped.
      const last = station.section.reduce<(typeof station.section)[number] | undefined>(
        (outer, p) =>
          p.design !== null &&
          (side === 'left' ? p.offset < 0 : p.offset > 0) &&
          (!outer || Math.abs(p.offset) > Math.abs(outer.offset))
            ? p
            : outer,
        undefined,
      )
      const batter =
        last && last.ground !== null && last.design !== null
          ? last.ground > last.design
            ? ('cut' as const)
            : ('fill' as const)
          : ('unknown' as const)
      out.push({ chainage: station.chainage, side, batter, cause: isBeyondReachFlag(flag) ? 'reach' : 'terrain' })
    }
  }
  return out
}

/**
 * Whether the range a section was given to still has that section. False once an undo, or another
 * edit, gave the range back to what it had, so a batter check made for the section is no longer about
 * the road shown.
 */
export function rangeStillHolds(
  alignment: Alignment,
  applied: { from: number; to: number; name: string },
  stationLabel: (chainage: number) => string,
): boolean {
  const source = sectionSourceAt(alignment, (applied.from + applied.to) / 2, stationLabel)
  return source.kind !== 'snapshot' && source.name === applied.name
}
