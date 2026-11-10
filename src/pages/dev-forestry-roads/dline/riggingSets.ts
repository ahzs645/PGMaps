/**
 * Named rigging sets saved in the project: a rope, carriage and load with the clearance it must
 * keep, and optionally the saddle-angle limits a support layout is judged by. D-lines and the
 * extraction reach's cable yarder both read them, so a machine is entered once.
 *
 * A set is the user's own: nothing here is a rating or a recommendation. Pure: no DOM or network.
 */
import { parseRigging, type CableRigging } from '../cableMechanics'
import { CABLE_RULE_LIMITS, type CableCoverageRule } from '../cableCoverageRule'
import { DEFAULT_SUPPORT_LAYOUT, SUPPORT_LAYOUT_LIMITS, type CableSupportLayout } from '../cableLayout/settings'
import type { CableLine } from '../types'

export const MAX_RIGGING_SETS = 50
export const MAX_RIGGING_SET_NAME = 80

/** The support-layout limits a set carries. */
export const SET_LIMIT_KEYS = ['liftOffDeg', 'holdDownDeg', 'maxLoadedDeg', 'maxLoadedEndDeg'] as const
export type RiggingSetLimits = Pick<CableSupportLayout, (typeof SET_LIMIT_KEYS)[number]>

export interface RiggingSet {
  id: string
  name: string
  rigging: CableRigging
  limits?: RiggingSetLimits
}

const clean = (name: string) => name.replace(/\s+/g, ' ').trim()
const sameName = (a: string, b: string) => clean(a).toLocaleLowerCase('en-CA') === clean(b).toLocaleLowerCase('en-CA')

/** The set of that name, ignoring case and spacing. */
export const riggingSetNamed = (sets: readonly RiggingSet[], name: string) =>
  clean(name) ? (sets.find((set) => sameName(set.name, name)) ?? null) : null

/** Why a name cannot be used, or null. Another set's name is taken; the set's own is not. */
export function riggingSetNameError(sets: readonly RiggingSet[], name: string, ownId?: string): string | null {
  const value = clean(name)
  if (!value) return 'Name the set.'
  if (value.length > MAX_RIGGING_SET_NAME) return `Keep the name to ${MAX_RIGGING_SET_NAME} characters.`
  if (sets.some((set) => set.id !== ownId && sameName(set.name, value))) return 'Another set has that name.'
  return null
}

/**
 * Saves the rigging (and limits) under a name. A set of the same name is replaced in place, so
 * saving again after an edit updates it; otherwise the set is added.
 */
export function saveRiggingSet(
  sets: readonly RiggingSet[],
  name: string,
  rigging: CableRigging,
  limits: RiggingSetLimits | undefined,
  newId: () => string,
): RiggingSet[] {
  const value = clean(name)
  if (!value) throw Error('Name the set.')
  if (value.length > MAX_RIGGING_SET_NAME) throw Error(`Keep the name to ${MAX_RIGGING_SET_NAME} characters.`)
  parseRigging(rigging)
  const existing = riggingSetNamed(sets, value)
  const next: RiggingSet = {
    id: existing?.id ?? newId(),
    name: value,
    rigging: { ...rigging },
    ...(limits ? { limits: pickLimits(limits) } : {}),
  }
  if (existing) return sets.map((set) => (set.id === existing.id ? next : set))
  if (sets.length >= MAX_RIGGING_SETS) throw Error(`A project keeps at most ${MAX_RIGGING_SETS} rigging sets.`)
  return [...sets, next]
}

export function renameRiggingSet(sets: readonly RiggingSet[], id: string, name: string): RiggingSet[] {
  const error = riggingSetNameError(sets, name, id)
  if (error) throw Error(error)
  return sets.map((set) => (set.id === id ? { ...set, name: clean(name) } : set))
}

export const deleteRiggingSet = (sets: readonly RiggingSet[], id: string): RiggingSet[] =>
  sets.filter((set) => set.id !== id)

const pickLimits = (source: RiggingSetLimits): RiggingSetLimits => ({
  liftOffDeg: source.liftOffDeg,
  holdDownDeg: source.holdDownDeg,
  maxLoadedDeg: source.maxLoadedDeg,
  maxLoadedEndDeg: source.maxLoadedEndDeg,
})

/** The D-line's limits to save with its rigging: its support layout's, or none on default settings. */
export const lineLimits = (line: CableLine): RiggingSetLimits | undefined =>
  line.supportLayout ? pickLimits(line.supportLayout) : undefined

/** The D-line with the set's rigging on Rope and load, and the set's limits on its support layout. */
export function applyRiggingSetToLine(line: CableLine, set: RiggingSet): CableLine {
  return {
    ...line,
    sagModel: 'mechanics',
    rigging: { ...set.rigging },
    ...(set.limits
      ? { supportLayout: { ...(line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT), ...pickLimits(set.limits) } }
      : {}),
  }
}

/**
 * The yarder's rule with the set's rigging. Block coverage tensions every line to its allowable
 * working tension, so the set's tension mode becomes `allowable`; its largest intermediate loaded
 * break angle, where it has one inside the coverage limits, becomes the rule's.
 */
export function applyRiggingSetToRule(rule: CableCoverageRule, set: RiggingSet): CableCoverageRule {
  const [low, high] = CABLE_RULE_LIMITS.maxBreakDeg
  const angle = set.limits?.maxLoadedDeg
  return {
    ...rule,
    rigging: { ...set.rigging, tensionMode: 'allowable' },
    ...(angle !== undefined && angle >= low && angle <= high ? { maxBreakDeg: angle } : {}),
  }
}

const sameRigging = (a: CableRigging, b: CableRigging) =>
  (Object.keys(a) as (keyof CableRigging)[]).every((key) => a[key] === b[key]) &&
  Object.keys(a).length === Object.keys(b).length

/** The parts of the yarder's rule a set changes. */
type SetFields = Pick<CableCoverageRule, 'rigging' | 'maxBreakDeg'>

/**
 * What applying a set to the extraction reach's yarder changed. The yarder's rule is the panel's
 * own state, not a project edit, so the header Undo never reverses it: this does.
 */
export interface YarderSetUndo {
  setName: string
  before: SetFields
  after: SetFields
}

/** Applies a set to the yarder's rule, with what puts the rule back. */
export function applyRiggingSetWithUndo(
  rule: CableCoverageRule,
  set: RiggingSet,
): { rule: CableCoverageRule; undo: YarderSetUndo } {
  const next = applyRiggingSetToRule(rule, set)
  return {
    rule: next,
    undo: {
      setName: set.name,
      before: { rigging: rule.rigging, maxBreakDeg: rule.maxBreakDeg },
      after: { rigging: next.rigging, maxBreakDeg: next.maxBreakDeg },
    },
  }
}

/**
 * The rule as it was before the set was applied, or null once the rope, load or break limit has
 * been changed since (restoring would then undo those changes as well).
 */
export function undoRiggingSet(rule: CableCoverageRule, undo: YarderSetUndo): CableCoverageRule | null {
  if (!sameRigging(rule.rigging, undo.after.rigging) || rule.maxBreakDeg !== undo.after.maxBreakDeg) return null
  return { ...rule, ...undo.before }
}

/** The set whose rigging the given rigging is, or null when it is not any set's (or was edited). */
export function matchingRiggingSet(
  sets: readonly RiggingSet[] | undefined,
  rigging: CableRigging | undefined,
  options: { ignoreTensionMode?: boolean } = {},
): RiggingSet | null {
  if (!rigging) return null
  const strip = (r: CableRigging) => (options.ignoreTensionMode ? { ...r, tensionMode: 'allowable' as const } : r)
  return sets?.find((set) => sameRigging(strip(set.rigging), strip(rigging))) ?? null
}

/** Reads the project's rigging sets, refusing out-of-range values and duplicate ids or names. */
export function parseRiggingSets(raw: unknown): RiggingSet[] {
  if (!Array.isArray(raw) || raw.length > MAX_RIGGING_SETS)
    throw Error(`Rigging sets must be a list of at most ${MAX_RIGGING_SETS}.`)
  const sets: RiggingSet[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('A rigging set must be an object.')
    const r = item as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id || r.id.length > 100) throw Error('A rigging set needs an id.')
    if (typeof r.name !== 'string') throw Error('A rigging set needs a name.')
    const nameError = riggingSetNameError(sets, r.name)
    if (nameError) throw Error(`Rigging set "${r.name.slice(0, 40)}": ${nameError}`)
    if (sets.some((set) => set.id === r.id)) throw Error('Two rigging sets share an id.')
    let limits: RiggingSetLimits | undefined
    if (r.limits !== undefined) {
      const l = (r.limits ?? {}) as Record<string, unknown>
      for (const key of SET_LIMIT_KEYS) {
        const [low, high] = SUPPORT_LAYOUT_LIMITS[key]
        const v = l[key]
        if (typeof v !== 'number' || !Number.isFinite(v) || v < low || v > high)
          throw Error(`Rigging set "${r.name.slice(0, 40)}": ${key} must be between ${low} and ${high}.`)
      }
      limits = pickLimits(l as unknown as RiggingSetLimits)
    }
    sets.push({ id: r.id, name: clean(r.name), rigging: parseRigging(r.rigging), ...(limits ? { limits } : {}) })
  }
  return sets
}
