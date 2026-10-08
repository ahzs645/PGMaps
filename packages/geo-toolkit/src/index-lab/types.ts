import type { IndexAggregationMethod, IndexNormalizationMethod } from './scoring.js'

/** Consumer-defined catalog. Keys and category labels have no geographic assumptions. */
export interface IndexLabMetric<TKey extends string = string> {
  key: TKey
  label: string
  shortLabel: string
  description: string
  category: string
  format: string
  defaultWeight?: number
  tone?: string
}

export interface IndexMetricAvailability<TSource extends string = string> {
  message: string
  source?: TSource
}

export interface IndexLabSettings {
  normalization: IndexNormalizationMethod
  aggregation: IndexAggregationMethod
  missingData: 'zero' | 'neutral'
}

export interface IndexLabState<TKey extends string = string, TSettings = IndexLabSettings> {
  weights: Partial<Record<TKey, number>>
  settings: TSettings
  query: string
  selectedResultId: string | null
}

export interface IndexLabRecord<TKey extends string = string> {
  id: string
  label: string
  values: Partial<Record<TKey, number | null>>
  /** Explicit source availability overrides finite-value inference. Zero is a valid measurement. */
  coverage?: Partial<Record<TKey, boolean>>
}

export interface IndexLabResult {
  id: string
  label: string
  score: number
  rank: number
  dataCoverageScore: number
}
