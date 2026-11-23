/**
 * Which of a map's stacked controls stay in the stack and which fold into its More menu, from the room the stack
 * has (`MapControlOverflow`). DOM-free: the component measures, this decides.
 */

export type FoldableControl = {
  id: string
  /** Higher stays in the stack longer. */
  priority: number
  /** A control that never folds (it opens a panel of its own, such as Layers). */
  pinned?: boolean
  /** Squares it takes in the stack: 2 for the zoom pair. */
  slots?: number
}

export type ControlFold = {
  /** The controls drawn in the stack, in their own order. */
  inline: string[]
  /** The controls in the More menu, in their own order; empty when everything fits. */
  folded: string[]
  /** How many control squares fit one above the other. */
  slotsPerColumn: number
  /** 1, or more when even the pinned controls and More do not fit in one column. */
  columns: number
}

/** How many squares of `size` fit in `room` with `gap` between them; never fewer than one. */
export function controlSlots(room: number, size: number, gap: number): number {
  if (!(size > 0) || !Number.isFinite(room)) return Number.isFinite(room) ? 1 : Number.MAX_SAFE_INTEGER
  return Math.max(1, Math.floor((room + gap) / (size + gap)))
}

/**
 * Folds the lowest-priority controls into the More menu until the rest and the More button fit `slotsPerColumn`.
 * Pinned controls and More always stay; when they alone do not fit, the stack takes more columns rather than hide
 * them. `maxColumns` bounds the room other controls may use; it never hides a pinned control.
 */
export function foldControls(
  controls: readonly FoldableControl[],
  slotsPerColumn: number,
  maxColumns = 2,
): ControlFold {
  const size = (control: FoldableControl) => Math.max(1, control.slots ?? 1)
  const ids = controls.map((control) => control.id)
  const total = controls.reduce((sum, control) => sum + size(control), 0)
  if (total <= slotsPerColumn) return { inline: ids, folded: [], slotsPerColumn, columns: 1 }
  const pinnedSlots = controls.filter((control) => control.pinned).reduce((sum, control) => sum + size(control), 0)
  const capacity = Math.max(slotsPerColumn, Math.min(maxColumns * slotsPerColumn, pinnedSlots + 1))
  let budget = capacity - pinnedSlots - 1
  const kept = new Set<string>()
  const byPriority = controls
    .map((control, index) => ({ control, index }))
    .filter(({ control }) => !control.pinned)
    .sort((a, b) => b.control.priority - a.control.priority || a.index - b.index)
  for (const { control } of byPriority) {
    if (size(control) > budget) continue
    kept.add(control.id)
    budget -= size(control)
  }
  const inline = controls.filter((control) => control.pinned || kept.has(control.id))
  const folded = controls.filter((control) => !control.pinned && !kept.has(control.id)).map((control) => control.id)
  const inlineSlots = inline.reduce((sum, control) => sum + size(control), 0)
  return {
    inline: inline.map((control) => control.id),
    folded,
    slotsPerColumn,
    columns: Math.max(1, Math.ceil((inlineSlots + 1) / slotsPerColumn)),
  }
}

/**
 * The slot count to use, held across a boundary by `hysteresis` px: a sheet dragged or a legend opened across the
 * line does not flip a control in and out every frame.
 */
export function steadySlots(room: number, size: number, gap: number, previous: number | null, hysteresis = 4): number {
  const next = controlSlots(room, size, gap)
  if (previous === null || next <= previous) return next
  // Growing: only once the room clears the larger count by the margin.
  return controlSlots(room - hysteresis, size, gap) > previous ? next : previous
}
