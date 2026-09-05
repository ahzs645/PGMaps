import { expect, it, vi } from 'vitest'
import type MapLibreGL from 'maplibre-gl'
import { releaseGeoJsonSource, retainGeoJsonSource, updateGeoJsonSource } from './map-shared-source'
it('indexes shared data once and keeps it until the last style is removed', () => {
  const source = { setData: vi.fn() }
  let exists = false
  const map = {
    getSource: () => (exists ? source : undefined),
    addSource: vi.fn(() => {
      exists = true
    }),
    removeSource: vi.fn(() => {
      exists = false
    }),
  } as unknown as MapLibreGL.Map
  const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
  retainGeoJsonSource(map, 'trees')
  retainGeoJsonSource(map, 'trees')
  updateGeoJsonSource(map, 'trees', data)
  updateGeoJsonSource(map, 'trees', data)
  expect(map.addSource).toHaveBeenCalledTimes(1)
  expect(source.setData).toHaveBeenCalledTimes(1)
  releaseGeoJsonSource(map, 'trees')
  expect(map.removeSource).not.toHaveBeenCalled()
  releaseGeoJsonSource(map, 'trees')
  expect(map.removeSource).toHaveBeenCalledOnce()
})
