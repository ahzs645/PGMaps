import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ColumnStatsSummary } from '@/components/ui/column-stats'
import type { LayerSwatchShape } from '@/components/ui/layer-list-item'
import { useMap } from '@/components/ui/map'
import { useFlyToSelection } from '@/components/ui/map-fly-to'
import { setPaneResizing } from '@/components/ui/pane-resize'
import { useObserveMapViewport } from '@/components/ui/map-viewport'
import { useSetUrlParams } from '@/hooks/useUrlState'
import { boundsOverlap, type ViewportBounds } from '@/lib/featureBounds'
import { DEFAULT_LOCALE, formatDate } from '@/lib/format'
import {
  DEFAULT_TABLE_LABELS,
  DEFAULT_TABLE_PANE_HEIGHT,
  MapFeatureTablePanel,
  MapTableButton,
  type MapFeatureTableColumn,
  type MapFeatureTableLabels,
  type MapFeatureTableLayer,
} from './MapFeatureTable'
import { tableColumnStats } from './mapTableModel'

const TABLE_PARAM = 'table'
const ROW_PARAM = 'row'
const DEFAULT_FLY_ZOOM = 13.5
const DEFAULT_SWATCH_COLOR = '#64748b'

/**
 * One table a page offers, usually one map layer. `rows` must be the set the map
 * and the page's filters currently show, so the table never disagrees with them.
 * Memoize sources: a new `columns` array rebuilds the table's search index.
 */
export interface MapTableSource<TRow = unknown> {
  id: string
  label: string
  color?: string
  shape?: LayerSwatchShape
  /** Pass a function when building rows is costly; only the open table's runs. */
  rows: TRow[] | (() => TRow[])
  columns: Array<MapFeatureTableColumn<TRow>>
  getRowId: (row: TRow) => string
  /** Enables flying to a row and, with `getRowBounds`, the All/Visible toggle. */
  getRowCenter?: (row: TRow) => [number, number] | null
  /** For lines and polygons, so "Visible" keeps a shape whose centre is off screen. */
  getRowBounds?: (row: TRow) => ViewportBounds | null
  flyZoom?: number
  status?: 'loading' | 'error' | 'ready'
  emptyMessage?: string
  exportFileName?: string
}

/** Keeps a page's differently typed sources in one array. */
export function defineTableSource<TRow>(source: MapTableSource<TRow>): MapTableSource {
  return source as unknown as MapTableSource
}

/**
 * Which table is open and how the pane sits. Most pages let `useMapTable` own
 * this; a page calls it directly when it must know the open table before it can
 * build its sources, as `/dev/data` does to fetch that layer.
 */
export function useMapTableState({
  url = true,
  initialHeight = DEFAULT_TABLE_PANE_HEIGHT,
}: { url?: boolean; initialHeight?: number } = {}) {
  const [searchParams, setSearchParams] = useSearchParams()
  const setUrlParams = useSetUrlParams()
  const [local, setLocal] = useState<{ table: string | null; row: string | null }>({ table: null, row: null })
  const [height, setHeight] = useState(initialHeight)
  const [resizing, setResizingState] = useState(false)
  // A `Map` inside a child component reads this instead of taking `deferResize`.
  const resizeToken = useRef(Symbol('map table pane'))
  const setResizing = useCallback((next: boolean) => {
    setResizingState(next)
    setPaneResizing(resizeToken.current, next)
  }, [])
  useEffect(() => {
    const token = resizeToken.current
    return () => setPaneResizing(token, false)
  }, [])
  const [showOnlyInView, setShowOnlyInView] = useState(false)
  const [bounds, setBounds] = useState<ViewportBounds | null>(null)

  const activeId = url ? searchParams.get(TABLE_PARAM) : local.table
  const rowParam = url ? searchParams.get(ROW_PARAM) : local.row

  const write = useCallback(
    (table: string | null, row: string | null) => {
      if (url) setUrlParams({ [TABLE_PARAM]: table, [ROW_PARAM]: row })
      else setLocal({ table, row })
    },
    [setUrlParams, url],
  )
  const open = useCallback((id: string) => write(id, null), [write])
  const close = useCallback(() => write(null, null), [write])

  // A row click also runs the page's selection, which often writes its own parameter
  // in the same tick. Router params lag behind that write, so a write built from them
  // would undo the selection. The row goes in afterwards, on top of the real URL.
  const setSearchParamsRef = useRef(setSearchParams)
  useEffect(() => {
    setSearchParamsRef.current = setSearchParams
  })
  const setRow = useCallback(
    (id: string, row: string) => {
      if (!url) {
        setLocal({ table: id, row })
        return
      }
      window.setTimeout(() => {
        const params = new URLSearchParams(window.location.search)
        params.set(TABLE_PARAM, id)
        params.set(ROW_PARAM, row)
        setSearchParamsRef.current(params, { replace: true })
      }, 0)
    },
    [url],
  )

  return {
    activeId,
    rowParam,
    open,
    close,
    setRow,
    height,
    setHeight,
    resizing,
    setResizing,
    showOnlyInView,
    setShowOnlyInView,
    bounds,
    setBounds,
  }
}

export type MapTableState = ReturnType<typeof useMapTableState>

export interface MapTableOptions {
  /** An empty list means the page has no rows to offer, so no button shows. */
  sources: readonly MapTableSource[]
  /** Opened by the Table button. Defaults to the first source. */
  defaultSourceId?: string
  /** The page's own selection, so a map click marks its row. Defaults to the row in the URL. */
  selectedRowId?: string | null
  /** Runs for a row click and for a row opened from a link. */
  onSelectRow?: (row: never, source: MapTableSource) => void
  /** Keep the table and row in the URL. Turn off for a page that owns its whole URL. */
  url?: boolean
  /** Share state built with `useMapTableState`. */
  state?: MapTableState
  /** Turn off when the page's `onSelectRow` already moves the camera. */
  flyOnSelect?: boolean
  /** The page renders `table.button` in its own map toolbar instead of the standard corner. */
  inlineButton?: boolean
  /** The table's own words, for a page in another language. */
  labels?: MapFeatureTableLabels
  /** Accessible name of the Table button, for a page in another language. */
  buttonLabel?: string
  /** What the Table button shows from tablet width up. */
  buttonText?: string
}

export interface MapTableController {
  state: MapTableState
  activeSource: MapTableSource | undefined
  open: (sourceId?: string) => void
  close: () => void
  /** Moves an open table to another source; does nothing while it is closed. */
  follow: (sourceId: string) => void
  /** Spread on `MapSectionLayout` when it is not given `table`. */
  layout: { bottomPane: ReactNode; bottomPaneHeight: number; bottomPaneResizing: boolean }
  /** Pass to `Map` so a drag does not reallocate the canvas every frame. */
  deferResize: boolean
  button: ReactNode
  inlineButton: boolean
  flyTarget: { center: [number, number] | null; zoom: number; nonce: number }
}

function resolveRows(source: MapTableSource | undefined): unknown[] {
  if (!source) return []
  return typeof source.rows === 'function' ? source.rows() : source.rows
}

function formatColumnStat(column: MapFeatureTableColumn<unknown>, value: number): string {
  return column.type === 'datetime'
    ? formatDate(value)
    : value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 })
}

function rowInView(source: MapTableSource, row: unknown, bounds: ViewportBounds): boolean {
  const box = source.getRowBounds?.(row)
  if (box) return boundsOverlap(box, bounds)
  const center = source.getRowCenter?.(row)
  return center ? boundsOverlap([center[0], center[1], center[0], center[1]], bounds) : false
}

/**
 * The table a map page gets from a list of sources: the docked pane (a card on
 * phones), the Table button, flying to a row, All/Visible, and `?table=&row=`
 * links. Give the result to `MapSectionLayout table={…}` and put
 * `<MapTableBridge table={…} />` inside the `Map`.
 */
export function useMapTable({
  sources,
  defaultSourceId,
  selectedRowId,
  onSelectRow,
  url = true,
  state: sharedState,
  flyOnSelect = true,
  inlineButton = false,
  labels,
  buttonLabel,
  buttonText,
}: MapTableOptions): MapTableController {
  const ownState = useMapTableState({ url })
  const state = sharedState ?? ownState
  const { activeId, rowParam, height, showOnlyInView, bounds, resizing } = state
  const activeSource = useMemo(() => sources.find((source) => source.id === activeId), [activeId, sources])
  const [fly, setFly] = useState<MapTableController['flyTarget']>({ center: null, zoom: DEFAULT_FLY_ZOOM, nonce: 0 })

  const allRows = useMemo(() => resolveRows(activeSource), [activeSource])
  // A repeated id selects the wrong row and breaks `?row=` links, with no error of its own.
  useEffect(() => {
    if (!import.meta.env.DEV || !activeSource) return
    const seen = new Set<string>()
    let repeats = 0
    for (const row of allRows) {
      const id = activeSource.getRowId(row)
      if (seen.has(id)) repeats += 1
      seen.add(id)
    }
    if (repeats > 0) console.warn(`[map table] ${repeats} repeated row ids in "${activeSource.id}"`)
  }, [activeSource, allRows])

  const rows = useMemo(() => {
    if (!activeSource || !showOnlyInView || !bounds) return allRows
    return allRows.filter((row) => rowInView(activeSource, row, bounds))
  }, [activeSource, allRows, bounds, showOnlyInView])

  const onSelectRowRef = useRef(onSelectRow)
  useEffect(() => {
    onSelectRowRef.current = onSelectRow
  })

  const applyRow = useCallback(
    (source: MapTableSource, row: unknown) => {
      const center = flyOnSelect ? (source.getRowCenter?.(row) ?? null) : null
      if (center) {
        setFly((current) => ({ center, zoom: source.flyZoom ?? DEFAULT_FLY_ZOOM, nonce: current.nonce + 1 }))
      }
      onSelectRowRef.current?.(row as never, source)
    },
    [flyOnSelect],
  )

  // Follows a `?table=&row=` link once the rows arrive, without re-running for a row
  // clicked in the table, which writes the same parameter.
  const appliedRow = useRef<string | null>(null)
  useEffect(() => {
    if (!activeSource || !rowParam) return
    const key = `${activeSource.id}:${rowParam}`
    if (appliedRow.current === key) return
    const row = allRows.find((candidate) => activeSource.getRowId(candidate) === rowParam)
    if (row === undefined) return
    appliedRow.current = key
    // eslint-disable-next-line react-hooks/set-state-in-effect -- The URL is the external source of this selection.
    applyRow(activeSource, row)
  }, [activeSource, allRows, applyRow, rowParam])

  const handleSelect = useCallback(
    (row: unknown) => {
      if (!activeSource) return
      const rowId = activeSource.getRowId(row)
      appliedRow.current = `${activeSource.id}:${rowId}`
      state.setRow(activeSource.id, rowId)
      applyRow(activeSource, row)
    },
    [activeSource, applyRow, state],
  )

  const open = useCallback(
    (sourceId?: string) => {
      const id = sourceId ?? defaultSourceId ?? sources[0]?.id
      if (id) state.open(id)
    },
    [defaultSourceId, sources, state],
  )
  const follow = useCallback(
    (sourceId: string) => {
      if (state.activeId && state.activeId !== sourceId) state.open(sourceId)
    },
    [state],
  )

  const layers = useMemo<Array<MapFeatureTableLayer>>(
    () =>
      sources.map((source) => ({
        id: source.id,
        label: source.label,
        color: source.color ?? DEFAULT_SWATCH_COLOR,
        shape: source.shape,
      })),
    [sources],
  )

  const renderColumnStats = useCallback(
    (columnId: string, shownRows: unknown[]) => {
      const column = activeSource?.columns.find((candidate) => candidate.id === columnId)
      if (!column) return null
      return (
        <ColumnStatsSummary
          title={column.header}
          stats={tableColumnStats(shownRows, column)}
          formatValue={column.formatStat ?? ((value) => formatColumnStat(column, value))}
        />
      )
    },
    [activeSource],
  )

  const inViewAvailable = Boolean(activeSource?.getRowCenter || activeSource?.getRowBounds)
  const words = labels ?? DEFAULT_TABLE_LABELS
  const emptyMessage =
    activeSource?.status === 'loading'
      ? words.loading
      : activeSource?.status === 'error'
        ? (activeSource.emptyMessage ?? words.loadFailed)
        : showOnlyInView
          ? words.noRowsInView
          : (activeSource?.emptyMessage ?? words.noRows)

  const bottomPane = activeSource ? (
    <MapFeatureTablePanel
      rows={rows}
      columns={activeSource.columns}
      layers={layers}
      selectedLayer={activeSource.id}
      getRowId={activeSource.getRowId}
      selectedRowId={selectedRowId !== undefined ? selectedRowId : rowParam}
      emptyMessage={emptyMessage}
      showOnlyInView={showOnlyInView}
      height={height}
      onHeightChange={state.setHeight}
      onResizeStart={() => state.setResizing(true)}
      onResizeEnd={() => state.setResizing(false)}
      onShowOnlyInViewChange={inViewAvailable ? state.setShowOnlyInView : undefined}
      onLayerChange={state.open}
      onClose={state.close}
      onSelect={handleSelect}
      exportFileName={activeSource.exportFileName}
      labels={labels}
      viewModeToggle
      resizable
      collapsibleSearch
      sortable
      renderColumnStats={renderColumnStats}
    />
  ) : null

  return {
    state,
    activeSource,
    open,
    close: state.close,
    follow,
    layout: {
      bottomPane: bottomPane ?? undefined,
      bottomPaneHeight: activeSource ? height : 0,
      bottomPaneResizing: resizing,
    },
    deferResize: resizing,
    button:
      sources.length > 0 && !activeSource ? (
        <MapTableButton label={buttonLabel} text={buttonText} onClick={() => open()} />
      ) : null,
    inlineButton,
    flyTarget: fly,
  }
}

/** Goes inside the `Map`: feeds its viewport to the All/Visible toggle and flies to picked rows. */
export function MapTableBridge({ table }: { table: MapTableController }) {
  const { map, isLoaded } = useMap()
  const { setBounds } = table.state
  const open = Boolean(table.activeSource)

  useObserveMapViewport(map, (viewport) => setBounds(viewport.bounds), {
    enabled: isLoaded && open,
    events: ['moveend'],
    initial: 'always',
  })

  const { center, zoom, nonce } = table.flyTarget
  useFlyToSelection(center ? { longitude: center[0], latitude: center[1] } : null, {
    zoom: Math.max(map?.getZoom() ?? zoom, zoom),
    mode: 'ease',
    focusKey: nonce,
  })

  return null
}
