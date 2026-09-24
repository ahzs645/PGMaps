import { useMemo, useRef } from 'react'
import { Download } from 'lucide-react'
import { AppSelect } from '@/components/ui/select'
import {
  FilterChipGroup,
  InlineAlert,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  ToggleChip,
} from '@/components/ui/map-panels'
import { ListState, ResultRow } from '@/components/ui/result-list'
import { StatGroup } from '@/components/ui/stat-group'
import { StickyListToolbar, useRevealBelowSticky } from '@/components/ui/sticky-list-toolbar'
import { SelectAllActions, TextButton } from '@/components/ui/text-button'
import { ToggleRow } from '@/components/ui/toggle-row'
import { VirtualResultList } from '@/components/ui/virtual-result-list'
import { DATASETS } from '@/lib/dataCatalog'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'
import { GEOMETRY_TYPE_LABEL, RELEVANCE_DESCRIPTION } from '../constants'
import type {
  ExplorerDatasetId,
  ExplorerDatasetStat,
  ExplorerGeometryType,
  ExplorerItem,
  SpatialFilter,
} from '../types'
import { ExplorerItemDetails, formatRelevance, formatRelevanceBreakdown } from './ExplorerItemDetails'

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
  showHeatmap: boolean
  onToggleHeatmap: () => void
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
  showHeatmap,
  onToggleHeatmap,
}: ExplorerSidebarProps) {
  const datasetSet = useMemo(() => new Set(activeDatasetIds), [activeDatasetIds])
  const toolbarRef = useRef<HTMLDivElement>(null)
  const selectedCardRef = useRef<HTMLDivElement>(null)

  const geometryCounts = useMemo(
    () => ({
      point: items.filter((item) => item.geometryType === 'point').length,
      line: items.filter((item) => item.geometryType === 'line').length,
      polygon: items.filter((item) => item.geometryType === 'polygon').length,
    }),
    [items],
  )

  // Picking an item on the map inserts its card above the list, out of view
  // if the list was scrolled. Bring it in under the toolbar.
  useRevealBelowSticky(toolbarRef, selectedCardRef, selectedItem?.id)

  const exportButtonClass =
    'inline-flex items-center justify-center rounded border border-input text-muted-foreground transition-colors hover:text-foreground touch:min-h-10 touch:min-w-10'

  return (
    <MapSidebarShell
      className={cn('w-full', className)}
      title="Explorer"
      subtitle="Showcase all point, line, and polygon datasets in one map."
      dataset={DATASETS.explorer}
      actions={
        <ToggleChip active={showHeatmap} onClick={onToggleHeatmap} tone="orange" className="font-medium touch:min-h-10">
          {showHeatmap ? 'Heatmap ON' : 'Heatmap'}
        </ToggleChip>
      }
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
        <StatGroup
          className="mt-2"
          items={[
            { label: 'points', value: formatNumber(geometryCounts.point), valueClassName: 'text-sm md:text-sm' },
            { label: 'lines', value: formatNumber(geometryCounts.line), valueClassName: 'text-sm md:text-sm' },
            { label: 'polygons', value: formatNumber(geometryCounts.polygon), valueClassName: 'text-sm md:text-sm' },
          ]}
        />
      </SidebarSection>

      {/* Datasets */}
      <SidebarSection title="Datasets" actions={<SelectAllActions onAll={onSelectAllDatasets} onNone={onClearDatasets} />}>
        <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {datasetStats.map((stat) => {
            const active = datasetSet.has(stat.dataset.id)
            return (
              <ToggleRow
                key={stat.dataset.id}
                active={active}
                tone="cyan"
                onClick={() => onToggleDataset(stat.dataset.id)}
                leading={
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: stat.dataset.color }}
                    aria-hidden="true"
                  />
                }
                label={stat.dataset.label}
                description={`${GEOMETRY_TYPE_LABEL[stat.dataset.geometryType]} · ${
                  active ? `avg relevance ${formatRelevance(stat.averageRelevance)}` : 'click to load'
                }`}
                trailing={<span className="tabular-nums">{active ? formatNumber(stat.count) : 'Off'}</span>}
              />
            )
          })}
        </div>
      </SidebarSection>

      {/* Temporal, spatial, export */}
      <SidebarSection className="space-y-2">
        {/* Temporal filter */}
        <div className="flex items-center gap-2 text-xs">
          <label className="text-muted-foreground whitespace-nowrap">Date range:</label>
          <input
            type="date"
            value={dateRange.from}
            onChange={(e) => onDateRangeChange({ ...dateRange, from: e.target.value })}
            aria-label="From date"
            className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500 touch:h-10"
          />
          <span className="text-muted-foreground">to</span>
          <input
            type="date"
            value={dateRange.to}
            onChange={(e) => onDateRangeChange({ ...dateRange, to: e.target.value })}
            aria-label="To date"
            className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-background px-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500 touch:h-10"
          />
          {(dateRange.from || dateRange.to) && (
            <TextButton tone="muted" onClick={() => onDateRangeChange({ from: '', to: '' })}>
              Clear
            </TextButton>
          )}
        </div>

        {/* Spatial filter indicator */}
        {spatialFilter && (
          <div className="flex items-center justify-between rounded-md border border-cyan-300/50 bg-cyan-50 px-2 py-1.5 text-xs dark:border-cyan-900/60 dark:bg-cyan-950/25">
            <span className="text-cyan-800 dark:text-cyan-200">Spatial filter active (draw on map)</span>
            <TextButton onClick={onClearSpatialFilter} className="text-cyan-600 hover:text-cyan-800 dark:text-cyan-400">
              Clear
            </TextButton>
          </div>
        )}

        {/* Export + relevance info */}
        <div className="flex items-center justify-between gap-2">
          <div className="line-clamp-2 min-w-0 text-xs text-muted-foreground" title={RELEVANCE_DESCRIPTION}>
            {RELEVANCE_DESCRIPTION}
          </div>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              onClick={() => onExport('csv')}
              title="Export CSV"
              aria-label="Export CSV"
              className={cn(exportButtonClass, 'p-1.5')}
            >
              <Download className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => onExport('geojson')}
              title="Export GeoJSON"
              aria-label="Export GeoJSON"
              className={cn(exportButtonClass, 'px-1.5 py-1 text-xs font-medium')}
            >
              .geo
            </button>
          </div>
        </div>
      </SidebarSection>

      {/* Search and sort stay reachable while the list scrolls. */}
      <StickyListToolbar
        ref={toolbarRef}
        search={
          <SearchInput
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            onClear={() => onSearchQueryChange('')}
            icon
            placeholder="Search names, IDs, subtitles..."
            aria-label="Search explorer items"
            className="focus:ring-cyan-500"
          />
        }
        sort={
          <AppSelect
            value={sortMode}
            onValueChange={(value) => onSortModeChange(value as 'relevance' | 'name')}
            options={[
              { value: 'relevance', label: 'Relevance' },
              { value: 'name', label: 'Name' },
            ]}
            className="w-32"
            triggerAriaLabel="Sort explorer items"
            triggerClassName="h-8 rounded text-xs focus:ring-2 focus:ring-cyan-500 touch:h-10"
          />
        }
        count={
          !loading ? (
            <>
              {formatNumber(items.length)} {items.length === 1 ? 'item' : 'items'} visible
            </>
          ) : undefined
        }
      />

      {/* Selected item panel */}
      {selectedItem && (
        <div ref={selectedCardRef}>
          <SidebarSection>
            <SelectedItemCard
              tone="cyan"
              title={selectedItem.name}
              subtitle={selectedItem.subtitle}
              onClear={onClearSelection}
            >
              <ExplorerItemDetails item={selectedItem} className="mt-2" />
            </SelectedItemCard>
          </SidebarSection>
        </div>
      )}

      {errors.length > 0 && (
        <InlineAlert tone="warning" className="m-3">
          {errors.map((error, index) => (
            <div key={`${error}-${index}`}>{error}</div>
          ))}
        </InlineAlert>
      )}

      {/* Item list */}
      <ListState
        loading={loading}
        loadingLabel="Loading explorer datasets..."
        empty={items.length === 0}
        emptyLabel="No items match these filters."
        onReset={searchQuery ? () => onSearchQueryChange('') : undefined}
        resetLabel="Clear search"
      >
        <VirtualResultList items={items} getKey={(item) => item.id} estimateSize={68} label="Explorer results">
          {(item) => (
            <ResultRow
              accent="cyan"
              selected={selectedItem?.id === item.id}
              onClick={() => onSelectItem(item.id)}
              title={item.name}
              subtitle={item.subtitle}
              trailing={
                <span className="cursor-help text-xs text-cyan-700 dark:text-cyan-300" title={formatRelevanceBreakdown(item)}>
                  {formatRelevance(item.relevance)}
                </span>
              }
            />
          )}
        </VirtualResultList>
      </ListState>
    </MapSidebarShell>
  )
}
