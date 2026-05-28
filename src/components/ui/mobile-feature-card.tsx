import { ChevronDown, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const MOBILE_FEATURE_CARD_MEDIA_QUERY = '(max-width: 767px)'
export const MOBILE_FEATURE_CARD_HEIGHT = 360
export const MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT = 92
export const MOBILE_MAP_INTERACTION_EVENT = 'pgmaps:mobile-map-interaction'
export const MOBILE_MAP_BLANK_CLICK_EVENT = 'pgmaps:mobile-map-blank-click'
export const MOBILE_MAP_SHEET_COLLAPSE_EVENT = 'pgmaps:collapse-mobile-map-sheet'
export const MOBILE_MAP_SHEET_STACK_EVENT = 'pgmaps:stack-mobile-map-sheet'
export const MOBILE_MAP_CONTROLS_FRONT_EVENT = 'pgmaps:mobile-map-controls-front'
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
  collapseOnMapInteraction = true,
  closeOnBlankMapClick = true,
  onClose,
}: {
  title: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  className?: string
  cardKey?: string | number
  contentClassName?: string
  height?: number
  collapseOnMapInteraction?: boolean
  closeOnBlankMapClick?: boolean
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [controlsInFront, setControlsInFront] = useState(false)
  const dragStartY = useRef<number | null>(null)
  const lastGestureAtRef = useRef(0)

  const titleText = typeof title === 'string' ? title : undefined
  const subtitleText = typeof subtitle === 'string' ? subtitle : undefined

  useEffect(() => {
    window.dispatchEvent(new CustomEvent(MOBILE_MAP_SHEET_STACK_EVENT))
    window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_OPEN_EVENT))
    const frame = requestAnimationFrame(() => {
      setCollapsed(false)
      setOpen(true)
    })
    return () => {
      cancelAnimationFrame(frame)
      window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_CLOSE_EVENT))
    }
  }, [])

  useEffect(() => {
    const sendBehind = () => {
      setCollapsed(false)
      setControlsInFront(true)
    }
    const bringFront = () => {
      setControlsInFront(false)
      window.dispatchEvent(new CustomEvent(MOBILE_MAP_SHEET_STACK_EVENT))
    }
    window.addEventListener(MOBILE_MAP_CONTROLS_FRONT_EVENT, sendBehind)
    window.addEventListener(MOBILE_FEATURE_CARD_FRONT_EVENT, bringFront)
    return () => {
      window.removeEventListener(MOBILE_MAP_CONTROLS_FRONT_EVENT, sendBehind)
      window.removeEventListener(MOBILE_FEATURE_CARD_FRONT_EVENT, bringFront)
    }
  }, [])

  useEffect(() => {
    if (!collapseOnMapInteraction) return

    const collapse = (event: Event) => {
      if (event instanceof CustomEvent && event.detail?.type === 'gesture') {
        lastGestureAtRef.current = Date.now()
      }
      setCollapsed(true)
    }
    window.addEventListener(MOBILE_MAP_INTERACTION_EVENT, collapse)
    return () => window.removeEventListener(MOBILE_MAP_INTERACTION_EVENT, collapse)
  }, [collapseOnMapInteraction])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => setCollapsed(false))
    window.dispatchEvent(new CustomEvent(MOBILE_MAP_SHEET_STACK_EVENT))
    window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_PEEK_EVENT, {
      detail: { title: titleText, subtitle: subtitleText },
    }))
    return () => cancelAnimationFrame(frame)
  }, [cardKey, open, subtitleText, titleText])

  useEffect(() => {
    if (!open) return
    window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_COLLAPSE_STATE_EVENT, {
      detail: { collapsed },
    }))
  }, [collapsed, open])

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
  }, [])

  const handleDragMove = useCallback((clientY: number) => {
    if (dragStartY.current === null) return
    const deltaY = clientY - dragStartY.current
    if (collapsed && deltaY < -24) {
      dragStartY.current = null
      setCollapsed(false)
      return
    }
    if (!collapsed && deltaY > 24) {
      dragStartY.current = null
      setCollapsed(true)
    }
  }, [collapsed])

  const handleDragEnd = useCallback(() => {
    dragStartY.current = null
  }, [])

  const dockBehindControls = useCallback(() => {
    setCollapsed(false)
    window.dispatchEvent(new CustomEvent(MOBILE_FEATURE_CARD_DOCK_EVENT))
  }, [])

  return (
    <div
      className={cn('pointer-events-none fixed inset-0 md:hidden', controlsInFront ? 'z-20' : 'z-50')}
      aria-label="Selected feature"
    >
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 pointer-events-none grid transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
        style={{
          height: `min(${height}px, calc(100dvh - 6.5rem))`,
          bottom: 0,
        }}
      >
        <div
          role="dialog"
          className={cn(
            'pointer-events-auto col-start-1 row-start-1 flex self-end flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)] transition-[height,transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            controlsInFront && 'pointer-events-none -translate-y-1.5 shadow-[0_-3px_14px_rgba(0,0,0,0.24)]',
            controlsInFront && !collapsed && 'h-full',
            !controlsInFront && (collapsed ? 'translate-y-0' : 'h-full translate-y-2'),
            className,
          )}
          style={collapsed || controlsInFront ? { alignSelf: 'end', height: collapsed ? MOBILE_FEATURE_CARD_COLLAPSED_HEIGHT : undefined } : undefined}
        >
          <div
            className="flex cursor-grab touch-none justify-center py-2 active:cursor-grabbing"
            aria-hidden="true"
            onClick={() => setCollapsed((current) => !current)}
            onMouseDown={(event) => handleDragStart(event.clientY)}
            onMouseMove={(event) => handleDragMove(event.clientY)}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
            onTouchStart={(event) => {
              const touch = event.touches[0]
              if (touch) handleDragStart(touch.clientY)
            }}
            onTouchMove={(event) => {
              const touch = event.touches[0]
              if (touch) handleDragMove(touch.clientY)
            }}
            onTouchEnd={handleDragEnd}
            onTouchCancel={handleDragEnd}
          >
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <header className="border-b border-border px-4 pb-3">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                className="group min-w-0 flex-1 rounded-md py-0.5 pr-1 text-left hover:bg-muted/60"
                onClick={dockBehindControls}
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
              <button
                type="button"
                className="shrink-0 rounded-md p-2 hover:bg-muted"
                aria-label="Dock selected feature behind map controls"
                onClick={dockBehindControls}
              >
                <ChevronDown className="size-4" />
              </button>
              <button type="button" className="shrink-0 rounded-md p-2 hover:bg-muted" aria-label="Close feature card" onClick={closeWithAnimation}>
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
