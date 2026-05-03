import {
  SCORE_METRICS,
  createMetricValueMap,
  getScorePaletteColor,
  type ScorePaletteProfile,
} from '../constants'
import type {
  RegionDataCounts,
  ScoredBoundaryRegion,
  ScoreBuilderRegion,
  ScoreMetricKey,
  ScoreMetricRangeMap,
  ScoreMetricValueMap,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'
import { metricHasCoverage } from './metrics'

export interface RegionMetricRow {
  region: ScoreBuilderRegion
  metrics: ScoreMetricValueMap
  counts: RegionDataCounts
}

export type MetricValueListMap = Record<ScoreMetricKey, number[]>

export function normalizeMetric(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

export function normalizeWithMethod(
  value: number,
  values: number[],
  range: { min: number; max: number },
  method: ScoreMethodSettings['normalization'],
): number {
  if (!Number.isFinite(value)) return 0
  if (method === 'minMax') return normalizeMetric(value, range.min, range.max)
  if (!values.length) return 0.5

  if (method === 'winsorizedMinMax') {
    if (values.length < 4) return normalizeMetric(value, range.min, range.max)
    const lowIndex = Math.floor((values.length - 1) * 0.05)
    const highIndex = Math.ceil((values.length - 1) * 0.95)
    const low = values[lowIndex]
    const high = values[highIndex]
    const clipped = Math.max(low, Math.min(high, value))
    return normalizeMetric(clipped, low, high)
  }

  if (method === 'percentile') {
    const below = values.filter((candidate) => candidate < value).length
    const equal = values.filter((candidate) => candidate === value).length
    return Math.max(0, Math.min(1, (below + equal * 0.5) / values.length))
  }

  const mean = values.reduce((sum, candidate) => sum + candidate, 0) / values.length
  const variance = values.reduce((sum, candidate) => sum + (candidate - mean) ** 2, 0) / values.length
  const stdDev = Math.sqrt(variance)
  if (!Number.isFinite(stdDev) || stdDev <= 0) return 0.5
  const z = (value - mean) / stdDev
  return Math.max(0, Math.min(1, 0.5 + z / 6))
}

export function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

export function computeDataCoverageScore(counts: RegionDataCounts, weights: ScoreMetricWeightMap): number {
  const activeMetrics = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
  if (!activeMetrics.length) return 1
  const coveredMetrics = activeMetrics.filter((metric) => metricHasCoverage(metric.key, counts)).length
  return coveredMetrics / activeMetrics.length
}

export function buildMetricRanges(rows: RegionMetricRow[]): ScoreMetricRangeMap {
  return SCORE_METRICS.reduce((accumulator, metric) => {
    const values = rows.map((row) => row.metrics[metric.key]).filter((value) => Number.isFinite(value))
    const min = values.length ? Math.min(...values) : 0
    const max = values.length ? Math.max(...values) : 1
    return { ...accumulator, [metric.key]: { min, max } }
  }, {} as ScoreMetricRangeMap)
}

export function buildMetricValueLists(rows: RegionMetricRow[]): MetricValueListMap {
  return SCORE_METRICS.reduce((accumulator, metric) => {
    accumulator[metric.key] = rows
      .map((row) => row.metrics[metric.key])
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
    return accumulator
  }, {} as MetricValueListMap)
}

export function scoreRegionRows({
  rows,
  weights,
  settings,
  metricRanges,
  metricValueLists,
  paletteProfile,
}: {
  rows: RegionMetricRow[]
  weights: ScoreMetricWeightMap
  settings: ScoreMethodSettings
  metricRanges: ScoreMetricRangeMap
  metricValueLists: MetricValueListMap
  paletteProfile: ScorePaletteProfile
}): ScoredBoundaryRegion[] {
  const totalWeight = SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
  const ranked = rows.map((row) => {
    const normalizedMetrics = createMetricValueMap(0)
    const contributions = createMetricValueMap(0)
    let rawScore = 0
    let rawProduct = 1

    SCORE_METRICS.forEach((metric) => {
      const value = row.metrics[metric.key]
      const range = metricRanges[metric.key]
      const hasCoverage = metricHasCoverage(metric.key, row.counts)
      const normalizedValue =
        settings.missingData === 'neutral' && !hasCoverage
          ? 0.5
          : normalizeWithMethod(value, metricValueLists[metric.key] ?? [], range, settings.normalization)
      const weight = weights[metric.key]
      const directionalValue = weight >= 0 ? normalizedValue : 1 - normalizedValue
      normalizedMetrics[metric.key] = normalizedValue
      contributions[metric.key] = totalWeight > 0 ? (Math.abs(weight) * directionalValue) / totalWeight : 0
      rawScore += contributions[metric.key]
      if (weight !== 0 && totalWeight > 0) {
        rawProduct *= Math.max(0.01, directionalValue) ** (Math.abs(weight) / totalWeight)
      }
    })

    const aggregateValue = settings.aggregation === 'geometric' && totalWeight > 0 ? rawProduct : rawScore
    const score = totalWeight > 0 ? clampScore(aggregateValue * 100) : 50

    return {
      ...row,
      normalizedMetrics,
      contributions,
      score,
      scoreColor: getScorePaletteColor(score, paletteProfile),
      rank: 0,
      dataCoverageScore: computeDataCoverageScore(row.counts, weights),
    }
  })

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.metrics.overallDensity !== a.metrics.overallDensity) return b.metrics.overallDensity - a.metrics.overallDensity
    return a.region.name.localeCompare(b.region.name)
  })

  return ranked.map((row, index) => ({ ...row, rank: index + 1 }))
}
