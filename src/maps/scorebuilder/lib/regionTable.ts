import { numberColumn, textColumn } from '@/components/map/tableColumns'
import type { ScoredBoundaryRegion, ScoreMetricDefinition, ScoreMetricKey, ScoreMetricWeightMap } from '../types'
import { formatMetricValue } from './metrics'

/** A heavy recipe can weight dozens of metrics; the rest wait in the column picker. */
const MAX_SHOWN_METRICS = 7

function metricColumn(metric: ScoreMetricDefinition, shown: boolean) {
  return numberColumn<ScoredBoundaryRegion>(
    `metric:${metric.key}`,
    metric.shortLabel || metric.label,
    (entry) => entry.metrics[metric.key],
    { format: (value) => formatMetricValue(metric.key, value, true), defaultHidden: !shown, width: 150 },
  )
}

/** Rank, name and score, then the metrics in the equation. */
export function indexLabColumns(metrics: readonly ScoreMetricDefinition[], weights: ScoreMetricWeightMap) {
  return [
    numberColumn<ScoredBoundaryRegion>('rank', 'Rank', (entry) => entry.rank, { format: String, width: 80 }),
    textColumn<ScoredBoundaryRegion>('name', 'Name', (entry) => entry.region.name, { width: 240 }),
    numberColumn<ScoredBoundaryRegion>('score', 'Score', (entry) => entry.score, {
      format: (value) => value.toFixed(1),
      width: 90,
    }),
    textColumn<ScoredBoundaryRegion>('code', 'Code', (entry) => entry.region.code, { width: 120, defaultHidden: true }),
    ...metrics
      .filter((metric) => (weights[metric.key] ?? 0) !== 0)
      .map((metric, index) => metricColumn(metric, index < MAX_SHOWN_METRICS)),
  ]
}

/** A lens lab paints metrics rather than a score, so its table shows those. */
export function lensLabColumns(metrics: readonly ScoreMetricDefinition[], lensMetrics: readonly ScoreMetricKey[]) {
  return [
    textColumn<ScoredBoundaryRegion>('name', 'Name', (entry) => entry.region.name, { width: 240 }),
    textColumn<ScoredBoundaryRegion>('code', 'Code', (entry) => entry.region.code, { width: 120 }),
    ...lensMetrics.flatMap((key) => {
      const metric = metrics.find((candidate) => candidate.key === key)
      return metric ? [metricColumn(metric, true)] : []
    }),
  ]
}
