import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useProjected } from './movable-content'

/** The scroller a `VirtualResultList` and a `StickyListToolbar` read their scroll position from. */
export const SIDEBAR_SCROLL_SELECTOR = '[data-map-sidebar-scroll="true"]'

/**
 * Whether content at `element` has to scroll by itself: nothing around it is a sidebar scroller. Read from the
 * element's parent, so a fallback scroller that carries the attribute itself does not count.
 */
export function needsOwnScroller(element: { parentElement: { closest(selector: string): unknown } | null } | null) {
  return !!element && !element.parentElement?.closest(SIDEBAR_SCROLL_SELECTOR)
}

/**
 * Wraps a `VirtualResultList` (or anything else that scrolls by the sidebar's scroller) that may be shown away from a
 * sidebar: a `Projectable` piece moved into a dialog's `ProjectionSlot`, where no `data-map-sidebar-scroll` ancestor
 * exists and the list would measure no height and draw no row. Inside a sidebar it adds nothing; elsewhere it is a
 * bounded scroller of its own carrying the attribute. The list is mounted again when the scroller changes, because a
 * virtualizer keeps the scroll element it first found.
 */
export function SidebarScrollFallback({ className, children }: { className?: string; children: ReactNode }) {
  const projected = useProjected()
  const ref = useRef<HTMLDivElement>(null)
  const [own, setOwn] = useState(false)
  // A passive effect: a `Projectable`'s DOM moves in a layout effect of its own, after this piece's layout effects.
  useEffect(() => setOwn(needsOwnScroller(ref.current)), [projected])
  return (
    <div
      ref={ref}
      data-map-sidebar-scroll={own ? 'true' : undefined}
      className={own ? cn('max-h-96 overflow-y-auto overscroll-contain', className) : undefined}
    >
      <Fragment key={own ? 'own' : 'sidebar'}>{children}</Fragment>
    </div>
  )
}
