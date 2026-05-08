import { useMemo, useState } from 'react'
import {
  Activity,
  Check,
  ChevronDown,
  ChevronUp,
  Download,
  FlipHorizontal,
  Flame,
  GripVertical,
  Info,
  Plus,
  Search,
  Settings as SettingsIcon,
  X,
} from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { BoundarySource } from '@/maps/airquality'
import { SCORE_METRICS, SCORE_METRICS_BY_CATEGORY, SCORE_PRESETS } from '../constants'
import { METRIC_CATEGORY_LABELS } from '../types'
import type { ScoreMetricKey, ScoreMetricWeightMap, ScoreMethodSettings } from '../types'
import { presetAppliesToBoundary } from '../lib/presets'
import { ScorePresetDialog } from './ScorePresetDialog'

interface ScoreBuilderEquationBarProps {
  weights: ScoreMetricWeightMap
  activePresetKey: string | null
  activeRecipeLabel: string
  activeRecipeDescription: string
  boundarySource: BoundarySource
  equationPreview: string
  methodSettings: ScoreMethodSettings
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  onApplyPreset: (presetKey: string) => void
  onExport: (format: 'csv' | 'geojson') => void
  correlateMode: boolean
  onToggleCorrelateMode: () => void
  densityMode: boolean
  onToggleDensityMode: () => void
  onOpenSettings: () => void
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

function getWeightIntent(value: number): string {
  if (value === 0) return 'Disabled'
  return value > 0 ? 'Prefer high' : 'Prefer low'
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
  return 'bg-cyan-500'
}

export function ScoreBuilderEquationBar({
  weights,
  activePresetKey,
  activeRecipeLabel,
  activeRecipeDescription,
  boundarySource,
  equationPreview,
  methodSettings,
  onWeightChange,
  onAddMetric,
  onApplyPreset,
  onExport,
  correlateMode,
  onToggleCorrelateMode,
  densityMode,
  onToggleDensityMode,
  onOpenSettings,
}: ScoreBuilderEquationBarProps) {
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [metricDialogOpen, setMetricDialogOpen] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)
  const [equationOpen, setEquationOpen] = useState(true)

  const visiblePresets = useMemo(
    () => SCORE_PRESETS.filter((preset) => presetAppliesToBoundary(preset, boundarySource)),
    [boundarySource],
  )
  const activeTerms = useMemo(() => SCORE_METRICS.filter((metric) => weights[metric.key] !== 0), [weights])
  const totalAbsoluteWeight = useMemo(
    () => activeTerms.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0),
    [activeTerms, weights],
  )
  const isHealthyPlanMode = methodSettings.aggregation === 'healthyPlanPairwisePriority'
  const healthyPlanDemographicMetric = useMemo(
    () => SCORE_METRICS.find((metric) => metric.key === methodSettings.healthyPlanPriority.demographicMetric),
    [methodSettings.healthyPlanPriority.demographicMetric],
  )
  const healthyPlanEnvironmentMetric = useMemo(
    () => SCORE_METRICS.find((metric) => metric.key === methodSettings.healthyPlanPriority.environmentMetric),
    [methodSettings.healthyPlanPriority.environmentMetric],
  )
  const formulaText = isHealthyPlanMode
    ? `// for each region: ${equationPreview} // non-priority areas render transparent`
    : `// for each region: ${equationPreview} // normalized to 0-100`

  return (
    <div className="shrink-0 border-b border-border bg-background/96 px-4 py-3 shadow-sm backdrop-blur">
      <div className="rounded-xl border border-border bg-card p-3 shadow-sm" data-score-builder-results-preview="true">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-foreground">{activeRecipeLabel}</h2>
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{activeRecipeDescription}</p>
          </div>
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
                onClick={onToggleDensityMode}
                aria-pressed={densityMode}
                title={
                  densityMode
                    ? 'Density mode is on — map paints regions by a single metric'
                    : 'Turn on density mode to paint the map by a single metric'
                }
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  densityMode
                    ? 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600'
                    : 'border-input bg-background text-foreground hover:bg-muted',
                )}
              >
                <Flame className="h-3.5 w-3.5" />
                {densityMode ? 'Density · On' : 'Density'}
              </button>
              <button
                type="button"
                onClick={onToggleCorrelateMode}
                aria-pressed={correlateMode}
                title={
                  correlateMode
                    ? 'Correlation mode is on — map shows relationship between two metrics'
                    : 'Turn on correlation mode to compare any two metrics'
                }
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                  correlateMode
                    ? 'border-cyan-500 bg-cyan-500 text-white hover:bg-cyan-600'
                    : 'border-input bg-background text-foreground hover:bg-muted',
                )}
              >
                <Activity className="h-3.5 w-3.5" />
                {correlateMode ? 'Correlate · On' : 'Correlate'}
              </button>
              <button
                type="button"
                onClick={() => setPresetDialogOpen(true)}
                title="Browse presets"
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                Presets
              </button>
              <button
                type="button"
                onClick={onOpenSettings}
                title="Open index settings (examples, methodology, model, robustness)"
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
              >
                <SettingsIcon className="h-3.5 w-3.5" />
                Settings
              </button>
              <button
                type="button"
                onClick={() => onExport('csv')}
                title="Export CSV"
                aria-label="Export CSV"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground"
              >
                <Download className="h-4 w-4" />
              </button>
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
                return (
                  <div key={metric.key} className="flex items-center gap-2">
                    {index > 0 && <span className="text-muted-foreground">+</span>}
                    <div
                      data-score-builder-equation-term={metric.key}
                      className={cn(
                        'inline-flex items-stretch overflow-hidden rounded-lg border bg-background text-xs shadow-sm',
                        isNegative
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
                      <div className="flex items-center gap-2 border-l border-r border-border px-2 py-1.5">
                        <span className="font-mono font-semibold text-foreground">{share.toFixed(2)}</span>
                        <GripVertical className="h-3 w-3 text-muted-foreground" />
                      </div>
                      <div className="flex items-center gap-1.5 px-2 py-1.5">
                        <span className={cn('h-2 w-2 rounded-sm', getCategoryDot(metric.category))} />
                        <span className="max-w-[10rem] truncate font-medium text-foreground">{metric.shortLabel}</span>
                        <span className="text-[10px] text-muted-foreground">· {metric.directionLabel}</span>
                      </div>
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
          <div className="mt-3 overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[11px] text-muted-foreground">
            {formulaText}
          </div>
        )}
      </div>

      <ScorePresetDialog
        open={presetDialogOpen}
        onOpenChange={setPresetDialogOpen}
        presets={visiblePresets}
        activePresetKey={activePresetKey}
        onApplyPreset={onApplyPreset}
      />
      <EquationMetricPickerDialog
        open={metricDialogOpen}
        onOpenChange={setMetricDialogOpen}
        weights={weights}
        onPick={(metric) => {
          onAddMetric(metric, getDefaultMetricWeight(metric))
          setMetricDialogOpen(false)
        }}
      />
    </div>
  )
}

function EquationMetricPickerDialog({
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
      <DialogContent className="max-h-[86vh] overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 pb-4 pt-6">
          <DialogTitle>Add Metric</DialogTitle>
          <DialogDescription>Choose one metric to add to the top equation.</DialogDescription>
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
