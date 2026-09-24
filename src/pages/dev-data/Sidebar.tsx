import { AlertCircle, Eye, EyeOff, Loader2, Table2 } from 'lucide-react'
import { MapTableButton } from '@/components/map/MapFeatureTable'
import { MapSidebarShell, SidebarSection } from '@/components/ui/map-panels'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { DEV_DATA_LAYERS, type DataLayerId } from './data'
import type { LayerState } from './useDataLayers'

export function DevDataSidebar({
  className,
  enabledLayers,
  tableLayer,
  getLayer,
  viewModeToggle,
  onViewModeToggleChange,
  onToggleLayer,
  onOpenTable,
}: {
  className?: string
  enabledLayers: Record<DataLayerId, boolean>
  tableLayer: DataLayerId | null
  getLayer: (layerId: DataLayerId) => LayerState
  viewModeToggle: boolean
  onViewModeToggleChange: (enabled: boolean) => void
  onToggleLayer: (layerId: DataLayerId) => void
  onOpenTable: (layerId: DataLayerId) => void
}) {
  return (
    <MapSidebarShell
      className={className}
      title="Data table lab"
      subtitle="Felt-style bottom data table over City of Prince George open-data layers."
      icon={Table2}
      iconClassName="border bg-muted text-foreground"
      titleClassName="text-base"
      scrollClassName="pb-[calc(env(safe-area-inset-bottom)+2rem)] md:pb-0"
    >
      <SidebarSection>
        <MapTableButton label="Open table" onClick={() => onOpenTable(tableLayer ?? 'community-boundaries')} />
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          The table pane is resizable, searchable, and filters to the current viewport.
          The same button also sits on the map as an icon-only control.
        </p>
      </SidebarSection>

      <SidebarSection title="Table options">
        <label className="flex items-start gap-3 rounded-md border border-border bg-background px-2 py-2">
          <input
            type="checkbox"
            checked={viewModeToggle}
            onChange={(event) => onViewModeToggleChange(event.target.checked)}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span className="min-w-0">
            <span className="block text-sm font-medium">All / Visible filter</span>
            <span className="block text-xs leading-4 text-muted-foreground">
              {viewModeToggle
                ? 'Segmented control in the table toolbar.'
                : 'Hidden — the viewport filter falls back to a checkbox in the layer menu.'}
            </span>
          </span>
        </label>
      </SidebarSection>

      <SidebarSection title="Layers">
        <div className="space-y-1.5">
          {DEV_DATA_LAYERS.map((layer) => {
            const enabled = enabledLayers[layer.id]
            const state = getLayer(layer.id)
            const count = state.status === 'ready' ? state.collection.features.length : layer.approxCount

            return (
              <div
                key={layer.id}
                className={cn(
                  'rounded-md border border-border bg-background transition-colors',
                  tableLayer === layer.id && 'border-primary/60 bg-primary/5',
                )}
              >
                <div className="flex items-center gap-2 px-2 py-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => onToggleLayer(layer.id)}
                    aria-pressed={enabled}
                  >
                    <LayerGlyph color={layer.color} shape={layer.shape} dimmed={!enabled} />
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate text-sm font-medium', !enabled && 'text-muted-foreground')}>
                        {layer.label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {state.status === 'error' ? 'Failed to load' : `${formatNumber(count)} rows`}
                      </span>
                    </span>
                  </button>

                  {state.status === 'loading' && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Loading" />}
                  {state.status === 'error' && <AlertCircle className="size-4 shrink-0 text-destructive" aria-label="Failed to load" />}

                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground touch:p-2.5"
                    aria-label={`Show ${layer.label} in the table`}
                    title="Show in table"
                    onClick={() => onOpenTable(layer.id)}
                  >
                    <Table2 className="size-4" />
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground touch:p-2.5"
                    aria-label={enabled ? `Hide ${layer.label}` : `Show ${layer.label}`}
                    onClick={() => onToggleLayer(layer.id)}
                  >
                    {enabled ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
                  </button>
                </div>
                <p className="px-2 pb-2 text-xs leading-4 text-muted-foreground">{layer.description}</p>
              </div>
            )
          })}
        </div>
      </SidebarSection>

      <SidebarSection title="Source" className="border-b-0">
        <p className="text-xs leading-5 text-muted-foreground">
          City of Prince George open data, synced into <code className="rounded bg-muted px-1 py-0.5">public/data/citypg</code>.
          Large layers are fetched only when switched on.
        </p>
      </SidebarSection>
    </MapSidebarShell>
  )
}

function LayerGlyph({ color, shape, dimmed }: { color: string; shape: 'fill' | 'line'; dimmed: boolean }) {
  if (shape === 'line') {
    return <span className={cn('block h-1 w-5 shrink-0 rounded-full transition-opacity', dimmed && 'opacity-35')} style={{ backgroundColor: color }} />
  }
  return <span className={cn('block size-4 shrink-0 rounded border transition-opacity', dimmed && 'opacity-35')} style={{ backgroundColor: color, borderColor: color }} />
}
