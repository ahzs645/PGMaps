import {
  SCORE_ACCESS_THRESHOLD_METRICS,
  SCORE_METRICS,
  createMetricValueMap,
  getScorePaletteOutputColor,
  type ScorePaletteProfile,
} from '../constants'
import type {
  RegionDataCounts,
  ScoredBoundaryRegion,
  ScoreBuilderRegion,
  ScoreMetricDefinition,
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
const DEFAULT_METRICS = SCORE_METRICS as ScoreMetricDefinition[]

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

/**
 * Share of the weighted metrics that have real data for this region.
 *
 * `measurableKeys` restricts the denominator to metrics that have data *somewhere*
 * in the current set. A metric that is dead everywhere — its data source is off, or
 * the dataset does not reach this boundary — contributes the same zero to every
 * region, so counting it would mark the whole map as uncovered instead of telling
 * regions apart, which is the only thing this score is for.
 */
export function computeDataCoverageScore(
  counts: RegionDataCounts,
  weights: ScoreMetricWeightMap,
  metrics: ScoreMetricDefinition[] = DEFAULT_METRICS,
  measurableKeys?: ReadonlySet<ScoreMetricKey>,
): number {
  const activeMetrics = metrics.filter(
    (metric) => weights[metric.key] !== 0 && (!measurableKeys || measurableKeys.has(metric.key)),
  )
  if (!activeMetrics.length) return 1
  const coveredMetrics = activeMetrics.filter((metric) => metricHasCoverage(metric.key, counts)).length
  return coveredMetrics / activeMetrics.length
}

/** Weighted metrics with data for at least one region in the current set. */
export function findMeasurableMetricKeys(
  rows: RegionMetricRow[],
  weights: ScoreMetricWeightMap,
  metrics: ScoreMetricDefinition[],
): Set<ScoreMetricKey> {
  const measurable = new Set<ScoreMetricKey>()
  metrics.forEach((metric) => {
    if (weights[metric.key] === 0) return
    if (rows.some((row) => metricHasCoverage(metric.key, row.counts))) measurable.add(metric.key)
  })
  return measurable
}

export function buildMetricRanges(rows: RegionMetricRow[], metrics: ScoreMetricDefinition[] = DEFAULT_METRICS): ScoreMetricRangeMap {
  return metrics.reduce((accumulator, metric) => {
    const values = rows.map((row) => row.metrics[metric.key]).filter((value) => Number.isFinite(value))
    const min = values.length ? Math.min(...values) : 0
    const max = values.length ? Math.max(...values) : 1
    return { ...accumulator, [metric.key]: { min, max } }
  }, {} as ScoreMetricRangeMap)
}

export function buildMetricValueLists(rows: RegionMetricRow[], metrics: ScoreMetricDefinition[] = DEFAULT_METRICS): MetricValueListMap {
  return metrics.reduce((accumulator, metric) => {
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
  metrics = DEFAULT_METRICS,
}: {
  rows: RegionMetricRow[]
  weights: ScoreMetricWeightMap
  settings: ScoreMethodSettings
  metricRanges: ScoreMetricRangeMap
  metricValueLists: MetricValueListMap
  paletteProfile: ScorePaletteProfile
  metrics?: ScoreMetricDefinition[]
}): ScoredBoundaryRegion[] {
  const totalWeight = metrics.reduce((sum, metric) => sum + Math.abs(weights[metric.key] ?? 0), 0)
  const measurableKeys = findMeasurableMetricKeys(rows, weights, metrics)
  const ranked = rows.map((row) => {
    const normalizedMetrics = createMetricValueMap(0)
    const contributions = createMetricValueMap(0)
    let rawScore = 0
    let rawProduct = 1

    metrics.forEach((metric) => {
      const value = row.metrics[metric.key]
      const range = metricRanges[metric.key]
      const hasCoverage = metricHasCoverage(metric.key, row.counts)
      const normalizedValue =
        settings.missingData === 'neutral' && !hasCoverage
          ? 0.5
          : normalizeWithMethod(value, metricValueLists[metric.key] ?? [], range, settings.normalization)
      const weight = weights[metric.key] ?? 0
      const directionalValue = weight >= 0 ? normalizedValue : 1 - normalizedValue
      normalizedMetrics[metric.key] = normalizedValue
      contributions[metric.key] = totalWeight > 0 ? (Math.abs(weight) * directionalValue) / totalWeight : 0
      rawScore += contributions[metric.key]
      if (weight !== 0 && totalWeight > 0) {
        rawProduct *= Math.max(0.01, directionalValue) ** (Math.abs(weight) / totalWeight)
      }
    })

    const aggregateValue =
      settings.aggregation === 'accessThreshold'
        ? calculateAccessThresholdScore(normalizedMetrics, row.metrics, weights, settings)
        : settings.aggregation === 'cumulativeBurden'
        ? calculateCumulativeBurden(normalizedMetrics, weights)
        : settings.aggregation === 'geometric' && totalWeight > 0
          ? rawProduct
          : rawScore
    const score = totalWeight > 0 ? clampScore(aggregateValue * 100) : 50

    return {
      ...row,
      normalizedMetrics,
      contributions,
      score,
      scoreColor: getScorePaletteOutputColor(score, paletteProfile, settings.visualOutput),
      rank: 0,
      dataCoverageScore: computeDataCoverageScore(row.counts, weights, metrics, measurableKeys),
      rankConfidence: 'Stable priority' as const,
      rankInterval: [0, 0],
      scoreInterval: [score, score] as [number, number],
      comparisonUniverseLabel: getComparisonUniverseLabel(row.region.source, row.region.level),
      equityAudit: {
        referenceRank: null,
        rankDelta: 0,
        referenceScore: null,
        deprivationQuintile: null,
        burdenOverlap: 0,
        cutoffWarning: null,
      },
      scoreMethodLabel:
        settings.aggregation === 'accessThreshold'
          ? `Access threshold: ${settings.accessThreshold.minimumHits}+ indicators at ${(settings.accessThreshold.minimumAccess * 100).toFixed(0)}%+`
          : undefined,
    }
  })

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.metrics.overallDensity !== a.metrics.overallDensity) return b.metrics.overallDensity - a.metrics.overallDensity
    return a.region.name.localeCompare(b.region.name)
  })

  return ranked.map((row, index) => ({ ...row, rank: index + 1, rankInterval: [index + 1, index + 1] }))
}

function calculateAccessThresholdScore(
  normalizedMetrics: ScoreMetricValueMap,
  rawMetrics: ScoreMetricValueMap,
  weights: ScoreMetricWeightMap,
  settings: ScoreMethodSettings,
): number {
  const activeAccessMetrics = SCORE_ACCESS_THRESHOLD_METRICS.filter((metric) => weights[metric] !== 0)
  const evaluatedMetrics = activeAccessMetrics.length > 0 ? activeAccessMetrics : SCORE_ACCESS_THRESHOLD_METRICS
  const threshold = settings.accessThreshold.minimumAccess
  const minimumHits = Math.max(1, Math.min(settings.accessThreshold.minimumHits, evaluatedMetrics.length))
  const hits = evaluatedMetrics.filter((metric) => {
    const raw = rawMetrics[metric]
    const value = Number.isFinite(raw) ? raw : normalizedMetrics[metric]
    return value >= threshold
  }).length
  return Math.max(0, Math.min(1, hits / minimumHits))
}

function getComparisonUniverseLabel(source: ScoreBuilderRegion['source'], level: ScoreBuilderRegion['level']): string {
  const sourceLabel =
    source === 'bcHealth'
      ? 'BC health regions'
      : source === 'regionalDistrict'
        ? 'BC regional districts'
      : source === 'cityCommunity'
        ? 'CityPG community polygons'
      : source === 'cityPG'
        ? 'CityPG school catchments'
        : source === 'watershed'
          ? 'BC Freshwater Atlas watershed boundaries'
          : source === 'census'
            ? level === 'db' ? 'Prince George dissemination blocks' : 'BC census regions'
            : 'selected boundary regions'
  return `Scores are relative to ${sourceLabel} at the currently loaded ${level} boundary level; filters do not redefine percentiles.`
}

function metricPressureValue(metric: (typeof SCORE_METRICS)[number], normalizedValue: number): number {
  return metric.direction === 'higherIsWorse' ? normalizedValue : 1 - normalizedValue
}

function weightedAverage(values: Array<{ value: number; weight: number }>): number {
  const totalWeight = values.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) return 0
  return values.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight
}

function calculateCumulativeBurden(normalizedMetrics: ScoreMetricValueMap, weights: ScoreMetricWeightMap): number {
  const activeMetrics = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
  const groups = {
    burden: [] as Array<{ value: number; weight: number }>,
    vulnerability: [] as Array<{ value: number; weight: number }>,
    adaptiveGap: [] as Array<{ value: number; weight: number }>,
  }

  activeMetrics.forEach((metric) => {
    const normalizedValue = normalizedMetrics[metric.key]
    const weight = Math.abs(weights[metric.key])
    if (weight <= 0) return
    if (
      metric.component === 'environmentalBurden' ||
      metric.component === 'safetyPressure' ||
      metric.component === 'housingPressure'
    ) {
      groups.burden.push({ value: metricPressureValue(metric, normalizedValue), weight })
    } else if (metric.component === 'sensitivity') {
      groups.vulnerability.push({ value: metricPressureValue(metric, normalizedValue), weight })
    } else if (metric.component === 'adaptiveCapacity' || metric.component === 'serviceAccess') {
      groups.adaptiveGap.push({ value: metricPressureValue(metric, normalizedValue), weight })
    }
  })

  const burden = weightedAverage(groups.burden)
  const vulnerability = weightedAverage(groups.vulnerability)
  const adaptiveGap = weightedAverage(groups.adaptiveGap)
  return Math.max(0, Math.min(1, Math.sqrt(burden * Math.max(vulnerability, adaptiveGap))))
}
