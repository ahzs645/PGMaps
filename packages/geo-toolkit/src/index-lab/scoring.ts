/** Index Lab's historical scoring policy, independent of catalogs, React, and map styling.
 * This policy intentionally remains separate from calculations/scoring: percentile
 * endpoints and missing-data behavior differ between the two existing engines.
 */
export type IndexNormalizationMethod = 'minMax' | 'percentile' | 'winsorizedMinMax' | 'zScore'
export type IndexAggregationMethod = 'additive' | 'geometric'
export interface IndexMetricRange {
  min: number
  max: number
}
export type IndexMetricValues<TKey extends string> = Record<TKey, number>
export type IndexMetricRanges<TKey extends string> = Record<TKey, IndexMetricRange>
export type IndexMetricValueLists<TKey extends string> = Record<TKey, readonly number[]>
export type IndexMetricWeights<TKey extends string> = Partial<Record<TKey, number>>

export function normalizeMetric(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

export function normalizeWithMethod(
  value: number,
  values: readonly number[],
  range: { min: number; max: number },
  method: IndexNormalizationMethod,
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

export function buildMetricRanges<TKey extends string, TRow>(
  rows: readonly TRow[],
  metricKeys: readonly TKey[],
  getValues: (row: TRow) => IndexMetricValues<TKey>,
): IndexMetricRanges<TKey> {
  return metricKeys.reduce((accumulator, key) => {
    const values = rows.map((row) => getValues(row)[key]).filter((value) => Number.isFinite(value))
    const min = values.length ? Math.min(...values) : 0
    const max = values.length ? Math.max(...values) : 1
    return { ...accumulator, [key]: { min, max } }
  }, {} as IndexMetricRanges<TKey>)
}

export function buildMetricValueLists<TKey extends string, TRow>(
  rows: readonly TRow[],
  metricKeys: readonly TKey[],
  getValues: (row: TRow) => IndexMetricValues<TKey>,
): Record<TKey, number[]> {
  return metricKeys.reduce(
    (accumulator, key) => {
      accumulator[key] = rows
        .map((row) => getValues(row)[key])
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b)
      return accumulator
    },
    {} as Record<TKey, number[]>,
  )
}

/** Zero-filled values cannot establish coverage: consumers must supply source availability. */
export function findMeasurableMetricKeys<TKey extends string, TRow>(
  rows: readonly TRow[],
  weights: IndexMetricWeights<TKey>,
  metricKeys: readonly TKey[],
  hasCoverage: (row: TRow, key: TKey) => boolean,
): Set<TKey> {
  const measurable = new Set<TKey>()
  metricKeys.forEach((key) => {
    if ((weights[key] ?? 0) === 0) return
    if (rows.some((row) => hasCoverage(row, key))) measurable.add(key)
  })
  return measurable
}

/** Share of active, measurable metrics with data (counts metrics, not their weight magnitudes). */
export function computeDataCoverageScore<TKey extends string>(
  weights: IndexMetricWeights<TKey>,
  metricKeys: readonly TKey[],
  hasCoverage: (key: TKey) => boolean,
  measurableKeys?: ReadonlySet<TKey>,
): number {
  const active = metricKeys.filter((key) => (weights[key] ?? 0) !== 0 && (!measurableKeys || measurableKeys.has(key)))
  if (!active.length) return 1
  return active.filter((key) => hasCoverage(key)).length / active.length
}

export interface IndexRowCalculation<TKey extends string, TRow> {
  row: TRow
  normalizedMetrics: IndexMetricValues<TKey>
  contributions: IndexMetricValues<TKey>
  score: number
  dataCoverageScore: number
}

export interface IndexAggregationContext<TKey extends string, TRow> {
  row: TRow
  normalizedMetrics: IndexMetricValues<TKey>
  contributions: IndexMetricValues<TKey>
  totalWeight: number
  additiveValue: number
  geometricValue: number
}

export interface IndexCalculationOptions<TKey extends string, TRow> {
  rows: readonly TRow[]
  metricKeys: readonly TKey[]
  getValues: (row: TRow) => IndexMetricValues<TKey>
  weights: IndexMetricWeights<TKey>
  normalization: IndexNormalizationMethod
  missingData: 'zero' | 'neutral'
  aggregation: IndexAggregationMethod
  metricRanges: IndexMetricRanges<TKey>
  metricValueLists: IndexMetricValueLists<TKey>
  hasCoverage: (row: TRow, key: TKey) => boolean
  /** Optional domain formula. Return a value on the existing 0..1 aggregate scale. */
  aggregate?: (context: IndexAggregationContext<TKey, TRow>) => number
}

/** Compute per-row metrics and scores. Presentation, tie-breaking, and rank policy belong to the consumer. */
export function calculateIndexRows<TKey extends string, TRow>({
  rows,
  metricKeys,
  getValues,
  weights,
  normalization,
  missingData,
  aggregation,
  metricRanges,
  metricValueLists,
  hasCoverage,
  aggregate,
}: IndexCalculationOptions<TKey, TRow>): IndexRowCalculation<TKey, TRow>[] {
  for (const key of metricKeys) {
    if (!Number.isFinite(weights[key] ?? 0)) throw new Error(`Index metric weight "${key}" must be finite.`)
  }
  const totalWeight = metricKeys.reduce((sum, key) => sum + Math.abs(weights[key] ?? 0), 0)
  const measurableKeys = findMeasurableMetricKeys(rows, weights, metricKeys, hasCoverage)
  return rows.map((row) => {
    const normalizedMetrics = {} as IndexMetricValues<TKey>
    const contributions = {} as IndexMetricValues<TKey>
    let rawScore = 0
    let rawProduct = 1
    const values = getValues(row)
    metricKeys.forEach((key) => {
      const normalizedValue =
        missingData === 'neutral' && !hasCoverage(row, key)
          ? 0.5
          : normalizeWithMethod(values[key], metricValueLists[key] ?? [], metricRanges[key], normalization)
      const weight = weights[key] ?? 0
      const directionalValue = weight >= 0 ? normalizedValue : 1 - normalizedValue
      normalizedMetrics[key] = normalizedValue
      contributions[key] = totalWeight > 0 ? (Math.abs(weight) * directionalValue) / totalWeight : 0
      rawScore += contributions[key]
      if (weight !== 0 && totalWeight > 0) {
        rawProduct *= Math.max(0.01, directionalValue) ** (Math.abs(weight) / totalWeight)
      }
    })
    const aggregateValue = aggregate
      ? aggregate({
          row,
          normalizedMetrics,
          contributions,
          totalWeight,
          additiveValue: rawScore,
          geometricValue: rawProduct,
        })
      : aggregation === 'geometric' && totalWeight > 0
        ? rawProduct
        : rawScore
    return {
      row,
      normalizedMetrics,
      contributions,
      score: totalWeight > 0 ? clampScore(aggregateValue * 100) : 50,
      dataCoverageScore: computeDataCoverageScore(weights, metricKeys, (key) => hasCoverage(row, key), measurableKeys),
    }
  })
}
