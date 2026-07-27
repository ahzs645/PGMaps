import { ChevronDown, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { MOBILE_CARD_STACK_PEEK, useMobileCardStack } from '@/components/ui/mobile-card-stack'
import { cn } from '@/lib/utils'

type MobileMapCardState = 'frontExpanded' | 'frontCollapsed' | 'behindExpanded' | 'behindCollapsed'

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
  const [open, setOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const titleId = `${id}-title`
  const { depth, isFront, hasCardsBehind, bringToFront } = useMobileCardStack(id, open)
  /** Behind another card rather than behind the controls sheet. */
  const stackedBehind = !isFront && !controlsInFront
  /** Front card of a stack sits flush, so only the thin edge of the card behind shows. */
  const coversStack = isFront && hasCardsBehind && !controlsInFront

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const closeWithAnimation = useCallback(() => {
    setOpen(false)
    window.setTimeout(onClose, 240)
  }, [onClose])

  return (
    <div
      id={id}
      aria-label={ariaLabel}
      data-modal="false"
      data-sheet-open-state={open ? 'open' : 'closed'}
      data-sheet-detent={collapsed ? 'collapsed' : 'default'}
      className={cn('pointer-events-none fixed inset-0 md:hidden', controlsInFront && 'z-20')}
      style={controlsInFront ? undefined : { zIndex: 50 - depth }}
    >
      <MobileMapCardDragArea
        cardRef={cardRef}
        collapsed={collapsed}
        onExpand={onExpand}
        onCollapse={onCollapse}
        className={cn(
          'absolute inset-x-0 bottom-0 pointer-events-none grid h-[min(360px,calc(100dvh_-_6.5rem))] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <MobileMapCardShell
          titleId={titleId}
          title={title}
          subtitle={subtitle}
          cardRef={cardRef}
          collapsed={collapsed}
          controlsInFront={controlsInFront}
          stackedBehind={stackedBehind}
          coversStack={coversStack}
          stackOffset={stackedBehind ? MOBILE_CARD_STACK_PEEK * depth : 0}
          onBringToFront={bringToFront}
          onDock={onDock}
          onClose={closeWithAnimation}
          actions={actions}
        >
          {children}
        </MobileMapCardShell>
      </MobileMapCardDragArea>
    </div>
  )
}

function MobileMapCardDragArea({
  cardRef,
  collapsed,
  className,
  onExpand,
  onCollapse,
  children,
}: {
  cardRef: RefObject<HTMLDivElement>
  collapsed: boolean
  className?: string
  onExpand?: () => void
  onCollapse?: () => void
  children: ReactNode
}) {
  const dragStartY = useRef<number | null>(null)

  const handleDragStart = useCallback((clientY: number) => {
    if (!onExpand && !onCollapse) return
    dragStartY.current = clientY
  }, [onCollapse, onExpand])

  const handleDragMove = useCallback((clientY: number) => {
    if (dragStartY.current === null) return
    const deltaY = clientY - dragStartY.current
    if (collapsed && deltaY < -24 && onExpand) {
      dragStartY.current = null
      onExpand()
      return
    }
    if (!collapsed && deltaY > 24 && onCollapse) {
      dragStartY.current = null
      onCollapse()
    }
  }, [collapsed, onCollapse, onExpand])

  const handleDragEnd = useCallback(() => {
    dragStartY.current = null
  }, [])

  useEffect(() => {
    const card = cardRef.current
    if (!card) return

    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (touch) handleDragStart(touch.clientY)
    }
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (touch) handleDragMove(touch.clientY)
    }
    const handleMouseDown = (event: MouseEvent) => {
      handleDragStart(event.clientY)
    }
    const handleMouseMove = (event: MouseEvent) => {
      handleDragMove(event.clientY)
    }

    card.addEventListener('touchstart', handleTouchStart, { passive: true })
    card.addEventListener('touchmove', handleTouchMove, { passive: true })
    card.addEventListener('touchend', handleDragEnd)
    card.addEventListener('touchcancel', handleDragEnd)
    card.addEventListener('mousedown', handleMouseDown)
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleDragEnd)
    return () => {
      card.removeEventListener('touchstart', handleTouchStart)
      card.removeEventListener('touchmove', handleTouchMove)
      card.removeEventListener('touchend', handleDragEnd)
      card.removeEventListener('touchcancel', handleDragEnd)
      card.removeEventListener('mousedown', handleMouseDown)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleDragEnd)
    }
  }, [cardRef, handleDragEnd, handleDragMove, handleDragStart])

  return <div className={className}>{children}</div>
}

function MobileMapCardShell({
  titleId,
  title,
  subtitle,
  cardRef,
  collapsed,
  controlsInFront,
  stackedBehind,
  coversStack,
  stackOffset,
  onBringToFront,
  onDock,
  onClose,
  actions,
  children,
}: {
  titleId: string
  title: ReactNode
  subtitle?: ReactNode
  cardRef: RefObject<HTMLDivElement>
  collapsed: boolean
  controlsInFront: boolean
  stackedBehind: boolean
  coversStack: boolean
  stackOffset: number
  onBringToFront: () => void
  onDock?: () => void
  onClose: () => void
  actions?: ReactNode
  children: ReactNode
}) {
  const cardState: MobileMapCardState = controlsInFront
    ? (collapsed ? 'behindCollapsed' : 'behindExpanded')
    : (collapsed ? 'frontCollapsed' : 'frontExpanded')
  const cardStateClasses: Record<MobileMapCardState, string> = {
    frontExpanded: cn('pointer-events-auto h-full self-end', coversStack ? 'translate-y-0' : 'translate-y-2'),
    frontCollapsed: 'pointer-events-auto h-[92px] self-end translate-y-0',
    behindExpanded: 'pointer-events-none h-full self-end -translate-y-1.5',
    behindCollapsed: 'pointer-events-none h-[92px] self-end -translate-y-1.5 shadow-[0_-3px_14px_rgba(0,0,0,0.24)]',
  }
  const contentHidden = collapsed || stackedBehind

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      ref={cardRef}
      className={cn(
        'col-start-1 row-start-1 flex flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)] transition-[height,transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        // A card behind another keeps pointer events so its exposed top edge can
        // be tapped to bring it forward.
        stackedBehind
          ? 'pointer-events-auto h-full self-end shadow-[0_-3px_14px_rgba(0,0,0,0.24)]'
          : cardStateClasses[cardState],
      )}
      style={stackedBehind ? { transform: `translateY(-${stackOffset}px)` } : undefined}
    >
      <SheetHandle onClick={stackedBehind ? onBringToFront : undefined} />
      <header className="border-b border-border px-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          {stackedBehind ? (
            <button type="button" className="group flex min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 text-left hover:bg-muted/60" onClick={onBringToFront} aria-label="Bring card to front">
              <span id={titleId} className="block truncate text-base font-semibold text-foreground">{title}</span>
            </button>
          ) : (
            <button type="button" className="group flex min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 text-left hover:bg-muted/60" onClick={onDock} disabled={!onDock} aria-label="Dock card above map controls">
              <span id={titleId} className="block truncate text-base font-semibold text-foreground">{title}</span>
              {onDock && <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />}
            </button>
          )}
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            <button type="button" className="rounded-md p-2 hover:bg-muted" onClick={onClose} aria-label="Close card">
              <X className="size-4" />
            </button>
          </div>
        </div>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </header>
      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] transition-opacity duration-300', contentHidden ? 'pointer-events-none opacity-0' : 'opacity-100')} aria-hidden={contentHidden}>
        {children}
      </div>
    </div>
  )
}

function SheetHandle({ onClick }: { onClick?: () => void }) {
  return (
    <div className="flex justify-center py-2" aria-hidden="true" onClick={onClick}>
      <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
    </div>
  )
}
