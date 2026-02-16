import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { GEOMETRY_TYPE_LABEL, RELEVANCE_DESCRIPTION } from '../constants'
import type {
  ExplorerDatasetId,
  ExplorerDatasetStat,
  ExplorerGeometryType,
  ExplorerItem
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
}

const MAX_VISIBLE_ITEMS = 280

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
  onClearSelection
}: ExplorerSidebarProps) {
  const geometrySet = useMemo(() => new Set(geometryFilters), [geometryFilters])
  const datasetSet = useMemo(() => new Set(activeDatasetIds), [activeDatasetIds])

  const displayedItems = useMemo(() => {
    return items.slice(0, MAX_VISIBLE_ITEMS)
  }, [items])

  const geometryCounts = useMemo(() => {
    return {
      point: items.filter((item) => item.geometryType === 'point').length,
      line: items.filter((item) => item.geometryType === 'line').length,
      polygon: items.filter((item) => item.geometryType === 'polygon').length
    }
  }, [items])

  return (
    <div className={cn('z-10 flex h-full w-[370px] flex-col border-r border-border bg-background/95 shadow-xl backdrop-blur', className)}>
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">Explorer</h1>
        <p className="text-sm text-muted-foreground">Showcase all point, line, and polygon datasets in one map.</p>
      </div>

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

      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Datasets</h2>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={onSelectAllDatasets}
              className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300"
            >
              All
            </button>
            <button
              onClick={onClearDatasets}
              className="text-muted-foreground hover:text-foreground"
            >
              None
            </button>
          </div>
        </div>

        <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
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

      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-2 flex items-center gap-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search names, IDs, subtitles..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
          />
          <select
            value={sortMode}
            onChange={(event) => onSortModeChange(event.target.value as 'relevance' | 'name')}
            className="rounded-lg border border-input bg-background px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            <option value="relevance">Relevance</option>
            <option value="name">Name</option>
          </select>
        </div>

        <div className="rounded-md border border-border bg-muted/20 p-2 text-[11px] text-muted-foreground">
          {RELEVANCE_DESCRIPTION}
        </div>
      </div>

      {selectedItem && (
        <div className="border-b border-cyan-300/50 bg-cyan-50 p-4 dark:border-cyan-900/70 dark:bg-cyan-950/25">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">{selectedItem.name}</div>
              <div className="text-xs text-cyan-700 dark:text-cyan-300">{selectedItem.subtitle}</div>
            </div>
            <button
              onClick={onClearSelection}
              className="text-cyan-700 hover:text-cyan-900 dark:text-cyan-300 dark:hover:text-cyan-100"
              aria-label="Clear selection"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mb-2 text-xs text-cyan-800 dark:text-cyan-200">Relevance {formatRelevance(selectedItem.relevance)} / 100</div>
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

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Loading explorer datasets...
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
            <span>{items.length.toLocaleString()} items visible</span>
            {items.length > MAX_VISIBLE_ITEMS && <span>Showing {MAX_VISIBLE_ITEMS}</span>}
          </div>

          {errors.length > 0 && (
            <div className="border-b border-border bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/25 dark:text-amber-200">
              {errors.map((error, index) => (
                <div key={`${error}-${index}`}>{error}</div>
              ))}
            </div>
          )}

          <div className="divide-y divide-border">
            {displayedItems.map((item) => {
              const isSelected = selectedItem?.id === item.id
              return (
                <button
                  key={item.id}
                  onClick={() => onSelectItem(item.id)}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                    isSelected && 'bg-cyan-50 dark:bg-cyan-950/35'
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-foreground">{item.name}</span>
                    <span className="text-xs font-semibold text-cyan-700 dark:text-cyan-300">{formatRelevance(item.relevance)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">{item.subtitle}</div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
