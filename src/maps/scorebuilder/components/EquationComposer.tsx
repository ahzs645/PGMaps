import { ArrowDown, ArrowUp, GripVertical, X } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { SCORE_METRICS } from '../constants'
import type { ScoreMetricDefinition, ScoreMetricKey, ScoreMetricWeightMap } from '../types'
import { clampWeight, getCategoryTone, getDefaultMetricWeight, getWeightIntent } from './scoreBuilderPanelUtils'

export function EquationComposer({
  activeTerms,
  weights,
  totalAbsoluteWeight,
  focusedMetric,
  onFocus,
  onWeightChange,
}: {
  activeTerms: ScoreMetricDefinition[]
  weights: ScoreMetricWeightMap
  totalAbsoluteWeight: number
  focusedMetric: ScoreMetricKey | null
  onFocus: (metric: ScoreMetricKey) => void
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
}) {
  return (
    <div className="mt-3" data-score-builder-equation-composer="true">
      <div className="mb-2 flex justify-end">
        <span className="rounded bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          {activeTerms.length} term{activeTerms.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3">
        <div className="pt-11 font-mono text-sm font-bold text-foreground">
          Score <span className="text-muted-foreground">=</span>
        </div>
        <div className="space-y-2">
          {activeTerms.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No active terms. Add a metric or apply a preset.
            </div>
          )}
          {activeTerms.map((metric, index) => (
            <div key={metric.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2">
              <div className="pt-11 text-center font-mono text-lg font-semibold text-muted-foreground">
                {index > 0 ? '+' : ''}
              </div>
              <ScoreEquationTerm
                metric={metric}
                value={weights[metric.key]}
                totalAbsoluteWeight={totalAbsoluteWeight}
                active={focusedMetric === metric.key}
                onFocus={() => onFocus(metric.key)}
                onChange={(value) => onWeightChange(metric.key, value)}
                onRemove={() => onWeightChange(metric.key, 0)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ScoreEquationTerm({
  metric,
  value,
  totalAbsoluteWeight,
  active,
  onFocus,
  onChange,
  onRemove,
}: {
  metric: ScoreMetricDefinition
  value: number
  totalAbsoluteWeight: number
  active: boolean
  onFocus: () => void
  onChange: (value: number) => void
  onRemove: () => void
}) {
  const share = totalAbsoluteWeight > 0 ? Math.round((Math.abs(value) / totalAbsoluteWeight) * 100) : 0
  const positive = value > 0

  return (
    <div
      className={cn(
        'rounded-lg border bg-muted/20 p-2 transition-colors',
        active ? 'border-cyan-500 bg-cyan-50/60 dark:bg-cyan-950/25' : 'border-border',
      )}
      onMouseEnter={onFocus}
      onFocus={onFocus}
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(clampWeight(value === 0 ? getDefaultMetricWeight(metric.key) : -value))}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded border text-xs font-bold',
            positive
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300',
          )}
          title="Flip direction"
        >
          {positive ? '+' : '-'}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground">{metric.shortLabel}</div>
          <div className="text-xs text-muted-foreground">{share}% of weight</div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          title="Remove metric"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <SignedWeightSlider metricKey={metric.key} value={value} onChange={onChange} />
    </div>
  )
}

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

function SignedWeightSlider({
  metricKey,
  value,
  onChange,
}: {
  metricKey: ScoreMetricKey
  value: number
  onChange: (value: number) => void
}) {
  const clamped = clampWeight(value)
  const percent = ((clamped + 100) / 200) * 100
  const fillStart = clamped < 0 ? percent : 50
  const fillEnd = clamped < 0 ? 50 : percent
  const fillColor = clamped < 0 ? 'rgb(225 29 72)' : 'rgb(5 150 105)'

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>Low</span>
        <span>{getWeightIntent(clamped)}</span>
        <span>High</span>
      </div>
      <div className="relative h-6">
        <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
          style={{
            left: `${Math.min(fillStart, fillEnd)}%`,
            right: `${100 - Math.max(fillStart, fillEnd)}%`,
            background: fillColor,
          }}
        />
        <div className="absolute left-1/2 top-0 h-6 w-px bg-border" />
        <Slider
          data-score-builder-equation-slider={metricKey}
          min={-100}
          max={100}
          step={1}
          value={[clamped]}
          aria-valuetext={`${getWeightIntent(clamped)} ${Math.abs(clamped)}`}
          onValueChange={([value]) => {
            const next = clampWeight(value)
            onChange(next === 0 ? (clamped < 0 ? -1 : 1) : next)
          }}
          className="absolute inset-0 h-6 w-full opacity-0"
        />
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background shadow"
          style={{ left: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>-100</span>
        <input
          type="number"
          data-score-builder-equation-number={metricKey}
          min={-100}
          max={100}
          step={1}
          value={clamped}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value)
            if (Number.isFinite(parsed)) onChange(clampWeight(parsed))
          }}
          className="w-14 rounded border border-input bg-background px-1 py-0.5 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <span>100</span>
      </div>
    </div>
  )
}
