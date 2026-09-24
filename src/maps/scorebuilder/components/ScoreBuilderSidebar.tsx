import { useCallback, useMemo, useState } from 'react'
import { BookOpen, Check, Copy, Hammer, Plus, Settings as SettingsIcon } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { CollapsibleSection, InlineAlert } from '@/components/ui/map-panels'
import { EmptyHint } from '@/components/ui/result-list'
import { DEFAULT_LOCALE } from '@/lib/format'
import { cn } from '@/lib/utils'
import { getLevelOptionsForSource } from '@/lib/studyArea'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import { SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS } from '../constants'
import type {
  ScoreMetricDefinition,
  ScoredBoundaryRegion,
  ScoreDataSource,
  ScoreMetricKey,
  ScoreMetricWeightMap,
} from '../types'
import type { ScoreBuilderExportFormat } from '../lib/exportRegions'
import type { BaselineComparisonResult, BaselineSnapshot } from '../lib/baselineComparison'
import type { CorrelationResult, MetricCorrelation } from '../lib/correlation'
import type { PopulationWeightedEquitySummary } from '../lib/populationSummary'
import { formatScore, getUnavailableWeightedMetrics } from '../lib/metrics'
import { getScoreDrivers } from '../lib/scoreDrivers'
import { CorrelateTab } from './CorrelateTab'
import { DataSourceToggleList } from './DataSourceToggleList'
import { DensityTab } from './DensityTab'
import { WeightDistribution } from './EquationComposer'
import type { MapLens } from './IndexLabHeader'
import { MetricPickerDialog } from './MetricLibrary'
import { RegionsTab } from './RegionsTab'
import { CompactWeightRow } from './WeightRow'
import { getDefaultMetricWeight } from './scoreBuilderPanelUtils'

interface ScoreBuilderSidebarProps {
  className?: string
  loading: boolean
  dataErrors: string[]
  activeRecipeLabel: string
  activeRecipeDescription: string
  boundarySource: BoundarySource
  onBoundarySourceChange: (source: BoundarySource) => void
  selectedRegionLevel: RegionLevel
  onRegionLevelChange: (level: RegionLevel) => void
  boundaryLevelOptions: Array<{ value: RegionLevel; label: string }>
  /** Built-ins plus the user's recipe metrics. */
  metrics: ScoreMetricDefinition[]
  weights: ScoreMetricWeightMap
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  enabledDataSources: ScoreDataSource[]
  onToggleDataSource: (source: ScoreDataSource) => void
  onEnableDataSource: (source: ScoreDataSource) => void
  showPoints: boolean
  onTogglePoints: () => void
  canUseWalkabilitySourceSurface: boolean
  mapSurface: 'source' | 'boundary'
  onMapSurfaceChange: (surface: 'source' | 'boundary') => void
  lens: MapLens
  densityMetric: ScoreMetricKey
  onDensityMetricChange: (metric: ScoreMetricKey) => void
  onBuildDensityScore: (metric: ScoreMetricKey) => void
  densitySummary: { min: number; max: number; median: number; average: number } | null
  densityLeaders: ScoredBoundaryRegion[]
  onToggleCorrelateMode: () => void
  correlateMetricX: ScoreMetricKey
  correlateMetricY: ScoreMetricKey
  onCorrelateMetricXChange: (metric: ScoreMetricKey) => void
  onCorrelateMetricYChange: (metric: ScoreMetricKey) => void
  correlateVisStyle: 'bivariate' | 'residual'
  onCorrelateVisStyleChange: (style: 'bivariate' | 'residual') => void
  correlationResult: CorrelationResult
  correlationTopPairs: MetricCorrelation[]
  onApplyTopPair: (metricX: ScoreMetricKey, metricY: ScoreMetricKey) => void
  scoreSpread: { min: number; max: number; average: number }
  populationEquitySummary: PopulationWeightedEquitySummary | null
  regions: ScoredBoundaryRegion[]
  filteredRegions: ScoredBoundaryRegion[]
  selectedRegion: ScoredBoundaryRegion | null
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  onRegionSelect: (regionId: string) => void
  onClearRegionSelection: () => void
  onOpenRegionInsight: (regionId: string) => void
  comparisonIds: string[]
  comparisonRegions: ScoredBoundaryRegion[]
  onToggleComparison: (regionId: string) => void
  onClearComparison: () => void
  onExport: (format: ScoreBuilderExportFormat) => void
  onShareUrl?: () => Promise<string>
  baseline: BaselineSnapshot | null
  baselineComparison: BaselineComparisonResult | null
  onPinBaseline: () => void
  onClearBaseline: () => void
  onOpenRecipes: () => void
  onOpenSettings: () => void
  onOpenBuild: () => void
}

/**
 * The phone bottom sheet for the Index Lab. It holds only what is useful while
 * looking at the map: the active recipe and its actions, the lens panel when a
 * lens is on, the equation, the study area, and the ranked regions. Method,
 * model, and robustness live behind Settings; loading recipes behind Recipes.
 */
export function ScoreBuilderSidebar({
  className,
  loading,
  dataErrors,
  activeRecipeLabel,
  activeRecipeDescription,
  boundarySource,
  onBoundarySourceChange,
  selectedRegionLevel,
  onRegionLevelChange,
  boundaryLevelOptions,
  metrics,
  weights,
  onWeightChange,
  onAddMetric,
  enabledDataSources,
  onToggleDataSource,
  onEnableDataSource,
  showPoints,
  onTogglePoints,
  canUseWalkabilitySourceSurface,
  mapSurface,
  onMapSurfaceChange,
  lens,
  densityMetric,
  onDensityMetricChange,
  onBuildDensityScore,
  densitySummary,
  densityLeaders,
  onToggleCorrelateMode,
  correlateMetricX,
  correlateMetricY,
  onCorrelateMetricXChange,
  onCorrelateMetricYChange,
  correlateVisStyle,
  onCorrelateVisStyleChange,
  correlationResult,
  correlationTopPairs,
  onApplyTopPair,
  scoreSpread,
  populationEquitySummary,
  regions,
  filteredRegions,
  selectedRegion,
  searchQuery,
  onSearchQueryChange,
  onRegionSelect,
  onClearRegionSelection,
  onOpenRegionInsight,
  comparisonIds,
  comparisonRegions,
  onToggleComparison,
  onClearComparison,
  onExport,
  onShareUrl,
  baseline,
  baselineComparison,
  onPinBaseline,
  onClearBaseline,
  onOpenRecipes,
  onOpenSettings,
  onOpenBuild,
}: ScoreBuilderSidebarProps) {
  const [shareStatus, setShareStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const enabledSourceSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const comparisonSet = useMemo(() => new Set(comparisonIds), [comparisonIds])
  const displayedBoundarySource = canUseWalkabilitySourceSurface && mapSurface === 'source' ? undefined : boundarySource

  const activeTerms = useMemo(() => metrics.filter((metric) => (weights[metric.key] ?? 0) !== 0), [metrics, weights])
  const totalAbsoluteWeight = useMemo(
    () => activeTerms.reduce((sum, metric) => sum + Math.abs(weights[metric.key] ?? 0), 0),
    [activeTerms, weights],
  )
  const unavailableTerms = useMemo(
    () => getUnavailableWeightedMetrics(metrics, weights, enabledDataSources, boundarySource),
    [boundarySource, enabledDataSources, metrics, weights],
  )
  const selectedRegionDrivers = useMemo(
    () => (selectedRegion ? getScoreDrivers(selectedRegion, weights, 2) : []),
    [selectedRegion, weights],
  )

  const handleShare = useCallback(async () => {
    if (!onShareUrl) return
    setShareStatus('copying')
    try {
      await onShareUrl()
      setShareStatus('copied')
      window.setTimeout(() => setShareStatus('idle'), 1800)
    } catch {
      setShareStatus('failed')
      window.setTimeout(() => setShareStatus('idle'), 2400)
    }
  }, [onShareUrl])

  const actionClass =
    'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted'

  return (
    <div
      className={cn('z-10 flex h-full min-h-0 w-full flex-col overflow-hidden bg-background', className)}
      data-score-builder-mobile-sheet="true"
    >
      <div className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        {/* Recipe + actions. The navbar already says "Index Lab", so the sheet leads with the recipe. */}
        <div className="border-b border-border px-4 pb-3 pt-1">
          <div className="text-base font-semibold leading-tight text-foreground">{activeRecipeLabel}</div>
          <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{activeRecipeDescription}</p>
          <div className="mt-2 text-xs text-muted-foreground">
            {regions.length.toLocaleString(DEFAULT_LOCALE)} regions · avg {formatScore(scoreSpread.average)} ·{' '}
            {enabledDataSources.length} source{enabledDataSources.length === 1 ? '' : 's'}
          </div>
          <div className="mt-3 grid grid-cols-[1fr_1fr_auto_auto] gap-2">
            <button type="button" onClick={onOpenRecipes} className={actionClass} aria-label="Browse recipes">
              <BookOpen className="h-4 w-4" />
              Recipes
            </button>
            <button type="button" onClick={onOpenBuild} className={actionClass} aria-label="Open build view">
              <Hammer className="h-4 w-4" />
              Build
            </button>
            {onShareUrl && (
              <button
                type="button"
                data-score-builder-share="true"
                onClick={handleShare}
                className={cn(actionClass, 'min-w-10')}
                aria-label="Copy share link"
                title="Copy share link"
              >
                {shareStatus === 'copied' ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                <span className="sr-only">
                  {shareStatus === 'copying' ? 'Copying' : shareStatus === 'copied' ? 'Copied' : 'Share'}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={onOpenSettings}
              className={cn(actionClass, 'min-w-10 px-0')}
              aria-label="Open index settings"
              title="Index settings"
            >
              <SettingsIcon className="h-4 w-4" />
            </button>
          </div>
        </div>

        {dataErrors.length > 0 && (
          <InlineAlert tone="error" title="Unable to build scores" className="m-4 p-3">
            {dataErrors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </InlineAlert>
        )}

        {lens === 'density' && (
          <section className="border-b border-border px-4 py-3" data-score-builder-lens-panel="density">
            <h2 className="mb-2 text-sm font-semibold text-foreground">Density lens</h2>
            <DensityTab
              densityMetric={densityMetric}
              onDensityMetricChange={onDensityMetricChange}
              onBuildDensityScore={onBuildDensityScore}
              densitySummary={densitySummary}
              densityLeaders={densityLeaders}
              selectedRegion={selectedRegion}
              onRegionSelect={onRegionSelect}
            />
          </section>
        )}

        {lens === 'correlate' && (
          <section className="border-b border-border" data-score-builder-lens-panel="correlate">
            <h2 className="px-4 pt-3 text-sm font-semibold text-foreground">Correlate lens</h2>
            <CorrelateTab
              correlateMode
              onToggleCorrelateMode={onToggleCorrelateMode}
              metricX={correlateMetricX}
              metricY={correlateMetricY}
              onMetricXChange={onCorrelateMetricXChange}
              onMetricYChange={onCorrelateMetricYChange}
              visStyle={correlateVisStyle}
              onVisStyleChange={onCorrelateVisStyleChange}
              result={correlationResult}
              topPairs={correlationTopPairs}
              onApplyTopPair={onApplyTopPair}
            />
          </section>
        )}

        <section className="border-b border-border px-4 py-3" data-score-builder-section="equation">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Equation</h2>
              <div className="text-xs text-muted-foreground">
                {activeTerms.length} active · {totalAbsoluteWeight.toLocaleString(DEFAULT_LOCALE)} total influence
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex min-h-10 items-center gap-1 rounded-md border border-input bg-background px-3 text-xs font-medium text-foreground transition-colors hover:border-cyan-400"
            >
              <Plus className="h-4 w-4" />
              Add metric
            </button>
          </div>
          <WeightDistribution weights={weights} totalAbsoluteWeight={totalAbsoluteWeight} metrics={metrics} />
          {activeTerms.length === 0 ? (
            <EmptyHint className="mt-3 rounded-md p-3">No active terms yet. Add a metric or pick a recipe.</EmptyHint>
          ) : (
            <div className="mt-3 space-y-2">
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
                />
              ))}
            </div>
          )}
        </section>

        <StudyAreaSelector<BoundarySource, RegionLevel>
          source={displayedBoundarySource}
          sourceOptions={SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS}
          level={selectedRegionLevel}
          levelOptions={boundaryLevelOptions}
          levelOptionsForSource={getLevelOptionsForSource}
          onSourceChange={(source) => {
            onBoundarySourceChange(source)
            if (canUseWalkabilitySourceSurface) onMapSurfaceChange('boundary')
            onClearRegionSelection()
          }}
          onSelectedSourceClick={
            canUseWalkabilitySourceSurface
              ? () => {
                  onMapSurfaceChange('source')
                  onClearRegionSelection()
                }
              : undefined
          }
          onLevelChange={(level) => {
            onRegionLevelChange(level)
            onClearRegionSelection()
          }}
          title="Study area"
          levelSelectId="score-builder-level"
          dataPrefix="score-builder"
        />

        <div data-score-builder-section="dataSources">
          <CollapsibleSection
            open={sourcesOpen}
            onOpenChange={setSourcesOpen}
            label={<span className="text-sm font-semibold">Data sources</span>}
            summary={`${enabledDataSources.length} on`}
            className="bg-transparent px-1"
            contentClassName="px-3 pb-4"
          >
            <DataSourceToggleList
              enabledSources={enabledSourceSet}
              onToggleDataSource={onToggleDataSource}
              showPoints={showPoints}
              onTogglePoints={onTogglePoints}
              unavailableTerms={unavailableTerms}
              rowClassName="min-h-11"
            />
          </CollapsibleSection>
        </div>

        <section className="px-4 py-3 pb-6" data-score-builder-section-id="regions">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Regions</h2>
          <RegionsTab
            loading={loading}
            regions={regions}
            filteredRegions={filteredRegions}
            selectedRegion={selectedRegion}
            selectedRegionDrivers={selectedRegionDrivers}
            comparisonRegions={comparisonRegions}
            comparisonSet={comparisonSet}
            weights={weights}
            scoreSpread={scoreSpread}
            populationEquitySummary={populationEquitySummary}
            searchQuery={searchQuery}
            onSearchQueryChange={onSearchQueryChange}
            onRegionSelect={onRegionSelect}
            onClearRegionSelection={onClearRegionSelection}
            onOpenRegionInsight={onOpenRegionInsight}
            onToggleComparison={onToggleComparison}
            onClearComparison={onClearComparison}
            onExport={onExport}
            baseline={baseline}
            baselineComparison={baselineComparison}
            onPinBaseline={onPinBaseline}
            onClearBaseline={onClearBaseline}
          />
        </section>
      </div>

      <MetricPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        weights={weights}
        metrics={metrics}
        boundarySource={boundarySource}
        onPick={(metric) => onAddMetric(metric, getDefaultMetricWeight(metric))}
      />
    </div>
  )
}
