import { describe, expect, it } from 'vitest'
import { isUsableWinterRangeGeometry } from './warsWinterRange'

const validRing: GeoJSON.Position[] = [
  [-123, 53],
  [-122, 53],
  [-122, 54],
  [-123, 53],
]

describe('isUsableWinterRangeGeometry', () => {
  it('accepts valid polygon and multipolygon geometries', () => {
    expect(isUsableWinterRangeGeometry({ type: 'Polygon', coordinates: [validRing] })).toBe(true)
    expect(isUsableWinterRangeGeometry({ type: 'MultiPolygon', coordinates: [[validRing]] })).toBe(true)
  })

  it('rejects empty polygon structures produced by bbox clipping', () => {
    expect(isUsableWinterRangeGeometry({ type: 'Polygon', coordinates: [] })).toBe(false)
    expect(isUsableWinterRangeGeometry({ type: 'MultiPolygon', coordinates: [[]] })).toBe(false)
  })

  it('rejects malformed and degenerate rings', () => {
    expect(
      isUsableWinterRangeGeometry({
        type: 'Polygon',
        coordinates: [
          [
            [-123, 53],
            [-122, 53],
            [-122, 54],
            [-123, 54],
          ],
        ],
      }),
    ).toBe(false)
    expect(
      isUsableWinterRangeGeometry({
        type: 'Polygon',
        coordinates: [
          [
            [-123, 53],
            [-123, 53],
            [-123, 53],
            [-123, 53],
          ],
        ],
      }),
    ).toBe(false)
  })
})
