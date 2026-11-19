/**
 * Contents presets a person saves for a list that has none of its own: each part's state and,
 * optionally, the order. Kept in this browser by `useSavedContents` (`src/components/ui/
 * use-saved-contents.ts`); these are the rules, free of DOM and network access. A stored preset is
 * read again by hand on every read (`src/lib/jsonGuards.ts`); a part id the list no longer has stays
 * in the stored preset and is reported when the preset is applied, never mapped to another part.
 */
import { list, object, optional, text, type JsonObject } from '@/lib/jsonGuards'

import { orderedKeys, type ContentsChoice, type ContentsPart, type ContentsPreset } from './contents'

export type SavedContents = {
  id: string
  name: string
  /** Each part's state by key. */
  states: Record<string, string>
  /** The key order, when the list can be reordered. */
  order?: string[]
}

/** How many presets one list keeps. */
export const MAX_SAVED_CONTENTS = 30
/** The longest preset name, in characters. */
export const MAX_SAVED_CONTENTS_NAME = 80
const MAX_KEY = 200
const MAX_PARTS = 2000

/** A name as it is kept: trimmed, inner runs of space made one, cut to the cap; null when nothing is left. */
export function savedContentsName(name: string): string | null {
  const tidy = name.replace(/\s+/g, ' ').trim().slice(0, MAX_SAVED_CONTENTS_NAME).trim()
  return tidy || null
}

function readStates(value: unknown, label: string): Record<string, string> {
  const source: JsonObject = object(value, label)
  const keys = Object.keys(source)
  if (keys.length > MAX_PARTS) throw Error(`${label} must hold at most ${MAX_PARTS} parts.`)
  const states: Record<string, string> = {}
  for (const key of keys) {
    if (!key || key.length > MAX_KEY) throw Error(`${label} has a part id of 1–${MAX_KEY} characters.`)
    states[key] = text(source[key], `${label}.${key}`, MAX_KEY)
  }
  return states
}

/** One stored preset, checked field by field. Throws a readable Error naming the field it rejects. */
export function parseSavedContents(value: unknown, label = 'Saved contents'): SavedContents {
  const source = object(value, label)
  const id = text(source.id, `${label}.id`, MAX_KEY)
  const name = savedContentsName(text(source.name, `${label}.name`, 1000))
  if (!name) throw Error(`${label}.name must not be blank.`)
  const states = readStates(source.states, `${label}.states`)
  const order = optional(source, 'order', (raw) =>
    list(raw, `${label}.order`, MAX_PARTS).map((key, index) => text(key, `${label}.order[${index}]`, MAX_KEY)),
  )
  return order ? { id, name, states, order } : { id, name, states }
}

export type SavedContentsRead = {
  saved: SavedContents[]
  /** Stored entries that no longer read, each with why. */
  unreadable: Array<{ index: number; error: string }>
}

/** Every stored preset of a list. A stored value that is not a list reads as none. */
export function readSavedContents(value: unknown): SavedContentsRead {
  const saved: SavedContents[] = []
  const unreadable: SavedContentsRead['unreadable'] = []
  if (!Array.isArray(value)) return { saved, unreadable }
  const ids = new Set<string>()
  value.forEach((entry, index) => {
    try {
      const preset = parseSavedContents(entry, `Saved contents ${index + 1}`)
      if (ids.has(preset.id)) throw Error(`Saved contents ${index + 1} repeats the id ${preset.id}.`)
      ids.add(preset.id)
      saved.push(preset)
    } catch (error) {
      unreadable.push({ index, error: error instanceof Error ? error.message : String(error) })
    }
  })
  return { saved, unreadable }
}

/**
 * The list after saving a preset. A name already used replaces that preset and keeps its id; a new
 * name past `MAX_SAVED_CONTENTS` is refused with why.
 */
export function withSavedContents(
  saved: readonly SavedContents[],
  entry: { id: string; name: string; states: Record<string, string>; order?: readonly string[] },
): { saved: SavedContents[]; preset: SavedContents } | { error: string } {
  const name = savedContentsName(entry.name)
  if (!name) return { error: 'Give the preset a name.' }
  const same = saved.find((preset) => preset.name.toLowerCase() === name.toLowerCase())
  const preset: SavedContents = {
    id: same?.id ?? entry.id,
    name,
    states: { ...entry.states },
    ...(entry.order ? { order: [...entry.order] } : {}),
  }
  if (same) return { saved: saved.map((existing) => (existing === same ? preset : existing)), preset }
  if (saved.length >= MAX_SAVED_CONTENTS)
    return { error: `This list keeps ${MAX_SAVED_CONTENTS} presets. Delete one to save another.` }
  if (saved.some((existing) => existing.id === entry.id)) return { error: `A preset already has the id ${entry.id}.` }
  return { saved: [...saved, preset], preset }
}

export type AppliedContents = {
  /** The states to write: only parts the list has, and only to one of its choices. */
  states: Record<string, string>
  /** The key order to write, when the preset holds one. */
  order?: string[]
  /** Part ids the preset names that the list no longer has: kept in the preset, left out here. */
  unknown: string[]
  /** Parts whose stored state is not one of the list's choices: left as they are. */
  invalid: string[]
}

/**
 * A saved preset applied to today's parts. A locked or unavailable part keeps its state; a part the
 * preset does not name keeps its own.
 */
export function applySavedContents(
  preset: SavedContents,
  parts: readonly ContentsPart[],
  choices: readonly ContentsChoice[],
): AppliedContents {
  const byKey = new Map(parts.map((part) => [part.key, part]))
  const values = new Set(choices.map((choice) => choice.value))
  const states: Record<string, string> = {}
  const unknown: string[] = []
  const invalid: string[] = []
  for (const [key, state] of Object.entries(preset.states)) {
    const part = byKey.get(key)
    if (!part) unknown.push(key)
    else if (!values.has(state)) invalid.push(key)
    else if (!part.locked && !part.unavailable) states[key] = state
  }
  if (!preset.order) return { states, unknown, invalid }
  const ordered = orderedKeys(
    parts.map((part) => part.key),
    preset.order,
  )
  for (const key of ordered.unknown) if (!unknown.includes(key)) unknown.push(key)
  return { states, order: ordered.keys, unknown, invalid }
}

/**
 * The saved preset the parts match now, or null. States compare on the parts the preset names that
 * the list still has; the order only when the preset holds one.
 */
export function matchingSavedContents(
  saved: readonly SavedContents[],
  parts: readonly ContentsPart[],
  choices: readonly ContentsChoice[],
): string | null {
  const keys = parts.map((part) => part.key)
  for (const preset of saved) {
    const applied = applySavedContents(preset, parts, choices)
    const statesMatch = parts.every((part) => !(part.key in applied.states) || applied.states[part.key] === part.state)
    const orderMatches = !applied.order || applied.order.every((key, index) => key === keys[index])
    if (statesMatch && orderMatches) return preset.id
  }
  return null
}

/** Saved presets as `DocumentContents` lists them, marked as the person's own. */
export function savedContentsPresets(saved: readonly SavedContents[]): ContentsPreset[] {
  return saved.map((preset) => ({ id: preset.id, label: preset.name, saved: true }))
}

/** The list after deleting a preset. */
export function withoutSavedContents(saved: readonly SavedContents[], id: string): SavedContents[] {
  return saved.filter((preset) => preset.id !== id)
}
