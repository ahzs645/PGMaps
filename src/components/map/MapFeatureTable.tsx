import { Check, ChevronDown, Filter, Search, Square, SquareCheck, Table2, X } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'
import { MobileMapCard } from './MapCard'
import { cn } from '@/lib/utils'

export interface MapFeatureTableLayer<TLayerId extends string = string> {
  id: TLayerId
  label: string
  color: string
  shape?: 'fill' | 'line'
}

export interface MapFeatureTableColumn<TRow> {
  id: string
  header: string
  widthClassName?: string
  getValue: (row: TRow) => ReactNode
  getSearchValue?: (row: TRow) => string
}

interface MapFeatureTablePanelProps<TRow, TLayerId extends string> {
  rows: TRow[]
  columns: Array<MapFeatureTableColumn<TRow>>
  layers: Array<MapFeatureTableLayer<TLayerId>>
  selectedLayer: TLayerId
  getRowId: (row: TRow) => string
  onLayerChange: (layer: TLayerId) => void
  onClose: () => void
  onSelect: (row: TRow) => void
  title?: string
  emptyMessage?: string
  showOnlyInView?: boolean
  onShowOnlyInViewChange?: (enabled: boolean) => void
  query?: string
  onQueryChange?: (query: string) => void
  mobileCard?: boolean
}

export function MapTableButton({
  label = 'Open table',
  className,
  onClick,
}: {
  label?: string
  className?: string
  onClick: () => void
}) {
  return (
    <div className="relative">
      <button
        type="button"
        className={cn('flex w-full items-center gap-3 rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium shadow-sm transition-colors hover:bg-muted', className)}
        onClick={onClick}
      >
        <Table2 className="size-4" aria-hidden="true" />
        <span>{label}</span>
      </button>
    </div>
  )
}

export function MapFeatureTablePanel<TRow, TLayerId extends string>({
  rows,
  columns,
  layers,
  selectedLayer,
  getRowId,
  onLayerChange,
  onClose,
  onSelect,
  title = 'Table',
  emptyMessage = 'No visible rows',
  showOnlyInView = false,
  onShowOnlyInViewChange,
  query: controlledQuery,
  onQueryChange,
  mobileCard = true,
}: MapFeatureTablePanelProps<TRow, TLayerId>) {
  const [uncontrolledQuery, setUncontrolledQuery] = useState('')
  const [layerPickerOpen, setLayerPickerOpen] = useState(false)
  const query = controlledQuery ?? uncontrolledQuery
  const setQuery = onQueryChange ?? setUncontrolledQuery
  const activeLayer = layers.find((candidate) => candidate.id === selectedLayer) ?? layers[0]

  const filteredRows = query.trim()
    ? rows.filter((row) => {
      const normalizedQuery = query.trim().toLowerCase()
      const searchable = columns
        .map((column) => column.getSearchValue?.(row) ?? String(column.getValue(row) ?? ''))
        .join(' ')
        .toLowerCase()
      return searchable.includes(normalizedQuery)
    })
    : rows

  return (
    <>
      {mobileCard ? (
        <MobileMapCard id="map-feature-table" ariaLabel="Feature table" title={title} subtitle={activeLayer?.label} collapsed={false} controlsInFront={false} onClose={onClose}>
          <TableBody rows={filteredRows} columns={columns} layers={layers} activeLayer={activeLayer} selectedLayer={selectedLayer} getRowId={getRowId} query={query} layerPickerOpen={layerPickerOpen} showOnlyInView={showOnlyInView} showOnlyInViewEnabled={Boolean(onShowOnlyInViewChange)} emptyMessage={emptyMessage} onQueryChange={setQuery} onLayerPickerOpenChange={setLayerPickerOpen} onLayerChange={onLayerChange} onShowOnlyInViewChange={onShowOnlyInViewChange} onSelect={onSelect} />
        </MobileMapCard>
      ) : (
        <div role="dialog" aria-label={title} className="absolute inset-x-0 bottom-0 z-50 flex h-[calc(100%-74px)] flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.3)] md:hidden">
          <TableHeader title={title} onClose={onClose} />
          <TableBody rows={filteredRows} columns={columns} layers={layers} activeLayer={activeLayer} selectedLayer={selectedLayer} getRowId={getRowId} query={query} layerPickerOpen={layerPickerOpen} showOnlyInView={showOnlyInView} showOnlyInViewEnabled={Boolean(onShowOnlyInViewChange)} emptyMessage={emptyMessage} onQueryChange={setQuery} onLayerPickerOpenChange={setLayerPickerOpen} onLayerChange={onLayerChange} onShowOnlyInViewChange={onShowOnlyInViewChange} onSelect={onSelect} />
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 z-30 hidden h-[33%] min-h-64 max-h-[520px] flex-col overflow-hidden border border-x-0 border-b-0 border-border bg-background/95 shadow-[0_-2px_16px_rgba(0,0,0,0.18)] backdrop-blur md:flex">
        <TableHeader title={title} onClose={onClose} />
        <TableBody rows={filteredRows} columns={columns} layers={layers} activeLayer={activeLayer} selectedLayer={selectedLayer} getRowId={getRowId} query={query} layerPickerOpen={layerPickerOpen} showOnlyInView={showOnlyInView} showOnlyInViewEnabled={Boolean(onShowOnlyInViewChange)} emptyMessage={emptyMessage} onQueryChange={setQuery} onLayerPickerOpenChange={setLayerPickerOpen} onLayerChange={onLayerChange} onShowOnlyInViewChange={onShowOnlyInViewChange} onSelect={onSelect} />
      </div>
    </>
  )
}

function TableHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex justify-center py-2 md:hidden" aria-hidden="true">
        <div className="flex">
          <span className="h-1 w-[18px] translate-x-0.5 rounded-full bg-muted-foreground/25" />
          <span className="h-1 w-[18px] -translate-x-0.5 rounded-full bg-muted-foreground/25" />
        </div>
      </div>
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-1 md:py-3">
        <button type="button" className="flex min-w-0 items-center gap-1 text-left" aria-label={title}>
          <span className="truncate text-base font-semibold">{title}</span>
          <ChevronDown className="size-3.5 text-muted-foreground" />
        </button>
        <button type="button" className="rounded-md p-2 hover:bg-muted" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </header>
    </div>
  )
}

function TableBody<TRow, TLayerId extends string>({
  rows,
  columns,
  layers,
  activeLayer,
  selectedLayer,
  getRowId,
  query,
  layerPickerOpen,
  showOnlyInView,
  showOnlyInViewEnabled,
  emptyMessage,
  onQueryChange,
  onLayerPickerOpenChange,
  onLayerChange,
  onShowOnlyInViewChange,
  onSelect,
}: {
  rows: TRow[]
  columns: Array<MapFeatureTableColumn<TRow>>
  layers: Array<MapFeatureTableLayer<TLayerId>>
  activeLayer: MapFeatureTableLayer<TLayerId> | undefined
  selectedLayer: TLayerId
  getRowId: (row: TRow) => string
  query: string
  layerPickerOpen: boolean
  showOnlyInView: boolean
  showOnlyInViewEnabled: boolean
  emptyMessage: string
  onQueryChange: (query: string) => void
  onLayerPickerOpenChange: (open: boolean) => void
  onLayerChange: (layer: TLayerId) => void
  onShowOnlyInViewChange?: (enabled: boolean) => void
  onSelect: (row: TRow) => void
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {activeLayer && (
            <div className="relative">
              <button type="button" className="flex max-w-[13rem] items-center gap-2 rounded-md px-2 py-2 text-sm font-medium hover:bg-muted" aria-haspopup="listbox" aria-expanded={layerPickerOpen} onClick={() => onLayerPickerOpenChange(!layerPickerOpen)}>
                <LayerGlyph color={activeLayer.color} shape={activeLayer.shape ?? 'fill'} />
                <span className="truncate">{activeLayer.label}</span>
                <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
              {layerPickerOpen && <LayerPicker layers={layers} selectedLayer={selectedLayer} showOnlyInView={showOnlyInView} showOnlyInViewEnabled={showOnlyInViewEnabled} onLayerChange={(layer) => { onLayerChange(layer); onLayerPickerOpenChange(false) }} onShowOnlyInViewChange={onShowOnlyInViewChange} />}
            </div>
          )}
          <div className="min-w-0 flex-1" />
          {showOnlyInViewEnabled && (
            <button type="button" className={cn('rounded-md p-2 hover:bg-muted', showOnlyInView && 'bg-muted')} aria-label="Show only features in view" onClick={() => onShowOnlyInViewChange?.(!showOnlyInView)}>
              <Filter className="size-4" />
            </button>
          )}
          <div className="relative w-[min(15rem,42vw)] max-w-52">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="Type to search..." aria-label="Search table" className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm outline-none focus:ring-1 focus:ring-ring" />
            {query ? <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-muted" onClick={() => onQueryChange('')} aria-label="Clear search"><X className="size-3.5" /></button> : null}
          </div>
        </div>
        {showOnlyInViewEnabled && showOnlyInView && (
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
              {columns.map((column) => <th key={column.id} className={cn('w-[150px] px-3 py-2 font-medium', column.widthClassName)}><span className="block truncate">{column.header}</span></th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => <TableRow key={getRowId(row)} row={row} index={index} columns={columns} onSelect={onSelect} />)}
            {rows.length === 0 && <tr><td className="px-3 py-8 text-center text-muted-foreground" colSpan={columns.length + 1}>{emptyMessage}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LayerPicker<TLayerId extends string>({
  layers,
  selectedLayer,
  showOnlyInView,
  showOnlyInViewEnabled,
  onLayerChange,
  onShowOnlyInViewChange,
}: {
  layers: Array<MapFeatureTableLayer<TLayerId>>
  selectedLayer: TLayerId
  showOnlyInView: boolean
  showOnlyInViewEnabled: boolean
  onLayerChange: (layer: TLayerId) => void
  onShowOnlyInViewChange?: (enabled: boolean) => void
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
        {layers.map((item) => (
          <button key={item.id} type="button" role="option" aria-selected={selectedLayer === item.id} className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted', selectedLayer === item.id && 'bg-muted')} onClick={() => onLayerChange(item.id)}>
            <LayerGlyph color={item.color} shape={item.shape ?? 'fill'} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {selectedLayer === item.id ? <Check className="size-4" /> : <span className="size-4" />}
          </button>
        ))}
      </div>
      {showOnlyInViewEnabled && (
        <button type="button" role="menuitemcheckbox" aria-checked={showOnlyInView} className="flex w-full items-center gap-3 border-t border-border px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => onShowOnlyInViewChange?.(!showOnlyInView)}>
          {showOnlyInView ? <SquareCheck className="size-4" /> : <Square className="size-4" />}
          <span>Show only features in view</span>
        </button>
      )}
    </div>
  )
}

function TableRow<TRow>({
  row,
  index,
  columns,
  onSelect,
}: {
  row: TRow
  index: number
  columns: Array<MapFeatureTableColumn<TRow>>
  onSelect: (row: TRow) => void
}) {
  return (
    <tr className="cursor-pointer border-b border-border/70 hover:bg-muted" onClick={() => onSelect(row)}>
      <td className="w-14 bg-muted/30 px-3 py-2 text-muted-foreground">{index + 1}</td>
      {columns.map((column) => {
        const value = column.getValue(row)
        const isEmpty = value == null || value === ''
        return (
          <td key={column.id} className={cn('w-[150px] px-3 py-2', column.widthClassName)}>
            <span className={cn('block truncate', isEmpty && 'text-muted-foreground')}>{isEmpty ? '-' : value}</span>
          </td>
        )
      })}
    </tr>
  )
}

function LayerGlyph({ color, shape }: { color: string; shape: 'fill' | 'line' }) {
  if (shape === 'line') {
    return <span className="block h-1 w-6 rounded-full" style={{ backgroundColor: color }} />
  }
  return <span className="block size-4 rounded border" style={{ backgroundColor: color, borderColor: color }} />
}
