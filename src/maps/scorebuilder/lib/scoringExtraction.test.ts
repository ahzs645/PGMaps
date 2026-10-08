import { describe, expect, it } from 'vitest'
import { SCORE_METRICS, SCORE_PALETTE_PROFILES, createMetricValueMap } from '../constants'
import { createInitialScoreBuilderState } from '../hooks/scoreBuilderReducer'
import type { RegionDataCounts, ScoreMethodSettings, ScoreMetricWeightMap } from '../types'
import { buildMetricRanges, buildMetricValueLists, scoreRegionRows, type RegionMetricRow } from './scoring'

function row(id: string, values: Record<string, number>, covered: boolean): RegionMetricRow {
  return {
    region: { id, name: id, source: 'census', level: 'da' } as RegionMetricRow['region'],
    metrics: { ...createMetricValueMap(0), ...values },
    counts: new Proxy({} as RegionDataCounts, { get: () => (covered ? 1 : 0) }),
  }
}

const rows = [
  row(
    'Alpha',
    { parkDensity: 2, populationDensity: 100, crimeDensity: 8, cimdComposite: 0.2, parkWalk10Access: 0.1 },
    true,
  ),
  row(
    'Bravo',
    { parkDensity: 8, populationDensity: 50, crimeDensity: 2, cimdComposite: 0.8, parkWalk10Access: 0.8 },
    true,
  ),
  row(
    'Charlie',
    { parkDensity: 0, populationDensity: 0, crimeDensity: 0, cimdComposite: 0, parkWalk10Access: 0 },
    false,
  ),
]
const weights: ScoreMetricWeightMap = {
  ...createMetricValueMap(0),
  parkDensity: 20,
  populationDensity: 10,
  crimeDensity: -30,
  cimdComposite: 25,
  parkWalk10Access: 15,
}
const metrics = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
const defaultSettings = createInitialScoreBuilderState(new URLSearchParams()).methodSettings

describe('Index Lab calculation extraction', () => {
  it('preserves the pre-extraction scores, ranking, and coverage across every standard calculation mode', () => {
    const results = []
    for (const normalization of ['minMax', 'percentile', 'winsorizedMinMax', 'zScore'] as const) {
      for (const aggregation of ['additive', 'geometric', 'cumulativeBurden', 'accessThreshold'] as const) {
        for (const missingData of ['zero', 'neutral'] as const) {
          const settings: ScoreMethodSettings = {
            ...defaultSettings,
            normalization,
            aggregation,
            missingData,
            visualOutput: 'interpolated',
            accessThreshold: { minimumAccess: 0.5, minimumHits: 2 },
          }
          const scored = scoreRegionRows({
            rows,
            weights,
            settings,
            metrics,
            metricRanges: buildMetricRanges(rows, metrics),
            metricValueLists: buildMetricValueLists(rows, metrics),
            paletteProfile: SCORE_PALETTE_PROFILES.benefit,
          })
          results.push({
            normalization,
            aggregation,
            missingData,
            results: scored.map((entry) => [entry.region.id, entry.score, entry.rank, entry.dataCoverageScore]),
          })
        }
      }
    }
    // This snapshot was captured from the original PG Maps implementation before extraction.
    expect(results).toMatchSnapshot()
  })

  it('preserves neutral scores and stable name ordering for an empty model', () => {
    const settings: ScoreMethodSettings = {
      ...defaultSettings,
      normalization: 'minMax',
      aggregation: 'geometric',
      missingData: 'zero',
    }
    const scored = scoreRegionRows({
      rows: [...rows].reverse(),
      weights: createMetricValueMap(0),
      settings,
      metrics,
      metricRanges: buildMetricRanges(rows, metrics),
      metricValueLists: buildMetricValueLists(rows, metrics),
      paletteProfile: SCORE_PALETTE_PROFILES.benefit,
    })
    expect(scored.map((entry) => [entry.region.id, entry.score, entry.rank, entry.dataCoverageScore])).toEqual([
      ['Alpha', 50, 1, 1],
      ['Bravo', 50, 2, 1],
      ['Charlie', 50, 3, 1],
    ])
  })
})
