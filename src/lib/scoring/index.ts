export type ScoreValue = number | null | undefined

export type ScoreDirection = 'higherIsBetter' | 'lowerIsBetter'

export type NormalizationMethod = 'minMax' | 'percentile' | 'zScore' | 'threshold'

export type AggregationMethod = 'additive' | 'geometric' | 'multiplicativePenalty'

export type NonNegativeHandling = 'clamp' | 'offset' | 'skip'

export interface ScoreRecord<TKey extends string = string> {
  id: string
  values: Partial<Record<TKey, ScoreValue>>
  label?: string
  metadata?: Record<string, unknown>
}

export interface MinMaxNormalizationOptions {
  method: 'minMax'
  min?: number
  max?: number
}

export interface PercentileNormalizationOptions {
  method: 'percentile'
}

export interface ZScoreNormalizationOptions {
  method: 'zScore'
  mean?: number
  standardDeviation?: number
  spread?: number
}

export interface ThresholdNormalizationOptions {
  method: 'threshold'
  threshold: number
  passDirection?: 'above' | 'below'
  margin?: number
}

export type NormalizationOptions =
  | MinMaxNormalizationOptions
  | PercentileNormalizationOptions
  | ZScoreNormalizationOptions
  | ThresholdNormalizationOptions

export interface ScoreMetricConfig<TKey extends string = string> {
  key: TKey
  label?: string
  weight: number
  direction?: ScoreDirection
  normalization: NormalizationOptions
  missingValue?: number
}

export interface AdditiveAggregationOptions {
  method: 'additive'
}

export interface GeometricAggregationOptions {
  method: 'geometric'
  nonNegativeHandling?: NonNegativeHandling
  epsilon?: number
}

export interface MultiplicativePenaltyAggregationOptions<TKey extends string = string> {
  method: 'multiplicativePenalty'
  penaltyThreshold?: number
  penaltyStrength?: number
  penaltyMetrics?: readonly TKey[]
}

export type AggregationOptions<TKey extends string = string> =
  | AdditiveAggregationOptions
  | GeometricAggregationOptions
  | MultiplicativePenaltyAggregationOptions<TKey>

export interface ScoreOptions<TKey extends string = string> {
  metrics: readonly ScoreMetricConfig<TKey>[]
  aggregation: AggregationOptions<TKey>
}

export interface CoverageSummary {
  presentMetrics: number
  totalMetrics: number
  presentWeight: number
  totalWeight: number
  metricCoverage: number
  weightCoverage: number
}

export interface MetricScore<TKey extends string = string> {
  key: TKey
  label?: string
  rawValue: ScoreValue
  normalizedValue: number | null
  effectiveValue: number | null
  weight: number
  contribution: number
  missing: boolean
}

export interface ScoreResult<TKey extends string = string, TRecord extends ScoreRecord<TKey> = ScoreRecord<TKey>> {
  record: TRecord
  score: number
  rank: number
  metrics: MetricScore<TKey>[]
  coverage: CoverageSummary
}

export interface ScoreDriver<TKey extends string = string> extends MetricScore<TKey> {
  shareOfScore: number
}

export interface DriverExtractionOptions {
  limit?: number
  includeMissing?: boolean
  minContribution?: number
}

export interface SensitivityOptions<TKey extends string = string> {
  perturbation?: number
  metricKeys?: readonly TKey[]
}

export interface SensitivityTrial<TKey extends string = string> {
  id: string
  metricKey: TKey
  direction: 'increase' | 'decrease'
  weights: Record<TKey, number>
  results: ScoreResult<TKey>[]
  topRecordId: string | null
  topChanged: boolean
  averageScoreDelta: number
  maxRankDelta: number
}

export interface SensitivitySummary<TKey extends string = string> {
  baseline: ScoreResult<TKey>[]
  trials: SensitivityTrial<TKey>[]
}

export function scoreRecords<TKey extends string, TRecord extends ScoreRecord<TKey>>(
  records: readonly TRecord[],
  options: ScoreOptions<TKey>
): ScoreResult<TKey, TRecord>[] {
  const normalizedByMetric = normalizeMetrics(records, options.metrics)
  const results = records.map((record) => {
    const metrics = options.metrics.map((metric) => {
      const rawValue = record.values[metric.key]
      const normalizedValue = normalizedByMetric.get(metric.key)?.get(record.id) ?? null
      const missing = !isFiniteNumber(rawValue)
      const effectiveValue = normalizedValue ?? metric.missingValue ?? null

      return {
        key: metric.key,
        label: metric.label,
        rawValue,
        normalizedValue,
        effectiveValue,
        weight: metric.weight,
        contribution: 0,
        missing
      }
    })
    const coverage = calculateCoverage(metrics)
    const aggregation = aggregateMetrics(metrics, options.aggregation)

    return {
      record,
      score: aggregation.score,
      rank: 0,
      metrics: metrics.map((metric) => ({
        ...metric,
        contribution: aggregation.contributions.get(metric.key) ?? 0
      })),
      coverage
    }
  })

  return rankResults(results)
}

export function normalizeValues(
  values: readonly ScoreValue[],
  options: NormalizationOptions,
  direction: ScoreDirection = 'higherIsBetter'
): Array<number | null> {
  const normalized = (() => {
    switch (options.method) {
      case 'minMax':
        return normalizeMinMax(values, options)
      case 'percentile':
        return normalizePercentiles(values)
      case 'zScore':
        return normalizeZScores(values, options)
      case 'threshold':
        return normalizeThresholds(values, options)
    }
  })()

  return direction === 'higherIsBetter' ? normalized : normalized.map((value) => (value === null ? null : 1 - value))
}

export function calculateCoverage(metrics: readonly Pick<MetricScore, 'missing' | 'weight'>[]): CoverageSummary {
  const totalMetrics = metrics.length
  const presentMetrics = metrics.filter((metric) => !metric.missing).length
  const totalWeight = metrics.reduce((sum, metric) => sum + positiveWeight(metric.weight), 0)
  const presentWeight = metrics.reduce((sum, metric) => sum + (metric.missing ? 0 : positiveWeight(metric.weight)), 0)

  return {
    presentMetrics,
    totalMetrics,
    presentWeight,
    totalWeight,
    metricCoverage: totalMetrics === 0 ? 1 : presentMetrics / totalMetrics,
    weightCoverage: totalWeight === 0 ? 1 : presentWeight / totalWeight
  }
}

export function extractDrivers<TKey extends string>(
  result: ScoreResult<TKey>,
  options: DriverExtractionOptions = {}
): ScoreDriver<TKey>[] {
  const minContribution = options.minContribution ?? 0
  const drivers = result.metrics
    .filter((metric) => options.includeMissing || !metric.missing)
    .filter((metric) => Math.abs(metric.contribution) >= minContribution)
    .map((metric) => ({
      ...metric,
      shareOfScore: result.score === 0 ? 0 : metric.contribution / result.score
    }))
    .sort((left, right) => Math.abs(right.contribution) - Math.abs(left.contribution))

  return typeof options.limit === 'number' ? drivers.slice(0, options.limit) : drivers
}

export function runSensitivityTrials<TKey extends string, TRecord extends ScoreRecord<TKey>>(
  records: readonly TRecord[],
  options: ScoreOptions<TKey>,
  sensitivity: SensitivityOptions<TKey> = {}
): SensitivitySummary<TKey> {
  const perturbation = sensitivity.perturbation ?? 0.1
  const metricKeys = sensitivity.metricKeys ?? options.metrics.map((metric) => metric.key)
  const baseline = scoreRecords(records, options)
  const baselineTopRecordId = baseline[0]?.record.id ?? null
  const baselineScores = new Map(baseline.map((result) => [result.record.id, result.score]))
  const baselineRanks = new Map(baseline.map((result) => [result.record.id, result.rank]))
  const trials = metricKeys.flatMap((metricKey) =>
    (['increase', 'decrease'] as const).map((direction) => {
      const multiplier = direction === 'increase' ? 1 + perturbation : Math.max(0, 1 - perturbation)
      const metrics = options.metrics.map((metric) => ({
        ...metric,
        weight: metric.key === metricKey ? metric.weight * multiplier : metric.weight
      }))
      const results = scoreRecords(records, { ...options, metrics })
      const weights = Object.fromEntries(metrics.map((metric) => [metric.key, metric.weight])) as Record<TKey, number>
      const topRecordId = results[0]?.record.id ?? null
      const averageScoreDelta =
        results.length === 0
          ? 0
          : results.reduce((sum, result) => sum + Math.abs(result.score - (baselineScores.get(result.record.id) ?? 0)), 0) /
            results.length
      const maxRankDelta = results.reduce((maxDelta, result) => {
        const baselineRank = baselineRanks.get(result.record.id) ?? result.rank
        return Math.max(maxDelta, Math.abs(result.rank - baselineRank))
      }, 0)

      return {
        id: `${String(metricKey)}:${direction}:${perturbation}`,
        metricKey,
        direction,
        weights,
        results,
        topRecordId,
        topChanged: topRecordId !== baselineTopRecordId,
        averageScoreDelta,
        maxRankDelta
      }
    })
  )

  return { baseline, trials }
}

function normalizeMetrics<TKey extends string, TRecord extends ScoreRecord<TKey>>(
  records: readonly TRecord[],
  metrics: readonly ScoreMetricConfig<TKey>[]
): Map<TKey, Map<string, number | null>> {
  return new Map(
    metrics.map((metric) => {
      const values = records.map((record) => record.values[metric.key])
      const normalized = normalizeValues(values, metric.normalization, metric.direction)
      return [metric.key, new Map(records.map((record, index) => [record.id, normalized[index] ?? null]))]
    })
  )
}

function normalizeMinMax(values: readonly ScoreValue[], options: MinMaxNormalizationOptions): Array<number | null> {
  const finiteValues = values.filter(isFiniteNumber)
  const min = options.min ?? Math.min(...finiteValues)
  const max = options.max ?? Math.max(...finiteValues)
  const range = max - min

  return values.map((value) => {
    if (!isFiniteNumber(value)) {
      return null
    }
    if (!Number.isFinite(range) || range === 0) {
      return 0.5
    }
    return clamp01((value - min) / range)
  })
}

function normalizePercentiles(values: readonly ScoreValue[]): Array<number | null> {
  const finiteValues = values.filter(isFiniteNumber).sort((left, right) => left - right)
  if (finiteValues.length === 1) {
    return values.map((value) => (isFiniteNumber(value) ? 0.5 : null))
  }
  const denominator = Math.max(1, finiteValues.length - 1)

  return values.map((value) => {
    if (!isFiniteNumber(value)) {
      return null
    }
    const below = finiteValues.filter((candidate) => candidate < value).length
    const equal = finiteValues.filter((candidate) => candidate === value).length
    return clamp01((below + (equal - 1) / 2) / denominator)
  })
}

function normalizeZScores(values: readonly ScoreValue[], options: ZScoreNormalizationOptions): Array<number | null> {
  const finiteValues = values.filter(isFiniteNumber)
  const mean = options.mean ?? average(finiteValues)
  const standardDeviation = options.standardDeviation ?? sampleStandardDeviation(finiteValues, mean)
  const spread = options.spread ?? 3

  return values.map((value) => {
    if (!isFiniteNumber(value)) {
      return null
    }
    if (!Number.isFinite(standardDeviation) || standardDeviation === 0) {
      return 0.5
    }
    return clamp01(0.5 + (value - mean) / standardDeviation / (spread * 2))
  })
}

function normalizeThresholds(values: readonly ScoreValue[], options: ThresholdNormalizationOptions): Array<number | null> {
  const passDirection = options.passDirection ?? 'above'
  const margin = options.margin ?? 0

  return values.map((value) => {
    if (!isFiniteNumber(value)) {
      return null
    }
    const distance = passDirection === 'above' ? value - options.threshold : options.threshold - value
    if (margin <= 0) {
      return distance >= 0 ? 1 : 0
    }
    return clamp01(0.5 + distance / (margin * 2))
  })
}

function aggregateMetrics<TKey extends string>(
  metrics: readonly MetricScore<TKey>[],
  options: AggregationOptions<TKey>
): { score: number; contributions: Map<TKey, number> } {
  switch (options.method) {
    case 'additive':
      return aggregateAdditive(metrics)
    case 'geometric':
      return aggregateGeometric(metrics, options)
    case 'multiplicativePenalty':
      return aggregateMultiplicativePenalty(metrics, options)
  }
}

function aggregateAdditive<TKey extends string>(
  metrics: readonly MetricScore<TKey>[]
): { score: number; contributions: Map<TKey, number> } {
  const totalWeight = metrics.reduce((sum, metric) => sum + effectiveWeight(metric), 0)
  const contributions = new Map<TKey, number>()

  if (totalWeight === 0) {
    return { score: 0, contributions }
  }

  let score = 0
  for (const metric of metrics) {
    const value = metric.effectiveValue
    const contribution = value === null ? 0 : (positiveWeight(metric.weight) / totalWeight) * value
    contributions.set(metric.key, contribution)
    score += contribution
  }

  return { score: clamp01(score), contributions }
}

function aggregateGeometric<TKey extends string>(
  metrics: readonly MetricScore<TKey>[],
  options: GeometricAggregationOptions
): { score: number; contributions: Map<TKey, number> } {
  const handling = options.nonNegativeHandling ?? 'clamp'
  const epsilon = options.epsilon ?? 0.000001
  const prepared = prepareGeometricMetrics(metrics, handling, epsilon)
  const totalWeight = prepared.reduce((sum, metric) => sum + metric.weight, 0)
  const contributions = new Map<TKey, number>()

  if (totalWeight === 0) {
    return { score: 0, contributions }
  }

  const logScore = prepared.reduce((sum, metric) => sum + (metric.weight / totalWeight) * Math.log(metric.value), 0)
  const score = clamp01(Math.exp(logScore))

  for (const metric of prepared) {
    contributions.set(metric.key, score * (metric.weight / totalWeight))
  }

  return { score, contributions }
}

function aggregateMultiplicativePenalty<TKey extends string>(
  metrics: readonly MetricScore<TKey>[],
  options: MultiplicativePenaltyAggregationOptions<TKey>
): { score: number; contributions: Map<TKey, number> } {
  const base = aggregateAdditive(metrics)
  const penaltyThreshold = options.penaltyThreshold ?? 0.5
  const penaltyStrength = options.penaltyStrength ?? 0.5
  const penaltyKeys = new Set(options.penaltyMetrics ?? metrics.map((metric) => metric.key))
  const penaltyMetrics = metrics.filter((metric) => penaltyKeys.has(metric.key) && metric.effectiveValue !== null)
  const penaltyFactor = penaltyMetrics.reduce((factor, metric) => {
    const value = metric.effectiveValue ?? 0
    if (value >= penaltyThreshold) {
      return factor
    }
    const shortfall = (penaltyThreshold - value) / Math.max(penaltyThreshold, 0.000001)
    return factor * (1 - clamp01(shortfall * penaltyStrength))
  }, 1)
  const score = clamp01(base.score * penaltyFactor)
  const contributions = new Map<TKey, number>()

  for (const [key, contribution] of base.contributions) {
    contributions.set(key, contribution * penaltyFactor)
  }

  return { score, contributions }
}

function prepareGeometricMetrics<TKey extends string>(
  metrics: readonly MetricScore<TKey>[],
  handling: NonNegativeHandling,
  epsilon: number
): Array<{ key: TKey; value: number; weight: number }> {
  const present = metrics.filter((metric) => metric.effectiveValue !== null && positiveWeight(metric.weight) > 0)
  const minimum = present.reduce((min, metric) => Math.min(min, metric.effectiveValue ?? min), Infinity)
  const offset = handling === 'offset' && Number.isFinite(minimum) && minimum <= 0 ? Math.abs(minimum) + epsilon : 0

  return present.flatMap((metric) => {
    const adjusted = (metric.effectiveValue ?? 0) + offset
    if (handling === 'skip' && adjusted < 0) {
      return []
    }
    return [
      {
        key: metric.key,
        value: Math.max(epsilon, handling === 'clamp' ? clamp01(adjusted) : adjusted),
        weight: positiveWeight(metric.weight)
      }
    ]
  })
}

function rankResults<TKey extends string, TRecord extends ScoreRecord<TKey>>(
  results: Array<Omit<ScoreResult<TKey, TRecord>, 'rank'> & { rank: number }>
): ScoreResult<TKey, TRecord>[] {
  const sorted = [...results].sort((left, right) => {
    const scoreDelta = right.score - left.score
    return scoreDelta === 0 ? left.record.id.localeCompare(right.record.id) : scoreDelta
  })

  return sorted.map((result, index) => ({ ...result, rank: index + 1 }))
}

function effectiveWeight(metric: Pick<MetricScore, 'weight' | 'effectiveValue'>): number {
  return metric.effectiveValue === null ? 0 : positiveWeight(metric.weight)
}

function positiveWeight(weight: number): number {
  return Number.isFinite(weight) ? Math.max(0, weight) : 0
}

function isFiniteNumber(value: ScoreValue): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function sampleStandardDeviation(values: readonly number[], mean: number): number {
  if (values.length < 2) {
    return 0
  }
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.min(1, Math.max(0, value))
}
