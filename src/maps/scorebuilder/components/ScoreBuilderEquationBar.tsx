import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  Flame,
  Info,
  Plus,
  Redo2,
  Settings as SettingsIcon,
  Undo2,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoundarySource } from '@/maps/airquality'
import type {
  ScoreDataSource,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'
import type { ScoreBuilderExportFormat } from '../lib/exportRegions'
import { getUnavailableWeightedMetrics } from '../lib/metrics'
import { MetricPickerDialog } from './MetricLibrary'

interface ScoreBuilderEquationBarProps {
  weights: ScoreMetricWeightMap
  boundarySource: BoundarySource
  equationPreview: string
  methodSettings: ScoreMethodSettings
  metrics: ScoreMetricDefinition[]
  enabledDataSources: ScoreDataSource[]
  onEnableDataSource: (source: ScoreDataSource) => void
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  onExport: (format: ScoreBuilderExportFormat) => void
  correlateMode: boolean
  onToggleCorrelateMode: () => void
  densityMode: boolean
  onToggleDensityMode: () => void
  onOpenSettings: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
}

function getDefaultMetricWeight(metric: ScoreMetricKey): number {
  if (
    metric === 'foodRiskScore' ||
    metric === 'criticalViolationRate' ||
    metric === 'followUpRate' ||
    metric === 'buildingAge' ||
    metric === 'crimeDensity' ||
    metric === 'crimePerCapita' ||
    metric === 'recentCrimeShare'
  ) {
    return -35
  }
  return 35
}

function getCategoryDot(category: string): string {
  if (category === 'airQuality') return 'bg-sky-500'
  if (category === 'parksRec') return 'bg-emerald-500'
  if (category === 'heatShade') return 'bg-lime-600'
  if (category === 'foodSafety') return 'bg-orange-500'
  if (category === 'demographics') return 'bg-amber-500'
  if (category === 'property') return 'bg-violet-500'
  if (category === 'safety') return 'bg-rose-500'
  if (category === 'transit') return 'bg-teal-500'
  if (category === 'walkability') return 'bg-emerald-600'
  return 'bg-cyan-500'
}

export function ScoreBuilderEquationBar({
  weights,
  boundarySource,
  equationPreview,
  methodSettings,
  metrics,
  enabledDataSources,
  onEnableDataSource,
  onWeightChange,
  onAddMetric,
  onExport,
  correlateMode,
  onToggleCorrelateMode,
  densityMode,
  onToggleDensityMode,
  onOpenSettings,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
}: ScoreBuilderEquationBarProps) {
  const [metricDialogOpen, setMetricDialogOpen] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)
  const [equationOpen, setEquationOpen] = useState(true)
  const [exportMenuOpen, setExportMenuOpen] = useState(false)
  const [equationCopied, setEquationCopied] = useState(false)
  const exportMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!exportMenuOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) setExportMenuOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [exportMenuOpen])

  const handleCopyEquation = async () => {
    try {
      await navigator.clipboard?.writeText(equationPreview)
      setEquationCopied(true)
      window.setTimeout(() => setEquationCopied(false), 1800)
    } catch {
      // Clipboard may be unavailable; the formula text stays visible for manual copy.
    }
  }

  const activeTerms = useMemo(() => metrics.filter((metric) => weights[metric.key] !== 0), [metrics, weights])
  // Terms that are in the equation but contributing nothing — either their data source
  // is switched off or the metric does not populate on the active study area.
  const unavailableTerms = useMemo(
    () => getUnavailableWeightedMetrics(metrics, weights, enabledDataSources, boundarySource),
    [boundarySource, enabledDataSources, metrics, weights],
  )
  const totalAbsoluteWeight = useMemo(
    () => activeTerms.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0),
    [activeTerms, weights],
  )
  const isHealthyPlanMode = methodSettings.aggregation === 'healthyPlanPairwisePriority'
  const healthyPlanDemographicMetric = useMemo(
    () => metrics.find((metric) => metric.key === methodSettings.healthyPlanPriority.demographicMetric),
    [methodSettings.healthyPlanPriority.demographicMetric, metrics],
  )
  const healthyPlanEnvironmentMetric = useMemo(
    () => metrics.find((metric) => metric.key === methodSettings.healthyPlanPriority.environmentMetric),
    [methodSettings.healthyPlanPriority.environmentMetric, metrics],
  )
  const formulaText = isHealthyPlanMode
    ? `// for each region: ${equationPreview} // non-priority areas render transparent`
    : `// for each region: ${equationPreview} // normalized to 0-100`

  return (
    <div className="shrink-0 border-b border-border bg-background/96 px-4 py-3 shadow-sm backdrop-blur">
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm" data-score-builder-results-preview="true">
        {/* The recipe title lives in the shared Index Lab header above; this card only
            carries the equation itself plus the map-lens and quick actions. */}
        <div className="flex flex-wrap items-start justify-end gap-3">
          <div className="flex w-full shrink-0 items-start gap-2 sm:w-auto">
            <div className="flex flex-1 flex-wrap items-center justify-end gap-1 sm:flex-none">
              <button
                type="button"
                aria-expanded={equationOpen}
                aria-label={equationOpen ? 'Hide equation' : 'Show equation'}
                title={equationOpen ? 'Hide equation' : 'Show equation'}
                onClick={() => setEquationOpen((current) => !current)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground"
              >
                {equationOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <button
                type="button"
                disabled={!isHealthyPlanMode && activeTerms.length === 0}
                title={
                  isHealthyPlanMode || activeTerms.length > 0 ? formulaText : 'Add a metric before viewing the formula.'
                }
                aria-expanded={formulaOpen}
                aria-label="Equation details"
                onClick={() => setFormulaOpen((current) => !current)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Info className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo (Ctrl+Z)"
                aria-label="Undo"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo (Shift+Ctrl+Z)"
                aria-label="Redo"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Redo2 className="h-4 w-4" />
              </button>
              <div
                role="group"
                aria-label="Map lens"
                className="inline-flex h-8 items-stretch overflow-hidden rounded-md border border-input bg-background"
              >
                <button
                  type="button"
                  aria-pressed={!densityMode && !correlateMode}
                  title="Score lens — map colored by the composite index"
                  onClick={() => {
                    if (densityMode) onToggleDensityMode()
                    if (correlateMode) onToggleCorrelateMode()
                  }}
                  className={cn(
                    'px-2.5 text-xs font-medium transition-colors',
                    !densityMode && !correlateMode
                      ? 'bg-cyan-500 text-white'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  Score
                </button>
                <button
                  type="button"
                  aria-pressed={densityMode}
                  title="Density lens — map painted by a single metric"
                  onClick={() => {
                    if (!densityMode) onToggleDensityMode()
                  }}
                  className={cn(
                    'inline-flex items-center gap-1 border-l border-input px-2.5 text-xs font-medium transition-colors',
                    densityMode ? 'bg-amber-500 text-white' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Flame className="h-3.5 w-3.5" />
                  Density
                </button>
                <button
                  type="button"
                  aria-pressed={correlateMode}
                  title="Correlate lens — map shows the relationship between two metrics"
                  onClick={() => {
                    if (!correlateMode) onToggleCorrelateMode()
                  }}
                  className={cn(
                    'inline-flex items-center gap-1 border-l border-input px-2.5 text-xs font-medium transition-colors',
                    correlateMode ? 'bg-cyan-500 text-white' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Activity className="h-3.5 w-3.5" />
                  Correlate
                </button>
              </div>
              <button
                type="button"
                onClick={onOpenSettings}
                title="Index settings (examples, saved indexes, methodology, model, robustness)"
                aria-label="Index settings"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground"
              >
                <SettingsIcon className="h-4 w-4" />
              </button>
              <div ref={exportMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setExportMenuOpen((current) => !current)}
                  title="Export results"
                  aria-label="Export results"
                  aria-expanded={exportMenuOpen}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Download className="h-4 w-4" />
                </button>
                {exportMenuOpen && (
                  <div className="absolute right-0 top-9 z-30 w-44 rounded-md border border-border bg-background p-1 shadow-lg">
                    {(
                      [
                        ['csv', 'Regions CSV'],
                        ['geojson', 'Regions GeoJSON'],
                        ['png', 'Map image (PNG)'],
                        ['pdf', 'PDF report'],
                      ] as Array<[ScoreBuilderExportFormat, string]>
                    ).map(([format, label]) => (
                      <button
                        key={format}
                        type="button"
                        onClick={() => {
                          setExportMenuOpen(false)
                          onExport(format)
                        }}
                        className="block w-full rounded px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-muted"
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {equationOpen && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold italic text-foreground">Score</span>
            <span className="font-mono text-sm text-muted-foreground">=</span>
            {isHealthyPlanMode && (
              <>
                <span className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-950 dark:border-amber-900/70 dark:bg-amber-950/35 dark:text-amber-100">
                  vulnerability decile &gt; 5 and environment benefit decile &lt; 6
                </span>
                <span className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                  {healthyPlanDemographicMetric?.shortLabel ?? 'Vulnerability metric'} vs{' '}
                  {healthyPlanEnvironmentMetric?.shortLabel ?? 'environment metric'}
                </span>
              </>
            )}

            {activeTerms.length === 0 && !isHealthyPlanMode && (
              <span className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                Add a metric to start scoring.
              </span>
            )}

            {!isHealthyPlanMode &&
              activeTerms.map((metric, index) => {
                const weight = weights[metric.key]
                const share = totalAbsoluteWeight > 0 ? Math.abs(weight) / totalAbsoluteWeight : 0
                const isNegative = weight < 0
                const unavailable = unavailableTerms.get(metric.key)
                return (
                  <div key={metric.key} className="flex items-center gap-2">
                    {index > 0 && <span className="text-muted-foreground">+</span>}
                    <div
                      data-score-builder-equation-term={metric.key}
                      data-score-builder-term-inactive={unavailable ? 'true' : undefined}
                      title={
                        unavailable
                          ? `${metric.label} — ${unavailable.message}`
                          : `${metric.label} — ${(share * 100).toFixed(0)}% of total weight · ${metric.directionLabel}`
                      }
                      className={cn(
                        'inline-flex items-stretch overflow-hidden rounded-lg border bg-background text-xs shadow-sm',
                        unavailable
                          ? 'border-dashed border-amber-400 dark:border-amber-800'
                          : isNegative
                            ? 'border-orange-300 dark:border-orange-900/70'
                            : 'border-emerald-300 dark:border-emerald-900/70',
                      )}
                    >
                      <button
                        type="button"
                        title="Flip direction"
                        onClick={() =>
                          onWeightChange(metric.key, weight === 0 ? getDefaultMetricWeight(metric.key) : -weight)
                        }
                        className={cn(
                          'flex w-7 items-center justify-center font-mono text-base font-bold transition-colors',
                          isNegative
                            ? 'bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-950/40 dark:text-orange-200'
                            : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200',
                        )}
                      >
                        {isNegative ? '-' : '+'}
                      </button>
                      <div className="flex items-center gap-1.5 border-l border-border px-2 py-1.5">
                        <span className={cn('h-2 w-2 rounded-sm', getCategoryDot(metric.category))} />
                        <span
                          className={cn(
                            'max-w-[10rem] truncate font-medium text-foreground',
                            unavailable && 'text-muted-foreground line-through',
                          )}
                        >
                          {metric.shortLabel}
                        </span>
                      </div>
                      {unavailable?.source ? (
                        <button
                          type="button"
                          data-score-builder-enable-source={unavailable.source}
                          title={`${unavailable.message} Click to turn its data source back on.`}
                          aria-label={`Turn on the data source for ${metric.label}`}
                          onClick={() => onEnableDataSource(unavailable.source!)}
                          className="inline-flex items-center gap-1 border-l border-border bg-amber-50 px-2 font-medium text-amber-900 transition-colors hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"
                        >
                          <AlertTriangle className="h-3 w-3" />
                          Turn on
                        </button>
                      ) : (
                        unavailable && (
                          <span
                            title={unavailable.message}
                            className="inline-flex items-center border-l border-border bg-amber-50 px-2 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100"
                          >
                            <AlertTriangle className="h-3 w-3" />
                          </span>
                        )
                      )}
                      <button
                        type="button"
                        title="Remove metric"
                        onClick={() => onWeightChange(metric.key, 0)}
                        className="border-l border-border px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )
              })}

            {!isHealthyPlanMode && (
              <button
                type="button"
                onClick={() => setMetricDialogOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-input bg-background px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:border-cyan-400 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" />
                Add metric
              </button>
            )}
          </div>
        )}

        {(isHealthyPlanMode || activeTerms.length > 0) && formulaOpen && equationOpen && (
          <div className="mt-3 flex items-start gap-2 rounded-md bg-muted px-3 py-2">
            <div className="min-w-0 flex-1 overflow-x-auto font-mono text-xs text-muted-foreground">
              {formulaText}
            </div>
            <button
              type="button"
              onClick={handleCopyEquation}
              title="Copy equation to clipboard"
              className="inline-flex shrink-0 items-center gap-1 rounded border border-input bg-background px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {equationCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {equationCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
        )}
      </div>

      <MetricPickerDialog
        open={metricDialogOpen}
        onOpenChange={setMetricDialogOpen}
        weights={weights}
        metrics={metrics}
        boundarySource={boundarySource}
        description="Choose one metric to add to the top equation."
        onPick={(metric) => onAddMetric(metric, getDefaultMetricWeight(metric))}
      />
    </div>
  )
}
