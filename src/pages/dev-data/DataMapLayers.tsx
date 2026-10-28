import { useCallback } from 'react'
import { MapCircleLayer, MapFillLayer, MapLineLayer } from '@/components/ui/map-layers'
import { mapTooltipHtml } from '@/components/ui/map-tooltip-card'
import { colorExpression, sizeExpression } from '@/lib/layerStyle'
import {
  FEATURE_ID_KEY,
  effectiveStyle,
  featureSummaryRows,
  featureTitle,
  filteredCollection,
  type DataFeature,
  type LoadedLayer,
} from './layerData'
import type { DataLayer } from './model'

/**
 * Draws the workspace's layers: areas, then lines, then points, so points stay
 * clickable on top. Each layer reads its colour, size and filter from its style.
 */
export function DataMapLayers({
  layers,
  getLayer,
  selectedFeatureId,
  onFeatureClick,
  interactive = true,
}: {
  layers: readonly DataLayer[]
  getLayer: (id: string) => LoadedLayer
  selectedFeatureId: string | null
  onFeatureClick?: (layerId: string, featureId: string) => void
  interactive?: boolean
}) {
  const ordered = [...layers].sort((a, b) => geometryRank(a) - geometryRank(b))
  return (
    <>
      {ordered.map((layer, index) => (
        <DataMapLayer
          key={layer.id}
          drawOrder={POINT_DRAW_ORDER + index}
          layer={layer}
          loaded={getLayer(layer.id)}
          selectedFeatureId={selectedFeatureId}
          onFeatureClick={onFeatureClick}
          interactive={interactive}
        />
      ))}
    </>
  )
}

/**
 * Points register a draw order so they stay above areas and lines however late
 * they are added. MapLineLayer takes no order, so areas and lines keep the order
 * they were added in.
 */
const POINT_DRAW_ORDER = 1000

function geometryRank(layer: DataLayer) {
  return layer.geometry === 'fill' ? 0 : layer.geometry === 'line' ? 1 : 2
}

function DataMapLayer({
  drawOrder,
  layer,
  loaded,
  selectedFeatureId,
  onFeatureClick,
  interactive,
}: {
  drawOrder: number
  layer: DataLayer
  loaded: LoadedLayer
  selectedFeatureId: string | null
  onFeatureClick?: (layerId: string, featureId: string) => void
  interactive: boolean
}) {
  const style = effectiveStyle(layer, loaded)
  const data = filteredCollection(loaded.collection, layer, style)
  const visible = layer.visible && loaded.status === 'ready'
  const selectedId = selectedFeatureId?.startsWith(`${layer.id}:`) ? selectedFeatureId : null
  const color = colorExpression(style)
  const attributes = loaded.attributes

  const hoverHtml = useCallback(
    (properties: Record<string, unknown>) => {
      if (!interactive) return null
      const feature = { properties } as DataFeature
      return mapTooltipHtml({
        title: featureTitle(feature, layer, attributes),
        subtitle: layer.label,
        rows: featureSummaryRows(feature, layer, attributes, 3),
      })
    },
    [attributes, interactive, layer],
  )
  const handleClick = useCallback((id: string) => onFeatureClick?.(layer.id, id), [layer.id, onFeatureClick])

  if (layer.geometry === 'line') {
    return (
      <MapLineLayer
        data={data}
        color={color}
        width={sizeExpression(style, 2.5)}
        opacity={layer.opacity}
        idProperty={FEATURE_ID_KEY}
        selectedId={selectedId}
        visible={visible}
        interactive={interactive}
        hoverHtml={hoverHtml}
        onFeatureClick={handleClick}
      />
    )
  }

  if (layer.geometry === 'point') {
    return (
      <MapCircleLayer
        layerOrder={drawOrder}
        data={data}
        color={color}
        radius={sizeExpression(style, 5)}
        opacity={layer.opacity}
        strokeColor="#ffffff"
        strokeWidth={1.25}
        idProperty={FEATURE_ID_KEY}
        selectedId={selectedId}
        visible={visible}
        hoverEnabled={interactive}
        hoverHtml={hoverHtml}
        onFeatureClick={interactive ? handleClick : undefined}
      />
    )
  }

  return (
    <MapFillLayer
      data={data}
      fillColor={color}
      fillOpacity={layer.opacity}
      hoverFillOpacity={interactive ? Math.min(1, layer.opacity + 0.2) : undefined}
      lineColor={color}
      lineWidth={1.2}
      lineOpacity={Math.min(1, 0.4 + layer.opacity)}
      idProperty={FEATURE_ID_KEY}
      selectedId={selectedId}
      visible={visible}
      hoverHtml={hoverHtml}
      onFeatureClick={interactive ? handleClick : undefined}
    />
  )
}
