/**
 * Keeps map markers on screen across a gap in the filtered set.
 *
 * Scrubbing the food-map timeline recomputes each restaurant's violation count
 * inside a rolling window, so a restaurant routinely drops out of the filtered
 * set for one month and comes straight back the next. Unmounting its marker on
 * the way out and remounting it on the way back is what reads as flashing.
 *
 * Folding the previous set into the next one keeps those markers painted, so the
 * caller can hold them at full opacity for a beat and only fade the ones that
 * stay gone.
 */

export type LingerPhase =
  /** In the current set: painted normally. */
  | 'present'
  /** Dropped out, still painted at full opacity, waiting to see if it comes back. */
  | 'held'
  /** Stayed gone past the hold window: fading out, no longer interactive. */
  | 'leaving'

export interface LingerEntry<T> {
  key: string
  item: T
  phase: LingerPhase
}

export interface LingerState<T> {
  /** Array identity this state was folded from, so callers can skip no-op work. */
  source: T[]
  /** Entries no longer in `source` but still on screen. */
  held: Map<string, LingerEntry<T>>
}

export function createLingerState<T>(source: T[]): LingerState<T> {
  return { source, held: new Map() }
}

/**
 * Folds `next` into `prev`. Anything that left the set since the last fold starts
 * holding; anything that came back stops. Entries already holding keep the phase
 * they had, so a pending fade is not restarted by an unrelated update.
 */
export function foldLingerState<T>(
  prev: LingerState<T>,
  next: T[],
  keyOf: (item: T) => string,
): LingerState<T> {
  const present = new Set<string>()
  next.forEach((item) => present.add(keyOf(item)))

  const held = new Map<string, LingerEntry<T>>()

  prev.held.forEach((entry, key) => {
    if (present.has(key)) return
    held.set(key, entry)
  })

  prev.source.forEach((item) => {
    const key = keyOf(item)
    if (present.has(key) || held.has(key)) return
    held.set(key, { key, item, phase: 'held' })
  })

  return { source: next, held }
}

/** Returns `prev` unchanged when the entry is missing or already in `phase`. */
export function setLingerPhase<T>(
  prev: LingerState<T>,
  key: string,
  phase: LingerPhase,
): LingerState<T> {
  const entry = prev.held.get(key)
  if (!entry || entry.phase === phase) return prev
  const held = new Map(prev.held)
  held.set(key, { ...entry, phase })
  return { source: prev.source, held }
}

/** Returns `prev` unchanged when there is nothing to drop. */
export function dropLingering<T>(prev: LingerState<T>, key: string): LingerState<T> {
  if (!prev.held.has(key)) return prev
  const held = new Map(prev.held)
  held.delete(key)
  return { source: prev.source, held }
}

/** Current set first, then whatever is still lingering behind it. */
export function toLingerList<T>(state: LingerState<T>, keyOf: (item: T) => string): LingerEntry<T>[] {
  const entries: LingerEntry<T>[] = state.source.map((item) => ({
    key: keyOf(item),
    item,
    phase: 'present' as const,
  }))
  state.held.forEach((entry) => entries.push(entry))
  return entries
}
