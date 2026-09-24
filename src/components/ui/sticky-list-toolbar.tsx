import {
  forwardRef,
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react'
import { ChevronDown, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const SCROLL_SELECTOR = '[data-map-sidebar-scroll="true"]'

/** Offset of `element` from the top of its scroll container's content. */
function contentOffset(element: HTMLElement, scroller: HTMLElement): number {
  return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
}

/**
 * A toolbar that sticks to the top of the sidebar scroll port hides whatever
 * sits at its resting place once the list has scrolled: a filter panel just
 * opened, a detail card just inserted. Scroll that target back into view,
 * just under the toolbar. No-op when the target is already visible or hidden
 * (e.g. a desktop-only card on a phone).
 */
export function revealBelowSticky(toolbar: HTMLElement | null, target: HTMLElement | null): void {
  const scroller = toolbar?.closest<HTMLElement>(SCROLL_SELECTOR)
  if (!toolbar || !scroller || !target || !target.offsetParent) return
  const toolbarHeight = toolbar.offsetHeight
  const targetTop = target.getBoundingClientRect().top
  const scrollerRect = scroller.getBoundingClientRect()
  const hiddenAbove = targetTop < scrollerRect.top + toolbarHeight
  const hiddenBelow = targetTop > scrollerRect.bottom - 96
  if (!hiddenAbove && !hiddenBelow) return
  // Instant, not smooth: the jump is often thousands of pixels, and a smooth
  // scroll that long loses out to the browser's scroll anchoring as the
  // inserted panel shifts the list.
  scroller.scrollTo({ top: contentOffset(target, scroller) - toolbarHeight })
}

/**
 * State for a sticky list toolbar with a collapsible filter panel. Opening the
 * panel while the list is scrolled brings it into view. Layout effects rather
 * than requestAnimationFrame: they run once the panel is in the DOM and
 * before paint, so the jump is never visible.
 */
export function useStickyListToolbar() {
  const toolbarRef = useRef<HTMLDivElement>(null)
  const filtersPanelId = useId()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const toggleFilters = useCallback(() => setFiltersOpen((current) => !current), [])

  useLayoutEffect(() => {
    if (filtersOpen) revealBelowSticky(toolbarRef.current, document.getElementById(filtersPanelId))
  }, [filtersOpen, filtersPanelId])

  return { toolbarRef, filtersPanelId, filtersOpen, setFiltersOpen, toggleFilters }
}

/**
 * Scroll `targetRef` into view below the toolbar whenever `key` changes to a
 * truthy value, e.g. the id of a newly selected row whose detail card is
 * inserted above the list.
 */
export function useRevealBelowSticky(
  toolbarRef: RefObject<HTMLElement | null>,
  targetRef: RefObject<HTMLElement | null>,
  key: string | number | null | undefined,
): void {
  useLayoutEffect(() => {
    if (key) revealBelowSticky(toolbarRef.current, targetRef.current)
  }, [key, toolbarRef, targetRef])
}

type FilterToggleButtonProps = {
  open: boolean
  onToggle: () => void
  panelId: string
  /** Number of filter groups narrowed from "everything"; shown as a badge. */
  activeCount?: number
  label?: string
}

/** "Filters" button with an active-count badge and a chevron. */
export function FilterToggleButton({ open, onToggle, panelId, activeCount = 0, label = 'Filters' }: FilterToggleButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={activeCount > 0 ? `${label}, ${activeCount} active` : label}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors touch:h-10',
        activeCount > 0
          ? 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-200'
          : 'border-input text-foreground hover:bg-accent',
      )}
    >
      {label}
      {activeCount > 0 && <span className="rounded-full bg-sky-600 px-1.5 text-[10px] leading-4 text-white">{activeCount}</span>}
      <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} aria-hidden="true" />
    </button>
  )
}

/** "Reset" button for the toolbar row. */
export function ResetFiltersButton({ onClick, label = 'Reset' }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground touch:h-10"
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  )
}

type StickyListToolbarProps = {
  /** Usually a `SearchInput`. */
  search?: ReactNode
  /** Left side of the control row: a `FilterToggleButton`, a `ResetFiltersButton`. */
  controls?: ReactNode
  /** Right side of the control row, usually a sort `AppSelect`. */
  sort?: ReactNode
  /** Result count line under the controls. */
  count?: ReactNode
  className?: string
}

/**
 * Search, filters and sort pinned to the top of a sidebar's scroll port so
 * they stay reachable while a long list scrolls. Put the filter panel (with
 * `id={filtersPanelId}`) right after it, then any selected-item card, then
 * the list.
 */
export const StickyListToolbar = forwardRef<HTMLDivElement, StickyListToolbarProps>(function StickyListToolbar(
  { search, controls, sort, count, className },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn('sticky top-0 z-20 space-y-2 border-b border-border bg-background/95 px-3 pb-2 pt-3 backdrop-blur', className)}
    >
      {search}
      {(controls || sort) && (
        <div className="flex items-center gap-1.5">
          {controls}
          {sort && <div className="ml-auto">{sort}</div>}
        </div>
      )}
      {count && (
        <div className="text-xs text-muted-foreground" aria-live="polite">
          {count}
        </div>
      )}
    </div>
  )
})
