import { describe, expect, it } from 'vitest'
import type { RegionDataCounts, ScoreMetricWeightMap } from '../types'
import { computeDataCoverageScore, findMeasurableMetricKeys, type RegionMetricRow } from './scoring'
import { SCORE_METRICS, createMetricValueMap } from '../constants'

/** Zero-filled counts; tests set only the fields the metric under test reads. */
function counts(overrides: Partial<RegionDataCounts> = {}): RegionDataCounts {
  return new Proxy({ ...overrides } as RegionDataCounts, {
    get: (target, prop: string) => (prop in target ? target[prop as keyof RegionDataCounts] : 0),
  })
}

function row(id: string, overrides: Partial<RegionDataCounts>): RegionMetricRow {
  return {
    region: { id, code: id, name: id } as RegionMetricRow['region'],
    metrics: {} as RegionMetricRow['metrics'],
    counts: counts(overrides),
  }
}

/** A full weight map, matching the app: every metric present, most of them zero. */
function weightMap(active: Record<string, number>): ScoreMetricWeightMap {
  return { ...createMetricValueMap(0), ...active } as ScoreMetricWeightMap
}

const weights = weightMap({ parkDensity: 25, populationDensity: 25 })

describe('computeDataCoverageScore', () => {
  it('is the share of weighted metrics with real data', () => {
    expect(computeDataCoverageScore(counts({ parkCount: 4, populationSum: 900 }), weights)).toBe(1)
    expect(computeDataCoverageScore(counts({ parkCount: 4 }), weights)).toBe(0.5)
    expect(computeDataCoverageScore(counts(), weights)).toBe(0)
  })

  it('treats an empty equation as fully covered rather than dividing by zero', () => {
    expect(computeDataCoverageScore(counts(), weightMap({}))).toBe(1)
  })

  it('ignores metrics that have no data anywhere, so a dead metric cannot zero the map', () => {
    // Parks is dead across the whole set, so only population decides coverage.
    const measurable = new Set(['populationDensity'])
    expect(computeDataCoverageScore(counts({ populationSum: 900 }), weights, SCORE_METRICS, measurable)).toBe(1)
    expect(computeDataCoverageScore(counts(), weights, SCORE_METRICS, measurable)).toBe(0)
  })
})

describe('findMeasurableMetricKeys', () => {
  const rows = [row('a', { parkCount: 3 }), row('b', { populationSum: 500 })]

  it('keeps a weighted metric that has data for at least one region', () => {
    const measurable = findMeasurableMetricKeys(rows, weights, SCORE_METRICS)
    expect(measurable.has('parkDensity')).toBe(true)
    expect(measurable.has('populationDensity')).toBe(true)
  })

  it('drops a weighted metric with no data in any region', () => {
    const withTransit = weightMap({ parkDensity: 25, populationDensity: 25, transitStopDensity: 20 })
    expect(findMeasurableMetricKeys(rows, withTransit, SCORE_METRICS).has('transitStopDensity')).toBe(false)
  })

  it('ignores unweighted metrics entirely', () => {
    expect(findMeasurableMetricKeys(rows, weights, SCORE_METRICS).has('crimeDensity')).toBe(false)
  })
})
