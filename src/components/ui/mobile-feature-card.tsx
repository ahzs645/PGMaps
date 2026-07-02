import { ChevronDown, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { MAP_OVERLAY_Z } from './map-overlay'
import { MOBILE_MEDIA_QUERY } from '@/hooks/useIsMobile'

export const MOBILE_FEATURE_CARD_MEDIA_QUERY = MOBILE_MEDIA_QUERY
export const MOBILE_FEATURE_CARD_HEIGHT = 720
export const MOBILE_FEATURE_CARD_COMPACT_HEIGHT = 300
export const MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT = 92
export const MOBILE_MAP_INTERACTION_EVENT = 'pgmaps:mobile-map-interaction'
export const MOBILE_MAP_BLANK_CLICK_EVENT = 'pgmaps:mobile-map-blank-click'
export const MOBILE_MAP_FEATURE_CLICK_EVENT = 'pgmaps:mobile-map-feature-click'
export const MOBILE_MAP_SHEET_COLLAPSE_EVENT = 'pgmaps:collapse-mobile-map-sheet'
export const MOBILE_MAP_SHEET_STACK_EVENT = 'pgmaps:stack-mobile-map-sheet'
export const MOBILE_MAP_CONTROLS_FRONT_EVENT = 'pgmaps:mobile-map-controls-front'
export const MOBILE_MAP_CONTROLS_VISIBLE_HEIGHT_EVENT = 'pgmaps:mobile-map-controls-visible-height'
export const MOBILE_FEATURE_CARD_DOCK_EVENT = 'pgmaps:mobile-feature-card-dock'
export const MOBILE_FEATURE_CARD_FRONT_EVENT = 'pgmaps:mobile-feature-card-front'
export const MOBILE_FEATURE_CARD_PEEK_EVENT = 'pgmaps:mobile-feature-card-peek'
export const MOBILE_FEATURE_CARD_OPEN_EVENT = 'pgmaps:mobile-feature-card-open'
export const MOBILE_FEATURE_CARD_CLOSE_EVENT = 'pgmaps:mobile-feature-card-close'
export const MOBILE_FEATURE_CARD_COLLAPSE_STATE_EVENT = 'pgmaps:mobile-feature-card-collapse-state'

export function MobileFeatureCard({
  title,
  subtitle,
  children,
  className,
  cardKey,
  contentClassName,
  height = MOBILE_FEATURE_CARD_HEIGHT,
  initialVisibleHeight = MOBILE_FEATURE_CARD_COMPACT_HEIGHT,
  collapseOnMapInteraction = true,
  closeOnBlankMapClick = true,
  showDockAction = true,
  onClose,
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  className?: string
  cardKey?: string | number
  contentClassName?: string
  height?: number
  initialVisibleHeight?: number
  collapseOnMapInteraction?: boolean
  closeOnBlankMapClick?: boolean
  showDockAction?: boolean
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(initialVisibleHeight >= height)
  const [controlsInFront, setControlsInFront] = useState(false)
  const [controlsVisibleHeight, setControlsVisibleHeight] = useState<number | null>(null)
  const [hasDockTarget, setHasDockTarget] = useState(false)
  const dragStartY = useRef<number | null>(null)
  const dragMovedRef = useRef(false)
  const lastGestureAtRef = useRef(0)

  const titleText = typeof title === 'string' ? title : undefined
  const subtitleText = typeof subtitle === 'string' ? subtitle : undefined
  const canDockBehindControls = showDockAction && hasDockTarget

  useEffect(() => {
    const syncDockTarget = () => {
      const sheet = document.querySelector<HTMLElement>('[data-map-mobile-sheet="true"]')
      const wrapper = sheet?.closest<HTMLElement>('[data-map-sidebar-wrapper="true"]')
      const target = wrapper ?? sheet
      if (!target) {
        setHasDockTarget(false)
        return
      }
      setHasDockTarget(window.getComputedStyle(target).display !== 'none')
    }

    syncDockTarget()
    window.addEventListener('resize', syncDockTarget)
    return () => window.removeEventListener('resize', syncDockTarget)
  }, [])

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(MOBILE_MAP_SHEET_STACK_EVENT))
    window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_OPEN_EVENT))
    const frame = requestAnimationFrame(() => {
      setCollapsed(false)
      setExpanded(initialVisibleHeight >= height)
      setOpen(true)
    })
    return () => {
      cancelAnimationFrame(frame)
      window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_CLOSE_EVENT))
    }
  }, [height, initialVisibleHeight])

  useEffect(() => {
    const sendBehind = () => {
      setCollapsed(false)
      setExpanded(false)
      setControlsInFront(true)
    }
    const bringFront = () => {
      setControlsInFront(false)
      setControlsVisibleHeight(null)
      window.dispatchEvent(new CustomEvent(MOBILE_MAP_SHEET_STACK_EVENT))
    }
    const syncControlsHeight = (event: Event) => {
      if (!(event instanceof CustomEvent)) return
      const visibleHeight = event.detail?.visibleHeight
      if (typeof visibleHeight === 'number') {
        setControlsVisibleHeight(visibleHeight)
      }
    }
    window.addEventListener(MOBILE_MAP_CONTROLS_FRONT_EVENT, sendBehind)
    window.addEventListener(MOBILE_MAP_CONTROLS_VISIBLE_HEIGHT_EVENT, syncControlsHeight)
    window.addEventListener(MOBILE_FEATURE_CARD_FRONT_EVENT, bringFront)
    return () => {
      window.removeEventListener(MOBILE_MAP_CONTROLS_FRONT_EVENT, sendBehind)
      window.removeEventListener(MOBILE_MAP_CONTROLS_VISIBLE_HEIGHT_EVENT, syncControlsHeight)
      window.removeEventListener(MOBILE_FEATURE_CARD_FRONT_EVENT, bringFront)
    }
  }, [])

  useEffect(() => {
    if (!collapseOnMapInteraction) return

    const collapse = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.type === 'gesture') {
        lastGestureAtRef.current = Date.now()
        window.dispatchEvent(new CustomEvent(MOBILE_MAP_SHEET_COLLAPSE_EVENT))
      }
      setCollapsed(true)
    }
    window.addEventListener(MOBILE_MAP_INTERACTION_EVENT, collapse)
    return () => window.removeEventListener(MOBILE_MAP_INTERACTION_EVENT, collapse)
  }, [collapseOnMapInteraction])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      setCollapsed(false)
      setExpanded(initialVisibleHeight >= height)
    })
    window.dispatchEvent(new CustomEvent(MOBILE_MAP_SHEET_STACK_EVENT))
    window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_PEEK_EVENT, {
      detail: { title: titleText, subtitle: subtitleText },
    }))
    return () => cancelAnimationFrame(frame)
  }, [cardKey, height, initialVisibleHeight, open, subtitleText, titleText])

  useEffect(() => {
    if (!open) return
    const visibleCardHeight = collapsed
      ? MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT
      : controlsInFront && controlsVisibleHeight != null
        ? Math.max(MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT, Math.min(height, controlsVisibleHeight))
        : expanded ? height : initialVisibleHeight
    window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_COLLAPSE_STATE_EVENT, {
      detail: { collapsed, visibleHeight: visibleCardHeight },
    }))
  }, [collapsed, controlsInFront, controlsVisibleHeight, expanded, height, initialVisibleHeight, open])

  const closeWithAnimation = useCallback(() => {
    setOpen(false)
    window.dispatchEvent(new CustomEvent(MOBILE_MAP_SHEET_COLLAPSE_EVENT))
    window.setTimeout(onClose, 240)
  }, [onClose])

  useEffect(() => {
    if (!closeOnBlankMapClick) return

    const closeOnBlankClick = () => {
      if (Date.now() - lastGestureAtRef.current < 450) return
      closeWithAnimation()
    }

    window.addEventListener(MOBILE_MAP_BLANK_CLICK_EVENT, closeOnBlankClick)
    return () => window.removeEventListener(MOBILE_MAP_BLANK_CLICK_EVENT, closeOnBlankClick)
  }, [closeOnBlankMapClick, closeWithAnimation])

  const handleDragStart = useCallback((clientY: number) => {
    dragStartY.current = clientY
    dragMovedRef.current = false
  }, [])

  const handleDragMove = useCallback((clientY: number) => {
    if (dragStartY.current === null) return
    const deltaY = clientY - dragStartY.current
    if (collapsed && deltaY < -24) {
      dragStartY.current = null
      dragMovedRef.current = true
      setCollapsed(false)
      setExpanded(false)
      return
    }
    if (!collapsed && !expanded && deltaY < -24) {
      dragStartY.current = null
      dragMovedRef.current = true
      setExpanded(true)
      return
    }
    if (expanded && deltaY > 24) {
      dragStartY.current = null
      dragMovedRef.current = true
      setExpanded(false)
      return
    }
    if (!collapsed && !expanded && deltaY > 24) {
      dragStartY.current = null
      dragMovedRef.current = true
      setCollapsed(true)
    }
  }, [collapsed, expanded])

  const handleDragEnd = useCallback(() => {
    dragStartY.current = null
  }, [])

  const startMouseDrag = useCallback((clientY: number) => {
    handleDragStart(clientY)

    const handleWindowMouseMove = (event: MouseEvent) => {
      event.preventDefault()
      handleDragMove(event.clientY)
    }
    const handleWindowMouseUp = () => {
      handleDragEnd()
      window.removeEventListener('mousemove', handleWindowMouseMove)
      window.removeEventListener('mouseup', handleWindowMouseUp)
    }

    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
  }, [handleDragEnd, handleDragMove, handleDragStart])

  const startTouchDrag = useCallback((clientY: number) => {
    handleDragStart(clientY)

    const handleWindowTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      event.preventDefault()
      handleDragMove(touch.clientY)
    }
    const handleWindowTouchEnd = () => {
      handleDragEnd()
      window.removeEventListener('touchmove', handleWindowTouchMove)
      window.removeEventListener('touchend', handleWindowTouchEnd)
      window.removeEventListener('touchcancel', handleWindowTouchEnd)
    }

    window.addEventListener('touchmove', handleWindowTouchMove, { passive: false })
    window.addEventListener('touchend', handleWindowTouchEnd)
    window.addEventListener('touchcancel', handleWindowTouchEnd)
  }, [handleDragEnd, handleDragMove, handleDragStart])

  const dockBehindControls = useCallback(() => {
    if (!canDockBehindControls) return
    setCollapsed(false)
    setExpanded(false)
    setControlsVisibleHeight(null)
    window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_DOCK_EVENT))
  }, [canDockBehindControls])

  const handleDockClick = useCallback(() => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }
    dockBehindControls()
  }, [dockBehindControls])

  const handleHandleClick = useCallback(() => {
    if (dragMovedRef.current) {
      dragMovedRef.current = false
      return
    }
    if (collapsed) {
      setCollapsed(false)
      setExpanded(false)
      return
    }
    setExpanded((current) => !current)
  }, [collapsed])

  const visibleCardHeight = collapsed
    ? MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT
    : controlsInFront && controlsVisibleHeight != null
      ? Math.max(MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT, Math.min(height, controlsVisibleHeight))
      : expanded ? height : initialVisibleHeight

  return (
    <div
      className={cn('pointer-events-none fixed inset-0 md:hidden', controlsInFront ? MAP_OVERLAY_Z.passiveOverlay : MAP_OVERLAY_Z.activeOverlay)}
      aria-label="Selected feature"
    >
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 pointer-events-none grid transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
        style={{
          height: `min(${height}px, calc(100dvh - 4.75rem))`,
          bottom: 0,
        }}
      >
        <div
          role="dialog"
          className={cn(
            'pointer-events-auto col-start-1 row-start-1 flex self-end flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)] transition-[height,transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            controlsInFront && 'pointer-events-none -translate-y-1.5 shadow-[0_-3px_14px_rgba(0,0,0,0.24)]',
            controlsInFront && !collapsed && expanded && 'h-full',
            !controlsInFront && (collapsed ? 'translate-y-0' : expanded ? 'h-full translate-y-2' : 'translate-y-2'),
            className,
          )}
          style={collapsed || controlsInFront || !expanded ? {
            alignSelf: 'end',
            height: expanded && !collapsed && !controlsInFront ? undefined : `min(${visibleCardHeight}px, 100%)`,
          } : undefined}
        >
          <div
            className="flex cursor-grab touch-none justify-center py-2 active:cursor-grabbing"
            aria-hidden="true"
            onClick={handleHandleClick}
            onMouseDown={(event) => startMouseDrag(event.clientY)}
            onTouchStart={(event) => {
              const touch = event.touches[0]
              if (touch) startTouchDrag(touch.clientY)
            }}
          >
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <header
            className="cursor-grab border-b border-border px-4 pb-3 active:cursor-grabbing"
            onMouseDown={(event) => {
              if ((event.target as HTMLElement).closest('[data-mobile-feature-card-action="true"]')) return
              startMouseDrag(event.clientY)
            }}
            onTouchStart={(event) => {
              if ((event.target as HTMLElement).closest('[data-mobile-feature-card-action="true"]')) return
              const touch = event.touches[0]
              if (touch) startTouchDrag(touch.clientY)
            }}
          >
            <div className="flex items-start justify-between gap-3">
              {canDockBehindControls ? (
                <button
                  type="button"
                  className="group min-w-0 flex-1 rounded-md py-0.5 pr-1 text-left hover:bg-muted/60"
                  onClick={handleDockClick}
                  aria-label="Dock selected feature behind map controls"
                >
                  <div className="truncate text-base font-semibold leading-tight text-foreground">
                    {title}
                  </div>
                  {subtitle ? (
                    <div className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
                      {subtitle}
                    </div>
                  ) : null}
                </button>
              ) : (
                <div className="min-w-0 flex-1 py-0.5 pr-1 text-left">
                  <div className="truncate text-base font-semibold leading-tight text-foreground">
                    {title}
                  </div>
                  {subtitle ? (
                    <div className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
                      {subtitle}
                    </div>
                  ) : null}
                </div>
              )}
              {canDockBehindControls ? (
                <button
                  type="button"
                  className="shrink-0 rounded-md p-2 hover:bg-muted"
                  aria-label="Dock selected feature behind map controls"
                  data-mobile-feature-card-action="true"
                  onClick={dockBehindControls}
                >
                  <ChevronDown className="size-4" />
                </button>
              ) : null}
              <button type="button" className="shrink-0 rounded-md p-2 hover:bg-muted" aria-label="Close feature card" data-mobile-feature-card-action="true" onClick={closeWithAnimation}>
                <X className="size-4" />
              </button>
            </div>
          </header>
          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] transition-opacity duration-300',
              collapsed ? 'pointer-events-none opacity-0' : 'opacity-100',
              contentClassName,
            )}
            aria-hidden={collapsed}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
