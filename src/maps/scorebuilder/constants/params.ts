import type { ScoreMetricWeightMap } from '../types'
import { SCORE_METRICS } from './metrics'
import { createMetricValueMap } from './weights'

export function encodeWeightsToParams(weights: ScoreMetricWeightMap): string {
  return SCORE_METRICS.map((m) => weights[m.key]).join(',')
}

export function decodeWeightsFromParams(param: string): ScoreMetricWeightMap | null {
  const parts = param.split(',').map(Number)
  if (parts.length > SCORE_METRICS.length || parts.some((v) => !Number.isFinite(v))) return null
  const weights = createMetricValueMap(0) as ScoreMetricWeightMap
  SCORE_METRICS.forEach((m, i) => {
    weights[m.key] = Math.max(-100, Math.min(100, Math.round(parts[i] ?? 0)))
  })
  return weights
}
