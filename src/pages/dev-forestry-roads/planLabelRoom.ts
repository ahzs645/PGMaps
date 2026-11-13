/**
 * Which plan labels have room to print in full at the current view.
 *
 * Culvert labels are HTML markers of a fixed size, so at network zoom a road's 20–30 culverts stacked
 * into an unreadable pile on screen and in the map PDF. A label that would overlap one already placed
 * shows only its compact mark; zooming in gives the others room again. Placement is greedy by
 * priority, then input order (up-station), so the selected and flagged structures win. Fixed boxes
 * (station and curve labels, and every culvert's always-drawn Ø mark) are placed first and never fold.
 *
 * Positions are screen pixels; overlap does not change with panning, so a caller recomputes only when
 * the zoom, bearing or labels change. Free of DOM access.
 */
export interface LabelBox {
  id: string
  /** Box centre in screen pixels. */
  x: number
  y: number
  width: number
  height: number
  /** Higher places first. */
  priority: number
  /** Always placed, before any other box: another label that must stay readable (a station, a curve). */
  fixed?: boolean
  /** Boxes with the same owner never block each other: a culvert's full label may cover its own Ø mark. */
  owner?: string
}

/** Space kept between two printed labels, in pixels. */
export const LABEL_GAP_PX = 3

/** Approximate width of a plan label of the given text in the 3xs marker type, padding included. */
export function planLabelWidthPx(text: string): number {
  return Math.ceil(text.length * 5.4 + 10)
}

/** Height of a one-line plan label marker, in pixels. */
export const PLAN_LABEL_HEIGHT_PX = 17

export function labelsWithRoom(boxes: readonly LabelBox[], gap = LABEL_GAP_PX): Set<string> {
  const order = boxes
    .map((box, index) => ({ box, index }))
    .sort(
      (a, b) => Number(!!b.box.fixed) - Number(!!a.box.fixed) || b.box.priority - a.box.priority || a.index - b.index,
    )
  const placed: LabelBox[] = []
  const room = new Set<string>()
  for (const { box } of order) {
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) continue
    const clear = placed.every(
      (other) =>
        (box.owner !== undefined && box.owner === other.owner) ||
        Math.abs(box.x - other.x) * 2 >= box.width + other.width + 2 * gap ||
        Math.abs(box.y - other.y) * 2 >= box.height + other.height + 2 * gap,
    )
    if (!clear && !box.fixed) continue
    placed.push(box)
    room.add(box.id)
  }
  return room
}
