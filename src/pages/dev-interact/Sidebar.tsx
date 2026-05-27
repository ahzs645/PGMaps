import { useEffect, useRef, useState } from 'react'
import { CalendarClock, Eye, EyeOff, Layers, MoreHorizontal, Ruler, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AppSelect } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { actionRows, mapDatasetMeta } from './data'
import { formatArea, formatDistance } from './geo'
import { MeasurementValue, StatCard } from './SmallControls'
import type { LayerId, MeasurementMode, MeasurementStats, ScalePosition, YearRange } from './types'
import { YearFilterWidget } from './YearFilterWidget'

const scalePositionOptions: Array<{ value: ScalePosition; label: string }> = [
  { value: 'bottom-center', label: 'Bottom center' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'top-center', label: 'Top center' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
]

export function DevInteractSidebar({
  className,
  visibleLayers,
  measurementMode,
  measurementStats,
  measurementPointCount,
  onToggleLayer,
  onIsolateLayer,
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
  scaleVisible,
  onScaleVisibleChange,
  scalePosition,
  onScalePositionChange,
}: {
  className?: string
  visibleLayers: Record<LayerId, boolean>
  measurementMode: MeasurementMode
  measurementStats: MeasurementStats
  measurementPointCount: number
  onToggleLayer: (layer: LayerId) => void
  onIsolateLayer: (layer: LayerId) => void
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
  scaleVisible: boolean
  onScaleVisibleChange: (visible: boolean) => void
  scalePosition: ScalePosition
  onScalePositionChange: (position: ScalePosition) => void
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
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4 md:p-4">
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
            <div role="list" className="space-y-0.5">
              <LegendRow title="Neighbourhood areas" color="#8b5cf6" active={visibleLayers.neighbourhoods} onToggle={() => onToggleLayer('neighbourhoods')} onIsolate={() => onIsolateLayer('neighbourhoods')} />
              <LegendRow title="Parks" color="#22c55e" active={visibleLayers.parks} onToggle={() => onToggleLayer('parks')} onIsolate={() => onIsolateLayer('parks')} />
              <LegendRow title="Transit routes" color="#0ea5e9" active={visibleLayers.routes} onToggle={() => onToggleLayer('routes')} onIsolate={() => onIsolateLayer('routes')} line />
            </div>
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
            <h2 className="text-sm font-semibold">Map components</h2>
          </div>
          <div className="space-y-2">
            <ComponentToggle
              title="Scale"
              description="Show the scale, zoom, and source strip"
              checked={scaleVisible}
              onCheckedChange={onScaleVisibleChange}
            />
            <div className="rounded-md border border-border bg-background px-3 py-2 shadow-sm">
              <label htmlFor="scale-position" className="block text-sm font-medium">Scale position</label>
              <AppSelect
                id="scale-position"
                value={scalePosition}
                onValueChange={(value) => onScalePositionChange(value as ScalePosition)}
                options={scalePositionOptions}
                className="mt-2"
                triggerClassName="h-8 bg-background"
                disabled={!scaleVisible}
              />
            </div>
            <ComponentToggle
              title="Open in menu"
              description="Show map handoff options in feature sheets"
              checked={openInEnabled}
              onCheckedChange={onOpenInEnabledChange}
            />
          </div>
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

function ComponentToggle({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 shadow-sm">
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <span className="flex items-center gap-2">
        {checked ? <Eye className="size-4 text-muted-foreground" /> : <EyeOff className="size-4 text-muted-foreground" />}
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.target.checked)}
          className="size-4 accent-primary"
          aria-label={title}
        />
      </span>
    </label>
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
  color,
  active,
  line = false,
  onToggle,
  onIsolate,
}: {
  title: string
  color: string
  active: boolean
  line?: boolean
  onToggle: () => void
  onIsolate: () => void
}) {
  return (
    <div
      role="listitem"
      data-hidden={!active}
      className={cn(
        'group flex items-center gap-2.5 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/60',
        !active && 'opacity-50',
      )}
    >
      <span className="flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
        {line ? (
          <span className="h-1 w-4 rounded-full" style={{ backgroundColor: color, opacity: 0.9 }} />
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="5.5" fill={color} stroke={color} strokeWidth="1" opacity="0.9" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={title}>
        {title}
      </span>
      <div
        className={cn(
          'flex items-center gap-0.5 transition-opacity',
          active ? 'opacity-0 group-hover:opacity-100 focus-within:opacity-100' : 'opacity-100',
        )}
      >
        <button
          type="button"
          onClick={onIsolate}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label={`Show only ${title}`}
        >
          <IsolateIcon className="size-4" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          aria-label="Toggle legend item visibility"
        >
          {active ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
      </div>
    </div>
  )
}

function IsolateIcon({ className }: { className?: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden="true">
      <path d="M6.70382 3.4567C7.50536 3.12469 8.4629 3.03403 10 3.00928V5.00952C9.56157 5.01682 9.18622 5.0297 8.85313 5.05243C8.11822 5.10257 7.73618 5.19387 7.46918 5.30446C6.48907 5.71044 5.71037 6.48913 5.3044 7.46924C5.1938 7.73624 5.10251 8.11828 5.05237 8.85319C5.02964 9.18625 5.01676 9.56156 5.00946 9.99994H3.00922C3.03398 8.46291 3.12464 7.5054 3.45664 6.70388C4.0656 5.23371 5.23365 4.06567 6.70382 3.4567Z" fill="currentColor" />
      <path d="M3.45664 17.2961C3.12463 16.4945 3.03397 15.537 3.00922 13.9999H5.00946C5.01676 14.4384 5.02964 14.8137 5.05237 15.1468C5.10251 15.8817 5.1938 16.2637 5.3044 16.5307C5.71037 17.5108 6.48907 18.2895 7.46918 18.6955C7.73618 18.8061 8.11822 18.8974 8.85313 18.9475C9.18622 18.9703 9.56156 18.9831 10 18.9904V20.9907C8.4629 20.9659 7.50536 20.8753 6.70382 20.5433C5.23365 19.9343 4.0656 18.7662 3.45664 17.2961Z" fill="currentColor" />
      <path d="M14 20.9907V18.9904C14.4384 18.9831 14.8137 18.9703 15.1467 18.9475C15.8816 18.8974 16.2637 18.8061 16.5307 18.6955C17.5108 18.2895 18.2895 17.5108 18.6954 16.5307C18.806 16.2637 18.8973 15.8817 18.9475 15.1468C18.9702 14.8137 18.9831 14.4384 18.9904 13.9999H20.9906C20.9659 15.537 20.8752 16.4945 20.5432 17.2961C19.9342 18.7662 18.7662 19.9343 17.296 20.5433C16.4945 20.8753 15.537 20.9659 14 20.9907Z" fill="currentColor" />
      <path d="M20.5432 6.70388C20.8752 7.5054 20.9659 8.46291 20.9906 9.99994H18.9904C18.9831 9.56156 18.9702 9.18625 18.9475 8.85319C18.8973 8.11828 18.806 7.73624 18.6954 7.46924C18.2895 6.48913 17.5108 5.71044 16.5307 5.30446C16.2637 5.19387 15.8816 5.10257 15.1467 5.05243C14.8137 5.02971 14.4384 5.01682 14 5.00952V3.00928C15.537 3.03404 16.4945 3.1247 17.296 3.4567C18.7662 4.06567 19.9342 5.23371 20.5432 6.70388Z" fill="currentColor" />
      <path d="M13.9999 12C13.9999 13.1046 13.1045 14 11.9999 14C10.8953 14 9.99992 13.1046 9.99992 12C9.99992 10.8954 10.8953 10 11.9999 10C13.1045 10 13.9999 10.8954 13.9999 12Z" fill="currentColor" />
    </svg>
  )
}
