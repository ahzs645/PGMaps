import { describe, expect, it } from 'vitest'
import { describeAssociation, residualColorScale, topMetricCorrelations } from './correlation'
import { getResidualColor, RESIDUAL_POSITIVE_COLOR } from './correlationColors'
import { SCORE_METRICS } from '../constants'
import type { RegionMetricRow } from './scoring'

describe('residualColorScale', () => {
  it('ignores the outliers that would wash out every other region', () => {
    const residuals = [...Array.from({ length: 28 }, (_, index) => (index % 2 ? 1 : -1)), 500, -400, 300]
    const scale = residualColorScale(residuals)
    expect(scale).toBe(1)
    expect(getResidualColor(1, scale)).toBe(RESIDUAL_POSITIVE_COLOR)
  })

  it('falls back to the largest residual when most sit exactly on the line', () => {
    expect(residualColorScale([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 7])).toBe(7)
  })

  it('handles no residuals', () => {
    expect(residualColorScale([])).toBe(0)
  })
})

describe('describeAssociation', () => {
  it('does not call a strong rank relationship weak', () => {
    const { strength, note } = describeAssociation(0.25, 0.7)
    expect(strength).toBe('Very strong')
    expect(note).toMatch(/Spearman/)
  })

  it('flags a Pearson r lifted by a few extreme regions', () => {
    expect(describeAssociation(0.8, 0.3).note).toMatch(/extreme regions/)
  })

  it('stays quiet when the two agree', () => {
    expect(describeAssociation(0.5, 0.56)).toEqual({ strength: 'Strong', note: null })
  })

  it('reads the size of a negative relationship', () => {
    expect(describeAssociation(-0.4, -0.45).strength).toBe('Moderate')
  })
})

describe('topMetricCorrelations', () => {
  it('skips pairs from one topic, which are usually views of the same data', () => {
    const [first] = SCORE_METRICS
    const sameTopic = SCORE_METRICS.find((metric) => metric.category === first.category && metric.key !== first.key)!
    const otherTopic = SCORE_METRICS.find((metric) => metric.category !== first.category)!
    const rows = Array.from({ length: 12 }, (_, index) => ({
      metrics: { [first.key]: index, [sameTopic.key]: index * 2, [otherTopic.key]: index * index },
    })) as unknown as RegionMetricRow[]

    const pairs = topMetricCorrelations(rows).map((pair) => [pair.metricX, pair.metricY].sort().join('|'))
    expect(pairs).not.toContain([first.key, sameTopic.key].sort().join('|'))
    expect(pairs).toContain([first.key, otherTopic.key].sort().join('|'))
  })
})
