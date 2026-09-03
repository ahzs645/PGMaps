import { useMemo } from 'react'
import { Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatMetricValue, formatScore, getMetricLabel } from '../lib/metrics'
import { formatDriverDelta } from '../lib/scoreDrivers'
import type {
  ScoredBoundaryRegion,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'
import { METRIC_CATEGORY_LABELS } from '../types'

interface ScoreBuilderRegionInsightDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  region: ScoredBoundaryRegion | null
  weights: ScoreMetricWeightMap
  methodSettings: ScoreMethodSettings
  isMobile: boolean
  /** Active metric definitions including custom/uploaded recipes, not just the built-ins. */
  metrics: ScoreMetricDefinition[]
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

function metricHasRegionData(
  metric: ScoreMetricKey,
  region: ScoredBoundaryRegion,
  metrics: ScoreMetricDefinition[],
): boolean {
  const definition = metrics.find((entry) => entry.key === metric)
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
  if (definition.category === 'walkability')
    return (
      region.counts.sidewalkLengthKm +
        region.counts.walkwayLengthKm +
        region.counts.walkabilityIntersectionCount +
        region.counts.walkabilityCrossingCount +
        region.counts.childcareCount +
        region.counts.walkabilityPoiCount +
        region.counts.class3CrosswalkCount +
        region.counts.pedestrianCrashCount >
      0
    )
  return true
}

function formatLiftPhrase(row: { weight: number; label: string }): string {
  return row.weight < 0 ? `lower ${row.label.toLowerCase()}` : `higher ${row.label.toLowerCase()}`
}

function formatDragPhrase(row: { weight: number; label: string }): string {
  return row.weight < 0 ? `higher ${row.label.toLowerCase()}` : `lower ${row.label.toLowerCase()}`
}

function csvEscape(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value)
  return `"${text.split('"').join('""')}"`
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function createRegionReportCsv({
  region,
  weights,
  methodSettings,
  contributionRows,
  componentRows,
}: {
  region: ScoredBoundaryRegion
  weights: ScoreMetricWeightMap
  methodSettings: ScoreMethodSettings
  contributionRows: Array<{
    key: ScoreMetricKey
    fullLabel: string
    category: string
    metricValue: number
    normalizedValue: number
    weight: number
    scoreDelta: number
    hasData: boolean
  }>
  componentRows: Array<{ label: string; score: number; points: number }>
}): string {
  const lines = [
    ['Report', 'PGMaps score-builder region report'],
    ['Generated', new Date().toLocaleString()],
    ['Region', region.region.name],
    ['Code', region.region.code],
    ['Boundary level', region.region.level],
    ['Rank', region.rank],
    ['Score', formatScore(region.score)],
    ['Data coverage', `${(region.dataCoverageScore * 100).toFixed(0)}%`],
    ['Normalization', formatNormalizationMethod(methodSettings.normalization)],
    ['Aggregation', methodSettings.aggregation],
    ['Score method', region.scoreMethodLabel || methodSettings.aggregation],
    [
      'Disclaimer',
      region.bcEnviroScreen
        ? 'Hybrid research reconstruction; not an official Province of British Columbia or paper-author product.'
        : 'User-generated local proxy report. This is not the official CDC/ATSDR Environmental Justice Index.',
    ],
    ...(region.bcEnviroScreen
      ? [
          [],
          ['BC EnviroScreen output', 'Value'],
          ['Environmental exposures', `${((region.bcEnviroScreen.components.exposures ?? 0) * 100).toFixed(1)}%`],
          [
            'Environmental effects',
            `${((region.bcEnviroScreen.components.environmentalEffects ?? 0) * 100).toFixed(1)}%`,
          ],
          [
            'Sensitive populations',
            `${((region.bcEnviroScreen.components.sensitivePopulations ?? 0) * 100).toFixed(1)}%`,
          ],
          [
            'Socioeconomic factors',
            `${((region.bcEnviroScreen.components.socioeconomicFactors ?? 0) * 100).toFixed(1)}%`,
          ],
          ['Landscape burden', region.bcEnviroScreen.landscapeBurdenScore?.toFixed(3) ?? 'missing'],
          ['Population characteristics', region.bcEnviroScreen.populationCharacteristicsScore?.toFixed(3) ?? 'missing'],
          ['Formula mode', region.bcEnviroScreen.formulaMode],
          ['Formula', region.bcEnviroScreen.formulaExpression],
          ['Formula error', region.bcEnviroScreen.formulaError ?? 'none'],
        ]
      : []),
    [],
    ['Module', 'Module rank', 'Raw module sum', 'Active indicators', 'Missing indicators'],
    ...(region.moduleScores || []).map((row) => [
      row.label,
      `${(row.rank * 100).toFixed(1)}%`,
      row.rawScore.toFixed(3),
      row.activeMetricCount,
      row.missingMetricCount,
    ]),
    [],
    ['Domain', 'Module', 'Domain score', 'Active indicators'],
    ...(region.domainScores || []).map((row) => [row.label, row.module, formatScore(row.score), row.activeMetricCount]),
    [],
    ['Component', 'Sub-score', 'Points'],
    ...componentRows.map((row) => [row.label, formatScore(row.score), row.points.toFixed(2)]),
    [],
    ['Metric', 'Category', 'Weight', 'Value', 'Normalized percentile', 'Score points', 'Has active data'],
    ...contributionRows.map((row) => [
      row.fullLabel,
      METRIC_CATEGORY_LABELS[row.category as keyof typeof METRIC_CATEGORY_LABELS] || row.category,
      weights[row.key],
      formatMetricValue(row.key, row.metricValue, true),
      `${(row.normalizedValue * 100).toFixed(1)}%`,
      row.scoreDelta.toFixed(2),
      row.hasData ? 'yes' : 'no',
    ]),
  ]
  return lines.map((line) => line.map(csvEscape).join(',')).join('\n')
}

export function ScoreBuilderRegionInsightDialog({
  open,
  onOpenChange,
  region,
  weights,
  methodSettings,
  isMobile,
  metrics,
}: ScoreBuilderRegionInsightDialogProps) {
  const contributionRows = useMemo(() => {
    if (!region) return []
    const totalWeight = metrics.reduce((sum, metric) => sum + Math.abs(weights[metric.key] ?? 0), 0)
    return metrics
      .filter((metric) => Math.abs(weights[metric.key] ?? 0) > 0)
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
        hasData: metricHasRegionData(metric.key, region, metrics),
      }))
      .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
  }, [metrics, region, weights])

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
    const totalWeight = metrics.reduce((sum, metric) => sum + Math.abs(weights[metric.key] ?? 0), 0)
    if (totalWeight <= 0) return []
    const groups = new Map<string, { contribution: number; weight: number }>()
    metrics
      .filter((metric) => (weights[metric.key] ?? 0) !== 0)
      .forEach((metric) => {
        const current = groups.get(metric.category) || { contribution: 0, weight: 0 }
        current.contribution += region.contributions[metric.key] ?? 0
        current.weight += Math.abs(weights[metric.key] ?? 0) / totalWeight
        groups.set(metric.category, current)
      })
    return Array.from(groups.entries()).map(([category, group]) => ({
      category,
      label: METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] || category,
      score: group.weight > 0 ? (group.contribution / group.weight) * 100 : 0,
      points: group.contribution * 100,
    }))
  }, [metrics, region, weights])

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
    return `${region.region.name} ranks ${rankPhrase} at #${region.rank} with a ${formatScore(region.score)} score. The result is lifted most by ${formatLiftPhrase(strongest)}; the biggest drag is ${formatDragPhrase(weakest)}.`
  }, [contributionRows, region])

  const explanationBullets = useMemo(() => {
    if (!region) return []
    return contributionRows.slice(0, 4).map((row) => {
      const percentile = Math.round(row.normalizedValue * 100)
      const directionText = row.weight < 0 ? 'lower value helps this score' : 'higher value drives this score'
      return `${row.fullLabel}: ${formatMetricValue(row.key, row.metricValue, true)} (${percentile}th percentile; ${directionText}).`
    })
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

  const handleDownloadReport = () => {
    if (!region) return
    const csv = createRegionReportCsv({ region, weights, methodSettings, contributionRows, componentRows })
    const slug =
      region.region.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'region'
    downloadTextFile(csv, `pgmaps-${slug}-score-report.csv`, 'text/csv')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        variant="sheet"
        elevated
        className="max-h-[min(88dvh,720px)] sm:max-h-[min(88dvh,720px)] sm:max-w-2xl"
        data-score-builder-region-insight-dialog="true"
      >
        <DialogHeader className="shrink-0 border-b border-border px-4 pb-3 pt-5 sm:px-6 sm:pb-4 sm:pt-6">
          <DialogTitle className="pr-8 text-base sm:text-lg">
            {region ? 'Region Score Drivers' : 'Region Insight'}
          </DialogTitle>
          <DialogDescription className="line-clamp-3 pr-4 text-xs leading-relaxed sm:text-sm">
            {region
              ? `${region.region.name} (Code ${region.region.code})${topDriverSummary ? ` | Top drivers: ${topDriverSummary} pts` : ''}`
              : 'Select a region to review detailed score contributions.'}
          </DialogDescription>
        </DialogHeader>

        {!region ? (
          <div className="px-4 pb-6 text-sm text-muted-foreground sm:px-6">
            Region details will appear here after selecting a boundary.
          </div>
        ) : (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-1 sm:px-6 sm:pb-6">
            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2 pt-2 text-xs sm:grid-cols-3">
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-xs uppercase text-muted-foreground">Rank</div>
                <div className="text-sm font-semibold text-foreground">#{region.rank}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-xs uppercase text-muted-foreground">Score</div>
                <div className="text-sm font-semibold text-foreground">{formatScore(region.score)}</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-xs uppercase text-muted-foreground">Area</div>
                <div className="text-sm font-semibold text-foreground">{region.region.areaKm2.toFixed(1)} km²</div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-xs uppercase text-muted-foreground">Sensors</div>
                <div className="text-sm font-semibold text-foreground">
                  {region.counts.monitorCount.toLocaleString()}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-xs uppercase text-muted-foreground">Data coverage</div>
                <div className={cn('text-sm font-semibold', coverage?.tone)}>
                  {(region.dataCoverageScore * 100).toFixed(0)}%
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2">
                <div className="text-xs uppercase text-muted-foreground">Normalization</div>
                <div className="text-sm font-semibold text-foreground">
                  {formatNormalizationMethod(methodSettings.normalization)}
                </div>
              </div>
              <div className="rounded-md border border-border bg-muted/30 p-2 sm:col-span-3">
                <div className="text-xs uppercase text-muted-foreground">Rank confidence</div>
                <div className="text-sm font-semibold text-foreground">{region.rankConfidence}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Rank #{region.rankInterval[0]}-#{region.rankInterval[1]} · score{' '}
                  {formatScore(region.scoreInterval[0])}-{formatScore(region.scoreInterval[1])}
                </div>
              </div>
              {region.scoreMethodLabel && (
                <div className="rounded-md border border-border bg-muted/30 p-2 sm:col-span-3">
                  <div className="text-xs uppercase text-muted-foreground">Score method</div>
                  <div className="text-sm font-semibold text-foreground">{region.scoreMethodLabel}</div>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleDownloadReport}
              className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
            >
              <Download className="h-3.5 w-3.5" />
              Download region report
            </button>

            {/* Plain-English score summary */}
            {narrative && (
              <div className="rounded-lg border border-cyan-200/70 bg-cyan-50 p-3 text-sm leading-relaxed text-cyan-950 dark:border-cyan-900/70 dark:bg-cyan-950/25 dark:text-cyan-100">
                {narrative}
                {explanationBullets.length > 0 && (
                  <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs">
                    {explanationBullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ol>
                )}
              </div>
            )}

            <div className="rounded-lg border border-border bg-background p-3 text-xs">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-foreground">Why this score?</div>
                {coverage && <span className={cn('font-semibold', coverage.tone)}>{coverage.label}</span>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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

            {region.bcEnviroScreen && (
              <div className="rounded-lg border border-violet-200 bg-violet-50/40 p-3 dark:border-violet-900/70 dark:bg-violet-950/20">
                <div className="mb-2 text-sm font-semibold text-foreground">BC EnviroScreen calculation</div>
                <div className="grid gap-2 text-xs sm:grid-cols-2">
                  {Object.entries(region.bcEnviroScreen.components).map(([key, value]) => (
                    <div
                      key={key}
                      className="flex justify-between gap-2 rounded border border-violet-200 bg-background px-2 py-1.5 dark:border-violet-900/70"
                    >
                      <span>{key.replace(/([A-Z])/g, ' $1')}</span>
                      <span className="font-semibold">
                        {value == null ? 'Missing' : `${(value * 100).toFixed(1)}%`}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between gap-2 rounded border border-violet-200 bg-background px-2 py-1.5 dark:border-violet-900/70">
                    <span>Landscape burden</span>
                    <span className="font-semibold">
                      {region.bcEnviroScreen.landscapeBurdenScore?.toFixed(2) ?? 'Missing'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2 rounded border border-violet-200 bg-background px-2 py-1.5 dark:border-violet-900/70">
                    <span>Population characteristics</span>
                    <span className="font-semibold">
                      {region.bcEnviroScreen.populationCharacteristicsScore?.toFixed(2) ?? 'Missing'}
                    </span>
                  </div>
                </div>
                <div className="mt-2 rounded border border-violet-200 bg-background px-2 py-1.5 font-mono text-xs dark:border-violet-900/70">
                  <div className="mb-0.5 font-sans font-semibold text-foreground">
                    {region.bcEnviroScreen.formulaMode === 'custom' ? 'Advanced formula' : 'Reconstruction formula'}
                  </div>
                  <div className="break-words text-muted-foreground">{region.bcEnviroScreen.formulaExpression}</div>
                  {region.bcEnviroScreen.formulaError && (
                    <div className="mt-1 font-sans font-medium text-rose-700 dark:text-rose-300">
                      {region.bcEnviroScreen.formulaError}
                    </div>
                  )}
                </div>
              </div>
            )}

            {componentRows.length > 0 && (
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">
                  {region.moduleScores?.length ? 'Module ranks' : 'Component sub-scores'}
                </div>
                <div className="space-y-2">
                  {componentRows.map((component) => (
                    <div key={component.category}>
                      <div className="mb-1 flex items-center justify-between text-xs">
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

            {region.domainScores && region.domainScores.length > 0 && (
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">Domain summaries</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {region.domainScores.map((domain) => (
                    <div key={domain.key} className="rounded border border-border bg-muted/15 px-2 py-1.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium text-foreground">{domain.label}</span>
                        <span className="font-semibold text-cyan-700 dark:text-cyan-300">
                          {formatScore(domain.score)}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {domain.activeMetricCount} indicator{domain.activeMetricCount === 1 ? '' : 's'} ·{' '}
                        {domain.module}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {region.missingDataFlags && region.missingDataFlags.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
                <div className="mb-1 text-sm font-semibold">
                  {region.bcEnviroScreen ? 'Source and missing-data flags' : 'Missing-data flags'}
                </div>
                <ul className="space-y-1">
                  {region.missingDataFlags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
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
                <span className="text-xs text-muted-foreground">
                  {visibleContributionRows.length} of {contributionRows.length}
                </span>
              </div>
              {topDriverSummary && (
                <div className="mb-2 rounded border border-border bg-muted/20 px-2 py-1.5 text-xs text-muted-foreground">
                  Strongest drivers for this score:{' '}
                  <span className="font-medium text-foreground">{topDriverSummary} pts</span>
                </div>
              )}

              {isMobile && contributionRows.length > MOBILE_MAX_CONTRIBUTIONS && (
                <div className="mb-2 rounded border border-cyan-200/60 bg-cyan-50 px-2 py-1 text-xs text-cyan-800 dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-200">
                  Compact mobile view showing top {MOBILE_MAX_CONTRIBUTIONS} drivers.
                </div>
              )}

              <div className="space-y-3">
                {Object.entries(groupedRows).map(([category, rows]) => (
                  <div key={category}>
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
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
                            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>weight {row.weight}</span>
                              <span>norm {(row.normalizedValue * 100).toFixed(1)}%</span>
                              <span>{formatMetricValue(row.key, row.metricValue, true)}</span>
                            </div>
                            {!isMobile && (
                              <div className="mt-0.5 text-xs text-muted-foreground">{getMetricLabel(row.key)}</div>
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
