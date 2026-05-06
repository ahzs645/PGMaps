import { useRef, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/ui/select'
import { GEOMETRY_TYPE_LABEL, RELEVANCE_DESCRIPTION } from '../constants'
import type {
  ExplorerDatasetId,
  ExplorerDatasetStat,
  ExplorerGeometryType,
  ExplorerItem,
  SpatialFilter
} from '../types'

interface ExplorerSidebarProps {
  className?: string
  loading: boolean
  errors: string[]
  geometryFilters: ExplorerGeometryType[]
  onToggleGeometry: (geometryType: ExplorerGeometryType) => void
  datasetStats: ExplorerDatasetStat[]
  activeDatasetIds: ExplorerDatasetId[]
  onToggleDataset: (datasetId: ExplorerDatasetId) => void
  onSelectAllDatasets: () => void
  onClearDatasets: () => void
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  sortMode: 'relevance' | 'name'
  onSortModeChange: (mode: 'relevance' | 'name') => void
  items: ExplorerItem[]
  selectedItem: ExplorerItem | null
  onSelectItem: (itemId: string) => void
  onClearSelection: () => void
  spatialFilter: SpatialFilter | null
  onClearSpatialFilter: () => void
  dateRange: { from: string; to: string }
  onDateRangeChange: (range: { from: string; to: string }) => void
  onExport: (format: 'csv' | 'geojson') => void
}

function formatRelevance(value: number): string {
  return `${Math.round(value)}`
}

export function ExplorerSidebar({
  className,
  loading,
  errors,
  geometryFilters,
  onToggleGeometry,
  datasetStats,
  activeDatasetIds,
  onToggleDataset,
  onSelectAllDatasets,
  onClearDatasets,
  searchQuery,
  onSearchQueryChange,
  sortMode,
  onSortModeChange,
  items,
  selectedItem,
  onSelectItem,
  onClearSelection,
  spatialFilter,
  onClearSpatialFilter,
  dateRange,
  onDateRangeChange,
  onExport
}: ExplorerSidebarProps) {
  const geometrySet = useMemo(() => new Set(geometryFilters), [geometryFilters])
  const datasetSet = useMemo(() => new Set(activeDatasetIds), [activeDatasetIds])

  const geometryCounts = useMemo(() => ({
    point: items.filter((item) => item.geometryType === 'point').length,
    line: items.filter((item) => item.geometryType === 'line').length,
    polygon: items.filter((item) => item.geometryType === 'polygon').length
  }), [items])

  // Virtual scrolling
  const listRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 60,
    overscan: 10
  })

  return (
    <div className={cn('z-10 flex h-full min-h-0 w-[370px] flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur', className)}>
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">Explorer</h1>
        <p className="text-sm text-muted-foreground">Showcase all point, line, and polygon datasets in one map.</p>
      </div>

      {/* Geometry filters */}
      <div className="border-b border-border bg-background/95 p-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Geometry Types</h2>
        <div className="grid grid-cols-3 gap-2">
          {(['point', 'line', 'polygon'] as const).map((geometryType) => {
            const active = geometrySet.has(geometryType)
            return (
              <button
                key={geometryType}
                onClick={() => onToggleGeometry(geometryType)}
                className={cn(
                  'rounded border px-2 py-1.5 text-xs font-medium transition-colors',
                  active
                    ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100'
                    : 'border-input text-muted-foreground hover:text-foreground'
                )}
              >
                {GEOMETRY_TYPE_LABEL[geometryType]}
              </button>
            )
          })}
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px] text-muted-foreground">
          <div>{geometryCounts.point.toLocaleString()} points</div>
          <div>{geometryCounts.line.toLocaleString()} lines</div>
          <div>{geometryCounts.polygon.toLocaleString()} polygons</div>
        </div>
      </div>

      {/* Datasets */}
      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Datasets</h2>
          <div className="flex items-center gap-2 text-xs">
            <button onClick={onSelectAllDatasets} className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300">All</button>
            <button onClick={onClearDatasets} className="text-muted-foreground hover:text-foreground">None</button>
          </div>
        </div>
        <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
          {datasetStats.map((stat) => {
            const active = datasetSet.has(stat.dataset.id)
            return (
              <button
                key={stat.dataset.id}
                onClick={() => onToggleDataset(stat.dataset.id)}
                className={cn(
                  'w-full rounded-md border px-2 py-2 text-left text-xs transition-colors',
                  active
                    ? 'border-cyan-500/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-100'
                    : 'border-input bg-background text-muted-foreground hover:text-foreground'
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stat.dataset.color }} />
                    <span className="font-medium">{stat.dataset.label}</span>
                  </div>
                  <span>{stat.count.toLocaleString()}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span>{GEOMETRY_TYPE_LABEL[stat.dataset.geometryType]}</span>
                  <span>avg relevance {formatRelevance(stat.averageRelevance)}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Search, sort, temporal, spatial, export */}
      <div className="border-b border-border bg-background/95 p-4 space-y-2">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search names, IDs, subtitles..."
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <AppSelect
            value={sortMode}
            onValueChange={(value) => onSortModeChange(value as 'relevance' | 'name')}
            options={[
              { value: 'relevance', label: 'Relevance' },
              { value: 'name', label: 'Name' },
            ]}
            className="w-32"
            triggerClassName="h-9 rounded-lg text-xs focus:ring-2 focus:ring-cyan-500"
          />
        </div>

        {/* Temporal filter */}
        <div className="flex items-center gap-2 text-xs">
          <label className="text-muted-foreground whitespace-nowrap">Date range:</label>
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => onDateRangeChange({ ...dateRange, from: e.target.value })}
            className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => onDateRangeChange({ ...dateRange, to: e.target.value })}
            className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
          {(dateRange.from || dateRange.to) && (
            <button
              onClick={() => onDateRangeChange({ from: '', to: '' })}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>

        {/* Spatial filter indicator */}
        {spatialFilter && (
          <div className="flex items-center justify-between rounded-md border border-cyan-300/50 bg-cyan-50 px-2 py-1.5 text-xs dark:border-cyan-900/60 dark:bg-cyan-950/25">
            <span className="text-cyan-800 dark:text-cyan-200">Spatial filter active (draw on map)</span>
            <button onClick={onClearSpatialFilter} className="text-cyan-600 hover:text-cyan-800 dark:text-cyan-400">Clear</button>
          </div>
        )}

        {/* Export + relevance info */}
        <div className="flex items-center justify-between">
          <div className="text-[11px] text-muted-foreground" title={RELEVANCE_DESCRIPTION}>
            {RELEVANCE_DESCRIPTION.slice(0, 60)}...
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => onExport('csv')}
              title="Export CSV"
              className="rounded border border-input p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onExport('geojson')}
              title="Export GeoJSON"
              className="rounded border border-input px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              .geo
            </button>
          </div>
        </div>
      </div>

      {/* Selected item panel */}
      {selectedItem && (
        <div className="max-h-48 shrink-0 overflow-y-auto border-b border-cyan-300/50 bg-cyan-50 p-3 dark:border-cyan-900/70 dark:bg-cyan-950/25">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">{selectedItem.name}</div>
              <div className="text-xs text-cyan-700 dark:text-cyan-300">{selectedItem.subtitle}</div>
            </div>
            <button onClick={onClearSelection} className="text-cyan-700 hover:text-cyan-900 dark:text-cyan-300 dark:hover:text-cyan-100" aria-label="Clear selection">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Relevance with tooltip breakdown */}
          <div className="group relative mb-2">
            <div className="text-xs text-cyan-800 dark:text-cyan-200 cursor-help">
              Relevance {formatRelevance(selectedItem.relevance)} / 100
            </div>
            <div className="absolute left-0 top-full z-30 mt-1 hidden w-56 rounded-lg border border-border bg-background p-2 shadow-lg group-hover:block">
              <div className="text-[10px] font-semibold text-foreground mb-1">Score Breakdown</div>
              {selectedItem.relevanceBreakdown.map((entry, i) => (
                <div key={i} className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>{entry.label}</span>
                  <span className="font-medium text-foreground">+{entry.points}</span>
                </div>
              ))}
              <div className="mt-1 border-t border-border pt-1 flex items-center justify-between text-[10px] font-semibold">
                <span>Total</span>
                <span>{formatRelevance(selectedItem.relevance)}</span>
              </div>
            </div>
          </div>

          <div className="mb-2 text-xs text-cyan-800 dark:text-cyan-200">{selectedItem.summary}</div>

          <div className="grid grid-cols-2 gap-2 text-[11px] text-cyan-800 dark:text-cyan-300">
            {selectedItem.details.slice(0, 8).map((detail) => (
              <div key={`${selectedItem.id}-${detail.label}`}>
                <span className="font-medium">{detail.label}:</span> {detail.value}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Item list */}
      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading explorer datasets...</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
            <span>{items.length.toLocaleString()} items visible</span>
          </div>

          {errors.length > 0 && (
            <div className="border-b border-border bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/25 dark:text-amber-200">
              {errors.map((error, index) => (
                <div key={`${error}-${index}`}>{error}</div>
              ))}
            </div>
          )}

          {/* Virtual scrolling list */}
          <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto">
            <div style={{ height: `${virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const item = items[virtualRow.index]
                if (!item) return null
                const isSelected = selectedItem?.id === item.id
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`
                    }}
                  >
                    <button
                      onClick={() => onSelectItem(item.id)}
                      className={cn(
                        'w-full border-b border-border px-4 py-3 text-left transition-colors hover:bg-accent',
                        isSelected && 'bg-cyan-50 dark:bg-cyan-950/35'
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="line-clamp-1 text-sm font-medium text-foreground">{item.name}</span>
                        {/* Relevance score with hover tooltip */}
                        <span className="group/rel relative text-xs font-semibold text-cyan-700 dark:text-cyan-300 cursor-help">
                          {formatRelevance(item.relevance)}
                          <span className="absolute right-0 top-full z-30 mt-1 hidden w-48 rounded border border-border bg-background p-2 shadow-lg group-hover/rel:block">
                            {item.relevanceBreakdown.map((e, i) => (
                              <span key={i} className="flex justify-between text-[10px] text-muted-foreground">
                                <span>{e.label}</span>
                                <span className="font-medium text-foreground">+{e.points}</span>
                              </span>
                            ))}
                          </span>
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">{item.subtitle}</div>
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
