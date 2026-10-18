import type { GeoJSONSource, Map } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { WorkflowFeature, WorkflowOptions } from './analysisWorkflows'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
export const WORKFLOW_LAYERS = [
  'workflow-gaps',
  'workflow-plots',
  'workflow-plot-lines',
  'workflow-clearance',
  'workflow-selected',
]
export function installWorkflowLayers(map: Map) {
  if (!map.getSource('workflow-features')) map.addSource('workflow-features', { type: 'geojson', data: EMPTY })
  if (!map.getSource('workflow-selection')) map.addSource('workflow-selection', { type: 'geojson', data: EMPTY })
  const hidden = { visibility: 'none' } as const
  if (!map.getLayer('workflow-gaps'))
    map.addLayer({
      id: 'workflow-gaps',
      type: 'fill',
      source: 'workflow-features',
      layout: hidden,
      paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.45, 'fill-outline-color': '#075985' },
    })
  if (!map.getLayer('workflow-plots'))
    map.addLayer({
      id: 'workflow-plots',
      type: 'fill',
      source: 'workflow-features',
      layout: hidden,
      paint: {
        'fill-color': [
          'interpolate',
          ['linear'],
          ['get', 'p95_m'],
          0,
          '#faf5ff',
          10,
          '#d8b4fe',
          20,
          '#a855f7',
          35,
          '#581c87',
        ],
        'fill-opacity': 0.55,
      },
    })
  if (!map.getLayer('workflow-plot-lines'))
    map.addLayer({
      id: 'workflow-plot-lines',
      type: 'line',
      source: 'workflow-features',
      layout: hidden,
      paint: { 'line-color': '#6b21a8', 'line-width': 0.6 },
    })
  if (!map.getLayer('workflow-clearance'))
    map.addLayer({
      id: 'workflow-clearance',
      type: 'line',
      source: 'workflow-features',
      layout: hidden,
      paint: { 'line-color': '#f472b6', 'line-width': 3 },
    })
  if (!map.getLayer('workflow-selected'))
    map.addLayer({
      id: 'workflow-selected',
      type: 'line',
      source: 'workflow-selection',
      layout: hidden,
      paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-dasharray': [2, 1] },
    })
}
export function applyWorkflowLayers(
  map: Pick<Map, 'getSource' | 'setLayoutProperty'>,
  options: WorkflowOptions,
  features: WorkflowFeature[],
  selectedId: string | null,
) {
  ;(map.getSource('workflow-features') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
  ;(map.getSource('workflow-selection') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: features.filter((f) => f.properties.id === selectedId),
  })
  const active =
    options.mode === 'gaps'
      ? ['workflow-gaps']
      : options.mode === 'plots'
        ? ['workflow-plots', 'workflow-plot-lines']
        : options.mode === 'clearance'
          ? ['workflow-clearance']
          : []
  if (features.length && selectedId && options.mode !== 'models') active.push('workflow-selected')
  for (const id of WORKFLOW_LAYERS) map.setLayoutProperty(id, 'visibility', active.includes(id) ? 'visible' : 'none')
}
