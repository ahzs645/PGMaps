import { AlertCircle, Eye, EyeOff, Loader2, Table2 } from 'lucide-react'
import { MapTableButton } from '@/components/map/MapFeatureTable'
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
    <aside className={cn('flex h-full min-h-0 flex-col overflow-hidden bg-background/95', className)}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md border bg-muted p-2">
            <Table2 className="size-4" />
          </div>
          <div>
            <h1 className="text-base font-semibold leading-tight">Data table lab</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Felt-style bottom data table over City of Prince George open-data layers.
            </p>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-4 md:p-4">
        <section>
          <MapTableButton label="Open table" onClick={() => onOpenTable(tableLayer ?? 'community-boundaries')} />
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            The table pane is resizable, searchable, and filters to the current viewport.
            The same button also sits on the map as an icon-only control.
          </p>
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Table options</h2>
          <label className="mt-2 flex items-start gap-3 rounded-md border border-border bg-background px-2 py-2">
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
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Layers</h2>
          <div className="mt-2 space-y-1.5">
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
                          {state.status === 'error' ? 'Failed to load' : `${count.toLocaleString()} rows`}
                        </span>
                      </span>
                    </button>

                    {state.status === 'loading' && <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" aria-label="Loading" />}
                    {state.status === 'error' && <AlertCircle className="size-4 shrink-0 text-destructive" aria-label="Failed to load" />}

                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={`Show ${layer.label} in the table`}
                      title="Show in table"
                      onClick={() => onOpenTable(layer.id)}
                    >
                      <Table2 className="size-4" />
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
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
        </section>

        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Source</h2>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            City of Prince George open data, synced into <code className="rounded bg-muted px-1 py-0.5">public/data/citypg</code>.
            Large layers are fetched only when switched on.
          </p>
        </section>
      </div>
    </aside>
  )
}

function LayerGlyph({ color, shape, dimmed }: { color: string; shape: 'fill' | 'line'; dimmed: boolean }) {
  if (shape === 'line') {
    return <span className={cn('block h-1 w-5 shrink-0 rounded-full transition-opacity', dimmed && 'opacity-35')} style={{ backgroundColor: color }} />
  }
  return <span className={cn('block size-4 shrink-0 rounded border transition-opacity', dimmed && 'opacity-35')} style={{ backgroundColor: color, borderColor: color }} />
}
