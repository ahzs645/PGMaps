import { useEffect, useMemo } from 'react'
import { indexExplorerItems, sortExplorerRows, filterExplorerRows } from '../explorerData'
import type { ExplorerDatasetId, ExplorerGeometryType, ExplorerItem, SpatialFilter } from '../types'
import type { SortMode } from './useExplorerFilters'

interface UseExplorerSearchOptions {
  allItems: ExplorerItem[]
  geometryFilters: ExplorerGeometryType[]
  activeDatasetIds: ExplorerDatasetId[]
  searchQuery: string
  sortMode: SortMode
  spatialFilter: SpatialFilter | null
  selectedItemId: string | null
  setSelectedItemId: (itemId: string | null) => void
}

/**
 * Apply text, geometry, dataset, and spatial filters plus sorting to the
 * combined item list, compute per-dataset stats, and resolve the selection.
 */
export function useExplorerSearch({
  allItems,
  geometryFilters,
  activeDatasetIds,
  searchQuery,
  sortMode,
  spatialFilter,
  selectedItemId,
  setSelectedItemId,
}: UseExplorerSearchOptions) {
  const geometrySet = useMemo(() => new Set(geometryFilters), [geometryFilters])
  const datasetSet = useMemo(() => new Set(activeDatasetIds), [activeDatasetIds])

  const index = useMemo(() => indexExplorerItems(allItems), [allItems])
  const sortedRows = useMemo(() => sortExplorerRows(index.rows, sortMode), [index, sortMode])
  const filteredItems = useMemo(
    () => filterExplorerRows(sortedRows, searchQuery, datasetSet, geometrySet, spatialFilter),
    [sortedRows, datasetSet, geometrySet, searchQuery, spatialFilter],
  )
  const datasetStats = index.datasetStats

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null
    return filteredItems.find((item) => item.id === selectedItemId) || null
  }, [filteredItems, selectedItemId])

  useEffect(() => {
    if (selectedItemId && !selectedItem) setSelectedItemId(null)
  }, [selectedItem, selectedItemId, setSelectedItemId])

  return { filteredItems, datasetStats, selectedItem, geometrySet, datasetSet }
}
