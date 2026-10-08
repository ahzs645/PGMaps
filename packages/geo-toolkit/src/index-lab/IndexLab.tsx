import { useCallback, useEffect, type ReactNode } from 'react'
import { cn } from '../utils.js'
import { CompactWeightRow } from './WeightRow.js'
import { MetricLibraryPanel } from './MetricLibrary.js'
import { useIndexLabController } from './controller.js'
import { computeIndexLabResults, DEFAULT_INDEX_LAB_SETTINGS } from './state.js'
import type { IndexLabMetric, IndexLabRecord, IndexLabResult, IndexLabSettings, IndexLabState } from './types.js'

export function IndexLabMethodControls({
  settings,
  onChange,
  layout = 'stacked',
}: {
  settings: IndexLabSettings
  onChange: (settings: IndexLabSettings) => void
  layout?: 'stacked' | 'columns'
}) {
  const update = <TKey extends keyof IndexLabSettings>(key: TKey, value: IndexLabSettings[TKey]) =>
    onChange({ ...settings, [key]: value })
  return (
    <div
      className={cn('grid min-w-0 gap-3', layout === 'columns' && 'workspace-sm:grid-cols-3')}
      data-index-lab-methods
    >
      <label className="grid min-w-0 gap-1 text-sm">
        Normalization
        <select
          className="min-w-0 w-full rounded border border-input bg-background p-2"
          value={settings.normalization}
          onChange={(event) => update('normalization', event.target.value as IndexLabSettings['normalization'])}
        >
          <option value="percentile">Percentile rank</option>
          <option value="minMax">Min-max</option>
          <option value="winsorizedMinMax">Winsorized min-max</option>
          <option value="zScore">Z-score</option>
        </select>
      </label>
      <label className="grid min-w-0 gap-1 text-sm">
        Aggregation
        <select
          className="min-w-0 w-full rounded border border-input bg-background p-2"
          value={settings.aggregation}
          onChange={(event) => update('aggregation', event.target.value as IndexLabSettings['aggregation'])}
        >
          <option value="additive">Weighted average</option>
          <option value="geometric">Geometric mean</option>
        </select>
      </label>
      <label className="grid min-w-0 gap-1 text-sm">
        Missing data
        <select
          className="min-w-0 w-full rounded border border-input bg-background p-2"
          value={settings.missingData}
          onChange={(event) => update('missingData', event.target.value as IndexLabSettings['missingData'])}
        >
          <option value="neutral">Treat missing as neutral</option>
          <option value="zero">Treat missing as zero</option>
        </select>
      </label>
    </div>
  )
}

export function IndexLabControls<TKey extends string>({
  metrics,
  weights,
  totalAbsoluteWeight,
  onWeightChange,
  settings,
  onSettingsChange,
  categoryLabels,
  methodControls,
  layout = 'stacked',
  className,
}: {
  metrics: IndexLabMetric<TKey>[]
  weights: Partial<Record<TKey, number>>
  totalAbsoluteWeight: number
  onWeightChange: (key: TKey, value: number) => void
  settings: IndexLabSettings
  onSettingsChange: (settings: IndexLabSettings) => void
  categoryLabels?: Record<string, string>
  methodControls?: ReactNode
  layout?: 'stacked' | 'columns'
  className?: string
}) {
  const active = metrics.filter((metric) => (weights[metric.key] ?? 0) !== 0)
  return (
    <div
      className={cn(
        'grid min-w-0 gap-4',
        layout === 'columns' && 'workspace-desktop:grid-cols-[minmax(14rem,1fr)_2fr]',
        className,
      )}
      data-index-lab-controls
    >
      <MetricLibraryPanel
        className="min-w-0"
        metrics={metrics}
        weights={weights}
        categoryLabels={categoryLabels}
        onAddMetric={onWeightChange}
        onRemoveMetric={(key) => onWeightChange(key, 0)}
      />
      <div className="min-w-0 space-y-4 rounded border border-border p-3">
        <h3 className="font-semibold">Index equation</h3>
        {active.length ? (
          active.map((metric) => (
            <CompactWeightRow
              key={metric.key}
              metric={metric}
              compact={layout === 'stacked'}
              value={weights[metric.key] ?? 0}
              totalAbsoluteWeight={totalAbsoluteWeight}
              onChange={(value) => onWeightChange(metric.key, value)}
              onRemove={() => onWeightChange(metric.key, 0)}
            />
          ))
        ) : (
          <p className="text-sm text-muted-foreground">Choose metrics from the library to build an index.</p>
        )}
        {methodControls ?? <IndexLabMethodControls settings={settings} onChange={onSettingsChange} layout={layout} />}
      </div>
    </div>
  )
}

export function IndexLabResultCard({
  result,
  selected = false,
  highlighted = false,
  onSelect,
  subtitle,
  details,
  actions,
  scoreLabel = result.score.toFixed(1),
}: {
  result: IndexLabResult
  selected?: boolean
  highlighted?: boolean
  onSelect: () => void
  subtitle?: ReactNode
  details?: ReactNode
  actions?: ReactNode
  scoreLabel?: ReactNode
}) {
  return (
    <div
      data-index-lab-result={result.id}
      className={cn(
        'rounded-lg border border-border bg-background p-2 transition-colors',
        selected && 'border-cyan-300 bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950/35',
        highlighted && !selected && 'border-amber-300/60 dark:border-amber-900/60',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button type="button" aria-pressed={selected} onClick={onSelect} className="min-w-0 flex-1 text-left">
          <div className="line-clamp-1 text-sm font-medium text-foreground">
            #{result.rank} {result.label}
          </div>
          {subtitle ?? (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Coverage {(result.dataCoverageScore * 100).toFixed(0)}%
            </div>
          )}
          {details}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">{scoreLabel}</span>
          {actions}
        </div>
      </div>
    </div>
  )
}

export function IndexLabResults<TResult extends IndexLabResult>({
  results,
  selectedId,
  onSelect,
  query = '',
  onQueryChange,
  renderDetails,
}: {
  results: readonly TResult[]
  selectedId?: string | null
  onSelect: (id: string) => void
  query?: string
  onQueryChange?: (query: string) => void
  renderDetails?: (result: TResult) => ReactNode
}) {
  const normalized = query.trim().toLowerCase()
  const visible = results.filter((result) => `${result.id} ${result.label}`.toLowerCase().includes(normalized))
  return (
    <div className="space-y-2" data-index-lab-results>
      {onQueryChange && (
        <label className="grid min-w-0 gap-1 text-sm">
          Search results
          <input
            type="search"
            className="min-w-0 w-full rounded border border-input bg-background p-2"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
          />
        </label>
      )}
      {visible.map((result) => (
        <IndexLabResultCard
          key={result.id}
          result={result}
          selected={selectedId === result.id}
          onSelect={() => onSelect(result.id)}
          details={selectedId === result.id ? renderDetails?.(result) : undefined}
        />
      ))}
      {!visible.length && <p className="text-sm text-muted-foreground">No results match this search.</p>}
    </div>
  )
}

/** Complete standard Index Lab, with catalog/data/compute supplied by its consumer. */
export function IndexLab<TKey extends string>({
  metrics,
  records,
  initialWeights,
  initialSettings = DEFAULT_INDEX_LAB_SETTINGS,
  compute,
  onResultsChange,
  onSelectionChange,
  categoryLabels,
  className,
}: {
  metrics: IndexLabMetric<TKey>[]
  records: readonly IndexLabRecord<TKey>[]
  initialWeights?: Partial<Record<TKey, number>>
  initialSettings?: IndexLabSettings
  compute?: (state: IndexLabState<TKey>) => readonly IndexLabResult[]
  onResultsChange?: (results: readonly IndexLabResult[]) => void
  onSelectionChange?: (id: string) => void
  categoryLabels?: Record<string, string>
  className?: string
}) {
  const standardCompute = useCallback(
    (state: IndexLabState<TKey>) => computeIndexLabResults(records, metrics, state),
    [records, metrics],
  )
  const controller = useIndexLabController({
    metrics,
    initialWeights,
    initialSettings,
    compute: compute ?? standardCompute,
  })
  useEffect(() => {
    onResultsChange?.(controller.results)
  }, [controller.results, onResultsChange])
  return (
    <section className={cn('space-y-4 text-foreground', className)} aria-label="Index Lab">
      <IndexLabControls
        metrics={metrics}
        weights={controller.state.weights}
        totalAbsoluteWeight={controller.totalAbsoluteWeight}
        onWeightChange={controller.setWeight}
        settings={controller.state.settings}
        onSettingsChange={controller.setSettings}
        categoryLabels={categoryLabels}
      />
      <IndexLabResults
        results={controller.results}
        selectedId={controller.state.selectedResultId}
        onSelect={(id) => {
          controller.selectResult(id)
          onSelectionChange?.(id)
        }}
        query={controller.state.query}
        onQueryChange={controller.setQuery}
      />
    </section>
  )
}
