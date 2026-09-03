import { describe, expect, it } from 'vitest'
import {
  BC_ENVIRO_SCREEN_METRIC_KEYS,
  SCORE_PALETTE_PROFILES,
  createBcEnviroScreenWeights,
  createMetricValueMap,
} from '../constants'
import type { RegionDataCounts, ScoreBuilderRegion, ScoreMethodSettings } from '../types'
import { scoreRegionRowsWithBcEnviroScreen } from './bcEnviroScreenScoring'
import type { RegionMetricRow } from './scoring'

const settings: ScoreMethodSettings = {
  normalization: 'percentile',
  aggregation: 'bcEnviroScreenProduct',
  missingData: 'neutral',
  sensitivity: false,
  normalizationScope: 'activeBoundaryLevel',
  visualOutput: 'interpolated',
  mapColorScale: 'absolute',
  paletteOverride: null,
  healthyPlanPriority: { demographicMetric: null, environmentMetric: null },
  accessThreshold: { minimumAccess: 0.5, minimumHits: 4 },
  bcEnviroScreenComponentWeights: {
    exposures: 1,
    environmentalEffects: 0.5,
    sensitivePopulations: 1,
    socioeconomicFactors: 1,
  },
  bcEnviroScreenFormula: {
    mode: 'reconstruction',
    expression: 'landscape_burden * population_characteristics',
  },
  metricModuleOverrides: {},
}

function row(id: string, value: number): RegionMetricRow {
  const metrics = createMetricValueMap(0)
  BC_ENVIRO_SCREEN_METRIC_KEYS.forEach((key) => {
    metrics[key] = value
  })
  return {
    region: { id, code: id, name: id, source: 'bcHealth', level: 'lha' } as ScoreBuilderRegion,
    metrics,
    counts: { bcEnviroScreenJoinedCount: 1 } as RegionDataCounts,
  }
}

describe('scoreRegionRowsWithBcEnviroScreen', () => {
  it('uses one-based average ranks, excludes zero, and reproduces the product formula', () => {
    const results = scoreRegionRowsWithBcEnviroScreen({
      rows: [row('zero', 0), row('low', 2), row('tie-a', 4), row('tie-b', 4), row('high', 8)],
      weights: createBcEnviroScreenWeights(),
      settings,
      paletteProfile: SCORE_PALETTE_PROFILES.riskPressure,
    })
    const byId = new Map(results.map((result) => [result.region.id, result]))
    const firstMetric = BC_ENVIRO_SCREEN_METRIC_KEYS[0]
    expect(byId.get('zero')?.normalizedMetrics[firstMetric]).toBe(0)
    expect(byId.get('low')?.normalizedMetrics[firstMetric]).toBe(0.25)
    expect(byId.get('tie-a')?.normalizedMetrics[firstMetric]).toBe(0.625)
    expect(byId.get('tie-b')?.normalizedMetrics[firstMetric]).toBe(0.625)
    expect(byId.get('high')?.normalizedMetrics[firstMetric]).toBe(1)
    expect(byId.get('zero')?.score).toBe(0)
    expect(byId.get('low')?.score).toBeCloseTo(6.25, 12)
    expect(byId.get('tie-a')?.score).toBeCloseTo(39.0625, 12)
  })

  it('excludes missing indicator values from component means', () => {
    const rows = [row('a', 1), row('b', 2)]
    rows[0].metrics[BC_ENVIRO_SCREEN_METRIC_KEYS[0]] = Number.NaN
    const result = scoreRegionRowsWithBcEnviroScreen({
      rows,
      weights: createBcEnviroScreenWeights(),
      settings,
      paletteProfile: SCORE_PALETTE_PROFILES.riskPressure,
    }).find((entry) => entry.region.id === 'a')
    expect(result?.bcEnviroScreen?.missingIndicators).toContain(BC_ENVIRO_SCREEN_METRIC_KEYS[0])
    expect(result?.dataCoverageScore).toBeCloseTo(20 / 21)
  })

  it('evaluates a safe custom formula against indicator percentiles and components', () => {
    const results = scoreRegionRowsWithBcEnviroScreen({
      rows: [row('low', 2), row('high', 8)],
      weights: createBcEnviroScreenWeights(),
      settings: {
        ...settings,
        bcEnviroScreenFormula: { mode: 'custom', expression: 'pm25 * 50 + exposures * 50' },
      },
      paletteProfile: SCORE_PALETTE_PROFILES.riskPressure,
    })
    const byId = new Map(results.map((result) => [result.region.id, result]))
    expect(byId.get('low')?.score).toBe(50)
    expect(byId.get('high')?.score).toBe(100)
    expect(byId.get('high')?.bcEnviroScreen?.formulaMode).toBe('custom')
  })

  it('reports invalid custom formulas without executing them', () => {
    const [result] = scoreRegionRowsWithBcEnviroScreen({
      rows: [row('one', 1)],
      weights: createBcEnviroScreenWeights(),
      settings: {
        ...settings,
        bcEnviroScreenFormula: { mode: 'custom', expression: 'window.alert(1)' },
      },
      paletteProfile: SCORE_PALETTE_PROFILES.riskPressure,
    })
    expect(result.score).toBe(0)
    expect(result.bcEnviroScreen?.formulaError).toContain('Unexpected character')
  })
})
