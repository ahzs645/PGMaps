import { useEffect, useMemo } from 'react'
import { EXPLORER_DATASETS } from '../constants'
import type {
  ExplorerDatasetId,
  ExplorerDatasetStat,
  ExplorerGeometryType,
  ExplorerItem,
  SpatialFilter,
} from '../types'
import { boundsIntersect } from '../utils'
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

  const datasetStats = useMemo<ExplorerDatasetStat[]>(() => {
    return EXPLORER_DATASETS.map((dataset) => {
      const datasetItems = allItems.filter((item) => item.datasetId === dataset.id)
      const count = datasetItems.length
      const relevanceValues = datasetItems.map((item) => item.relevance)
      const averageRelevance = relevanceValues.length
        ? relevanceValues.reduce((sum, value) => sum + value, 0) / relevanceValues.length
        : 0
      const maxRelevance = relevanceValues.length ? Math.max(...relevanceValues) : 0
      return { dataset, count, averageRelevance, maxRelevance }
    })
  }, [allItems])

  const filteredItems = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    const filtered = allItems.filter((item) => {
      if (!geometrySet.has(item.geometryType)) return false
      if (!datasetSet.has(item.datasetId)) return false
      // Spatial filter
      if (spatialFilter && !boundsIntersect(item.bounds, spatialFilter)) return false
      // Text search
      if (query && ![item.name, item.subtitle, item.summary].join(' ').toLowerCase().includes(query)) return false
      return true
    })
    filtered.sort((a, b) => {
      if (sortMode === 'name') return a.name.localeCompare(b.name) || b.relevance - a.relevance
      return b.relevance - a.relevance || a.name.localeCompare(b.name)
    })
    return filtered
  }, [allItems, datasetSet, geometrySet, searchQuery, sortMode, spatialFilter])

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null
    return filteredItems.find((item) => item.id === selectedItemId) || null
  }, [filteredItems, selectedItemId])

  useEffect(() => {
    if (selectedItemId && !selectedItem) setSelectedItemId(null)
  }, [selectedItem, selectedItemId, setSelectedItemId])

  return { filteredItems, datasetStats, selectedItem, geometrySet, datasetSet }
}
