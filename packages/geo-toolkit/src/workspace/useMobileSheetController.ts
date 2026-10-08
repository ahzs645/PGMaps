import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
} from '../ui/mobile-feature-card.js'
import { useIsMobile } from './useIsMobile.js'
import { MAP_SEARCH_REQUEST } from './map-search.js'
import { useWorkspace, useWorkspaceInteractions } from './workspace-context.js'

import { useMobileSheetGestures } from './useMobileSheetGestures.js'
import type { MapSectionLayoutProps } from './MapSectionLayout.js'
import {
  DEFAULT_FULL_SNAP_OFFSET,
  MOBILE_TOOLBAR_GAP,
  SPRING,
  MOBILE_STACK_REAR_SHEET_VISIBLE_GAP,
  MOBILE_FEATURE_CARD_FRONT_OFFSET,
  getSnapPositions,
  stateFromTranslate,
  type MobileSheetState,
} from './sheet-math.js'

type SheetControllerOptions = Required<
  Pick<
    MapSectionLayoutProps,
    | 'mobileInitialSheetState'
    | 'mobileCollapsedVisibleHeight'
    | 'mobileSheetInteractive'
    | 'mobileScrimEnabled'
    | 'disableSidebar'
    | 'suppressMobileSheet'
    | 'showDesktopRightSidebar'
  >
> &
  Pick<
    MapSectionLayoutProps,
    | 'mobileInitialSheetState'
    | 'mobileCollapsedVisibleHeight'
    | 'mobileSheetInteractive'
    | 'mobileScrimEnabled'
    | 'onMobileSheetStateChange'
    | 'disableSidebar'
    | 'suppressMobileSheet'
    | 'showDesktopRightSidebar'
    | 'onToggleDesktopRightSidebar'
    | 'mobileSnapVisibleHeight'
    | 'mobileSnapFromVisibleHeight'
    | 'mobileSnapKey'
    | 'mobileSnapTo'
  > & { showDesktopSidebar: boolean; onToggleDesktopSidebar: () => void }

/** Owns sheet snapping, coordinated cards, search focus, and lifecycle independently of JSX layout. */
export function useMobileSheetController({
  mobileInitialSheetState,
  mobileCollapsedVisibleHeight,
  mobileSheetInteractive,
  mobileScrimEnabled,
  onMobileSheetStateChange,
  disableSidebar,
  suppressMobileSheet,
  showDesktopRightSidebar,
  onToggleDesktopRightSidebar,
  mobileSnapVisibleHeight,
  mobileSnapFromVisibleHeight,
  mobileSnapKey,
  mobileSnapTo,
  showDesktopSidebar,
  onToggleDesktopSidebar,
}: SheetControllerOptions) {
  const workspace = useWorkspace()
  const interactions = useWorkspaceInteractions()
  const setWorkspaceRoot = workspace?.setRoot
  const isMobile = useIsMobile()
  const [mobileSheetState, setMobileSheetState] = useState<MobileSheetState>(mobileInitialSheetState)
  const mobileSheetStateRef = useRef<MobileSheetState>(mobileInitialSheetState)
  const [mobileFeatureCardOpen, setMobileFeatureCardOpen] = useState(false)
  const [mobileControlsInFront, setMobileControlsInFront] = useState(false)
  const [mobileFeaturePeek, setMobileFeaturePeek] = useState<{ title?: string; subtitle?: string }>({})

  // DOM refs
  const rootRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    setWorkspaceRoot?.(rootRef.current)
    return () => setWorkspaceRoot?.(null)
  }, [setWorkspaceRoot])
  const sheetRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const scrimRef = useRef<HTMLDivElement>(null)
  const rightSidebarRef = useRef<HTMLDivElement>(null)
  const searchTargetRef = useRef<HTMLInputElement | null>(null)
  const [searchRequest, setSearchRequest] = useState(0)

  // Drag bookkeeping (refs for zero re-renders during drag)
  const draggingRef = useRef(false)
  const translateRef = useRef(0)
  const suppressScrim = useRef(false)

  // ------ helpers ----------------------------------------------------------

  const getSheetHeight = useCallback(() => {
    return sheetRef.current?.getBoundingClientRect().height || window.innerHeight
  }, [])

  const getFullSnapOffset = useCallback(() => {
    if (!isMobile) return DEFAULT_FULL_SNAP_OFFSET
    const toolbar =
      workspace?.toolbar ?? rootRef.current?.querySelector<HTMLElement>('[data-map-mobile-toolbar="true"]')
    const toolbarBottom = toolbar
      ? toolbar.getBoundingClientRect().bottom -
        (workspace?.placement === 'container' ? (rootRef.current?.getBoundingClientRect().top ?? 0) : 0)
      : 0
    return toolbarBottom > 0 ? toolbarBottom + MOBILE_TOOLBAR_GAP : DEFAULT_FULL_SNAP_OFFSET
  }, [workspace?.toolbar, workspace?.placement, isMobile])

  const applyTransform = useCallback(
    (y: number, animate: boolean) => {
      const sheet = sheetRef.current
      if (!sheet) return
      const sheetHeight = getSheetHeight()
      sheet.style.transition = animate ? SPRING : 'none'
      sheet.style.transform = `translateY(${y}px)`
      translateRef.current = y
      const visibleHeight = Math.max(0, sheetHeight - y)
      rootRef.current?.style.setProperty('--map-mobile-sheet-visible-height', `${visibleHeight}px`)
      if (mobileControlsInFront && mobileFeatureCardOpen) {
        interactions.dispatchEvent(
          new CustomEvent(MOBILE_MAP_CONTROLS_VISIBLE_HEIGHT_EVENT, {
            detail: { visibleHeight },
          }),
        )
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
    },
    [
      getFullSnapOffset,
      getSheetHeight,
      interactions,
      mobileCollapsedVisibleHeight,
      mobileControlsInFront,
      mobileFeatureCardOpen,
      mobileScrimEnabled,
      mobileSheetInteractive,
    ],
  )

  const updateMobileSheetState = useCallback(
    (state: MobileSheetState) => {
      mobileSheetStateRef.current = state
      setMobileSheetState(state)
      onMobileSheetStateChange?.(state)
    },
    [onMobileSheetStateChange],
  )

  const snapTo = useCallback(
    (state: MobileSheetState) => {
      suppressScrim.current = false
      updateMobileSheetState(state)
      applyTransform(getSnapPositions(getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)[state], true)
    },
    [applyTransform, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, updateMobileSheetState],
  )

  const stackBehindFeatureCard = useCallback(
    (collapsedFeature = false, visibleFeatureHeight?: number) => {
      if (!isMobile) return
      const sheetHeight = getSheetHeight()
      const featureHeight = collapsedFeature
        ? MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT
        : Math.min(
            visibleFeatureHeight ?? MOBILE_FEATURE_CARD_COMPACT_HEIGHT,
            Math.max(
              160,
              (workspace?.placement === 'container'
                ? (rootRef.current?.clientHeight ?? window.innerHeight)
                : window.innerHeight) - 104,
            ),
          )
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
    },
    [
      applyTransform,
      getFullSnapOffset,
      getSheetHeight,
      mobileCollapsedVisibleHeight,
      updateMobileSheetState,
      workspace?.placement,
      isMobile,
    ],
  )

  const stackControlsOverFeatureCard = useCallback(
    (collapsedFeature = false, visibleFeatureHeight?: number) => {
      if (!isMobile) return
      const sheetHeight = getSheetHeight()
      const featureHeight = collapsedFeature
        ? MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT
        : Math.min(
            visibleFeatureHeight ?? MOBILE_FEATURE_CARD_COMPACT_HEIGHT,
            Math.max(
              160,
              (workspace?.placement === 'container'
                ? (rootRef.current?.clientHeight ?? window.innerHeight)
                : window.innerHeight) - 104,
            ),
          )
      const snaps = getSnapPositions(sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight)
      const y = Math.max(snaps.full, Math.min(snaps.collapsed, sheetHeight - featureHeight))
      suppressScrim.current = true
      updateMobileSheetState(stateFromTranslate(y, sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight))
      applyTransform(y, true)
      if (scrimRef.current) {
        scrimRef.current.style.opacity = '0'
        scrimRef.current.style.pointerEvents = 'none'
      }
    },
    [
      applyTransform,
      getFullSnapOffset,
      getSheetHeight,
      mobileCollapsedVisibleHeight,
      updateMobileSheetState,
      workspace?.placement,
      isMobile,
    ],
  )

  const bringControlsToFront = useCallback(() => {
    if (!isMobile) return
    setMobileControlsInFront(true)
    suppressScrim.current = true
    interactions.dispatchEvent(new CustomEvent(MOBILE_MAP_CONTROLS_FRONT_EVENT))
    stackControlsOverFeatureCard(false)
  }, [interactions, stackControlsOverFeatureCard, isMobile])

  const bringFeatureCardToFront = useCallback(() => {
    if (!isMobile) return
    setMobileControlsInFront(false)
    interactions.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_FRONT_EVENT))
    stackBehindFeatureCard(false)
  }, [interactions, stackBehindFeatureCard, isMobile])

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const openSearch = (event: Event) => {
      const selector = 'input[data-map-search-input="true"]'
      const leftInput = contentRef.current?.querySelector<HTMLInputElement>(selector)
      const rightInput = rightSidebarRef.current?.querySelector<HTMLInputElement>(selector)
      const input = leftInput ?? rightInput
      if (!input || disableSidebar || (isMobile && suppressMobileSheet)) return
      event.preventDefault()
      searchTargetRef.current = input
      if (isMobile) {
        setMobileControlsInFront(true)
        interactions.dispatchEvent(new CustomEvent(MOBILE_MAP_CONTROLS_FRONT_EVENT))
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
  }, [
    applyTransform,
    disableSidebar,
    getFullSnapOffset,
    interactions,
    onToggleDesktopRightSidebar,
    onToggleDesktopSidebar,
    showDesktopRightSidebar,
    showDesktopSidebar,
    suppressMobileSheet,
    updateMobileSheetState,
    isMobile,
  ])

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
    const revealFocused = () => {
      if (document.activeElement === input) reveal()
    }
    window.visualViewport?.addEventListener('resize', revealFocused)
    return () => window.visualViewport?.removeEventListener('resize', revealFocused)
  }, [searchRequest])

  useEffect(() => {
    if (!isMobile) return
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
  }, [
    applyTransform,
    getFullSnapOffset,
    getSheetHeight,
    mobileCollapsedVisibleHeight,
    mobileSnapFromVisibleHeight,
    mobileSnapKey,
    mobileSnapTo,
    mobileSnapVisibleHeight,
    snapTo,
    updateMobileSheetState,
    isMobile,
  ])

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
    if (isMobile) {
      const y = getSnapPositions(getSheetHeight(), getFullSnapOffset(), mobileCollapsedVisibleHeight)[
        mobileInitialSheetState
      ]
      if (sheetRef.current) {
        sheetRef.current.style.transform = `translateY(${y}px)`
        sheetRef.current.style.transition = 'none'
      }
      translateRef.current = y
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
      if (!isMobile) {
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
      } else if (!draggingRef.current) {
        const sheetHeight = getSheetHeight()
        // Desktop has no translateY. Preserve the logical mobile snap when
        // crossing a breakpoint rather than interpreting that zero as "full".
        applyTransform(
          getSnapPositions(sheetHeight, getFullSnapOffset(), mobileCollapsedVisibleHeight)[mobileSheetStateRef.current],
          false,
        )
      }
    }
    onResize()
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
  }, [applyTransform, getFullSnapOffset, getSheetHeight, mobileCollapsedVisibleHeight, isMobile])

  const {
    handleScrimClick,
    handleMobileSheetKeyDown,
    startHandlePointerDrag,
    moveHandlePointerDrag,
    endHandlePointerDrag,
  } = useMobileSheetGestures({
    sheetRef,
    handleRef,
    draggingRef,
    translateRef,
    mobileFeatureCardOpen,
    mobileControlsInFront,
    bringControlsToFront,
    applyTransform,
    getFullSnapOffset,
    getSheetHeight,
    mobileCollapsedVisibleHeight,
    snapTo,
    mobileSheetState,
    isMobile,
  })

  useEffect(() => {
    const collapse = () => {
      if (!isMobile) return
      setMobileControlsInFront(false)
      snapTo('collapsed')
    }
    const collapseForMapInteraction = () => {
      if (!isMobile) return
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
      if (!isMobile || !(event instanceof CustomEvent)) return
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
    interactions.addEventListener(MOBILE_MAP_INTERACTION_EVENT, collapseForMapInteraction)
    interactions.addEventListener(MOBILE_MAP_SHEET_COLLAPSE_EVENT, collapse)
    interactions.addEventListener(MOBILE_MAP_SHEET_STACK_EVENT, stack)
    interactions.addEventListener(MOBILE_FEATURE_CARD_COLLAPSE_STATE_EVENT, handleFeatureCollapseState)
    interactions.addEventListener(MOBILE_FEATURE_CARD_DOCK_EVENT, handleFeatureDock)
    interactions.addEventListener(MOBILE_FEATURE_CARD_OPEN_EVENT, handleFeatureOpen)
    interactions.addEventListener(MOBILE_FEATURE_CARD_CLOSE_EVENT, handleFeatureClose)
    interactions.addEventListener(MOBILE_FEATURE_CARD_PEEK_EVENT, handleFeaturePeek)
    return () => {
      interactions.removeEventListener(MOBILE_MAP_INTERACTION_EVENT, collapseForMapInteraction)
      interactions.removeEventListener(MOBILE_MAP_SHEET_COLLAPSE_EVENT, collapse)
      interactions.removeEventListener(MOBILE_MAP_SHEET_STACK_EVENT, stack)
      interactions.removeEventListener(MOBILE_FEATURE_CARD_COLLAPSE_STATE_EVENT, handleFeatureCollapseState)
      interactions.removeEventListener(MOBILE_FEATURE_CARD_DOCK_EVENT, handleFeatureDock)
      interactions.removeEventListener(MOBILE_FEATURE_CARD_OPEN_EVENT, handleFeatureOpen)
      interactions.removeEventListener(MOBILE_FEATURE_CARD_CLOSE_EVENT, handleFeatureClose)
      interactions.removeEventListener(MOBILE_FEATURE_CARD_PEEK_EVENT, handleFeaturePeek)
    }
  }, [
    bringControlsToFront,
    interactions,
    mobileControlsInFront,
    snapTo,
    stackBehindFeatureCard,
    stackControlsOverFeatureCard,
    isMobile,
  ])

  return {
    rootRef,
    sheetRef,
    handleRef,
    contentRef,
    scrimRef,
    rightSidebarRef,
    mobileSheetState,
    mobileControlsInFront,
    mobileFeatureCardOpen,
    mobileFeaturePeek,
    bringFeatureCardToFront,
    bringControlsToFront,
    snapTo,
    handleScrimClick,
    handleMobileSheetKeyDown,
    startHandlePointerDrag,
    moveHandlePointerDrag,
    endHandlePointerDrag,
  }
}
