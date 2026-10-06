import { expect, it } from 'vitest'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { selectResearchBoundary } from './researchBoundary'

const source: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 8886,
      properties: { boundaryCode: '8886' },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [2, 0],
            [2, 2],
            [0, 2],
            [0, 0],
          ],
        ],
      },
    },
    { type: 'Feature', id: 999, properties: { boundaryCode: '999' }, geometry: { type: 'Point', coordinates: [1, 1] } },
  ],
}
it('selects only the official polygon and anchors the count within it', () => {
  const boundary = selectResearchBoundary(source, 'boundaryCode', '8886')
  expect(boundary.data.features).toEqual([source.features[0]])
  expect(booleanPointInPolygon(point(boundary.anchor), boundary.data.features[0])).toBe(true)
  expect(selectResearchBoundary(source, 'id', '8886').data.features).toEqual([source.features[0]])
})
it('reports a missing or non-polygon boundary instead of drawing a substitute', () => {
  expect(() => selectResearchBoundary(source, 'id', '999')).toThrow('not found')
  expect(() => selectResearchBoundary(source, 'id', '123')).toThrow('not found')
})
