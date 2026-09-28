import { describe, expect, it } from 'vitest'
import { polygonTransferables, preparePolygons, type ClassCollection } from './categoricalPolygonGeometry'

const collection: ClassCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { value: 10 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [4, 0],
            [4, 4],
            [0, 4],
            [0, 0],
          ],
          [
            [1, 1],
            [1, 3],
            [3, 3],
            [3, 1],
            [1, 1],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { value: 0 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [4, 0],
            [5, 0],
            [5, 4],
            [4, 4],
            [4, 0],
          ],
        ],
      },
    },
  ],
}

describe('prepared categorical polygons', () => {
  it('triangulates holes without filling them and preserves zero class and pick indices', () => {
    const prepared = preparePolygons(collection)
    const polygons = prepared.binary.polygons!
    const p = polygons.positions.value,
      triangles = polygons.triangles!.value
    let area = 0
    for (let i = 0; i < triangles.length; i += 3) {
      const a = triangles[i] * 2,
        b = triangles[i + 1] * 2,
        c = triangles[i + 2] * 2
      area += Math.abs((p[b] - p[a]) * (p[c + 1] - p[a + 1]) - (p[c] - p[a]) * (p[b + 1] - p[a + 1])) / 2
      const x = (p[a] + p[b] + p[c]) / 3,
        y = (p[a + 1] + p[b + 1] + p[c + 1]) / 3
      expect(x > 1 && x < 3 && y > 1 && y < 3).toBe(false)
    }
    expect(area).toBe(16) // 4×4 minus a 2×2 hole, plus the adjacent 1×4 polygon
    expect([...prepared.values]).toEqual([10, 0])
    expect(new Set(polygons.globalFeatureIds.value)).toEqual(new Set([0, 1]))
    expect(polygons.properties.map((p) => p.value)).toEqual([10, 0])
  })
  it('preserves double precision and transfers buffers without copying', () => {
    const prepared = preparePolygons(collection)
    expect(prepared.binary.polygons!.positions.value).toBeInstanceOf(Float64Array)
    const transferred = structuredClone(prepared, { transfer: polygonTransferables(prepared) })
    expect(prepared.values.byteLength).toBe(0)
    expect([...transferred.values]).toEqual([10, 0])
    expect(transferred.binary.polygons!.triangles!.value.length).toBeGreaterThan(0)
  })
})
