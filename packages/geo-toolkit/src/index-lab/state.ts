import type { IndexLabMetric, IndexLabRecord, IndexLabResult, IndexLabSettings, IndexLabState } from './types.js'
import { buildMetricRanges, buildMetricValueLists, calculateIndexRows } from './scoring.js'

export const DEFAULT_INDEX_LAB_SETTINGS: IndexLabSettings = {
  normalization: 'percentile',
  aggregation: 'additive',
  missingData: 'neutral',
}

export function clampWeight(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)))
}

export function getWeightIntent(value: number): string {
  return value === 0 ? 'Disabled' : value > 0 ? 'Prefer high' : 'Prefer low'
}

/** Immutable update without policy changes; consumers decide valid ranges and source activation. */
export function setMetricWeight<TKey extends string, TWeights extends Partial<Record<TKey, number>>>(
  weights: TWeights,
  key: TKey,
  value: number,
): TWeights {
  if (!Number.isFinite(value)) return weights
  return { ...weights, [key]: value }
}

export type IndexLabAction<TKey extends string, TSettings> =
  | { type: 'setWeight'; key: TKey; value: number }
  | { type: 'setSettings'; settings: TSettings }
  | { type: 'setQuery'; query: string }
  | { type: 'selectResult'; id: string | null }
  | { type: 'replaceState'; state: IndexLabState<TKey, TSettings> }

export function indexLabReducer<TKey extends string, TSettings>(
  state: IndexLabState<TKey, TSettings>,
  action: IndexLabAction<TKey, TSettings>,
): IndexLabState<TKey, TSettings> {
  switch (action.type) {
    case 'setWeight':
      return { ...state, weights: setMetricWeight(state.weights, action.key, action.value) }
    case 'setSettings':
      return { ...state, settings: action.settings }
    case 'setQuery':
      return { ...state, query: action.query }
    case 'selectResult':
      return { ...state, selectedResultId: action.id }
    case 'replaceState':
      return action.state
  }
}

export function createIndexLabState<TKey extends string, TSettings = IndexLabSettings>({
  metrics,
  weights = {},
  settings,
}: {
  metrics: readonly IndexLabMetric<TKey>[]
  weights?: Partial<Record<TKey, number>>
  settings: TSettings
}): IndexLabState<TKey, TSettings> {
  return {
    weights: Object.fromEntries(
      metrics.map((metric) => [metric.key, Number.isFinite(weights[metric.key]) ? weights[metric.key] : 0]),
    ) as Partial<Record<TKey, number>>,
    settings,
    query: '',
    selectedResultId: null,
  }
}

/** Default standard model. A controller compute adapter can retain an application's domain algorithms. */
export function computeIndexLabResults<TKey extends string>(
  records: readonly IndexLabRecord<TKey>[],
  metrics: readonly IndexLabMetric<TKey>[],
  state: IndexLabState<TKey>,
): IndexLabResult[] {
  const metricKeys = metrics.map((metric) => metric.key)
  const rows = records.map((record) => ({
    record,
    values: Object.fromEntries(metricKeys.map((key) => [key, record.values[key] ?? Number.NaN])) as Record<
      TKey,
      number
    >,
  }))
  const getValues = (row: (typeof rows)[number]) => row.values
  const calculations = calculateIndexRows({
    rows,
    metricKeys,
    getValues,
    weights: state.weights,
    ...state.settings,
    metricRanges: buildMetricRanges(rows, metricKeys, getValues),
    metricValueLists: buildMetricValueLists(rows, metricKeys, getValues),
    hasCoverage: (row, key) => row.record.coverage?.[key] ?? Number.isFinite(row.values[key]),
  })
  return calculations
    .map(({ row, score, dataCoverageScore }) => ({
      id: row.record.id,
      label: row.record.label,
      score,
      dataCoverageScore,
      rank: 0,
    }))
    .sort((left, right) => right.score - left.score || left.label.localeCompare(right.label))
    .map((result, index) => ({ ...result, rank: index + 1 }))
}
