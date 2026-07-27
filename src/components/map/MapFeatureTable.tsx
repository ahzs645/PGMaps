import { CalendarDays, CaseSensitive, Check, ChevronDown, Hash, Maximize2, Minimize2, Search, Square, SquareCheck, Table2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { MobileMapCard } from './MapCard'
import { cn } from '@/lib/utils'

/** Row height in px. Fixed so the virtualizer can measure without a layout pass. */
const ROW_HEIGHT = 32
const INDEX_COLUMN_WIDTH = 56
const DEFAULT_COLUMN_WIDTH = 150
/** Below this row count the grid renders every row, which keeps tests and small tables simple. */
const VIRTUALIZE_THRESHOLD = 60

/**
 * Pane heights are px, not percentages: the docked pane is sized via the layout
 * root's padding-bottom, and percentage padding resolves against *width* in CSS.
 */
export const DEFAULT_TABLE_PANE_HEIGHT = 320
const MIN_PANEL_HEIGHT = 160
/** Map kept visible above the pane when it is expanded or dragged to the top. */
const MIN_MAP_HEIGHT = 120

export type MapFeatureTableColumnType = 'text' | 'numeric' | 'datetime'
export type MapFeatureTableViewMode = 'all' | 'visible'

export interface MapFeatureTableLayer<TLayerId extends string = string> {
  id: TLayerId
  label: string
  color: string
  shape?: 'fill' | 'line'
}

export interface MapFeatureTableColumn<TRow> {
  id: string
  header: string
  /** Drives cell alignment and the header type glyph. Defaults to 'text'. */
  type?: MapFeatureTableColumnType
  /** Fixed px width for this column. Defaults to 150px, growing to fill spare width. */
  width?: number
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
  /** Id of the row to mark selected, so map and table selection stay in sync. */
  selectedRowId?: string | null
  /** Renders the All/Visible segmented control instead of the filter checkbox. */
  viewModeToggle?: boolean
  /** Enables the drag-to-resize handle and expand button on the desktop panel. */
  resizable?: boolean
  /** Collapses search to an icon that expands on click, like Felt. */
  collapsibleSearch?: boolean
  /**
   * Desktop pane height in px. Pass together with `onHeightChange` and feed the
   * same value to MapSectionLayout's `bottomPaneHeight` so the pane docks across
   * the full width instead of overlaying the map.
   */
  height?: number
  onHeightChange?: (height: number) => void
}

export function MapTableButton({
  label = 'Open table',
  className,
  iconOnly = false,
  onClick,
}: {
  label?: string
  className?: string
  /** Renders a square icon button instead of the full-width labelled row. */
  iconOnly?: boolean
  onClick: () => void
}) {
  if (iconOnly) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        className={cn('flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-foreground shadow-sm transition-colors hover:bg-muted', className)}
        onClick={onClick}
      >
        <Table2 className="size-5" aria-hidden="true" />
      </button>
    )
  }

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
  selectedRowId = null,
  viewModeToggle = false,
  resizable = false,
  collapsibleSearch = false,
  height: controlledHeight,
  onHeightChange,
}: MapFeatureTablePanelProps<TRow, TLayerId>) {
  const [uncontrolledQuery, setUncontrolledQuery] = useState('')
  const [layerPickerOpen, setLayerPickerOpen] = useState(false)
  const [uncontrolledHeight, setUncontrolledHeight] = useState(DEFAULT_TABLE_PANE_HEIGHT)
  const panelHeight = controlledHeight ?? uncontrolledHeight
  const setPanelHeight = onHeightChange ?? setUncontrolledHeight
  const query = controlledQuery ?? uncontrolledQuery
  const setQuery = onQueryChange ?? setUncontrolledQuery
  const activeLayer = layers.find((candidate) => candidate.id === selectedLayer) ?? layers[0]

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return rows
    return rows.filter((row) => {
      const searchable = columns
        .map((column) => column.getSearchValue?.(row) ?? String(column.getValue(row) ?? ''))
        .join(' ')
        .toLowerCase()
      return searchable.includes(normalizedQuery)
    })
  }, [columns, query, rows])

  /**
   * `paneActions` puts expand/close on the toolbar row itself (Felt keeps the whole
   * table chrome on one line). Mobile passes none, since the sheet card supplies its
   * own header and close button.
   */
  const renderBody = (paneActions?: TablePaneActions) => (
    <TableBody
      rows={filteredRows}
      totalRowCount={rows.length}
      columns={columns}
      layers={layers}
      activeLayer={activeLayer}
      selectedLayer={selectedLayer}
      getRowId={getRowId}
      query={query}
      layerPickerOpen={layerPickerOpen}
      showOnlyInView={showOnlyInView}
      showOnlyInViewEnabled={Boolean(onShowOnlyInViewChange)}
      emptyMessage={emptyMessage}
      selectedRowId={selectedRowId}
      viewModeToggle={viewModeToggle}
      collapsibleSearch={collapsibleSearch}
      paneActions={paneActions}
      onQueryChange={setQuery}
      onLayerPickerOpenChange={setLayerPickerOpen}
      onLayerChange={onLayerChange}
      onShowOnlyInViewChange={onShowOnlyInViewChange}
      onSelect={onSelect}
    />
  )

  return (
    <>
      {mobileCard ? (
        <MobileMapCard id="map-feature-table" ariaLabel="Feature table" title={title} subtitle={activeLayer?.label === title ? undefined : activeLayer?.label} collapsed={false} controlsInFront={false} onClose={onClose}>
          {renderBody()}
        </MobileMapCard>
      ) : (
        <div role="dialog" aria-label={title} className="absolute inset-x-0 bottom-0 z-50 flex h-[calc(100%-74px)] flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.3)] md:hidden">
          <TableHeader title={title} onClose={onClose} />
          {renderBody()}
        </div>
      )}

      <DesktopTablePanel
        title={title}
        height={panelHeight}
        resizable={resizable}
        onHeightChange={setPanelHeight}
        onClose={onClose}
      >
        {renderBody}
      </DesktopTablePanel>
    </>
  )
}

export interface TablePaneActions {
  expandable: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onClose: () => void
}

/**
 * Bottom split-view pane, docked across the full width of the layout root — so it
 * sits under the sidebars too, not just the map. The root reserves its height via
 * padding-bottom, so everything above is shortened rather than covered.
 */
function DesktopTablePanel({
  title,
  height,
  resizable,
  onHeightChange,
  onClose,
  children,
}: {
  title: string
  height: number
  resizable: boolean
  onHeightChange: (height: number) => void
  onClose: () => void
  children: (paneActions: TablePaneActions) => ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [containerHeight, setContainerHeight] = useState(0)

  // Measured rather than read from the ref during render, so `expanded` is correct
  // on the first paint. ResizeObserver fires once on observe, so no sync setState.
  useEffect(() => {
    const parent = panelRef.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => setContainerHeight(parent.getBoundingClientRect().height))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  /** Tallest the pane may grow, leaving a strip of map visible above it. */
  const maxHeight = containerHeight > 0
    ? Math.max(MIN_PANEL_HEIGHT, containerHeight - MIN_MAP_HEIGHT)
    : Number.POSITIVE_INFINITY

  const clamp = useCallback(
    (next: number) => Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, next)),
    [maxHeight],
  )

  const expanded = containerHeight > 0 && height >= maxHeight - 1

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizable) return
    const parent = panelRef.current?.parentElement
    if (!parent) return
    event.preventDefault()
    const parentBottom = parent.getBoundingClientRect().bottom
    setDragging(true)

    const move = (moveEvent: PointerEvent) => onHeightChange(clamp(parentBottom - moveEvent.clientY))
    const up = () => {
      setDragging(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [clamp, onHeightChange, resizable])

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      onHeightChange(clamp(height + 32))
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      onHeightChange(clamp(height - 32))
    }
  }, [clamp, height, onHeightChange])

  return (
    <div
      ref={panelRef}
      data-panel="data-table-panel"
      aria-label={`${title} pane`}
      /* No drop shadow: the pane is docked in the layout rather than floating over
         the map, so the 1px top border is the only separation it needs. */
      className="absolute inset-x-0 bottom-0 z-30 hidden flex-col overflow-hidden border border-x-0 border-b-0 border-border bg-background md:flex"
      style={{ height }}
    >
      {resizable && (
        /* Invisible drag strip on the top border, like Felt's split-view divider.
           It tints on hover/drag instead of showing a grab pill. */
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize table pane"
          aria-valuenow={Math.round(height)}
          aria-valuemin={MIN_PANEL_HEIGHT}
          tabIndex={0}
          className={cn(
            'absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize bg-transparent outline-none transition-colors hover:bg-primary/30 focus-visible:bg-primary/50',
            dragging && 'bg-primary/50',
          )}
          onPointerDown={handlePointerDown}
          onKeyDown={handleKeyDown}
        />
      )}
      {children({
        expandable: resizable,
        expanded,
        onToggleExpanded: () => onHeightChange(expanded ? DEFAULT_TABLE_PANE_HEIGHT : clamp(maxHeight)),
        onClose,
      })}
    </div>
  )
}

/** Header for the non-card mobile sheet variant. Desktop keeps its chrome on the toolbar row. */
function TableHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="shrink-0 border-b border-border">
      <div className="flex justify-center py-2" aria-hidden="true">
        <div className="flex">
          <span className="h-1 w-[18px] translate-x-0.5 rounded-full bg-muted-foreground/25" />
          <span className="h-1 w-[18px] -translate-x-0.5 rounded-full bg-muted-foreground/25" />
        </div>
      </div>
      <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-1">
        <span className="truncate text-base font-semibold">{title}</span>
        <button type="button" className="rounded-md p-2 hover:bg-muted" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </header>
    </div>
  )
}

function TableBody<TRow, TLayerId extends string>({
  rows,
  totalRowCount,
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
  selectedRowId,
  viewModeToggle,
  collapsibleSearch,
  paneActions,
  onQueryChange,
  onLayerPickerOpenChange,
  onLayerChange,
  onShowOnlyInViewChange,
  onSelect,
}: {
  rows: TRow[]
  totalRowCount: number
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
  selectedRowId: string | null
  viewModeToggle: boolean
  collapsibleSearch: boolean
  paneActions?: TablePaneActions
  onQueryChange: (query: string) => void
  onLayerPickerOpenChange: (open: boolean) => void
  onLayerChange: (layer: TLayerId) => void
  onShowOnlyInViewChange?: (enabled: boolean) => void
  onSelect: (row: TRow) => void
}) {
  const showViewModeToggle = viewModeToggle && showOnlyInViewEnabled

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {activeLayer && (
            <div className="relative" data-layer-picker-root="true">
              {/* Doubles as the pane heading, the way Felt's table titles its layer. */}
              <button
                type="button"
                role="heading"
                aria-level={2}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted',
                  paneActions ? 'max-w-[18rem] text-base font-semibold' : 'max-w-[13rem] text-sm font-medium',
                )}
                aria-haspopup="listbox"
                aria-expanded={layerPickerOpen}
                onClick={() => onLayerPickerOpenChange(!layerPickerOpen)}
              >
                <LayerGlyph color={activeLayer.color} shape={activeLayer.shape ?? 'fill'} />
                <span className="truncate">{activeLayer.label}</span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
              {layerPickerOpen && (
                <LayerPicker
                  layers={layers}
                  selectedLayer={selectedLayer}
                  showOnlyInView={showOnlyInView}
                  showOnlyInViewEnabled={showOnlyInViewEnabled && !showViewModeToggle}
                  onClose={() => onLayerPickerOpenChange(false)}
                  onLayerChange={(layer) => { onLayerChange(layer); onLayerPickerOpenChange(false) }}
                  onShowOnlyInViewChange={onShowOnlyInViewChange}
                />
              )}
            </div>
          )}

          {showViewModeToggle && (
            <>
              <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
              <ViewModeToggle showOnlyInView={showOnlyInView} onShowOnlyInViewChange={onShowOnlyInViewChange} />
            </>
          )}

          <div className="min-w-0 flex-1" />

          <span className="hidden shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:inline">
            {rows.length === totalRowCount ? `${totalRowCount.toLocaleString()} rows` : `${rows.length.toLocaleString()} of ${totalRowCount.toLocaleString()}`}
          </span>

          {showOnlyInViewEnabled && !showViewModeToggle && (
            <button type="button" className={cn('rounded-md p-2 hover:bg-muted', showOnlyInView && 'bg-muted')} aria-label="Show only features in view" onClick={() => onShowOnlyInViewChange?.(!showOnlyInView)}>
              <SquareCheck className="size-4" />
            </button>
          )}

          <TableSearch query={query} collapsible={collapsibleSearch} onQueryChange={onQueryChange} />

          {paneActions && (
            <>
              {paneActions.expandable && (
                <button
                  type="button"
                  className="shrink-0 rounded-md p-2 hover:bg-muted"
                  onClick={paneActions.onToggleExpanded}
                  aria-label={paneActions.expanded ? 'Collapse table pane' : 'Expand table pane'}
                  aria-pressed={paneActions.expanded}
                >
                  {paneActions.expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
              )}
              <button type="button" className="shrink-0 rounded-md p-2 hover:bg-muted" onClick={paneActions.onClose} aria-label="Close">
                <X className="size-4" />
              </button>
            </>
          )}
        </div>
        {showOnlyInViewEnabled && !showViewModeToggle && showOnlyInView && (
          <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-2 text-xs">
            <SquareCheck className="size-4" />
            <span>Show only features in view</span>
          </div>
        )}
      </div>

      <TableGrid
        rows={rows}
        columns={columns}
        getRowId={getRowId}
        emptyMessage={emptyMessage}
        selectedRowId={selectedRowId}
        onSelect={onSelect}
      />
    </div>
  )
}

/** Felt-style All/Visible segmented control. Maps onto the showOnlyInView flag. */
function ViewModeToggle({
  showOnlyInView,
  onShowOnlyInViewChange,
}: {
  showOnlyInView: boolean
  onShowOnlyInViewChange?: (enabled: boolean) => void
}) {
  const options: Array<{ value: MapFeatureTableViewMode; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'visible', label: 'Visible' },
  ]
  const active: MapFeatureTableViewMode = showOnlyInView ? 'visible' : 'all'

  return (
    <div role="radiogroup" aria-label="View mode" aria-orientation="horizontal" className="flex shrink-0 items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={active === option.value}
          className={cn(
            'rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors',
            active === option.value ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
          onClick={() => onShowOnlyInViewChange?.(option.value === 'visible')}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Search that starts as an icon and expands into an input, matching Felt's toolbar. */
function TableSearch({
  query,
  collapsible,
  onQueryChange,
}: {
  query: string
  collapsible: boolean
  onQueryChange: (query: string) => void
}) {
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const expanded = !collapsible || open || query.length > 0

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!expanded) {
    return (
      <button type="button" className="shrink-0 rounded-md p-2 hover:bg-muted" aria-label="Search table" onClick={() => setOpen(true)}>
        <Search className="size-4" />
      </button>
    )
  }

  return (
    <div className="relative w-[min(15rem,42vw)] max-w-52 shrink-0">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        ref={inputRef}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onBlur={() => { if (collapsible && !query) setOpen(false) }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          onQueryChange('')
          if (collapsible) setOpen(false)
        }}
        placeholder="Type to search…"
        aria-label="Search table"
        className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
      {query ? (
        <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-muted" onMouseDown={(event) => event.preventDefault()} onClick={() => onQueryChange('')} aria-label="Clear search">
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

/**
 * Grid-backed table. Rows are laid out with CSS grid rather than table layout so
 * they can be absolutely positioned by the virtualizer while columns stay aligned
 * with the sticky header.
 */
function TableGrid<TRow>({
  rows,
  columns,
  getRowId,
  emptyMessage,
  selectedRowId,
  onSelect,
}: {
  rows: TRow[]
  columns: Array<MapFeatureTableColumn<TRow>>
  getRowId: (row: TRow) => string
  emptyMessage: string
  selectedRowId: string | null
  onSelect: (row: TRow) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = rows.length > VIRTUALIZE_THRESHOLD

  const gridStyle = useMemo<CSSProperties>(() => {
    const template = columns
      .map((column) => `minmax(${column.width ?? DEFAULT_COLUMN_WIDTH}px, 1fr)`)
      .join(' ')
    return {
      display: 'grid',
      gridTemplateColumns: `${INDEX_COLUMN_WIDTH}px ${template}`,
    }
  }, [columns])

  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  })

  const virtualItems = virtualizer.getVirtualItems()

  return (
    <div ref={scrollRef} aria-label="Data table pane" className="min-h-0 flex-1 overflow-auto">
      <div className="min-w-max">
        <div role="table" aria-rowcount={rows.length} className="text-sm">
          <div role="rowgroup" className="sticky top-0 z-10 bg-background">
            <div role="row" style={gridStyle} className="border-b border-border text-left text-xs text-muted-foreground">
              <div role="columnheader" className="flex items-center px-3 py-2 font-medium">#</div>
              {columns.map((column) => (
                <div key={column.id} role="columnheader" className={cn('flex min-w-0 items-center gap-1.5 px-3 py-2 font-medium', column.widthClassName)}>
                  <ColumnTypeGlyph type={column.type ?? 'text'} />
                  <span className="block truncate" title={column.header}>{column.header}</span>
                </div>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-3 py-8 text-center text-muted-foreground">{emptyMessage}</div>
          ) : virtualize ? (
            <div role="rowgroup" className="relative" style={{ height: virtualizer.getTotalSize() }}>
              {virtualItems.map((virtualRow) => {
                const row = rows[virtualRow.index]
                return (
                  <TableRow
                    key={getRowId(row)}
                    row={row}
                    index={virtualRow.index}
                    columns={columns}
                    gridStyle={gridStyle}
                    selected={getRowId(row) === selectedRowId}
                    style={{ position: 'absolute', top: 0, left: 0, right: 0, height: virtualRow.size, transform: `translateY(${virtualRow.start}px)` }}
                    onSelect={onSelect}
                  />
                )
              })}
            </div>
          ) : (
            <div role="rowgroup">
              {rows.map((row, index) => (
                <TableRow
                  key={getRowId(row)}
                  row={row}
                  index={index}
                  columns={columns}
                  gridStyle={gridStyle}
                  selected={getRowId(row) === selectedRowId}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ColumnTypeGlyph({ type }: { type: MapFeatureTableColumnType }) {
  const Icon = type === 'numeric' ? Hash : type === 'datetime' ? CalendarDays : CaseSensitive
  return <Icon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
}

function LayerPicker<TLayerId extends string>({
  layers,
  selectedLayer,
  showOnlyInView,
  showOnlyInViewEnabled,
  onClose,
  onLayerChange,
  onShowOnlyInViewChange,
}: {
  layers: Array<MapFeatureTableLayer<TLayerId>>
  selectedLayer: TLayerId
  showOnlyInView: boolean
  showOnlyInViewEnabled: boolean
  onClose: () => void
  onLayerChange: (layer: TLayerId) => void
  onShowOnlyInViewChange?: (enabled: boolean) => void
}) {
  const [layerQuery, setLayerQuery] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      // The panel body renders twice (mobile card + desktop pane), so both pickers
      // are mounted at once. Ignore clicks inside *either* picker root, otherwise
      // one instance dismisses the other before its click lands.
      if (target.closest('[data-layer-picker-root]')) return
      onClose()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

  const normalized = layerQuery.trim().toLowerCase()
  const visibleLayers = normalized ? layers.filter((item) => item.label.toLowerCase().includes(normalized)) : layers

  return (
    <div ref={containerRef} className="absolute left-0 top-[calc(100%+0.35rem)] z-30 w-72 overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl">
      <div className="border-b border-border p-2">
        <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            value={layerQuery}
            onChange={(event) => setLayerQuery(event.target.value)}
            placeholder="Search layers…"
            aria-label="Search layers"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </div>
      </div>
      <div role="listbox" aria-label="Table layer" className="max-h-64 overflow-auto py-1">
        {visibleLayers.map((item) => (
          <button key={item.id} type="button" role="option" aria-selected={selectedLayer === item.id} className={cn('flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted', selectedLayer === item.id && 'bg-muted')} onClick={() => onLayerChange(item.id)}>
            <LayerGlyph color={item.color} shape={item.shape ?? 'fill'} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {selectedLayer === item.id ? <Check className="size-4" /> : <span className="size-4" />}
          </button>
        ))}
        {visibleLayers.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">No layers match</p>}
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
  gridStyle,
  selected,
  style,
  onSelect,
}: {
  row: TRow
  index: number
  columns: Array<MapFeatureTableColumn<TRow>>
  gridStyle: CSSProperties
  selected: boolean
  style?: CSSProperties
  onSelect: (row: TRow) => void
}) {
  return (
    <div
      role="row"
      aria-rowindex={index + 1}
      aria-selected={selected}
      tabIndex={0}
      style={{ ...gridStyle, ...style }}
      className={cn('cursor-pointer border-b border-border/70 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring', selected && 'bg-primary/10 hover:bg-primary/15')}
      onClick={() => onSelect(row)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(row)
      }}
    >
      <div role="cell" className="flex items-center bg-muted/30 px-3 py-2 text-muted-foreground tabular-nums">{index + 1}</div>
      {columns.map((column) => {
        const value = column.getValue(row)
        const isEmpty = value == null || value === ''
        const type = column.type ?? 'text'
        return (
          <div
            key={column.id}
            role="cell"
            className={cn('flex min-w-0 items-center px-3 py-2', type === 'numeric' && 'justify-end tabular-nums', column.widthClassName)}
          >
            <span className={cn('block truncate', isEmpty && 'text-muted-foreground')} title={isEmpty ? undefined : String(value)}>
              {isEmpty ? '—' : value}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function LayerGlyph({ color, shape }: { color: string; shape: 'fill' | 'line' }) {
  if (shape === 'line') {
    return <span className="block h-1 w-6 shrink-0 rounded-full" style={{ backgroundColor: color }} />
  }
  return <span className="block size-4 shrink-0 rounded border" style={{ backgroundColor: color, borderColor: color }} />
}
