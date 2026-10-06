import { expect, it } from 'vitest'
import { readCensusLevel } from './useCensusData'

it('normalizes the requested level without requiring other hierarchy files', () => {
  const result = readCensusLevel(
    {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: { id: '2', population: '1,234', name: 'Second' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-123, 54],
                [-122, 54],
                [-122, 55],
                [-123, 54],
              ],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { id: '1' },
          geometry: {
            type: 'Polygon',
            coordinates: [
              [
                [-124, 53],
                [-123, 53],
                [-123, 54],
                [-124, 53],
              ],
            ],
          },
        },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } },
      ],
    },
    'da',
  )
  expect(result.units.map((unit) => unit.id)).toEqual(['1', '2'])
  expect(result.units[1]).toMatchObject({ level: 'da', population: 1234, name: 'Second' })
  expect(result.bounds).toEqual({ minLng: -124, minLat: 53, maxLng: -122, maxLat: 55 })
})
