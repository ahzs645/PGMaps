import { describe, expect, it } from 'vitest'
import { boundsCenter, distanceKm, geometryBounds, haversineKm } from './geo'

describe('geometryBounds', () => {
  it('returns a zero-area box for a Point', () => {
    expect(geometryBounds({ type: 'Point', coordinates: [-122.75, 53.91] })).toEqual([-122.75, 53.91, -122.75, 53.91])
  })

  it('covers a LineString', () => {
    expect(
      geometryBounds({ type: 'LineString', coordinates: [[-1, 1], [2, -3], [0, 0]] }),
    ).toEqual([-1, -3, 2, 1])
  })

  it('covers a MultiLineString, which the scorebuilder copy dropped to null', () => {
    expect(
      geometryBounds({ type: 'MultiLineString', coordinates: [[[-1, 0], [1, 0]], [[0, -5], [0, 5]]] }),
    ).toEqual([-1, -5, 1, 5])
  })

  it('covers a Polygon including its holes', () => {
    expect(
      geometryBounds({
        type: 'Polygon',
        coordinates: [
          [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
          [[1, 1], [2, 1], [2, 2], [1, 2], [1, 1]],
        ],
      }),
    ).toEqual([0, 0, 4, 4])
  })

  it('covers a MultiPolygon', () => {
    expect(
      geometryBounds({
        type: 'MultiPolygon',
        coordinates: [
          [[[0, 0], [1, 0], [1, 1], [0, 0]]],
          [[[5, 5], [6, 5], [6, 6], [5, 5]]],
        ],
      }),
    ).toEqual([0, 0, 6, 6])
  })

  it('covers MultiPoint and GeometryCollection', () => {
    expect(geometryBounds({ type: 'MultiPoint', coordinates: [[-2, 3], [4, -1]] })).toEqual([-2, -1, 4, 3])
    expect(
      geometryBounds({
        type: 'GeometryCollection',
        geometries: [
          { type: 'Point', coordinates: [0, 0] },
          { type: 'LineString', coordinates: [[10, 10], [20, 20]] },
        ],
      }),
    ).toEqual([0, 0, 20, 20])
  })

  it('returns null for missing or coordinate-less geometry', () => {
    expect(geometryBounds(null)).toBeNull()
    expect(geometryBounds(undefined)).toBeNull()
    expect(geometryBounds({ type: 'Polygon', coordinates: [] })).toBeNull()
    expect(geometryBounds({ type: 'GeometryCollection', geometries: [] })).toBeNull()
  })

  it('skips non-finite coordinates rather than poisoning the box', () => {
    expect(
      geometryBounds({ type: 'LineString', coordinates: [[0, 0], [Number.NaN, 5], [3, 3]] }),
    ).toEqual([0, 0, 3, 3])
  })
})

describe('boundsCenter', () => {
  it('returns the midpoint of the bounding box', () => {
    expect(boundsCenter({ type: 'LineString', coordinates: [[0, 0], [4, 10]] })).toEqual([2, 5])
  })

  it('returns null when there are no coordinates', () => {
    expect(boundsCenter({ type: 'Polygon', coordinates: [] })).toBeNull()
  })
})

describe('haversineKm / distanceKm', () => {
  it('measures a known distance', () => {
    // Prince George to Vancouver, ~525 km great-circle.
    expect(haversineKm(53.9171, -122.7497, 49.2827, -123.1207)).toBeCloseTo(515, -1)
  })

  it('takes [lng, lat] order and agrees with haversineKm', () => {
    expect(distanceKm([-122.7497, 53.9171], [-123.1207, 49.2827])).toBeCloseTo(
      haversineKm(53.9171, -122.7497, 49.2827, -123.1207),
      10,
    )
  })

  it('is zero for identical points', () => {
    expect(distanceKm([-122.75, 53.91], [-122.75, 53.91])).toBe(0)
  })
})
