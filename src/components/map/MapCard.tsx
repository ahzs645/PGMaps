import { ChevronDown, X } from 'lucide-react'
import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MOTION_DURATION, MOTION_EASING, useMotionPresence, useReducedMotion } from '@pgmaps/geo-toolkit/ui/motion'
import { useFeatureCardGestures } from '@pgmaps/geo-toolkit/ui/useFeatureCardGestures'
import type { MobileSheetState } from '@pgmaps/geo-toolkit/workspace/sheet-math'
import { useWorkspace } from '@pgmaps/geo-toolkit/workspace/workspace-context'
import { MOBILE_CARD_STACK_PEEK, useMobileCardStack } from '@/components/ui/mobile-card-stack'
import { useIsMobile } from '@/hooks/useIsMobile'
import { cn } from '@/lib/utils'

export function MobileMapCard({
  id,
  title,
  subtitle,
  ariaLabel,
  collapsed,
  controlsInFront,
  onExpand,
  onCollapse,
  onDock,
  onClose,
  actions,
  children,
}: {
  id: string
  title: ReactNode
  subtitle?: ReactNode
  ariaLabel: string
  collapsed: boolean
  controlsInFront: boolean
  onExpand?: () => void
  onCollapse?: () => void
  onDock?: () => void
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  const workspace = useWorkspace()
  const isMobile = useIsMobile()
  const reducedMotion = useReducedMotion()
  const [open, setOpen] = useState(true)
  const [frameHeight, setFrameHeight] = useState(360)
  const presence = useMotionPresence(open && isMobile)
  const frameRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<HTMLDivElement>(null)
  const actionsRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)
  const closingRef = useRef(false)
  const movedRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const { depth, isFront, hasCardsBehind, bringToFront } = useMobileCardStack(id, open && isMobile)
  const stackedBehind = !isFront && !controlsInFront
  const coversStack = isFront && hasCardsBehind && !controlsInFront
  const cardTransform = stackedBehind
    ? `translateY(-${MOBILE_CARD_STACK_PEEK * depth}px)`
    : controlsInFront
      ? 'translateY(-6px)'
      : collapsed || coversStack
        ? 'translateY(0)'
        : 'translateY(8px)'
  const bodyHidden = collapsed || stackedBehind || controlsInFront || !open
  const transition = reducedMotion
    ? 'none'
    : `height ${MOTION_DURATION.panel}ms ${MOTION_EASING}, transform ${MOTION_DURATION.panel}ms ${MOTION_EASING}, opacity ${MOTION_DURATION.feedback}ms ${MOTION_EASING}`
  // This adapter has two controlled states; both expanded detents use its full height.
  const heights = useMemo(
    () => ({ collapsed: Math.min(92, frameHeight), half: frameHeight, full: frameHeight }),
    [frameHeight],
  )

  useLayoutEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useLayoutEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }, [])

  // A newly selected feature reverses the exit before it can clear that selection.
  useLayoutEffect(() => {
    closingRef.current = false
    // eslint-disable-next-line react-hooks/set-state-in-effect -- A new selection must reverse the pending exit before onClose runs.
    setOpen(true)
  }, [id, title, subtitle])

  const restoreFocus = useCallback(() => {
    const opener = openerRef.current
    if (opener?.isConnected && !opener.closest('[inert]') && opener.getClientRects().length) {
      opener.focus({ preventScroll: true })
    } else {
      workspace?.root
        ?.querySelector<HTMLElement>('[data-map-mobile-sheet-handle="true"]')
        ?.focus({ preventScroll: true })
      if (cardRef.current?.contains(document.activeElement) && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }
    }
  }, [workspace?.root])

  const closeWithAnimation = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    if (cardRef.current?.contains(document.activeElement)) restoreFocus()
    setOpen(false)
  }, [restoreFocus])

  useLayoutEffect(() => {
    if (!open && !presence.present && closingRef.current) {
      closingRef.current = false
      onCloseRef.current()
    }
  }, [open, presence.present])

  useLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame || !isMobile) return
    const measure = () => setFrameHeight(frame.clientHeight || 360)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [isMobile, presence.present])

  const applyHeight = useCallback(
    (height: number, animate: boolean) => {
      const card = cardRef.current
      if (!card) return
      card.style.transition = animate ? transition : 'none'
      card.style.height = `${height}px`
      card.dataset.mapTargetVisibleHeight = String(height)
      if (animate) card.style.transform = cardTransform
    },
    [cardTransform, transition],
  )

  const snapCard = useCallback(
    (state: MobileSheetState) => {
      if (state === 'collapsed' && onCollapse) {
        applyHeight(heights.collapsed, true)
        onCollapse()
      } else if (state !== 'collapsed' && onExpand) {
        applyHeight(heights.full, true)
        onExpand()
      } else applyHeight(collapsed ? heights.collapsed : heights.full, true)
    },
    [applyHeight, collapsed, heights, onCollapse, onExpand],
  )

  const { cancelGesture, ...gestures } = useFeatureCardGestures({
    panelRef: cardRef,
    heights,
    disabled: !open || controlsInFront || (!onExpand && !onCollapse),
    movedRef,
    onBringToFront: bringToFront,
    onHeightChange: applyHeight,
    onSnap: snapCard,
  })

  useLayoutEffect(() => {
    if (!open || !isMobile || controlsInFront) cancelGesture()
  }, [cancelGesture, controlsInFront, isMobile, open])

  useLayoutEffect(() => {
    if (cardRef.current?.dataset.featureCardDragging !== 'true') {
      applyHeight(collapsed ? heights.collapsed : heights.full, true)
    }
  }, [applyHeight, collapsed, heights, presence.present])

  useLayoutEffect(() => {
    const card = cardRef.current
    const body = bodyRef.current
    if (!card || !body) return
    if (
      (bodyHidden && body.contains(document.activeElement)) ||
      (controlsInFront && card.contains(document.activeElement))
    ) {
      const target = controlsInFront
        ? workspace?.root?.querySelector<HTMLElement>('[data-map-mobile-sheet-handle="true"]')
        : handleRef.current
      if (target) target.focus({ preventScroll: true })
      else restoreFocus()
    }
    card.inert = !open || controlsInFront
    body.inert = bodyHidden
    if (actionsRef.current) actionsRef.current.inert = stackedBehind || !open || controlsInFront
  }, [bodyHidden, controlsInFront, open, presence.present, restoreFocus, stackedBehind, workspace?.root])

  if (!isMobile || !presence.present) return null

  return (
    <div
      id={id}
      aria-label={ariaLabel}
      aria-hidden={!open || undefined}
      data-modal="false"
      data-sheet-open-state={open ? 'open' : 'closing'}
      data-sheet-detent={collapsed ? 'collapsed' : 'default'}
      className={cn('pointer-events-none fixed inset-0', controlsInFront && 'z-20')}
      style={controlsInFront ? undefined : { zIndex: 50 - depth }}
    >
      <div
        ref={frameRef}
        className="pointer-events-none absolute inset-x-0 bottom-0 grid h-[min(360px,calc(100dvh_-_6.5rem))]"
        style={{
          transform: presence.visible ? 'translateY(0)' : 'translateY(100%)',
          transition: reducedMotion ? 'none' : `transform ${MOTION_DURATION.panel}ms ${MOTION_EASING}`,
        }}
      >
        <div
          ref={cardRef}
          role="dialog"
          aria-labelledby={titleId}
          aria-modal="false"
          data-map-feature-card-panel="true"
          data-feature-card-state={!open ? 'closing' : presence.visible ? 'open' : 'opening'}
          data-map-target-visible-height={collapsed ? heights.collapsed : heights.full}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !event.defaultPrevented) {
              event.preventDefault()
              event.stopPropagation()
              closeWithAnimation()
            }
          }}
          className={cn(
            'col-start-1 row-start-1 flex self-end flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)]',
            controlsInFront ? 'pointer-events-none' : 'pointer-events-auto',
          )}
          style={{ height: collapsed ? heights.collapsed : heights.full, transform: cardTransform, transition }}
        >
          <div
            ref={handleRef}
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize feature card"
            aria-valuemin={0}
            aria-valuemax={1}
            aria-valuenow={collapsed ? 0 : 1}
            aria-valuetext={collapsed ? 'Collapsed' : 'Expanded'}
            tabIndex={0}
            className="flex cursor-grab touch-none justify-center py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            {...gestures}
            onClick={() => {
              if (movedRef.current) {
                movedRef.current = false
                return
              }
              if (stackedBehind) bringToFront()
              else snapCard(collapsed ? 'full' : 'collapsed')
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return
              let state: MobileSheetState | undefined
              if (event.key === 'ArrowUp' || event.key === 'End') state = 'full'
              if (event.key === 'ArrowDown' || event.key === 'Home') state = 'collapsed'
              if (event.key === 'Enter' || event.key === ' ') state = collapsed ? 'full' : 'collapsed'
              if (!state) return
              event.preventDefault()
              if (stackedBehind) bringToFront()
              snapCard(state)
            }}
          >
            <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
          </div>
          <header className="touch-none border-b border-border px-4 pb-3" {...gestures}>
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                className="group flex min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 text-left hover:bg-muted/60"
                onClick={stackedBehind ? bringToFront : onDock}
                disabled={!stackedBehind && !onDock}
                aria-label={stackedBehind ? 'Bring card to front' : 'Dock card above map controls'}
              >
                <span id={titleId} className="block truncate text-base font-semibold text-foreground">
                  {title}
                </span>
                {!stackedBehind && onDock && (
                  <ChevronDown
                    className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                    aria-hidden="true"
                  />
                )}
              </button>
              <div ref={actionsRef} className="flex shrink-0 items-center gap-1">
                {actions}
                <button
                  type="button"
                  className="rounded-md p-2 hover:bg-muted"
                  onClick={closeWithAnimation}
                  aria-label="Close card"
                >
                  <X className="size-4" />
                </button>
              </div>
            </div>
            {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          </header>
          <div
            ref={bodyRef}
            className={cn(
              'min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]',
              bodyHidden ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
            aria-hidden={bodyHidden}
            style={{ transition: reducedMotion ? 'none' : `opacity ${MOTION_DURATION.feedback}ms ${MOTION_EASING}` }}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
