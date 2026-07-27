import { describe, expect, it } from 'vitest'
import { getWinterRangeBounds, isUsableWinterRangeGeometry, winterRangeTooltipHtml } from './warsWinterRange'

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

describe('getWinterRangeBounds', () => {
  it('frames every part of a multipolygon', () => {
    expect(
      getWinterRangeBounds({
        type: 'MultiPolygon',
        coordinates: [
          [validRing],
          [
            [
              [-121, 55],
              [-120, 55],
              [-120, 56],
              [-121, 55],
            ],
          ],
        ],
      }),
    ).toEqual([
      [-123, 53],
      [-120, 56],
    ])
  })

  it('ignores holes, which cannot extend the outline', () => {
    expect(
      getWinterRangeBounds({
        type: 'Polygon',
        coordinates: [
          validRing,
          [
            [-122.8, 53.2],
            [-122.6, 53.2],
            [-122.6, 53.4],
            [-122.8, 53.2],
          ],
        ],
      }),
    ).toEqual([
      [-123, 53],
      [-122, 54],
    ])
  })

  it('returns null for geometry with no usable coordinates', () => {
    expect(getWinterRangeBounds({ type: 'MultiPolygon', coordinates: [] })).toBeNull()
  })
})

describe('winterRangeTooltipHtml', () => {
  it('wraps the tooltip in a popover card so it is not bare text on the basemap', () => {
    const html = winterRangeTooltipHtml({ speciesLabel: 'Moose', label: 'u-7-022 · 17', hectares: 1417.4 })
    expect(html).toContain('bg-popover')
    expect(html).toContain('Moose winter range')
    expect(html).toContain('u-7-022 · 17')
    expect(html).toContain('1,417 ha')
  })

  it('escapes source text and drops a missing area', () => {
    const html = winterRangeTooltipHtml({ speciesLabel: '<script>', label: 'a & b', hectares: 0 })
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('a &amp; b')
    expect(html).not.toContain(' ha<')
  })
})
