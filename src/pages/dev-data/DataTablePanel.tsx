import { useMemo } from 'react'
import { MapFeatureTablePanel, type MapFeatureTableColumn, type MapFeatureTableLayer } from '@/components/map/MapFeatureTable'
import {
  DEV_DATA_LAYERS,
  DEV_DATA_LAYER_BY_ID,
  FEATURE_ID_KEY,
  formatCellValue,
  type DataFeature,
  type DataLayerId,
} from './data'
import { featureInBounds, type LayerState, type ViewportBounds } from './useDataLayers'

const tableLayers: Array<MapFeatureTableLayer<DataLayerId>> = DEV_DATA_LAYERS.map((layer) => ({
  id: layer.id,
  label: layer.label,
  color: layer.color,
  shape: layer.shape,
}))

export function DataTablePanel({
  layerId,
  state,
  bounds,
  showOnlyInView,
  selectedFeatureId,
  height,
  onHeightChange,
  viewModeToggle,
  onShowOnlyInViewChange,
  onLayerChange,
  onClose,
  onSelect,
}: {
  layerId: DataLayerId
  state: LayerState
  bounds: ViewportBounds | null
  showOnlyInView: boolean
  selectedFeatureId: string | null
  height: number
  onHeightChange: (height: number) => void
  viewModeToggle: boolean
  onShowOnlyInViewChange: (enabled: boolean) => void
  onLayerChange: (layerId: DataLayerId) => void
  onClose: () => void
  onSelect: (feature: DataFeature) => void
}) {
  const definition = DEV_DATA_LAYER_BY_ID.get(layerId)

  const columns = useMemo<Array<MapFeatureTableColumn<DataFeature>>>(() => {
    if (!definition) return []
    return definition.columns.map((column) => ({
      id: column.key,
      header: column.header,
      type: column.type,
      width: column.width,
      getValue: (feature) => formatCellValue(feature.properties[column.key], column.type),
      getSearchValue: (feature) => formatCellValue(feature.properties[column.key], column.type),
    }))
  }, [definition])

  const rows = useMemo(() => {
    const features = state.collection.features
    if (!showOnlyInView || !bounds) return features
    return features.filter((feature) => featureInBounds(feature, bounds))
  }, [bounds, showOnlyInView, state.collection])

  const emptyMessage = state.status === 'loading'
    ? 'Loading rows…'
    : state.status === 'error'
      ? `Could not load this layer${state.error ? `: ${state.error}` : ''}`
      : state.status === 'idle'
        ? 'Switch this layer on to load its rows'
        : showOnlyInView
          ? 'No rows in the current view'
          : 'No rows'

  return (
    <MapFeatureTablePanel
      rows={rows}
      columns={columns}
      layers={tableLayers}
      selectedLayer={layerId}
      getRowId={(feature) => feature.properties[FEATURE_ID_KEY]}
      selectedRowId={selectedFeatureId}
      emptyMessage={emptyMessage}
      showOnlyInView={showOnlyInView}
      height={height}
      onHeightChange={onHeightChange}
      onShowOnlyInViewChange={onShowOnlyInViewChange}
      onLayerChange={onLayerChange}
      onClose={onClose}
      onSelect={onSelect}
      viewModeToggle={viewModeToggle}
      resizable
      collapsibleSearch
    />
  )
}
