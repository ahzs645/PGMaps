import {
  calculateIndexRows,
  buildMetricRanges as buildIndexMetricRanges,
  buildMetricValueLists as buildIndexMetricValueLists,
  computeDataCoverageScore as computeIndexDataCoverageScore,
  findMeasurableMetricKeys as findIndexMeasurableMetricKeys,
} from '@pgmaps/geo-toolkit/index-lab/scoring'
export { clampScore, normalizeMetric, normalizeWithMethod } from '@pgmaps/geo-toolkit/index-lab/scoring'
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
import type { BcEnviroScreenSourceStatus } from './bcEnviroScreenRelease'

export interface RegionMetricRow {
  region: ScoreBuilderRegion
  metrics: ScoreMetricValueMap
  counts: RegionDataCounts
  bcEnviroScreenSourceStatuses?: Record<ScoreMetricKey, BcEnviroScreenSourceStatus>
}

export type MetricValueListMap = Record<ScoreMetricKey, number[]>
const DEFAULT_METRICS = SCORE_METRICS as ScoreMetricDefinition[]

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
  return computeIndexDataCoverageScore(
    weights,
    metrics.map((metric) => metric.key),
    (key) => metricHasCoverage(key, counts),
    measurableKeys,
  )
}

/** Weighted metrics with data for at least one region in the current set. */
export function findMeasurableMetricKeys(
  rows: RegionMetricRow[],
  weights: ScoreMetricWeightMap,
  metrics: ScoreMetricDefinition[],
): Set<ScoreMetricKey> {
  return findIndexMeasurableMetricKeys(
    rows,
    weights,
    metrics.map((metric) => metric.key),
    (row, key) => metricHasCoverage(key, row.counts),
  )
}

export function buildMetricRanges(
  rows: RegionMetricRow[],
  metrics: ScoreMetricDefinition[] = DEFAULT_METRICS,
): ScoreMetricRangeMap {
  return buildIndexMetricRanges(
    rows,
    metrics.map((metric) => metric.key),
    (row) => row.metrics,
  )
}

export function buildMetricValueLists(
  rows: RegionMetricRow[],
  metrics: ScoreMetricDefinition[] = DEFAULT_METRICS,
): MetricValueListMap {
  return buildIndexMetricValueLists(
    rows,
    metrics.map((metric) => metric.key),
    (row) => row.metrics,
  )
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
  const calculations = calculateIndexRows({
    rows,
    weights,
    metricKeys: metrics.map((metric) => metric.key),
    getValues: (row) => row.metrics,
    normalization: settings.normalization,
    missingData: settings.missingData,
    aggregation: settings.aggregation === 'geometric' ? 'geometric' : 'additive',
    metricRanges,
    metricValueLists,
    hasCoverage: (row, key) => metricHasCoverage(key, row.counts),
    aggregate:
      settings.aggregation === 'accessThreshold' || settings.aggregation === 'cumulativeBurden'
        ? ({ row, normalizedMetrics }) => {
            const fullNormalizedMetrics = { ...createMetricValueMap(0), ...normalizedMetrics }
            return settings.aggregation === 'accessThreshold'
              ? calculateAccessThresholdScore(fullNormalizedMetrics, row.metrics, weights, settings)
              : calculateCumulativeBurden(fullNormalizedMetrics, weights)
          }
        : undefined,
  })
  const ranked = calculations.map(
    ({
      row,
      normalizedMetrics: calculatedMetrics,
      contributions: calculatedContributions,
      score,
      dataCoverageScore,
    }) => {
      const normalizedMetrics = { ...createMetricValueMap(0), ...calculatedMetrics }
      const contributions = { ...createMetricValueMap(0), ...calculatedContributions }

      return {
        ...row,
        normalizedMetrics,
        contributions,
        score,
        scoreColor: getScorePaletteOutputColor(score, paletteProfile, settings.visualOutput),
        rank: 0,
        dataCoverageScore,
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
    },
  )

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    if (b.metrics.overallDensity !== a.metrics.overallDensity)
      return b.metrics.overallDensity - a.metrics.overallDensity
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
                ? level === 'db'
                  ? 'Prince George dissemination blocks'
                  : 'BC census regions'
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
