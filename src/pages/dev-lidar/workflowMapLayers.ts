import { isSpeciesMode, speciesLegend, SPECIES_COLOURS } from './species'
import type { GeoJSONSource, Map, LayerSpecification } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { LABEL_ANCHOR } from './basemaps'
import { isForestMode, FOREST_PALETTES } from './forestry'
import type { WorkflowFeature, WorkflowOptions } from './analysisWorkflows'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
export const WORKFLOW_LAYERS = [
  'workflow-gaps',
  'workflow-plots',
  'workflow-plot-lines',
  'workflow-clearance',
  'workflow-forest',
  'workflow-forest-lines',
  'workflow-selected',
]
export function installWorkflowLayers(map: Map) {
  if (!map.getSource('workflow-features')) map.addSource('workflow-features', { type: 'geojson', data: EMPTY })
  if (!map.getSource('workflow-selection')) map.addSource('workflow-selection', { type: 'geojson', data: EMPTY })
  // Put thematic fills below context labels; retain selection outlines above candidates.
  const add = (layer: LayerSpecification) => map.addLayer(layer, layer.type === 'fill' ? LABEL_ANCHOR : undefined)
  const hidden = { visibility: 'none' } as const
  if (!map.getLayer('workflow-gaps'))
    add({
      id: 'workflow-gaps',
      type: 'fill',
      source: 'workflow-features',
      layout: hidden,
      paint: { 'fill-color': '#22d3ee', 'fill-opacity': 0.45, 'fill-outline-color': '#075985' },
    })
  if (!map.getLayer('workflow-plots'))
    add({
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
    add({
      id: 'workflow-plot-lines',
      type: 'line',
      source: 'workflow-features',
      layout: hidden,
      paint: { 'line-color': '#6b21a8', 'line-width': 0.6 },
    })
  if (!map.getLayer('workflow-clearance'))
    add({
      id: 'workflow-clearance',
      type: 'line',
      source: 'workflow-features',
      layout: hidden,
      paint: { 'line-color': '#f472b6', 'line-width': 3 },
    })
  if (!map.getLayer('workflow-forest'))
    add({
      id: 'workflow-forest',
      type: 'fill',
      source: 'workflow-features',
      layout: hidden,
      paint: {
        'fill-color': ['interpolate', ['linear'], ['get', 'map_value'], 0, '#fff7ed', 0.5, '#fb923c', 1, '#7c2d12'],
        'fill-opacity': 0.65,
      },
    })
  if (!map.getLayer('workflow-forest-lines'))
    add({
      id: 'workflow-forest-lines',
      type: 'line',
      source: 'workflow-features',
      layout: hidden,
      paint: { 'line-color': '#64748b', 'line-width': 0.5 },
    })
  if (!map.getLayer('workflow-selected'))
    add({
      id: 'workflow-selected',
      type: 'line',
      source: 'workflow-selection',
      layout: hidden,
      paint: { 'line-color': '#ffffff', 'line-width': 4, 'line-dasharray': [2, 1] },
    })
}
export function applyWorkflowLayers(
  map: Pick<Map, 'getSource' | 'setLayoutProperty' | 'setPaintProperty'>,
  options: WorkflowOptions,
  features: WorkflowFeature[],
  selectedId: string | null,
) {
  ;(map.getSource('workflow-features') as GeoJSONSource).setData({ type: 'FeatureCollection', features })
  ;(map.getSource('workflow-selection') as GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: features.filter((f) => f.properties.id === selectedId),
  })
  map.setPaintProperty('workflow-forest', 'fill-opacity', isSpeciesMode(options.mode) ? options.speciesOpacity : 0.65)
  if (isSpeciesMode(options.mode)) {
    const legend = speciesLegend(options)
    const colour = legend.categorical
      ? [
          'match',
          ['coalesce', ['get', 'leading'], ''],
          ...Object.entries(SPECIES_COLOURS).flatMap(([code, colour]) => [code, colour]),
          '#94a3b8',
        ]
      : [
          'case',
          ['==', ['get', 'map_value'], null],
          '#94a3b8',
          [
            'interpolate',
            ['linear'],
            ['get', 'map_value'],
            legend.min,
            legend.colors[0],
            (legend.min + legend.max) / 2,
            legend.colors[1],
            legend.max,
            legend.colors[2],
          ],
        ]
    map.setPaintProperty('workflow-forest', 'fill-color', colour as import('maplibre-gl').ExpressionSpecification)
  }
  if (isForestMode(options.mode)) {
    const palette = FOREST_PALETTES[options.mode]
    map.setPaintProperty('workflow-forest', 'fill-color', [
      'interpolate',
      ['linear'],
      ['get', 'map_value'],
      palette.min,
      palette.colors[0],
      (palette.min + palette.max) / 2,
      palette.colors[1],
      palette.max,
      palette.colors[2],
    ])
  }
  const active =
    isForestMode(options.mode) || isSpeciesMode(options.mode)
      ? ['workflow-forest', 'workflow-forest-lines']
      : options.mode === 'gaps'
        ? ['workflow-gaps']
        : options.mode === 'plots'
          ? ['workflow-plots', 'workflow-plot-lines']
          : options.mode === 'clearance'
            ? ['workflow-clearance']
            : []
  if (features.length && selectedId && options.mode !== 'models') active.push('workflow-selected')
  for (const id of WORKFLOW_LAYERS) map.setLayoutProperty(id, 'visibility', active.includes(id) ? 'visible' : 'none')
}
