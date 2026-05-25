import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatArea, formatDistance, measurementCanClose } from './geo'
import { MeasurementValue } from './SmallControls'
import type { MeasurementMode, MeasurementStats } from './types'

export function MeasurementOverlay({
  measurementMode,
  measurementStats,
  measurementPoints,
  onClearMeasurement,
  onFinishMeasurement,
}: {
  measurementMode: MeasurementMode
  measurementStats: MeasurementStats
  measurementPoints: [number, number][]
  onClearMeasurement: () => void
  onFinishMeasurement: () => void
}) {
  if (measurementMode === 'idle') return null

  return (
    <div className="absolute bottom-[calc(var(--map-mobile-sheet-visible-height,72px)+0.75rem)] left-3 z-20 w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur md:bottom-4 md:left-auto md:right-4">
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
        <Button size="sm" className="mt-3 w-full" disabled={!measurementCanClose(measurementPoints)} onClick={onFinishMeasurement}>
          Close polygon
        </Button>
      )}
    </div>
  )
}
