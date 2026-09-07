import { AlertTriangle, X } from 'lucide-react'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import type { MetricAvailability } from '../lib/metrics'
import type { ScoreDataSource, ScoreMetricDefinition } from '../types'
import { clampWeight, getCategoryTone } from './scoreBuilderPanelUtils'

/**
 * The one weight editor used everywhere a term can be tuned: the Build view, the
 * phone sheet, and the desktop equation-chip popover. OECD Better Life Index style —
 * a direction toggle plus a 1-100 importance slider with the normalized share readout.
 *
 * Touch targets are 40px on phones and shrink to the compact desktop size at `md`.
 */
export function CompactWeightRow({
  metric,
  value,
  totalAbsoluteWeight,
  unavailable,
  onEnableDataSource,
  onChange,
  onRemove,
  onFocus,
  className,
}: {
  metric: ScoreMetricDefinition
  value: number
  totalAbsoluteWeight: number
  unavailable?: MetricAvailability | null
  onEnableDataSource?: (source: ScoreDataSource) => void
  onChange: (value: number) => void
  onRemove?: () => void
  onFocus?: () => void
  className?: string
}) {
  const clamped = clampWeight(value)
  const magnitude = Math.abs(clamped)
  const positive = clamped > 0
  const share = totalAbsoluteWeight > 0 ? Math.round((magnitude / totalAbsoluteWeight) * 100) : 0

  const applyMagnitude = (nextMagnitude: number) => {
    const next = Math.max(1, Math.min(100, Math.round(nextMagnitude)))
    onChange(positive ? next : -next)
  }

  return (
    <div data-score-builder-weight-row={metric.key} onPointerEnter={onFocus} onFocus={onFocus}>
      {unavailable && (
        <InactiveTermNotice
          metric={metric}
          unavailable={unavailable}
          onEnableDataSource={onEnableDataSource}
          className="mb-1"
        />
      )}
      <div
        className={cn(
          'flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/20 px-2 py-1.5 sm:flex-nowrap',
          unavailable && 'border-dashed opacity-60',
          className,
        )}
      >
        <button
          type="button"
          onClick={() => onChange(-clamped)}
          title={
            positive
              ? 'Counts up — high values raise the score. Click to flip.'
              : 'Counts down — high values lower the score. Click to flip.'
          }
          aria-label={`Flip direction for ${metric.shortLabel}`}
          data-score-builder-flip={metric.key}
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded border text-sm font-bold md:h-6 md:w-6 md:text-xs',
            positive
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300',
          )}
        >
          {positive ? '+' : '−'}
        </button>
        <span className={cn('h-2 w-2 shrink-0 rounded-full', getCategoryTone(metric.category))} aria-hidden="true" />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm font-medium text-foreground sm:w-40 sm:flex-none md:text-xs',
            unavailable && 'text-muted-foreground line-through',
          )}
          title={`${metric.label} — ${share}% of the score`}
        >
          {metric.shortLabel}
          <span className="ml-1.5 font-normal text-muted-foreground">{share}%</span>
        </span>
        <Slider
          min={1}
          max={100}
          step={1}
          value={[magnitude]}
          onValueChange={([next]) => applyMagnitude(next ?? magnitude)}
          aria-label={`${metric.shortLabel} importance`}
          data-score-builder-equation-slider={metric.key}
          className="order-last basis-full py-2 sm:order-none sm:min-w-0 sm:flex-1 sm:basis-0 sm:py-0"
        />
        <input
          type="number"
          min={1}
          max={100}
          step={1}
          value={magnitude}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value)
            if (Number.isFinite(parsed)) applyMagnitude(parsed)
          }}
          aria-label={`${metric.shortLabel} weight`}
          data-score-builder-equation-number={metric.key}
          className="h-10 w-14 shrink-0 rounded border border-input bg-background px-1 text-right text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500 md:h-auto md:w-11 md:py-0.5 md:text-xs"
        />
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove metric"
            aria-label={`Remove ${metric.shortLabel}`}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground md:h-auto md:w-auto md:p-1"
          >
            <X className="h-4 w-4 md:h-3.5 md:w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Explains why a weighted metric is contributing nothing. A switched-off data
 * source is recoverable inline; a boundary mismatch needs a different study area,
 * so that case only states the requirement.
 */
export function InactiveTermNotice({
  metric,
  unavailable,
  onEnableDataSource,
  className,
}: {
  metric: ScoreMetricDefinition
  unavailable: MetricAvailability
  onEnableDataSource?: (source: ScoreDataSource) => void
  className?: string
}) {
  const source = unavailable.source
  return (
    <div
      data-score-builder-inactive-term={metric.key}
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-1.5 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-100',
        className,
      )}
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">{metric.shortLabel}</span> {unavailable.message}
      </span>
      {source && onEnableDataSource && (
        <button
          type="button"
          onClick={() => onEnableDataSource(source)}
          className="shrink-0 rounded border border-amber-400 bg-background px-2 py-0.5 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-950/60"
        >
          Turn on
        </button>
      )}
    </div>
  )
}
