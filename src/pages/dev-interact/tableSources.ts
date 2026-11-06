import type { MapFeatureTableColumn } from '@/components/map/MapFeatureTable'
import { numberColumn, textColumn } from '@/components/map/tableColumns'
import { defineTableSource, type MapTableSource } from '@/components/map/useMapTable'
import { featureCenter } from '@/lib/featureBounds'
import { featureBounds, layerLabel } from './geo'
import type { InteractFeature, LayerId } from './types'

const columns: Array<MapFeatureTableColumn<InteractFeature>> = [
  textColumn('name', 'Name', (feature) => feature.properties.name, { width: 200 }),
  textColumn('layer', 'Layer', (feature) => layerLabel(feature.properties.layer)),
  textColumn('description', 'Description', (feature) => feature.properties.description, { width: 240 }),
  numberColumn('issuedYear', 'Issued', (feature) => feature.properties.issuedYear, {
    width: 110,
    format: String,
  }),
  textColumn('value', 'Value', (feature) => feature.properties.value),
  ...[0, 1, 2, 3].map((index) =>
    textColumn<InteractFeature>(
      `property-${index + 1}`,
      `Property ${index + 1}`,
      (feature) => feature.properties.properties[index]?.value,
      {
        getSearchValue: (feature) => {
          const property = feature.properties.properties[index]
          return property ? `${property.label} ${property.value}` : ''
        },
      },
    ),
  ),
]

const LAYERS: Array<{ id: LayerId; color: string; shape: 'fill' | 'line' }> = [
  { id: 'parks', color: '#22c55e', shape: 'fill' },
  { id: 'neighbourhoods', color: '#8b5cf6', shape: 'fill' },
  { id: 'routes', color: '#0ea5e9', shape: 'line' },
]

/** One table per layer, reading the collections the map draws after its filters. */
export function interactTableSources(rowsByLayer: Record<LayerId, InteractFeature[]>): MapTableSource[] {
  return LAYERS.map(({ id, color, shape }) =>
    defineTableSource<InteractFeature>({
      id,
      label: layerLabel(id),
      color,
      shape,
      rows: rowsByLayer[id],
      columns,
      getRowId: (feature) => feature.properties.id,
      getRowCenter: featureCenter,
      getRowBounds: featureBounds,
    }),
  )
}
