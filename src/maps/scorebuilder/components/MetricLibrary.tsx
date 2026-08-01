import { useMemo, useState, type ReactNode } from 'react'
import { Check, ChevronDown, FlipHorizontal, Lock, Plus, Search, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { BoundarySource } from '@/lib/studyArea'
import { SCORE_METRICS } from '../constants'
import { isMetricAvailableOnBoundary } from '../lib/metrics'
import { METRIC_CATEGORY_LABELS } from '../types'
import type {
  ScoreMetricCategory,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMetricWeightMap,
} from '../types'
import { getDefaultMetricWeight, getWeightIntent } from './scoreBuilderPanelUtils'

/**
 * The single metric catalogue behind every "pick a metric" surface: the Build and
 * Explore left panels and the two add-metric dialogs. Metrics that cannot populate
 * on the active study area are shown but locked, so the reason is visible at the
 * point of choosing rather than discovered later as a silent zero.
 */

export interface MetricLibraryGroup {
  category: string
  metrics: ScoreMetricDefinition[]
}

function groupMetrics(metrics: ScoreMetricDefinition[], query: string): MetricLibraryGroup[] {
  const normalized = query.trim().toLowerCase()
  const byCategory = new Map<string, ScoreMetricDefinition[]>()
  metrics.forEach((metric) => {
    if (normalized && !`${metric.label} ${metric.shortLabel} ${metric.description}`.toLowerCase().includes(normalized)) {
      return
    }
    const existing = byCategory.get(metric.category)
    if (existing) existing.push(metric)
    else byCategory.set(metric.category, [metric])
  })
  // Preserve the declaration order of METRIC_CATEGORY_LABELS so the catalogue reads
  // the same everywhere regardless of which metric list was passed in.
  return (Object.keys(METRIC_CATEGORY_LABELS) as ScoreMetricCategory[])
    .filter((category) => byCategory.has(category))
    .map((category) => ({ category, metrics: byCategory.get(category) ?? [] }))
}

export function useMetricLibraryGroups(metrics: ScoreMetricDefinition[], query: string): MetricLibraryGroup[] {
  return useMemo(() => groupMetrics(metrics, query), [metrics, query])
}

function MetricSearchInput({
  value,
  onChange,
  className,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search metrics..."
        className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
      />
    </div>
  )
}

interface MetricCardProps {
  metric: ScoreMetricDefinition
  active: boolean
  lockedReason: string | null
  onToggle: () => void
  layout: 'row' | 'card'
}

function MetricCard({ metric, active, lockedReason, onToggle, layout }: MetricCardProps) {
  const locked = lockedReason !== null
  return (
    <button
      type="button"
      data-score-builder-metric={metric.key}
      disabled={locked}
      aria-pressed={active}
      title={lockedReason ?? metric.description}
      onClick={() => {
        if (!locked) onToggle()
      }}
      className={cn(
        'w-full rounded-lg border p-3 text-left transition-colors',
        active
          ? 'border-cyan-500/60 bg-cyan-50/70 dark:border-cyan-900/70 dark:bg-cyan-950/30'
          : 'border-border bg-background hover:border-cyan-400 hover:bg-cyan-50/60 dark:hover:bg-cyan-950/25',
        locked && 'cursor-not-allowed border-dashed bg-muted/30 opacity-60 hover:border-dashed hover:bg-muted/30',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn('font-semibold text-foreground', layout === 'card' ? 'text-sm' : 'text-xs')}>
          {metric.label}
        </div>
        {active ? (
          locked ? (
            <Check className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
          ) : (
            <X className="h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-400" />
          )
        ) : locked ? (
          <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
      </div>
      {/* An unavailable metric's own description usually repeats the requirement, so the
          reason replaces it rather than echoing it. */}
      {!locked || active ? (
        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{metric.description}</div>
      ) : null}
      {locked ? (
        <div
          className={cn(
            'mt-2 text-xs font-medium',
            // "Already in the equation" is informational; an unavailable metric is a warning.
            active ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-300',
          )}
        >
          {lockedReason}
        </div>
      ) : (
        <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
          <span>{metric.format}</span>
          <span className="inline-flex items-center gap-1">
            <FlipHorizontal className="h-3 w-3" />
            {getWeightIntent(getDefaultMetricWeight(metric.key))}
          </span>
        </div>
      )}
    </button>
  )
}

interface MetricLibraryRowsProps {
  metrics: ScoreMetricDefinition[]
  weights: ScoreMetricWeightMap
  boundarySource: BoundarySource
  query: string
  layout?: 'row' | 'card'
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  onRemoveMetric?: (metric: ScoreMetricKey) => void
  /** Rendered directly under a category heading — used for the air-quality network filter. */
  renderCategoryExtras?: (category: string) => ReactNode
  /**
   * Collapse categories that hold no active metric. The sidebar panels need this —
   * mounting the full ~75-card catalogue on every load is both a wall of text and a
   * measurable hit to first paint. The dialog is opened deliberately, so it stays open.
   */
  collapsibleCategories?: boolean
}

export function MetricLibraryRows({
  metrics,
  weights,
  boundarySource,
  query,
  layout = 'row',
  onAddMetric,
  onRemoveMetric,
  renderCategoryExtras,
  collapsibleCategories = false,
}: MetricLibraryRowsProps) {
  const groups = useMetricLibraryGroups(metrics, query)
  const [expandedCategories, setExpandedCategories] = useState<string[]>([])
  const searching = query.trim().length > 0

  if (groups.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
        No metrics match "{query}".
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map(({ category, metrics: categoryMetrics }) => {
        const activeCount = categoryMetrics.filter((metric) => (weights[metric.key] ?? 0) !== 0).length
        const open =
          !collapsibleCategories || searching || activeCount > 0 || expandedCategories.includes(category)
        const label = METRIC_CATEGORY_LABELS[category as ScoreMetricCategory] || category
        return (
        <div key={category}>
          {collapsibleCategories ? (
            <button
              type="button"
              onClick={() =>
                setExpandedCategories((current) =>
                  current.includes(category)
                    ? current.filter((entry) => entry !== category)
                    : [...current, category],
                )
              }
              aria-expanded={open}
              className="mb-1.5 flex w-full items-center justify-between gap-2 text-left"
            >
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {label}
                {activeCount > 0 && <span className="ml-1.5 text-cyan-600 dark:text-cyan-400">{activeCount}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {categoryMetrics.length}
                <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
              </span>
            </button>
          ) : (
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
          )}
          {renderCategoryExtras?.(category)}
          {/* Unmounted rather than hidden — the point is to keep them off the first paint. */}
          {open && (
          <div className={cn(layout === 'card' ? 'grid gap-2 sm:grid-cols-2' : 'space-y-1.5')}>
            {categoryMetrics.map((metric) => {
              const active = (weights[metric.key] ?? 0) !== 0
              const available = isMetricAvailableOnBoundary(metric, boundarySource)
              // Add-only surfaces (the dialogs) lock metrics already in the equation
              // rather than silently doing nothing when they are clicked.
              const lockedReason = !available
                ? metric.boundaryRequirementLabel ?? 'Not populated on the current study area.'
                : active && !onRemoveMetric
                  ? 'Already in the equation.'
                  : null
              return (
                <MetricCard
                  key={metric.key}
                  metric={metric}
                  active={active}
                  layout={layout}
                  lockedReason={lockedReason}
                  onToggle={() => {
                    if (active) onRemoveMetric?.(metric.key)
                    else onAddMetric(metric.key, getDefaultMetricWeight(metric.key))
                  }}
                />
              )
            })}
          </div>
          )}
        </div>
        )
      })}
    </div>
  )
}

export function MetricLibraryPanel({
  metrics = SCORE_METRICS,
  weights,
  boundarySource,
  onAddMetric,
  onRemoveMetric,
  renderCategoryExtras,
  className,
  headerAccessory,
}: {
  metrics?: ScoreMetricDefinition[]
  weights: ScoreMetricWeightMap
  boundarySource: BoundarySource
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  onRemoveMetric: (metric: ScoreMetricKey) => void
  renderCategoryExtras?: (category: string) => ReactNode
  className?: string
  headerAccessory?: ReactNode
}) {
  const [query, setQuery] = useState('')
  const activeCount = metrics.filter((metric) => (weights[metric.key] ?? 0) !== 0).length

  return (
    <aside className={cn('bg-background', className)} data-score-builder-metric-library="true">
      <div className="sticky top-0 z-10 border-b border-border bg-background p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Metric library</div>
          <div className="flex items-center gap-1.5">
            {headerAccessory}
            <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {activeCount} in use
            </span>
          </div>
        </div>
        <MetricSearchInput value={query} onChange={setQuery} />
      </div>

      <div className="p-3">
        <MetricLibraryRows
          metrics={metrics}
          weights={weights}
          boundarySource={boundarySource}
          query={query}
          collapsibleCategories
          onAddMetric={onAddMetric}
          onRemoveMetric={onRemoveMetric}
          renderCategoryExtras={renderCategoryExtras}
        />
      </div>
    </aside>
  )
}

export function MetricPickerDialog({
  open,
  onOpenChange,
  metrics = SCORE_METRICS,
  weights,
  boundarySource,
  onPick,
  title = 'Add Metric',
  description = 'Choose one metric to add to the active score equation.',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  metrics?: ScoreMetricDefinition[]
  weights: ScoreMetricWeightMap
  boundarySource: BoundarySource
  onPick: (metric: ScoreMetricKey) => void
  title?: string
  description?: string
}) {
  const [query, setQuery] = useState('')

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) setQuery('')
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent elevated className="max-h-[86vh] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto px-6 pb-6 pt-4">
          <MetricSearchInput value={query} onChange={setQuery} className="[&_input]:h-10 [&_input]:text-sm" />
          <MetricLibraryRows
            metrics={metrics}
            weights={weights}
            boundarySource={boundarySource}
            query={query}
            layout="card"
            onAddMetric={(metric) => {
              onPick(metric)
              handleOpenChange(false)
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
