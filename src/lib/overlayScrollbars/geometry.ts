/**
 * The arithmetic of an overlay scrollbar's thumb, apart from the DOM so it can be tested: how long the thumb is, how
 * far it travels, where it sits for a scroll offset, and the offset a drag of the thumb asks for.
 */

/** The thumb is never shorter than this, pixels, so a very long list still gives something to grab. */
export const MIN_THUMB_PX = 28
/** A scroller whose content is longer than its port by no more than this, pixels, does not scroll. */
export const SCROLL_SLACK_PX = 1

export interface ThumbGeometry {
  /** The thumb's length along the track. */
  size: number
  /** How far the thumb can move: the track's length less the thumb's. */
  travel: number
  /** The thumb's distance from the track's start. */
  position: number
  /** The scroll range it stands for: the content's length less the port's. */
  range: number
}

/**
 * The thumb for a scroller showing `port` pixels of `content`, scrolled to `offset`, on a track `track` pixels long
 * (the port's own length when not given). Null when the content fits.
 */
export function thumbGeometry(input: {
  port: number
  content: number
  offset: number
  track?: number
  min?: number
}): ThumbGeometry | null {
  const { port, content } = input
  const range = content - port
  if (!(port > 0) || !(range > SCROLL_SLACK_PX)) return null
  const track = Math.max(0, input.track ?? port)
  const size = Math.min(track, Math.max(input.min ?? MIN_THUMB_PX, (track * port) / content))
  const travel = track - size
  const share = Math.min(1, Math.max(0, input.offset / range))
  return { size, travel, position: share * travel, range }
}

/** The scroll offset after the thumb is dragged `delta` pixels from where the scroller stood at `from`. */
export function dragOffset(geometry: Pick<ThumbGeometry, 'travel' | 'range'>, from: number, delta: number): number {
  if (!(geometry.travel > 0)) return from
  return Math.min(geometry.range, Math.max(0, from + (delta / geometry.travel) * geometry.range))
}
