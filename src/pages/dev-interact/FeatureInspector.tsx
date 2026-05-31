import { MoreHorizontal } from 'lucide-react'
import { useCallback, useState } from 'react'
import { MobileMapCard } from '@/components/map/MapCard'
import { cn } from '@/lib/utils'
import { FeatureActionsMenu } from './FeatureActionsMenu'
import { layerLabel } from './geo'
import { getOpenInUrl } from './openIn'
import type { FeatureAction, InteractFeature, OpenInTarget } from './types'

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
  const [actionsOpen, setActionsOpen] = useState(false)

  const openIn = useCallback((target: OpenInTarget) => {
    if (!openInPoint) return
    window.open(getOpenInUrl(target, openInPoint, feature), '_blank', 'noopener,noreferrer')
    setActionsOpen(false)
  }, [feature, openInPoint])

  return (
    <MobileMapCard
      id="feature-inspector"
      ariaLabel="Feature inspector"
      title={feature.properties.name}
      subtitle={layerLabel(feature.properties.layer)}
      collapsed={collapsed}
      controlsInFront={controlsInFront}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onDock={onDock}
      onClose={onClose}
      actions={(
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
      )}
    >
      <div aria-label="Vector feature popup contents" className="px-4 py-2">
        {feature.properties.properties.map((row) => (
          <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-3 border-b border-border/70 py-2.5 text-sm last:border-b-0">
            <span className="text-muted-foreground">{row.label}</span>
            <span className="min-w-0 truncate font-medium text-foreground">{row.value || '-'}</span>
          </div>
        ))}
      </div>
    </MobileMapCard>
  )
}
