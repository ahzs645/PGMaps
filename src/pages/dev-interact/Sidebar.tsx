import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Eye, EyeOff, Info, Layers, MoreHorizontal, Ruler, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { actionRows, mapDatasetMeta } from './data'
import { formatArea, formatDistance } from './geo'
import { MeasurementValue, StatCard } from './SmallControls'
import type { LayerId, MeasurementMode, MeasurementStats, YearRange } from './types'
import { YearFilterWidget } from './YearFilterWidget'

export function DevInteractSidebar({
  className,
  visibleLayers,
  measurementMode,
  measurementStats,
  measurementPointCount,
  onToggleLayer,
  yearRange,
  onYearRangeChange,
  onOpenSearch,
  onStartMeasurement,
  onStartCircleMeasurement,
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
  yearRange: YearRange
  onYearRangeChange: (range: YearRange) => void
  onOpenSearch: () => void
  onStartMeasurement: () => void
  onStartCircleMeasurement: () => void
  onOpenTable: () => void
  onFinishMeasurement: () => void
  onClearMeasurement: () => void
  openInEnabled: boolean
  onOpenInEnabledChange: (enabled: boolean) => void
}) {
  const [measurementMenuOpen, setMeasurementMenuOpen] = useState(false)
  const [legendMenuOpen, setLegendMenuOpen] = useState(false)
  const measurementMenuRef = useRef<HTMLDivElement>(null)
  const legendMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!measurementMenuOpen && !legendMenuOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!measurementMenuRef.current?.contains(event.target as Node)) {
        setMeasurementMenuOpen(false)
      }
      if (!legendMenuRef.current?.contains(event.target as Node)) {
        setLegendMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [legendMenuOpen, measurementMenuOpen])

  const choosePolygonMeasurement = () => {
    setMeasurementMenuOpen(false)
    onStartMeasurement()
  }

  const chooseCircleMeasurement = () => {
    setMeasurementMenuOpen(false)
    onStartCircleMeasurement()
  }

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
              <div key={label} className="relative" ref={label === 'Measure areas' ? measurementMenuRef : undefined}>
                <button
                  type="button"
                  onClick={
                    label === 'Search locations'
                      ? onOpenSearch
                      : label === 'Measure areas'
                        ? () => setMeasurementMenuOpen((open) => !open)
                        : label === 'Open table'
                          ? onOpenTable
                          : undefined
                  }
                  aria-haspopup={label === 'Measure areas' ? 'menu' : undefined}
                  aria-expanded={label === 'Measure areas' ? measurementMenuOpen : undefined}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium shadow-sm transition-colors hover:bg-muted"
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                </button>
                {label === 'Measure areas' && measurementMenuOpen && (
                  <MeasurementShapeMenu
                    onPolygon={choosePolygonMeasurement}
                    onCircle={chooseCircleMeasurement}
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="border-t border-border pt-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Legend</h2>
            <div className="relative" ref={legendMenuRef}>
              <button
                type="button"
                className="rounded-md p-1.5 hover:bg-muted"
                aria-label="More legend options"
                aria-haspopup="menu"
                aria-expanded={legendMenuOpen}
                onClick={() => setLegendMenuOpen((open) => !open)}
              >
                <MoreHorizontal className="size-4" />
              </button>
              {legendMenuOpen && <LegendOptionsMenu />}
            </div>
          </div>
          <div className="space-y-2">
            <LegendRow title="Neighbourhood areas" detail="2 polygons" color="#8b5cf6" active={visibleLayers.neighbourhoods} onClick={() => onToggleLayer('neighbourhoods')} />
            <LegendRow title="Parks" detail="2 polygons" color="#22c55e" active={visibleLayers.parks} onClick={() => onToggleLayer('parks')} />
            <LegendRow title="Transit routes" detail="2 lines" color="#0ea5e9" active={visibleLayers.routes} onClick={() => onToggleLayer('routes')} line />
            <YearFilterWidget value={yearRange} onChange={onYearRangeChange} />
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
                ? 'Start measuring to draw a private polygon or circle on the map.'
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

function formatUpdated(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function LegendOptionsMenu() {
  return (
    <div
      role="menu"
      aria-orientation="vertical"
      className="absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl"
    >
      <div role="menuitem" className="flex items-start gap-3 rounded-md px-3 py-2 text-left">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block text-sm font-medium">Last updated</span>
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">
            {formatUpdated(mapDatasetMeta.updated)}
          </span>
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {mapDatasetMeta.source}
          </span>
        </span>
      </div>
    </div>
  )
}

function MeasurementShapeMenu({
  onPolygon,
  onCircle,
}: {
  onPolygon: () => void
  onCircle: () => void
}) {
  return (
    <div
      role="menu"
      aria-orientation="vertical"
      className="absolute left-0 top-full z-50 mt-1 w-full min-w-44 overflow-hidden rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl sm:left-full sm:top-0 sm:ml-2 sm:mt-0 sm:w-auto"
    >
      <MeasurementShapeMenuItem label="Polygon" onClick={onPolygon}>
        <PolygonIcon className="size-5" />
      </MeasurementShapeMenuItem>
      <MeasurementShapeMenuItem label="Circle" onClick={onCircle}>
        <CircleOutlineIcon className="size-5" />
      </MeasurementShapeMenuItem>
    </div>
  )
}

function MeasurementShapeMenuItem({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted focus:bg-muted focus:outline-none"
    >
      <span className="flex size-5 shrink-0 items-center justify-center text-foreground">{children}</span>
      <span>{label}</span>
    </button>
  )
}

function PolygonIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M13.7731 4.68144L5.65436 5.30597C5.45305 5.32145 5.29181 5.47904 5.27172 5.67995L4.69156 11.4815C4.67436 11.6536 4.76518 11.8183 4.91982 11.8957L11.03 14.9508C11.2047 15.0381 11.4166 14.9924 11.5397 14.8408L15.5492 9.90607C15.6373 9.79767 15.6652 9.65235 15.6236 9.51904L14.2028 4.9726C14.1449 4.78731 13.9667 4.66656 13.7731 4.68144ZM5.55849 4.05965C4.75325 4.12159 4.10828 4.75195 4.02792 5.55557L3.44776 11.3571C3.37895 12.0453 3.74225 12.7044 4.3608 13.0137L10.471 16.0688C11.1697 16.4181 12.0173 16.2353 12.5099 15.6291L16.5194 10.6943C16.8717 10.2607 16.9833 9.67944 16.8167 9.1462L15.3959 4.59976C15.1643 3.85859 14.4515 3.37557 13.6773 3.43513L5.55849 4.05965Z"
        fill="currentColor"
      />
    </svg>
  )
}

function CircleOutlineIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.0007 15.4166C12.9922 15.4166 15.4173 12.9915 15.4173 9.99992C15.4173 7.00838 12.9922 4.58325 10.0007 4.58325C7.00911 4.58325 4.58398 7.00838 4.58398 9.99992C4.58398 12.9915 7.00911 15.4166 10.0007 15.4166ZM10.0007 16.6666C13.6825 16.6666 16.6673 13.6818 16.6673 9.99992C16.6673 6.31802 13.6825 3.33325 10.0007 3.33325C6.31875 3.33325 3.33398 6.31802 3.33398 9.99992C3.33398 13.6818 6.31875 16.6666 10.0007 16.6666Z"
        fill="currentColor"
      />
    </svg>
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
