import type { CSSProperties, ComponentPropsWithoutRef, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { MAP_OVERLAY_ROOT_STYLE, MAP_OVERLAY_Z } from './map-overlay'

type MapOverlayRootProps = ComponentPropsWithoutRef<'div'>

export function MapOverlayRoot({ className, style, ...props }: MapOverlayRootProps) {
  return (
    <div
      data-map-layout-root="true"
      className={cn('relative h-full w-full', className)}
      style={{ ...MAP_OVERLAY_ROOT_STYLE, ...style } as CSSProperties}
      {...props}
    />
  )
}

type FloatingPanelPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const floatingPanelPositionClasses: Record<FloatingPanelPosition, string> = {
  'top-left': 'left-3 top-3',
  'top-right': 'right-3 top-3',
  'bottom-left': 'left-3 bottom-[calc(var(--map-mobile-sheet-visible-height,0px)+var(--map-legend-panel-visible-height,0px)+var(--map-timeline-height,0px)+var(--map-safe-bottom-offset,0px)+0.75rem)] md:bottom-3',
  'bottom-right': 'right-3 bottom-[calc(var(--map-mobile-sheet-visible-height,0px)+var(--map-legend-panel-visible-height,0px)+var(--map-timeline-height,0px)+var(--map-safe-bottom-offset,0px)+0.75rem)] md:bottom-3',
}

type MapFloatingPanelProps = ComponentPropsWithoutRef<'div'> & {
  position?: FloatingPanelPosition
  z?: keyof typeof MAP_OVERLAY_Z
  children: ReactNode
}

export function MapFloatingPanel({
  position = 'bottom-left',
  z = 'controls',
  className,
  children,
  ...props
}: MapFloatingPanelProps) {
  return (
    <div
      className={cn('absolute', MAP_OVERLAY_Z[z], floatingPanelPositionClasses[position], className)}
      {...props}
    >
      {children}
    </div>
  )
}

