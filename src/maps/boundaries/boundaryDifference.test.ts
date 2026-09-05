import { describe, expect, it } from 'vitest'
import { compareBoundaryLayers, type DifferenceLayer } from './boundaryDifference'

function rectangle(x: number, y: number, width = 2): GeoJSON.Feature<GeoJSON.Polygon> {
  return {
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [x, y],
          [x + width, y],
          [x + width, y + 2],
          [x, y + 2],
          [x, y],
        ],
      ],
    },
  }
}
function layer(id: string, features: DifferenceLayer['features']): DifferenceLayer {
  return { id, name: id, features }
}

describe('boundary surface comparisons', () => {
  it('preserves area across overlap and unique surfaces', () => {
    const { surfaces, difference } = compareBoundaryLayers([
      layer('a', [rectangle(0, 0)]),
      layer('b', [rectangle(1, 0)]),
    ])
    expect(difference.aShare).toBeCloseTo(0.5)
    expect(difference.bShare).toBeCloseTo(0.5)
    expect(difference.overlapKm2 + difference.onlyAKm2).toBeCloseTo(surfaces[0].areaKm2)
    expect(difference.overlapKm2 + difference.onlyBKm2).toBeCloseTo(surfaces[1].areaKm2)
  })
  it('reports disjoint polygons as zero overlap with both unique surfaces', () => {
    const { difference } = compareBoundaryLayers([layer('a', [rectangle(0, 0)]), layer('b', [rectangle(5, 0)])])
    expect(difference.overlap).toBeNull()
    expect(difference.overlapKm2).toBe(0)
    expect(difference.onlyA).not.toBeNull()
    expect(difference.onlyB).not.toBeNull()
  })
  it('dissolves overlapping members before measuring the whole layer', () => {
    const { difference } = compareBoundaryLayers([
      layer('a', [rectangle(0, 0), rectangle(1, 0)]),
      layer('b', [rectangle(0, 0, 3)]),
    ])
    expect(difference.aShare).toBeCloseTo(1)
    expect(difference.onlyAKm2).toBe(0)
    expect(difference.onlyBKm2).toBe(0)
  })
  it('rejects empty or invalid geometry rather than displaying fabricated zero overlap', () => {
    expect(() => compareBoundaryLayers([layer('a', []), layer('b', [rectangle(0, 0)])])).toThrow()
    const invalid = rectangle(0, 0)
    invalid.geometry.coordinates = [
      [
        [0, 0],
        [1, 1],
      ],
    ]
    expect(() => compareBoundaryLayers([layer('a', [invalid]), layer('b', [rectangle(0, 0)])])).toThrow()
  })
})
