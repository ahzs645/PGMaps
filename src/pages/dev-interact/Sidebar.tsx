import { Eye, EyeOff, Info, Layers, MoreHorizontal, Ruler, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { actionRows } from './data'
import { formatArea, formatDistance } from './geo'
import { MeasurementValue, StatCard } from './SmallControls'
import type { LayerId, MeasurementMode, MeasurementStats } from './types'

export function DevInteractSidebar({
  className,
  visibleLayers,
  measurementMode,
  measurementStats,
  measurementPointCount,
  onToggleLayer,
  onStartMeasurement,
  onOpenTable,
  onFinishMeasurement,
  onClearMeasurement,
  openInEnabled,
  onOpenInEnabledChange,
}: {
  className?: string
  visibleLayers: Record<LayerId, boolean>
  measurementMode: MeasurementMode
  measurementStats: MeasurementStats
  measurementPointCount: number
  onToggleLayer: (layer: LayerId) => void
  onStartMeasurement: () => void
  onOpenTable: () => void
  onFinishMeasurement: () => void
  onClearMeasurement: () => void
  openInEnabled: boolean
  onOpenInEnabledChange: (enabled: boolean) => void
}) {
  return (
    <aside className={cn('flex flex-col bg-background/95', className)}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2">
            <Layers className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Interactive map shell</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Shared sidebar, bottom sheet, popup cards, layer controls, and map actions.
            </p>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section>
          <p className="text-xs leading-5 text-muted-foreground">
            Use this map to test the Felt-style presentation against the app's existing MapLibre stack.
          </p>
          <div className="mt-3 space-y-2">
            {actionRows.map(({ label, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={label === 'Measure areas' ? onStartMeasurement : label === 'Open table' ? onOpenTable : undefined}
                className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium shadow-sm transition-colors hover:bg-muted"
              >
                <Icon className="size-4" />
                <span>{label}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Legend</h2>
            <button type="button" className="rounded-md p-1.5 hover:bg-muted" aria-label="More legend options">
              <MoreHorizontal className="size-4" />
            </button>
          </div>
          <div className="space-y-2">
            <LegendRow title="Neighbourhood areas" detail="2 polygons" color="#8b5cf6" active={visibleLayers.neighbourhoods} onClick={() => onToggleLayer('neighbourhoods')} />
            <LegendRow title="Parks" detail="2 polygons" color="#22c55e" active={visibleLayers.parks} onClick={() => onToggleLayer('parks')} />
            <LegendRow title="Transit routes" detail="2 lines" color="#0ea5e9" active={visibleLayers.routes} onClick={() => onToggleLayer('routes')} line />
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Measurement</h2>
            <button type="button" onClick={onClearMeasurement} className="rounded-md p-1.5 hover:bg-muted" aria-label="Delete measurement">
              <Trash2 className="size-4" />
            </button>
          </div>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="text-xs text-muted-foreground">
              {measurementMode === 'idle'
                ? 'Start measuring to draw a private polygon on the map.'
                : `${measurementPointCount} point${measurementPointCount === 1 ? '' : 's'} placed`}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <MeasurementValue label="Perimeter" value={measurementStats ? formatDistance(measurementStats.perimeter) : '-'} />
              <MeasurementValue label="Area" value={measurementStats && measurementStats.area > 0 ? formatArea(measurementStats.area) : '-'} />
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant={measurementMode === 'drawing' ? 'secondary' : 'default'} onClick={onStartMeasurement} className="flex-1">
                <Ruler className="mr-2 size-4" />
                Measure
              </Button>
              <Button size="sm" variant="outline" disabled={measurementPointCount < 3 || measurementMode !== 'drawing'} onClick={onFinishMeasurement} className="flex-1">
                Close
              </Button>
            </div>
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <div className="mb-2">
            <h2 className="text-sm font-semibold">Feature actions</h2>
          </div>
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 shadow-sm">
            <span>
              <span className="block text-sm font-medium">Open in menu</span>
              <span className="block text-xs text-muted-foreground">Show map handoff options in feature sheets</span>
            </span>
            <input
              type="checkbox"
              checked={openInEnabled}
              onChange={(event) => onOpenInEnabledChange(event.target.checked)}
              className="size-4 accent-primary"
              aria-label="Enable Open in feature action"
            />
          </label>
        </section>

        <section className="border-t border-border pt-4">
          <div className="grid grid-cols-3 gap-2">
            <StatCard label="Visible" value={Object.values(visibleLayers).filter(Boolean).length.toString()} />
            <StatCard label="Features" value="6" />
            <StatCard label="Cards" value="On" />
          </div>
        </section>
      </div>
    </aside>
  )
}

function LegendRow({
  title,
  detail,
  color,
  active,
  line = false,
  onClick,
}: {
  title: string
  detail: string
  color: string
  active: boolean
  line?: boolean
  onClick: () => void
}) {
  return (
    <div className={cn('rounded-md border border-border bg-background p-3 shadow-sm', !active && 'opacity-55')}>
      <div className="flex items-center gap-3">
        <span
          className={cn('shrink-0 border', line ? 'h-1 w-8 rounded-full' : 'size-4 rounded')}
          style={{ backgroundColor: active ? color : 'transparent', borderColor: color }}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{title}</div>
          <div className="text-xs text-muted-foreground">{detail}</div>
        </div>
        <button type="button" onClick={onClick} className="rounded-md p-1.5 hover:bg-muted" aria-label={`Toggle ${title}`}>
          {active ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
        <button type="button" className="rounded-md p-1.5 hover:bg-muted" aria-label={`View info for ${title}`}>
          <Info className="size-4" />
        </button>
      </div>
    </div>
  )
}
