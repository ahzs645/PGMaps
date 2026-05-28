import { useMemo } from 'react'
import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { AppSelect } from '@/components/ui/select'
import {
  FilterChipGroup,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
} from '@/components/ui/map-panels'
import { DATASETS } from '@/lib/dataCatalog'
import { GEOMETRY_TYPE_LABEL, RELEVANCE_DESCRIPTION } from '../constants'
import type {
  ExplorerDatasetId,
  ExplorerDatasetStat,
  ExplorerGeometryType,
  ExplorerItem,
  SpatialFilter,
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

const MAX_VISIBLE_ROWS = 250

export function formatRelevance(value: number): string {
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
  onExport,
}: ExplorerSidebarProps) {
  const datasetSet = useMemo(() => new Set(activeDatasetIds), [activeDatasetIds])

  const geometryCounts = useMemo(
    () => ({
      point: items.filter((item) => item.geometryType === 'point').length,
      line: items.filter((item) => item.geometryType === 'line').length,
      polygon: items.filter((item) => item.geometryType === 'polygon').length,
    }),
    [items],
  )

  const displayedItems = useMemo(() => items.slice(0, MAX_VISIBLE_ROWS), [items])

  return (
    <MapSidebarShell
      className={cn('w-[370px]', className)}
      title="Explorer"
      subtitle="Showcase all point, line, and polygon datasets in one map."
      dataset={DATASETS.explorer}
    >
      {/* Geometry filters */}
      <SidebarSection title="Geometry Types">
        <FilterChipGroup
          items={(['point', 'line', 'polygon'] as const).map((geometryType) => ({
            value: geometryType,
            label: GEOMETRY_TYPE_LABEL[geometryType],
          }))}
          selectedValues={geometryFilters}
          onToggle={onToggleGeometry}
          layout="grid"
          showDot={false}
          selectedClassName="border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100"
          chipClassName="justify-center rounded border px-2 py-1.5 font-medium"
        />
        <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px] text-muted-foreground">
          <div>{geometryCounts.point.toLocaleString()} points</div>
          <div>{geometryCounts.line.toLocaleString()} lines</div>
          <div>{geometryCounts.polygon.toLocaleString()} polygons</div>
        </div>
      </SidebarSection>

      {/* Datasets */}
      <SidebarSection
        title="Datasets"
        actions={
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={onSelectAllDatasets}
              className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300"
            >
              All
            </button>
            <button onClick={onClearDatasets} className="text-muted-foreground hover:text-foreground">
              None
            </button>
          </div>
        }
      >
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
                    : 'border-input bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: stat.dataset.color }} />
                    <span className="font-medium">{stat.dataset.label}</span>
                  </div>
                  <span>{active ? stat.count.toLocaleString() : 'Off'}</span>
                </div>
                <div className="flex items-center justify-between text-[10px]">
                  <span>{GEOMETRY_TYPE_LABEL[stat.dataset.geometryType]}</span>
                  <span>{active ? `avg relevance ${formatRelevance(stat.averageRelevance)}` : 'click to load'}</span>
                </div>
              </button>
            )
          })}
        </div>
      </SidebarSection>

      {/* Search, sort, temporal, spatial, export */}
      <SidebarSection className="space-y-2">
        <div className="flex items-center gap-2">
          <SearchInput
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search names, IDs, subtitles..."
            className="flex-1 text-xs focus:ring-cyan-500"
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
            <button onClick={onClearSpatialFilter} className="text-cyan-600 hover:text-cyan-800 dark:text-cyan-400">
              Clear
            </button>
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
      </SidebarSection>

      {/* Selected item panel */}
      {selectedItem && (
        <SidebarSection>
          <SelectedItemCard
            tone="cyan"
            title={selectedItem.name}
            subtitle={selectedItem.subtitle}
            onClear={onClearSelection}
          >
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
          </SelectedItemCard>
        </SidebarSection>
      )}

      {/* Item list */}
      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading explorer datasets...</div>
      ) : (
        <div>
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
            <span>{items.length.toLocaleString()} items visible</span>
            {items.length > MAX_VISIBLE_ROWS && <span>Showing {MAX_VISIBLE_ROWS}</span>}
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
                    isSelected && 'bg-cyan-50 dark:bg-cyan-950/35',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-foreground">{item.name}</span>
                    <span className="group/rel relative cursor-help text-xs font-semibold text-cyan-700 dark:text-cyan-300">
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
              )
            })}
          </div>
        </div>
      )}
    </MapSidebarShell>
  )
}
