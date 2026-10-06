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
  expect(map.addSource).toHaveBeenCalledWith('trees', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  })
  updateGeoJsonSource(map, 'trees', data)
  updateGeoJsonSource(map, 'trees', data)
  expect(map.addSource).toHaveBeenCalledTimes(1)
  expect(source.setData).toHaveBeenCalledTimes(1)
  releaseGeoJsonSource(map, 'trees')
  expect(map.removeSource).not.toHaveBeenCalled()
  releaseGeoJsonSource(map, 'trees')
  expect(map.removeSource).toHaveBeenCalledOnce()
})

it('allows native road geometry to disable simplification without reindexing shared styles', () => {
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
  const data: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: [
            [-123, 54],
            [-122.99999, 54.00001],
            [-122, 55],
          ],
        },
      },
    ],
  }
  retainGeoJsonSource(map, 'roads', undefined, 0)
  retainGeoJsonSource(map, 'roads', undefined, 0)
  updateGeoJsonSource(map, 'roads', data)
  updateGeoJsonSource(map, 'roads', data)
  expect(map.addSource).toHaveBeenCalledWith('roads', {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
    tolerance: 0,
  })
  expect(map.addSource).toHaveBeenCalledOnce()
  expect(source.setData).toHaveBeenCalledOnce()
  expect(source.setData).toHaveBeenCalledWith(data)
  releaseGeoJsonSource(map, 'roads')
  expect(map.removeSource).not.toHaveBeenCalled()
  releaseGeoJsonSource(map, 'roads')
  expect(map.removeSource).toHaveBeenCalledOnce()
})
