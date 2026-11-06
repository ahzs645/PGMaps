import { useMemo, useState } from 'react'
import { HeatmapMashupLayer } from '@/components/HeatmapMashupLayer'
import { useIsMobile } from '@/hooks/useIsMobile'
import { MAP_SIDEBAR_CLASS, MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { defineTableSource, useMapTable } from '@/components/map/useMapTable'
import { NeighborhoodReport } from '@/components/NeighborhoodReport'
import { formatNumber } from '@/lib/format'
import { EXPLORER_DATASETS } from './constants'
import { EXPLORER_TABLE_SHAPE, explorerTableColumns } from './explorerTable'
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
import type { ExplorerDatasetId, ExplorerItem } from './types'

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

  // One table per dataset on the map: their items share no columns but name and relevance.
  const tableSources = useMemo(() => {
    const groups = new Map<ExplorerDatasetId, ExplorerItem[]>()
    for (const item of filteredItems) {
      const group = groups.get(item.datasetId)
      if (group) group.push(item)
      else groups.set(item.datasetId, [item])
    }
    return EXPLORER_DATASETS.filter(
      (dataset) => datasetSet.has(dataset.id) && geometrySet.has(dataset.geometryType),
    ).map((dataset) => {
      const rows = groups.get(dataset.id) ?? []
      return defineTableSource<ExplorerItem>({
        id: dataset.id,
        label: dataset.label,
        color: dataset.color,
        shape: EXPLORER_TABLE_SHAPE[dataset.geometryType],
        rows,
        columns: explorerTableColumns(rows),
        getRowId: (item) => item.id,
        getRowCenter: ({ bounds }) => [(bounds.minLng + bounds.maxLng) / 2, (bounds.minLat + bounds.maxLat) / 2],
        getRowBounds: ({ bounds }) => [bounds.minLng, bounds.minLat, bounds.maxLng, bounds.maxLat],
        status: loading ? 'loading' : 'ready',
        emptyMessage: 'No items match these filters.',
        exportFileName: `explorer-${dataset.id}`,
      })
    })
  }, [datasetSet, filteredItems, geometrySet, loading])
  const table = useMapTable({
    sources: tableSources,
    selectedRowId: selectedItem?.id ?? null,
    onSelectRow: (item: ExplorerItem) => setSelectedItemId(item.id),
    // ExplorerMap fits the selected item, which also covers a click on the map.
    flyOnSelect: false,
    inlineButton: true,
  })

  const showLegend = showHeatmap || (activeDatasetIds.length > 0 && geometryFilters.length > 0)

  return (
    <MapSectionLayout
      table={table}
      desktopSidebarWidth={370}
      mobilePeekTitle={<>Explorer · {formatNumber(filteredItems.length)} visible</>}
      mobilePeekSubtitle={
        <>
          {activeDatasetIds.length === ALL_DATASET_IDS.length ? 'All datasets' : `${activeDatasetIds.length} datasets`}
          {selectedItem ? ` · ${selectedItem.name}` : searchQuery ? ` · "${searchQuery}"` : ''}
        </>
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
          onItemSelect={(itemId) => {
            setSelectedItemId((current) => (current === itemId ? null : itemId))
            const datasetId = filteredItems.find((item) => item.id === itemId)?.datasetId
            if (datasetId) table.follow(datasetId)
          }}
          spatialFilter={spatialFilter}
          onSpatialFilterChange={setSpatialFilter}
          onMapRightClick={(lng, lat) => setNeighborhoodPoint({ lat, lng })}
          heatmapLayer={showHeatmap ? <HeatmapMashupLayer datasets={heatmapDatasets} visible /> : null}
          loading={loading}
          table={table}
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
          <MobileExplorerFeatureCard item={selectedItem} onClose={() => setSelectedItemId(null)} />
        )}
      </div>
    </MapSectionLayout>
  )
}
