import { describe, expect, it } from 'vitest'
import type { Geometry } from 'geojson'
import { geometryHandles, insertVertex, MAX_EDITABLE_VERTICES, vertexCount } from './geometryEditing'

describe('edge midpoints', () => {
  it('insert where MapLibre draws the edge, not across the antimeridian', () => {
    const wide: Geometry = {
      type: 'LineString',
      coordinates: [
        [-100, 0],
        [100, 10],
      ],
    }
    const edge = geometryHandles(wide).edges[0]
    expect(edge.point).toEqual([0, 5])
    const inserted = insertVertex(wide, edge.after)
    expect(inserted.type === 'LineString' && inserted.coordinates).toEqual([
      [-100, 0],
      [0, 5],
      [100, 10],
    ])
    const ring: Geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [170, 0],
          [-170, 0],
          [-170, 10],
          [170, 0],
        ],
      ],
    }
    expect(geometryHandles(ring).edges[0].point).toEqual([0, 0])
    const closed = insertVertex(ring, geometryHandles(ring).edges[0].after)
    expect(closed.type === 'Polygon' && closed.coordinates[0][1]).toEqual([0, 0])
  })
})

describe('vertex editing limit', () => {
  const ring = (n: number) => [...Array.from({ length: n }, (_, i) => [i / n, Math.sin(i)]), [0, 0]]
  it('counts the handles a geometry would get, without closing ring positions', () => {
    const shapes: Geometry[] = [
      { type: 'Point', coordinates: [0, 0] },
      {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
          [2, 0],
        ],
      },
      { type: 'Polygon', coordinates: [ring(5), ring(4)] },
      { type: 'MultiPolygon', coordinates: [[ring(5)], [ring(3), ring(3)]] },
      {
        type: 'MultiLineString',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
          [
            [2, 2],
            [3, 3],
            [4, 4],
          ],
        ],
      },
      {
        type: 'GeometryCollection',
        geometries: [
          {
            type: 'MultiPoint',
            coordinates: [
              [0, 0],
              [1, 1],
            ],
          },
          { type: 'Polygon', coordinates: [ring(6)] },
        ],
      },
    ]
    for (const shape of shapes) expect(vertexCount(shape)).toBe(geometryHandles(shape).vertices.length)
  })
  it('stays within a budget the DOM handles can render', () => {
    expect(MAX_EDITABLE_VERTICES).toBeGreaterThanOrEqual(500)
    expect(MAX_EDITABLE_VERTICES).toBeLessThanOrEqual(2000)
    expect(vertexCount({ type: 'Polygon', coordinates: [ring(200000)] })).toBe(200000)
  })
})
