import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SCORE_BUILDER_EXAMPLES, SCORE_METRICS, SCORE_PRESETS } from '../constants'
import type { ScoredBoundaryRegion, ScoreMetricKey, ScoreMetricRangeMap, ScoreMetricWeightMap } from '../types'
import { formatScore } from '../lib/metrics'
import { EquationComposer, PriorityMode, WeightDistribution } from './EquationComposer'
import { MetricPickerDialog } from './MetricPickerDialog'
import { NormalizationPreview } from './NormalizationPreview'
import { ScorePresetDialog } from './ScorePresetDialog'
import { getDefaultMetricWeight } from './scoreBuilderPanelUtils'

function WeightTotalStatus({
  totalAbsoluteWeight,
  activeMetricCount,
}: {
  totalAbsoluteWeight: number
  activeMetricCount: number
}) {
  const balanced = totalAbsoluteWeight >= 95 && totalAbsoluteWeight <= 105
  const empty = activeMetricCount === 0
  const label = empty ? 'No active model' : balanced ? 'Complete weight model' : 'Auto-normalized weights'

  return (
    <div
      className={cn(
        'mt-3 rounded-md border px-2 py-1.5 text-xs',
        empty
          ? 'border-amber-300/60 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-200'
          : balanced
            ? 'border-emerald-300/60 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/20 dark:text-emerald-200'
            : 'border-cyan-300/60 bg-cyan-50 text-cyan-800 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-200',
      )}
      data-score-builder-weight-status="true"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{label}</span>
        <span className="font-mono">{totalAbsoluteWeight.toLocaleString()}</span>
      </div>
      <div className="mt-0.5 text-xs opacity-80">
        PGMaps divides each active weight by total influence, so weights do not need to equal 100.
      </div>
    </div>
  )
}

export function EquationTab({
  isDesktop,
  weights,
  onWeightChange,
  onAddMetric,
  onApplyPreset,
  visiblePresets,
  activePresetKey,
  activePreset,
  activeExample,
  equationPreview,
  metricRanges,
  totalAbsoluteWeight,
  scoreSpread,
  regions,
  topRegions,
}: {
  isDesktop: boolean
  weights: ScoreMetricWeightMap
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  onApplyPreset: (presetKey: string) => void
  visiblePresets: typeof SCORE_PRESETS
  activePresetKey: string | null
  activePreset: (typeof SCORE_PRESETS)[number] | null
  activeExample: (typeof SCORE_BUILDER_EXAMPLES)[number] | null
  equationPreview: string
  metricRanges: ScoreMetricRangeMap
  totalAbsoluteWeight: number
  scoreSpread: { min: number; max: number; average: number }
  regions: ScoredBoundaryRegion[]
  topRegions: ScoredBoundaryRegion[]
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const [focusedMetric, setFocusedMetric] = useState<ScoreMetricKey | null>(null)
  const [builderMode, setBuilderMode] = useState<'formula' | 'priority'>('formula')
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const [priorityOrder, setPriorityOrder] = useState<ScoreMetricKey[]>([])
  const activeTerms = useMemo(() => SCORE_METRICS.filter((metric) => weights[metric.key] !== 0), [weights])
  const activeWeightCount = activeTerms.length
  const activeTermKeys = useMemo(() => activeTerms.map((metric) => metric.key), [activeTerms])
  const activePriorityOrder = useMemo(() => {
    const activeSet = new Set(activeTermKeys)
    return [
      ...priorityOrder.filter((key) => activeSet.has(key)),
      ...activeTermKeys.filter((key) => !priorityOrder.includes(key)),
    ]
  }, [activeTermKeys, priorityOrder])
  const previewMetric = focusedMetric || activeTerms[0]?.key || null

  const movePriority = (metricKey: ScoreMetricKey, direction: -1 | 1) => {
    setPriorityOrder(() => {
      const index = activePriorityOrder.indexOf(metricKey)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= activePriorityOrder.length) return activePriorityOrder
      const next = [...activePriorityOrder]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  const applyPriorityWeights = () => {
    const rankedKeys = activePriorityOrder.filter((key) => weights[key] !== 0)
    const count = rankedKeys.length
    rankedKeys.forEach((key, index) => {
      const magnitude = count <= 1 ? 70 : Math.round(80 - (index * 55) / (count - 1))
      onWeightChange(key, weights[key] < 0 ? -magnitude : magnitude)
    })
  }

  return (
    <div className="space-y-3 p-4" data-score-builder-section="equation">
      <div className="rounded-lg border border-border bg-background p-3" data-score-builder-results-preview="true">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live Results</div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {topRegions[0] ? `#1 ${topRegions[0].region.name}` : 'No ranked regions yet'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold leading-none text-cyan-700 dark:text-cyan-300">
              {topRegions[0] ? formatScore(topRegions[0].score) : '0.0'}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Avg {formatScore(scoreSpread.average)}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-xs uppercase text-muted-foreground">Low</div>
            <div className="font-semibold text-foreground">{formatScore(scoreSpread.min)}</div>
          </div>
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-xs uppercase text-muted-foreground">High</div>
            <div className="font-semibold text-foreground">{formatScore(scoreSpread.max)}</div>
          </div>
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-xs uppercase text-muted-foreground">Active</div>
            <div className="font-semibold text-foreground">{activeWeightCount} terms</div>
          </div>
        </div>
        <WeightTotalStatus totalAbsoluteWeight={totalAbsoluteWeight} activeMetricCount={activeWeightCount} />
        {topRegions.length > 1 && (
          <div className="mt-3 space-y-1">
            {topRegions.map((region) => (
              <div key={region.region.id} className="flex items-center gap-2 text-xs">
                <span className="w-6 shrink-0 font-semibold text-muted-foreground">#{region.rank}</span>
                <span className="min-w-0 flex-1 truncate text-foreground">{region.region.name}</span>
                <span className="font-semibold text-cyan-700 dark:text-cyan-300">{formatScore(region.score)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preset</div>
            <div className="mt-0.5 text-sm font-semibold text-foreground">
              {activePreset?.label || activeExample?.label || 'Custom index'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPresetDialogOpen(true)}
            className="shrink-0 rounded-md border border-input px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            Browse presets
          </button>
        </div>
        <div className="text-xs text-muted-foreground">
          {activePreset
            ? activePreset.description
            : activeExample
              ? activeExample.description
              : 'Custom weights saved in the URL.'}
        </div>
        {visiblePresets.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {visiblePresets.slice(0, 3).map((preset) => (
              <button
                key={preset.key}
                type="button"
                onClick={() => onApplyPreset(preset.key)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-xs transition-colors',
                  activePresetKey === preset.key
                    ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100'
                    : 'border-input text-muted-foreground hover:text-foreground',
                )}
                title={preset.description}
              >
                {preset.label}
              </button>
            ))}
            {visiblePresets.length > 3 && (
              <button
                type="button"
                onClick={() => setPresetDialogOpen(true)}
                className="rounded-full border border-dashed border-input px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                +{visiblePresets.length - 3} more
              </button>
            )}
          </div>
        )}
        <ScorePresetDialog
          open={presetDialogOpen}
          onOpenChange={setPresetDialogOpen}
          presets={visiblePresets}
          activePresetKey={activePresetKey}
          onApplyPreset={onApplyPreset}
        />
      </div>
      {!isDesktop && (
        <div
          data-score-builder-mobile-note="true"
          className="rounded-md border border-cyan-200/70 bg-cyan-50 p-2 text-xs text-cyan-800 dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-200"
        >
          Custom metric weight editing is available on desktop. Mobile supports preset scoring and region insight
          review.
        </div>
      )}

      {isDesktop && (
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Builder mode
              </div>
              <div className="inline-flex rounded-md border border-input bg-muted/20 p-0.5">
                {[
                  ['formula', 'Formula'],
                  ['priority', 'Priority'],
                ].map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setBuilderMode(mode as 'formula' | 'priority')}
                    className={cn(
                      'rounded px-2 py-1 text-xs font-medium transition-colors',
                      builderMode === mode
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <WeightDistribution weights={weights} totalAbsoluteWeight={totalAbsoluteWeight} />
          </div>

          <div className="rounded-lg border border-border bg-background p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {builderMode === 'formula' ? 'Equation' : 'Priority ranking'}
                </div>
                <div className="mt-0.5 font-mono text-xs text-muted-foreground">
                  {builderMode === 'formula'
                    ? `|weights| sum: ${totalAbsoluteWeight.toLocaleString()}`
                    : 'Top metrics get stronger weights'}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {builderMode === 'priority' && (
                  <button
                    type="button"
                    onClick={applyPriorityWeights}
                    disabled={activePriorityOrder.length === 0}
                    className="rounded-md border border-cyan-500/50 bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-800 transition-colors hover:bg-cyan-100 disabled:opacity-50 dark:bg-cyan-950/30 dark:text-cyan-100"
                  >
                    Apply ranking
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add metric
                </button>
              </div>
            </div>

            {builderMode === 'formula' ? (
              <EquationComposer
                activeTerms={activeTerms}
                weights={weights}
                totalAbsoluteWeight={totalAbsoluteWeight}
                focusedMetric={focusedMetric}
                onFocus={setFocusedMetric}
                onWeightChange={onWeightChange}
              />
            ) : (
              <PriorityMode
                order={activePriorityOrder}
                weights={weights}
                onMove={movePriority}
                onFocus={setFocusedMetric}
                onRemove={(metric) => onWeightChange(metric, 0)}
              />
            )}
          </div>

          <NormalizationPreview metricKey={previewMetric} regions={regions} metricRanges={metricRanges} />
        </div>
      )}

      <div className="rounded-md border border-border bg-background p-2">
        <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Equation</div>
        <div className="font-mono text-xs text-foreground">{equationPreview}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          |weights| sum: {totalAbsoluteWeight.toLocaleString()}
        </div>
      </div>

      <MetricPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        weights={weights}
        onPick={(metric) => {
          const value = getDefaultMetricWeight(metric)
          onAddMetric(metric, value)
          setFocusedMetric(metric)
          setPickerOpen(false)
        }}
      />
    </div>
  )
}
