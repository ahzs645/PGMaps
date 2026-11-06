import { describe, expect, it } from 'vitest'
import type { CanueVariableSelection } from '../canueV2'
import { canueBoundaryMetric } from './boundaries'
import { canueBoundaryFeatureState, canueBoundaryPaint, canueV2Paint } from './paint'
import {
  collectTimelineValues,
  resolveBoundaryTimelineScale,
  resolveGridTimelineScale,
  resolvePeriodScale,
  selectionsAround,
} from './timelineScale'

function selection(year: number, overrides: Partial<CanueVariableSelection> = {}): CanueVariableSelection {
  return {
    family: 'air-quality',
    familyLabel: 'Air Quality',
    year,
    dataset: 'aqfpm_avf',
    variable: `avf${year}`,
    property: `avf__avf${year}`,
    pmtilesUrl: `https://example.test/${year}.pmtiles`,
    count: 10,
    min: 3,
    max: 12,
    ...overrides,
  }
}

describe('resolveBoundaryTimelineScale', () => {
  it('keeps one wildfire year from setting the top of the scale', () => {
    const typical = Array.from({ length: 998 }, (_, index) => 4 + (index / 997) * 10)
    const scale = resolveBoundaryTimelineScale([...typical, 48.2, 40])

    expect(scale?.high).toBeLessThan(15)
    expect(scale?.low).toBeGreaterThan(4)
    expect(scale?.clippedHigh).toBe(true)
  })

  it('reports no clipping when nothing lies past the percentile', () => {
    expect(resolveBoundaryTimelineScale([5, 5, 5, 5])).toEqual({
      low: 5,
      high: 6,
      clippedLow: false,
      clippedHigh: false,
    })
  })

  it('ignores values that are not numbers and has no scale without any', () => {
    expect(resolveBoundaryTimelineScale([Number.NaN, Number.POSITIVE_INFINITY])).toBeNull()
    expect(resolveBoundaryTimelineScale([1, Number.NaN, 3])?.low).toBeCloseTo(1.02)
  })
})

describe('resolvePeriodScale', () => {
  it('uses the full range of one period', () => {
    expect(resolvePeriodScale(2, 9)).toEqual({ low: 2, high: 9, clippedLow: false, clippedHigh: false })
  })

  it('gives a flat or empty period a usable span', () => {
    expect(resolvePeriodScale(4, 4)).toMatchObject({ low: 4, high: 5 })
    expect(resolvePeriodScale(null, null)).toMatchObject({ low: 0, high: 1 })
  })
})

describe('resolveGridTimelineScale', () => {
  it('tops out at the median period peak and clamps the outlier year', () => {
    const scale = resolveGridTimelineScale([
      selection(2021, { min: 3, max: 10 }),
      selection(2022, { min: 2.9, max: 12 }),
      selection(2023, { min: 4, max: 48.3 }),
    ])
    expect(scale).toEqual({ low: 2.9, high: 12, clippedLow: false, clippedHigh: true })
  })

  it('has no scale when the catalog has no range', () => {
    expect(resolveGridTimelineScale([selection(2021, { min: null, max: null })])).toBeNull()
  })
})

describe('collectTimelineValues', () => {
  it('reads each period property from its own year and skips areas without a value', () => {
    const rows: Record<number, { values: Record<string, number> }[]> = {
      2010: [{ values: { avf__avf2010: 6, avf__avf2011: 999 } }, { values: {} }],
      2011: [{ values: { avf__avf2011: 7 } }],
    }
    expect(collectTimelineValues([selection(2010), selection(2011)], (entry) => rows[entry.year])).toEqual([6, 7])
  })

  it('skips a period whose aggregate failed to load', () => {
    expect(collectTimelineValues([selection(2010)], () => null)).toEqual([])
  })
})

describe('selectionsAround', () => {
  const years = [2008, 2009, 2010, 2011, 2012, 2013].map((year) => selection(year))

  it('returns the nearest years first, on both sides', () => {
    expect(selectionsAround(years, years[2], 2).map((entry) => entry.year)).toEqual([2011, 2009, 2012, 2008])
  })

  it('stops at the ends of the timeline', () => {
    expect(selectionsAround(years, years[0], 2).map((entry) => entry.year)).toEqual([2009, 2010])
  })

  it('counts archives rather than months', () => {
    const months = [2010, 2011].flatMap((year) =>
      ['jan', 'feb', 'mar'].map((month) => selection(year, { variable: `${month}${year}`, property: month })),
    )
    expect(selectionsAround(months, months[0], 1).map((entry) => entry.year)).toEqual([2011])
  })

  it('has nothing to offer for a period off the timeline', () => {
    expect(selectionsAround(years, selection(1990), 2)).toEqual([])
  })
})

describe('boundary paint', () => {
  it('reads values from feature state, never from tile properties', () => {
    const paint = JSON.stringify(canueBoundaryPaint(resolvePeriodScale(3, 12)))
    expect(paint).toContain('feature-state')
    expect(paint).not.toContain('"get"')
  })

  it('leaves an area without a value unfilled instead of the old loading gray', () => {
    expect(JSON.stringify(canueBoundaryPaint(resolvePeriodScale(3, 12)))).not.toContain('#e5e7eb')
    expect(JSON.stringify(canueV2Paint(selection(2010)))).not.toContain('#e5e7eb')
  })

  it('has no grid paint without a selection', () => {
    expect(canueV2Paint(null)).toBe('transparent')
  })

  it('makes a grid cell without a value transparent', () => {
    const paint = canueV2Paint(selection(2010)) as unknown[]
    expect(paint[0]).toBe('case')
    expect(paint.at(-1)).toBe('transparent')
  })

  it('colours grid cells with the timeline scale when one is given', () => {
    const paint = JSON.stringify(canueV2Paint(selection(2010), resolvePeriodScale(1, 2)))
    expect(paint).toContain(',1,"#67e8f9"')
    expect(paint).toContain(',2,"#ef4444"')
  })
})

describe('canueBoundaryFeatureState', () => {
  const feature = (boundaryId: string, value: unknown) =>
    ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { boundaryId, avf: value },
    }) as GeoJSON.Feature

  it('keeps a missing value null rather than reading it as zero', () => {
    expect(canueBoundaryFeatureState([feature('a', null), feature('b', 0), feature('c', '4.5')], 'avf')).toEqual({
      a: { value: null },
      b: { value: 0 },
      c: { value: 4.5 },
    })
  })

  it('treats a value that is not a number as missing', () => {
    expect(canueBoundaryFeatureState([feature('a', 'n/a'), feature('b', '')], 'avf')).toEqual({
      a: { value: null },
      b: { value: null },
    })
  })
})

describe('canueBoundaryMetric', () => {
  const feature = (value: unknown) =>
    ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { avf: value },
    }) as GeoJSON.Feature

  it('keeps a missing value null so it is not shown as a measured zero', () => {
    expect(canueBoundaryMetric(feature(null), 'avf')).toBeNull()
    expect(canueBoundaryMetric(feature(undefined), 'avf')).toBeNull()
  })

  it('keeps a real zero', () => {
    expect(canueBoundaryMetric(feature(0), 'avf')).toBe(0)
  })
})
