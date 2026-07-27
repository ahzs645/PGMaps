import { useMemo, useState } from 'react'
import { MapFeatureTablePanel, type MapFeatureTableColumn, type MapFeatureTableLayer } from '@/components/map/MapFeatureTable'
import { neighbourhoodFeatures, parkFeatures, routeFeatures } from './data'
import { featureMatchesYearRange, layerLabel } from './geo'
import type { InteractFeature, LayerId, YearRange } from './types'

const tableLayers: Array<MapFeatureTableLayer<LayerId>> = [
  { id: 'parks', label: layerLabel('parks'), color: '#22c55e', shape: 'fill' },
  { id: 'neighbourhoods', label: layerLabel('neighbourhoods'), color: '#8b5cf6', shape: 'fill' },
  { id: 'routes', label: layerLabel('routes'), color: '#0ea5e9', shape: 'line' },
]

const columns: Array<MapFeatureTableColumn<InteractFeature>> = [
  { id: 'name', header: 'Name', type: 'text', width: 200, getValue: (feature) => feature.properties.name },
  { id: 'layer', header: 'Layer', type: 'text', getValue: (feature) => layerLabel(feature.properties.layer) },
  { id: 'description', header: 'Description', type: 'text', width: 240, getValue: (feature) => feature.properties.description },
  { id: 'issuedYear', header: 'Issued', type: 'numeric', width: 110, getValue: (feature) => feature.properties.issuedYear },
  { id: 'value', header: 'Value', type: 'text', getValue: (feature) => feature.properties.value ?? '' },
  ...[0, 1, 2, 3].map((index) => ({
    id: `property-${index + 1}`,
    header: `Property ${index + 1}`,
    type: 'text' as const,
    getValue: (feature: InteractFeature) => feature.properties.properties[index]?.value ?? '',
    getSearchValue: (feature: InteractFeature) => {
      const property = feature.properties.properties[index]
      return property ? `${property.label} ${property.value}` : ''
    },
  })),
]

export function FeatureTablePanel({
  layer,
  onLayerChange,
  hiddenFeatureIds,
  isolatedFeatureId,
  yearRange,
  selectedFeatureId = null,
  height,
  onHeightChange,
  onClose,
  onSelect,
}: {
  layer: LayerId
  onLayerChange: (layer: LayerId) => void
  hiddenFeatureIds: Set<string>
  isolatedFeatureId: string | null
  yearRange: YearRange
  selectedFeatureId?: string | null
  height?: number
  onHeightChange?: (height: number) => void
  onClose: () => void
  onSelect: (feature: InteractFeature) => void
}) {
  const [showOnlyInView, setShowOnlyInView] = useState(false)

  const rows = useMemo(() => {
    const collection = layer === 'parks' ? parkFeatures : layer === 'routes' ? routeFeatures : neighbourhoodFeatures
    return collection.features.filter((feature) => {
      if (hiddenFeatureIds.has(feature.properties.id)) return false
      if (isolatedFeatureId && feature.properties.id !== isolatedFeatureId) return false
      if (!featureMatchesYearRange(feature, yearRange)) return false
      if (showOnlyInView && feature.properties.id === 'college-heights') return false
      return true
    })
  }, [hiddenFeatureIds, isolatedFeatureId, layer, showOnlyInView, yearRange])

  return (
    <MapFeatureTablePanel
      rows={rows}
      columns={columns}
      layers={tableLayers}
      selectedLayer={layer}
      getRowId={(feature) => feature.properties.id}
      selectedRowId={selectedFeatureId}
      height={height}
      onHeightChange={onHeightChange}
      showOnlyInView={showOnlyInView}
      onShowOnlyInViewChange={setShowOnlyInView}
      onLayerChange={onLayerChange}
      onClose={onClose}
      onSelect={onSelect}
      viewModeToggle
      resizable
      collapsibleSearch
    />
  )
}
