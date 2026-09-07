import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SCORE_METRICS } from '../constants'
import type { ScoreMetricDefinition, ScoreMetricKey, ScoreMetricWeightMap } from '../types'
import { getCategoryTone } from './scoreBuilderPanelUtils'

export function WeightDistribution({
  weights,
  totalAbsoluteWeight,
  metrics = SCORE_METRICS,
}: {
  weights: ScoreMetricWeightMap
  totalAbsoluteWeight: number
  metrics?: ScoreMetricDefinition[]
}) {
  const activeMetrics = metrics.filter((metric) => weights[metric.key] !== 0)

  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {activeMetrics.length === 0 ? (
          <div className="h-full w-full bg-muted-foreground/20" />
        ) : (
          activeMetrics.map((metric) => {
            const value = weights[metric.key]
            const width = totalAbsoluteWeight > 0 ? (Math.abs(value) / totalAbsoluteWeight) * 100 : 0
            return (
              <div
                key={metric.key}
                className={cn('h-full', getCategoryTone(metric.category), value < 0 && 'opacity-60')}
                style={{ width: `${width}%` }}
                title={`${metric.label}: ${value}`}
              />
            )
          })
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{activeMetrics.length} active metrics</span>
        <span>Total influence {totalAbsoluteWeight.toLocaleString()}</span>
      </div>
    </div>
  )
}

export function PriorityMode({
  order,
  weights,
  metrics = SCORE_METRICS,
  onMove,
  onFocus,
  onRemove,
}: {
  order: ScoreMetricKey[]
  weights: ScoreMetricWeightMap
  metrics?: ScoreMetricDefinition[]
  onMove: (metric: ScoreMetricKey, direction: -1 | 1) => void
  onFocus: (metric: ScoreMetricKey) => void
  onRemove: (metric: ScoreMetricKey) => void
}) {
  if (order.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        Add metrics, then rank them from most to least important.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {order.map((metricKey, index) => {
        const metric = metrics.find((entry) => entry.key === metricKey)
        if (!metric) return null
        const value = weights[metricKey]
        const projected = order.length <= 1 ? 70 : Math.round(80 - (index * 55) / (order.length - 1))
        return (
          <div
            key={metricKey}
            onMouseEnter={() => onFocus(metricKey)}
            className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-2"
          >
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{index + 1}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-foreground">{metric.label}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background">
                <div className={cn('h-full', getCategoryTone(metric.category))} style={{ width: `${projected}%` }} />
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {metric.directionLabel} · current {Math.abs(value)} · ranked {projected}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => onMove(metricKey, -1)}
                disabled={index === 0}
                className="rounded border border-input p-1 text-muted-foreground disabled:opacity-35"
                title="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onMove(metricKey, 1)}
                disabled={index === order.length - 1}
                className="rounded border border-input p-1 text-muted-foreground disabled:opacity-35"
                title="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onRemove(metricKey)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              title="Remove metric"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
