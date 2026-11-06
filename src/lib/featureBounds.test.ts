import { describe, expect, it } from 'vitest'
import { boundsOverlap, featureCenter, featureInBounds, featuresBounds, type ViewportBounds } from './featureBounds'

const line = {
  geometry: {
    type: 'LineString',
    coordinates: [
      [-123, 53],
      [-122, 54],
    ],
  } as GeoJSON.Geometry,
}
const view: ViewportBounds = [-122.5, 53.5, -121, 55]

describe('featureBounds', () => {
  it('finds the box and centre of a feature', () => {
    expect(featuresBounds([line])).toEqual([-123, 53, -122, 54])
    expect(featureCenter(line)).toEqual([-122.5, 53.5])
  })

  it('keeps a shape that crosses the viewport', () => {
    expect(featureInBounds(line, view)).toBe(true)
    expect(boundsOverlap([-125, 53, -124, 54], view)).toBe(false)
  })

  it('returns nothing for a missing geometry', () => {
    expect(featuresBounds([{ geometry: null }])).toBeNull()
    expect(featureCenter({ geometry: null })).toBeNull()
    expect(featureInBounds({ geometry: null }, view)).toBe(false)
  })
})
