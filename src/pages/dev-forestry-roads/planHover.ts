/**
 * Which station a hover over the plan selects. The road is a thin line, so the pointer only has to
 * come near it: within `HOVER_CAPTURE_PX` the station starts following the pointer, and it keeps
 * following until the pointer is more than `HOVER_RELEASE_PX` away (hysteresis, so a hand that
 * wanders a little off the line is not dropped). Farther away the station stays where it was.
 * A quick swipe across the road selects the station where the pointer's path crossed it, even when
 * no mousemove landed near the line. Works in screen pixels, so the feel is the same at any zoom.
 * No DOM.
 */

/** Distance at which a hover picks up the road, in screen pixels. */
export const HOVER_CAPTURE_PX = 16
/** Distance at which a hover that is following the road lets go of it, in screen pixels. */
export const HOVER_RELEASE_PX = 48

export interface ScreenPoint {
  x: number
  y: number
}

/** A calculated station projected to the screen. */
export interface ScreenStation extends ScreenPoint {
  chainage: number
}

export interface PlanHover {
  /** Whether the hover is following the road (drives the cursor and the release distance). */
  engaged: boolean
  /** The station to select, or null to leave the selected station alone. */
  chainage: number | null
}

const finite = (p: ScreenPoint) => Number.isFinite(p.x) && Number.isFinite(p.y)

/** The calculated station nearer to the point's foot on the nearest segment, and its distance. */
export function nearestScreenStation(
  stations: readonly ScreenStation[],
  pointer: ScreenPoint,
): { chainage: number; distancePx: number } | null {
  let best: { chainage: number; distancePx: number } | null = null
  const consider = (chainage: number, distancePx: number) => {
    if (!best || distancePx < best.distancePx) best = { chainage, distancePx }
  }
  for (let i = 0; i < stations.length; i++) {
    const a = stations[i]
    if (!finite(a)) continue
    const b = stations[i + 1]
    if (!b || !finite(b)) {
      consider(a.chainage, Math.hypot(pointer.x - a.x, pointer.y - a.y))
      continue
    }
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((pointer.x - a.x) * dx + (pointer.y - a.y) * dy) / lengthSq)) : 0
    consider(t < 0.5 ? a.chainage : b.chainage, Math.hypot(pointer.x - (a.x + t * dx), pointer.y - (a.y + t * dy)))
  }
  return best
}

/**
 * Where the pointer's path from `from` to `to` last crossed the road, as the calculated station
 * nearer the crossing, or null when it did not cross.
 */
export function crossedStation(stations: readonly ScreenStation[], from: ScreenPoint, to: ScreenPoint): number | null {
  const rx = to.x - from.x
  const ry = to.y - from.y
  if (rx === 0 && ry === 0) return null
  let last: { along: number; chainage: number } | null = null
  for (let i = 0; i + 1 < stations.length; i++) {
    const a = stations[i]
    const b = stations[i + 1]
    if (!finite(a) || !finite(b)) continue
    const sx = b.x - a.x
    const sy = b.y - a.y
    const denominator = rx * sy - ry * sx
    if (denominator === 0) continue
    const qx = a.x - from.x
    const qy = a.y - from.y
    const along = (qx * sy - qy * sx) / denominator
    const onSegment = (qx * ry - qy * rx) / denominator
    if (along < 0 || along > 1 || onSegment < 0 || onSegment > 1) continue
    if (!last || along > last.along) last = { along, chainage: onSegment < 0.5 ? a.chainage : b.chainage }
  }
  return last?.chainage ?? null
}

/**
 * The hover's next state. `previous` is the last pointer position over the plan (null when the
 * pointer has just entered it), `engaged` whether the hover was following the road.
 */
export function planHover(
  stations: readonly ScreenStation[],
  pointer: ScreenPoint,
  previous: ScreenPoint | null,
  engaged: boolean,
): PlanHover {
  if (!finite(pointer)) return { engaged: false, chainage: null }
  const nearest = nearestScreenStation(stations, pointer)
  if (nearest && nearest.distancePx <= (engaged ? HOVER_RELEASE_PX : HOVER_CAPTURE_PX))
    return { engaged: true, chainage: nearest.chainage }
  // A swipe across the road: the path crossed it between two moves without landing near it.
  const crossed = previous && finite(previous) ? crossedStation(stations, previous, pointer) : null
  if (crossed !== null) return { engaged: (nearest?.distancePx ?? Infinity) <= HOVER_RELEASE_PX, chainage: crossed }
  return { engaged: false, chainage: null }
}
