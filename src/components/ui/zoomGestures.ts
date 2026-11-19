/**
 * The zoom gestures every file viewer takes (`docs/shared-ui.md`, **File previews**), as PDF viewers take them rather
 * than maps: a trackpad pinch, and Ctrl or ⌘ with the wheel, zoom about the pointer; a plain wheel is left to scroll.
 *
 * A pinch reaches the page as a wheel with Ctrl held in Chrome, Edge and Firefox, and as Safari's own gesture events
 * (`gesturestart`, `gesturechange`, `gestureend`) in Safari. Both are taken here, so a viewer never handles one and
 * misses the other. Listeners go on with `passive: false`: React's wheel listener is passive, so its `preventDefault`
 * is ignored and the browser would zoom the whole page under the pinch.
 */

/** Where a zoom is centred, in the event's own client coordinates (a frame's own viewport for a frame's events). */
export type ZoomPoint = { clientX: number; clientY: number }

/** How far one wheel event may zoom: a mouse notch (about 100) is held to this, a pinch's small steps pass whole. */
const WHEEL_DELTA_LIMIT = 30
const WHEEL_ZOOM_RATE = 0.01

/** The zoom factor of a Ctrl or ⌘ wheel event: about 1.35 for a mouse notch, finer for a pinch's steps. */
export function wheelZoomFactor(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>): number {
  // A wheel that counts in lines or pages is a mouse's notch: treat it as one full notch.
  const delta = event.deltaMode === 0 ? event.deltaY : Math.sign(event.deltaY) * WHEEL_DELTA_LIMIT
  return Math.exp(-Math.max(-WHEEL_DELTA_LIMIT, Math.min(WHEEL_DELTA_LIMIT, delta)) * WHEEL_ZOOM_RATE)
}

/** A wheel event that asks for a zoom: a pinch (Ctrl, set by the browser) or Ctrl/⌘ held with the wheel. */
export const isZoomWheel = (event: Pick<WheelEvent, 'ctrlKey' | 'metaKey'>) => event.ctrlKey || event.metaKey

type GestureLike = Event & { scale?: number; clientX?: number; clientY?: number }

/**
 * Calls `onZoom` with a factor and the point to keep still for every pinch and Ctrl/⌘ wheel on `target`. `onWheel`,
 * when given, sees every other wheel first and returns true when it took it (a zoomed picture panning). Returns the
 * function that removes the listeners.
 */
export function listenZoomGestures(
  target: EventTarget,
  onZoom: (factor: number, at: ZoomPoint) => void,
  onWheel?: (event: WheelEvent) => boolean,
): () => void {
  const wheel = (event: Event) => {
    const w = event as WheelEvent
    if (isZoomWheel(w)) {
      event.preventDefault()
      onZoom(wheelZoomFactor(w), w)
      return
    }
    if (onWheel?.(w)) event.preventDefault()
  }
  // Safari's pinch: `scale` runs from 1 through the gesture, so each change is the ratio to the last.
  let last = 1
  const start = (event: Event) => {
    event.preventDefault()
    last = 1
  }
  const change = (event: Event) => {
    event.preventDefault()
    const gesture = event as GestureLike
    const scale = gesture.scale ?? 1
    if (!(scale > 0) || !(last > 0)) return
    onZoom(scale / last, { clientX: gesture.clientX ?? 0, clientY: gesture.clientY ?? 0 })
    last = scale
  }
  const end = (event: Event) => event.preventDefault()
  target.addEventListener('wheel', wheel, { passive: false })
  target.addEventListener('gesturestart', start, { passive: false })
  target.addEventListener('gesturechange', change, { passive: false })
  target.addEventListener('gestureend', end, { passive: false })
  return () => {
    target.removeEventListener('wheel', wheel)
    target.removeEventListener('gesturestart', start)
    target.removeEventListener('gesturechange', change)
    target.removeEventListener('gestureend', end)
  }
}

/** What a key asks of a viewer that has focus: `+`/`=` zooms in, `-` out, `0` fits. Null for anything else. */
export function zoomKey(event: Pick<KeyboardEvent, 'key' | 'altKey' | 'target'>): 'in' | 'out' | 'fit' | null {
  if (event.altKey) return null
  // Typing in a field inside the viewer is typing, not a zoom.
  const target = event.target as { isContentEditable?: boolean; tagName?: string } | null
  if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return null
  switch (event.key) {
    case '+':
    case '=':
      return 'in'
    case '-':
    case '_':
      return 'out'
    case '0':
      return 'fit'
    default:
      return null
  }
}
