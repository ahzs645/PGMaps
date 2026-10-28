import { useCallback, useMemo } from 'react'
import {
  MapFeatureTablePanel,
  type MapFeatureTableColumn,
  type MapFeatureTableLayer,
} from '@/components/map/MapFeatureTable'
import { ColumnStatsSummary } from '@/components/ui/column-stats'
import { attributeSortValue, columnStats, formatAttribute } from '@/lib/featureAttributes'
import { primaryColor } from '@/lib/layerStyle'
import {
  FEATURE_ID_KEY,
  effectiveStyle,
  featureInBounds,
  filteredCollection,
  numberFormatter,
  type DataFeature,
  type LoadedLayer,
  type ViewportBounds,
} from './layerData'
import type { DataLayer } from './model'

const COLUMN_WIDTHS = { text: 170, numeric: 130, datetime: 130 } as const

export function DataTablePanel({
  layer,
  layers,
  loaded,
  getLayer,
  bounds,
  showOnlyInView,
  selectedFeatureId,
  height,
  onHeightChange,
  onResizeStart,
  onResizeEnd,
  onShowOnlyInViewChange,
  onLayerChange,
  onClose,
  onSelect,
}: {
  layer: DataLayer
  layers: readonly DataLayer[]
  loaded: LoadedLayer
  getLayer: (id: string) => LoadedLayer
  bounds: ViewportBounds | null
  showOnlyInView: boolean
  selectedFeatureId: string | null
  height: number
  onHeightChange: (height: number) => void
  onResizeStart?: () => void
  onResizeEnd?: () => void
  onShowOnlyInViewChange: (enabled: boolean) => void
  onLayerChange: (layerId: string) => void
  onClose: () => void
  onSelect: (feature: DataFeature) => void
}) {
  const style = effectiveStyle(layer, loaded)
  const tableLayers = useMemo<Array<MapFeatureTableLayer>>(
    () =>
      layers.map((candidate) => ({
        id: candidate.id,
        label: candidate.label,
        color: primaryColor(effectiveStyle(candidate, getLayer(candidate.id))),
        shape: candidate.geometry,
      })),
    [getLayer, layers],
  )

  const columns = useMemo<Array<MapFeatureTableColumn<DataFeature>>>(
    () =>
      loaded.attributes.map((attribute) => ({
        id: attribute.key,
        header: attribute.label,
        type: attribute.type,
        width: COLUMN_WIDTHS[attribute.type],
        getValue: (feature) => formatAttribute(feature.properties[attribute.key], attribute),
        getSortValue: (feature) => attributeSortValue(feature.properties[attribute.key], attribute),
      })),
    [loaded.attributes],
  )

  const rows = useMemo(() => {
    const features = filteredCollection(loaded.collection, layer, style).features
    if (!showOnlyInView || !bounds) return features
    return features.filter((feature) => featureInBounds(feature, bounds))
  }, [bounds, layer, loaded.collection, showOnlyInView, style])

  const renderColumnStats = useCallback(
    (columnId: string, shownRows: DataFeature[]) => {
      const attribute = loaded.attributes.find((candidate) => candidate.key === columnId)
      if (!attribute) return null
      return (
        <ColumnStatsSummary
          title={attribute.label}
          stats={columnStats(shownRows, attribute)}
          formatValue={numberFormatter(attribute)}
        />
      )
    },
    [loaded.attributes],
  )

  const emptyMessage =
    loaded.status === 'loading'
      ? 'Loading rows…'
      : loaded.status === 'error'
        ? `Could not load this layer${loaded.error ? `: ${loaded.error}` : ''}`
        : loaded.status === 'idle'
          ? 'Show this layer to load its rows'
          : layer.filter
            ? 'No rows match the layer filter'
            : showOnlyInView
              ? 'No rows in the current view'
              : 'No rows'

  return (
    <MapFeatureTablePanel
      rows={rows}
      columns={columns}
      layers={tableLayers}
      selectedLayer={layer.id}
      getRowId={(feature) => feature.properties[FEATURE_ID_KEY]}
      selectedRowId={selectedFeatureId}
      emptyMessage={emptyMessage}
      showOnlyInView={showOnlyInView}
      height={height}
      onHeightChange={onHeightChange}
      onResizeStart={onResizeStart}
      onResizeEnd={onResizeEnd}
      onShowOnlyInViewChange={onShowOnlyInViewChange}
      onLayerChange={onLayerChange}
      onClose={onClose}
      onSelect={onSelect}
      viewModeToggle
      resizable
      collapsibleSearch
      sortable
      renderColumnStats={renderColumnStats}
    />
  )
}
