import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SCORE_METRICS } from '../constants'
import { formatMetricValue, formatScore, getMetricLabel } from '../lib/metrics'
import { formatDriverDelta } from '../lib/scoreDrivers'
import type { ScoredBoundaryRegion, ScoreMetricKey, ScoreMetricWeightMap, ScoreMethodSettings } from '../types'
import { METRIC_CATEGORY_LABELS } from '../types'

interface ScoreBuilderRegionInsightDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  region: ScoredBoundaryRegion | null
  weights: ScoreMetricWeightMap
  methodSettings: ScoreMethodSettings
  isMobile: boolean
}

const MOBILE_MAX_CONTRIBUTIONS = 4

function formatNormalizationMethod(method: ScoreMethodSettings['normalization']): string {
  if (method === 'percentile') return 'percentile rank'
  if (method === 'winsorizedMinMax') return 'winsorized min-max'
  if (method === 'zScore') return 'z-score'
  return 'min-max'
}

function getCoverageLabel(score: number): { label: string; tone: string } {
  if (score >= 0.85) return { label: 'Strong coverage', tone: 'text-emerald-700 dark:text-emerald-300' }
  if (score >= 0.6) return { label: 'Partial coverage', tone: 'text-amber-700 dark:text-amber-300' }
  return { label: 'Thin coverage', tone: 'text-rose-700 dark:text-rose-300' }
}

function metricHasRegionData(metric: ScoreMetricKey, region: ScoredBoundaryRegion): boolean {
  const definition = SCORE_METRICS.find((entry) => entry.key === metric)
  if (!definition) return true
  if (definition.category === 'airQuality') return region.counts.monitorCount > 0
  if (definition.category === 'parksRec')
    return region.counts.parkCount + region.counts.trailCount + region.counts.amenityCount > 0
  if (definition.category === 'heatShade')
    return (
      region.counts.treeCount +
        region.counts.matureTreeCount +
        region.counts.forestAreaSqKm +
        region.counts.coolingFacilityCount +
        region.counts.responseFacilityCount >
      0
    )
  if (definition.category === 'foodSafety') return region.counts.restaurantCount > 0
  if (definition.category === 'demographics') return region.counts.populationSum > 0
  if (definition.category === 'property') return region.counts.parcelCount > 0
  if (definition.category === 'safety') return region.counts.crimeCount > 0
  if (definition.category === 'transit') return region.counts.transitStopCount > 0
  return true
}

export function ScoreBuilderRegionInsightDialog({
  open,
  onOpenChange,
  region,
  weights,
  methodSettings,
  isMobile,
}: ScoreBuilderRegionInsightDialogProps) {
  const contributionRows = useMemo(() => {
    if (!region) return []
    const totalWeight = SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
    return SCORE_METRICS.filter((metric) => Math.abs(weights[metric.key]) > 0)
      .map((metric) => ({
        key: metric.key,
        label: metric.shortLabel,
        fullLabel: metric.label,
        category: metric.category,
        metricValue: region.metrics[metric.key],
        normalizedValue: region.normalizedMetrics[metric.key],
        weight: weights[metric.key],
        intentLabel: weights[metric.key] < 0 ? `Low ${metric.shortLabel.toLowerCase()}` : metric.shortLabel,
        scoreDelta: region.contributions[metric.key] * 100,
        maxPoints: totalWeight > 0 ? (Math.abs(weights[metric.key]) / totalWeight) * 100 : 0,
        hasData: metricHasRegionData(metric.key, region),
      }))
      .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
  }, [region, weights])

  const topPositiveDrivers = useMemo(
    () => [...contributionRows].sort((a, b) => b.scoreDelta - a.scoreDelta).slice(0, 4),
    [contributionRows],
  )

  const topPressureDrivers = useMemo(
    () =>
      [...contributionRows]
        .map((row) => ({ ...row, pressureDelta: Math.max(0, row.maxPoints - row.scoreDelta) }))
        .sort((a, b) => b.pressureDelta - a.pressureDelta)
        .slice(0, 4),
    [contributionRows],
  )

  const weakDataRows = useMemo(() => contributionRows.filter((row) => !row.hasData), [contributionRows])

  const componentRows = useMemo(() => {
    if (!region) return []
    const totalWeight = SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
    if (totalWeight <= 0) return []
    const groups = new Map<string, { contribution: number; weight: number }>()
    SCORE_METRICS.filter((metric) => weights[metric.key] !== 0).forEach((metric) => {
      const current = groups.get(metric.category) || { contribution: 0, weight: 0 }
      current.contribution += region.contributions[metric.key]
      current.weight += Math.abs(weights[metric.key]) / totalWeight
      groups.set(metric.category, current)
    })
    return Array.from(groups.entries()).map(([category, group]) => ({
      category,
      label: METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] || category,
      score: group.weight > 0 ? (group.contribution / group.weight) * 100 : 0,
      points: group.contribution * 100,
    }))
  }, [region, weights])

  const coverage = region ? getCoverageLabel(region.dataCoverageScore) : null

  const visibleContributionRows = useMemo(() => {
    if (!isMobile) return contributionRows
    return contributionRows.slice(0, MOBILE_MAX_CONTRIBUTIONS)
  }, [contributionRows, isMobile])

  const topDriverSummary = useMemo(() => {
    const topDrivers = contributionRows.slice(0, 3)
    if (!topDrivers.length) return null
    return topDrivers.map((row) => `${row.intentLabel} ${formatDriverDelta(row.scoreDelta)}`).join(', ')
  }, [contributionRows])

  const narrative = useMemo(() => {
    if (!region || contributionRows.length === 0) return null
    const strongest = contributionRows[0]
    const weakest = [...contributionRows].sort((a, b) => a.scoreDelta - b.scoreDelta)[0]
    const rankPhrase =
      region.rank <= 3
        ? 'near the top'
        : region.score >= 65
          ? 'above the pack'
          : region.score >= 45
            ? 'in the middle of the pack'
            : 'below the pack'
    const strongestIntent =
      strongest.weight < 0 ? `low ${strongest.label.toLowerCase()}` : `strong ${strongest.label.toLowerCase()}`
    const weakestIntent =
      weakest.weight < 0 ? `not enough low ${weakest.label.toLowerCase()}` : `weaker ${weakest.label.toLowerCase()}`
    return `${region.region.name} ranks ${rankPhrase} at #${region.rank} with a ${formatScore(region.score)} score. The result is lifted most by ${strongestIntent}; ${weakestIntent} contributes the least among the active terms.`
  }, [contributionRows, region])

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
            <div className="grid grid-cols-2 gap-2 pt-2 text-xs sm:grid-cols-3">
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
                <div className="text-sm font-semibold text-foreground">
                  {region.counts.monitorCount.toLocaleString()}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Data coverage</div>
                <div className={cn('text-sm font-semibold', coverage?.tone)}>
                  {(region.dataCoverageScore * 100).toFixed(0)}%
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-[10px] uppercase text-muted-foreground">Normalization</div>
                <div className="text-sm font-semibold text-foreground">
                  {formatNormalizationMethod(methodSettings.normalization)}
                </div>
              </div>
            </div>

            {/* Plain-English score summary */}
            {narrative && (
              <div className="rounded-lg border border-cyan-200/70 bg-cyan-50 p-3 text-sm leading-relaxed text-cyan-950 dark:border-cyan-900/70 dark:bg-cyan-950/25 dark:text-cyan-100">
                {narrative}
              </div>
            )}

            <div className="rounded-lg border border-border bg-background p-3 text-xs">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">Why this score?</div>
                {coverage && <span className={cn('font-semibold', coverage.tone)}>{coverage.label}</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Top positive drivers
                  </div>
                  <div className="space-y-1">
                    {topPositiveDrivers.map((row) => (
                      <div key={row.key} className="flex justify-between gap-2 rounded bg-muted/25 px-2 py-1">
                        <span className="truncate text-foreground">{row.intentLabel}</span>
                        <span className="font-semibold text-emerald-700 dark:text-emerald-300">
                          +{row.scoreDelta.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Top pressure drivers
                  </div>
                  <div className="space-y-1">
                    {topPressureDrivers.map((row) => (
                      <div key={row.key} className="flex justify-between gap-2 rounded bg-muted/25 px-2 py-1">
                        <span className="truncate text-foreground">{row.fullLabel}</span>
                        <span className="font-semibold text-amber-700 dark:text-amber-300">
                          -{row.pressureDelta.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              {weakDataRows.length > 0 && (
                <div className="mt-3 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
                  Missing or weak active data: {weakDataRows.map((row) => row.fullLabel).join(', ')}.
                </div>
              )}
            </div>

            {componentRows.length > 0 && (
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">Component sub-scores</div>
                <div className="space-y-2">
                  {componentRows.map((component) => (
                    <div key={component.category}>
                      <div className="mb-1 flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-foreground">{component.label}</span>
                        <span className="text-muted-foreground">
                          {formatScore(component.score)} · {component.points.toFixed(1)} pts
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-cyan-500" style={{ width: `${component.score}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Coverage snapshot */}
            <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
              <div className="mb-2 text-sm font-semibold text-foreground">Coverage Snapshot</div>
              <div className="grid grid-cols-2 gap-2 text-muted-foreground sm:grid-cols-4">
                <div>
                  Low-cost:{' '}
                  <span className="font-medium text-foreground">{region.counts.lowCostCount.toLocaleString()}</span>
                </div>
                <div>
                  Reference:{' '}
                  <span className="font-medium text-foreground">{region.counts.referenceCount.toLocaleString()}</span>
                </div>
                <div>
                  Active:{' '}
                  <span className="font-medium text-foreground">{region.counts.activeCount.toLocaleString()}</span>
                </div>
                <div>
                  Networks:{' '}
                  <span className="font-medium text-foreground">
                    {formatMetricValue('networkVariety', region.metrics.networkVariety, true)}
                  </span>
                </div>
                <div>
                  Parks: <span className="font-medium text-foreground">{region.counts.parkCount.toLocaleString()}</span>
                </div>
                <div>
                  Trails:{' '}
                  <span className="font-medium text-foreground">{region.counts.trailCount.toLocaleString()}</span>
                </div>
                <div>
                  Restaurants:{' '}
                  <span className="font-medium text-foreground">{region.counts.restaurantCount.toLocaleString()}</span>
                </div>
                <div>
                  Population:{' '}
                  <span className="font-medium text-foreground">{region.counts.populationSum.toLocaleString()}</span>
                </div>
                <div>
                  Parcels:{' '}
                  <span className="font-medium text-foreground">{region.counts.parcelCount.toLocaleString()}</span>
                </div>
                <div>
                  Crime:{' '}
                  <span className="font-medium text-foreground">{region.counts.crimeCount.toLocaleString()}</span>
                </div>
                <div>
                  Critical violations:{' '}
                  <span className="font-medium text-foreground">
                    {region.counts.criticalViolationCount.toLocaleString()}
                  </span>
                </div>
                <div>
                  Follow-ups:{' '}
                  <span className="font-medium text-foreground">
                    {region.counts.followUpInspectionCount.toLocaleString()}
                  </span>
                </div>
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
                  Strongest drivers for this score:{' '}
                  <span className="font-medium text-foreground">{topDriverSummary} pts</span>
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
                              <span className="font-medium text-foreground">{row.intentLabel}</span>
                              <span
                                className={cn(
                                  'font-semibold',
                                  positive
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : 'text-rose-700 dark:text-rose-300',
                                )}
                              >
                                {positive ? '+' : ''}
                                {row.scoreDelta.toFixed(2)} pts
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
