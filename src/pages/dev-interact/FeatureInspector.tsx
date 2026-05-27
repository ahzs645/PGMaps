import { ChevronDown, MoreHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { FeatureActionsMenu } from './FeatureActionsMenu'
import { layerLabel } from './geo'
import { getOpenInUrl } from './openIn'
import type { FeatureAction, InteractFeature, OpenInTarget } from './types'

type FeatureCardState = 'frontExpanded' | 'frontCollapsed' | 'behindExpanded' | 'behindCollapsed'

export function MobileFeatureInspector({
  feature,
  openInPoint,
  openInEnabled,
  collapsed,
  controlsInFront,
  onFeatureAction,
  onExpand,
  onCollapse,
  onDock,
  onClose,
}: {
  feature: InteractFeature
  openInPoint: [number, number] | null
  openInEnabled: boolean
  collapsed: boolean
  controlsInFront: boolean
  onFeatureAction: (action: FeatureAction) => void
  onExpand: () => void
  onCollapse: () => void
  onDock: () => void
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  const dragStartY = useRef<number | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpen(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  const closeWithAnimation = useCallback(() => {
    setOpen(false)
    window.setTimeout(onClose, 240)
  }, [onClose])

  const openIn = useCallback((target: OpenInTarget) => {
    if (!openInPoint) return
    window.open(getOpenInUrl(target, openInPoint, feature), '_blank', 'noopener,noreferrer')
    setActionsOpen(false)
  }, [feature, openInPoint])

  const handleDragStart = useCallback((clientY: number) => {
    dragStartY.current = clientY
  }, [])

  const handleDragMove = useCallback((clientY: number) => {
    if (dragStartY.current === null) return
    const deltaY = clientY - dragStartY.current
    if (collapsed && deltaY < -24) {
      dragStartY.current = null
      onExpand()
      return
    }
    if (!collapsed && deltaY > 24) {
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
      if (!touch) return
      handleDragStart(touch.clientY)
    }
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0]
      if (!touch) return
      handleDragMove(touch.clientY)
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
  }, [handleDragEnd, handleDragMove, handleDragStart])

  return (
    <div
      id="feature-inspector"
      aria-label="Feature inspector"
      data-modal="false"
      data-sheet-open-state={open ? 'open' : 'closed'}
      data-sheet-detent={collapsed ? 'collapsed' : 'default'}
      className={cn(
        'pointer-events-none fixed inset-0 md:hidden',
        controlsInFront ? 'z-20' : 'z-50',
      )}
    >
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 pointer-events-none grid h-[min(420px,calc(100dvh_-_5rem))] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform',
          open ? 'translate-y-0' : 'translate-y-full',
        )}
      >
        <FeatureCard
          feature={feature}
          cardRef={cardRef}
          collapsed={collapsed}
          controlsInFront={controlsInFront}
          actionsOpen={actionsOpen}
          openInEnabled={openInEnabled}
          openInAvailable={Boolean(openInPoint)}
          onDock={onDock}
          onActionsOpenChange={setActionsOpen}
          onOpenIn={openIn}
          onFeatureAction={onFeatureAction}
          onClose={closeWithAnimation}
        />
      </div>
    </div>
  )
}

function FeatureCard({
  feature,
  cardRef,
  collapsed,
  controlsInFront,
  actionsOpen,
  openInEnabled,
  openInAvailable,
  onDock,
  onActionsOpenChange,
  onOpenIn,
  onFeatureAction,
  onClose,
}: {
  feature: InteractFeature
  cardRef: React.RefObject<HTMLDivElement>
  collapsed: boolean
  controlsInFront: boolean
  actionsOpen: boolean
  openInEnabled: boolean
  openInAvailable: boolean
  onDock: () => void
  onActionsOpenChange: (open: boolean | ((current: boolean) => boolean)) => void
  onOpenIn: (target: OpenInTarget) => void
  onFeatureAction: (action: FeatureAction) => void
  onClose: () => void
}) {
  const cardState: FeatureCardState = controlsInFront
    ? (collapsed ? 'behindCollapsed' : 'behindExpanded')
    : (collapsed ? 'frontCollapsed' : 'frontExpanded')
  const cardStateClasses: Record<FeatureCardState, string> = {
    frontExpanded: 'pointer-events-auto h-full self-end translate-y-2',
    frontCollapsed: 'pointer-events-auto h-[92px] self-end translate-y-0',
    behindExpanded: 'pointer-events-none h-full self-end -translate-y-1.5',
    behindCollapsed: 'pointer-events-none h-[92px] self-end -translate-y-1.5 shadow-[0_-3px_14px_rgba(0,0,0,0.24)]',
  }

  return (
    <div
      role="dialog"
      aria-labelledby="feature-inspector-title"
      ref={cardRef}
      className={cn(
        'col-start-1 row-start-1 flex flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)] transition-[height,transform,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
        cardStateClasses[cardState],
      )}
    >
      <SheetHandle />
      <header className="border-b border-border px-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <button type="button" className="group flex min-w-0 items-center gap-1.5 rounded-md py-0.5 pr-1 text-left hover:bg-muted/60" onClick={onDock} aria-label="Dock selected feature above map controls">
            <span id="feature-inspector-title" className="block truncate text-base font-semibold text-foreground">{feature.properties.name}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" aria-hidden="true" />
          </button>
          <div className="flex shrink-0 items-center gap-1">
            <div className="relative">
              <button
                type="button"
                className={cn('rounded-md p-2 hover:bg-muted', actionsOpen && 'bg-muted')}
                aria-label="Feature actions"
                aria-haspopup="menu"
                aria-expanded={actionsOpen}
                onClick={() => onActionsOpenChange((current) => !current)}
              >
                <MoreHorizontal className="size-4" />
              </button>
              {actionsOpen && (
                <FeatureActionsMenu
                  openInEnabled={openInEnabled}
                  openInAvailable={openInAvailable}
                  onOpenIn={onOpenIn}
                  onFeatureAction={(action) => {
                    onFeatureAction(action)
                    onActionsOpenChange(false)
                  }}
                />
              )}
            </div>
            <button type="button" className="rounded-md p-2 hover:bg-muted" onClick={onClose} aria-label="Close feature inspector">
              <X className="size-4" />
            </button>
          </div>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{layerLabel(feature.properties.layer)}</p>
      </header>
      <div className={cn('min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] transition-opacity duration-300', collapsed ? 'opacity-0' : 'opacity-100')} aria-hidden={collapsed}>
        <div aria-label="Vector feature popup contents" className="px-4 py-2">
          {feature.properties.properties.map((row) => (
            <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-3 border-b border-border/70 py-2.5 text-sm last:border-b-0">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="min-w-0 truncate font-medium text-foreground">{row.value || '-'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SheetHandle() {
  return (
    <div className="flex justify-center py-2" aria-hidden="true">
      <div className="h-1 w-10 rounded-full bg-muted-foreground/30" />
    </div>
  )
}
