import { SCORE_METRICS } from '../constants'
import type { ScoredBoundaryRegion, ScoreMetricKey, ScoreMetricRangeMap } from '../types'
import { formatMetricValue } from '../lib/metrics'

export function NormalizationPreview({
  metricKey,
  regions,
  metricRanges,
}: {
  metricKey: ScoreMetricKey | null
  regions: ScoredBoundaryRegion[]
  metricRanges: ScoreMetricRangeMap
}) {
  if (!metricKey) {
    return (
      <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        Select a metric to inspect normalization.
      </div>
    )
  }

  const metric = SCORE_METRICS.find((entry) => entry.key === metricKey)
  const range = metricRanges[metricKey]
  const values = regions.map((region) => region.metrics[metricKey]).filter((value) => Number.isFinite(value))
  const buckets = new Array(8).fill(0)
  values.forEach((value) => {
    const denominator = range.max - range.min
    const normalized = denominator > 0 ? (value - range.min) / denominator : 0.5
    const index = Math.max(0, Math.min(buckets.length - 1, Math.floor(normalized * buckets.length)))
    buckets[index] += 1
  })
  const maxBucket = Math.max(...buckets, 1)

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Normalization</div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">{metric?.label || metricKey}</div>
        </div>
        <div className="text-right font-mono text-xs text-muted-foreground">
          <div>{formatMetricValue(metricKey, range.min, true)}</div>
          <div>{formatMetricValue(metricKey, range.max, true)}</div>
        </div>
      </div>
      <div className="flex h-10 items-end gap-1">
        {buckets.map((bucket, index) => (
          <div
            key={`${metricKey}-${index}`}
            className="flex-1 rounded-t bg-cyan-500/70"
            style={{
              height: `${Math.max(8, (bucket / maxBucket) * 100)}%`,
              opacity: 0.35 + (bucket / maxBucket) * 0.55,
            }}
            title={`${bucket} regions`}
          />
        ))}
      </div>
      <div className="mt-2 h-2 rounded-full bg-gradient-to-r from-rose-600 via-amber-100 to-emerald-700" />
      <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>0</span>
        <span>normalized score</span>
        <span>100</span>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Raw values are scaled against the current region set before weights are applied.
      </div>
    </div>
  )
}
