import { useCallback, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy } from 'lucide-react'
import { DatasetInfo } from '@/components/DatasetInfo'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import { getLevelOptionsForSource } from '@/lib/studyArea'
import { Slider } from '@/components/ui/slider'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import {
  SCORE_BUILDER_BOUNDARY_SOURCE_OPTIONS,
  SCORE_PRESETS,
  SCORE_BUILDER_EXAMPLES,
} from '../constants'
import type {
  ScoreMetricDefinition,
  RobustnessResult,
  ScoredBoundaryRegion,
  ScoreBandSummary,
  ScoreComponentSummary,
  ScoreDataSource,
  ScoreFilterKey,
  ScoreFilterState,
  ScoreMetricKey,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
  ScenarioComparison,
} from '../types'
import { SCORE_DATA_SOURCES, METRIC_CATEGORY_LABELS } from '../types'
import type { MetricRecipe, MetricRecipeSource } from '../lib/metricRecipes'
import type { DatasetProfile } from '../lib/datasetCatalog'
import type { ScoreBuilderExportFormat } from '../lib/exportRegions'
import type { UserDatasetSummary } from '../lib/userDatasets'
import type { UserDatasetUploadResult } from '../hooks/useUserDatasets'
import type { BaselineComparisonResult, BaselineSnapshot } from '../lib/baselineComparison'
import type { PopulationWeightedEquitySummary } from '../lib/populationSummary'
import { formatScore, getUnavailableWeightedMetrics } from '../lib/metrics'
import { presetAppliesToBoundary } from '../lib/presets'
import { getScoreDrivers } from '../lib/scoreDrivers'
import {
  SCORE_BUILDER_SECTION_LABELS,
  SCORE_BUILDER_SECTION_ORDER,
  type ScoreBuilderSectionId,
  useScoreBuilderSections,
} from '../hooks/useScoreBuilderSections'
import { InactiveTermNotice } from './ScoreBuilderBuildView'
import { MetricLibraryPanel, useMetricLibraryGroups } from './MetricLibrary'
import { DensityTab } from './DensityTab'
import { ExamplesTab } from './ExamplesTab'
import { MethodologyTab } from './MethodologyTab'
import { ModelTab } from './ModelTab'
import { RegionsTab } from './RegionsTab'
import { RobustnessTab } from './RobustnessTab'
import { ScorePresetDialog } from './ScorePresetDialog'
import { CustomMetricBuilder } from './ScoreBuilderLeftPanel'
import { clampWeight } from './scoreBuilderPanelUtils'

interface ScoreBuilderSidebarProps {
  className?: string
  loading: boolean
  dataErrors: string[]
  boundarySource: BoundarySource
  onBoundarySourceChange: (source: BoundarySource) => void
  selectedRegionLevel: RegionLevel
  onRegionLevelChange: (level: RegionLevel) => void
  boundaryLevelOptions: Array<{ value: RegionLevel; label: string }>
  /** Built-ins plus the user's recipe metrics. */
  metrics: ScoreMetricDefinition[]
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  onEnableDataSource: (source: ScoreDataSource) => void
  networkCounts: Array<[string, number]>
  selectedNetworks: string[]
  onToggleNetwork: (network: string) => void
  onSelectAllNetworks: () => void
  onClearNetworks: () => void
  showPoints: boolean
  onTogglePoints: () => void
  canUseWalkabilitySourceSurface: boolean
  mapSurface: 'source' | 'boundary'
  onMapSurfaceChange: (surface: 'source' | 'boundary') => void
  enabledDataSources: ScoreDataSource[]
  onToggleDataSource: (source: ScoreDataSource) => void
  weights: ScoreMetricWeightMap
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onApplyPreset: (presetKey: string) => void
  activePresetKey: string | null
  equationPreview: string
  scoreSpread: { min: number; max: number; average: number }
  populationEquitySummary: PopulationWeightedEquitySummary | null
  densityMetric: ScoreMetricKey
  onDensityMetricChange: (metric: ScoreMetricKey) => void
  onBuildDensityScore: (metric: ScoreMetricKey) => void
  densitySummary: { min: number; max: number; median: number; average: number } | null
  densityLeaders: ScoredBoundaryRegion[]
  regions: ScoredBoundaryRegion[]
  totalRegionCount: number
  excludedRegionCount: number
  scoreFilters: ScoreFilterState
  onToggleScoreFilter: (filter: ScoreFilterKey) => void
  methodSettings: ScoreMethodSettings
  onMethodSettingsChange: (settings: ScoreMethodSettings) => void
  componentSummaries: ScoreComponentSummary[]
  robustnessResults: RobustnessResult[]
  scoreBands: ScoreBandSummary[]
  scenarioComparison: ScenarioComparison | null
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
  activeExampleKey: string | null
  onApplyExample: (key: string) => void
  isDesktop: boolean
  customMetricRecipes: MetricRecipe[]
  datasetProfiles: Partial<Record<MetricRecipeSource, DatasetProfile>>
  onCreateCustomMetric: (recipe: MetricRecipe) => void
  onRemoveCustomMetric: (id: string) => void
  userDatasets: UserDatasetSummary[]
  onUploadUserDataset: (file: File, label: string) => Promise<UserDatasetUploadResult>
  onRemoveUserDataset: (id: string) => Promise<void> | void
  baseline: BaselineSnapshot | null
  baselineComparison: BaselineComparisonResult | null
  onPinBaseline: () => void
  onClearBaseline: () => void
}

export function ScoreBuilderSidebar({
  className,
  loading,
  dataErrors,
  boundarySource,
  onBoundarySourceChange,
  selectedRegionLevel,
  onRegionLevelChange,
  boundaryLevelOptions,
  metrics,
  onAddMetric,
  onEnableDataSource,
  networkCounts,
  selectedNetworks,
  onToggleNetwork,
  onSelectAllNetworks,
  onClearNetworks,
  showPoints,
  onTogglePoints,
  canUseWalkabilitySourceSurface,
  mapSurface,
  onMapSurfaceChange,
  enabledDataSources,
  onToggleDataSource,
  weights,
  onWeightChange,
  onApplyPreset,
  activePresetKey,
  equationPreview,
  scoreSpread,
  populationEquitySummary,
  densityMetric,
  onDensityMetricChange,
  onBuildDensityScore,
  densitySummary,
  densityLeaders,
  regions,
  totalRegionCount,
  excludedRegionCount,
  scoreFilters,
  onToggleScoreFilter,
  methodSettings,
  onMethodSettingsChange,
  componentSummaries,
  robustnessResults,
  scoreBands,
  scenarioComparison,
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
  activeExampleKey,
  onApplyExample,
  isDesktop,
  customMetricRecipes,
  datasetProfiles,
  onCreateCustomMetric,
  onRemoveCustomMetric,
  userDatasets,
  onUploadUserDataset,
  onRemoveUserDataset,
  baseline,
  baselineComparison,
  onPinBaseline,
  onClearBaseline,
}: ScoreBuilderSidebarProps) {
  const [shareStatus, setShareStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])
  const enabledSourceSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const comparisonSet = useMemo(() => new Set(comparisonIds), [comparisonIds])
  const displayedBoundarySource = canUseWalkabilitySourceSurface && mapSurface === 'source' ? undefined : boundarySource

  const activeExample = useMemo(
    () => SCORE_BUILDER_EXAMPLES.find((example) => example.key === activeExampleKey) || null,
    [activeExampleKey],
  )
  const activePreset = useMemo(
    () => SCORE_PRESETS.find((preset) => preset.key === activePresetKey) || null,
    [activePresetKey],
  )
  const visiblePresets = useMemo(
    () => SCORE_PRESETS.filter((preset) => presetAppliesToBoundary(preset, boundarySource)),
    [boundarySource],
  )
  const selectedRegionDrivers = useMemo(
    () => (selectedRegion ? getScoreDrivers(selectedRegion, weights, 2) : []),
    [selectedRegion, weights],
  )
  const totalAbsoluteWeight = useMemo(() => {
    return metrics.reduce((sum, metric) => sum + Math.abs(weights[metric.key] ?? 0), 0)
  }, [metrics, weights])
  const activeMetricCount = useMemo(
    () => metrics.filter((metric) => (weights[metric.key] ?? 0) !== 0).length,
    [metrics, weights],
  )
  const unavailableTerms = useMemo(
    () => getUnavailableWeightedMetrics(metrics, weights, enabledDataSources, boundarySource),
    [boundarySource, enabledDataSources, metrics, weights],
  )
  const metricGroups = useMetricLibraryGroups(metrics, '')

  const [showAllEquationMetrics, setShowAllEquationMetrics] = useState(false)
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)
  const { activeSection, expandedSections, scrollContainerRef, scrollToSection, setSectionRef, toggleSection } =
    useScoreBuilderSections(isDesktop)

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

  const [equationCopied, setEquationCopied] = useState(false)
  const handleCopyEquation = useCallback(async () => {
    try {
      await navigator.clipboard?.writeText(equationPreview)
      setEquationCopied(true)
      window.setTimeout(() => setEquationCopied(false), 1800)
    } catch {
      // Clipboard may be unavailable; the equation text stays visible for manual copy.
    }
  }, [equationPreview])

  const renderSectionHeader = (sectionId: ScoreBuilderSectionId) => {
    const sectionOpen = expandedSections[sectionId]
    return (
      <button
        type="button"
        onClick={() => toggleSection(sectionId)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={sectionOpen}
      >
        <h2 className="text-sm font-semibold text-foreground">{SCORE_BUILDER_SECTION_LABELS[sectionId]}</h2>
        {sectionOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'z-10 flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur',
        className,
      )}
    >
      <div className="border-b border-border bg-background/95 p-4">
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-xl font-bold text-foreground">Index Lab</h1>
          {onShareUrl && (
            <button
              type="button"
              data-score-builder-share="true"
              onClick={handleShare}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {shareStatus === 'copied' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {shareStatus === 'copying'
                ? 'Copying'
                : shareStatus === 'copied'
                  ? 'Copied'
                  : shareStatus === 'failed'
                    ? 'Failed'
                    : 'Share'}
            </button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          {activeExample
            ? `${activeExample.label}: ${activeExample.question}`
            : activePreset
              ? `${activePreset.label}: ${activePreset.description}`
              : 'Choose a PG scenario or build a transparent scoring equation.'}
        </p>
      </div>

      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        <DatasetInfo dataset={DATASETS.scoreBuilder} />

        {/* Section nav ribbon */}
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
          <div className="flex gap-1.5 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SCORE_BUILDER_SECTION_ORDER.map((sectionId) => (
              <button
                key={sectionId}
                type="button"
                data-score-builder-section-nav={sectionId}
                onClick={() => scrollToSection(sectionId)}
                className={cn(
                  'shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  activeSection === sectionId
                    ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100'
                    : 'border-input text-muted-foreground hover:text-foreground',
                )}
              >
                {SCORE_BUILDER_SECTION_LABELS[sectionId]}
              </button>
            ))}
          </div>
        </div>

        {/* EXAMPLES */}
        <section
          ref={(el) => setSectionRef('examples', el)}
          data-score-builder-section-id="examples"
          data-score-builder-section="examples"
          className="border-b border-border"
        >
          {renderSectionHeader('examples')}
          {expandedSections.examples && (
            <ExamplesTab className="px-4 pb-4 pt-0" activeExampleKey={activeExampleKey} onApplyExample={onApplyExample}>
              <CustomMetricBuilder
                recipes={customMetricRecipes}
                datasetProfiles={datasetProfiles}
                onCreate={onCreateCustomMetric}
                onRemove={onRemoveCustomMetric}
                userDatasets={userDatasets}
                onUploadUserDataset={onUploadUserDataset}
                onRemoveUserDataset={onRemoveUserDataset}
              />
            </ExamplesTab>
          )}
        </section>

        {/* SETUP */}
        <section
          ref={(el) => setSectionRef('setup', el)}
          data-score-builder-section-id="setup"
          data-score-builder-section="setup"
          className="border-b border-border"
        >
          {renderSectionHeader('setup')}
          {expandedSections.setup && (
            <div className="pb-4">
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
                levelSelectId="score-builder-level"
                dataPrefix="score-builder"
              />

              <div className="mx-4 mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-base font-semibold text-foreground">{regions.length}</div>
                  <div className="text-xs text-muted-foreground">regions</div>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-base font-semibold text-foreground">{enabledDataSources.length}</div>
                  <div className="text-xs text-muted-foreground">sources</div>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-base font-semibold text-foreground">{formatScore(scoreSpread.average)}</div>
                  <div className="text-xs text-muted-foreground">avg score</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* METRICS */}
        <section
          ref={(el) => setSectionRef('dataSources', el)}
          data-score-builder-section-id="dataSources"
          data-score-builder-section="dataSources"
          className="border-b border-border"
        >
          {renderSectionHeader('dataSources')}
          {expandedSections.dataSources && (
            <div className="pb-4">
              <MetricLibraryPanel
                weights={weights}
                metrics={metrics}
                boundarySource={boundarySource}
                onAddMetric={onAddMetric}
                onRemoveMetric={(metric) => onWeightChange(metric, 0)}
                renderCategoryExtras={(category) =>
                  category === 'airQuality' && enabledSourceSet.has('airQuality') ? (
                    <div className="mb-1.5 space-y-1 rounded-md border border-cyan-200 bg-cyan-50/40 p-2 dark:border-cyan-900 dark:bg-cyan-950/20">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{selectedNetworks.length} networks</span>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={onSelectAllNetworks}
                            className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
                          >
                            All
                          </button>
                          <button
                            type="button"
                            onClick={onClearNetworks}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            None
                          </button>
                        </div>
                      </div>
                      <div className="max-h-28 space-y-0.5 overflow-y-auto">
                        {networkCounts.map(([network, count]) => (
                          <button
                            key={network}
                            type="button"
                            onClick={() => onToggleNetwork(network)}
                            className={cn(
                              'flex w-full items-center justify-between rounded px-2 py-1 text-xs transition-colors',
                              selectedNetworkSet.has(network)
                                ? 'bg-cyan-100 text-cyan-900 dark:bg-cyan-950/50 dark:text-cyan-100'
                                : 'text-muted-foreground hover:text-foreground',
                            )}
                          >
                            <span className="truncate">{network}</span>
                            <span>{count.toLocaleString()}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null
                }
              />

              <div className="border-t border-border px-4 pt-3">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Data sources · {enabledDataSources.length} on
                </div>
                <div className="space-y-2">
                  {/* Point overlays draw from the data sources, not the boundaries. */}
                  <button
                    type="button"
                    onClick={onTogglePoints}
                    aria-pressed={showPoints}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors',
                      showPoints
                        ? 'border-sky-500/60 bg-sky-50 text-sky-900 dark:bg-sky-950/40 dark:text-sky-100'
                        : 'border-input bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span className="min-w-0 truncate font-medium">Source points on map</span>
                    <span
                      className={cn('text-xs font-semibold', showPoints ? 'text-sky-600' : 'text-muted-foreground')}
                    >
                      {showPoints ? 'ON' : 'OFF'}
                    </span>
                  </button>
                  {SCORE_DATA_SOURCES.map((ds) => {
                    const active = enabledSourceSet.has(ds.id)
                    const orphanedCount = [...unavailableTerms.values()].filter(
                      (entry) => entry.source === ds.id,
                    ).length
                    return (
                      <button
                        key={ds.id}
                        type="button"
                        aria-label={`${ds.label} ${ds.id === 'bcAssessment' ? 'Property' : ''} ${active ? 'ON' : 'OFF'}`}
                        title={ds.description}
                        onClick={() => onToggleDataSource(ds.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors',
                          active
                            ? 'border-cyan-500/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100'
                            : orphanedCount > 0
                              ? 'border-amber-400 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100'
                              : 'border-input bg-background text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <span className="min-w-0 truncate font-medium">{ds.label}</span>
                        <span className={cn('text-xs font-semibold', active ? 'text-cyan-600' : 'text-muted-foreground')}>
                          {active ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* EQUATION */}
        <section
          ref={(el) => setSectionRef('equation', el)}
          data-score-builder-section-id="equation"
          data-score-builder-section="equation"
          className="border-b border-border"
        >
          {renderSectionHeader('equation')}
          {expandedSections.equation && (
            <div className="space-y-3 px-4 pb-4">
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Preset
                    </div>
                    <div className="mt-0.5 text-sm font-semibold text-foreground">
                      {activePreset?.label || activeExample?.label || 'Custom index'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPresetDialogOpen(true)}
                    className="shrink-0 rounded-md border border-input px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    Browse
                  </button>
                </div>
                <div className="text-xs text-muted-foreground">
                  {activePreset
                    ? activePreset.description
                    : activeExample
                      ? activeExample.description
                      : 'Custom weights saved in the URL.'}
                </div>
                <ScorePresetDialog
                  open={presetDialogOpen}
                  onOpenChange={setPresetDialogOpen}
                  presets={visiblePresets}
                  activePresetKey={activePresetKey}
                  onApplyPreset={onApplyPreset}
                />
              </div>

              <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background p-2">
                <div>
                  <div className="text-xs font-semibold text-foreground">
                    {showAllEquationMetrics ? 'All metrics' : 'Active terms'}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {activeMetricCount} active · {totalAbsoluteWeight.toLocaleString()} total influence
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowAllEquationMetrics((current) => !current)}
                  className="rounded-md border border-input px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {showAllEquationMetrics ? 'Show active' : 'All metrics'}
                </button>
              </div>

              <div className="space-y-4">
                {metricGroups.map(({ category, metrics: categoryMetrics }) => (
                  <div key={category}>
                    {(showAllEquationMetrics || categoryMetrics.some((metric) => weights[metric.key] !== 0)) && (
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] || category}
                      </div>
                    )}
                    <div className="space-y-2">
                      {categoryMetrics
                        .filter((metric) => showAllEquationMetrics || weights[metric.key] !== 0)
                        .map((metric) => (
                          <div
                            key={metric.key}
                            className={cn(
                              'rounded-lg border p-3',
                              unavailableTerms.has(metric.key)
                                ? 'border-dashed border-amber-400 bg-amber-50/40 dark:border-amber-800 dark:bg-amber-950/20'
                                : weights[metric.key] !== 0
                                  ? 'border-cyan-300/60 bg-cyan-50/50 dark:border-cyan-900/60 dark:bg-cyan-950/20'
                                  : 'border-border bg-muted/25',
                            )}
                          >
                            {unavailableTerms.get(metric.key) && (
                              <InactiveTermNotice
                                metric={metric}
                                unavailable={unavailableTerms.get(metric.key)!}
                                onEnableDataSource={onEnableDataSource}
                                className="mb-2"
                              />
                            )}
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div>
                                <div className="text-xs font-semibold text-foreground">{metric.label}</div>
                                <div className="text-xs text-muted-foreground">{metric.description}</div>
                              </div>
                              <input
                                type="number"
                                min={-100}
                                max={100}
                                step={1}
                                value={weights[metric.key]}
                                onChange={(event) => {
                                  const parsed = Number.parseFloat(event.target.value)
                                  onWeightChange(metric.key, Number.isFinite(parsed) ? clampWeight(parsed) : 0)
                                }}
                                className="w-16 rounded border border-input bg-background px-2 py-1 text-right text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                              />
                            </div>
                            <Slider
                              min={-100}
                              max={100}
                              step={1}
                              value={[weights[metric.key]]}
                              onValueChange={(values) => onWeightChange(metric.key, clampWeight(values[0] ?? 0))}
                              className="[&_[data-radix-slider-range]]:bg-cyan-500"
                            />
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
                {!showAllEquationMetrics && activeMetricCount === 0 && (
                  <div className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    No active terms yet. Switch to all metrics or apply a preset.
                  </div>
                )}
              </div>

              <div className="rounded-md border border-border bg-background p-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Equation</span>
                  <button
                    type="button"
                    onClick={handleCopyEquation}
                    title="Copy equation to clipboard"
                    className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {equationCopied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {equationCopied ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="font-mono text-xs text-foreground">{equationPreview}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  |weights| sum: {totalAbsoluteWeight.toLocaleString()}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* METHODOLOGY */}
        <section
          ref={(el) => setSectionRef('methodology', el)}
          data-score-builder-section-id="methodology"
          data-score-builder-section="methodology"
          className="border-b border-border"
        >
          {renderSectionHeader('methodology')}
          {expandedSections.methodology && (
            <MethodologyTab
              className="px-4 pb-4 pt-0"
              weights={weights}
              metrics={metrics}
              methodSettings={methodSettings}
              componentSummaries={componentSummaries}
              activePreset={activePreset}
            />
          )}
        </section>

        {/* MODEL */}
        <section
          ref={(el) => setSectionRef('model', el)}
          data-score-builder-section-id="model"
          data-score-builder-section="model"
          className="border-b border-border"
        >
          {renderSectionHeader('model')}
          {expandedSections.model && (
            <ModelTab
              className="px-4 pb-4 pt-0"
              weights={weights}
              metrics={metrics}
              totalAbsoluteWeight={totalAbsoluteWeight}
              scoreFilters={scoreFilters}
              onToggleScoreFilter={onToggleScoreFilter}
              methodSettings={methodSettings}
              onMethodSettingsChange={onMethodSettingsChange}
              scoreBands={scoreBands}
              scenarioComparison={scenarioComparison}
              regions={regions}
              totalRegionCount={totalRegionCount}
              excludedRegionCount={excludedRegionCount}
              scoreSpread={scoreSpread}
              activePreset={activePreset}
            />
          )}
        </section>

        {/* ROBUSTNESS */}
        <section
          ref={(el) => setSectionRef('robustness', el)}
          data-score-builder-section-id="robustness"
          data-score-builder-section="robustness"
          className="border-b border-border"
        >
          {renderSectionHeader('robustness')}
          {expandedSections.robustness && (
            <RobustnessTab
              className="px-4 pb-4 pt-0"
              robustnessResults={robustnessResults}
              scenarioComparison={scenarioComparison}
            />
          )}
        </section>

        {/* DENSITY */}
        <section
          ref={(el) => setSectionRef('density', el)}
          data-score-builder-section-id="density"
          data-score-builder-section="density"
          className="border-b border-border"
        >
          {renderSectionHeader('density')}
          {expandedSections.density && (
            <DensityTab
              className="px-4 pb-4"
              densityMetric={densityMetric}
              onDensityMetricChange={onDensityMetricChange}
              onBuildDensityScore={onBuildDensityScore}
              densitySummary={densitySummary}
              densityLeaders={densityLeaders}
              selectedRegion={selectedRegion}
              onRegionSelect={onRegionSelect}
            />
          )}
        </section>

        {/* REGIONS */}
        <section
          ref={(el) => setSectionRef('regions', el)}
          data-score-builder-section-id="regions"
          data-score-builder-section="regions"
          className="pb-4"
        >
          {renderSectionHeader('regions')}
          {expandedSections.regions && (
            <RegionsTab
              className="px-4"
              loading={loading}
              dataErrors={dataErrors}
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
          )}
        </section>
      </div>
    </div>
  )
}
