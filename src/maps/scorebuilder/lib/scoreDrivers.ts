import { SCORE_METRICS } from '../constants'
import type { ScoredBoundaryRegion, ScoreMetricKey, ScoreMetricWeightMap } from '../types'

export interface ScoreDriver {
  key: ScoreMetricKey
  label: string
  intentLabel: string
  scoreDelta: number
}

export function getScoreDrivers(region: ScoredBoundaryRegion, weights: ScoreMetricWeightMap, limit?: number): ScoreDriver[] {
  const drivers = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
    .map((metric) => ({
      key: metric.key,
      label: metric.shortLabel,
      intentLabel: weights[metric.key] < 0 ? `Low ${metric.shortLabel.toLowerCase()}` : metric.shortLabel,
      scoreDelta: region.contributions[metric.key] * 100,
    }))
    .filter((driver) => Math.abs(driver.scoreDelta) >= 0.005)
    .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))

  return typeof limit === 'number' ? drivers.slice(0, limit) : drivers
}

export function formatDriverDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}
