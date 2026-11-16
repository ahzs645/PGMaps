import { useLayoutEffect, useState, type RefObject } from 'react'

/**
 * Whether a horizontal strip has more to scroll to on either side, for its edge arrows or fades
 * (`docs/shared-ui.md`, **Measured sizes**). It follows scrolling, the strip's own size and each
 * child's (a label loading or a tool turning available), so an arrow never stays after the strip
 * fits or is missing once it overflows. `previous` and `next` follow the reading direction.
 *
 * `selector` names the scrolling element inside `container` when the container is the visible
 * frame around it (the Ribbon's tab list); without it, the container scrolls itself.
 */
export function useScrollEdges(container: RefObject<HTMLElement | null>, selector?: string) {
  const [edges, setEdges] = useState({ previous: false, next: false })
  useLayoutEffect(() => {
    const frame = container.current
    const viewport = selector ? frame?.querySelector<HTMLElement>(selector) : frame
    if (!frame || !viewport) return
    const measure = () => {
      const offset = Math.abs(viewport.scrollLeft)
      const overflows = viewport.scrollWidth > (frame.clientWidth || viewport.clientWidth) + 1
      const previous = overflows && offset > 1
      const next = overflows && viewport.scrollWidth - viewport.clientWidth - offset > 1
      setEdges((old) => (old.previous === previous && old.next === next ? old : { previous, next }))
    }
    if (typeof ResizeObserver === 'undefined') {
      measure()
      return
    }
    const resize = new ResizeObserver(measure)
    const observeWidths = () => {
      resize.disconnect()
      resize.observe(frame)
      if (viewport !== frame) resize.observe(viewport)
      for (const child of viewport.children) resize.observe(child)
      measure()
    }
    observeWidths()
    const changes = new MutationObserver(observeWidths)
    changes.observe(viewport, { childList: true })
    viewport.addEventListener('scroll', measure, { passive: true })
    return () => {
      resize.disconnect()
      changes.disconnect()
      viewport.removeEventListener('scroll', measure)
    }
  }, [container, selector])
  return edges
}
