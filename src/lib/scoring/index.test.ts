import { describe, expect, it } from 'vitest'

import {
  calculateCoverage,
  extractDrivers,
  normalizeValues,
  runSensitivityTrials,
  scoreRecords,
} from './index'
import type {
  MetricScore,
  NormalizationOptions,
  ScoreMetricConfig,
  ScoreOptions,
  ScoreRecord,
  ScoreResult,
  ScoreValue,
} from './index'

/** minMax with fixed bounds [0, 1] acts as an identity normalization for values in [0, 1]. */
const identityNormalization: NormalizationOptions = { method: 'minMax', min: 0, max: 1 }

function metric(key: string, weight: number, extra: Partial<ScoreMetricConfig> = {}): ScoreMetricConfig {
  return { key, weight, normalization: identityNormalization, ...extra }
}

function rec(id: string, values: Record<string, ScoreValue>): ScoreRecord {
  return { id, values }
}

function metricByKey(result: ScoreResult, key: string): MetricScore {
  const found = result.metrics.find((entry) => entry.key === key)
  if (!found) throw new Error(`metric ${key} not found`)
  return found
}

describe('normalizeValues: minMax', () => {
  it('maps values linearly between the observed min and max', () => {
    expect(normalizeValues([0, 5, 10], { method: 'minMax' })).toEqual([0, 0.5, 1])
  })

  it('handles negative values', () => {
    expect(normalizeValues([-10, 0, 10], { method: 'minMax' })).toEqual([0, 0.5, 1])
  })

  it('respects explicit min/max bounds and clamps values outside them', () => {
    expect(normalizeValues([-5, 0, 5, 10, 20], { method: 'minMax', min: 0, max: 10 })).toEqual([0, 0, 0.5, 1, 1])
  })

  it('returns an empty array for empty input', () => {
    expect(normalizeValues([], { method: 'minMax' })).toEqual([])
  })

  it('returns 0.5 for a single finite value (zero range)', () => {
    expect(normalizeValues([5], { method: 'minMax' })).toEqual([0.5])
  })

  it('returns 0.5 for all-identical values (zero range)', () => {
    expect(normalizeValues([3, 3, 3], { method: 'minMax' })).toEqual([0.5, 0.5, 0.5])
  })

  it('returns null for NaN, Infinity, null and undefined inputs', () => {
    expect(normalizeValues([Number.NaN, Infinity, -Infinity, null, undefined], { method: 'minMax' })).toEqual([
      null,
      null,
      null,
      null,
      null,
    ])
  })

  it('excludes non-finite values from min/max computation', () => {
    expect(normalizeValues([0, Infinity, 10, null], { method: 'minMax' })).toEqual([0, null, 1, null])
  })

  it('returns 0.5 for the only finite value among nulls', () => {
    expect(normalizeValues([5, null, undefined], { method: 'minMax' })).toEqual([0.5, null, null])
  })

  it('returns 0.5 when explicit min equals explicit max', () => {
    expect(normalizeValues([1, 2, 3], { method: 'minMax', min: 2, max: 2 })).toEqual([0.5, 0.5, 0.5])
  })
})

describe('normalizeValues: percentile', () => {
  it('spreads distinct values evenly from 0 to 1 using (below + (equal-1)/2) / (n-1)', () => {
    expect(normalizeValues([10, 20, 30, 40], { method: 'percentile' })).toEqual([0, 1 / 3, 2 / 3, 1])
  })

  it('handles unsorted input by ranking against the sorted finite values', () => {
    expect(normalizeValues([30, 10, 20], { method: 'percentile' })).toEqual([1, 0, 0.5])
  })

  it('averages ranks for ties: [10, 20, 20, 30] -> tied 20s share (1 + 0.5) / 3', () => {
    const result = normalizeValues([10, 20, 20, 30], { method: 'percentile' })
    expect(result[0]).toBe(0)
    expect(result[1]).toBe(0.5) // below=1, equal=2 -> (1 + 0.5) / 3
    expect(result[2]).toBe(0.5)
    expect(result[3]).toBe(1) // below=3, equal=1 -> 3 / 3
  })

  it('keeps a fully tied top group below 1.0 (current behavior of the tie formula)', () => {
    // [1, 2, 2]: value 2 has below=1, equal=2 -> (1 + 0.5) / 2 = 0.75, never reaching 1.
    expect(normalizeValues([1, 2, 2], { method: 'percentile' })).toEqual([0, 0.75, 0.75])
  })

  it('returns 0.5 for all-identical values', () => {
    // below=0, equal=3 -> (0 + 1) / 2 = 0.5
    expect(normalizeValues([5, 5, 5], { method: 'percentile' })).toEqual([0.5, 0.5, 0.5])
  })

  it('returns 0.5 for a single finite value', () => {
    expect(normalizeValues([42], { method: 'percentile' })).toEqual([0.5])
  })

  it('maps two distinct values to 0 and 1', () => {
    expect(normalizeValues([1, 2], { method: 'percentile' })).toEqual([0, 1])
  })

  it('returns an empty array for empty input', () => {
    expect(normalizeValues([], { method: 'percentile' })).toEqual([])
  })

  it('returns null for non-finite values and excludes them from ranking', () => {
    expect(normalizeValues([10, Number.NaN, 20, null, Infinity], { method: 'percentile' })).toEqual([
      0,
      null,
      1,
      null,
      null,
    ])
  })

  it('returns all nulls when no values are finite', () => {
    expect(normalizeValues([null, undefined, Number.NaN], { method: 'percentile' })).toEqual([null, null, null])
  })
})

describe('normalizeValues: zScore', () => {
  it('maps the mean to 0.5 and +/- spread standard deviations to 1/0', () => {
    const options: NormalizationOptions = { method: 'zScore', mean: 10, standardDeviation: 2 }
    // default spread = 3
    expect(normalizeValues([10], options)).toEqual([0.5])
    expect(normalizeValues([16], options)).toEqual([1]) // mean + 3 sd
    expect(normalizeValues([4], options)).toEqual([0]) // mean - 3 sd
    expect(normalizeValues([12], options)[0]).toBeCloseTo(0.5 + 1 / 6, 12) // mean + 1 sd
  })

  it('clamps values beyond the spread to [0, 1]', () => {
    const options: NormalizationOptions = { method: 'zScore', mean: 0, standardDeviation: 1 }
    expect(normalizeValues([100], options)).toEqual([1])
    expect(normalizeValues([-100], options)).toEqual([0])
  })

  it('respects a custom spread', () => {
    const options: NormalizationOptions = { method: 'zScore', mean: 0, standardDeviation: 1, spread: 1 }
    expect(normalizeValues([1], options)).toEqual([1]) // mean + 1 sd with spread 1
    expect(normalizeValues([0.5], options)[0]).toBeCloseTo(0.75, 12)
  })

  it('computes mean and sample standard deviation from the data when not provided', () => {
    // [1, 3]: mean = 2, sample sd = sqrt(((1-2)^2 + (3-2)^2) / 1) = sqrt(2)
    const result = normalizeValues([1, 3], { method: 'zScore' })
    expect(result[0]).toBeCloseTo(0.5 - 1 / Math.sqrt(2) / 6, 12)
    expect(result[1]).toBeCloseTo(0.5 + 1 / Math.sqrt(2) / 6, 12)
  })

  it('returns 0.5 when the standard deviation is zero (identical values)', () => {
    expect(normalizeValues([7, 7, 7], { method: 'zScore' })).toEqual([0.5, 0.5, 0.5])
  })

  it('returns 0.5 for a single value (sample sd of < 2 values is 0)', () => {
    expect(normalizeValues([7], { method: 'zScore' })).toEqual([0.5])
  })

  it('returns 0.5 when an explicit standard deviation of 0 is provided', () => {
    expect(normalizeValues([1, 2], { method: 'zScore', mean: 0, standardDeviation: 0 })).toEqual([0.5, 0.5])
  })

  it('returns null for non-finite values and excludes them from the statistics', () => {
    expect(normalizeValues([Number.NaN, null, undefined, Infinity], { method: 'zScore' })).toEqual([
      null,
      null,
      null,
      null,
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(normalizeValues([], { method: 'zScore' })).toEqual([])
  })
})

describe('normalizeValues: threshold', () => {
  it('is binary with the default margin of 0 (passing at or above the threshold)', () => {
    const options: NormalizationOptions = { method: 'threshold', threshold: 10 }
    expect(normalizeValues([9.999, 10, 10.001], options)).toEqual([0, 1, 1])
  })

  it('supports passDirection below (passing at or below the threshold)', () => {
    const options: NormalizationOptions = { method: 'threshold', threshold: 10, passDirection: 'below' }
    expect(normalizeValues([9, 10, 11], options)).toEqual([1, 1, 0])
  })

  it('ramps linearly across the margin around the threshold', () => {
    const options: NormalizationOptions = { method: 'threshold', threshold: 10, margin: 2 }
    expect(normalizeValues([8, 9, 10, 11, 12], options)).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('clamps the ramp outside threshold +/- margin', () => {
    const options: NormalizationOptions = { method: 'threshold', threshold: 10, margin: 2 }
    expect(normalizeValues([0, 100], options)).toEqual([0, 1])
  })

  it('ramps in the opposite direction for passDirection below', () => {
    const options: NormalizationOptions = { method: 'threshold', threshold: 10, passDirection: 'below', margin: 2 }
    expect(normalizeValues([8, 9, 10, 11, 12], options)).toEqual([1, 0.75, 0.5, 0.25, 0])
  })

  it('treats a negative margin like a margin of 0 (binary)', () => {
    const options: NormalizationOptions = { method: 'threshold', threshold: 10, margin: -5 }
    expect(normalizeValues([9, 11], options)).toEqual([0, 1])
  })

  it('returns null for non-finite values', () => {
    const options: NormalizationOptions = { method: 'threshold', threshold: 0 }
    expect(normalizeValues([null, undefined, Number.NaN, Infinity], options)).toEqual([null, null, null, null])
  })
})

describe('normalizeValues: direction', () => {
  it('inverts scores for lowerIsBetter', () => {
    expect(normalizeValues([0, 5, 10], { method: 'minMax' }, 'lowerIsBetter')).toEqual([1, 0.5, 0])
  })

  it('keeps nulls null when inverting', () => {
    expect(normalizeValues([0, null, 10], { method: 'minMax' }, 'lowerIsBetter')).toEqual([1, null, 0])
  })

  it('inverts percentile scores for lowerIsBetter', () => {
    expect(normalizeValues([10, 20, 30], { method: 'percentile' }, 'lowerIsBetter')).toEqual([1, 0.5, 0])
  })

  it('defaults to higherIsBetter', () => {
    expect(normalizeValues([0, 10], { method: 'minMax' })).toEqual([0, 1])
  })
})

describe('calculateCoverage', () => {
  it('reports full coverage (1) for an empty metric list', () => {
    expect(calculateCoverage([])).toEqual({
      presentMetrics: 0,
      totalMetrics: 0,
      presentWeight: 0,
      totalWeight: 0,
      metricCoverage: 1,
      weightCoverage: 1,
    })
  })

  it('computes metric and weight coverage for mixed present/missing metrics', () => {
    const coverage = calculateCoverage([
      { missing: false, weight: 2 },
      { missing: true, weight: 1 },
    ])
    expect(coverage.presentMetrics).toBe(1)
    expect(coverage.totalMetrics).toBe(2)
    expect(coverage.presentWeight).toBe(2)
    expect(coverage.totalWeight).toBe(3)
    expect(coverage.metricCoverage).toBe(0.5)
    expect(coverage.weightCoverage).toBeCloseTo(2 / 3, 12)
  })

  it('treats negative and non-finite weights as zero', () => {
    const coverage = calculateCoverage([
      { missing: false, weight: -5 },
      { missing: false, weight: Number.NaN },
      { missing: false, weight: Infinity },
    ])
    expect(coverage.totalWeight).toBe(0)
    expect(coverage.presentWeight).toBe(0)
    expect(coverage.weightCoverage).toBe(1) // zero total weight falls back to 1
    expect(coverage.metricCoverage).toBe(1)
  })

  it('reports zero coverage when every metric is missing', () => {
    const coverage = calculateCoverage([
      { missing: true, weight: 1 },
      { missing: true, weight: 1 },
    ])
    expect(coverage.metricCoverage).toBe(0)
    expect(coverage.weightCoverage).toBe(0)
  })
})

describe('scoreRecords: additive aggregation', () => {
  const additive: ScoreOptions = {
    metrics: [metric('a', 3), metric('b', 1)],
    aggregation: { method: 'additive' },
  }

  it('computes the weighted average of normalized values', () => {
    const [result] = scoreRecords([rec('r1', { a: 1, b: 0.5 })], additive)
    expect(result.score).toBeCloseTo(0.875, 12) // (3/4) * 1 + (1/4) * 0.5
    expect(metricByKey(result, 'a').contribution).toBeCloseTo(0.75, 12)
    expect(metricByKey(result, 'b').contribution).toBeCloseTo(0.125, 12)
  })

  it('renormalizes weights over present metrics when a value is missing', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'additive' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.8, b: null })], options)
    expect(result.score).toBeCloseTo(0.8, 12) // b drops out entirely
    expect(metricByKey(result, 'b').contribution).toBe(0)
    expect(metricByKey(result, 'b').missing).toBe(true)
    expect(metricByKey(result, 'b').normalizedValue).toBeNull()
    expect(result.coverage.presentMetrics).toBe(1)
    expect(result.coverage.weightCoverage).toBe(0.5)
  })

  it('substitutes missingValue (in normalized space) and keeps the weight in play', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1, { missingValue: 0.5 })],
      aggregation: { method: 'additive' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.8 })], options)
    expect(result.score).toBeCloseTo(0.65, 12) // (0.8 + 0.5) / 2
    expect(metricByKey(result, 'b').effectiveValue).toBe(0.5)
    expect(metricByKey(result, 'b').missing).toBe(true) // still flagged missing for coverage
    expect(result.coverage.presentMetrics).toBe(1)
  })

  it('ignores zero-weight metrics', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 0), metric('b', 1)],
      aggregation: { method: 'additive' },
    }
    const [result] = scoreRecords([rec('r1', { a: 1, b: 0.25 })], options)
    expect(result.score).toBeCloseTo(0.25, 12)
    expect(metricByKey(result, 'a').contribution).toBe(0)
  })

  it('treats negative and non-finite weights as zero', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', -2), metric('b', Infinity), metric('c', 1)],
      aggregation: { method: 'additive' },
    }
    const [result] = scoreRecords([rec('r1', { a: 1, b: 1, c: 0.4 })], options)
    expect(result.score).toBeCloseTo(0.4, 12)
    expect(metricByKey(result, 'a').contribution).toBe(0)
    expect(metricByKey(result, 'b').contribution).toBe(0)
  })

  it('scores 0 with zero contributions when all weights are zero', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 0), metric('b', 0)],
      aggregation: { method: 'additive' },
    }
    const [result] = scoreRecords([rec('r1', { a: 1, b: 1 })], options)
    expect(result.score).toBe(0)
    expect(result.metrics.every((entry) => entry.contribution === 0)).toBe(true)
  })

  it('scores 0 when every metric value is missing', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'additive' },
    }
    const [result] = scoreRecords([rec('r1', {})], options)
    expect(result.score).toBe(0)
    expect(result.coverage.presentMetrics).toBe(0)
    expect(result.coverage.metricCoverage).toBe(0)
  })

  it('uses the normalized value directly for a single metric', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 7)],
      aggregation: { method: 'additive' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.3 })], options)
    expect(result.score).toBeCloseTo(0.3, 12)
  })

  it('clamps the score to 1 but leaves per-metric contributions unclamped (current behavior)', () => {
    // missingValue is applied after normalization and is not validated to [0, 1]:
    // a missingValue of 2 produces a contribution of 2 while the score is clamped to 1.
    const options: ScoreOptions = {
      metrics: [metric('a', 1, { missingValue: 2 })],
      aggregation: { method: 'additive' },
    }
    const [result] = scoreRecords([rec('r1', {})], options)
    expect(result.score).toBe(1)
    expect(metricByKey(result, 'a').contribution).toBe(2)
  })

  it('treats NaN raw values as missing', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'additive' },
    }
    const [result] = scoreRecords([rec('r1', { a: Number.NaN, b: 0.6 })], options)
    expect(metricByKey(result, 'a').missing).toBe(true)
    expect(result.score).toBeCloseTo(0.6, 12)
  })
})

describe('scoreRecords: ranking', () => {
  it('ranks records by descending score and breaks ties by ascending id', () => {
    const options: ScoreOptions = {
      metrics: [metric('x', 1)],
      aggregation: { method: 'additive' },
    }
    const results = scoreRecords([rec('c', { x: 0.5 }), rec('a', { x: 1 }), rec('b', { x: 0.5 })], options)
    expect(results.map((result) => result.record.id)).toEqual(['a', 'b', 'c'])
    expect(results.map((result) => result.rank)).toEqual([1, 2, 3])
  })

  it('assigns distinct sequential ranks even for tied scores (no shared ranks)', () => {
    const options: ScoreOptions = {
      metrics: [metric('x', 1)],
      aggregation: { method: 'additive' },
    }
    const results = scoreRecords([rec('b', { x: 0.5 }), rec('a', { x: 0.5 })], options)
    expect(results[0].record.id).toBe('a')
    expect(results[0].rank).toBe(1)
    expect(results[1].record.id).toBe('b')
    expect(results[1].rank).toBe(2)
    expect(results[0].score).toBe(results[1].score)
  })

  it('returns an empty array for no records', () => {
    const options: ScoreOptions = {
      metrics: [metric('x', 1)],
      aggregation: { method: 'additive' },
    }
    expect(scoreRecords([], options)).toEqual([])
  })

  it('handles an empty metric list (score 0, full coverage)', () => {
    const options: ScoreOptions = { metrics: [], aggregation: { method: 'additive' } }
    const [result] = scoreRecords([rec('r1', {})], options)
    expect(result.score).toBe(0)
    expect(result.rank).toBe(1)
    expect(result.metrics).toEqual([])
    expect(result.coverage.metricCoverage).toBe(1)
    expect(result.coverage.weightCoverage).toBe(1)
  })

  it('normalizes across records (percentile) and respects lowerIsBetter direction', () => {
    const options: ScoreOptions = {
      metrics: [{ key: 'x', weight: 1, direction: 'lowerIsBetter', normalization: { method: 'percentile' } }],
      aggregation: { method: 'additive' },
    }
    const results = scoreRecords([rec('high', { x: 30 }), rec('mid', { x: 20 }), rec('low', { x: 10 })], options)
    expect(results[0].record.id).toBe('low') // lowest raw value wins
    expect(results[0].score).toBe(1)
    expect(results[2].record.id).toBe('high')
    expect(results[2].score).toBe(0)
  })
})

describe('scoreRecords: geometric aggregation', () => {
  it('computes the weighted geometric mean', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'geometric' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.25, b: 1 })], options)
    expect(result.score).toBeCloseTo(0.5, 7) // sqrt(0.25 * 1)
  })

  it('weights the geometric mean by metric weight', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 3), metric('b', 1)],
      aggregation: { method: 'geometric' },
    }
    const [result] = scoreRecords([rec('r1', { a: 1, b: 0.0625 })], options)
    // exp((3/4) ln 1 + (1/4) ln 0.0625) = 0.0625^(1/4) = 0.5
    expect(result.score).toBeCloseTo(0.5, 7)
  })

  it('distributes contributions as score * weight share', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'geometric' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.25, b: 1 })], options)
    expect(metricByKey(result, 'a').contribution).toBeCloseTo(0.25, 7)
    expect(metricByKey(result, 'b').contribution).toBeCloseTo(0.25, 7)
  })

  it('floors zero values at epsilon under the default clamp handling', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'geometric' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0, b: 1 })], options)
    expect(result.score).toBeCloseTo(Math.sqrt(1e-6), 7) // sqrt(epsilon * 1) = 0.001
  })

  it('respects a custom epsilon', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'geometric', epsilon: 0.01 },
    }
    const [result] = scoreRecords([rec('r1', { a: 0, b: 1 })], options)
    expect(result.score).toBeCloseTo(0.1, 7) // sqrt(0.01 * 1)
  })

  it('clamps effective values above 1 under clamp handling', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1, { missingValue: 2 }), metric('b', 1)],
      aggregation: { method: 'geometric' },
    }
    const [result] = scoreRecords([rec('r1', { b: 0.25 })], options)
    expect(result.score).toBeCloseTo(0.5, 7) // sqrt(clamp01(2) * 0.25)
  })

  it('shifts all values by |min| + epsilon under offset handling when a value is negative', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1, { missingValue: -0.5 })],
      aggregation: { method: 'geometric', nonNegativeHandling: 'offset' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.5 })], options)
    // offset = 0.5 + 1e-6; a -> ~1.000001, b -> ~1e-6
    expect(result.score).toBeCloseTo(Math.sqrt(1.000001e-6), 6)
  })

  it('does not clamp values above 1 under offset handling', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1, { missingValue: 4 })],
      aggregation: { method: 'geometric', nonNegativeHandling: 'offset' },
    }
    const [result] = scoreRecords([rec('r1', {})], options)
    expect(result.score).toBe(1) // exp(ln 4) = 4, clamped to 1 only at the end
  })

  it('drops negative values under skip handling and renormalizes the rest', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1, { missingValue: -0.5 })],
      aggregation: { method: 'geometric', nonNegativeHandling: 'skip' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.8 })], options)
    expect(result.score).toBeCloseTo(0.8, 7)
    expect(metricByKey(result, 'b').contribution).toBe(0)
  })

  it('still floors a zero value at epsilon under skip handling (only strictly negative values are skipped)', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'geometric', nonNegativeHandling: 'skip' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0, b: 1 })], options)
    expect(result.score).toBeCloseTo(Math.sqrt(1e-6), 7)
  })

  it('excludes missing metrics and zero-weight metrics from the product', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 0), metric('c', 1)],
      aggregation: { method: 'geometric' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.5, b: 0.001, c: null })], options)
    expect(result.score).toBeCloseTo(0.5, 7) // only a participates
    expect(metricByKey(result, 'b').contribution).toBe(0)
    expect(metricByKey(result, 'c').contribution).toBe(0)
  })

  it('scores 0 when no metric participates', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1)],
      aggregation: { method: 'geometric' },
    }
    const [result] = scoreRecords([rec('r1', {})], options)
    expect(result.score).toBe(0)
  })

  it('scores 0 when all weights are zero', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 0)],
      aggregation: { method: 'geometric' },
    }
    const [result] = scoreRecords([rec('r1', { a: 1 })], options)
    expect(result.score).toBe(0)
  })
})

describe('scoreRecords: multiplicativePenalty aggregation', () => {
  it('matches the additive score when no metric falls below the penalty threshold', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'multiplicativePenalty' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.6, b: 0.8 })], options)
    expect(result.score).toBeCloseTo(0.7, 12)
  })

  it('applies the default penalty (threshold 0.5, strength 0.5) for metrics below threshold', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'multiplicativePenalty' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.25, b: 0.75 })], options)
    // base = 0.5; shortfall = (0.5 - 0.25)/0.5 = 0.5; factor = 1 - 0.25 = 0.75
    expect(result.score).toBeCloseTo(0.375, 12)
    expect(metricByKey(result, 'a').contribution).toBeCloseTo(0.09375, 12) // 0.125 * 0.75
    expect(metricByKey(result, 'b').contribution).toBeCloseTo(0.28125, 12) // 0.375 * 0.75
  })

  it('compounds penalties across multiple failing metrics', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'multiplicativePenalty' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.25, b: 0.25 })], options)
    // base = 0.25; factor = 0.75 * 0.75 = 0.5625
    expect(result.score).toBeCloseTo(0.140625, 12)
  })

  it('only penalizes the metrics listed in penaltyMetrics', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'multiplicativePenalty', penaltyMetrics: ['b'] },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.25, b: 0.75 })], options)
    expect(result.score).toBeCloseTo(0.5, 12) // a is below threshold but exempt
  })

  it('zeroes the score with penaltyStrength 1 and a metric at 0', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'multiplicativePenalty', penaltyStrength: 1 },
    }
    const [result] = scoreRecords([rec('r1', { a: 0, b: 1 })], options)
    expect(result.score).toBe(0)
  })

  it('respects a custom penaltyThreshold and penaltyStrength', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1)],
      aggregation: { method: 'multiplicativePenalty', penaltyThreshold: 0.8, penaltyStrength: 0.5 },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.4 })], options)
    // base = 0.4; shortfall = (0.8 - 0.4)/0.8 = 0.5; factor = 0.75
    expect(result.score).toBeCloseTo(0.3, 12)
  })

  it('skips missing metrics when computing the penalty factor', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1), metric('b', 1)],
      aggregation: { method: 'multiplicativePenalty' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.9, b: null })], options)
    expect(result.score).toBeCloseTo(0.9, 12) // missing b applies no penalty
  })

  it('exactly at the threshold applies no penalty', () => {
    const options: ScoreOptions = {
      metrics: [metric('a', 1)],
      aggregation: { method: 'multiplicativePenalty' },
    }
    const [result] = scoreRecords([rec('r1', { a: 0.5 })], options)
    expect(result.score).toBeCloseTo(0.5, 12)
  })
})

describe('extractDrivers', () => {
  function driverMetric(key: string, contribution: number, missing = false): MetricScore {
    return {
      key,
      rawValue: missing ? null : contribution,
      normalizedValue: missing ? null : contribution,
      effectiveValue: missing ? null : contribution,
      weight: 1,
      contribution,
      missing,
    }
  }

  function makeResult(score: number, metrics: MetricScore[]): ScoreResult {
    return {
      record: { id: 'r1', values: {} },
      score,
      rank: 1,
      metrics,
      coverage: calculateCoverage(metrics),
    }
  }

  const result = makeResult(0.5, [
    driverMetric('small', 0.05),
    driverMetric('big', 0.3),
    driverMetric('neg', -0.2),
    driverMetric('gone', 0.4, true),
  ])

  it('sorts by absolute contribution descending and excludes missing metrics by default', () => {
    const drivers = extractDrivers(result)
    expect(drivers.map((driver) => driver.key)).toEqual(['big', 'neg', 'small'])
  })

  it('computes shareOfScore as contribution / score (signed)', () => {
    const drivers = extractDrivers(result)
    expect(drivers[0].shareOfScore).toBeCloseTo(0.6, 12)
    expect(drivers[1].shareOfScore).toBeCloseTo(-0.4, 12)
    expect(drivers[2].shareOfScore).toBeCloseTo(0.1, 12)
  })

  it('includes missing metrics when includeMissing is set', () => {
    const drivers = extractDrivers(result, { includeMissing: true })
    expect(drivers.map((driver) => driver.key)).toEqual(['gone', 'big', 'neg', 'small'])
  })

  it('applies the limit after sorting', () => {
    const drivers = extractDrivers(result, { limit: 1 })
    expect(drivers.map((driver) => driver.key)).toEqual(['big'])
  })

  it('filters by minContribution using absolute values', () => {
    const drivers = extractDrivers(result, { minContribution: 0.1 })
    expect(drivers.map((driver) => driver.key)).toEqual(['big', 'neg'])
  })

  it('returns shareOfScore 0 when the score is 0', () => {
    const zeroResult = makeResult(0, [driverMetric('a', 0.2)])
    const drivers = extractDrivers(zeroResult)
    expect(drivers[0].shareOfScore).toBe(0)
  })

  it('returns an empty array when there are no metrics', () => {
    expect(extractDrivers(makeResult(1, []))).toEqual([])
  })
})

describe('runSensitivityTrials', () => {
  const records = [rec('a', { m1: 1, m2: 0 }), rec('b', { m1: 0, m2: 1 })]
  const options: ScoreOptions = {
    metrics: [metric('m1', 1), metric('m2', 1)],
    aggregation: { method: 'additive' },
  }

  it('returns the baseline scoring alongside two trials per metric', () => {
    const summary = runSensitivityTrials(records, options)
    expect(summary.baseline.map((result) => result.record.id)).toEqual(['a', 'b']) // tie broken by id
    expect(summary.trials).toHaveLength(4)
    expect(summary.trials.map((trial) => trial.id)).toEqual([
      'm1:increase:0.1',
      'm1:decrease:0.1',
      'm2:increase:0.1',
      'm2:decrease:0.1',
    ])
  })

  it('perturbs only the targeted metric weight by the default 10%', () => {
    const summary = runSensitivityTrials(records, options)
    const increase = summary.trials.find((trial) => trial.id === 'm1:increase:0.1')
    const decrease = summary.trials.find((trial) => trial.id === 'm1:decrease:0.1')
    expect(increase?.weights).toEqual({ m1: 1.1, m2: 1 })
    expect(decrease?.weights).toEqual({ m1: 0.9, m2: 1 })
  })

  it('detects when a perturbation changes the top record', () => {
    const summary = runSensitivityTrials(records, options)
    const byId = new Map(summary.trials.map((trial) => [trial.id, trial]))
    // Baseline top is 'a' (tie broken by id). Boosting m1 keeps 'a' on top;
    // boosting m2 (or shrinking m1) flips the top record to 'b'.
    expect(byId.get('m1:increase:0.1')?.topRecordId).toBe('a')
    expect(byId.get('m1:increase:0.1')?.topChanged).toBe(false)
    expect(byId.get('m1:decrease:0.1')?.topRecordId).toBe('b')
    expect(byId.get('m1:decrease:0.1')?.topChanged).toBe(true)
    expect(byId.get('m2:increase:0.1')?.topRecordId).toBe('b')
    expect(byId.get('m2:increase:0.1')?.topChanged).toBe(true)
    expect(byId.get('m2:decrease:0.1')?.topChanged).toBe(false)
  })

  it('computes averageScoreDelta and maxRankDelta against the baseline', () => {
    const summary = runSensitivityTrials(records, options)
    const increase = summary.trials.find((trial) => trial.id === 'm1:increase:0.1')
    // a: 1.1/2.1, b: 1/2.1; both deltas are |1.1/2.1 - 0.5|
    expect(increase?.averageScoreDelta).toBeCloseTo(Math.abs(1.1 / 2.1 - 0.5), 12)
    expect(increase?.maxRankDelta).toBe(0)
    const decrease = summary.trials.find((trial) => trial.id === 'm1:decrease:0.1')
    expect(decrease?.maxRankDelta).toBe(1) // a and b swap ranks
  })

  it('honors a custom perturbation and floors the decrease multiplier at 0', () => {
    const summary = runSensitivityTrials(records, options, { perturbation: 1.5 })
    const decrease = summary.trials.find((trial) => trial.id === 'm1:decrease:1.5')
    expect(decrease?.weights).toEqual({ m1: 0, m2: 1 })
    const increase = summary.trials.find((trial) => trial.id === 'm1:increase:1.5')
    expect(increase?.weights).toEqual({ m1: 2.5, m2: 1 })
  })

  it('restricts trials to the requested metricKeys', () => {
    const summary = runSensitivityTrials(records, options, { metricKeys: ['m2'] })
    expect(summary.trials).toHaveLength(2)
    expect(summary.trials.every((trial) => trial.metricKey === 'm2')).toBe(true)
  })

  it('handles empty record sets without trials blowing up', () => {
    const summary = runSensitivityTrials([], options)
    expect(summary.baseline).toEqual([])
    expect(summary.trials).toHaveLength(4)
    for (const trial of summary.trials) {
      expect(trial.results).toEqual([])
      expect(trial.topRecordId).toBeNull()
      expect(trial.topChanged).toBe(false) // null === null baseline top
      expect(trial.averageScoreDelta).toBe(0)
      expect(trial.maxRankDelta).toBe(0)
    }
  })
})
