import type { Map } from 'maplibre-gl'
import type { LidarControl } from 'maplibre-gl-lidar'
import type { RasterKey } from './types'

export interface AnalysisLayerState {
  raster: RasterKey
  surfaceVisible: boolean
  surfaceOpacity: number
  trees: boolean
  buildings: boolean
  reference: boolean
  minTreeHeight: number
}

export function applyAnalysisLayers(
  map: Pick<Map, 'setLayoutProperty' | 'setPaintProperty' | 'setFilter'>,
  keys: string[],
  state: AnalysisLayerState,
) {
  for (const key of keys) {
    map.setLayoutProperty(
      `analysis-${key}`,
      'visibility',
      state.surfaceVisible && key === state.raster ? 'visible' : 'none',
    )
    map.setPaintProperty(`analysis-${key}`, 'raster-opacity', state.surfaceOpacity)
  }
  map.setLayoutProperty('trees', 'visibility', state.trees ? 'visible' : 'none')
  map.setFilter('trees', ['>=', ['get', 'height_m'], state.minTreeHeight])
  for (const id of ['reference-trees', 'reference-area'])
    map.setLayoutProperty(id, 'visibility', state.reference ? 'visible' : 'none')
  for (const id of ['roofs-fill', 'roofs-line'])
    map.setLayoutProperty(id, 'visibility', state.buildings ? 'visible' : 'none')
}

/** Also apply after an asynchronous load so a departed workflow cannot reveal points. */
export function applyPointCloudVisibility(
  control: Pick<LidarControl, 'setOpacity' | 'pauseStreaming' | 'resumeStreaming'>,
  id: string | null,
  visible: boolean,
) {
  control.setOpacity(visible ? 1 : 0)
  if (id) {
    if (visible) control.resumeStreaming(id)
    else control.pauseStreaming(id)
  }
}
