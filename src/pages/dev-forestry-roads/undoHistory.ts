/**
 * The workspace's undo history as a timeline of states, each step labelled by the edit that made
 * it, and named checkpoints the user can return to within the session. Generic over the state so
 * it can be tested without a project. No DOM or network access.
 *
 * `past` holds the states before each step, oldest first; `future` the states undone, the next redo
 * last. An entry's label belongs to the step from its state to the next one, so it moves with the
 * step between the two stacks. A step without a label of its own is named by comparing its two
 * states (`describeProjectChange`), when the list is shown.
 */

/** Steps kept; the oldest is dropped past this. */
export const MAX_UNDO_STEPS = 30
/** Edits closer together than this merge into one step (typing, a drag). */
export const UNDO_MERGE_MS = 450
/** Checkpoints kept in a session. */
export const MAX_CHECKPOINTS = 12
export const MAX_CHECKPOINT_NAME = 60

export interface HistoryEntry<T> {
  state: T
  /** What the step from this state did, when the edit said; otherwise worked out when shown. */
  label?: string
  /** When the step was made, ms since the epoch. */
  at: number
}

export interface History<T> {
  past: HistoryEntry<T>[]
  future: HistoryEntry<T>[]
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] })

/** The history after an edit away from `before`, which becomes the newest undo step. Clears redo. */
export function recordStep<T>(
  history: History<T>,
  before: T,
  label: string | undefined,
  at: number,
  max = MAX_UNDO_STEPS,
): History<T> {
  return { past: [...history.past, { state: before, label, at }].slice(-max), future: [] }
}

/** Undo or redo `count` steps from `current`: negative goes back, positive forward. Null when there are not that many. */
export function travel<T>(
  history: History<T>,
  current: T,
  count: number,
): { history: History<T>; state: T; label?: string } | null {
  if (!Number.isInteger(count) || count === 0) return null
  if (count < 0 ? -count > history.past.length : count > history.future.length) return null
  const past = [...history.past],
    future = [...history.future]
  let state = current,
    label: string | undefined
  for (let i = 0; i < Math.abs(count); i++) {
    if (count < 0) {
      const step = past.pop()!
      future.push({ state, label: step.label, at: step.at })
      state = step.state
      label = step.label
    } else {
      const step = future.pop()!
      past.push({ state, label: step.label, at: step.at })
      state = step.state
      label = step.label
    }
  }
  return { history: { past, future }, state, label }
}

export interface HistoryRow {
  /** Steps from the current state: −1 is one undo, +1 one redo, 0 is the current state. */
  offset: number
  /** The step that leads into this state, or "Opened" for the oldest state kept. */
  label: string
  at: number | null
}

/**
 * The states in time order, oldest first, each labelled by the step that produced it. Choosing a row
 * travels `offset` steps. `describe(before, after)` names a step that carries no label.
 */
export function historyRows<T>(
  history: History<T>,
  current: T,
  describe: (before: T, after: T) => string,
): HistoryRow[] {
  const states: T[] = [
    ...history.past.map((e) => e.state),
    current,
    ...[...history.future].reverse().map((e) => e.state),
  ]
  // Step i leads from states[i] to states[i + 1].
  const steps = [...history.past, ...[...history.future].reverse()]
  const n = history.past.length
  return states.map((_, index) => {
    if (index === 0) return { offset: -n, label: 'Earliest state kept', at: null }
    const step = steps[index - 1]
    return {
      offset: index - n,
      label: step.label ?? describe(states[index - 1], states[index]),
      at: step.at,
    }
  })
}

export interface Checkpoint<T> {
  id: string
  name: string
  state: T
  at: number
}

export function checkpointName(raw: string, existing: readonly Checkpoint<unknown>[]): string {
  const name = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_CHECKPOINT_NAME)
  return name || `Checkpoint ${existing.length + 1}`
}

/** The checkpoints with a new one, newest first; the oldest is dropped past `MAX_CHECKPOINTS`. */
export function addCheckpoint<T>(
  checkpoints: readonly Checkpoint<T>[],
  checkpoint: Checkpoint<T>,
  max = MAX_CHECKPOINTS,
): Checkpoint<T>[] {
  return [checkpoint, ...checkpoints].slice(0, max)
}

/**
 * A history label split for a narrow list: what changed first, and the road it changed on as a
 * second, quieter line. "Spur A: PVI 2 moved to 0+412.0" gives `{ change: 'PVI 2 moved to 0+412.0',
 * road: 'Spur A' }`. A label not about one road (`Deleted road Spur B`, `Terrain; 2 other changes`)
 * stays whole. The full label stays the row's name and tooltip.
 */
export function splitHistoryLabel(label: string): { change: string; road?: string } {
  const at = label.indexOf(': ')
  if (at <= 0 || label.slice(0, at).includes('; ')) return { change: label }
  const change = label.slice(at + 2)
  return change
    ? { change: change.charAt(0).toUpperCase() + change.slice(1), road: label.slice(0, at) }
    : { change: label }
}
