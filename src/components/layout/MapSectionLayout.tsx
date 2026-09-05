import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  MOBILE_FEATURE_CARD_COMPACT_HEIGHT,
  MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT,
  MOBILE_FEATURE_CARD_COLLAPSE_STATE_EVENT,
  MOBILE_FEATURE_CARD_DOCK_EVENT,
  MOBILE_FEATURE_CARD_FRONT_EVENT,
  MOBILE_FEATURE_CARD_CLOSE_EVENT,
  MOBILE_FEATURE_CARD_OPEN_EVENT,
  MOBILE_FEATURE_CARD_PEEK_EVENT,
  MOBILE_MAP_CONTROLS_FRONT_EVENT,
  MOBILE_MAP_CONTROLS_VISIBLE_HEIGHT_EVENT,
  MOBILE_MAP_INTERACTION_EVENT,
  MOBILE_MAP_SHEET_COLLAPSE_EVENT,
  MOBILE_MAP_SHEET_STACK_EVENT,
} from '@/components/ui/mobile-feature-card'
import { MAP_OVERLAY_ROOT_STYLE } from '@/components/ui/map-overlay'
import { isMobileViewport } from '@/hooks/useIsMobile'
import { MAP_SEARCH_REQUEST } from '@/lib/mapSearch'

type MobileSheetState = 'collapsed' | 'half' | 'full'

/**
 * Classes a section's sidebar element needs to sit correctly inside this
 * layout: full-bleed in the mobile sheet, bordered and raised on desktop.
 * Pass it as the sidebar's own `className` — it cannot live on a wrapper
 * because sidebars merge it into their root element.
 */
export const MAP_SIDEBAR_CLASS = 'h-full w-full border-0 shadow-none md:border-r md:shadow-xl'

interface MapSectionLayoutProps {
  sidebar: ReactNode
  /**
   * Omit both this and `onToggleDesktopSidebar` to let the layout own the
   * open/closed state (starting open) — most sections have no reason to.
   * Pass both to control it, e.g. to collapse the sidebar from elsewhere.
   */
  showDesktopSidebar?: boolean
  onToggleDesktopSidebar?: () => void
  desktopSidebarWidth?: number
  mobileInitialSheetState?: MobileSheetState
  /** Full control over the collapsed-sheet peek. Prefer the title/subtitle props below. */
  mobilePeek?: ReactNode
  /** Renders the standard two-line peek. Ignored when `mobilePeek` is set. */
  mobilePeekTitle?: ReactNode
  mobilePeekSubtitle?: ReactNode
  selectedFeatureMobilePeek?: {
    title?: string
    subtitle?: string
  }
  showMobilePeek?: boolean
  /** Hides the collapsed-sheet chevron toggle; the drag handle still resizes. */
  showMobileSheetChevron?: boolean
  mobileSidebar?: ReactNode
  mobileSnapTo?: MobileSheetState
  mobileSnapVisibleHeight?: number
  mobileSnapFromVisibleHeight?: number
  mobileSnapKey?: string | number
  mobileSheetInteractive?: boolean
  mobileScrimEnabled?: boolean
  mobileSheetContentClassName?: string
  mobileCollapsedVisibleHeight?: number
  onMobileSheetStateChange?: (state: MobileSheetState) => void
  /** When set, renders a drag handle on the sidebar's inner edge for resizing. */
  onDesktopSidebarWidthChange?: (width: number) => void
  rightSidebar?: ReactNode
  showDesktopRightSidebar?: boolean
  onToggleDesktopRightSidebar?: () => void
  desktopRightSidebarWidth?: number
  /** When set, renders a drag handle on the right sidebar's inner edge for resizing. */
  onDesktopRightSidebarWidthChange?: (width: number) => void
  suppressMobileSheet?: boolean
  /** Hides the left sidebar entirely (and its toggle / mobile bottom sheet). */
  disableSidebar?: boolean
  /**
   * Docked pane rendered across the full width below the map *and* the sidebars,
   * taking real layout height so everything above it is shortened rather than
   * overlaid. Used for the Felt-style data table.
   */
  bottomPane?: ReactNode
  /**
   * Height of `bottomPane` in px, reserved above the layout row on desktop.
   * Must be px, not a percentage — percentage padding resolves against width.
   */
  bottomPaneHeight?: number
  children: ReactNode
  className?: string
}

// ---------------------------------------------------------------------------
// Snap helpers
// ---------------------------------------------------------------------------

const DEFAULT_FULL_SNAP_OFFSET = 12
const MOBILE_TOOLBAR_GAP = 8
const MOBILE_COLLAPSED_VISIBLE_HEIGHT = 92

/** Snap positions as translateY pixel values. Lower value = more sheet visible. */
function getSnapPositions(
  height: number,
  fullOffset = DEFAULT_FULL_SNAP_OFFSET,
  collapsedVisibleHeight = MOBILE_COLLAPSED_VISIBLE_HEIGHT,
) {
  const sheetHeight = Math.max(160, height)
  return {
    full: Math.max(DEFAULT_FULL_SNAP_OFFSET, Math.round(fullOffset)),
    half: Math.round(sheetHeight * 0.42),
    collapsed: Math.max(72, sheetHeight - collapsedVisibleHeight),
  }
}

/** Pick the best snap point, biased by swipe velocity. */
function resolveSnap(
  y: number,
  velocityPxMs: number,
  height: number,
  fullOffset = DEFAULT_FULL_SNAP_OFFSET,
  collapsedVisibleHeight = MOBILE_COLLAPSED_VISIBLE_HEIGHT,
): MobileSheetState {
  const snaps = getSnapPositions(height, fullOffset, collapsedVisibleHeight)
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
function stateFromTranslate(
  y: number,
  height: number,
  fullOffset = DEFAULT_FULL_SNAP_OFFSET,
  collapsedVisibleHeight = MOBILE_COLLAPSED_VISIBLE_HEIGHT,
): MobileSheetState {
  const snaps = getSnapPositions(height, fullOffset, collapsedVisibleHeight)
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
const MOBILE_STACK_REAR_SHEET_VISIBLE_GAP = 6
const MOBILE_FEATURE_CARD_FRONT_OFFSET = 8

export const DESKTOP_SIDEBAR_MIN_WIDTH = 240
export const DESKTOP_SIDEBAR_MAX_WIDTH = 520

/** Desktop-only vertical drag strip that reports a clamped sidebar width while dragging. */
function SidebarResizeHandle({
  side,
  width,
  onWidthChange,
}: {
  side: 'left' | 'right'
  width: number
  onWidthChange: (width: number) => void
}) {
  const dragState = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null)
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Resize sidebar' : 'Resize right sidebar'}
      aria-valuemin={DESKTOP_SIDEBAR_MIN_WIDTH}
      aria-valuemax={DESKTOP_SIDEBAR_MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className={cn(
        'absolute inset-y-0 z-30 hidden w-2 cursor-col-resize touch-none transition-colors hover:bg-cyan-500/40 focus-visible:bg-cyan-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 md:block',
        side === 'left' ? 'right-0' : 'left-0',
      )}
      onKeyDown={(event) => {
        const direction = side === 'left' ? 1 : -1
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          onWidthChange(Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, width - 10 * direction))
        } else if (event.key === 'ArrowRight') {
          event.preventDefault()
          onWidthChange(Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, width + 10 * direction))
        } else if (event.key === 'Home') {
          event.preventDefault()
          onWidthChange(DESKTOP_SIDEBAR_MIN_WIDTH)
        } else if (event.key === 'End') {
          event.preventDefault()
          onWidthChange(DESKTOP_SIDEBAR_MAX_WIDTH)
        }
      }}
      onPointerDown={(event) => {
        dragState.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width }
        event.currentTarget.setPointerCapture(event.pointerId)
        event.preventDefault()
      }}
      onPointerMove={(event) => {
        const drag = dragState.current
        if (!drag || drag.pointerId !== event.pointerId) return
        const delta = event.clientX - drag.startX
        const raw = side === 'left' ? drag.startWidth + delta : drag.startWidth - delta
        onWidthChange(Math.round(Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, raw))))
      }}
      onPointerUp={() => {
        dragState.current = null
      }}
      onPointerCancel={() => {
        dragState.current = null
      }}
    />
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MapSectionLayout({
  sidebar,
  showDesktopSidebar: showDesktopSidebarProp,
  onToggleDesktopSidebar: onToggleDesktopSidebarProp,
  desktopSidebarWidth = 350,
  mobileInitialSheetState = 'collapsed',
  mobilePeek,
  mobilePeekTitle,
  mobilePeekSubtitle,
  selectedFeatureMobilePeek,
  showMobilePeek = false,
  showMobileSheetChevron = true,
  mobileSidebar,
  mobileSnapTo,
  mobileSnapVisibleHeight,
  mobileSnapFromVisibleHeight,
  mobileSnapKey,
  mobileSheetInteractive = true,
  mobileScrimEnabled = true,
  mobileSheetContentClassName,
  mobileCollapsedVisibleHeight = MOBILE_COLLAPSED_VISIBLE_HEIGHT,
  onMobileSheetStateChange,
  onDesktopSidebarWidthChange,
  rightSidebar,
  showDesktopRightSidebar = true,
  onToggleDesktopRightSidebar,
  desktopRightSidebarWidth = 360,
  onDesktopRightSidebarWidthChange,
  suppressMobileSheet = false,
  disableSidebar = false,
  bottomPane,
  bottomPaneHeight = 0,
  children,
  className,
}: MapSectionLayoutProps) {
  // Uncontrolled by default: every section used to repeat the same
  // useState(true) + toggle purely to satisfy these two props.
  const [uncontrolledSidebarOpen, setUncontrolledSidebarOpen] = useState(true)
  const showDesktopSidebar = showDesktopSidebarProp ?? uncontrolledSidebarOpen
  const toggleUncontrolledSidebar = useCallback(() => setUncontrolledSidebarOpen((open) => !open), [])
  const onToggleDesktopSidebar = onToggleDesktopSidebarProp ?? toggleUncontrolledSidebar

  const [mobileSheetState, setMobileSheetState] = useState<MobileSheetState>(mobileInitialSheetState)
  const mobileSheetStateRef = useRef<MobileSheetState>(mobileInitialSheetState)
  const [mobileFeatureCardOpen, setMobileFeatureCardOpen] = useState(false)
  const [mobileControlsInFront, setMobileControlsInFront] = useState(false)
  const [mobileFeaturePeek, setMobileFeaturePeek] = useState<{ title?: string; subtitle?: string }>({})

  // DOM refs
  const rootRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const rightSidebarRef = useRef<HTMLDivElement>(null)
  const searchTargetRef = useRef<HTMLInputElement | null>(null)
  const [searchRequest, setSearchRequest] = useState(0)

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
  const suppressScrim = useRef(false)
  const pointerDragId = useRef<number | null>(null)

  // ------ helpers ----------------------------------------------------------

  const getSheetHeight = useCallback(() => {
    return sheetRef.current?.getBoundingClientRect().height || window.innerHeight
  }, [])

  const getFullSnapOffset = useCallback(() => {
    if (!isMobileViewport()) return DEFAULT_FULL_SNAP_OFFSET
    const toolbar = document.querySelector<HTMLElement>('[data-map-mobile-toolbar="true"]')
    const toolbarBottom = toolbar?.getBoundingClientRect().bottom ?? 0
    return toolbarBottom > 0 ? toolbarBottom + MOBILE_TOOLBAR_GAP : DEFAULT_FULL_SNAP_OFFSET
  }, [])

  const applyTransform = useCallback((y: number, animate: boolean) => {
    const sheet = sheetRef.current
    if (!sheet) return
    const sheetHeight = getSheetHeight()
    sheet.style.transition = animate ? SPRING : 'none'
    sheet.style.transform = `translateY(${y}px)`
    curY.current = y
    const visibleHeight = Math.max(0, sheetHeight - y)
    rootRef.current?.style.setProperty('--map-mobile-sheet-visible-height', `${visibleHeight}px`)
    if (mobileControlsInFront && mobileFeatureCardOpen) {
      window.dispatchEvent(new CustomEvent(MOBILE_MAP_CONTROLS_VISIBLE_HEIGHT_EVENT, {
        detail: { visibleHeight },
      }))
    }

    // Scrim opacity (0 at collapsed → 0.4 at full)
    const snaps = getSnapPositions(sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight)
    const range = snaps.collapsed - snaps.full
    const t = Math.max(0, Math.min(1, 1 - (y - snaps.full) / range))
    if (scrimRef.current) {
      const showScrim = mobileSheetInteractive && mobileScrimEnabled && !suppressScrim.current
      scrimRef.current.style.opacity = showScrim ? String(t * 0.4) : '0'
      scrimRef.current.style.pointerEvents = showScrim && t > 0.05 ? 'auto' : 'none'
      scrimRef.current.style.transition = animate ? 'opacity 0.35s ease' : 'none'
    }
  }, [getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, mobileControlsInFront, mobileFeatureCardOpen, mobileScrimEnabled, mobileSheetInteractive])

  const updateMobileSheetState = useCallback((state: MobileSheetState) => {
    mobileSheetStateRef.current = state
    setMobileSheetState(state)
    onMobileSheetStateChange?.(state)
  }, [onMobileSheetStateChange])

  const snapTo = useCallback(
    (state: MobileSheetState) => {
      suppressScrim.current = false
      updateMobileSheetState(state)
      applyTransform(getSnapPositions(getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)[state], true)
    },
    [applyTransform, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, updateMobileSheetState],
  )

  const stackBehindFeatureCard = useCallback((collapsedFeature = false, visibleFeatureHeight?: number) => {
    if (!isMobileViewport()) return
    const sheetHeight = getSheetHeight()
    const featureHeight = collapsedFeature
      ? MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT
      : Math.min(visibleFeatureHeight ?? MOBILE_FEATURE_CARD_COMPACT_HEIGHT, Math.max(160, window.innerHeight - 104))
    const visibleHeight = collapsedFeature
      ? featureHeight + MOBILE_STACK_REAR_SHEET_VISIBLE_GAP
      : featureHeight + MOBILE_STACK_REAR_SHEET_VISIBLE_GAP - MOBILE_FEATURE_CARD_FRONT_OFFSET
    const snaps = getSnapPositions(sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight)
    const y = Math.max(snaps.full, Math.min(snaps.collapsed, sheetHeight - visibleHeight))
    suppressScrim.current = true
    updateMobileSheetState(stateFromTranslate(y, sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight))
    applyTransform(y, true)
    if (scrimRef.current) {
      scrimRef.current.style.opacity = '0'
      scrimRef.current.style.pointerEvents = 'none'
    }
  }, [applyTransform, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, updateMobileSheetState])

  const stackControlsOverFeatureCard = useCallback((collapsedFeature = false, visibleFeatureHeight?: number) => {
    if (!isMobileViewport()) return
    const sheetHeight = getSheetHeight()
    const featureHeight = collapsedFeature
      ? MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT
      : Math.min(visibleFeatureHeight ?? MOBILE_FEATURE_CARD_COMPACT_HEIGHT, Math.max(160, window.innerHeight - 104))
    const snaps = getSnapPositions(sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight)
    const y = Math.max(snaps.full, Math.min(snaps.collapsed, sheetHeight - featureHeight))
    suppressScrim.current = true
    updateMobileSheetState(stateFromTranslate(y, sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight))
    applyTransform(y, true)
    if (scrimRef.current) {
      scrimRef.current.style.opacity = '0'
      scrimRef.current.style.pointerEvents = 'none'
    }
  }, [applyTransform, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, updateMobileSheetState])

  const bringControlsToFront = useCallback(() => {
    if (!isMobileViewport()) return
    setMobileControlsInFront(true)
    suppressScrim.current = true
    window.dispatchEvent(new CustomEvent(MOBILE_MAP_CONTROLS_FRONT_EVENT))
    stackControlsOverFeatureCard(false)
  }, [stackControlsOverFeatureCard])

  const bringFeatureCardToFront = useCallback(() => {
    if (!isMobileViewport()) return
    setMobileControlsInFront(false)
    window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_FRONT_EVENT))
    stackBehindFeatureCard(false)
  }, [stackBehindFeatureCard])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const openSearch = (event: Event) => {
      const selector = 'input[data-map-search-input="true"]'
      const leftInput = contentRef.current?.querySelector<HTMLInputElement>(selector)
      const rightInput = rightSidebarRef.current?.querySelector<HTMLInputElement>(selector)
      const input = leftInput ?? rightInput
      if (!input || disableSidebar || (isMobileViewport() && suppressMobileSheet)) return
      event.preventDefault()
      searchTargetRef.current = input
      if (isMobileViewport()) {
        setMobileControlsInFront(true)
        window.dispatchEvent(new CustomEvent(MOBILE_MAP_CONTROLS_FRONT_EVENT))
        suppressScrim.current = false
        updateMobileSheetState('full')
        // Reveal synchronously before focus; do not let scroll-to-focus move the map.
        applyTransform(getFullSnapOffset(), false)
      } else if (leftInput && !showDesktopSidebar) {
        onToggleDesktopSidebar()
      } else if (!leftInput && !showDesktopRightSidebar) {
        onToggleDesktopRightSidebar?.()
      }
      setSearchRequest((request) => request + 1)
    }
    root.addEventListener(MAP_SEARCH_REQUEST, openSearch)
    return () => root.removeEventListener(MAP_SEARCH_REQUEST, openSearch)
  }, [applyTransform, disableSidebar, getFullSnapOffset, onToggleDesktopRightSidebar, onToggleDesktopSidebar, showDesktopRightSidebar, showDesktopSidebar, suppressMobileSheet, updateMobileSheetState])

  useLayoutEffect(() => {
    const input = searchTargetRef.current
    const root = rootRef.current
    if (!searchRequest || !input || !root || !input.getClientRects().length) return
    input.focus({ preventScroll: true })
    input.select()
    // Only scroll the panel's own scroll containers, never the map/layout ancestors.
    const reveal = () => {
      const viewportBottom = window.visualViewport
        ? window.visualViewport.offsetTop + window.visualViewport.height
        : window.innerHeight
      for (let parent = input.parentElement; parent && parent !== root; parent = parent.parentElement) {
        if (!/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) continue
        const field = input.getBoundingClientRect()
        const pane = parent.getBoundingClientRect()
        const bottom = Math.min(pane.bottom, viewportBottom) - 16
        if (field.bottom > bottom) parent.scrollTop += field.bottom - bottom
        else if (field.top < pane.top + 16) parent.scrollTop -= pane.top + 16 - field.top
      }
    }
    reveal()
    const revealFocused = () => { if (document.activeElement === input) reveal() }
    window.visualViewport?.addEventListener('resize', revealFocused)
    return () => window.visualViewport?.removeEventListener('resize', revealFocused)
  }, [searchRequest])

  useEffect(() => {
    if (!isMobileViewport()) return
    if (mobileSnapVisibleHeight != null) {
      const sheetHeight = getSheetHeight()
      const snaps = getSnapPositions(sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight)
      const y = Math.max(snaps.full, Math.min(snaps.collapsed, sheetHeight - mobileSnapVisibleHeight))
      if (mobileSnapFromVisibleHeight != null && sheetRef.current) {
        const fromY = Math.max(snaps.full, Math.min(snaps.collapsed, sheetHeight - mobileSnapFromVisibleHeight))
        applyTransform(fromY, false)
        requestAnimationFrame(() => applyTransform(y, true))
        updateMobileSheetState(stateFromTranslate(y, sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight))
        return
      }
      updateMobileSheetState(stateFromTranslate(y, sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight))
      applyTransform(y, true)
      return
    }
    if (!mobileSnapTo) return
    snapTo(mobileSnapTo)
  }, [applyTransform, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, mobileSnapFromVisibleHeight, mobileSnapKey, mobileSnapTo, mobileSnapVisibleHeight, snapTo, updateMobileSheetState])

  // ------ lifecycle --------------------------------------------------------

  // Position on first paint (before browser paints → no flash)
  useLayoutEffect(() => {
    // No bottom sheet is rendered when the sidebar is disabled. Keep publishing
    // an explicit 0px height so nested map overlays do not fall back to their
    // mobile sheet offsets.
    if (disableSidebar) {
      rootRef.current?.style.setProperty('--map-mobile-sheet-visible-height', '0px')
      return
    }
    if (isMobileViewport()) {
      const y = getSnapPositions(getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)[mobileInitialSheetState]
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${y}px)`
        sheetRef.current.style.transition = 'none'
      }
      curY.current = y
      rootRef.current?.style.setProperty('--map-mobile-sheet-visible-height', `${Math.max(0, getSheetHeight() - y)}px`)
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
      if (!isMobileViewport()) {
        // Desktop — clear mobile transforms
        if (sheetRef.current) {
          sheetRef.current.style.transform = ''
          sheetRef.current.style.transition = ''
        }
        rootRef.current?.style.removeProperty('--map-mobile-sheet-visible-height')
        if (scrimRef.current) {
          scrimRef.current.style.opacity = '0'
          scrimRef.current.style.pointerEvents = 'none'
        }
      } else if (!dragging.current) {
        const sheetHeight = getSheetHeight()
        // Desktop has no translateY. Preserve the logical mobile snap when
        // crossing a breakpoint rather than interpreting that zero as "full".
        applyTransform(getSnapPositions(sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight)[mobileSheetStateRef.current], false)
      }
    }
    const onOrientationChange = () => setTimeout(onResize, 150)

    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientationChange)
    // React can change the pane height after the window resize event (for
    // example when Index Lab removes its desktop header on a phone).
    const observer = new ResizeObserver(onResize)
    if (rootRef.current) observer.observe(rootRef.current)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientationChange)
    }
  }, [applyTransform, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight])

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
      if (!isMobileViewport()) return
      if ((e.target as HTMLElement | null)?.closest('[data-map-mobile-sheet-peek-action="true"]')) return
      const t = e.touches[0]
      const isHandle = handle!.contains(e.target as Node)
      if (isHandle && mobileFeatureCardOpen && !mobileControlsInFront) {
        bringControlsToFront()
      }

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
      if (!isMobileViewport()) return
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
        const snaps = getSnapPositions(getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)
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

        const state = stateFromTranslate(curY.current, getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)
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
      if (!isMobileViewport()) return
      sheet!.style.willChange = ''

      if (!dragging.current) return
      dragging.current = false

      // Tap on handle (< 10 px total movement) → cycle state
      if (fromHandle.current && e.changedTouches.length > 0) {
        const ct = e.changedTouches[0]
        const moved = Math.abs(ct.clientY - startY.current) + Math.abs(ct.clientX - startX.current)
        if (moved < 10) {
          if (mobileFeatureCardOpen && !mobileControlsInFront) {
            bringControlsToFront()
            return
          }
          const s = stateFromTranslate(curY.current, getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)
          snapTo(s === 'collapsed' ? 'half' : s === 'half' ? 'full' : 'collapsed')
          return
        }
      }

      snapTo(resolveSnap(curY.current, vel.current, getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight))
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
  }, [applyTransform, bringControlsToFront, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, mobileControlsInFront, mobileFeatureCardOpen, snapTo])

  // Scrim tap → collapse
  const handleScrimClick = useCallback(() => snapTo('collapsed'), [snapTo])

  const startHandlePointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobileViewport() || event.pointerType === 'touch') return
    if (mobileFeatureCardOpen && !mobileControlsInFront) {
      bringControlsToFront()
    }

    pointerDragId.current = event.pointerId
    dragging.current = true
    fromHandle.current = true
    decided.current = true
    startY.current = event.clientY
    startX.current = event.clientX
    startTranslate.current = curY.current
    prevTouchY.current = event.clientY
    prevTouchTime.current = performance.now()
    vel.current = 0
    sheetRef.current?.style.setProperty('transition', 'none')
    sheetRef.current?.style.setProperty('will-change', 'transform')
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }, [bringControlsToFront, mobileControlsInFront, mobileFeatureCardOpen])

  const moveHandlePointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isMobileViewport() || event.pointerId !== pointerDragId.current || !dragging.current) return

    const now = performance.now()
    const dt = now - prevTouchTime.current
    if (dt > 0) vel.current = (event.clientY - prevTouchY.current) / dt
    prevTouchY.current = event.clientY
    prevTouchTime.current = now

    const delta = event.clientY - startY.current
    let nextY = startTranslate.current + delta
    const snaps = getSnapPositions(getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)
    if (nextY < snaps.full) nextY = snaps.full - (snaps.full - nextY) * 0.25
    if (nextY > snaps.collapsed) nextY = snaps.collapsed + (nextY - snaps.collapsed) * 0.25
    applyTransform(nextY, false)
    event.preventDefault()
  }, [applyTransform, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight])

  const endHandlePointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerDragId.current) return

    pointerDragId.current = null
    sheetRef.current?.style.setProperty('will-change', '')
    if (!dragging.current) return
    dragging.current = false

    const moved = Math.abs(event.clientY - startY.current) + Math.abs(event.clientX - startX.current)
    if (moved < 10) {
      const state = stateFromTranslate(curY.current, getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)
      snapTo(state === 'collapsed' ? 'half' : state === 'half' ? 'full' : 'collapsed')
      return
    }

    snapTo(resolveSnap(curY.current, vel.current, getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight))
  }, [getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, snapTo])

  const handleMobileSheetKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    const states: MobileSheetState[] = ['collapsed', 'half', 'full']
    const currentIndex = states.indexOf(mobileSheetState)
    let nextState: MobileSheetState | undefined

    if (event.key === 'ArrowUp') nextState = states[Math.min(states.length - 1, currentIndex + 1)]
    if (event.key === 'ArrowDown') nextState = states[Math.max(0, currentIndex - 1)]
    if (event.key === 'Home') nextState = 'collapsed'
    if (event.key === 'End') nextState = 'full'
    if (event.key === 'Enter' || event.key === ' ') {
      nextState = mobileSheetState === 'collapsed' ? 'half' : mobileSheetState === 'half' ? 'full' : 'collapsed'
    }
    if (!nextState) return

    event.preventDefault()
    snapTo(nextState)
  }, [mobileSheetState, snapTo])

  useEffect(() => {
    const collapse = () => {
      if (!isMobileViewport()) return
      setMobileControlsInFront(false)
      snapTo('collapsed')
    }
    const collapseForMapInteraction = () => {
      if (!isMobileViewport()) return
      setMobileControlsInFront(false)
      snapTo('collapsed')
    }
    const stack = () => {
      setMobileFeatureCardOpen(true)
      setMobileControlsInFront(false)
      stackBehindFeatureCard(false)
    }
    const handleFeatureOpen = () => {
      setMobileFeatureCardOpen(true)
      setMobileControlsInFront(false)
    }
    const handleFeatureClose = () => {
      setMobileFeatureCardOpen(false)
      setMobileControlsInFront(false)
    }
    const handleFeaturePeek = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      setMobileFeaturePeek({
        title: typeof event.detail?.title === 'string' ? event.detail.title : undefined,
        subtitle: typeof event.detail?.subtitle === 'string' ? event.detail.subtitle : undefined,
      })
    }
    const handleFeatureCollapseState = (event: Event) => {
      if (!isMobileViewport() || !(event instanceof CustomEvent)) return
      const collapsed = Boolean(event.detail?.collapsed)
      const visibleHeight = typeof event.detail?.visibleHeight === 'number' ? event.detail.visibleHeight : undefined
      if (mobileControlsInFront) {
        stackControlsOverFeatureCard(collapsed, visibleHeight)
        return
      }
      if (collapsed) {
        snapTo('collapsed')
        return
      }
      stackBehindFeatureCard(collapsed, visibleHeight)
    }
    const handleFeatureDock = () => {
      setMobileFeatureCardOpen(true)
      bringControlsToFront()
    }
    window.addEventListener(MOBILE_MAP_INTERACTION_EVENT, collapseForMapInteraction)
    window.addEventListener(MOBILE_MAP_SHEET_COLLAPSE_EVENT, collapse)
    window.addEventListener(MOBILE_MAP_SHEET_STACK_EVENT, stack)
    window.addEventListener(MOBILE_FEATURE_CARD_COLLAPSE_STATE_EVENT, handleFeatureCollapseState)
    window.addEventListener(MOBILE_FEATURE_CARD_DOCK_EVENT, handleFeatureDock)
    window.addEventListener(MOBILE_FEATURE_CARD_OPEN_EVENT, handleFeatureOpen)
    window.addEventListener(MOBILE_FEATURE_CARD_CLOSE_EVENT, handleFeatureClose)
    window.addEventListener(MOBILE_FEATURE_CARD_PEEK_EVENT, handleFeaturePeek)
    return () => {
      window.removeEventListener(MOBILE_MAP_INTERACTION_EVENT, collapseForMapInteraction)
      window.removeEventListener(MOBILE_MAP_SHEET_COLLAPSE_EVENT, collapse)
      window.removeEventListener(MOBILE_MAP_SHEET_STACK_EVENT, stack)
      window.removeEventListener(MOBILE_FEATURE_CARD_COLLAPSE_STATE_EVENT, handleFeatureCollapseState)
      window.removeEventListener(MOBILE_FEATURE_CARD_DOCK_EVENT, handleFeatureDock)
      window.removeEventListener(MOBILE_FEATURE_CARD_OPEN_EVENT, handleFeatureOpen)
      window.removeEventListener(MOBILE_FEATURE_CARD_CLOSE_EVENT, handleFeatureClose)
      window.removeEventListener(MOBILE_FEATURE_CARD_PEEK_EVENT, handleFeaturePeek)
    }
  }, [bringControlsToFront, mobileControlsInFront, snapTo, stackBehindFeatureCard, stackControlsOverFeatureCard])

  // ─── Render ──────────────────────────────────────────────────────────────

  const renderedMobilePeek = mobileControlsInFront && mobileFeatureCardOpen ? (
    <button
      type="button"
      className="min-w-0 text-left"
      data-map-mobile-sheet-peek-action="true"
      aria-label="Show selected feature card"
      onClick={(event) => {
        event.stopPropagation()
        bringFeatureCardToFront()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
    >
      <span className="block truncate text-xs font-semibold text-foreground">
        {mobileFeaturePeek.title || selectedFeatureMobilePeek?.title || 'Selected feature'}
      </span>
      <span className="block truncate text-xs text-muted-foreground">
        {mobileFeaturePeek.subtitle || selectedFeatureMobilePeek?.subtitle || 'Tap to show selected feature'}
      </span>
    </button>
  ) : (
    mobilePeek ?? ((mobilePeekTitle || mobilePeekSubtitle) ? (
      <div className="min-w-0 text-left">
        <div className="truncate text-xs font-semibold text-foreground">{mobilePeekTitle}</div>
        <div className="truncate text-xs text-muted-foreground">{mobilePeekSubtitle}</div>
      </div>
    ) : undefined)
  )

  return (
    <div
      ref={rootRef}
      data-map-layout-root="true"
      className={cn(
        'relative flex h-full w-full overflow-clip bg-slate-100 dark:bg-slate-950',
        // Padding (not a wrapper element) keeps the existing flex row untouched
        // for every page that does not use a bottom pane. Desktop only — the
        // mobile table renders as a sheet instead.
        bottomPane && 'md:pb-[var(--map-bottom-pane-height)]',
        className,
      )}
      style={{
        ...MAP_OVERLAY_ROOT_STYLE,
        ...(bottomPane ? { '--map-bottom-pane-height': `${bottomPaneHeight}px` } : {}),
      } as CSSProperties}
    >
      {/* Sidebar wrapper */}
      {!disableSidebar && (
      <div
        className={cn(
          'pointer-events-none absolute inset-0 md:pointer-events-auto md:relative md:inset-auto md:z-10 md:h-full md:shrink-0',
          mobileControlsInFront ? 'z-[60]' : 'z-30',
          suppressMobileSheet && 'hidden md:block',
          showDesktopSidebar ? 'md:block md:w-[clamp(17.5rem,34vw,var(--desktop-sidebar-width))] xl:w-[var(--desktop-sidebar-width)]' : 'md:hidden',
        )}
        style={{ '--desktop-sidebar-width': `${desktopSidebarWidth}px` } as CSSProperties}
        data-map-sidebar-wrapper="true"
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
            'absolute inset-x-0 bottom-0 flex h-full max-h-full flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)]',
            mobileSheetInteractive || mobileControlsInFront || mobileFeatureCardOpen ? 'pointer-events-auto' : 'pointer-events-none',
            'md:relative md:inset-auto md:h-full md:rounded-none md:border-0 md:bg-transparent md:shadow-none md:backdrop-blur-none',
          )}
          data-map-mobile-sheet="true"
          onClickCapture={(event) => {
            if (!mobileFeatureCardOpen || mobileControlsInFront) return
            event.preventDefault()
            event.stopPropagation()
            bringControlsToFront()
          }}
        >
          {/* Drag handle */}
          <div
            ref={handleRef}
            className="relative flex shrink-0 cursor-grab touch-none flex-col select-none rounded-t-lg active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring md:hidden"
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize sheet"
            aria-valuemin={0}
            aria-valuemax={2}
            aria-valuenow={mobileSheetState === 'collapsed' ? 0 : mobileSheetState === 'half' ? 1 : 2}
            aria-valuetext={`${mobileSheetState} panel`}
            tabIndex={0}
            data-map-mobile-sheet-handle="true"
            onKeyDown={handleMobileSheetKeyDown}
            onPointerDown={startHandlePointerDrag}
            onPointerMove={moveHandlePointerDrag}
            onPointerUp={endHandlePointerDrag}
            onPointerCancel={endHandlePointerDrag}
            onClick={(event) => {
              if (!mobileFeatureCardOpen || mobileControlsInFront) return
              event.stopPropagation()
              bringControlsToFront()
            }}
          >
            <div className="flex justify-center py-2" aria-hidden="true">
              <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
            </div>
            {((showMobilePeek && mobileSheetState === 'collapsed') || (mobileFeatureCardOpen && mobileControlsInFront)) && (
              <div
                className={cn(
                  'min-h-0 w-full px-4 pb-3',
                  showMobileSheetChevron && 'pr-14',
                  renderedMobilePeek && 'border-b border-border',
                )}
              >
                {renderedMobilePeek ?? <div className="h-8" aria-hidden="true" />}
              </div>
            )}
            {showMobileSheetChevron && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  snapTo(mobileSheetState === 'collapsed' ? 'half' : 'collapsed')
                }}
                className="absolute right-2 top-1 inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:right-3"
                aria-label={mobileSheetState === 'collapsed' ? 'Show panel' : 'Hide panel'}
              >
                {mobileSheetState === 'collapsed' ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            )}
          </div>

          {/* Sidebar content */}
          <div
            ref={contentRef}
            className={cn(
              'min-h-0 flex-1 overflow-hidden overscroll-y-contain pb-[calc(env(safe-area-inset-bottom)+4rem)] md:h-full md:!touch-auto md:pb-0',
              mobileSheetContentClassName,
              mobileSheetState === 'full' ? 'touch-auto' : 'touch-none',
            )}
            data-map-mobile-sheet-content="true"
          >
            {mobileSidebar ? (
              <>
                <div className="h-full md:hidden">
                  {mobileSidebar}
                </div>
                <div className="hidden h-full md:block">
                  {sidebar}
                </div>
              </>
            ) : sidebar}
          </div>
        </div>

        {onDesktopSidebarWidthChange && showDesktopSidebar && (
          <SidebarResizeHandle side="left" width={desktopSidebarWidth} onWidthChange={onDesktopSidebarWidthChange} />
        )}
      </div>
      )}

      {/* Desktop left-sidebar toggle */}
      {!disableSidebar && (
      <button
        type="button"
        onClick={onToggleDesktopSidebar}
        aria-label={showDesktopSidebar ? 'Hide sidebar' : 'Show sidebar'}
        style={{ left: showDesktopSidebar ? `clamp(17.5rem, 34vw, ${desktopSidebarWidth}px)` : 0 }}
        className="absolute top-1/2 z-20 hidden h-16 w-8 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 border-slate-300/80 bg-background/95 text-slate-600 shadow-sm backdrop-blur transition-[left,background-color,color,border-color] hover:bg-muted dark:border-slate-700 dark:text-slate-200 md:flex"
      >
        {showDesktopSidebar ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
      </button>
      )}

      {/* Map content */}
      <div className="relative min-w-0 flex-1 overflow-hidden" data-map-content="true">{children}</div>

      {/* Right sidebar (desktop only) */}
      {rightSidebar && (
        <>
          <div
            ref={rightSidebarRef}
            className={cn(
              'hidden md:block md:absolute md:right-0 md:top-0 md:z-30 md:h-full md:shrink-0 md:overflow-visible lg:relative lg:z-10',
              showDesktopRightSidebar ? 'md:w-[var(--desktop-right-sidebar-width)]' : 'md:w-0',
            )}
            style={{ '--desktop-right-sidebar-width': `${desktopRightSidebarWidth}px` } as CSSProperties}
            data-map-right-sidebar="true"
          >
            <div
              className={cn('relative h-full overflow-visible', showDesktopRightSidebar ? 'w-full' : 'w-0')}
            >
              {showDesktopRightSidebar && (
                <>
                  {onToggleDesktopRightSidebar && (
                    <button
                      type="button"
                      onClick={onToggleDesktopRightSidebar}
                      aria-label="Hide right sidebar"
                      className="absolute left-0 top-0 z-20 hidden h-[4.35rem] w-8 -translate-x-full items-center justify-center rounded-l-xl border border-r-0 border-slate-300/80 bg-background/95 text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-muted dark:border-slate-700 dark:text-slate-200 md:flex"
                    >
                      <ChevronsRight className="h-4 w-4" />
                    </button>
                  )}
                  <div className="h-full w-full">
                    {rightSidebar}
                  </div>
                  {onDesktopRightSidebarWidthChange && (
                    <SidebarResizeHandle
                      side="right"
                      width={desktopRightSidebarWidth}
                      onWidthChange={onDesktopRightSidebarWidthChange}
                    />
                  )}
                </>
              )}
            </div>
          </div>

          {onToggleDesktopRightSidebar && !showDesktopRightSidebar && (
            <button
              type="button"
              onClick={onToggleDesktopRightSidebar}
              aria-label="Show right sidebar"
              style={{ right: 0 }}
              className="absolute top-0 z-20 hidden h-[4.35rem] w-8 items-center justify-center rounded-l-xl border border-r-0 border-slate-300/80 bg-background/95 text-slate-600 shadow-sm backdrop-blur transition-[right,background-color,color,border-color] hover:bg-muted dark:border-slate-700 dark:text-slate-200 md:flex"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
          )}
        </>
      )}

      {/* Docked bottom pane — spans the full root width, under the sidebars too. */}
      {bottomPane}
    </div>
  )
}
