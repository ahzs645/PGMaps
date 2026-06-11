import { describe, expect, it } from 'vitest'

import {
  calculatePercentageChange,
  calculateTimelinePercentageChanges,
  createTrailingYearRange,
  formatPercentChange,
  timelineAggregations,
} from './timelineChange'

describe('calculatePercentageChange', () => {
  it('computes a typical increase', () => {
    expect(calculatePercentageChange(100, 150)).toEqual({
      startValue: 100,
      endValue: 150,
      absoluteChange: 50,
      percentChange: 50,
      status: 'changed',
    })
  })

  it('computes a typical decrease', () => {
    expect(calculatePercentageChange(100, 50)).toEqual({
      startValue: 100,
      endValue: 50,
      absoluteChange: -50,
      percentChange: -50,
      status: 'changed',
    })
  })

  it('reports unchanged for equal non-zero values', () => {
    expect(calculatePercentageChange(100, 100)).toEqual({
      startValue: 100,
      endValue: 100,
      absoluteChange: 0,
      percentChange: 0,
      status: 'unchanged',
    })
  })

  it('reports unchanged with 0% for a zero-to-zero change', () => {
    expect(calculatePercentageChange(0, 0)).toEqual({
      startValue: 0,
      endValue: 0,
      absoluteChange: 0,
      percentChange: 0,
      status: 'unchanged',
    })
  })

  it('reports new with a null percent for a zero baseline by default', () => {
    expect(calculatePercentageChange(0, 5)).toEqual({
      startValue: 0,
      endValue: 5,
      absoluteChange: 5,
      percentChange: null,
      status: 'new',
    })
  })

  it('reports removed for a zero baseline going negative', () => {
    expect(calculatePercentageChange(0, -5)).toEqual({
      startValue: 0,
      endValue: -5,
      absoluteChange: -5,
      percentChange: null,
      status: 'removed',
    })
  })

  it('returns signed Infinity for a zero baseline when zeroBaseline is infinity', () => {
    expect(calculatePercentageChange(0, 5, { zeroBaseline: 'infinity' }).percentChange).toBe(Infinity)
    expect(calculatePercentageChange(0, -5, { zeroBaseline: 'infinity' }).percentChange).toBe(-Infinity)
  })

  it('uses the absolute value of a negative baseline for the percent', () => {
    expect(calculatePercentageChange(-10, -5)).toEqual({
      startValue: -10,
      endValue: -5,
      absoluteChange: 5,
      percentChange: 50,
      status: 'changed',
    })
    expect(calculatePercentageChange(-10, 10).percentChange).toBe(200)
  })

  it('reports missing when either endpoint is null or undefined', () => {
    expect(calculatePercentageChange(null, 100)).toEqual({
      startValue: null,
      endValue: 100,
      absoluteChange: null,
      percentChange: null,
      status: 'missing',
    })
    expect(calculatePercentageChange(100, undefined).status).toBe('missing')
    expect(calculatePercentageChange(null, undefined).status).toBe('missing')
  })

  it('treats NaN and Infinity endpoints as missing', () => {
    expect(calculatePercentageChange(Number.NaN, 100).status).toBe('missing')
    expect(calculatePercentageChange(100, Infinity).status).toBe('missing')
    expect(calculatePercentageChange(-Infinity, 100).startValue).toBeNull()
  })
})

describe('createTrailingYearRange', () => {
  it('builds an inclusive trailing range ending at the given year', () => {
    expect(createTrailingYearRange(2024, 5)).toEqual({ start: 2020, end: 2024 })
  })

  it('covers exactly one year for years = 1', () => {
    expect(createTrailingYearRange(2024, 1)).toEqual({ start: 2024, end: 2024 })
  })

  it('floors fractional year counts', () => {
    expect(createTrailingYearRange(2024, 2.9)).toEqual({ start: 2023, end: 2024 })
  })

  it('clamps zero or negative year counts to a single year', () => {
    expect(createTrailingYearRange(2024, 0)).toEqual({ start: 2024, end: 2024 })
    expect(createTrailingYearRange(2024, -3)).toEqual({ start: 2024, end: 2024 })
    expect(createTrailingYearRange(2024, 0.5)).toEqual({ start: 2024, end: 2024 })
  })
})

describe('timelineAggregations', () => {
  it('sums values (0 for an empty list)', () => {
    expect(timelineAggregations.sum([1, 2, 3])).toBe(6)
    expect(timelineAggregations.sum([])).toBe(0)
    expect(timelineAggregations.sum([-1, 1])).toBe(0)
  })

  it('averages values (0 for an empty list)', () => {
    expect(timelineAggregations.average([2, 4])).toBe(3)
    expect(timelineAggregations.average([5])).toBe(5)
    expect(timelineAggregations.average([])).toBe(0)
  })

  it('takes the minimum (Infinity for an empty list — current Math.min behavior)', () => {
    expect(timelineAggregations.min([3, 1, 2])).toBe(1)
    expect(timelineAggregations.min([])).toBe(Infinity)
  })

  it('takes the maximum (-Infinity for an empty list — current Math.max behavior)', () => {
    expect(timelineAggregations.max([3, 1, 2])).toBe(3)
    expect(timelineAggregations.max([])).toBe(-Infinity)
  })
})

describe('calculateTimelinePercentageChanges', () => {
  interface Row {
    unit: string | null
    year: number | null
    count: number | null | undefined
  }

  const baseOptions = {
    unit: (row: Row) => row.unit,
    time: (row: Row) => row.year,
    value: (row: Row) => row.count,
  }

  const rows: Row[] = [
    { unit: 'a', year: 2020, count: 10 },
    { unit: 'a', year: 2020, count: 5 }, // same unit+time -> summed with the row above
    { unit: 'a', year: 2022, count: 30 },
    { unit: 'b', year: 2020, count: 0 },
    { unit: 'b', year: 2022, count: 4 },
  ]

  it('groups by unit, sums values per time by default, and measures first-to-last change', () => {
    const changes = calculateTimelinePercentageChanges(rows, baseOptions)
    expect(changes).toHaveLength(2)

    const [a, b] = changes
    expect(a.unit).toBe('a')
    expect(a.points).toEqual([
      { time: 2020, value: 15 },
      { time: 2022, value: 30 },
    ])
    expect(a.startTime).toBe(2020)
    expect(a.endTime).toBe(2022)
    expect(a.startValue).toBe(15)
    expect(a.endValue).toBe(30)
    expect(a.absoluteChange).toBe(15)
    expect(a.percentChange).toBe(100)
    expect(a.status).toBe('changed')

    expect(b.unit).toBe('b')
    expect(b.status).toBe('new') // 0 -> 4
    expect(b.percentChange).toBeNull()
  })

  it('passes percentage-change options through (zeroBaseline)', () => {
    const changes = calculateTimelinePercentageChanges(rows, { ...baseOptions, zeroBaseline: 'infinity' })
    const b = changes.find((change) => change.unit === 'b')
    expect(b?.percentChange).toBe(Infinity)
  })

  it('applies the inclusive time range filter', () => {
    const changes = calculateTimelinePercentageChanges(rows, {
      ...baseOptions,
      range: { start: 2021, end: 2022 },
    })
    const a = changes.find((change) => change.unit === 'a')
    expect(a?.points).toEqual([{ time: 2022, value: 30 }])
    // single point: start and end are the same -> unchanged with 0%
    expect(a?.startTime).toBe(2022)
    expect(a?.endTime).toBe(2022)
    expect(a?.percentChange).toBe(0)
    expect(a?.status).toBe('unchanged')
  })

  it('includes records exactly on the range boundaries', () => {
    const changes = calculateTimelinePercentageChanges(rows, {
      ...baseOptions,
      range: { start: 2020, end: 2022 },
    })
    const a = changes.find((change) => change.unit === 'a')
    expect(a?.points).toHaveLength(2)
  })

  it('skips records with null units, null times, or non-finite values', () => {
    const dirty: Row[] = [
      { unit: null, year: 2020, count: 1 },
      { unit: 'a', year: null, count: 1 },
      { unit: 'a', year: 2020, count: null },
      { unit: 'a', year: 2020, count: undefined },
      { unit: 'a', year: 2020, count: Number.NaN },
      { unit: 'b', year: 2020, count: 2 },
    ]
    const changes = calculateTimelinePercentageChanges(dirty, baseOptions)
    // unit 'a' has no valid rows at all -> absent; only 'b' remains
    expect(changes.map((change) => change.unit)).toEqual(['b'])
    expect(changes[0].points).toEqual([{ time: 2020, value: 2 }])
  })

  it('supports a custom aggregate function', () => {
    const changes = calculateTimelinePercentageChanges(rows, {
      ...baseOptions,
      aggregate: timelineAggregations.average,
    })
    const a = changes.find((change) => change.unit === 'a')
    expect(a?.points).toEqual([
      { time: 2020, value: 7.5 }, // average of 10 and 5
      { time: 2022, value: 30 },
    ])
    expect(a?.percentChange).toBe(300)
  })

  it('sorts string time keys numerically, not lexicographically', () => {
    const stringRows = [
      { unit: 'u', time: '10', value: 1 },
      { unit: 'u', time: '2', value: 5 },
    ]
    const changes = calculateTimelinePercentageChanges(stringRows, {
      unit: (row) => row.unit,
      time: (row) => row.time,
      value: (row) => row.value,
    })
    expect(changes[0].points.map((point) => point.time)).toEqual(['2', '10'])
    expect(changes[0].startValue).toBe(5)
    expect(changes[0].endValue).toBe(1)
    expect(changes[0].percentChange).toBe(-80)
  })

  it('sorts units numerically-aware as well', () => {
    const unitRows = [
      { unit: 'item10', time: 1, value: 1 },
      { unit: 'item2', time: 1, value: 1 },
    ]
    const changes = calculateTimelinePercentageChanges(unitRows, {
      unit: (row) => row.unit,
      time: (row) => row.time,
      value: (row) => row.value,
    })
    expect(changes.map((change) => change.unit)).toEqual(['item2', 'item10'])
  })

  it('returns an empty array for no records', () => {
    expect(calculateTimelinePercentageChanges([], baseOptions)).toEqual([])
  })
})

describe('formatPercentChange', () => {
  it('formats positive values with a leading plus', () => {
    expect(formatPercentChange(12.34)).toBe('+12.3%')
  })

  it('formats negative values with a leading minus', () => {
    expect(formatPercentChange(-5)).toBe('-5.0%')
  })

  it('formats zero without a sign', () => {
    expect(formatPercentChange(0)).toBe('0.0%')
  })

  it('respects the digits parameter', () => {
    expect(formatPercentChange(12.346, 2)).toBe('+12.35%')
    expect(formatPercentChange(12.6, 0)).toBe('+13%')
  })

  it('returns n/a for null', () => {
    expect(formatPercentChange(null)).toBe('n/a')
  })

  it('formats signed infinities', () => {
    expect(formatPercentChange(Infinity)).toBe('+∞%')
    expect(formatPercentChange(-Infinity)).toBe('-∞%')
  })

  it('treats negative zero as unsigned (current behavior)', () => {
    expect(formatPercentChange(-0)).toBe('0.0%')
  })
})
