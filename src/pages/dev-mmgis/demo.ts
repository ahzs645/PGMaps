import type { FeatureCollection } from 'geojson'
import { makeLayer, type Mission } from './model'

/** Explicitly illustrative field data; these are not measured observations. */
export function demoMission(): Mission {
  const sites: FeatureCollection = {
    type: 'FeatureCollection',
    features: [
      ['Base camp', -122.76, 53.918, 'Operations', 12, '2026-06-01'],
      ['River station', -122.742, 53.925, 'Water', 8, '2026-06-02'],
      ['North transect', -122.756, 53.939, 'Ecology', 16, '2026-06-03'],
      ['East lookout', -122.714, 53.928, 'Terrain', 4, '2026-06-04'],
      ['South station', -122.744, 53.901, 'Water', 10, '2026-06-05'],
      ['Forest plot', -122.784, 53.929, 'Ecology', 22, '2026-06-06'],
    ].map(([name, lng, lat, discipline, samples, date]) => ({
      type: 'Feature',
      properties: { name, discipline, samples, date, source: 'Illustrative example — not measured data' },
      geometry: { type: 'Point', coordinates: [Number(lng), Number(lat)] },
    })),
  }
  const area = makeLayer(
    'Survey area',
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Field study boundary', source: 'Illustrative example' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-122.797, 53.891],
                [-122.699, 53.891],
                [-122.699, 53.948],
                [-122.797, 53.948],
                [-122.797, 53.891],
              ],
            ],
          },
        },
      ],
    },
    'Example mission',
  )
  area.style = { type: 'simple', color: '#1d948b' }
  area.opacity = 0.12
  const route = makeLayer(
    'Survey traverse',
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { name: 'Proposed field traverse', status: 'Planning', source: 'Illustrative example' },
          geometry: {
            type: 'LineString',
            coordinates: [
              [-122.76, 53.918],
              [-122.742, 53.925],
              [-122.756, 53.939],
              [-122.784, 53.929],
            ],
          },
        },
      ],
    },
    'Example mission',
  )
  route.style = { type: 'simple', color: '#d49138' }
  const stations = makeLayer('Field stations', sites, 'Example mission')
  stations.timeProperty = 'date'
  stations.nameKey = 'name'
  stations.style = {
    type: 'categories',
    column: 'discipline',
    otherColor: '#64748b',
    categories: [
      { value: 'Operations', color: '#d49138' },
      { value: 'Water', color: '#2985b5' },
      { value: 'Ecology', color: '#219b82' },
      { value: 'Terrain', color: '#a778bd' },
    ],
  }
  return {
    schema: 'pgmaps-mission-v1',
    id: 'field-survey',
    name: 'Prince George · Field survey',
    description:
      'An illustrative Earth mission for exploring layers, time, terrain and field planning. Example stations and traverse are not measured observations.',
    layers: [area, route, stations],
    tiles: [],
    bookmarks: [],
    camera: { center: [-122.7497, 53.9171], zoom: 12, bearing: 0, pitch: 0 },
    view: 'map',
    terrain: false,
    time: { enabled: false, start: '2026-06-01', end: '2026-06-06' },
  }
}
