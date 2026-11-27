/**
 * A map's tools in a strip along its top-left edge, as the road designer's plan draws them: groups of icon buttons
 * (`MapToolToggle`s) side by side, wrapping into another row when the map is narrow, with the right-hand column left
 * to the compass, zoom and Layers (`docs/shared-ui.md`, **Map overlays**). Render it in the positioned element that
 * holds the map, after the map. It publishes how far down it reaches as `--map-toolbar-bottom` on that element, so a
 * card placed top-left (`MapOverlay` with `BELOW_MAP_TOOLBAR`) starts under it however many rows it takes.
 *
 * On a phone a page keeps its tools in the folding stack (`MapControlOverflow`) instead: a strip that wraps would
 * cover the map a finger needs.
 */
import { useLayoutEffect, useState, type ReactNode } from 'react'
import { useElementSize } from '@/hooks/useElementSize'
import { cn } from '@/lib/utils'

/**
 * A top-left card's top when a `MapToolbar` may be over the map: under the strip, else where `MapOverlay`'s
 * `clearChrome` puts it (clear of a phone's floating toolbar). Pass it in the overlay's `className`.
 */
export const BELOW_MAP_TOOLBAR =
  'top-[max(0.75rem,calc(var(--map-mobile-toolbar-height,0px)_+_0.25rem),calc(var(--map-toolbar-bottom,0px)_+_0.5rem))]'

export function MapToolbar({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  const [element, setElement] = useState<HTMLDivElement | null>(null)
  const { height } = useElementSize(element)
  useLayoutEffect(() => {
    const host = element?.parentElement
    if (!element || !host) return
    host.style.setProperty('--map-toolbar-bottom', `${element.offsetTop + element.offsetHeight}px`)
    return () => {
      host.style.removeProperty('--map-toolbar-bottom')
    }
  }, [element, height])
  return (
    <div
      ref={setElement}
      role="group"
      aria-label={label}
      data-map-chrome=""
      className={cn(
        // Clear of the right-hand column (compass, zoom, Layers): 32 px squares and their margin.
        'pointer-events-none absolute left-2 top-2 z-10 flex max-w-[calc(100%-4rem)] flex-wrap items-start gap-1.5',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** One group of a `MapToolbar`'s tools: a gap sets it apart from the next. */
export function MapToolbarGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label} className="pointer-events-auto flex flex-wrap items-center gap-1">
      {children}
    </div>
  )
}
