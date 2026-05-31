import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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

type MobileSheetState = 'collapsed' | 'half' | 'full'

interface MapSectionLayoutProps {
  sidebar: ReactNode
  showDesktopSidebar: boolean
  onToggleDesktopSidebar: () => void
  desktopSidebarWidth?: number
  mobileInitialSheetState?: MobileSheetState
  mobilePeek?: ReactNode
  showMobilePeek?: boolean
  mobileSidebar?: ReactNode
  mobileSnapTo?: MobileSheetState
  mobileSnapVisibleHeight?: number
  mobileSnapFromVisibleHeight?: number
  mobileSnapKey?: string | number
  mobileSheetInteractive?: boolean
  mobileScrimEnabled?: boolean
  onMobileSheetStateChange?: (state: MobileSheetState) => void
  rightSidebar?: ReactNode
  showDesktopRightSidebar?: boolean
  onToggleDesktopRightSidebar?: () => void
  desktopRightSidebarWidth?: number
  suppressMobileSheet?: boolean
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
function getSnapPositions(height: number, fullOffset = DEFAULT_FULL_SNAP_OFFSET) {
  const sheetHeight = Math.max(160, height)
  return {
    full: Math.max(DEFAULT_FULL_SNAP_OFFSET, Math.round(fullOffset)),
    half: Math.round(sheetHeight * 0.42),
    collapsed: Math.max(72, sheetHeight - MOBILE_COLLAPSED_VISIBLE_HEIGHT),
  }
}

/** Pick the best snap point, biased by swipe velocity. */
function resolveSnap(y: number, velocityPxMs: number, height: number, fullOffset = DEFAULT_FULL_SNAP_OFFSET): MobileSheetState {
  const snaps = getSnapPositions(height, fullOffset)
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
function stateFromTranslate(y: number, height: number, fullOffset = DEFAULT_FULL_SNAP_OFFSET): MobileSheetState {
  const snaps = getSnapPositions(height, fullOffset)
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
const DESKTOP_MEDIA_MIN_WIDTH = 768
const MOBILE_STACK_REAR_SHEET_VISIBLE_GAP = 6
const MOBILE_FEATURE_CARD_FRONT_OFFSET = 8

function isMobileViewport() {
  return typeof window !== 'undefined' && window.innerWidth < DESKTOP_MEDIA_MIN_WIDTH
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function MapSectionLayout({
  sidebar,
  showDesktopSidebar,
  onToggleDesktopSidebar,
  desktopSidebarWidth = 350,
  mobileInitialSheetState = 'collapsed',
  mobilePeek,
  showMobilePeek = false,
  mobileSidebar,
  mobileSnapTo,
  mobileSnapVisibleHeight,
  mobileSnapFromVisibleHeight,
  mobileSnapKey,
  mobileSheetInteractive = true,
  mobileScrimEnabled = true,
  onMobileSheetStateChange,
  rightSidebar,
  showDesktopRightSidebar = true,
  onToggleDesktopRightSidebar,
  desktopRightSidebarWidth = 360,
  suppressMobileSheet = false,
  children,
  className,
}: MapSectionLayoutProps) {
  const [mobileSheetState, setMobileSheetState] = useState<MobileSheetState>(mobileInitialSheetState)
  const [mobileFeatureCardOpen, setMobileFeatureCardOpen] = useState(false)
  const [mobileControlsInFront, setMobileControlsInFront] = useState(false)
  const [mobileFeaturePeek, setMobileFeaturePeek] = useState<{ title?: string; subtitle?: string }>({})

  // DOM refs
  const rootRef = useRef<HTMLDivElement>(null)
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
    const snaps = getSnapPositions(sheetHeight, getFullSnapOffset())
    const range = snaps.collapsed - snaps.full
    const t = Math.max(0, Math.min(1, 1 - (y - snaps.full) / range))
    if (scrimRef.current) {
      const showScrim = mobileSheetInteractive && mobileScrimEnabled && !suppressScrim.current
      scrimRef.current.style.opacity = showScrim ? String(t * 0.4) : '0'
      scrimRef.current.style.pointerEvents = showScrim && t > 0.05 ? 'auto' : 'none'
      scrimRef.current.style.transition = animate ? 'opacity 0.35s ease' : 'none'
    }
  }, [getFullSnapOffset, getSheetHeight, mobileControlsInFront, mobileFeatureCardOpen, mobileScrimEnabled, mobileSheetInteractive])

  const updateMobileSheetState = useCallback((state: MobileSheetState) => {
    setMobileSheetState(state)
    onMobileSheetStateChange?.(state)
  }, [onMobileSheetStateChange])

  const snapTo = useCallback(
    (state: MobileSheetState) => {
      suppressScrim.current = false
      updateMobileSheetState(state)
      applyTransform(getSnapPositions(getSheetHeight(), getFullSnapOffset())[state], true)
    },
    [applyTransform, getFullSnapOffset, getSheetHeight, updateMobileSheetState],
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
    const snaps = getSnapPositions(sheetHeight, getFullSnapOffset())
    const y = Math.max(snaps.full, Math.min(snaps.collapsed, sheetHeight - visibleHeight))
    suppressScrim.current = true
    updateMobileSheetState(stateFromTranslate(y, sheetHeight, getFullSnapOffset()))
    applyTransform(y, true)
    if (scrimRef.current) {
      scrimRef.current.style.opacity = '0'
      scrimRef.current.style.pointerEvents = 'none'
    }
  }, [applyTransform, getFullSnapOffset, getSheetHeight, updateMobileSheetState])

  const stackControlsOverFeatureCard = useCallback((collapsedFeature = false, visibleFeatureHeight?: number) => {
    if (!isMobileViewport()) return
    const sheetHeight = getSheetHeight()
    const featureHeight = collapsedFeature
      ? MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT
      : Math.min(visibleFeatureHeight ?? MOBILE_FEATURE_CARD_COMPACT_HEIGHT, Math.max(160, window.innerHeight - 104))
    const snaps = getSnapPositions(sheetHeight, getFullSnapOffset())
    const y = Math.max(snaps.full, Math.min(snaps.collapsed, sheetHeight - featureHeight))
    suppressScrim.current = true
    updateMobileSheetState(stateFromTranslate(y, sheetHeight, getFullSnapOffset()))
    applyTransform(y, true)
    if (scrimRef.current) {
      scrimRef.current.style.opacity = '0'
      scrimRef.current.style.pointerEvents = 'none'
    }
  }, [applyTransform, getFullSnapOffset, getSheetHeight, updateMobileSheetState])

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
    if (!isMobileViewport()) return
    if (mobileSnapVisibleHeight != null) {
      const sheetHeight = getSheetHeight()
      const snaps = getSnapPositions(sheetHeight, getFullSnapOffset())
      const y = Math.max(snaps.full, Math.min(snaps.collapsed, sheetHeight - mobileSnapVisibleHeight))
      if (mobileSnapFromVisibleHeight != null && sheetRef.current) {
        const fromY = Math.max(snaps.full, Math.min(snaps.collapsed, sheetHeight - mobileSnapFromVisibleHeight))
        applyTransform(fromY, false)
        requestAnimationFrame(() => applyTransform(y, true))
        updateMobileSheetState(stateFromTranslate(y, sheetHeight, getFullSnapOffset()))
        return
      }
      updateMobileSheetState(stateFromTranslate(y, sheetHeight, getFullSnapOffset()))
      applyTransform(y, true)
      return
    }
    if (!mobileSnapTo) return
    snapTo(mobileSnapTo)
  }, [applyTransform, getFullSnapOffset, getSheetHeight, mobileSnapFromVisibleHeight, mobileSnapKey, mobileSnapTo, mobileSnapVisibleHeight, snapTo, updateMobileSheetState])

  // ------ lifecycle --------------------------------------------------------

  // Position on first paint (before browser paints → no flash)
  useLayoutEffect(() => {
    if (isMobileViewport()) {
      const y = getSnapPositions(getSheetHeight(), getFullSnapOffset())[mobileInitialSheetState]
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
        const state = stateFromTranslate(curY.current, sheetHeight, getFullSnapOffset())
        applyTransform(getSnapPositions(sheetHeight, getFullSnapOffset())[state], false)
      }
    }
    const onOrientationChange = () => setTimeout(onResize, 150)

    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onOrientationChange)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onOrientationChange)
    }
  }, [applyTransform, getFullSnapOffset, getSheetHeight])

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
        const snaps = getSnapPositions(getSheetHeight(), getFullSnapOffset())
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

        const state = stateFromTranslate(curY.current, getSheetHeight(), getFullSnapOffset())
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
          const s = stateFromTranslate(curY.current, getSheetHeight(), getFullSnapOffset())
          snapTo(s === 'collapsed' ? 'half' : s === 'half' ? 'full' : 'collapsed')
          return
        }
      }

      snapTo(resolveSnap(curY.current, vel.current, getSheetHeight(), getFullSnapOffset()))
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
  }, [applyTransform, bringControlsToFront, getFullSnapOffset, getSheetHeight, mobileControlsInFront, mobileFeatureCardOpen, snapTo])

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
    const snaps = getSnapPositions(getSheetHeight(), getFullSnapOffset())
    if (nextY < snaps.full) nextY = snaps.full - (snaps.full - nextY) * 0.25
    if (nextY > snaps.collapsed) nextY = snaps.collapsed + (nextY - snaps.collapsed) * 0.25
    applyTransform(nextY, false)
    event.preventDefault()
  }, [applyTransform, getFullSnapOffset, getSheetHeight])

  const endHandlePointerDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== pointerDragId.current) return

    pointerDragId.current = null
    sheetRef.current?.style.setProperty('will-change', '')
    if (!dragging.current) return
    dragging.current = false

    const moved = Math.abs(event.clientY - startY.current) + Math.abs(event.clientX - startX.current)
    if (moved < 10) {
      const state = stateFromTranslate(curY.current, getSheetHeight(), getFullSnapOffset())
      snapTo(state === 'collapsed' ? 'half' : state === 'half' ? 'full' : 'collapsed')
      return
    }

    snapTo(resolveSnap(curY.current, vel.current, getSheetHeight(), getFullSnapOffset()))
  }, [getFullSnapOffset, getSheetHeight, snapTo])

  useEffect(() => {
    const collapse = () => {
      if (!isMobileViewport()) return
      setMobileControlsInFront(false)
      snapTo('collapsed')
    }
    const collapseForMapInteraction = () => {
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
        {mobileFeaturePeek.title || 'Selected feature'}
      </span>
      <span className="block truncate text-[11px] text-muted-foreground">
        {mobileFeaturePeek.subtitle || 'Tap to show selected feature'}
      </span>
    </button>
  ) : mobilePeek

  return (
    <div
      ref={rootRef}
      data-map-layout-root="true"
      className={cn('relative flex h-full w-full overflow-hidden bg-slate-100 dark:bg-slate-950', className)}
      style={{
        ...MAP_OVERLAY_ROOT_STYLE,
      } as CSSProperties}
    >
      {/* Sidebar wrapper */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 md:pointer-events-auto md:relative md:inset-auto md:z-10 md:h-full md:shrink-0',
          mobileControlsInFront ? 'z-[60]' : 'z-30',
          suppressMobileSheet && 'hidden md:block',
          showDesktopSidebar ? 'md:block md:w-[var(--desktop-sidebar-width)]' : 'md:hidden',
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
            className="relative flex shrink-0 cursor-grab touch-none flex-col select-none active:cursor-grabbing md:hidden"
            role="separator"
            aria-label="Drag to resize sheet"
            data-map-mobile-sheet-handle="true"
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
              <div className={cn('min-h-0 w-full px-4 pb-3 pr-14', renderedMobilePeek && 'border-b border-border')}>
                {renderedMobilePeek ?? <div className="h-8" aria-hidden="true" />}
              </div>
            )}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                snapTo(mobileSheetState === 'collapsed' ? 'half' : 'collapsed')
              }}
              className="absolute right-3 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:right-4 sm:h-8 sm:w-8"
              aria-label={mobileSheetState === 'collapsed' ? 'Show panel' : 'Hide panel'}
            >
              {mobileSheetState === 'collapsed' ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </button>
          </div>

          {/* Sidebar content */}
          <div
            ref={contentRef}
            className={cn(
              'min-h-0 flex-1 overflow-hidden overscroll-y-contain pb-[calc(env(safe-area-inset-bottom)+4rem)] md:h-full md:!touch-auto md:pb-0',
              mobileSheetState === 'full' ? 'touch-auto' : 'touch-none',
            )}
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
      </div>

      {/* Desktop left-sidebar toggle */}
      <button
        type="button"
        onClick={onToggleDesktopSidebar}
        aria-label={showDesktopSidebar ? 'Hide sidebar' : 'Show sidebar'}
        style={{ left: showDesktopSidebar ? desktopSidebarWidth : 0 }}
        className="absolute top-1/2 z-20 hidden h-16 w-8 -translate-y-1/2 items-center justify-center rounded-r-xl border border-l-0 border-slate-300/80 bg-background/95 text-slate-600 shadow-sm backdrop-blur transition-[left,background-color,color,border-color] hover:bg-muted dark:border-slate-700 dark:text-slate-200 md:flex"
      >
        {showDesktopSidebar ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
      </button>

      {/* Map content */}
      <div className="relative min-w-0 flex-1 overflow-hidden">{children}</div>

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
                'absolute inset-y-0 right-0 h-full overflow-visible transition-[width] duration-200',
                showDesktopRightSidebar ? 'w-[var(--desktop-right-sidebar-width)]' : 'w-0',
              )}
              style={{ '--desktop-right-sidebar-width': `${desktopRightSidebarWidth}px` } as CSSProperties}
            >
              {onToggleDesktopRightSidebar && showDesktopRightSidebar && (
                <button
                  type="button"
                  onClick={onToggleDesktopRightSidebar}
                  aria-label="Hide right sidebar"
                  className="absolute left-0 top-0 z-20 hidden h-[4.35rem] w-8 -translate-x-full items-center justify-center rounded-l-xl border border-r-0 border-slate-300/80 bg-background/95 text-slate-600 shadow-sm backdrop-blur transition-colors hover:bg-muted dark:border-slate-700 dark:text-slate-200 md:flex"
                >
                  <ChevronsRight className="h-4 w-4" />
                </button>
              )}
              <div className="h-full" style={{ width: `${desktopRightSidebarWidth}px` }}>
                {rightSidebar}
              </div>
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
    </div>
  )
}
