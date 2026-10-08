import { useMemo, useState, type ReactNode } from 'react'
import { Check, FlipHorizontal, Lock, Plus, X } from 'lucide-react'
import { Badge } from '../ui/badge.js'
import { PanelDialog } from '../ui/dialog-shell.js'
import { CollapsibleSection, SearchInput } from '../ui/map-panels.js'
import { EmptyHint } from '../ui/result-list.js'
import { cn } from '../utils.js'
import type { IndexLabMetric } from './types.js'
import { getWeightIntent } from './state.js'

/**
 * The single metric catalogue behind every "pick a metric" surface: the Build and
 * Explore left panels and the two add-metric dialogs. Metrics that cannot populate
 * on the active study area are shown but locked, so the reason is visible at the
 * point of choosing rather than discovered later as a silent zero.
 */

export interface MetricLibraryGroup<TKey extends string = string> {
  category: string
  metrics: IndexLabMetric<TKey>[]
}

export function groupMetrics<TKey extends string>(
  metrics: IndexLabMetric<TKey>[],
  query: string,
  categoryOrder?: readonly string[],
): MetricLibraryGroup<TKey>[] {
  const normalized = query.trim().toLowerCase()
  const byCategory = new Map<string, IndexLabMetric<TKey>[]>()
  metrics.forEach((metric) => {
    if (
      normalized &&
      !`${metric.label} ${metric.shortLabel} ${metric.description}`.toLowerCase().includes(normalized)
    ) {
      return
    }
    const existing = byCategory.get(metric.category)
    if (existing) existing.push(metric)
    else byCategory.set(metric.category, [metric])
  })
  const order = categoryOrder
    ? [...categoryOrder, ...byCategory.keys()].filter((category, index, all) => all.indexOf(category) === index)
    : [...byCategory.keys()]
  return order
    .filter((category) => byCategory.has(category))
    .map((category) => ({ category, metrics: byCategory.get(category) ?? [] }))
}

export function useMetricLibraryGroups<TKey extends string>(
  metrics: IndexLabMetric<TKey>[],
  query: string,
  categoryOrder?: readonly string[],
): MetricLibraryGroup<TKey>[] {
  return useMemo(() => groupMetrics(metrics, query, categoryOrder), [metrics, query, categoryOrder])
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
    <SearchInput
      icon
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onClear={() => onChange('')}
      placeholder="Search metrics..."
      aria-label="Search metrics"
      className={cn('focus:ring-cyan-500', className)}
    />
  )
}

interface MetricCardProps {
  metric: IndexLabMetric
  active: boolean
  lockedReason: string | null
  onToggle: () => void
  layout: 'row' | 'card'
  defaultWeight: number
}

function MetricCard({ metric, active, lockedReason, onToggle, layout, defaultWeight }: MetricCardProps) {
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
            {getWeightIntent(defaultWeight)}
          </span>
        </div>
      )}
    </button>
  )
}

export interface MetricLibraryOptions<TKey extends string> {
  categoryLabels?: Readonly<Record<string, string>>
  categoryOrder?: readonly string[]
  getDefaultWeight?: (key: TKey) => number
  getUnavailableReason?: (metric: IndexLabMetric<TKey>) => string | null
}

export interface MetricLibraryRowsProps<TKey extends string> extends MetricLibraryOptions<TKey> {
  metrics: IndexLabMetric<TKey>[]
  weights: Partial<Record<TKey, number>>
  query: string
  layout?: 'row' | 'card'
  onAddMetric: (metric: TKey, value: number) => void
  onRemoveMetric?: (metric: TKey) => void
  /** Rendered directly under a category heading — used for the air-quality network filter. */
  renderCategoryExtras?: (category: string) => ReactNode
  /**
   * Collapse categories that hold no active metric. The sidebar panels need this —
   * mounting the full ~75-card catalogue on every load is both a wall of text and a
   * measurable hit to first paint. The dialog is opened deliberately, so it stays open.
   */
  collapsibleCategories?: boolean
}

export function MetricLibraryRows<TKey extends string>({
  metrics,
  weights,
  query,
  layout = 'row',
  onAddMetric,
  onRemoveMetric,
  renderCategoryExtras,
  collapsibleCategories = false,
  categoryLabels = {},
  categoryOrder,
  getDefaultWeight,
  getUnavailableReason,
}: MetricLibraryRowsProps<TKey>) {
  const groups = useMetricLibraryGroups(metrics, query, categoryOrder)
  const [expandedCategories, setExpandedCategories] = useState<string[]>([])
  const searching = query.trim().length > 0

  if (groups.length === 0) {
    return <EmptyHint>No metrics match "{query}".</EmptyHint>
  }

  return (
    <div className="space-y-4">
      {groups.map(({ category, metrics: categoryMetrics }) => {
        const activeCount = categoryMetrics.filter((metric) => (weights[metric.key] ?? 0) !== 0).length
        const open = !collapsibleCategories || searching || activeCount > 0 || expandedCategories.includes(category)
        const label = categoryLabels[category] || category
        const toggleCategory = () =>
          setExpandedCategories((current) =>
            current.includes(category) ? current.filter((entry) => entry !== category) : [...current, category],
          )
        // Unmounted rather than hidden — the point is to keep them off the first paint.
        const cards = open && (
          <div className={cn(layout === 'card' ? 'grid gap-2 workspace-sm:grid-cols-2' : 'space-y-1.5')}>
            {categoryMetrics.map((metric) => {
              const active = (weights[metric.key] ?? 0) !== 0
              // Add-only surfaces (the dialogs) lock metrics already in the equation
              // rather than silently doing nothing when they are clicked.
              const lockedReason =
                getUnavailableReason?.(metric) ?? (active && !onRemoveMetric ? 'Already in the equation.' : null)
              return (
                <MetricCard
                  key={metric.key}
                  metric={metric}
                  active={active}
                  layout={layout}
                  lockedReason={lockedReason}
                  defaultWeight={getDefaultWeight?.(metric.key) ?? metric.defaultWeight ?? 35}
                  onToggle={() => {
                    if (active) onRemoveMetric?.(metric.key)
                    else onAddMetric(metric.key, getDefaultWeight?.(metric.key) ?? metric.defaultWeight ?? 35)
                  }}
                />
              )
            })}
          </div>
        )
        if (collapsibleCategories) {
          return (
            // Pulled out by the row's padding so the heading lines up with the cards.
            <CollapsibleSection
              key={category}
              open={open}
              onOpenChange={toggleCategory}
              className="-mx-3 border-b-0 bg-transparent"
              contentClassName="px-3"
              label={
                <span className="font-semibold uppercase tracking-wider text-muted-foreground">
                  {label}
                  {activeCount > 0 && <span className="ml-1.5 text-cyan-600 dark:text-cyan-400">{activeCount}</span>}
                </span>
              }
              summary={<span className="block text-right">{categoryMetrics.length}</span>}
            >
              {renderCategoryExtras?.(category)}
              {cards}
            </CollapsibleSection>
          )
        }
        return (
          <div key={category}>
            <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
            {renderCategoryExtras?.(category)}
            {cards}
          </div>
        )
      })}
    </div>
  )
}

export function MetricLibraryPanel<TKey extends string>({
  metrics,
  weights,
  onAddMetric,
  onRemoveMetric,
  renderCategoryExtras,
  className,
  headerAccessory,
  categoryLabels,
  categoryOrder,
  getDefaultWeight,
  getUnavailableReason,
}: MetricLibraryOptions<TKey> & {
  metrics: IndexLabMetric<TKey>[]
  weights: Partial<Record<TKey, number>>
  onAddMetric: (metric: TKey, value: number) => void
  onRemoveMetric: (metric: TKey) => void
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
            <Badge size="sm">{activeCount} in use</Badge>
          </div>
        </div>
        <MetricSearchInput value={query} onChange={setQuery} className="h-8 py-1 workspace-desktop:text-xs" />
      </div>

      <div className="p-3">
        <MetricLibraryRows
          metrics={metrics}
          weights={weights}
          query={query}
          categoryLabels={categoryLabels}
          categoryOrder={categoryOrder}
          getDefaultWeight={getDefaultWeight}
          getUnavailableReason={getUnavailableReason}
          collapsibleCategories
          onAddMetric={onAddMetric}
          onRemoveMetric={onRemoveMetric}
          renderCategoryExtras={renderCategoryExtras}
        />
      </div>
    </aside>
  )
}

export function MetricPickerDialog<TKey extends string>({
  open,
  onOpenChange,
  metrics,
  weights,
  onPick,
  title = 'Add Metric',
  description = 'Choose one metric to add to the active score equation.',
  categoryLabels,
  categoryOrder,
  getDefaultWeight,
  getUnavailableReason,
}: MetricLibraryOptions<TKey> & {
  open: boolean
  onOpenChange: (open: boolean) => void
  metrics: IndexLabMetric<TKey>[]
  weights: Partial<Record<TKey, number>>
  onPick: (metric: TKey) => void
  title?: string
  description?: string
}) {
  const [query, setQuery] = useState('')

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen)
    if (!nextOpen) setQuery('')
  }

  return (
    <PanelDialog
      open={open}
      onOpenChange={handleOpenChange}
      title={title}
      subtitle={description}
      size="md"
      className="workspace-sm:max-h-[86vh]"
      bodyClassName="pb-[calc(env(safe-area-inset-bottom)+1.5rem)] workspace-sm:pb-6"
      toolbar={<MetricSearchInput value={query} onChange={setQuery} />}
    >
      <MetricLibraryRows
        metrics={metrics}
        weights={weights}
        query={query}
        categoryLabels={categoryLabels}
        categoryOrder={categoryOrder}
        getDefaultWeight={getDefaultWeight}
        getUnavailableReason={getUnavailableReason}
        layout="card"
        onAddMetric={(metric) => {
          onPick(metric)
          handleOpenChange(false)
        }}
      />
    </PanelDialog>
  )
}
