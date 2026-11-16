import { useEffect, type RefObject } from 'react'

/**
 * A vertical mouse wheel scrolls a horizontal strip sideways (`docs/shared-ui.md`, **Measured
 * sizes**): the navbar, section tabs and the Ribbon's tool strip. A trackpad's own sideways swipe
 * and Ctrl + wheel (pinch zoom) are left to the browser, and so is a wheel over a field in the
 * strip. At either end of the strip the wheel goes back to scrolling the page.
 */
export interface WheelStrip {
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
  /** Right-to-left strips count `scrollLeft` from 0 down to minus the overflow. */
  rtl?: boolean
}
export interface StripWheel {
  deltaX: number
  deltaY: number
  /** 0 pixels, 1 lines, 2 pages (`WheelEvent.deltaMode`). */
  deltaMode?: number
  ctrlKey?: boolean
}

const LINE_PX = 16

/** The strip's next `scrollLeft` for this wheel, or null when the wheel is not the strip's to take. */
export function horizontalWheelTarget(strip: WheelStrip, wheel: StripWheel): number | null {
  if (wheel.ctrlKey || Math.abs(wheel.deltaY) <= Math.abs(wheel.deltaX)) return null
  const overflow = strip.scrollWidth - strip.clientWidth
  if (overflow <= 1) return null
  const unit = wheel.deltaMode === 1 ? LINE_PX : wheel.deltaMode === 2 ? strip.clientWidth : 1
  const delta = wheel.deltaY * unit
  const [min, max] = strip.rtl ? [-overflow, 0] : [0, overflow]
  const next = Math.max(min, Math.min(max, strip.scrollLeft + (strip.rtl ? -delta : delta)))
  return Math.abs(next - strip.scrollLeft) < 0.5 ? null : next
}

const FIELD = 'input, textarea, select, [role="combobox"], [contenteditable="true"]'

/**
 * Lets a vertical wheel scroll `target` sideways. A native, non-passive listener: React attaches
 * `onWheel` passively, so a `preventDefault` there is ignored and the page scrolls with the strip.
 * `selector` names the scrolling element inside the target when the target is a frame around it.
 */
export function useHorizontalWheel(target: RefObject<HTMLElement | null>, selector?: string) {
  useEffect(() => {
    const frame = target.current
    const strip = selector ? frame?.querySelector<HTMLElement>(selector) : frame
    if (!strip) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element | null)?.closest(FIELD)) return
      const next = horizontalWheelTarget(
        {
          scrollLeft: strip.scrollLeft,
          scrollWidth: strip.scrollWidth,
          clientWidth: strip.clientWidth,
          rtl: getComputedStyle(strip).direction === 'rtl',
        },
        event,
      )
      if (next === null) return
      event.preventDefault()
      strip.scrollLeft = next
    }
    strip.addEventListener('wheel', wheel, { passive: false })
    return () => strip.removeEventListener('wheel', wheel)
  }, [target, selector])
}
