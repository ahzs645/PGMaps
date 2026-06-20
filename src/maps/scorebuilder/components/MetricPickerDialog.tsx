import { useState } from 'react'
import { Check, FlipHorizontal, Plus, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { SCORE_METRICS_BY_CATEGORY } from '../constants'
import { METRIC_CATEGORY_LABELS } from '../types'
import type { ScoreMetricKey, ScoreMetricWeightMap } from '../types'
import { getDefaultMetricWeight, getWeightIntent } from './scoreBuilderPanelUtils'

export function MetricPickerDialog({
  open,
  onOpenChange,
  weights,
  onPick,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  weights: ScoreMetricWeightMap
  onPick: (metric: ScoreMetricKey) => void
}) {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLowerCase()
  const groupedMetrics = Object.entries(SCORE_METRICS_BY_CATEGORY).map(([category, metrics]) => ({
    category,
    metrics: metrics.filter((metric) => {
      if (!normalizedQuery) return true
      return `${metric.label} ${metric.shortLabel} ${metric.description}`.toLowerCase().includes(normalizedQuery)
    }),
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent elevated className="max-h-[86vh] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>Add Metric</DialogTitle>
          <DialogDescription>Choose one metric to add to the active score equation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto px-6 pb-6">
          <div className="relative pt-1">
            <Search className="pointer-events-none absolute left-3 top-[1.05rem] h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search metrics..."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 pl-9 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          {groupedMetrics.map(({ category, metrics }) => {
            if (!metrics.length) return null
            return (
              <div key={category}>
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] || category}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {metrics.map((metric) => {
                    const active = weights[metric.key] !== 0
                    return (
                      <button
                        key={metric.key}
                        type="button"
                        disabled={active}
                        onClick={() => onPick(metric.key)}
                        className={cn(
                          'rounded-lg border p-3 text-left transition-colors',
                          active
                            ? 'border-border bg-muted/40 text-muted-foreground opacity-70'
                            : 'border-border bg-background hover:border-cyan-400 hover:bg-cyan-50/60 dark:hover:bg-cyan-950/25',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-sm font-semibold text-foreground">{metric.label}</div>
                          {active ? (
                            <Check className="h-4 w-4 shrink-0 text-cyan-600" />
                          ) : (
                            <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                        </div>
                        <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{metric.description}</div>
                        <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
                          <span>{metric.format}</span>
                          <span className="inline-flex items-center gap-1">
                            <FlipHorizontal className="h-3 w-3" />
                            {getWeightIntent(getDefaultMetricWeight(metric.key))}
                          </span>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}
