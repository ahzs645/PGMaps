export type MobileSheetState = 'collapsed' | 'half' | 'full'

export const DEFAULT_FULL_SNAP_OFFSET = 12
export const MOBILE_TOOLBAR_GAP = 8
export const MOBILE_COLLAPSED_VISIBLE_HEIGHT = 92

/** Snap positions as translateY pixel values. Lower value = more sheet visible. */
export function getSnapPositions(
  height: number,
  fullOffset = DEFAULT_FULL_SNAP_OFFSET,
  collapsedVisibleHeight = MOBILE_COLLAPSED_VISIBLE_HEIGHT,
) {
  const sheetHeight = Math.max(160, height)
  const collapsed = Math.max(72, sheetHeight - collapsedVisibleHeight)
  const full = Math.min(collapsed, Math.max(DEFAULT_FULL_SNAP_OFFSET, Math.round(fullOffset)))
  return { full, half: Math.max(full, Math.min(collapsed, Math.round(sheetHeight * 0.42))), collapsed }
}

/** Pick the best snap point, biased by swipe velocity. */
export function resolveSnap(
  y: number,
  velocityPxMs: number,
  height: number,
  fullOffset = DEFAULT_FULL_SNAP_OFFSET,
  collapsedVisibleHeight = MOBILE_COLLAPSED_VISIBLE_HEIGHT,
): MobileSheetState {
  const snaps = getSnapPositions(height, fullOffset, collapsedVisibleHeight)
  const projected = y + velocityPxMs * 200
  const entries: [MobileSheetState, number][] = [
    ['full', snaps.full],
    ['half', snaps.half],
    ['collapsed', snaps.collapsed],
  ]
  let best: MobileSheetState = 'half'
  let bestDist = Infinity
  for (const [state, sy] of entries) {
    const d = Math.abs(projected - sy)
    if (d < bestDist) {
      bestDist = d
      best = state
    }
  }
  return best
}

/** Derive the logical state from the current translateY. */
export function stateFromTranslate(
  y: number,
  height: number,
  fullOffset = DEFAULT_FULL_SNAP_OFFSET,
  collapsedVisibleHeight = MOBILE_COLLAPSED_VISIBLE_HEIGHT,
): MobileSheetState {
  const snaps = getSnapPositions(height, fullOffset, collapsedVisibleHeight)
  const entries: [MobileSheetState, number][] = [
    ['full', snaps.full],
    ['half', snaps.half],
    ['collapsed', snaps.collapsed],
  ]
  let best: MobileSheetState = 'collapsed'
  let bestDist = Infinity
  for (const [state, sy] of entries) {
    const d = Math.abs(y - sy)
    if (d < bestDist) {
      bestDist = d
      best = state
    }
  }
  return best
}

export const SPRING = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'
export const MOBILE_STACK_REAR_SHEET_VISIBLE_GAP = 6
export const MOBILE_FEATURE_CARD_FRONT_OFFSET = 8
