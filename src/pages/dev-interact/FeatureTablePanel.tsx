import { Check, ChevronDown, Filter, Search, Square, SquareCheck, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { neighbourhoodFeatures, parkFeatures, routeFeatures } from './data'
import { featureMatchesYearRange, layerLabel } from './geo'
import type { InteractFeature, LayerId, YearRange } from './types'

const tableLayers: Array<{ id: LayerId; color: string; shape: 'fill' | 'line' }> = [
  { id: 'parks', color: '#22c55e', shape: 'fill' },
  { id: 'neighbourhoods', color: '#8b5cf6', shape: 'fill' },
  { id: 'routes', color: '#0ea5e9', shape: 'line' },
]

const columns = ['Name', 'Layer', 'Description', 'Value', 'Property 1', 'Property 2', 'Property 3', 'Property 4']

export function FeatureTablePanel({
  layer,
  onLayerChange,
  hiddenFeatureIds,
  isolatedFeatureId,
  yearRange,
  onClose,
  onSelect,
}: {
  layer: LayerId
  onLayerChange: (layer: LayerId) => void
  hiddenFeatureIds: Set<string>
  isolatedFeatureId: string | null
  yearRange: YearRange
  onClose: () => void
  onSelect: (feature: InteractFeature) => void
}) {
  const [query, setQuery] = useState('')
  const [layerPickerOpen, setLayerPickerOpen] = useState(false)
  const [showOnlyInView, setShowOnlyInView] = useState(false)
  const activeLayer = tableLayers.find((candidate) => candidate.id === layer) ?? tableLayers[0]

  const rows = useMemo(() => {
    const collection = layer === 'parks' ? parkFeatures : layer === 'routes' ? routeFeatures : neighbourhoodFeatures
    const normalizedQuery = query.trim().toLowerCase()
    return collection.features.filter((feature) => {
      if (hiddenFeatureIds.has(feature.properties.id)) return false
      if (isolatedFeatureId && feature.properties.id !== isolatedFeatureId) return false
      if (!featureMatchesYearRange(feature, yearRange)) return false
      if (showOnlyInView && feature.properties.id === 'college-heights') return false
      if (!normalizedQuery) return true
      const searchable = [
        feature.properties.name,
        feature.properties.description,
        feature.properties.value,
        ...feature.properties.properties.flatMap((property) => [property.label, property.value]),
      ].join(' ').toLowerCase()
      return searchable.includes(normalizedQuery)
    })
  }, [hiddenFeatureIds, isolatedFeatureId, layer, query, showOnlyInView, yearRange])

  return (
    <>
      <div role="dialog" aria-labelledby="table-sheet-title" className="absolute inset-x-0 bottom-0 z-50 flex h-[calc(100%-74px)] flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.3)] md:hidden">
        <TableSheetHeader onClose={onClose} />
        <TableBody
          rows={rows}
          layer={layer}
          activeLayer={activeLayer}
          query={query}
          layerPickerOpen={layerPickerOpen}
          showOnlyInView={showOnlyInView}
          onQueryChange={setQuery}
          onLayerPickerOpenChange={setLayerPickerOpen}
          onLayerChange={(nextLayer) => {
            onLayerChange(nextLayer)
            setLayerPickerOpen(false)
          }}
          onShowOnlyInViewChange={setShowOnlyInView}
          onSelect={onSelect}
        />
      </div>

      <div className="absolute inset-x-0 bottom-0 z-30 hidden h-[33%] min-h-64 max-h-[520px] flex-col overflow-hidden border border-x-0 border-b-0 border-border bg-background/95 shadow-[0_-2px_16px_rgba(0,0,0,0.18)] backdrop-blur md:flex">
        <TableSheetHeader onClose={onClose} />
        <TableBody
          rows={rows}
          layer={layer}
          activeLayer={activeLayer}
          query={query}
          layerPickerOpen={layerPickerOpen}
          showOnlyInView={showOnlyInView}
          onQueryChange={setQuery}
          onLayerPickerOpenChange={setLayerPickerOpen}
          onLayerChange={(nextLayer) => {
            onLayerChange(nextLayer)
            setLayerPickerOpen(false)
          }}
          onShowOnlyInViewChange={setShowOnlyInView}
          onSelect={onSelect}
        />
      </div>
    </>
  )
}

function TableSheetHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex justify-center py-2 md:hidden" aria-hidden="true">
        <div className="flex">
          <span className="h-1 w-[18px] translate-x-0.5 rounded-full bg-muted-foreground/25" />
          <span className="h-1 w-[18px] -translate-x-0.5 rounded-full bg-muted-foreground/25" />
        </div>
      </div>
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-1 md:py-3">
        <button type="button" className="flex min-w-0 items-center gap-1 text-left" aria-label="Table view">
          <span id="table-sheet-title" className="truncate text-base font-semibold">Table</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
        <button type="button" className="rounded-md p-2 hover:bg-muted" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </header>
    </div>
  )
}

function TableBody({
  rows,
  layer,
  activeLayer,
  query,
  layerPickerOpen,
  showOnlyInView,
  onQueryChange,
  onLayerPickerOpenChange,
  onLayerChange,
  onShowOnlyInViewChange,
  onSelect,
}: {
  rows: InteractFeature[]
  layer: LayerId
  activeLayer: { id: LayerId; color: string; shape: 'fill' | 'line' }
  query: string
  layerPickerOpen: boolean
  showOnlyInView: boolean
  onQueryChange: (query: string) => void
  onLayerPickerOpenChange: (open: boolean) => void
  onLayerChange: (layer: LayerId) => void
  onShowOnlyInViewChange: (enabled: boolean) => void
  onSelect: (feature: InteractFeature) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <div className="relative">
            <button
              type="button"
              className="flex max-w-[13rem] items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted"
              aria-haspopup="listbox"
              aria-expanded={layerPickerOpen}
              onClick={() => onLayerPickerOpenChange(!layerPickerOpen)}
            >
              <LayerGlyph color={activeLayer.color} shape={activeLayer.shape} />
              <span className="truncate">{layerLabel(layer)}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
            {layerPickerOpen && (
              <LayerPicker
                selectedLayer={layer}
                showOnlyInView={showOnlyInView}
                onLayerChange={onLayerChange}
                onShowOnlyInViewChange={onShowOnlyInViewChange}
              />
            )}
          </div>
          <div className="min-w-0 flex-1" />
          <button
            type="button"
            className={cn('rounded-md p-2 hover:bg-muted', showOnlyInView && 'bg-muted')}
            aria-label="Show only features in view"
            onClick={() => onShowOnlyInViewChange(!showOnlyInView)}
          >
            <Filter className="size-4" />
          </button>
          <div className="relative w-[min(15rem,42vw)] max-w-52">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder="Type to search..."
              aria-label="Search table"
              className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm outline-none focus:ring-1 focus:ring-ring"
            />
            {query ? (
              <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-muted" onClick={() => onQueryChange('')} aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        {showOnlyInView && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-2 text-xs">
            <SquareCheck className="size-4" />
            <span>Show only features in view</span>
          </div>
        )}
      </div>

      <div aria-label="Data table pane" className="min-h-0 flex-1 overflow-auto">
        <table className="min-w-[980px] border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th className="w-14 px-3 py-2 font-medium">#</th>
              {columns.map((column) => (
                <th key={column} className="w-[150px] px-3 py-2 font-medium">
                  <span className="block truncate">{column}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((feature, index) => (
              <TableRow key={feature.properties.id} feature={feature} index={index} onSelect={onSelect} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td className="px-3 py-8 text-center text-muted-foreground" colSpan={columns.length + 1}>No visible rows</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LayerPicker({
  selectedLayer,
  showOnlyInView,
  onLayerChange,
  onShowOnlyInViewChange,
}: {
  selectedLayer: LayerId
  showOnlyInView: boolean
  onLayerChange: (layer: LayerId) => void
  onShowOnlyInViewChange: (enabled: boolean) => void
}) {
  return (
    <div className="absolute left-0 top-[calc(100%+0.35rem)] z-30 w-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl">
      <div className="border-b border-border p-2">
        <div className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-sm text-muted-foreground">
          <Search className="size-4" />
          <span>Search layers...</span>
        </div>
      </div>
      <div role="listbox" aria-label="Table layer" className="py-1">
        {tableLayers.map((item) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={selectedLayer === item.id}
            className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted', selectedLayer === item.id && 'bg-muted')}
            onClick={() => onLayerChange(item.id)}
          >
            <LayerGlyph color={item.color} shape={item.shape} />
            <span className="min-w-0 flex-1 truncate">{layerLabel(item.id)}</span>
            {selectedLayer === item.id ? <Check className="size-4" /> : <span className="size-4" />}
          </button>
        ))}
      </div>
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={showOnlyInView}
        className="flex w-full items-center gap-3 border-t border-border px-3 py-2 text-left text-sm hover:bg-muted"
        onClick={() => onShowOnlyInViewChange(!showOnlyInView)}
      >
        {showOnlyInView ? <SquareCheck className="size-4" /> : <Square className="size-4" />}
        <span>Show only features in view</span>
      </button>
    </div>
  )
}

function TableRow({
  feature,
  index,
  onSelect,
}: {
  feature: InteractFeature
  index: number
  onSelect: (feature: InteractFeature) => void
}) {
  const values = [
    feature.properties.name,
    layerLabel(feature.properties.layer),
    feature.properties.description,
    feature.properties.value ?? '—',
    ...feature.properties.properties.slice(0, 4).map((property) => property.value || '—'),
  ]

  return (
    <tr className="cursor-pointer border-b border-border/70 hover:bg-muted" onClick={() => onSelect(feature)}>
      <td className="w-14 bg-muted/30 px-3 py-2 text-muted-foreground">{index + 1}</td>
      {values.map((value, valueIndex) => (
        <td key={`${feature.properties.id}:${valueIndex}`} className="w-[150px] px-3 py-2">
          <span className={cn('block truncate', value === '—' && 'text-muted-foreground')}>{value}</span>
        </td>
      ))}
    </tr>
  )
}

function LayerGlyph({ color, shape }: { color: string; shape: 'fill' | 'line' }) {
  if (shape === 'line') {
    return <span className="block h-1 w-6 rounded-full" style={{ backgroundColor: color }} />
  }
  return <span className="block size-4 rounded border" style={{ backgroundColor: color, borderColor: color }} />
}
