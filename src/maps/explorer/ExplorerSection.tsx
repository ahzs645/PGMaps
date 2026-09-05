import { useState } from 'react'
import { HeatmapMashupLayer } from '@/components/HeatmapMashupLayer'
import { useIsMobile } from '@/hooks/useIsMobile'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { NeighborhoodReport } from '@/components/NeighborhoodReport'
import { ExplorerLegend } from './components/ExplorerLegend'
import { ExplorerMap } from './components/ExplorerMap'
import { ExplorerSidebar } from './components/ExplorerSidebar'
import { MobileExplorerFeatureCard } from './components/MobileExplorerFeatureCard'
import { useExplorerExport } from './hooks/useExplorerExport'
import { ALL_DATASET_IDS, useExplorerFilters } from './hooks/useExplorerFilters'
import { useExplorerItems } from './hooks/useExplorerItems'
import { useExplorerMapData } from './hooks/useExplorerMapData'
import { useExplorerSearch } from './hooks/useExplorerSearch'
import { useExplorerTimeline } from './hooks/useExplorerTimeline'

export default function ExplorerSection() {
  const isMobileViewport = useIsMobile()
  const [neighborhoodPoint, setNeighborhoodPoint] = useState<{ lat: number; lng: number } | null>(null)

  const {
    geometryFilters,
    toggleGeometry,
    activeDatasetIds,
    toggleDataset,
    selectAllDatasets,
    clearDatasets,
    searchQuery,
    setSearchQuery,
    sortMode,
    setSortMode,
    selectedItemId,
    setSelectedItemId,
    spatialFilter,
    setSpatialFilter,
    dateRange,
    setDateRange,
    showHeatmap,
    setShowHeatmap,
  } = useExplorerFilters()
  const { dateFrom, dateTo } = useExplorerTimeline(dateRange)
  const { allItems, heatmapDatasets, loading, errors } = useExplorerItems(activeDatasetIds, dateFrom, dateTo)
  const { filteredItems, datasetStats, selectedItem, geometrySet, datasetSet } = useExplorerSearch({
    allItems,
    geometryFilters,
    activeDatasetIds,
    searchQuery,
    sortMode,
    spatialFilter,
    selectedItemId,
    setSelectedItemId,
  })
  const { pointCollections, lineCollections, polygonCollections, legendDatasets } = useExplorerMapData(
    filteredItems,
    datasetSet,
    geometrySet,
  )
  const handleExport = useExplorerExport(filteredItems)

  const showLegend = showHeatmap || (activeDatasetIds.length > 0 && geometryFilters.length > 0)

  return (
    <MapSectionLayout
      desktopSidebarWidth={370}
      mobilePeek={
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            Explorer | {filteredItems.length.toLocaleString()} visible
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {activeDatasetIds.length === ALL_DATASET_IDS.length
              ? 'All datasets'
              : `${activeDatasetIds.length} datasets`}
            {selectedItem ? ` | ${selectedItem.name}` : searchQuery ? ` | "${searchQuery}"` : ''}
          </div>
        </div>
      }
      sidebar={
        <ExplorerSidebar
          className={MAP_SIDEBAR_CLASS}
          loading={loading}
          errors={errors}
          geometryFilters={geometryFilters}
          onToggleGeometry={toggleGeometry}
          datasetStats={datasetStats}
          activeDatasetIds={activeDatasetIds}
          onToggleDataset={toggleDataset}
          onSelectAllDatasets={selectAllDatasets}
          onClearDatasets={clearDatasets}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          items={filteredItems}
          selectedItem={selectedItem}
          onSelectItem={setSelectedItemId}
          onClearSelection={() => setSelectedItemId(null)}
          spatialFilter={spatialFilter}
          onClearSpatialFilter={() => setSpatialFilter(null)}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          onExport={handleExport}
          showHeatmap={showHeatmap}
          onToggleHeatmap={() => setShowHeatmap((current) => !current)}
        />
      }
    >
      <div className="relative h-full">
        <ExplorerMap
          pointCollections={showHeatmap ? [] : pointCollections}
          lineCollections={lineCollections}
          polygonCollections={polygonCollections}
          selectedItem={selectedItem}
          onItemSelect={(itemId) => setSelectedItemId((current) => current === itemId ? null : itemId)}
          spatialFilter={spatialFilter}
          onSpatialFilterChange={setSpatialFilter}
          onMapRightClick={(lng, lat) => setNeighborhoodPoint({ lat, lng })}
          heatmapLayer={showHeatmap ? <HeatmapMashupLayer datasets={heatmapDatasets} visible /> : null}
          loading={loading}
        />

        {neighborhoodPoint && (
          <NeighborhoodReport
            lat={neighborhoodPoint.lat}
            lng={neighborhoodPoint.lng}
            onClose={() => setNeighborhoodPoint(null)}
          />
        )}

        {showLegend && (
          <ExplorerLegend
            legendDatasets={legendDatasets}
            datasetStats={datasetStats}
            selectedItem={selectedItem}
            defaultDetailDisplay="count"
            allowDetailToggle
          />
        )}

        {isMobileViewport && selectedItem && (
          <MobileExplorerFeatureCard
            item={selectedItem}
            onClose={() => setSelectedItemId(null)}
          />
        )}
      </div>
    </MapSectionLayout>
  )
}
