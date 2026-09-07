import { useMemo, useState } from 'react'
import { Map as MapIcon, Plus } from 'lucide-react'
import type { AirMonitor, BoundarySource, RegionLevel } from '@/maps/airquality'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { getLevelOptionsForSource } from '@/lib/studyArea'
import { cn } from '@/lib/utils'
import { SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS } from '../constants'
import { getUnavailableWeightedMetrics } from '../lib/metrics'
import { MetricLibraryPanel, MetricPickerDialog } from './MetricLibrary'
import { formatScore } from '../lib/metrics'
import type { BaselineComparisonResult, BaselineSnapshot } from '../lib/baselineComparison'
import type { DatasetProfile } from '../lib/datasetCatalog'
import type { MetricRecipe, MetricRecipeSource } from '../lib/metricRecipes'
import type { UserDatasetSummary } from '../lib/userDatasets'
import type { UserDatasetUploadResult } from '../hooks/useUserDatasets'
import type {
  ScoredBoundaryRegion,
  ScoreDataSource,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMetricRangeMap,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'
import { BaselineComparisonCard } from './BaselineComparisonCard'
import { PriorityMode, WeightDistribution } from './EquationComposer'
import { IndexLabHeader } from './IndexLabHeader'
import { MethodControls } from './MethodControls'
import { NormalizationPreview } from './NormalizationPreview'
import { ScoreBuilderMap } from './ScoreBuilderMap'
import { CustomMetricBuilder } from './ScoreBuilderLeftPanel'
import { CompactWeightRow } from './WeightRow'
import { getDefaultMetricWeight } from './scoreBuilderPanelUtils'

// Re-exported for the callers that historically imported the notice from here.
export { InactiveTermNotice } from './WeightRow'
export { IndexLabHeader, ViewModeToggle } from './IndexLabHeader'

export interface ScoreBuilderBuildViewProps {
  weights: ScoreMetricWeightMap
  /** Built-ins plus the user's recipe metrics. */
  metrics: ScoreMetricDefinition[]
  enabledDataSources: ScoreDataSource[]
  onEnableDataSource: (source: ScoreDataSource) => void
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  totalAbsoluteWeight: number
  methodSettings: ScoreMethodSettings
  onMethodSettingsChange: (settings: ScoreMethodSettings) => void
  boundarySource: BoundarySource
  onBoundarySourceChange: (source: BoundarySource) => void
  selectedRegionLevel: RegionLevel
  onRegionLevelChange: (level: RegionLevel) => void
  boundaryLevelOptions: Array<{ value: RegionLevel; label: string }>
  equationPreview: string
  scoreSpread: { min: number; max: number; average: number }
  scoredRegions: ScoredBoundaryRegion[]
  metricRanges: ScoreMetricRangeMap
  loading: boolean
  activeRecipeLabel: string
  activeRecipeDescription: string
  baseline: BaselineSnapshot | null
  baselineComparison: BaselineComparisonResult | null
  onPinBaseline: () => void
  onClearBaseline: () => void
  monitors: AirMonitor[]
  showPoints: boolean
  regionFillColors: Record<string, string> | null
  onSwitchToExplore: () => void
  onOpenRecipes: () => void
  onOpenSettings: () => void
  onUndo: () => void
  onRedo: () => void
  canUndo: boolean
  canRedo: boolean
  customMetricRecipes: MetricRecipe[]
  datasetProfiles: Partial<Record<MetricRecipeSource, DatasetProfile>>
  onCreateCustomMetric: (recipe: MetricRecipe) => void
  onRemoveCustomMetric: (id: string) => void
  userDatasets: UserDatasetSummary[]
  onUploadUserDataset: (file: File, label: string) => Promise<UserDatasetUploadResult>
  onRemoveUserDataset: (id: string) => Promise<void> | void
}

/**
 * Full-width "Build" mode for the Index Lab: metric library, equation canvas with the
 * method pipeline inline, and a live preview column. Shares all state with the map-first
 * "Explore" mode — only the layout changes.
 *
 * Below `lg` the library and preview map are dropped: metrics are added through the
 * picker dialog from the equation card, and live results sit directly under it so a
 * weight change and its effect are never a screen apart.
 */
export function ScoreBuilderBuildView({
  weights,
  metrics,
  enabledDataSources,
  onEnableDataSource,
  onWeightChange,
  onAddMetric,
  totalAbsoluteWeight,
  methodSettings,
  onMethodSettingsChange,
  boundarySource,
  onBoundarySourceChange,
  selectedRegionLevel,
  onRegionLevelChange,
  boundaryLevelOptions,
  equationPreview,
  scoreSpread,
  scoredRegions,
  metricRanges,
  loading,
  activeRecipeLabel,
  activeRecipeDescription,
  baseline,
  baselineComparison,
  onPinBaseline,
  onClearBaseline,
  monitors,
  showPoints,
  regionFillColors,
  onSwitchToExplore,
  onOpenRecipes,
  onOpenSettings,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  customMetricRecipes,
  datasetProfiles,
  onCreateCustomMetric,
  onRemoveCustomMetric,
  userDatasets,
  onUploadUserDataset,
  onRemoveUserDataset,
}: ScoreBuilderBuildViewProps) {
  const isWide = useMediaQuery('(min-width: 1024px)')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [builderMode, setBuilderMode] = useState<'formula' | 'priority'>('formula')
  const [focusedMetric, setFocusedMetric] = useState<ScoreMetricKey | null>(null)
  const [priorityOrder, setPriorityOrder] = useState<ScoreMetricKey[]>([])

  const activeTerms = useMemo(() => metrics.filter((metric) => weights[metric.key] !== 0), [metrics, weights])
  const unavailableTerms = useMemo(
    () => getUnavailableWeightedMetrics(metrics, weights, enabledDataSources, boundarySource),
    [boundarySource, enabledDataSources, metrics, weights],
  )
  const activeTermKeys = useMemo(() => activeTerms.map((metric) => metric.key), [activeTerms])
  const activePriorityOrder = useMemo(() => {
    const activeSet = new Set(activeTermKeys)
    return [
      ...priorityOrder.filter((key) => activeSet.has(key)),
      ...activeTermKeys.filter((key) => !priorityOrder.includes(key)),
    ]
  }, [activeTermKeys, priorityOrder])
  const previewMetric = focusedMetric && weights[focusedMetric] !== 0 ? focusedMetric : activeTerms[0]?.key ?? null

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

  const liveResults = <LiveResults scoredRegions={scoredRegions} scoreSpread={scoreSpread} />

  return (
    <div className="flex h-full min-h-0 flex-col bg-muted/30">
      <IndexLabHeader
        mode="build"
        onSwitchToExplore={onSwitchToExplore}
        title={activeRecipeLabel}
        description={activeRecipeDescription}
        onOpenRecipes={onOpenRecipes}
        onOpenSettings={onOpenSettings}
        onUndo={onUndo}
        onRedo={onRedo}
        canUndo={canUndo}
        canRedo={canRedo}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)_minmax(19rem,24rem)] lg:overflow-hidden">
        {/* The 75-card library only earns its column on wide screens; elsewhere the picker dialog does the job. */}
        {isWide && (
          <MetricLibraryPanel
            weights={weights}
            metrics={metrics}
            boundarySource={boundarySource}
            onAddMetric={onAddMetric}
            onRemoveMetric={(metric) => onWeightChange(metric, 0)}
            className="border-b border-border lg:min-h-0 lg:overflow-y-auto lg:border-b-0 lg:border-r"
          />
        )}

        <div className="space-y-3 p-3 sm:p-4 lg:min-h-0 lg:overflow-y-auto">
          <StudyAreaSelector<BoundarySource, RegionLevel>
            source={boundarySource}
            sourceOptions={SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS}
            level={selectedRegionLevel}
            levelOptions={boundaryLevelOptions}
            levelOptionsForSource={getLevelOptionsForSource}
            onSourceChange={onBoundarySourceChange}
            onLevelChange={onRegionLevelChange}
            sectionClassName="rounded-lg border border-border bg-background p-3"
            dataPrefix="score-builder-build"
          />

          <section className="rounded-lg border border-border bg-background p-3" data-score-builder-section="equation">
            <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Equation</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {builderMode === 'formula'
                    ? 'Slide how much each metric matters. The +/− toggle sets whether high values raise or lower the score.'
                    : 'Rank the metrics from most to least important, then apply to set the weights.'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="inline-flex rounded-md border border-input bg-muted/20 p-0.5" role="group" aria-label="Builder mode">
                  {(
                    [
                      ['formula', 'Formula'],
                      ['priority', 'Priority'],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={builderMode === mode}
                      onClick={() => setBuilderMode(mode)}
                      className={cn(
                        'rounded px-2 py-1.5 text-xs font-medium transition-colors md:py-1',
                        builderMode === mode
                          ? 'bg-background text-foreground shadow-sm'
                          : 'text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {builderMode === 'priority' && (
                  <button
                    type="button"
                    onClick={applyPriorityWeights}
                    disabled={activePriorityOrder.length === 0}
                    className="inline-flex h-9 items-center rounded-md border border-cyan-500/50 bg-cyan-50 px-2.5 text-xs font-medium text-cyan-800 transition-colors hover:bg-cyan-100 disabled:opacity-50 dark:bg-cyan-950/30 dark:text-cyan-100 md:h-8"
                  >
                    Apply ranking
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="inline-flex h-9 items-center gap-1 rounded-md border border-input bg-background px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-cyan-400 hover:text-foreground md:h-8"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add metric
                </button>
              </div>
            </div>
            <WeightDistribution weights={weights} totalAbsoluteWeight={totalAbsoluteWeight} metrics={metrics} />

            {activeTerms.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
                No active metrics. Add one to start the equation.
              </div>
            ) : builderMode === 'priority' ? (
              <div className="mt-3">
                <PriorityMode
                  order={activePriorityOrder}
                  weights={weights}
                  metrics={metrics}
                  onMove={movePriority}
                  onFocus={setFocusedMetric}
                  onRemove={(metric) => onWeightChange(metric, 0)}
                />
              </div>
            ) : (
              <div className="mt-3 space-y-1.5">
                {activeTerms.map((metric) => (
                  <CompactWeightRow
                    key={metric.key}
                    metric={metric}
                    value={weights[metric.key]}
                    totalAbsoluteWeight={totalAbsoluteWeight}
                    unavailable={unavailableTerms.get(metric.key) ?? null}
                    onEnableDataSource={onEnableDataSource}
                    onChange={(value) => onWeightChange(metric.key, value)}
                    onRemove={() => onWeightChange(metric.key, 0)}
                    onFocus={() => setFocusedMetric(metric.key)}
                  />
                ))}
              </div>
            )}
          </section>

          {!isWide && liveResults}

          <section className="rounded-lg border border-border bg-background p-3">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Method pipeline
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <span className="rounded-md border border-border bg-muted/30 px-2 py-1">1 · Normalize each metric</span>
              <span aria-hidden="true">→</span>
              <span className="rounded-md border border-border bg-muted/30 px-2 py-1">2 · Apply weights</span>
              <span aria-hidden="true">→</span>
              <span className="rounded-md border border-border bg-muted/30 px-2 py-1">3 · Aggregate to a score</span>
            </div>
            <MethodControls
              weights={weights}
              metrics={metrics}
              methodSettings={methodSettings}
              onMethodSettingsChange={onMethodSettingsChange}
            />
          </section>

          <section className="rounded-lg border border-border bg-background p-3">
            <div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Formula</div>
            <div className="break-words font-mono text-xs text-foreground">{equationPreview}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              |weights| sum: {totalAbsoluteWeight.toLocaleString()} — weights are divided by total influence, so they
              do not need to equal 100.
            </div>
          </section>

          {isWide && (
            <NormalizationPreview
              metricKey={previewMetric}
              regions={scoredRegions}
              metricRanges={metricRanges}
              metrics={metrics}
            />
          )}

          <CustomMetricBuilder
            recipes={customMetricRecipes}
            datasetProfiles={datasetProfiles}
            onCreate={onCreateCustomMetric}
            onRemove={onRemoveCustomMetric}
            userDatasets={userDatasets}
            onUploadUserDataset={onUploadUserDataset}
            onRemoveUserDataset={onRemoveUserDataset}
          />

          {!isWide && (
            <BaselineComparisonCard
              baseline={baseline}
              comparison={baselineComparison}
              onPinBaseline={onPinBaseline}
              onClearBaseline={onClearBaseline}
            />
          )}
        </div>

        {isWide && (
          <div className="space-y-3 p-4 lg:min-h-0 lg:overflow-y-auto lg:border-l">
            <section className="overflow-hidden rounded-lg border border-border bg-background">
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Live preview
                </div>
                <button
                  type="button"
                  onClick={onSwitchToExplore}
                  className="inline-flex h-7 items-center gap-1.5 rounded-md border border-input bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <MapIcon className="h-3.5 w-3.5" />
                  Open full map
                </button>
              </div>
              <div className="relative h-64">
                <ScoreBuilderMap
                  regions={scoredRegions}
                  selectedRegionId={null}
                  monitors={monitors}
                  showPoints={showPoints}
                  onRegionClick={() => onSwitchToExplore()}
                  regionFillColors={regionFillColors}
                  loading={loading}
                />
              </div>
            </section>

            {liveResults}

            <BaselineComparisonCard
              baseline={baseline}
              comparison={baselineComparison}
              onPinBaseline={onPinBaseline}
              onClearBaseline={onClearBaseline}
            />
          </div>
        )}
      </div>

      <MetricPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        weights={weights}
        metrics={metrics}
        boundarySource={boundarySource}
        onPick={(metric) => {
          onAddMetric(metric, getDefaultMetricWeight(metric))
          setFocusedMetric(metric)
        }}
      />
    </div>
  )
}

function LiveResults({
  scoredRegions,
  scoreSpread,
}: {
  scoredRegions: ScoredBoundaryRegion[]
  scoreSpread: { min: number; max: number; average: number }
}) {
  const topRegions = scoredRegions.slice(0, 5)
  return (
    <section className="rounded-lg border border-border bg-background p-3" data-score-builder-live-results="true">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live results</div>
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
          <div className="text-xs uppercase text-muted-foreground">Regions</div>
          <div className="font-semibold text-foreground">{scoredRegions.length.toLocaleString()}</div>
        </div>
      </div>
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
    </section>
  )
}
