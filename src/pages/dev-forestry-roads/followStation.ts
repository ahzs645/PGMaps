/**
 * When the plan pans to keep the selected station in view. The plan holds still while the station
 * stays inside a margin of the view, while the pointer is over the plan (the reader is working in
 * it, and a hover there moves the station), and for a moment after the reader pans or zooms it
 * themselves. Pans are throttled; the last request in a burst still lands. No DOM.
 */

/** The station may come this close to an edge, as a share of the view's width or height. */
export const FOLLOW_MARGIN_FRACTION = 0.15
/** …but never closer than this many pixels. */
export const FOLLOW_MIN_MARGIN_PX = 40
/** At most one pan in this many milliseconds. */
export const FOLLOW_THROTTLE_MS = 250
/** After the reader moves the plan, it is left where they put it for this long. */
export const FOLLOW_HOLD_AFTER_USER_MS = 1500
/** Length of each follow pan's animation. */
export const FOLLOW_PAN_MS = 300

/** Whether a screen point lies outside the view's inner box (or outside the view altogether). */
export function outsideFollowBox(
  point: { x: number; y: number },
  size: { width: number; height: number },
  marginFraction = FOLLOW_MARGIN_FRACTION,
): boolean {
  if (![point.x, point.y].every(Number.isFinite)) return true
  if (!(size.width > 0 && size.height > 0)) return false
  const mx = Math.min(size.width / 2, Math.max(FOLLOW_MIN_MARGIN_PX, size.width * marginFraction))
  const my = Math.min(size.height / 2, Math.max(FOLLOW_MIN_MARGIN_PX, size.height * marginFraction))
  return point.x < mx || point.x > size.width - mx || point.y < my || point.y > size.height - my
}

/**
 * How long to wait before a follow pan: 0 for now, a positive delay for a throttled or held pan,
 * or null when the plan should not follow at all (the reader is moving it, or pointing at it).
 */
export function followDelay(state: {
  now: number
  lastPanAt: number
  holdUntil: number
  userMoving: boolean
  pointerInPlan: boolean
}): number | null {
  if (state.userMoving || state.pointerInPlan) return null
  const ready = Math.max(state.lastPanAt + FOLLOW_THROTTLE_MS, state.holdUntil)
  return Math.max(0, ready - state.now)
}
