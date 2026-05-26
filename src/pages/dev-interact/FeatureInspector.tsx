import { MoreHorizontal, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { FeatureActionsMenu } from './FeatureActionsMenu'
import { getOpenInUrl } from './openIn'
import { layerLabel } from './geo'
import type { FeatureAction, InteractFeature, OpenInTarget } from './types'

export function MobileFeatureInspector({
  feature,
  openInPoint,
  openInEnabled,
  collapsed,
  onFeatureAction,
  onExpand,
  onClose,
}: {
  feature: InteractFeature
  openInPoint: [number, number] | null
  openInEnabled: boolean
  collapsed: boolean
  onFeatureAction: (action: FeatureAction) => void
  onExpand: () => void
  onClose: () => void
}) {
  const [open, setOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)

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

  return (
    <div
      id="feature-inspector"
      aria-label="Feature inspector"
      data-modal="false"
      data-sheet-open-state={open ? 'open' : 'closed'}
      data-sheet-detent="default"
      className="pointer-events-none fixed inset-0 z-50 md:hidden"
    >
      <button
        type="button"
        className={cn(
          'absolute inset-0 bg-black/20 transition-opacity duration-200 ease-out',
          open ? 'pointer-events-auto opacity-0' : 'pointer-events-none opacity-0',
        )}
        onClick={closeWithAnimation}
        aria-label="Close feature inspector backdrop"
      />
      <div
        role="dialog"
        aria-labelledby="feature-inspector-title"
        data-sheet-detent={collapsed ? 'collapsed' : 'default'}
        className={cn(
          'absolute inset-x-0 bottom-0 pointer-events-auto overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.24)]',
          'transition-[max-height,transform] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] will-change-transform',
          open ? 'translate-y-0' : 'translate-y-full',
          collapsed ? 'max-h-[106px]' : 'max-h-[58vh]',
        )}
      >
        <div className="flex justify-center py-2" aria-hidden="true">
          <div className="flex">
            <span
              className={cn(
                'h-1 w-[18px] rounded-full bg-muted-foreground/25 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
                open ? 'translate-x-0.5 rotate-0' : 'translate-x-1 rotate-6',
              )}
            />
            <span
              className={cn(
                'h-1 w-[18px] rounded-full bg-muted-foreground/25 transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
                open ? '-translate-x-0.5 rotate-0' : '-translate-x-1 -rotate-6',
              )}
            />
          </div>
        </div>
        <header className="border-b border-border px-4 pb-3">
          <div className="flex items-start justify-between gap-3">
            <button
              type="button"
              className="min-w-0 text-left"
              aria-label={`Selected feature ${feature.properties.name}`}
              onClick={collapsed ? onExpand : undefined}
            >
              <span id="feature-inspector-title" className="block truncate text-base font-semibold text-foreground">
                {feature.properties.name}
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-1">
              <div className="relative">
                <button
                  type="button"
                  className={cn('rounded-md p-2 hover:bg-muted', actionsOpen && 'bg-muted')}
                  aria-label="Feature actions"
                  aria-haspopup="menu"
                  aria-expanded={actionsOpen}
                  onClick={() => setActionsOpen((current) => !current)}
                >
                  <MoreHorizontal className="size-4" />
                </button>
                {actionsOpen && (
                  <FeatureActionsMenu
                    openInEnabled={openInEnabled}
                    openInAvailable={Boolean(openInPoint)}
                    onOpenIn={openIn}
                    onFeatureAction={(action) => {
                      onFeatureAction(action)
                      setActionsOpen(false)
                    }}
                  />
                )}
              </div>
              <button type="button" className="rounded-md p-2 hover:bg-muted" onClick={closeWithAnimation} aria-label="Close feature inspector">
                <X className="size-4" />
              </button>
            </div>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{layerLabel(feature.properties.layer)}</p>
        </header>
        <div
          className={cn(
            'overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)] transition-[max-height,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]',
            collapsed ? 'max-h-0 opacity-0' : 'max-h-[42vh] opacity-100',
          )}
          aria-hidden={collapsed}
        >
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
    </div>
  )
}
