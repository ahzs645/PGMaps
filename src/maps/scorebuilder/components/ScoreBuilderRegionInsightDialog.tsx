import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { SCORE_METRICS } from '../constants'
import type {
  ScoredBoundaryRegion,
  ScoreMetricKey,
  ScoreMetricWeightMap
} from '../types'
import { METRIC_CATEGORY_LABELS } from '../types'

interface ScoreBuilderRegionInsightDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  region: ScoredBoundaryRegion | null
  weights: ScoreMetricWeightMap
  isMobile: boolean
}

const MOBILE_MAX_CONTRIBUTIONS = 4

function getMetricLabel(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.label || key
}

function getMetricFormat(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.format || 'count'
}

function formatMetricValue(metric: ScoreMetricKey, value: number, compact = false): string {
  const format = getMetricFormat(metric)
  if (metric === 'foodRiskScore') {
    const riskScore = value * 100
    return compact ? `${riskScore.toFixed(0)}/100 risk` : `${riskScore.toFixed(1)} / 100 risk index`
  }
  if (metric === 'crimePerCapita') {
    const perThousand = value * 1_000
    return compact
      ? `${perThousand.toLocaleString(undefined, { maximumFractionDigits: 1 })}/1k residents`
      : `${perThousand.toLocaleString(undefined, { maximumFractionDigits: 2 })} incidents / 1,000 residents`
  }
  if (format === 'density') {
    const scaled = value * 1_000
    return compact
      ? `${scaled.toLocaleString(undefined, { maximumFractionDigits: 1 })}/1k km²`
      : `${scaled.toLocaleString(undefined, { maximumFractionDigits: 2 })} / 1,000 km²`
  }
  if (format === 'ratio' || format === 'percent') return `${(value * 100).toFixed(1)}%`
  if (format === 'currency') {
    if (compact) {
      if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`
      return `$${Math.round(value / 1000).toLocaleString()}k`
    }
    return value.toLocaleString(undefined, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
  }
  if (format === 'years') return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} yrs`
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatScore(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function formatDriverDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

export function ScoreBuilderRegionInsightDialog({
  open,
  onOpenChange,
  region,
  weights,
  isMobile
}: ScoreBuilderRegionInsightDialogProps) {
  const contributionRows = useMemo(() => {
    if (!region) return []
    return SCORE_METRICS
      .filter((metric) => Math.abs(weights[metric.key]) > 0)
      .map((metric) => ({
        key: metric.key,
        label: metric.shortLabel,
        fullLabel: metric.label,
        category: metric.category,
        metricValue: region.metrics[metric.key],
        normalizedValue: region.normalizedMetrics[metric.key],
        weight: weights[metric.key],
        scoreDelta: region.contributions[metric.key] * 100
      }))
      .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
  }, [region, weights])

  const visibleContributionRows = useMemo(() => {
    if (!isMobile) return contributionRows
    return contributionRows.slice(0, MOBILE_MAX_CONTRIBUTIONS)
  }, [contributionRows, isMobile])

  const topDriverSummary = useMemo(() => {
    const topDrivers = contributionRows.slice(0, 3)
    if (!topDrivers.length) return null
    return topDrivers.map((row) => `${row.label} ${formatDriverDelta(row.scoreDelta)}`).join(', ')
  }, [contributionRows])

  // Group visible rows by category
  const groupedRows = useMemo(() => {
    const groups: Record<string, typeof visibleContributionRows> = {}
    visibleContributionRows.forEach((row) => {
      const cat = row.category
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(row)
    })
    return groups
  }, [visibleContributionRows])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[90vh] overflow-hidden p-0 sm:max-w-2xl"
        data-score-builder-region-insight-dialog="true"
      >
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>{region ? 'Region Score Drivers' : 'Region Insight'}</DialogTitle>
          <DialogDescription>
            {region
              ? `${region.region.name} (Code ${region.region.code})${topDriverSummary ? ` | Top drivers: ${topDriverSummary} pts` : ''}`
              : 'Select a region to review detailed score contributions.'}
          </DialogDescription>
        </DialogHeader>

        {!region ? (
          <div className="px-6 pb-6 text-sm text-muted-foreground">
            Region details will appear here after selecting a boundary.
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto px-6 pb-6">
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2 pt-2 text-xs sm:grid-cols-4">
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Rank</div>
                <div className="text-sm font-semibold text-foreground">#{region.rank}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Score</div>
                <div className="text-sm font-semibold text-foreground">{formatScore(region.score)}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Area</div>
                <div className="text-sm font-semibold text-foreground">{region.region.areaKm2.toFixed(1)} km²</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Sensors</div>
                <div className="text-sm font-semibold text-foreground">{region.counts.monitorCount.toLocaleString()}</div>
              </div>
            </div>

            {/* Coverage snapshot */}
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <div className="mb-2 text-sm font-semibold text-foreground">Coverage Snapshot</div>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
                <div>Low-cost: <span className="font-medium text-foreground">{region.counts.lowCostCount.toLocaleString()}</span></div>
                <div>Reference: <span className="font-medium text-foreground">{region.counts.referenceCount.toLocaleString()}</span></div>
                <div>Active: <span className="font-medium text-foreground">{region.counts.activeCount.toLocaleString()}</span></div>
                <div>Networks: <span className="font-medium text-foreground">{formatMetricValue('networkVariety', region.metrics.networkVariety, true)}</span></div>
                <div>Parks: <span className="font-medium text-foreground">{region.counts.parkCount.toLocaleString()}</span></div>
                <div>Trails: <span className="font-medium text-foreground">{region.counts.trailCount.toLocaleString()}</span></div>
                <div>Restaurants: <span className="font-medium text-foreground">{region.counts.restaurantCount.toLocaleString()}</span></div>
                <div>Population: <span className="font-medium text-foreground">{region.counts.populationSum.toLocaleString()}</span></div>
                <div>Parcels: <span className="font-medium text-foreground">{region.counts.parcelCount.toLocaleString()}</span></div>
                <div>Crime: <span className="font-medium text-foreground">{region.counts.crimeCount.toLocaleString()}</span></div>
                <div>Critical violations: <span className="font-medium text-foreground">{region.counts.criticalViolationCount.toLocaleString()}</span></div>
                <div>Follow-ups: <span className="font-medium text-foreground">{region.counts.followUpInspectionCount.toLocaleString()}</span></div>
              </div>
            </div>

            {/* Metric contributions grouped by category */}
            <div className="rounded-lg border border-border bg-background p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">Weighted Metric Drivers</h3>
                <span className="text-[11px] text-muted-foreground">
                  {visibleContributionRows.length} of {contributionRows.length}
                </span>
              </div>
              {topDriverSummary && (
                <div className="mb-2 rounded border border-border bg-muted/20 px-2 py-1.5 text-[11px] text-muted-foreground">
                  Strongest drivers for this score: <span className="font-medium text-foreground">{topDriverSummary} pts</span>
                </div>
              )}

              {isMobile && contributionRows.length > MOBILE_MAX_CONTRIBUTIONS && (
                <div className="mb-2 rounded border border-cyan-200/60 bg-cyan-50 px-2 py-1 text-[11px] text-cyan-800 dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-200">
                  Compact mobile view showing top {MOBILE_MAX_CONTRIBUTIONS} drivers.
                </div>
              )}

              <div className="space-y-3">
                {Object.entries(groupedRows).map(([category, rows]) => (
                  <div key={category}>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] || category}
                    </div>
                    <div className="space-y-1.5">
                      {rows.map((row) => {
                        const positive = row.scoreDelta >= 0
                        return (
                          <div key={row.key} className="rounded border border-border bg-muted/15 px-2 py-1.5 text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-foreground">{row.label}</span>
                              <span className={cn('font-semibold', positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>
                                {positive ? '+' : ''}{row.scoreDelta.toFixed(2)} pts
                              </span>
                            </div>
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                              <span>weight {row.weight}</span>
                              <span>norm {(row.normalizedValue * 100).toFixed(1)}%</span>
                              <span>{formatMetricValue(row.key, row.metricValue, true)}</span>
                            </div>
                            {!isMobile && (
                              <div className="mt-0.5 text-[10px] text-muted-foreground">{getMetricLabel(row.key)}</div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}

                {visibleContributionRows.length === 0 && (
                  <div className="rounded border border-border bg-muted/20 px-2 py-2 text-xs text-muted-foreground">
                    No active metric weights. Apply a preset or set metric weights above zero.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
