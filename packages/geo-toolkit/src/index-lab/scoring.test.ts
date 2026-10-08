import { describe, expect, it } from 'vitest'
import { normalizeValues } from '../calculations/scoring.js'
import { buildMetricRanges, buildMetricValueLists, calculateIndexRows, normalizeWithMethod } from './scoring.js'

describe('catalog-independent Index Lab engine', () => {
  const metricKeys = ['heat', 'access', 'offline'] as const
  const rows = [
    { id: 'measured', values: { heat: 10, access: 1, offline: 0 }, hasSource: true },
    { id: 'unmeasured', values: { heat: 0, access: 0, offline: 0 }, hasSource: false },
  ]
  const options = {
    rows,
    metricKeys,
    getValues: (row: (typeof rows)[number]) => row.values,
    weights: { heat: -1, access: 1, offline: 1 },
    normalization: 'minMax' as const,
    missingData: 'neutral' as const,
    aggregation: 'additive' as const,
    metricRanges: buildMetricRanges(rows, metricKeys, (row) => row.values),
    metricValueLists: buildMetricValueLists(rows, metricKeys, (row) => row.values),
    hasCoverage: (row: (typeof rows)[number], key: (typeof metricKeys)[number]) => row.hasSource && key !== 'offline',
  }

  it('supports arbitrary metric keys and distinguishes measured zeroes from absent source data', () => {
    const result = calculateIndexRows(options)
    expect(result[0].normalizedMetrics).toEqual({ heat: 1, access: 1, offline: 0.5 })
    expect(result[0].score).toBe(50)
    expect(result[0].dataCoverageScore).toBe(1)
    expect(result[1].normalizedMetrics).toEqual({ heat: 0.5, access: 0.5, offline: 0.5 })
    expect(result[1].score).toBe(50)
    expect(result[1].dataCoverageScore).toBe(0)
  })

  it('lets a consumer inject a domain formula while retaining calculation and coverage output', () => {
    const result = calculateIndexRows({
      ...options,
      aggregate: ({ row, normalizedMetrics }) => (row.hasSource ? normalizedMetrics.access * 0.25 : 0),
    })
    expect(result.map((entry) => entry.score)).toEqual([25, 0])
    expect(result.map((entry) => entry.dataCoverageScore)).toEqual([1, 0])
    expect(result[0].contributions.access).toBeCloseTo(1 / 3)
  })

  it('preserves the distinct percentile semantics of the two historical engines', () => {
    // Generic scoring spans the full endpoints; Index Lab uses midpoint ranks.
    expect(normalizeValues([10, 20], { method: 'percentile' })).toEqual([0, 1])
    expect([10, 20].map((value) => normalizeWithMethod(value, [10, 20], { min: 10, max: 20 }, 'percentile'))).toEqual([
      0.25, 0.75,
    ])
  })

  it('treats omitted weights as inactive and rejects non-finite active weights', () => {
    const result = calculateIndexRows({ ...options, weights: { heat: -1 } })
    expect(result[0].dataCoverageScore).toBe(1)
    expect(result[1].dataCoverageScore).toBe(0)
    expect(result[0].contributions.access).toBe(0)
    expect(() => calculateIndexRows({ ...options, weights: { heat: Infinity } })).toThrow('must be finite')
  })
})
