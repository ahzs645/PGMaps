import { ChevronRight, Eye, EyeOff, Layers, MapPin, Search } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import type { FeatureAction, OpenInTarget } from './types'

export function FeatureActionsMenu({
  openInEnabled,
  openInAvailable,
  onOpenIn,
  onFeatureAction,
}: {
  openInEnabled: boolean
  openInAvailable: boolean
  onOpenIn: (target: OpenInTarget) => void
  onFeatureAction: (action: FeatureAction) => void
}) {
  const openInIsAvailable = openInEnabled && openInAvailable
  const [openInExpanded, setOpenInExpanded] = useState(false)

  return (
    <div
      role="menu"
      aria-label="Feature actions menu"
      className="absolute right-0 top-[calc(100%+0.35rem)] z-20 w-56 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
    >
      <button
        type="button"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={openInIsAvailable ? openInExpanded : false}
        data-state={openInIsAvailable && openInExpanded ? 'open' : 'closed'}
        disabled={!openInIsAvailable}
        className={cn(
          'flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium',
          openInIsAvailable ? 'text-foreground hover:bg-muted' : 'cursor-not-allowed text-muted-foreground opacity-60',
          openInIsAvailable && openInExpanded && 'bg-muted/60',
        )}
        onClick={() => setOpenInExpanded((current) => !current)}
      >
        <span>Open in</span>
        <ChevronRight className={cn('size-3.5 opacity-80 transition-transform', openInExpanded && 'rotate-90')} />
      </button>
      {openInIsAvailable && openInExpanded ? (
        <div className="border-t border-border py-1" role="menu" aria-label="Open in destinations">
          <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onOpenIn('pgdata')}>
            PG Data map
          </button>
          <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onOpenIn('explorer')}>
            Explorer map
          </button>
          <button type="button" role="menuitem" className="block w-full px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onOpenIn('osm')}>
            OpenStreetMap
          </button>
        </div>
      ) : !openInIsAvailable ? (
        <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
          Enable this action in the controls sheet.
        </div>
      ) : null}
      <div className="max-h-72 overflow-y-auto border-t border-border py-1">
        <FeatureActionMenuItem icon={<EyeOff className="size-4" />} label="Hide" onClick={() => onFeatureAction('hide')} />
        <FeatureActionMenuItem icon={<Search className="size-4" />} label="Zoom to fit" onClick={() => onFeatureAction('zoom')} />
        <FeatureActionMenuItem icon={<MapPin className="size-4" />} label="Show only this" onClick={() => onFeatureAction('show-only')} />
        <FeatureActionMenuItem icon={<Eye className="size-4" />} label="Show others" onClick={() => onFeatureAction('show-others')} />
        <FeatureActionMenuItem icon={<Layers className="size-4" />} label="Open table" onClick={() => onFeatureAction('open-table')} />
      </div>
    </div>
  )
}

function FeatureActionMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted"
      onClick={onClick}
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-foreground">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  )
}
