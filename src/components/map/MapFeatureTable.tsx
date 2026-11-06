import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  CalendarDays,
  CaseSensitive,
  Check,
  ChevronDown,
  Download,
  Hash,
  Maximize2,
  Minimize2,
  Search,
  Square,
  SquareCheck,
  Table2,
  X,
} from 'lucide-react'
import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ActionMenu } from '@/components/ui/action-menu'
import { AnchoredPopover } from '@/components/ui/anchored-popover'
import { LayerSwatch, type LayerSwatchShape } from '@/components/ui/layer-list-item'
import { SearchInput } from '@/components/ui/map-panels'
import { MobileFeatureCard } from '@/components/ui/mobile-feature-card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { useIsMobile } from '@/hooks/useIsMobile'
import { downloadText } from '@/lib/download'
import { DEFAULT_LOCALE } from '@/lib/format'
import { cn } from '@/lib/utils'
import { MOTION_DURATION, MOTION_EASING, useReducedMotion } from '@pgmaps/geo-toolkit/ui/motion'
import {
  INDEX_COLUMN_WIDTH,
  buildSearchIndex,
  defaultHiddenColumns,
  searchRows,
  sortTableRows,
  tableCsvFileName,
  tableCsvText,
  tableGridLayout,
  type MapFeatureTableColumn,
  type MapFeatureTableColumnType,
  type MapFeatureTableSortDirection,
} from './mapTableModel'

export type { MapFeatureTableColumn, MapFeatureTableColumnType, MapFeatureTableSortDirection } from './mapTableModel'

/** Row height in px. Fixed so the virtualizer can measure without a layout pass. */
const ROW_HEIGHT = 32
/** Sticky column header height, kept clear when a selected row scrolls into view. */
const HEADER_HEIGHT = 36
/** Opaque version of `bg-primary/10`: pinned cells must hide the columns sliding under them. */
const PINNED_SELECTED_CLASS =
  'bg-[color-mix(in_srgb,hsl(var(--primary))_10%,hsl(var(--background)))] group-hover/row:bg-[color-mix(in_srgb,hsl(var(--primary))_15%,hsl(var(--background)))]'
/** Below this row count the grid renders every row, which keeps tests and small tables simple. */
const VIRTUALIZE_THRESHOLD = 60

/**
 * Pane heights are px, not percentages: the docked pane is sized via the layout
 * root's padding-bottom, and percentage padding resolves against *width* in CSS.
 */
export const DEFAULT_TABLE_PANE_HEIGHT = 320

/** Every word the table adds around a page's own data, for a page in another language. */
export interface MapFeatureTableLabels {
  all: string
  visible: string
  rows: (count: string) => string
  shownOf: (shown: string, total: string) => string
  search: string
  searchPlaceholder: string
  options: string
  downloadCsv: (count: string) => string
  columns: string
  sortAscending: string
  sortDescending: string
  resetSort: string
  columnStats: string
  columnOptions: (column: string) => string
  close: string
  expand: string
  collapse: string
  loading: string
  loadFailed: string
  noRows: string
  noRowsInView: string
  /** Number format for the counts. Defaults to the application's locale. */
  locale?: string
}

export const DEFAULT_TABLE_LABELS: MapFeatureTableLabels = {
  all: 'All',
  visible: 'Visible',
  rows: (count) => `${count} ${count === '1' ? 'row' : 'rows'}`,
  shownOf: (shown, total) => `${shown} of ${total}`,
  search: 'Search table',
  searchPlaceholder: 'Type to search…',
  options: 'Table options',
  downloadCsv: (count) => `Download CSV (${count} ${count === '1' ? 'row' : 'rows'})`,
  columns: 'Columns',
  sortAscending: 'Sort ascending',
  sortDescending: 'Sort descending',
  resetSort: 'Reset sort',
  columnStats: 'Column stats',
  columnOptions: (column) => `${column} column options`,
  close: 'Close',
  expand: 'Expand table pane',
  collapse: 'Collapse table pane',
  loading: 'Loading rows…',
  loadFailed: 'Could not load these rows',
  noRows: 'No rows',
  noRowsInView: 'No rows in the current view',
}
const MIN_PANEL_HEIGHT = 160
/** Map kept visible above the pane when it is dragged to the top. Full screen covers it all. */
const MIN_MAP_HEIGHT = 120

export type MapFeatureTableViewMode = 'all' | 'visible'

export interface MapFeatureTableLayer<TLayerId extends string = string> {
  id: TLayerId
  label: string
  color: string
  shape?: LayerSwatchShape
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
  /** Notifies the map host so expensive canvas resizes can be deferred during a drag. */
  onResizeStart?: () => void
  onResizeEnd?: () => void
  /** Adds Sort ascending/descending to each column header's menu, like Felt's table. */
  sortable?: boolean
  /**
   * Adds "Column stats" to each column header's menu. Receives the rows as shown
   * (after search and filters); return null when a column has nothing to show.
   */
  renderColumnStats?: (columnId: string, rows: TRow[]) => ReactNode
  /** Adds "Download CSV" to the table's options menu. On by default. */
  exportable?: boolean
  /** File name for the CSV download. Defaults to the layer's label. */
  exportFileName?: string
  /** Adds column show/hide to the table's options menu. On by default. */
  columnPicker?: boolean
  /** Replaces the table's own words, for a page in another language. */
  labels?: MapFeatureTableLabels
}

interface TableSort {
  columnId: string
  direction: MapFeatureTableSortDirection
}

/** The map's "Table" button: labelled from tablet width up, an icon on phones. */
export function MapTableButton({
  label = 'Open table',
  text = 'Table',
  className,
  onClick,
}: {
  /** Accessible name. */
  label?: string
  /** What the button shows from tablet width up. */
  text?: string
  className?: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'flex h-9 min-w-9 shrink-0 items-center justify-center gap-2 rounded-md border border-border bg-background text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-muted md:px-2.5',
        className,
      )}
      onClick={onClick}
    >
      <Table2 className="size-4" aria-hidden="true" />
      <span className="hidden md:inline">{text}</span>
    </button>
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
  onResizeStart,
  onResizeEnd,
  sortable = false,
  renderColumnStats,
  exportable = true,
  exportFileName,
  columnPicker = true,
  labels = DEFAULT_TABLE_LABELS,
}: MapFeatureTablePanelProps<TRow, TLayerId>) {
  const isMobile = useIsMobile()
  const [uncontrolledQuery, setUncontrolledQuery] = useState('')
  // Keyed by layer, so switching layers drops a sort on a column the new layer may not have.
  const [sortState, setSortState] = useState<(TableSort & { layer: TLayerId }) | null>(null)
  const sort = sortState && sortState.layer === selectedLayer ? sortState : null
  const setSort = useCallback(
    (next: TableSort | null) => setSortState(next ? { ...next, layer: selectedLayer } : null),
    [selectedLayer],
  )
  const [layerPickerOpen, setLayerPickerOpen] = useState(false)
  const [uncontrolledHeight, setUncontrolledHeight] = useState(DEFAULT_TABLE_PANE_HEIGHT)
  const panelHeight = controlledHeight ?? uncontrolledHeight
  const setPanelHeight = onHeightChange ?? setUncontrolledHeight
  const query = controlledQuery ?? uncontrolledQuery
  const setQuery = onQueryChange ?? setUncontrolledQuery
  const activeLayer = layers.find((candidate) => candidate.id === selectedLayer) ?? layers[0]

  // Hidden columns are remembered per layer; a layer starts from its columns' defaults.
  const [hiddenByLayer, setHiddenByLayer] = useState<Partial<Record<TLayerId, ReadonlySet<string>>>>({})
  const hiddenColumns = useMemo(
    () => hiddenByLayer[selectedLayer] ?? defaultHiddenColumns(columns),
    [columns, hiddenByLayer, selectedLayer],
  )
  const shownColumns = useMemo(
    () => columns.filter((column) => !hiddenColumns.has(column.id)),
    [columns, hiddenColumns],
  )
  const toggleColumn = useCallback(
    (columnId: string) => {
      const next = new Set(hiddenColumns)
      if (next.has(columnId)) next.delete(columnId)
      else next.add(columnId)
      setHiddenByLayer((current) => ({ ...current, [selectedLayer]: next }))
    },
    [hiddenColumns, selectedLayer],
  )

  // The field stays responsive while a long table catches up with the typing.
  const deferredQuery = useDeferredValue(query)
  const searching = deferredQuery.trim().length > 0
  const searchIndex = useMemo(
    () => (searching ? buildSearchIndex(rows, shownColumns) : []),
    [rows, searching, shownColumns],
  )
  const filteredRows = useMemo(
    () => (searching ? searchRows(rows, searchIndex, deferredQuery) : rows),
    [deferredQuery, rows, searchIndex, searching],
  )

  const sortedRows = useMemo(() => {
    const column = sort ? shownColumns.find((candidate) => candidate.id === sort.columnId) : undefined
    return sort && column ? sortTableRows(filteredRows, column, sort.direction) : filteredRows
  }, [filteredRows, shownColumns, sort])

  const exportCsv = useCallback(() => {
    const fileName = tableCsvFileName(exportFileName ?? activeLayer?.label ?? title)
    downloadText(tableCsvText(sortedRows, shownColumns), fileName, 'text/csv')
  }, [activeLayer?.label, exportFileName, shownColumns, sortedRows, title])

  /**
   * `paneActions` puts expand/close on the toolbar row itself (Felt keeps the whole
   * table chrome on one line). Mobile passes none, since the sheet card supplies its
   * own header and close button.
   */
  const renderBody = (paneActions?: TablePaneActions) => (
    <TableBody
      rows={sortedRows}
      totalRowCount={rows.length}
      columns={shownColumns}
      allColumns={columns}
      hiddenColumns={hiddenColumns}
      columnPicker={columnPicker}
      exportable={exportable}
      labels={labels}
      onToggleColumn={toggleColumn}
      onExportCsv={exportCsv}
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
      sortable={sortable}
      sort={sort}
      renderColumnStats={renderColumnStats}
      onSortChange={setSort}
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
        /* Rendered as a MobileFeatureCard so the table joins the same mobile card
           stack as a focused feature, instead of colliding with it. Mounted on
           phones only: an open card makes MapSectionLayout swallow the next
           sidebar click to bring the sheet forward, at any width. */
        isMobile && (
          <MobileFeatureCard
            stackId="map-feature-table"
            title={title}
            /* Opening another layer's table from the controls brings this card forward. */
            focusKey={selectedLayer}
            /* No subtitle: the layer picker in the toolbar below already names the layer. */
            contentClassName="px-0 py-0"
            collapseOnMapInteraction={false}
            closeOnBlankMapClick={false}
            onClose={onClose}
          >
            {renderBody()}
          </MobileFeatureCard>
        )
      ) : (
        <div
          role="dialog"
          aria-label={title}
          className="absolute inset-x-0 bottom-0 z-50 flex h-[calc(100%-74px)] flex-col overflow-hidden rounded-t-lg border border-b-0 border-border bg-background shadow-[0_-2px_16px_rgba(0,0,0,0.3)] md:hidden"
        >
          <TableHeader title={title} onClose={onClose} />
          {renderBody()}
        </div>
      )}

      <DesktopTablePanel
        title={title}
        height={panelHeight}
        resizable={resizable}
        onHeightChange={setPanelHeight}
        onResizeStart={onResizeStart}
        onResizeEnd={onResizeEnd}
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
 * padding-bottom, so the sidebars and the map's controls are shortened, while the
 * map's canvas extends underneath and is covered rather than resized (as in
 * Felt). Full screen covers the whole layout and restores the previous height.
 */
function DesktopTablePanel({
  title,
  height,
  resizable,
  onHeightChange,
  onResizeStart,
  onResizeEnd,
  onClose,
  children,
}: {
  title: string
  height: number
  resizable: boolean
  onHeightChange: (height: number) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
  onClose: () => void
  children: (paneActions: TablePaneActions) => ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const [containerHeight, setContainerHeight] = useState(0)
  /** Height to return to when leaving full screen; null while not full screen. */
  const [restoreHeight, setRestoreHeight] = useState<number | null>(null)
  const reducedMotion = useReducedMotion()

  // Measured rather than read from the ref during render, so `expanded` is correct
  // on the first paint. ResizeObserver fires once on observe, so no sync setState.
  useEffect(() => {
    const parent = panelRef.current?.closest<HTMLElement>('[data-map-layout-root]') ?? panelRef.current?.parentElement
    if (!parent) return
    const observer = new ResizeObserver(() => setContainerHeight(parent.getBoundingClientRect().height))
    observer.observe(parent)
    return () => observer.disconnect()
  }, [])

  /** Tallest the pane may grow, leaving a strip of map visible above it. */
  const maxHeight =
    containerHeight > 0 ? Math.max(MIN_PANEL_HEIGHT, containerHeight - MIN_MAP_HEIGHT) : Number.POSITIVE_INFINITY

  const clamp = useCallback((next: number) => Math.min(maxHeight, Math.max(MIN_PANEL_HEIGHT, next)), [maxHeight])

  const fullScreen = restoreHeight !== null
  const expanded = fullScreen || (containerHeight > 0 && height >= containerHeight - 1)

  // Full screen follows the layout's height, e.g. when the window is resized.
  useEffect(() => {
    if (fullScreen && containerHeight > 0 && Math.abs(height - containerHeight) >= 1) onHeightChange(containerHeight)
  }, [containerHeight, fullScreen, height, onHeightChange])

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!resizable) return
      const parent = panelRef.current?.closest<HTMLElement>('[data-map-layout-root]') ?? panelRef.current?.parentElement
      if (!parent) return
      event.preventDefault()
      const parentBottom = parent.getBoundingClientRect().bottom
      setDragging(true)
      setRestoreHeight(null)
      onResizeStart?.()

      const move = (moveEvent: PointerEvent) => onHeightChange(clamp(parentBottom - moveEvent.clientY))
      const finish = () => {
        setDragging(false)
        onResizeEnd?.()
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', finish)
        window.removeEventListener('pointercancel', finish)
        window.removeEventListener('blur', finish)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', finish)
      window.addEventListener('pointercancel', finish)
      window.addEventListener('blur', finish)
    },
    [clamp, onHeightChange, onResizeEnd, onResizeStart, resizable],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setRestoreHeight(null)
        onHeightChange(clamp(height + 32))
      } else if (event.key === 'ArrowDown') {
        event.preventDefault()
        setRestoreHeight(null)
        onHeightChange(clamp(height - 32))
      }
    },
    [clamp, height, onHeightChange],
  )

  return (
    <div
      ref={panelRef}
      data-panel="data-table-panel"
      aria-label={`${title} pane`}
      /* No drop shadow: the pane is docked in the layout rather than floating over
         the map, so the 1px top border is the only separation it needs. */
      className="absolute inset-x-0 bottom-0 z-30 hidden flex-col overflow-hidden border border-x-0 border-b-0 border-border bg-background md:flex"
      style={{
        height,
        transition: dragging || reducedMotion ? 'none' : `height ${MOTION_DURATION.panel}ms ${MOTION_EASING}`,
      }}
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
        onToggleExpanded: () => {
          if (expanded) {
            setRestoreHeight(null)
            onHeightChange(clamp(restoreHeight ?? DEFAULT_TABLE_PANE_HEIGHT))
          } else if (containerHeight > 0) {
            setRestoreHeight(height)
            onHeightChange(containerHeight)
          }
        },
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
  allColumns,
  hiddenColumns,
  columnPicker,
  exportable,
  labels,
  onToggleColumn,
  onExportCsv,
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
  sortable,
  sort,
  renderColumnStats,
  onSortChange,
  onQueryChange,
  onLayerPickerOpenChange,
  onLayerChange,
  onShowOnlyInViewChange,
  onSelect,
}: {
  rows: TRow[]
  totalRowCount: number
  columns: Array<MapFeatureTableColumn<TRow>>
  allColumns: Array<MapFeatureTableColumn<TRow>>
  hiddenColumns: ReadonlySet<string>
  columnPicker: boolean
  exportable: boolean
  labels: MapFeatureTableLabels
  onToggleColumn: (columnId: string) => void
  onExportCsv: () => void
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
  sortable: boolean
  sort: TableSort | null
  renderColumnStats?: (columnId: string, rows: TRow[]) => ReactNode
  onSortChange: (sort: TableSort | null) => void
  onQueryChange: (query: string) => void
  onLayerPickerOpenChange: (open: boolean) => void
  onLayerChange: (layer: TLayerId) => void
  onShowOnlyInViewChange?: (enabled: boolean) => void
  onSelect: (row: TRow) => void
}) {
  const showViewModeToggle = viewModeToggle && showOnlyInViewEnabled
  const layerPickerAnchorRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          {activeLayer && (
            <div className="relative" data-layer-picker-root="true">
              {/* Doubles as the pane heading, the way Felt's table titles its layer. */}
              <button
                ref={layerPickerAnchorRef}
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
                <LayerSwatch color={activeLayer.color} shape={activeLayer.shape ?? 'fill'} />
                <span className="truncate">{activeLayer.label}</span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
              {layerPickerOpen && (
                <LayerPicker
                  anchorRef={layerPickerAnchorRef}
                  layers={layers}
                  selectedLayer={selectedLayer}
                  showOnlyInView={showOnlyInView}
                  showOnlyInViewEnabled={showOnlyInViewEnabled && !showViewModeToggle}
                  onClose={() => onLayerPickerOpenChange(false)}
                  onLayerChange={(layer) => {
                    onLayerChange(layer)
                    onLayerPickerOpenChange(false)
                  }}
                  onShowOnlyInViewChange={onShowOnlyInViewChange}
                />
              )}
            </div>
          )}

          {showViewModeToggle && (
            <>
              <span className="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
              <ViewModeToggle
                labels={labels}
                showOnlyInView={showOnlyInView}
                onShowOnlyInViewChange={onShowOnlyInViewChange}
              />
            </>
          )}

          <div className="min-w-0 flex-1" />

          <span className="hidden shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground sm:inline">
            {rows.length === totalRowCount
              ? labels.rows(totalRowCount.toLocaleString(labels.locale ?? DEFAULT_LOCALE))
              : labels.shownOf(
                  rows.length.toLocaleString(labels.locale ?? DEFAULT_LOCALE),
                  totalRowCount.toLocaleString(labels.locale ?? DEFAULT_LOCALE),
                )}
          </span>

          {showOnlyInViewEnabled && !showViewModeToggle && (
            <button
              type="button"
              className={cn('rounded-md p-2 hover:bg-muted', showOnlyInView && 'bg-muted')}
              aria-label="Show only features in view"
              onClick={() => onShowOnlyInViewChange?.(!showOnlyInView)}
            >
              <SquareCheck className="size-4" />
            </button>
          )}

          <TableSearch labels={labels} query={query} collapsible={collapsibleSearch} onQueryChange={onQueryChange} />

          {(exportable || columnPicker) && (
            <ActionMenu
              label={labels.options}
              width={260}
              items={[
                exportable && {
                  id: 'export-csv',
                  label: labels.downloadCsv(rows.length.toLocaleString(labels.locale ?? DEFAULT_LOCALE)),
                  icon: <Download className="size-4" />,
                  disabled: rows.length === 0,
                  onSelect: onExportCsv,
                },
                exportable && columnPicker && { type: 'separator', id: 'columns-separator' },
                columnPicker && { type: 'label', id: 'columns-label', label: labels.columns },
                ...(columnPicker
                  ? allColumns.map((column) => {
                      const shown = !hiddenColumns.has(column.id)
                      return {
                        id: `column-${column.id}`,
                        label: column.header,
                        checked: shown,
                        keepOpen: true,
                        // A table always keeps one column.
                        disabled: shown && columns.length === 1,
                        onSelect: () => onToggleColumn(column.id),
                      }
                    })
                  : []),
              ]}
            />
          )}

          {paneActions && (
            <>
              {paneActions.expandable && (
                <button
                  type="button"
                  className="shrink-0 rounded-md p-2 hover:bg-muted"
                  onClick={paneActions.onToggleExpanded}
                  aria-label={paneActions.expanded ? labels.collapse : labels.expand}
                  aria-pressed={paneActions.expanded}
                >
                  {paneActions.expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                </button>
              )}
              <button
                type="button"
                className="shrink-0 rounded-md p-2 hover:bg-muted"
                onClick={paneActions.onClose}
                aria-label={labels.close}
              >
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
        sortable={sortable}
        sort={sort}
        labels={labels}
        showIndex={Boolean(paneActions)}
        renderColumnStats={renderColumnStats}
        onSortChange={onSortChange}
        onSelect={onSelect}
      />
    </div>
  )
}

/** Felt-style All/Visible segmented control. Maps onto the showOnlyInView flag. */
function ViewModeToggle({
  labels,
  showOnlyInView,
  onShowOnlyInViewChange,
}: {
  labels: MapFeatureTableLabels
  showOnlyInView: boolean
  onShowOnlyInViewChange?: (enabled: boolean) => void
}) {
  return (
    <SegmentedControl
      label="View mode"
      size="sm"
      fullWidth={false}
      className="shrink-0"
      value={showOnlyInView ? 'visible' : 'all'}
      options={[
        { value: 'all', label: labels.all },
        { value: 'visible', label: labels.visible },
      ]}
      onChange={(mode) => onShowOnlyInViewChange?.(mode === 'visible')}
    />
  )
}

/** Search that starts as an icon and expands into an input, matching Felt's toolbar. */
function TableSearch({
  labels,
  query,
  collapsible,
  onQueryChange,
}: {
  labels: MapFeatureTableLabels
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
      <button
        type="button"
        className="shrink-0 rounded-md p-2 hover:bg-muted"
        aria-label={labels.search}
        onClick={() => setOpen(true)}
      >
        <Search className="size-4" />
      </button>
    )
  }

  return (
    <div className="w-[min(15rem,42vw)] max-w-52 shrink-0">
      <SearchInput
        ref={inputRef}
        icon
        onClear={() => {
          onQueryChange('')
          inputRef.current?.focus()
        }}
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        onBlur={() => {
          if (collapsible && !query) setOpen(false)
        }}
        onKeyDown={(event) => {
          if (event.key !== 'Escape') return
          onQueryChange('')
          if (collapsible) setOpen(false)
        }}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.search}
        className="h-9 rounded-md border-border py-0 focus:ring-1"
      />
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
  sortable,
  sort,
  labels,
  showIndex,
  renderColumnStats,
  onSortChange,
  onSelect,
}: {
  rows: TRow[]
  columns: Array<MapFeatureTableColumn<TRow>>
  getRowId: (row: TRow) => string
  emptyMessage: string
  selectedRowId: string | null
  sortable: boolean
  sort: TableSort | null
  labels: MapFeatureTableLabels
  /** Row numbers. Phones drop them, so a pinned name and one more column fit. */
  showIndex: boolean
  renderColumnStats?: (columnId: string, rows: TRow[]) => ReactNode
  onSortChange: (sort: TableSort | null) => void
  onSelect: (row: TRow) => void
}) {
  'use no memo' // TanStack Virtual exposes mutable instance methods; keep this owner outside React Compiler.
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = rows.length > VIRTUALIZE_THRESHOLD

  const layout = useMemo(() => tableGridLayout(columns, showIndex), [columns, showIndex])
  const gridStyle = useMemo<CSSProperties>(
    () => ({ display: 'grid', gridTemplateColumns: layout.template }),
    [layout.template],
  )
  const pinnedLeft = showIndex ? INDEX_COLUMN_WIDTH : 0
  const selectedIndex = useMemo(
    () => (selectedRowId == null ? -1 : rows.findIndex((row) => getRowId(row) === selectedRowId)),
    [getRowId, rows, selectedRowId],
  )

  // TanStack's virtualizer is mutable and deliberately excluded from compiler memoization above.
  // eslint-disable-next-line react-hooks/incompatible-library -- Preserve live virtualizer reads; memoizing its methods can freeze scrolling.
  const virtualizer = useVirtualizer({
    count: virtualize ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    scrollPaddingStart: HEADER_HEIGHT,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // A row picked on the map, or opened from a link, may be far down the table.
  useEffect(() => {
    if (selectedIndex < 0) return
    if (virtualize) virtualizer.scrollToIndex(selectedIndex, { align: 'auto' })
    else scrollRef.current?.querySelector('[role="row"][aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex, virtualize, virtualizer])

  return (
    <div ref={scrollRef} aria-label="Data table pane" className="min-h-0 flex-1 scroll-pt-9 overflow-auto">
      <div style={{ minWidth: layout.minWidth }}>
        <div role="table" aria-rowcount={rows.length} className="text-sm">
          <div role="rowgroup" className="sticky top-0 z-10 bg-background">
            <div
              role="row"
              style={gridStyle}
              className="border-b border-border text-left text-xs text-muted-foreground"
            >
              {showIndex && (
                <div
                  role="columnheader"
                  className="sticky left-0 z-[2] flex items-center bg-background px-3 py-2 font-medium"
                >
                  #
                </div>
              )}
              {columns.map((column, columnIndex) => {
                const direction = sort?.columnId === column.id ? sort.direction : null
                return (
                  <div
                    key={column.id}
                    role="columnheader"
                    aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : undefined}
                    style={columnIndex === 0 ? { left: pinnedLeft } : undefined}
                    className={cn(
                      'flex min-w-0 items-center gap-1.5 px-3 py-2 font-medium',
                      (sortable || renderColumnStats) && 'px-1.5 py-1',
                      columnIndex === 0 && 'sticky z-[2] border-r border-border/70 bg-background',
                      column.widthClassName,
                    )}
                  >
                    {sortable || renderColumnStats ? (
                      <ColumnHeaderMenu
                        column={column}
                        rows={rows}
                        direction={direction}
                        sortable={sortable}
                        labels={labels}
                        renderColumnStats={renderColumnStats}
                        onSortChange={onSortChange}
                      />
                    ) : (
                      <>
                        <ColumnTypeGlyph type={column.type ?? 'text'} />
                        <span className="block truncate" title={column.header}>
                          {column.header}
                        </span>
                      </>
                    )}
                  </div>
                )
              })}
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
                    showIndex={showIndex}
                    pinnedLeft={pinnedLeft}
                    selected={getRowId(row) === selectedRowId}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      height: virtualRow.size,
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
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
                  showIndex={showIndex}
                  pinnedLeft={pinnedLeft}
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

/** Header label that opens Felt's column menu: sort, reset sort, column stats. */
function ColumnHeaderMenu<TRow>({
  column,
  rows,
  direction,
  sortable,
  labels,
  renderColumnStats,
  onSortChange,
}: {
  column: MapFeatureTableColumn<TRow>
  rows: TRow[]
  direction: MapFeatureTableSortDirection | null
  sortable: boolean
  labels: MapFeatureTableLabels
  renderColumnStats?: (columnId: string, rows: TRow[]) => ReactNode
  onSortChange: (sort: TableSort | null) => void
}) {
  const anchorRef = useRef<HTMLSpanElement>(null)
  const [statsOpen, setStatsOpen] = useState(false)
  const closeStats = useCallback(() => setStatsOpen(false), [])
  const SortIcon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : null

  return (
    <span ref={anchorRef} className="flex min-w-0 flex-1">
      <ActionMenu
        label={labels.columnOptions(column.header)}
        align="start"
        width={200}
        triggerClassName="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1.5 py-1 text-left hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        trigger={
          <>
            <ColumnTypeGlyph type={column.type ?? 'text'} />
            <span className="block truncate" title={column.header}>
              {column.header}
            </span>
            {SortIcon && (
              <SortIcon
                className="size-3.5 shrink-0 text-foreground"
                aria-label={direction === 'asc' ? 'Sorted ascending' : 'Sorted descending'}
              />
            )}
          </>
        }
        items={[
          sortable &&
            direction !== 'asc' && {
              id: 'asc',
              label: labels.sortAscending,
              icon: <ArrowUp className="size-4" />,
              onSelect: () => onSortChange({ columnId: column.id, direction: 'asc' }),
            },
          sortable &&
            direction !== 'desc' && {
              id: 'desc',
              label: labels.sortDescending,
              icon: <ArrowDown className="size-4" />,
              onSelect: () => onSortChange({ columnId: column.id, direction: 'desc' }),
            },
          sortable &&
            direction && {
              id: 'reset',
              label: labels.resetSort,
              icon: <X className="size-4" />,
              onSelect: () => onSortChange(null),
            },
          renderColumnStats && {
            id: 'stats',
            label: labels.columnStats,
            icon: <BarChart3 className="size-4" />,
            onSelect: () => setStatsOpen(true),
          },
        ]}
      />
      {renderColumnStats && (
        <AnchoredPopover
          anchorRef={anchorRef}
          open={statsOpen}
          onClose={closeStats}
          width={272}
          role="dialog"
          ariaLabel={`${column.header} statistics`}
        >
          {renderColumnStats(column.id, rows)}
        </AnchoredPopover>
      )}
    </span>
  )
}

function ColumnTypeGlyph({ type }: { type: MapFeatureTableColumnType }) {
  const Icon = type === 'numeric' ? Hash : type === 'datetime' ? CalendarDays : CaseSensitive
  return <Icon className="size-3.5 shrink-0 text-muted-foreground/60" aria-hidden="true" />
}

function LayerPicker<TLayerId extends string>({
  anchorRef,
  layers,
  selectedLayer,
  showOnlyInView,
  showOnlyInViewEnabled,
  onClose,
  onLayerChange,
  onShowOnlyInViewChange,
}: {
  anchorRef: RefObject<HTMLButtonElement>
  layers: Array<MapFeatureTableLayer<TLayerId>>
  selectedLayer: TLayerId
  showOnlyInView: boolean
  showOnlyInViewEnabled: boolean
  onClose: () => void
  onLayerChange: (layer: TLayerId) => void
  onShowOnlyInViewChange?: (enabled: boolean) => void
}) {
  const [layerQuery, setLayerQuery] = useState('')
  const [position, setPosition] = useState<{
    left: number
    width: number
    maxHeight: number
    top?: number
    bottom?: number
    placement: 'top' | 'bottom'
  } | null>(null)

  useLayoutEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    const updatePosition = () => {
      const rect = anchor.getBoundingClientRect()
      // The table body is mounted twice (mobile + desktop). Only portal the
      // picker belonging to the currently visible body.
      if (rect.width === 0 || rect.height === 0) {
        setPosition(null)
        return
      }

      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      const viewportMargin = 12
      const gap = 6
      const width = Math.max(0, Math.min(288, viewportWidth - viewportMargin * 2))
      const left = Math.min(Math.max(viewportMargin, rect.left), viewportWidth - width - viewportMargin)
      const availableBelow = viewportHeight - rect.bottom - gap - viewportMargin
      const availableAbove = rect.top - gap - viewportMargin
      const desiredHeight = showOnlyInViewEnabled ? 350 : 310
      const opensBelow = availableBelow >= desiredHeight || availableBelow >= availableAbove
      const maxHeight = Math.max(0, opensBelow ? availableBelow : availableAbove)

      setPosition(
        opensBelow
          ? { left, width, maxHeight, top: rect.bottom + gap, placement: 'bottom' }
          : { left, width, maxHeight, bottom: viewportHeight - rect.top + gap, placement: 'top' },
      )
    }

    updatePosition()
    const observer = new ResizeObserver(updatePosition)
    observer.observe(anchor)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, showOnlyInViewEnabled])

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

  if (!position) return null

  return createPortal(
    <div
      data-layer-picker-root="true"
      data-layer-picker-placement={position.placement}
      className="fixed z-[100] flex flex-col overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-xl"
      style={{
        left: position.left,
        top: position.top,
        bottom: position.bottom,
        width: position.width,
        maxHeight: position.maxHeight,
      }}
    >
      <div className="shrink-0 border-b border-border p-2">
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
      <div role="listbox" aria-label="Table layer" className="min-h-0 flex-1 overflow-auto py-1">
        {visibleLayers.map((item) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={selectedLayer === item.id}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted',
              selectedLayer === item.id && 'bg-muted',
            )}
            onClick={() => onLayerChange(item.id)}
          >
            <LayerSwatch color={item.color} shape={item.shape ?? 'fill'} />
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {selectedLayer === item.id ? <Check className="size-4" /> : <span className="size-4" />}
          </button>
        ))}
        {visibleLayers.length === 0 && (
          <p className="px-3 py-4 text-center text-sm text-muted-foreground">No layers match</p>
        )}
      </div>
      {showOnlyInViewEnabled && (
        <button
          type="button"
          role="menuitemcheckbox"
          aria-checked={showOnlyInView}
          className="flex w-full shrink-0 items-center gap-3 border-t border-border px-3 py-2 text-left text-sm hover:bg-muted"
          onClick={() => onShowOnlyInViewChange?.(!showOnlyInView)}
        >
          {showOnlyInView ? <SquareCheck className="size-4" /> : <Square className="size-4" />}
          <span>Show only features in view</span>
        </button>
      )}
    </div>,
    document.body,
  )
}

function TableRow<TRow>({
  row,
  index,
  columns,
  gridStyle,
  showIndex,
  pinnedLeft,
  selected,
  style,
  onSelect,
}: {
  row: TRow
  index: number
  columns: Array<MapFeatureTableColumn<TRow>>
  gridStyle: CSSProperties
  showIndex: boolean
  pinnedLeft: number
  selected: boolean
  style?: CSSProperties
  onSelect: (row: TRow) => void
}) {
  const pinnedBackground = selected ? PINNED_SELECTED_CLASS : 'bg-background group-hover/row:bg-muted'
  return (
    <div
      role="row"
      aria-rowindex={index + 1}
      aria-selected={selected}
      tabIndex={0}
      style={{ ...gridStyle, ...style }}
      className={cn(
        'group/row cursor-pointer border-b border-border/70 outline-none hover:bg-muted focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
        selected && 'bg-primary/10 hover:bg-primary/15',
      )}
      onClick={() => onSelect(row)}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onSelect(row)
      }}
    >
      {showIndex && (
        <div
          role="cell"
          className={cn(
            'sticky left-0 z-[1] flex items-center px-3 py-2 text-muted-foreground tabular-nums',
            pinnedBackground,
          )}
        >
          {index + 1}
        </div>
      )}
      {columns.map((column, columnIndex) => {
        const value = column.getValue(row)
        const isEmpty = value == null || value === ''
        const type = column.type ?? 'text'
        return (
          <div
            key={column.id}
            role="cell"
            style={columnIndex === 0 ? { left: pinnedLeft } : undefined}
            className={cn(
              'flex min-w-0 items-center px-3 py-2',
              type === 'numeric' && 'justify-end tabular-nums',
              columnIndex === 0 && cn('sticky z-[1] border-r border-border/70', pinnedBackground),
              column.widthClassName,
            )}
          >
            <span
              className={cn('block truncate', isEmpty && 'text-muted-foreground')}
              title={isEmpty || typeof value === 'object' ? undefined : String(value)}
            >
              {isEmpty ? '—' : value}
            </span>
          </div>
        )
      })}
    </div>
  )
}
