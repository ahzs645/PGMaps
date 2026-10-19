import type { Map, GeoJSONSource, LayerSpecification } from 'maplibre-gl'
import type { FeatureCollection, Polygon, Point } from 'geojson'
import type { IsolatedPoint } from './treeIsolation'
import { LABEL_ANCHOR } from './basemaps'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
export function applyTreeInspectionMap(
  map: Pick<Map, 'getSource' | 'addSource' | 'getLayer' | 'addLayer'>,
  cut: FeatureCollection<Polygon | Point> | null | undefined,
  picked: IsolatedPoint | null | undefined,
) {
  const add = (layer: LayerSpecification) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer, layer.type === 'fill' ? LABEL_ANCHOR : undefined)
  }
  if (!map.getSource('tree-inspection-cut')) map.addSource('tree-inspection-cut', { type: 'geojson', data: EMPTY })
  if (!map.getSource('tree-inspection-picked'))
    map.addSource('tree-inspection-picked', { type: 'geojson', data: EMPTY })
  add({
    id: 'tree-inspection-method-tops',
    type: 'circle',
    source: 'tree-inspection-cut',
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 3,
      'circle-color': '#ffffff',
      'circle-stroke-color': '#047857',
      'circle-stroke-width': 1,
    },
  })
  add({
    id: 'tree-inspection-cut-fill',
    type: 'fill',
    source: 'tree-inspection-cut',
    paint: { 'fill-color': '#f59e0b', 'fill-opacity': 0.15 },
  })
  add({
    id: 'tree-inspection-cut-line',
    type: 'line',
    source: 'tree-inspection-cut',
    paint: { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [2, 1] },
  })
  add({
    id: 'tree-inspection-picked',
    type: 'circle',
    source: 'tree-inspection-picked',
    paint: { 'circle-radius': 7, 'circle-color': '#e11d48', 'circle-stroke-color': 'white', 'circle-stroke-width': 2 },
  })
  ;(map.getSource('tree-inspection-cut') as GeoJSONSource).setData(cut ?? EMPTY)
  ;(map.getSource('tree-inspection-picked') as GeoJSONSource).setData(
    picked
      ? {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [picked.lon, picked.lat] },
          properties: { height_m: picked.height },
        }
      : EMPTY,
  )
}
export const inspectionPitch = (view: 'top' | '3d' | undefined, has3d: boolean) => (view === 'top' ? 0 : has3d ? 50 : 0)
