import { attributeTableColumns } from '@/components/map/tableColumns'
import { defineTableSource, type MapTableSource } from '@/components/map/useMapTable'
import { featureCenter, featuresBounds } from '@/lib/featureBounds'
import { primaryColor } from '@/lib/layerStyle'
import { FEATURE_ID_KEY, effectiveStyle, filteredCollection, type DataFeature, type LoadedLayer } from './layerData'
import type { DataLayer } from './model'

function emptyMessage(layer: DataLayer, loaded: LoadedLayer): string {
  if (loaded.status === 'error') return `Could not load this layer${loaded.error ? `: ${loaded.error}` : ''}`
  if (loaded.status === 'idle') return 'Show this layer to load its rows'
  return layer.filter ? 'No rows match the layer filter' : 'No rows'
}

/** A workspace layer as a table: `/dev/data` and `/dev/mmgis` share this. */
export function dataLayerTableSource(layer: DataLayer, loaded: LoadedLayer): MapTableSource {
  const style = effectiveStyle(layer, loaded)
  return defineTableSource<DataFeature>({
    id: layer.id,
    label: layer.label,
    color: primaryColor(style),
    shape: layer.geometry,
    rows: () => filteredCollection(loaded.collection, layer, style).features,
    columns: attributeTableColumns(loaded.attributes, (feature, key) => feature.properties[key]),
    getRowId: (feature) => feature.properties[FEATURE_ID_KEY],
    getRowCenter: featureCenter,
    getRowBounds: (feature) => featuresBounds([feature]),
    status: loaded.status === 'loading' ? 'loading' : loaded.status === 'error' ? 'error' : 'ready',
    emptyMessage: emptyMessage(layer, loaded),
  })
}
