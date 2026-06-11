import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToggleArray } from '@/hooks/useToggleArray'
import { EXPLORER_DATASETS } from '../constants'
import type { ExplorerDatasetId, ExplorerGeometryType, SpatialFilter } from '../types'

export type SortMode = 'relevance' | 'name'

export interface ExplorerDateRange {
  from: string
  to: string
}

export const ALL_GEOMETRY_TYPES: ExplorerGeometryType[] = ['point', 'line', 'polygon']
export const ALL_DATASET_IDS: ExplorerDatasetId[] = EXPLORER_DATASETS.map((dataset) => dataset.id)
export const DEFAULT_ACTIVE_DATASET_IDS: ExplorerDatasetId[] = [
  'restaurants',
  'parkAmenities',
  'transitStops',
  'trails',
  'parks',
]

/**
 * URL-synced explorer filter state: geometry types, active datasets, text
 * search, sort mode, date range, heatmap flag, plus map selection state.
 */
export function useExplorerFilters() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [geometryFilters, setGeometryFilters] = useState<ExplorerGeometryType[]>(() => {
    const values = (searchParams.get('geom') || '').split(',').filter(Boolean) as ExplorerGeometryType[]
    return values.length ? values.filter((value) => ALL_GEOMETRY_TYPES.includes(value)) : ALL_GEOMETRY_TYPES
  })
  const [activeDatasetIds, setActiveDatasetIds] = useState<ExplorerDatasetId[]>(() => {
    const datasetParam = searchParams.get('datasets') || ''
    if (datasetParam === 'all') return ALL_DATASET_IDS
    const values = datasetParam.split(',').filter(Boolean) as ExplorerDatasetId[]
    const valid = values.filter((value) => ALL_DATASET_IDS.includes(value))
    return valid.length ? valid : DEFAULT_ACTIVE_DATASET_IDS
  })
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [sortMode, setSortMode] = useState<SortMode>(() => (searchParams.get('sort') === 'name' ? 'name' : 'relevance'))
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [spatialFilter, setSpatialFilter] = useState<SpatialFilter | null>(null)
  const [dateRange, setDateRange] = useState<ExplorerDateRange>(() => ({
    from: searchParams.get('from') || '',
    to: searchParams.get('to') || '',
  }))
  const [showHeatmap, setShowHeatmap] = useState(() => searchParams.get('heatmap') === '1')

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    const defaultDatasetsActive =
      activeDatasetIds.length === DEFAULT_ACTIVE_DATASET_IDS.length &&
      DEFAULT_ACTIVE_DATASET_IDS.every((datasetId) => activeDatasetIds.includes(datasetId))
    const datasetValue =
      activeDatasetIds.length === ALL_DATASET_IDS.length
        ? 'all'
        : defaultDatasetsActive
          ? ''
          : activeDatasetIds.join(',')
    const geomValue = geometryFilters.length === ALL_GEOMETRY_TYPES.length ? '' : geometryFilters.join(',')
    if (datasetValue) params.set('datasets', datasetValue)
    else params.delete('datasets')
    if (geomValue) params.set('geom', geomValue)
    else params.delete('geom')
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    else params.delete('q')
    if (sortMode !== 'relevance') params.set('sort', sortMode)
    else params.delete('sort')
    if (dateRange.from) params.set('from', dateRange.from)
    else params.delete('from')
    if (dateRange.to) params.set('to', dateRange.to)
    else params.delete('to')
    if (showHeatmap) params.set('heatmap', '1')
    else params.delete('heatmap')
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [activeDatasetIds, dateRange, geometryFilters, searchParams, searchQuery, setSearchParams, showHeatmap, sortMode])

  const toggleGeometry = useToggleArray(geometryFilters, setGeometryFilters)
  const toggleDataset = useToggleArray(activeDatasetIds, setActiveDatasetIds)
  const selectAllDatasets = useCallback(() => {
    setActiveDatasetIds(ALL_DATASET_IDS)
  }, [])
  const clearDatasets = useCallback(() => {
    setActiveDatasetIds([])
  }, [])

  return {
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
  }
}
