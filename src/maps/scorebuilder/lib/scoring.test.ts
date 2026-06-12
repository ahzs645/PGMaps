import { describe, expect, it } from 'vitest'
import { clampScore, normalizeMetric, normalizeWithMethod } from './scoring'

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
