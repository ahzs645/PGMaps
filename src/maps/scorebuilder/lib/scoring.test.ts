import { describe, expect, it } from 'vitest'
import { rankStability } from './scoreSummaries'
import {
  calculateIndexRows,
  normalizeWithMethod as toolkitNormalizeWithMethod,
} from '@pgmaps/geo-toolkit/index-lab/scoring'
import { SCORE_METRICS, SCORE_PALETTE_PROFILES } from '../constants'
import { createInitialScoreBuilderState } from '../hooks/scoreBuilderReducer'
import type { ScoreMetricWeightMap } from '../types'
import { metricHasCoverage } from './metrics'
import {
  buildMetricRanges,
  buildMetricValueLists,
  clampScore,
  normalizeMetric,
  normalizeWithMethod,
  scoreRegionRows,
  type RegionMetricRow,
} from './scoring'

describe('normalizeMetric', () => {
  it('scales linearly within the range', () => {
    expect(normalizeMetric(5, 0, 10)).toBe(0.5)
    expect(normalizeMetric(0, 0, 10)).toBe(0)
    expect(normalizeMetric(10, 0, 10)).toBe(1)
  })

  it('clamps values outside the range', () => {
    expect(normalizeMetric(-5, 0, 10)).toBe(0)
    expect(normalizeMetric(15, 0, 10)).toBe(1)
  })

  it('returns neutral 0.5 for degenerate ranges', () => {
    expect(normalizeMetric(3, 5, 5)).toBe(0.5)
    expect(normalizeMetric(3, 10, 0)).toBe(0.5)
    expect(normalizeMetric(3, Number.NaN, 10)).toBe(0.5)
  })

  it('returns 0 for non-finite values', () => {
    expect(normalizeMetric(Number.NaN, 0, 10)).toBe(0)
    expect(normalizeMetric(Number.POSITIVE_INFINITY, 0, 10)).toBe(0)
  })
})

describe('normalizeWithMethod', () => {
  const values = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
  const range = { min: 0, max: 100 }

  it('minMax matches plain normalization', () => {
    expect(normalizeWithMethod(25, values, range, 'minMax')).toBe(0.25)
  })

  it('percentile ranks values within the distribution', () => {
    // 50 has five values below it and counts half of its own tie.
    expect(normalizeWithMethod(50, values, range, 'percentile')).toBeCloseTo(5.5 / 11)
    expect(normalizeWithMethod(200, values, range, 'percentile')).toBe(1)
    expect(normalizeWithMethod(-10, values, range, 'percentile')).toBe(0)
  })

  it('winsorizedMinMax clips outliers to the 5th/95th percentile window', () => {
    const skewed = [...Array.from({ length: 20 }, (_, index) => index), 1000]
    const skewedRange = { min: 0, max: 1000 }
    const result = normalizeWithMethod(1000, skewed, skewedRange, 'winsorizedMinMax')
    expect(result).toBe(1)
    // A mid value should not be crushed toward zero by the 1000 outlier.
    expect(normalizeWithMethod(10, skewed, skewedRange, 'winsorizedMinMax')).toBeGreaterThan(0.4)
  })

  it('winsorizedMinMax falls back to minMax for tiny samples', () => {
    expect(normalizeWithMethod(5, [0, 10], { min: 0, max: 10 }, 'winsorizedMinMax')).toBe(0.5)
  })

  it('zScore centers the mean at 0.5 and clamps to [0, 1]', () => {
    expect(normalizeWithMethod(50, values, range, 'zScore')).toBeCloseTo(0.5)
    expect(normalizeWithMethod(100000, values, range, 'zScore')).toBe(1)
    expect(normalizeWithMethod(-100000, values, range, 'zScore')).toBe(0)
  })

  it('returns neutral 0.5 when the distribution has no spread', () => {
    expect(normalizeWithMethod(5, [5, 5, 5, 5], { min: 5, max: 5 }, 'zScore')).toBe(0.5)
  })

  it('returns 0 for non-finite values regardless of method', () => {
    expect(normalizeWithMethod(Number.NaN, values, range, 'percentile')).toBe(0)
  })
})

describe('clampScore', () => {
  it('keeps scores inside 0-100', () => {
    expect(clampScore(-3)).toBe(0)
    expect(clampScore(42)).toBe(42)
    expect(clampScore(140)).toBe(100)
  })
})

describe('rankStability', () => {
  it('scales with how many regions are ranked', () => {
    expect(rankStability(2, 20)).toBe('stable')
    expect(rankStability(6, 20)).toBe('moderate')
    expect(rankStability(7, 20)).toBe('sensitive')
    expect(rankStability(6, 135)).toBe('stable')
    expect(rankStability(20, 135)).toBe('moderate')
    expect(rankStability(21, 135)).toBe('sensitive')
  })
})

describe('normalizeWithMethod', () => {
  const values = [0, 0, 0, 1, 2, 2, 3.5, 7, 7, 7, 40].sort((a, b) => a - b)
  const range = { min: 0, max: 40 }

  it('matches the toolkit for every method, including ties and values outside the list', () => {
    for (const method of ['percentile', 'zScore', 'minMax', 'winsorizedMinMax'] as const) {
      for (const value of [-5, 0, 0.5, 1, 2, 3, 7, 39, 40, 100, Number.NaN]) {
        expect(normalizeWithMethod(value, values, range, method)).toBe(
          toolkitNormalizeWithMethod(value, values, range, method),
        )
      }
    }
  })

  it('matches the toolkit on an empty list', () => {
    expect(normalizeWithMethod(1, [], range, 'percentile')).toBe(toolkitNormalizeWithMethod(1, [], range, 'percentile'))
  })
})

describe('scoreRegionRows with prepared normalization', () => {
  // The prepared route must land exactly where normalizing inside the toolkit does.
  const baseSettings = createInitialScoreBuilderState(new URLSearchParams()).methodSettings
  const metrics = SCORE_METRICS.slice(0, 6)
  const rows = Array.from({ length: 40 }, (_, index) => ({
    region: { id: `r${index}`, name: `Region ${index}`, source: 'census', level: 'da', code: `${index}`, areaKm2: 1 },
    metrics: Object.fromEntries(metrics.map((metric, column) => [metric.key, Math.sin(index * (column + 2)) * 10])),
    counts: { monitorCount: 1, parkCount: 1, trailCount: 1, amenityCount: 1, populationSum: 1 },
  })) as unknown as RegionMetricRow[]
  const weights = Object.fromEntries(
    metrics.map((metric, column) => [metric.key, column % 2 ? -10 : 20]),
  ) as ScoreMetricWeightMap
  const ranges = buildMetricRanges(rows, metrics)
  const lists = buildMetricValueLists(rows, metrics)

  it.each(['percentile', 'zScore'] as const)('gives the same %s scores as normalizing inside the toolkit', (method) => {
    const scored = scoreRegionRows({
      rows,
      weights,
      settings: { ...baseSettings, normalization: method },
      metricRanges: ranges,
      metricValueLists: lists,
      paletteProfile: SCORE_PALETTE_PROFILES.default,
      metrics,
    })
    const direct = calculateIndexRows({
      rows,
      weights,
      metricKeys: metrics.map((metric) => metric.key),
      getValues: (row) => row.metrics,
      normalization: method,
      missingData: 'zero',
      aggregation: 'additive',
      metricRanges: ranges,
      metricValueLists: lists,
      hasCoverage: (row, key) => metricHasCoverage(key, row.counts),
    })
    const byId = new Map(scored.map((entry) => [entry.region.id, entry.score]))
    direct.forEach((entry) => expect(byId.get(entry.row.region.id)).toBeCloseTo(entry.score, 9))
  })
})
