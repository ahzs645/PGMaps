import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, ChevronUp, Copy, Info, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoundarySource } from '@/maps/airquality'
import type {
  ScoreDataSource,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'
import { getUnavailableWeightedMetrics, type MetricAvailability } from '../lib/metrics'
import { MetricPickerDialog } from './MetricLibrary'
import { CompactWeightRow } from './WeightRow'
import { getCategoryTone, getDefaultMetricWeight } from './scoreBuilderPanelUtils'

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
}

/**
 * The desktop equation editor floating over the map: one chip per active term.
 * Clicking a chip opens its weight editor, so the equation is tuned in place
 * rather than in a separate panel. Lens, undo/redo, and export live in the header.
 */
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
}: ScoreBuilderEquationBarProps) {
  const [metricDialogOpen, setMetricDialogOpen] = useState(false)
  const [formulaOpen, setFormulaOpen] = useState(false)
  const [equationOpen, setEquationOpen] = useState(true)
  const [equationCopied, setEquationCopied] = useState(false)
  const [editingMetricState, setEditingMetric] = useState<ScoreMetricKey | null>(null)
  // A removed term has no popover to keep open.
  const editingMetric = editingMetricState && weights[editingMetricState] !== 0 ? editingMetricState : null

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
    <div className="shrink-0 border-b border-border bg-background/96 px-4 py-2 shadow-sm backdrop-blur">
      <div className="rounded-xl border border-border bg-card px-3 py-2 shadow-sm" data-score-builder-results-preview="true">
        <div className="flex items-start gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold italic text-foreground">Score</span>
            <span className="font-mono text-sm text-muted-foreground">=</span>

            {!equationOpen && (
              <span className="text-xs text-muted-foreground">
                {isHealthyPlanMode
                  ? 'pairwise priority screen'
                  : `${activeTerms.length} term${activeTerms.length === 1 ? '' : 's'}`}
              </span>
            )}

            {equationOpen && isHealthyPlanMode && (
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

            {equationOpen && activeTerms.length === 0 && !isHealthyPlanMode && (
              <span className="rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
                Add a metric to start scoring.
              </span>
            )}

            {equationOpen &&
              !isHealthyPlanMode &&
              activeTerms.map((metric, index) => (
                <EquationChip
                  key={metric.key}
                  metric={metric}
                  weight={weights[metric.key]}
                  share={totalAbsoluteWeight > 0 ? Math.abs(weights[metric.key]) / totalAbsoluteWeight : 0}
                  totalAbsoluteWeight={totalAbsoluteWeight}
                  unavailable={unavailableTerms.get(metric.key) ?? null}
                  leading={index > 0}
                  editing={editingMetric === metric.key}
                  onEdit={() => setEditingMetric((current) => (current === metric.key ? null : metric.key))}
                  onCloseEdit={() => setEditingMetric(null)}
                  onWeightChange={(value) => onWeightChange(metric.key, value)}
                  onRemove={() => onWeightChange(metric.key, 0)}
                  onEnableDataSource={onEnableDataSource}
                />
              ))}

            {equationOpen && !isHealthyPlanMode && (
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

          <div className="flex shrink-0 items-center gap-1">
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
              aria-expanded={equationOpen}
              aria-label={equationOpen ? 'Hide equation' : 'Show equation'}
              title={equationOpen ? 'Hide equation' : 'Show equation'}
              onClick={() => setEquationOpen((current) => !current)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-background text-muted-foreground transition-colors hover:text-foreground"
            >
              {equationOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {(isHealthyPlanMode || activeTerms.length > 0) && formulaOpen && equationOpen && (
          <div className="mt-2 flex items-start gap-2 rounded-md bg-muted px-3 py-2">
            <div className="min-w-0 flex-1 overflow-x-auto font-mono text-xs text-muted-foreground">{formulaText}</div>
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

function EquationChip({
  metric,
  weight,
  share,
  totalAbsoluteWeight,
  unavailable,
  leading,
  editing,
  onEdit,
  onCloseEdit,
  onWeightChange,
  onRemove,
  onEnableDataSource,
}: {
  metric: ScoreMetricDefinition
  weight: number
  share: number
  totalAbsoluteWeight: number
  unavailable: MetricAvailability | null
  leading: boolean
  editing: boolean
  onEdit: () => void
  onCloseEdit: () => void
  onWeightChange: (value: number) => void
  onRemove: () => void
  onEnableDataSource: (source: ScoreDataSource) => void
}) {
  const isNegative = weight < 0
  const chipRef = useRef<HTMLDivElement>(null)

  // Popover dismissal: outside pointer or Escape.
  useEffect(() => {
    if (!editing) return
    const onPointerDown = (event: PointerEvent) => {
      if (!chipRef.current?.contains(event.target as Node)) onCloseEdit()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseEdit()
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [editing, onCloseEdit])

  return (
    <div ref={chipRef} className="relative flex items-center gap-2">
      {leading && <span className="text-muted-foreground">+</span>}
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
          editing && 'ring-2 ring-cyan-500/60',
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
          aria-label={`Flip direction for ${metric.shortLabel}`}
          onClick={() => onWeightChange(weight === 0 ? getDefaultMetricWeight(metric.key) : -weight)}
          className={cn(
            'flex w-7 items-center justify-center font-mono text-base font-bold transition-colors',
            isNegative
              ? 'bg-orange-100 text-orange-800 hover:bg-orange-200 dark:bg-orange-950/40 dark:text-orange-200'
              : 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200',
          )}
        >
          {isNegative ? '-' : '+'}
        </button>
        <button
          type="button"
          data-score-builder-term-label={metric.key}
          aria-expanded={editing}
          aria-label={`Edit weight for ${metric.shortLabel}`}
          onClick={onEdit}
          className="flex items-center gap-1.5 border-l border-border px-2 py-1.5 text-left transition-colors hover:bg-muted"
        >
          <span className={cn('h-2 w-2 rounded-sm', getCategoryTone(metric.category))} />
          <span
            className={cn(
              'max-w-[10rem] truncate font-medium text-foreground',
              unavailable && 'text-muted-foreground line-through',
            )}
          >
            {metric.shortLabel}
          </span>
          <span className="tabular-nums text-muted-foreground">{(share * 100).toFixed(0)}%</span>
        </button>
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
          aria-label={`Remove ${metric.shortLabel}`}
          onClick={onRemove}
          className="border-l border-border px-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {editing && (
        <div
          role="dialog"
          aria-label={`${metric.shortLabel} weight`}
          data-score-builder-weight-popover={metric.key}
          className="absolute left-0 top-full z-40 mt-1.5 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-background p-2 shadow-xl"
        >
          <div className="mb-1.5 px-1 text-xs text-muted-foreground">{metric.label}</div>
          <CompactWeightRow
            metric={metric}
            value={weight}
            totalAbsoluteWeight={totalAbsoluteWeight}
            unavailable={unavailable}
            onEnableDataSource={onEnableDataSource}
            onChange={onWeightChange}
          />
        </div>
      )}
    </div>
  )
}
