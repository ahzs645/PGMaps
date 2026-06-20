import { describe, expect, it } from 'vitest'
import {
  cellCenterLngLat,
  decodeRleBands,
  zonalMeanMiByRegion,
  type WalkabilityMiGrid,
} from './walkabilityZonal'
import type { ScoreBuilderRegion } from '../types'

// Axis-aligned 2x2 grid spanning lng[0,1] lat[0,1]; row 0 is the north edge.
const IMAGE: WalkabilityMiGrid['imageCoordinates'] = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
]

function rectRegion(id: string, west: number, south: number, east: number, north: number): ScoreBuilderRegion {
  return {
    id,
    code: id,
    name: id,
    source: 'census',
    level: 'da',
    bounds: [west, south, east, north],
    areaKm2: 1,
    feature: {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [west, south],
            [east, south],
            [east, north],
            [west, north],
            [west, south],
          ],
        ],
      },
    },
  }
}

describe('decodeRleBands', () => {
  it('expands run-length pairs into a per-cell band array', () => {
    expect(Array.from(decodeRleBands([[0, 2], [3, 1], [5, 1]], 4))).toEqual([0, 0, 3, 5])
  })

  it('stops at the declared cell count', () => {
    expect(Array.from(decodeRleBands([[1, 10]], 3))).toEqual([1, 1, 1])
  })
})

describe('cellCenterLngLat', () => {
  it('returns the bilinear centre of a cell', () => {
    // Top-left cell of a 2x2 grid: centre at (0.25, 0.75).
    expect(cellCenterLngLat(IMAGE, 2, 2, 0, 0)).toEqual([0.25, 0.75])
    // Bottom-right cell: centre at (0.75, 0.25).
    expect(cellCenterLngLat(IMAGE, 2, 2, 1, 1)).toEqual([0.75, 0.25])
  })
})

describe('zonalMeanMiByRegion', () => {
  const grid: WalkabilityMiGrid = {
    rows: 2,
    cols: 2,
    imageCoordinates: IMAGE,
    defaultVariant: 'v',
    // Bands row-major: (0,0)=2 (0,1)=4 (1,0)=2 (1,1)=4
    grids: { v: [[2, 1], [4, 1], [2, 1], [4, 1]] },
  }

  it('averages the bands of the cells whose centre falls inside each region', () => {
    const west = rectRegion('west', -0.1, -0.1, 0.5, 1.1)
    const east = rectRegion('east', 0.5, -0.1, 1.1, 1.1)
    const result = zonalMeanMiByRegion(grid, [west, east])
    expect(result.get('west')).toEqual({ mean: 2, cellCount: 2 })
    expect(result.get('east')).toEqual({ mean: 4, cellCount: 2 })
  })

  it('reports zero mean / zero cells for regions that contain no raster cells', () => {
    const elsewhere = rectRegion('away', 10, 10, 11, 11)
    expect(zonalMeanMiByRegion(grid, [elsewhere]).get('away')).toEqual({ mean: 0, cellCount: 0 })
  })

  it('returns an empty map when there are no regions', () => {
    expect(zonalMeanMiByRegion(grid, []).size).toBe(0)
  })

  it('falls back to the default variant when the requested one is missing', () => {
    const west = rectRegion('west', -0.1, -0.1, 0.5, 1.1)
    const result = zonalMeanMiByRegion(grid, [west], 'does-not-exist')
    expect(result.get('west')?.cellCount).toBe(2)
  })
})
