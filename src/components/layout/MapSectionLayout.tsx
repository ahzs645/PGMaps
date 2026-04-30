import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type MobileSheetState = 'collapsed' | 'half' | 'full'

interface MapSectionLayoutProps {
  sidebar: ReactNode
  showDesktopSidebar: boolean
  onToggleDesktopSidebar: () => void
  desktopSidebarWidth?: number
  rightSidebar?: ReactNode
  showDesktopRightSidebar?: boolean
  onToggleDesktopRightSidebar?: () => void
  desktopRightSidebarWidth?: number
  children: ReactNode
  className?: string
}

// ---------------------------------------------------------------------------
// Snap helpers
// ---------------------------------------------------------------------------

/** Snap positions as translateY pixel values. Lower value = more sheet visible. */
function getSnapPositions() {
  const vh = window.innerHeight
  return {
    full: 16,
    half: Math.round(vh * 0.42),
    collapsed: vh - 192,
  }
}

/** Pick the best snap point, biased by swipe velocity. */
function resolveSnap(y: number, velocityPxMs: number): MobileSheetState {
  const snaps = getSnapPositions()
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
function stateFromTranslate(y: number): MobileSheetState {
  const snaps = getSnapPositions()
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

const SPRING = 'transform 0.35s cubic-bezier(0.32, 0.72, 0, 1)'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MapSectionLayout({
  sidebar,
  showDesktopSidebar,
  onToggleDesktopSidebar,
  desktopSidebarWidth = 350,
  rightSidebar,
  showDesktopRightSidebar = true,
  onToggleDesktopRightSidebar,
  desktopRightSidebarWidth = 360,
  children,
  className,
}: MapSectionLayoutProps) {
  const [mobileSheetState, setMobileSheetState] = useState<MobileSheetState>('collapsed')

  // DOM refs
  const sheetRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)

  // Drag bookkeeping (refs for zero re-renders during drag)
  const dragging = useRef(false)
  const startY = useRef(0)
  const startX = useRef(0)
  const startTranslate = useRef(0)
  const curY = useRef(0)
  const prevTouchY = useRef(0)
  const prevTouchTime = useRef(0)
  const vel = useRef(0)
  const fromHandle = useRef(false)
  const decided = useRef(false)

  // ------ helpers ----------------------------------------------------------

  const applyTransform = useCallback((y: number, animate: boolean) => {
    const sheet = sheetRef.current
    if (!sheet) return
    sheet.style.transition = animate ? SPRING : 'none'
    sheet.style.transform = `translateY(${y}px)`
    curY.current = y

    // Scrim opacity (0 at collapsed → 0.4 at full)
    const snaps = getSnapPositions()
    const range = snaps.collapsed - snaps.full
    const t = Math.max(0, Math.min(1, 1 - (y - snaps.full) / range))
    if (scrimRef.current) {
      scrimRef.current.style.opacity = String(t * 0.4)
      scrimRef.current.style.pointerEvents = t > 0.05 ? 'auto' : 'none'
      scrimRef.current.style.transition = animate ? 'opacity 0.35s ease' : 'none'
    }
  }, [])

  const snapTo = useCallback(
    (state: MobileSheetState) => {
      setMobileSheetState(state)
      applyTransform(getSnapPositions()[state], true)
    },
    [applyTransform],
  )

  // ------ lifecycle --------------------------------------------------------

  // Position on first paint (before browser paints → no flash)
  useLayoutEffect(() => {
    if (window.innerWidth < 768) {
      const y = getSnapPositions().collapsed
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${y}px)`
        sheetRef.current.style.transition = 'none'
      }
      curY.current = y
      if (scrimRef.current) {
        scrimRef.current.style.opacity = '0'
        scrimRef.current.style.pointerEvents = 'none'
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Handle viewport resize & orientation change
  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 768) {
        // Desktop — clear mobile transforms
        if (sheetRef.current) {
          sheetRef.current.style.transform = ''
          sheetRef.current.style.transition = ''
        }
        if (scrimRef.current) {
          scrimRef.current.style.opacity = '0'
          scrimRef.current.style.pointerEvents = 'none'
        }
      } else if (!dragging.current) {
        const state = stateFromTranslate(curY.current)
        applyTransform(getSnapPositions()[state], false)
      }
    }
    const onOrientationChange = () => setTimeout(onResize, 150)

    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientationChange)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientationChange)
    }
  }, [applyTransform])

  // ------ touch events (non-passive, native) --------------------------------

  useEffect(() => {
    const sheet = sheetRef.current
    const handle = handleRef.current
    if (!sheet || !handle) return

    /** Walk up from target to find the first scrollable ancestor inside sheet. */
    function findScrollable(el: HTMLElement | null): HTMLElement | null {
      while (el && el !== sheet) {
        if (el.scrollHeight > el.clientHeight + 1) {
          const ov = getComputedStyle(el).overflowY
          if (ov === 'auto' || ov === 'scroll') return el
        }
        el = el.parentElement
      }
      return null
    }

    function onTouchStart(e: TouchEvent) {
      if (window.innerWidth >= 768) return
      const t = e.touches[0]
      const isHandle = handle!.contains(e.target as Node)

      startY.current = t.clientY
      startX.current = t.clientX
      startTranslate.current = curY.current
      prevTouchY.current = t.clientY
      prevTouchTime.current = performance.now()
      vel.current = 0
      fromHandle.current = isHandle
      decided.current = false

      if (isHandle) {
        dragging.current = true
        decided.current = true
        sheet!.style.transition = 'none'
        sheet!.style.willChange = 'transform'
        e.preventDefault()
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (window.innerWidth >= 768) return
      const t = e.touches[0]
      const now = performance.now()
      const dt = now - prevTouchTime.current
      if (dt > 0) vel.current = (t.clientY - prevTouchY.current) / dt
      prevTouchY.current = t.clientY
      prevTouchTime.current = now

      // Already dragging — update position
      if (dragging.current) {
        e.preventDefault()
        const delta = t.clientY - startY.current
        let ny = startTranslate.current + delta
        const snaps = getSnapPositions()
        // Rubber-band at edges
        if (ny < snaps.full) ny = snaps.full - (snaps.full - ny) * 0.25
        if (ny > snaps.collapsed) ny = snaps.collapsed + (ny - snaps.collapsed) * 0.25
        applyTransform(ny, false)
        return
      }

      // Direction decision for content touches
      if (!decided.current) {
        const dx = Math.abs(t.clientX - startX.current)
        const dy = Math.abs(t.clientY - startY.current)
        if (dx + dy < 10) return // too small to decide

        decided.current = true
        if (dx > dy) return // horizontal — let browser handle

        const state = stateFromTranslate(curY.current)
        const goingDown = t.clientY > startY.current

        if (state !== 'full') {
          // Sheet not fully open — vertical always drags
          dragging.current = true
          startY.current = t.clientY
          startTranslate.current = curY.current
          sheet!.style.transition = 'none'
          sheet!.style.willChange = 'transform'
          e.preventDefault()
          return
        }

        // Full state: only drag if pulling down from scroll-top
        if (goingDown) {
          const sc = findScrollable(e.target as HTMLElement)
          if (!sc || sc.scrollTop <= 0) {
            dragging.current = true
            startY.current = t.clientY
            startTranslate.current = curY.current
            sheet!.style.transition = 'none'
            sheet!.style.willChange = 'transform'
            e.preventDefault()
          }
        }
        // else: let content scroll naturally
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (window.innerWidth >= 768) return
      sheet!.style.willChange = ''

      if (!dragging.current) return
      dragging.current = false

      // Tap on handle (< 10 px total movement) → cycle state
      if (fromHandle.current && e.changedTouches.length > 0) {
        const ct = e.changedTouches[0]
        const moved = Math.abs(ct.clientY - startY.current) + Math.abs(ct.clientX - startX.current)
        if (moved < 10) {
          const s = stateFromTranslate(curY.current)
          snapTo(s === 'collapsed' ? 'half' : s === 'half' ? 'full' : 'collapsed')
          return
        }
      }

      snapTo(resolveSnap(curY.current, vel.current))
    }

    sheet.addEventListener('touchstart', onTouchStart, { passive: false })
    sheet.addEventListener('touchmove', onTouchMove, { passive: false })
    sheet.addEventListener('touchend', onTouchEnd)
    sheet.addEventListener('touchcancel', onTouchEnd)

    return () => {
      sheet.removeEventListener('touchstart', onTouchStart)
      sheet.removeEventListener('touchmove', onTouchMove)
      sheet.removeEventListener('touchend', onTouchEnd)
      sheet.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [applyTransform, snapTo])

  // Scrim tap → collapse
  const handleScrimClick = useCallback(() => snapTo('collapsed'), [snapTo])

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={cn('relative flex h-full w-full bg-slate-100 dark:bg-slate-950', className)}>
      {/* Sidebar wrapper */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 z-30 md:pointer-events-auto md:relative md:inset-auto md:z-10 md:h-full md:shrink-0',
          showDesktopSidebar ? 'md:block md:w-[var(--desktop-sidebar-width)]' : 'md:hidden',
        )}
        style={{ '--desktop-sidebar-width': `${desktopSidebarWidth}px` } as CSSProperties}
      >
        {/* Scrim / backdrop */}
        <div
          ref={scrimRef}
          className="absolute inset-0 bg-black md:hidden"
          style={{ opacity: 0, pointerEvents: 'none' }}
          onClick={handleScrimClick}
          aria-hidden="true"
        />

        {/* Bottom sheet */}
        <div
          ref={sheetRef}
          className={cn(
            'pointer-events-auto absolute inset-x-0 bottom-0 flex h-full max-h-full flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-background/95 shadow-2xl backdrop-blur',
            'md:relative md:inset-auto md:h-full md:rounded-none md:border-0 md:bg-transparent md:shadow-none md:backdrop-blur-none',
          )}
        >
          {/* Drag handle */}
          <div
            ref={handleRef}
            className="flex shrink-0 cursor-grab touch-none items-center justify-center py-3 select-none active:cursor-grabbing md:hidden"
            role="separator"
            aria-label="Drag to resize sheet"
          >
            <div className="h-1 w-10 rounded-full bg-muted-foreground/40" />
          </div>

          {/* Sidebar content */}
          <div
            ref={contentRef}
            className={cn(
              'min-h-0 flex-1 overscroll-y-contain md:h-full md:!touch-auto',
              mobileSheetState === 'full' ? 'touch-auto' : 'touch-none',
            )}
          >
            {sidebar}
          </div>
        </div>
      </div>

      {/* Desktop left-sidebar toggle */}
      <button
        type="button"
        onClick={onToggleDesktopSidebar}
        aria-label={showDesktopSidebar ? 'Hide sidebar' : 'Show sidebar'}
        style={{ left: showDesktopSidebar ? desktopSidebarWidth : 0 }}
        className="absolute top-6 z-20 hidden h-10 w-8 items-center justify-center rounded-r-lg border border-l-0 border-slate-300/80 bg-slate-50/95 text-slate-600 shadow-md backdrop-blur transition-[left,background-color,color,border-color] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800 md:flex"
      >
        {showDesktopSidebar ? (
          <ChevronsLeft className="h-4 w-4" />
        ) : (
          <ChevronsRight className="h-4 w-4" />
        )}
      </button>

      {/* Map content */}
      <div className="relative flex-1">{children}</div>

      {/* Right sidebar (desktop only) */}
      {rightSidebar && (
        <>
          <div
            className={cn(
              'hidden md:block md:relative md:h-full md:shrink-0',
              showDesktopRightSidebar ? 'md:w-[var(--desktop-right-sidebar-width)]' : 'md:w-0',
            )}
            style={{ '--desktop-right-sidebar-width': `${desktopRightSidebarWidth}px` } as CSSProperties}
          >
            <div
              className={cn(
                'absolute inset-y-0 right-0 h-full overflow-hidden transition-[width] duration-200',
                showDesktopRightSidebar ? 'w-[var(--desktop-right-sidebar-width)]' : 'w-0',
              )}
              style={{ '--desktop-right-sidebar-width': `${desktopRightSidebarWidth}px` } as CSSProperties}
            >
              <div
                className="h-full"
                style={{ width: `${desktopRightSidebarWidth}px` }}
              >
                {rightSidebar}
              </div>
            </div>
          </div>

          {onToggleDesktopRightSidebar && (
            <button
              type="button"
              onClick={onToggleDesktopRightSidebar}
              aria-label={showDesktopRightSidebar ? 'Hide right sidebar' : 'Show right sidebar'}
              style={{ right: showDesktopRightSidebar ? desktopRightSidebarWidth : 0 }}
              className="absolute top-6 z-20 hidden h-10 w-8 items-center justify-center rounded-l-lg border border-r-0 border-slate-300/80 bg-slate-50/95 text-slate-600 shadow-md backdrop-blur transition-[right,background-color,color,border-color] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800 md:flex"
            >
              {showDesktopRightSidebar ? (
                <ChevronsRight className="h-4 w-4" />
              ) : (
                <ChevronsLeft className="h-4 w-4" />
              )}
            </button>
          )}
        </>
      )}
    </div>
  )
}
