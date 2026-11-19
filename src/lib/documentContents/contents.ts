/**
 * The contents of a printed file as one list in print order: what each part is set to, which parts
 * may move and where, and the sentences a contents list prints and announces. The model behind
 * `DocumentContents` (`src/components/ui/document-contents.tsx`; `docs/shared-ui.md`, **Document
 * contents**). Free of DOM, network and React, so every rule here is unit tested.
 */

/** A state a part can be in. Two choices draw a checkbox; more draw a compact dropdown per row. */
export type ContentsChoice = { value: string; label: string; included: boolean }

/** The usual two states: the part prints, or it is left out. */
export const ON_OFF: readonly ContentsChoice[] = [
  { value: 'on', label: 'Prints', included: true },
  { value: 'off', label: 'Left out', included: false },
]

export type ContentsPart = {
  /** Unique in the list. A list that holds the same part twice keys by position. */
  key: string
  label: string
  /** A `ContentsGroup` id. A group's parts sit together in print order. */
  group?: string
  /** One of the list's choices. */
  state: string
  /** Always printed: no state control, a lock and this text ("Always printed"). */
  locked?: string
  /** Cannot print now, with the reason shown on the row. Its control is disabled and the row keeps its place. */
  unavailable?: string
  /** Cannot be moved (a cover that must stay first), and no other part moves across it. */
  pinned?: boolean
  /** A word or two on the row: "p. 4–6", "3 to complete", "prints nothing here". */
  detail?: string
  /**
   * A sentence under the name about the part ("Changed since its capture: captured again on Download"), on its own
   * line after a locked or unavailable part's text.
   */
  note?: string
  /** A longer explanation behind an (i). */
  help?: string
  /** The row offers Remove (a list that holds instances a person added). */
  removable?: boolean
}

export type ContentsGroup = { id: string; title: string; note?: string }

/** A preset the list can be set to. `saved` marks the person's own. */
export type ContentsPreset = { id: string; label: string; saved?: boolean }

/** Whether a list draws a checkbox per row (two choices) rather than a dropdown. */
export const isTwoState = (choices: readonly ContentsChoice[]) => choices.length === 2

/** The choice a two-state list means by "on" and by "off". */
export function onOffValues(choices: readonly ContentsChoice[]): { on: string; off: string } | null {
  if (!isTwoState(choices)) return null
  const on = choices.find((choice) => choice.included)
  const off = choices.find((choice) => !choice.included)
  return on && off ? { on: on.value, off: off.value } : null
}

/** Whether a part prints: a locked part always does, an unavailable one never, any other by its state's choice. */
export function partPrints(part: ContentsPart, choices: readonly ContentsChoice[]): boolean {
  if (part.locked) return true
  if (part.unavailable) return false
  return choices.find((choice) => choice.value === part.state)?.included ?? false
}

/** Whether a person can change a part's state: not locked and not unavailable. */
export const partSwitchable = (part: ContentsPart) => !part.locked && !part.unavailable

/** Each part's state by key, as a saved preset or a caller's comparison keeps it. */
export function contentsStates(parts: readonly ContentsPart[]): Record<string, string> {
  return Object.fromEntries(parts.map((part) => [part.key, part.state]))
}

/** Where a part may go: each index, or null when that move is not possible. */
export type MoveTargets = { up: number | null; down: number | null; top: number | null; bottom: number | null }

const NO_MOVES: MoveTargets = { up: null, down: null, top: null, bottom: null }

/**
 * The span of indices a part may occupy: the run of parts in its own group around it, cut at the
 * nearest pinned part on either side. A pinned part, or a key not in the list, has none.
 */
export function moveRange(parts: readonly ContentsPart[], key: string): { from: number; to: number } | null {
  const index = parts.findIndex((part) => part.key === key)
  if (index < 0 || parts[index].pinned) return null
  const group = parts[index].group
  const stays = (at: number) => at >= 0 && at < parts.length && parts[at].group === group && !parts[at].pinned
  let from = index
  while (stays(from - 1)) from--
  let to = index
  while (stays(to + 1)) to++
  return { from, to }
}

/** The indices a part may move to: one up, one down, the top and the bottom of its span. */
export function moveTargets(parts: readonly ContentsPart[], key: string): MoveTargets {
  const range = moveRange(parts, key)
  if (!range) return NO_MOVES
  const index = parts.findIndex((part) => part.key === key)
  return {
    up: index > range.from ? index - 1 : null,
    down: index < range.to ? index + 1 : null,
    top: index > range.from ? range.from : null,
    bottom: index < range.to ? range.to : null,
  }
}

/** Whether a part may move at all. */
export function canMove(parts: readonly ContentsPart[], key: string): boolean {
  const range = moveRange(parts, key)
  return !!range && range.to > range.from
}

/**
 * The key order after moving `key` so that it ends at `toIndex`, or null when the move is refused
 * (pinned, outside its group, across a pinned part, out of the list) or moves nothing.
 */
export function movedOrder(parts: readonly ContentsPart[], key: string, toIndex: number): string[] | null {
  const range = moveRange(parts, key)
  if (!range || !Number.isInteger(toIndex) || toIndex < range.from || toIndex > range.to) return null
  const index = parts.findIndex((part) => part.key === key)
  if (index === toIndex) return null
  const keys = parts.map((part) => part.key)
  keys.splice(index, 1)
  keys.splice(toIndex, 0, key)
  return keys
}

/**
 * Where a dragged part lands: `mids` are the rows' vertical middles in list order, `y` the pointer,
 * `from` the dragged part's index and `range` its span (`moveRange`). The part takes the place after
 * every other row of its span whose middle is above the pointer, so it never leaves its span.
 */
export function dragTargetIndex(
  mids: readonly number[],
  y: number,
  from: number,
  range: { from: number; to: number },
): number {
  let above = 0
  for (let index = range.from; index <= range.to; index++) {
    if (index !== from && mids[index] < y) above++
  }
  return range.from + above
}

export type ContentsCounts = {
  total: number
  /** Parts that print: locked ones and those whose state is an included choice. */
  printing: number
  leftOut: number
  locked: number
  unavailable: number
  /** Parts by state, for a list with more than two choices. Locked and unavailable parts are not counted here. */
  byState: Record<string, number>
}

export function contentsCounts(parts: readonly ContentsPart[], choices: readonly ContentsChoice[]): ContentsCounts {
  const byState: Record<string, number> = Object.fromEntries(choices.map((choice) => [choice.value, 0]))
  let printing = 0
  let locked = 0
  let unavailable = 0
  for (const part of parts) {
    if (partPrints(part, choices)) printing++
    if (part.locked) locked++
    else if (part.unavailable) unavailable++
    else byState[part.state] = (byState[part.state] ?? 0) + 1
  }
  return { total: parts.length, printing, leftOut: parts.length - printing, locked, unavailable, byState }
}

/** The count line: "Every part prints", "17 of 20 print" or "Nothing prints". A caller may pass its own instead. */
export function contentsSummary(counts: ContentsCounts): string {
  if (!counts.total || counts.printing === 0) return 'Nothing prints'
  if (counts.printing === counts.total) return 'Every part prints'
  return `${counts.printing} of ${counts.total} print`
}

/**
 * What a screen reader hears after a move: "Culvert schedule, moved from 4 to 2 of 18". `from` and
 * `to` are list indices (from 0); the sentence counts from 1.
 */
export function moveAnnouncement(label: string, from: number, to: number, total: number): string {
  return `${label}, moved from ${from + 1} to ${to + 1} of ${total}`
}

/**
 * A stored order applied to today's parts. Ids no longer present are dropped and returned as
 * `unknown` (never mapped to another part); a part the stored order does not name keeps its default
 * place, after the nearest earlier default neighbour that is placed, or first when it has none.
 */
export function orderedKeys(
  defaultKeys: readonly string[],
  storedOrder: readonly string[] | undefined,
): { keys: string[]; unknown: string[] } {
  if (!storedOrder) return { keys: [...defaultKeys], unknown: [] }
  const present = new Set(defaultKeys)
  const keys: string[] = []
  const unknown: string[] = []
  const placed = new Set<string>()
  for (const key of storedOrder) {
    if (!present.has(key)) {
      if (!unknown.includes(key)) unknown.push(key)
    } else if (!placed.has(key)) {
      keys.push(key)
      placed.add(key)
    }
  }
  defaultKeys.forEach((key, index) => {
    if (placed.has(key)) return
    let at = 0
    for (let before = index - 1; before >= 0; before--) {
      const neighbour = keys.indexOf(defaultKeys[before])
      if (neighbour >= 0) {
        at = neighbour + 1
        break
      }
    }
    keys.splice(at, 0, key)
    placed.add(key)
  })
  return { keys, unknown }
}
