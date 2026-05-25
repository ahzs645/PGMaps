import { Navigation, Redo, Undo, X } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useMap } from '@/components/ui/map'
import { cn } from '@/lib/utils'
import { formatArea, formatDistance, measurementCanClose } from './geo'
import { MeasurementValue } from './SmallControls'
import type { MeasurementMode, MeasurementStats } from './types'

export function MeasurementOverlay({
  measurementMode,
  measurementStats,
  measurementPoints,
  canUndo,
  canRedo,
  onAddPoint,
  onUndo,
  onRedo,
  onClearMeasurement,
  onFinishMeasurement,
}: {
  measurementMode: MeasurementMode
  measurementStats: MeasurementStats
  measurementPoints: [number, number][]
  canUndo: boolean
  canRedo: boolean
  onAddPoint: (point: [number, number]) => void
  onUndo: () => void
  onRedo: () => void
  onClearMeasurement: () => void
  onFinishMeasurement: () => void
}) {
  const { map } = useMap()

  if (measurementMode === 'idle') return null

  const canClose = measurementCanClose(measurementPoints)
  const addCenterPoint = () => {
    const center = map?.getCenter()
    if (!center) return
    onAddPoint([center.lng, center.lat])
  }

  return (
    <>
      <MobileMeasurementSheet
        measurementMode={measurementMode}
        measurementStats={measurementStats}
        measurementPoints={measurementPoints}
        canClose={canClose}
        canUndo={canUndo}
        canRedo={canRedo}
        onAddPoint={addCenterPoint}
        onUndo={onUndo}
        onRedo={onRedo}
        onClearMeasurement={onClearMeasurement}
        onFinishMeasurement={onFinishMeasurement}
      />
      <DesktopMeasurementCard
        measurementMode={measurementMode}
        measurementStats={measurementStats}
        canClose={canClose}
        onClearMeasurement={onClearMeasurement}
        onFinishMeasurement={onFinishMeasurement}
      />
    </>
  )
}

function DesktopMeasurementCard({
  measurementMode,
  measurementStats,
  canClose,
  onClearMeasurement,
  onFinishMeasurement,
}: {
  measurementMode: MeasurementMode
  measurementStats: MeasurementStats
  canClose: boolean
  onClearMeasurement: () => void
  onFinishMeasurement: () => void
}) {
  return (
    <div className="absolute bottom-4 right-4 z-20 hidden w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur md:block">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Polygon measurement</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {measurementMode === 'drawing' ? 'Click to add points. Click the first point or double-click to close.' : 'Measurement is visible only in this session.'}
          </div>
        </div>
        <button type="button" className="rounded-md p-1.5 hover:bg-muted" onClick={onClearMeasurement} aria-label="Clear measurement">
          <X className="size-4" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <MeasurementValue label="Perimeter" value={measurementStats ? formatDistance(measurementStats.perimeter) : '-'} />
        <MeasurementValue label="Area" value={measurementStats && measurementStats.area > 0 ? formatArea(measurementStats.area) : '-'} />
      </div>
      {measurementMode === 'drawing' && (
        <Button size="sm" className="mt-3 w-full" disabled={!canClose} onClick={onFinishMeasurement}>
          Close polygon
        </Button>
      )}
    </div>
  )
}

function MobileMeasurementSheet({
  measurementMode,
  measurementStats,
  measurementPoints,
  canClose,
  canUndo,
  canRedo,
  onAddPoint,
  onUndo,
  onRedo,
  onClearMeasurement,
  onFinishMeasurement,
}: {
  measurementMode: MeasurementMode
  measurementStats: MeasurementStats
  measurementPoints: [number, number][]
  canClose: boolean
  canUndo: boolean
  canRedo: boolean
  onAddPoint: () => void
  onUndo: () => void
  onRedo: () => void
  onClearMeasurement: () => void
  onFinishMeasurement: () => void
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 md:hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-0 -translate-y-full">
        <div className="flex items-center justify-center pb-2">
          <button
            type="button"
            className="pointer-events-auto flex size-10 items-center justify-center rounded-md border border-border bg-background/90 text-foreground shadow-lg backdrop-blur"
            aria-label="Center on measurement"
          >
            <Navigation className="size-5" />
          </button>
        </div>
      </div>

      <div
        role="dialog"
        aria-labelledby="area-measurement-title"
        className="pointer-events-auto relative z-10 overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.3)]"
      >
        <header className="border-b border-border px-4 py-3">
          <p id="area-measurement-title" className="text-base font-semibold">Area measurement</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {measurementMode === 'drawing'
              ? `${measurementPoints.length} point${measurementPoints.length === 1 ? '' : 's'} placed`
              : 'Measurement is visible only in this session.'}
          </p>
        </header>

        <div className="px-4 py-3">
          {measurementMode === 'drawing' ? (
            <Button className="w-full" onClick={onAddPoint}>
              Add point
            </Button>
          ) : null}
          <div className={cn('grid grid-cols-2 gap-2', measurementMode === 'drawing' && 'mt-3')}>
            <MeasurementValue label="Perimeter" value={measurementStats ? formatDistance(measurementStats.perimeter) : '-'} />
            <MeasurementValue label="Area" value={measurementStats && measurementStats.area > 0 ? formatArea(measurementStats.area) : '-'} />
          </div>
        </div>

        <div role="toolbar" className="flex items-center gap-2 border-t border-border bg-muted/35 px-3 py-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
          <Button variant="secondary" size="sm" onClick={onClearMeasurement}>
            Cancel
          </Button>
          <div className="min-w-0 flex-1" />
          <IconToolbarButton label="Undo" disabled={!canUndo || measurementMode !== 'drawing'} onClick={onUndo}>
            <Undo className="size-4" />
          </IconToolbarButton>
          <IconToolbarButton label="Redo" disabled={!canRedo || measurementMode !== 'drawing'} onClick={onRedo}>
            <Redo className="size-4" />
          </IconToolbarButton>
          <Button size="sm" disabled={!canClose || measurementMode !== 'drawing'} onClick={onFinishMeasurement}>
            Next
          </Button>
        </div>
      </div>
    </div>
  )
}

function IconToolbarButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  )
}
