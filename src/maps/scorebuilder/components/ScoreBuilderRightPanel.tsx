import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  BookOpen,
  Check,
  Copy,
  Download,
  Filter,
  FlipHorizontal,
  GripVertical,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoundarySource } from '@/maps/airquality'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AppSelect } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import {
  DENSITY_METRIC_OPTIONS,
  HEALTHYPLAN_PAIRWISE_PRESETS,
  SCORE_ACCESS_THRESHOLD_METRICS,
  SCORE_BUILDER_EXAMPLES,
  SCORE_INDEX_MODULE_LABELS,
  SCORE_METRICS,
  SCORE_METRICS_BY_CATEGORY,
  SCORE_PRESETS,
  getScorePresetMethodology,
} from '../constants'
import { METRIC_CATEGORY_LABELS } from '../types'
import type {
  RobustnessResult,
  ScoredBoundaryRegion,
  ScoreComponentSummary,
  ScoreDataSource,
  ScoreBandSummary,
  ScoreFilterKey,
  ScoreFilterState,
  ScoreMetricKey,
  ScoreMetricRangeMap,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
  ScoreIndexModule,
  ScenarioComparison,
} from '../types'
import { formatMetricValue, formatScore, getMetricDescription, getMetricLabel } from '../lib/metrics'
import { presetAppliesToBoundary } from '../lib/presets'
import { formatDriverDelta, getScoreDrivers, type ScoreDriver } from '../lib/scoreDrivers'
import type { CorrelationResult, MetricCorrelation } from '../lib/correlation'
import { RadarChart } from './RadarChart'
import { ScorePresetDialog } from './ScorePresetDialog'

type RightPanelTab = 'equation' | 'density' | 'correlate' | 'regions'

function formatNormalizationMethod(method: ScoreMethodSettings['normalization']): string {
  if (method === 'percentile') return 'percentile rank'
  if (method === 'winsorizedMinMax') return 'winsorized min-max'
  if (method === 'zScore') return 'z-score'
  return 'min-max'
}

function formatAggregationMethod(method: ScoreMethodSettings['aggregation']): string {
  if (method === 'healthyPlanPairwisePriority') return 'HealthyPlan-style pairwise priority'
  if (method === 'modulePercentileRankedSum') return 'EJI-style module ranked sum'
  if (method === 'accessThreshold') return 'access threshold'
  if (method === 'cumulativeBurden') return 'cumulative burden'
  if (method === 'geometric') return 'geometric mean'
  return 'weighted average'
}

function isHealthyPlanDemographicMetric(metric: (typeof SCORE_METRICS)[number]): boolean {
  return metric.component === 'sensitivity' || metric.category === 'demographics' || metric.category === 'deprivation'
}

function isHealthyPlanEnvironmentMetric(metric: (typeof SCORE_METRICS)[number]): boolean {
  return (
    metric.component === 'environmentalBurden' ||
    metric.component === 'serviceAccess' ||
    metric.component === 'adaptiveCapacity' ||
    metric.category === 'airQuality' ||
    metric.category === 'parksRec' ||
    metric.category === 'heatShade' ||
    metric.category === 'transit' ||
    metric.category === 'walkability'
  )
}

const healthyPlanDemographicMetrics = SCORE_METRICS.filter(isHealthyPlanDemographicMetric)
const healthyPlanEnvironmentMetrics = SCORE_METRICS.filter(isHealthyPlanEnvironmentMetric)

interface ScoreBuilderRightPanelProps {
  className?: string
  loading: boolean
  dataErrors: string[]
  weights: ScoreMetricWeightMap
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onAddMetric: (metric: ScoreMetricKey, value: number) => void
  onApplyPreset: (presetKey: string) => void
  boundarySource: BoundarySource
  activePresetKey: string | null
  hasActiveBoundarySurface: boolean
  equationPreview: string
  metricRanges: ScoreMetricRangeMap
  scoreSpread: { min: number; max: number; average: number }
  densityMetric: ScoreMetricKey
  onDensityMetricChange: (metric: ScoreMetricKey) => void
  onBuildDensityScore: (metric: ScoreMetricKey) => void
  densitySummary: { min: number; max: number; median: number; average: number } | null
  densityLeaders: ScoredBoundaryRegion[]
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
  onExport: (format: 'csv' | 'geojson') => void
  onShareUrl: () => Promise<string>
  activeExampleKey: string | null
  isDesktop: boolean
  correlateMode: boolean
  onToggleCorrelateMode: () => void
  densityMode: boolean
  correlateMetricX: ScoreMetricKey
  correlateMetricY: ScoreMetricKey
  onCorrelateMetricXChange: (metric: ScoreMetricKey) => void
  onCorrelateMetricYChange: (metric: ScoreMetricKey) => void
  correlateVisStyle: 'bivariate' | 'residual'
  onCorrelateVisStyleChange: (style: 'bivariate' | 'residual') => void
  correlationResult: CorrelationResult
  correlationTopPairs: MetricCorrelation[]
  onApplyTopPair: (metricX: ScoreMetricKey, metricY: ScoreMetricKey) => void
}

const MAX_VISIBLE_ROWS = 220

const TAB_LABELS: Record<RightPanelTab, string> = {
  equation: 'Equation',
  density: 'Density',
  correlate: 'Correlate',
  regions: 'Regions',
}

function getDataSourceLabel(source: ScoreDataSource): string {
  if (source === 'airQuality') return 'Air'
  if (source === 'parks') return 'Parks'
  if (source === 'heatShade') return 'Heat/Shade'
  if (source === 'restaurants') return 'Food'
  if (source === 'census') return 'Census'
  if (source === 'bcAssessment') return 'Property'
  if (source === 'crime') return 'Crime'
  if (source === 'transit') return 'Transit'
  if (source === 'walkability') return 'Walk'
  return source
}

function clampWeight(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)))
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

function getCategoryTone(category: string): string {
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

export function ScoreBuilderRightPanel({
  className,
  loading,
  dataErrors,
  weights,
  onWeightChange,
  onAddMetric,
  onApplyPreset,
  boundarySource,
  activePresetKey,
  hasActiveBoundarySurface,
  equationPreview,
  metricRanges,
  scoreSpread,
  densityMetric,
  onDensityMetricChange,
  onBuildDensityScore,
  densitySummary,
  densityLeaders,
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
  activeExampleKey,
  isDesktop,
  correlateMode,
  onToggleCorrelateMode,
  densityMode,
  correlateMetricX,
  correlateMetricY,
  onCorrelateMetricXChange,
  onCorrelateMetricYChange,
  correlateVisStyle,
  onCorrelateVisStyleChange,
  correlationResult,
  correlationTopPairs,
  onApplyTopPair,
}: ScoreBuilderRightPanelProps) {
  const [activeTab, setActiveTab] = useState<RightPanelTab>('regions')
  const [shareStatus, setShareStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (correlateMode) {
      setActiveTab('correlate')
      return
    }
    if (densityMode) {
      setActiveTab('density')
      return
    }
    setActiveTab((current) => {
      if (current === 'correlate' || current === 'density') return hasActiveBoundarySurface ? 'regions' : 'equation'
      return current
    })
  }, [correlateMode, densityMode, hasActiveBoundarySurface])

  const tabOrder = useMemo<RightPanelTab[]>(() => {
    const tabs: RightPanelTab[] = ['equation']
    if (densityMode) tabs.push('density')
    if (correlateMode) tabs.push('correlate')
    if (hasActiveBoundarySurface) tabs.push('regions')
    return tabs
  }, [correlateMode, densityMode, hasActiveBoundarySurface])

  useEffect(() => {
    if (!hasActiveBoundarySurface && activeTab === 'regions') {
      setActiveTab('equation')
    }
  }, [activeTab, hasActiveBoundarySurface])

  const comparisonSet = useMemo(() => new Set(comparisonIds), [comparisonIds])
  const visibleRows = useMemo(() => filteredRegions.slice(0, MAX_VISIBLE_ROWS), [filteredRegions])
  const topRegions = useMemo(() => regions.slice(0, 3), [regions])

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
    return SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
  }, [weights])
  const handleShare = async () => {
    setShareStatus('copying')
    try {
      await onShareUrl()
      setShareStatus('copied')
      window.setTimeout(() => setShareStatus('idle'), 1800)
    } catch {
      setShareStatus('failed')
      window.setTimeout(() => setShareStatus('idle'), 2400)
    }
  }

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border bg-background/95 shadow-xl backdrop-blur',
        className,
      )}
      data-score-builder-right-panel="true"
    >
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-bold text-foreground">
              {activeExample?.label || activePreset?.label || 'Custom index'}
            </h1>
            <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
              {activeExample
                ? activeExample.question
                : activePreset
                  ? activePreset.description
                  : 'Custom weights saved in the URL.'}
            </p>
          </div>
          <button
            type="button"
            data-score-builder-share="true"
            onClick={handleShare}
            className="inline-flex shrink-0 items-center gap-1 rounded-md border border-input px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
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
        </div>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        className="flex shrink-0 overflow-x-auto border-b border-border bg-background/95"
        data-score-builder-tablist="true"
      >
        {tabOrder.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={activeTab === tab}
            data-score-builder-tab={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'relative min-w-[3.5rem] flex-1 whitespace-nowrap px-2 py-2.5 text-xs font-medium transition-colors',
              activeTab === tab ? 'text-cyan-700 dark:text-cyan-300' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[tab]}
            {activeTab === tab && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-cyan-500" />}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        {dataErrors.length > 0 && (
          <div className="m-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
            <p className="font-medium">Unable to build scores</p>
            {dataErrors.map((err, i) => (
              <p key={i}>{err}</p>
            ))}
          </div>
        )}

        {!hasActiveBoundarySurface && (
          <div className="m-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-200">
            <p className="font-medium">Source grid mode</p>
            <p className="mt-1 text-[11px] leading-4">
              The map is showing the walkability source grid. Choose a study area to turn boundary rankings back on.
            </p>
          </div>
        )}

        {activeTab === 'equation' && (
          <EquationTab
            isDesktop={isDesktop}
            weights={weights}
            onWeightChange={onWeightChange}
            onAddMetric={onAddMetric}
            onApplyPreset={onApplyPreset}
            visiblePresets={visiblePresets}
            activePresetKey={activePresetKey}
            activePreset={activePreset}
            activeExample={activeExample}
            equationPreview={equationPreview}
            metricRanges={metricRanges}
            totalAbsoluteWeight={totalAbsoluteWeight}
            scoreSpread={scoreSpread}
            regions={regions}
            topRegions={topRegions}
          />
        )}

        {activeTab === 'density' && (
          <DensityTab
            densityMetric={densityMetric}
            onDensityMetricChange={onDensityMetricChange}
            onBuildDensityScore={onBuildDensityScore}
            densitySummary={densitySummary}
            densityLeaders={densityLeaders}
            selectedRegion={selectedRegion}
            onRegionSelect={onRegionSelect}
          />
        )}

        {activeTab === 'correlate' && (
          <CorrelateTab
            correlateMode={correlateMode}
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
        )}

        {hasActiveBoundarySurface && activeTab === 'regions' && (
          <RegionsTab
            loading={loading}
            regions={regions}
            visibleRows={visibleRows}
            filteredRegions={filteredRegions}
            selectedRegion={selectedRegion}
            selectedRegionDrivers={selectedRegionDrivers}
            comparisonRegions={comparisonRegions}
            comparisonSet={comparisonSet}
            weights={weights}
            scoreSpread={scoreSpread}
            searchQuery={searchQuery}
            onSearchQueryChange={onSearchQueryChange}
            onRegionSelect={onRegionSelect}
            onClearRegionSelection={onClearRegionSelection}
            onOpenRegionInsight={onOpenRegionInsight}
            onToggleComparison={onToggleComparison}
            onClearComparison={onClearComparison}
            onExport={onExport}
          />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// Tabs
// ============================================================================

export function ExamplesTab({
  activeExampleKey,
  onApplyExample,
}: {
  activeExampleKey: string | null
  onApplyExample: (key: string) => void
}) {
  const selectedExampleKey = activeExampleKey || SCORE_BUILDER_EXAMPLES[0]?.key || null
  const selectedExample = SCORE_BUILDER_EXAMPLES.find((example) => example.key === selectedExampleKey) || null

  const handleExampleClick = (exampleKey: string) => {
    onApplyExample(exampleKey)
  }

  return (
    <div className="space-y-3 p-4" data-score-builder-section="examples">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-3 flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
          {['Goal', 'Data', 'Tune', 'Results'].map((step, index) => (
            <div key={step} className="flex items-center gap-2">
              <span
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full border text-[10px]',
                  index === 0
                    ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-200'
                    : 'border-border',
                )}
              >
                {index + 1}
              </span>
              <span>{step}</span>
              {index < 3 && <span className="h-px w-4 bg-border" />}
            </div>
          ))}
        </div>
        {selectedExample && (
          <div className="space-y-2">
            <div>
              <div className="text-sm font-semibold text-foreground">{selectedExample.label}</div>
              <div className="text-xs text-cyan-700 dark:text-cyan-300">{selectedExample.question}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {selectedExample.dataSources.map((ds) => (
                <span
                  key={ds}
                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                >
                  {getDataSourceLabel(ds)}
                </span>
              ))}
            </div>
            <button
              type="button"
              onClick={() => onApplyExample(selectedExample.key)}
              className="w-full rounded-md bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-cyan-700"
            >
              Start tuning
            </button>
          </div>
        )}
      </div>

      {[
        { source: 'census' as const, title: 'Census Boundaries (Prince George)' },
        { source: 'bcHealth' as const, title: 'Health Boundaries (CHSA)' },
      ].map(({ source, title }) => {
        const group = SCORE_BUILDER_EXAMPLES.filter((e) => e.boundarySource === source)
        if (!group.length) return null
        return (
          <div key={source}>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </div>
            <div className="space-y-2">
              {group.map((example) => {
                const levelLabel =
                  { ct: 'CT', da: 'DA', chsa: 'CHSA' }[example.boundaryLevel as 'ct' | 'da' | 'chsa'] ||
                  example.boundaryLevel
                return (
                  <button
                    key={example.key}
                    type="button"
                    onClick={() => handleExampleClick(example.key)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      selectedExampleKey === example.key
                        ? 'border-cyan-500 bg-cyan-50 ring-1 ring-cyan-500/30 dark:bg-cyan-950/40 dark:ring-cyan-400/20'
                        : 'border-border bg-background hover:border-cyan-300 hover:bg-accent dark:hover:border-cyan-800',
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-sm font-semibold text-foreground">{example.label}</div>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {levelLabel}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-medium text-cyan-700 dark:text-cyan-300">{example.question}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{example.description}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {example.dataSources.map((ds) => (
                        <span
                          key={ds}
                          className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {getDataSourceLabel(ds)}
                        </span>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

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
        'mt-3 rounded-md border px-2 py-1.5 text-[11px]',
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
      <div className="mt-0.5 text-[10px] opacity-80">
        PGMaps divides each active weight by total influence, so weights do not need to equal 100.
      </div>
    </div>
  )
}

function EquationTab({
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
  const activeWeightCount = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0).length
  const activeTerms = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
  const activeTermKeySignature = activeTerms.map((metric) => metric.key).join('|')
  const previewMetric = focusedMetric || activeTerms[0]?.key || null

  useEffect(() => {
    const activeTermKeys = activeTermKeySignature ? (activeTermKeySignature.split('|') as ScoreMetricKey[]) : []
    setPriorityOrder((current) => {
      const activeSet = new Set(activeTermKeys)
      return [...current.filter((key) => activeSet.has(key)), ...activeTermKeys.filter((key) => !current.includes(key))]
    })
  }, [activeTermKeySignature])

  const movePriority = (metricKey: ScoreMetricKey, direction: -1 | 1) => {
    setPriorityOrder((current) => {
      const index = current.indexOf(metricKey)
      const nextIndex = index + direction
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

  const applyPriorityWeights = () => {
    const rankedKeys = priorityOrder.filter((key) => weights[key] !== 0)
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
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Live Results</div>
            <div className="mt-1 text-sm font-semibold text-foreground">
              {topRegions[0] ? `#1 ${topRegions[0].region.name}` : 'No ranked regions yet'}
            </div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold leading-none text-cyan-700 dark:text-cyan-300">
              {topRegions[0] ? formatScore(topRegions[0].score) : '0.0'}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">Avg {formatScore(scoreSpread.average)}</div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Low</div>
            <div className="font-semibold text-foreground">{formatScore(scoreSpread.min)}</div>
          </div>
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">High</div>
            <div className="font-semibold text-foreground">{formatScore(scoreSpread.max)}</div>
          </div>
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Active</div>
            <div className="font-semibold text-foreground">{activeWeightCount} terms</div>
          </div>
        </div>
        <WeightTotalStatus totalAbsoluteWeight={totalAbsoluteWeight} activeMetricCount={activeWeightCount} />
        {topRegions.length > 1 && (
          <div className="mt-3 space-y-1">
            {topRegions.map((region) => (
              <div key={region.region.id} className="flex items-center gap-2 text-[11px]">
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
            <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Preset</div>
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
                  'rounded-full border px-2 py-0.5 text-[10px] transition-colors',
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
                className="rounded-full border border-dashed border-input px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
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
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                      'rounded px-2 py-1 text-[11px] font-medium transition-colors',
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
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  {builderMode === 'formula' ? 'Equation' : 'Priority ranking'}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
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
                    disabled={priorityOrder.length === 0}
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
                order={priorityOrder}
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
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Equation</div>
        <div className="font-mono text-[11px] text-foreground">{equationPreview}</div>
        <div className="mt-1 text-[10px] text-muted-foreground">
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

function EquationComposer({
  activeTerms,
  weights,
  totalAbsoluteWeight,
  focusedMetric,
  onFocus,
  onWeightChange,
}: {
  activeTerms: Array<(typeof SCORE_METRICS)[number]>
  weights: ScoreMetricWeightMap
  totalAbsoluteWeight: number
  focusedMetric: ScoreMetricKey | null
  onFocus: (metric: ScoreMetricKey) => void
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
}) {
  return (
    <div className="mt-3" data-score-builder-equation-composer="true">
      <div className="mb-2 flex justify-end">
        <span className="rounded bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
          {activeTerms.length} term{activeTerms.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-3">
        <div className="pt-11 font-mono text-sm font-bold text-foreground">
          Score <span className="text-muted-foreground">=</span>
        </div>
        <div className="space-y-2">
          {activeTerms.length === 0 && (
            <div className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
              No active terms. Add a metric or apply a preset.
            </div>
          )}
          {activeTerms.map((metric, index) => (
            <div key={metric.key} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-2">
              <div className="pt-11 text-center font-mono text-lg font-semibold text-muted-foreground">
                {index > 0 ? '+' : ''}
              </div>
              <ScoreEquationTerm
                metric={metric}
                value={weights[metric.key]}
                totalAbsoluteWeight={totalAbsoluteWeight}
                active={focusedMetric === metric.key}
                onFocus={() => onFocus(metric.key)}
                onChange={(value) => onWeightChange(metric.key, value)}
                onRemove={() => onWeightChange(metric.key, 0)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ScoreEquationTerm({
  metric,
  value,
  totalAbsoluteWeight,
  active,
  onFocus,
  onChange,
  onRemove,
}: {
  metric: (typeof SCORE_METRICS)[number]
  value: number
  totalAbsoluteWeight: number
  active: boolean
  onFocus: () => void
  onChange: (value: number) => void
  onRemove: () => void
}) {
  const share = totalAbsoluteWeight > 0 ? Math.round((Math.abs(value) / totalAbsoluteWeight) * 100) : 0
  const positive = value > 0

  return (
    <div
      className={cn(
        'rounded-lg border bg-muted/20 p-2 transition-colors',
        active ? 'border-cyan-500 bg-cyan-50/60 dark:bg-cyan-950/25' : 'border-border',
      )}
      onMouseEnter={onFocus}
      onFocus={onFocus}
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(clampWeight(value === 0 ? getDefaultMetricWeight(metric.key) : -value))}
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded border text-xs font-bold',
            positive
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300'
              : 'border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300',
          )}
          title="Flip direction"
        >
          {positive ? '+' : '-'}
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold text-foreground">{metric.shortLabel}</div>
          <div className="text-[10px] text-muted-foreground">{share}% of weight</div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          title="Remove metric"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <SignedWeightSlider metricKey={metric.key} value={value} onChange={onChange} />
    </div>
  )
}

function WeightDistribution({
  weights,
  totalAbsoluteWeight,
}: {
  weights: ScoreMetricWeightMap
  totalAbsoluteWeight: number
}) {
  const activeMetrics = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)

  return (
    <div>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted">
        {activeMetrics.length === 0 ? (
          <div className="h-full w-full bg-muted-foreground/20" />
        ) : (
          activeMetrics.map((metric) => {
            const value = weights[metric.key]
            const width = totalAbsoluteWeight > 0 ? (Math.abs(value) / totalAbsoluteWeight) * 100 : 0
            return (
              <div
                key={metric.key}
                className={cn('h-full', getCategoryTone(metric.category), value < 0 && 'opacity-60')}
                style={{ width: `${width}%` }}
                title={`${metric.label}: ${value}`}
              />
            )
          })
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{activeMetrics.length} active metrics</span>
        <span>Total influence {totalAbsoluteWeight.toLocaleString()}</span>
      </div>
    </div>
  )
}

function PriorityMode({
  order,
  weights,
  onMove,
  onFocus,
  onRemove,
}: {
  order: ScoreMetricKey[]
  weights: ScoreMetricWeightMap
  onMove: (metric: ScoreMetricKey, direction: -1 | 1) => void
  onFocus: (metric: ScoreMetricKey) => void
  onRemove: (metric: ScoreMetricKey) => void
}) {
  if (order.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
        Add metrics, then rank them from most to least important.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {order.map((metricKey, index) => {
        const metric = SCORE_METRICS.find((entry) => entry.key === metricKey)
        if (!metric) return null
        const value = weights[metricKey]
        const projected = order.length <= 1 ? 70 : Math.round(80 - (index * 55) / (order.length - 1))
        return (
          <div
            key={metricKey}
            onMouseEnter={() => onFocus(metricKey)}
            className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-2"
          >
            <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="w-5 shrink-0 text-right font-mono text-xs text-muted-foreground">{index + 1}</div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-foreground">{metric.label}</div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-background">
                <div className={cn('h-full', getCategoryTone(metric.category))} style={{ width: `${projected}%` }} />
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {metric.directionLabel} · current {Math.abs(value)} · ranked {projected}
              </div>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => onMove(metricKey, -1)}
                disabled={index === 0}
                className="rounded border border-input p-1 text-muted-foreground disabled:opacity-35"
                title="Move up"
              >
                <ArrowUp className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onMove(metricKey, 1)}
                disabled={index === order.length - 1}
                className="rounded border border-input p-1 text-muted-foreground disabled:opacity-35"
                title="Move down"
              >
                <ArrowDown className="h-3 w-3" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onRemove(metricKey)}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              title="Remove metric"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

function SignedWeightSlider({
  metricKey,
  value,
  onChange,
}: {
  metricKey: ScoreMetricKey
  value: number
  onChange: (value: number) => void
}) {
  const clamped = clampWeight(value)
  const percent = ((clamped + 100) / 200) * 100
  const fillStart = clamped < 0 ? percent : 50
  const fillEnd = clamped < 0 ? 50 : percent
  const fillColor = clamped < 0 ? 'rgb(225 29 72)' : 'rgb(5 150 105)'

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Low</span>
        <span>{getWeightIntent(clamped)}</span>
        <span>High</span>
      </div>
      <div className="relative h-6">
        <div className="absolute left-0 right-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-muted" />
        <div
          className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full"
          style={{
            left: `${Math.min(fillStart, fillEnd)}%`,
            right: `${100 - Math.max(fillStart, fillEnd)}%`,
            background: fillColor,
          }}
        />
        <div className="absolute left-1/2 top-0 h-6 w-px bg-border" />
        <Slider
          data-score-builder-equation-slider={metricKey}
          min={-100}
          max={100}
          step={1}
          value={[clamped]}
          aria-valuetext={`${getWeightIntent(clamped)} ${Math.abs(clamped)}`}
          onValueChange={([value]) => {
            const next = clampWeight(value)
            onChange(Math.abs(next) <= 4 ? 0 : next)
          }}
          className="absolute inset-0 h-6 w-full opacity-0"
        />
        <div
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-border bg-background shadow"
          style={{ left: `${percent}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>-100</span>
        <input
          type="number"
          data-score-builder-equation-number={metricKey}
          min={-100}
          max={100}
          step={1}
          value={clamped}
          onChange={(event) => {
            const parsed = Number.parseFloat(event.target.value)
            onChange(Number.isFinite(parsed) ? clampWeight(parsed) : 0)
          }}
          className="w-14 rounded border border-input bg-background px-1 py-0.5 text-right text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
        />
        <span>100</span>
      </div>
    </div>
  )
}

function NormalizationPreview({
  metricKey,
  regions,
  metricRanges,
}: {
  metricKey: ScoreMetricKey | null
  regions: ScoredBoundaryRegion[]
  metricRanges: ScoreMetricRangeMap
}) {
  if (!metricKey) {
    return (
      <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        Select a metric to inspect normalization.
      </div>
    )
  }

  const metric = SCORE_METRICS.find((entry) => entry.key === metricKey)
  const range = metricRanges[metricKey]
  const values = regions.map((region) => region.metrics[metricKey]).filter((value) => Number.isFinite(value))
  const buckets = new Array(8).fill(0)
  values.forEach((value) => {
    const denominator = range.max - range.min
    const normalized = denominator > 0 ? (value - range.min) / denominator : 0.5
    const index = Math.max(0, Math.min(buckets.length - 1, Math.floor(normalized * buckets.length)))
    buckets[index] += 1
  })
  const maxBucket = Math.max(...buckets, 1)

  return (
    <div className="rounded-lg border border-border bg-background p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Normalization</div>
          <div className="mt-0.5 text-sm font-semibold text-foreground">{metric?.label || metricKey}</div>
        </div>
        <div className="text-right font-mono text-[10px] text-muted-foreground">
          <div>{formatMetricValue(metricKey, range.min, true)}</div>
          <div>{formatMetricValue(metricKey, range.max, true)}</div>
        </div>
      </div>
      <div className="flex h-10 items-end gap-1">
        {buckets.map((bucket, index) => (
          <div
            key={`${metricKey}-${index}`}
            className="flex-1 rounded-t bg-cyan-500/70"
            style={{
              height: `${Math.max(8, (bucket / maxBucket) * 100)}%`,
              opacity: 0.35 + (bucket / maxBucket) * 0.55,
            }}
            title={`${bucket} regions`}
          />
        ))}
      </div>
      <div className="mt-2 h-2 rounded-full bg-gradient-to-r from-rose-600 via-amber-100 to-emerald-700" />
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>0</span>
        <span>normalized score</span>
        <span>100</span>
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Raw values are scaled against the current region set before weights are applied.
      </div>
    </div>
  )
}

function MetricPickerDialog({
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
          <DialogDescription>Choose one metric to add to the active score equation.</DialogDescription>
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

const SCORE_FILTER_DEFINITIONS: Array<{
  key: ScoreFilterKey
  label: string
  description: string
}> = [
  {
    key: 'requirePopulation',
    label: 'Require population data',
    description: 'Exclude regions without census population assigned.',
  },
  {
    key: 'requireParks',
    label: 'Require parks or trails',
    description: 'Exclude regions with no parks, trails, or park amenities.',
  },
  {
    key: 'limitCrime',
    label: 'Lower crime pressure',
    description: 'Keep regions at or below the current median crime-per-capita value.',
  },
  {
    key: 'limitFoodRisk',
    label: 'Lower food-risk pressure',
    description: 'Keep regions at or below the current median food risk score.',
  },
]

export function MethodologyTab({
  weights,
  methodSettings,
  componentSummaries,
  activePreset,
}: {
  weights: ScoreMetricWeightMap
  methodSettings: ScoreMethodSettings
  componentSummaries: ScoreComponentSummary[]
  activePreset: (typeof SCORE_PRESETS)[number] | null
}) {
  const activeMetrics = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
  const presetMethodology = activePreset ? getScorePresetMethodology(activePreset) : null

  return (
    <div className="space-y-3 p-4" data-score-builder-section="methodology">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-cyan-600" />
          <div className="text-sm font-semibold text-foreground">COINr-lite method</div>
        </div>
        <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            PGMaps builds a transparent composite indicator from normalized boundary metrics, signed user weights, and
            the selected aggregation method.
          </p>
          <p>
            Current settings: {formatNormalizationMethod(methodSettings.normalization)} normalization,{' '}
            {formatAggregationMethod(methodSettings.aggregation)} aggregation, missing data set to{' '}
            {methodSettings.missingData}.
          </p>
          <p>
            Scores are relative to the currently loaded boundary level; filters do not redefine percentiles. Use for
            planning triage, not validated exposure, health, or funding eligibility determination.
          </p>
        </div>
      </div>

      {presetMethodology && (
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 text-sm font-semibold text-foreground">Preset methodology notes</div>
          <div className="space-y-2 text-xs text-muted-foreground">
            <div>
              <span className="font-semibold text-foreground">Purpose:</span> {presetMethodology.purpose}
            </div>
            <div>
              <span className="font-semibold text-foreground">Included components:</span>{' '}
              {presetMethodology.components.join(', ') || 'Custom metric set'}
            </div>
            <div>
              <span className="font-semibold text-foreground">Preset normalization:</span>{' '}
              {presetMethodology.normalization}
            </div>
            {presetMethodology.proxy && (
              <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
                Proxy recipe. Use it for screening and conversation, not as a validated health, exposure, or EJ index.
              </div>
            )}
            <div>
              <div className="font-semibold text-foreground">Known limits</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {presetMethodology.knownLimits.map((limit) => (
                  <li key={limit}>{limit}</li>
                ))}
              </ul>
            </div>
            <div>
              <div className="font-semibold text-foreground">Data still needed</div>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {presetMethodology.dataNeeded.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {componentSummaries.length > 0 && (
        <div className="rounded-lg border border-border bg-background p-3">
          <div className="mb-2 text-sm font-semibold text-foreground">Component sub-scores</div>
          <div className="space-y-2">
            {componentSummaries.map((component) => (
              <div key={component.key}>
                <div className="mb-1 flex items-center justify-between text-[11px]">
                  <span className="font-semibold text-foreground">{component.label}</span>
                  <span className="text-muted-foreground">
                    {formatScore(component.score)} · {(component.weightShare * 100).toFixed(0)}%
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

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">Active indicator metadata</div>
        <div className="space-y-2">
          {activeMetrics.map((metric) => (
            <div key={metric.key} className="rounded border border-border bg-muted/15 p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold text-foreground">{metric.label}</div>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {metric.uncertainty} uncertainty
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {metric.directionLabel} · weight {weights[metric.key]} · {metric.dataSourceLabel} ·{' '}
                {metric.spatialMethod}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                {metric.freshnessLabel} · {metric.comparisonBasis}
              </div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Module{' '}
                {
                  SCORE_INDEX_MODULE_LABELS[
                    methodSettings.metricModuleOverrides[metric.key] || metric.indexModule || 'localContext'
                  ]
                }{' '}
                · domain {metric.indexDomain || 'local context'} · {metric.proxyLevel || 'proxy'} metric
              </div>
              {metric.caveat && (
                <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">{metric.caveat}</div>
              )}
            </div>
          ))}
          {activeMetrics.length === 0 && (
            <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
              Add metrics or apply a preset to see indicator metadata.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function RobustnessTab({
  robustnessResults,
  scenarioComparison,
}: {
  robustnessResults: RobustnessResult[]
  scenarioComparison: ScenarioComparison | null
}) {
  return (
    <div className="space-y-3 p-4" data-score-builder-section="robustness">
      <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
        <div className="mb-1 text-sm font-semibold text-foreground">Rank confidence</div>
        <p>
          Runs deterministic stress checks against the active recipe: 15% weight perturbations, leave-one-indicator-out
          tests, and alternate normalization methods.
        </p>
      </div>

      {scenarioComparison && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
          <div className="font-semibold">Top-rank stability</div>
          <div className="mt-1">
            Top area held in {(scenarioComparison.stableTopShare * 100).toFixed(0)}% of perturbation trials; average
            rank shift was {scenarioComparison.averageRankShift.toFixed(1)}.
          </div>
        </div>
      )}

      <div className="space-y-2">
        {robustnessResults.map((result) => (
          <div key={result.regionId} className="rounded-lg border border-border bg-background p-3 text-xs">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="font-semibold text-foreground">
                  #{result.baseRank} {result.regionName}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  median rank {result.medianRank.toFixed(1)} · interval #{result.rankInterval[0]}-#
                  {result.rankInterval[1]}
                </div>
              </div>
              <span
                className={cn(
                  'rounded px-2 py-0.5 text-[10px] font-semibold',
                  result.stability === 'stable'
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                    : result.stability === 'moderate'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'bg-rose-100 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200',
                )}
              >
                {result.stability}
              </span>
            </div>
            <div className="mt-2 text-[11px] text-muted-foreground">
              Score interval {formatScore(result.scoreInterval[0])}-{formatScore(result.scoreInterval[1])}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Drivers: {result.topDrivers.map(getMetricLabel).join(', ')}
            </div>
          </div>
        ))}
        {robustnessResults.length === 0 && (
          <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
            Turn on sensitivity testing in the Model tab to generate robustness results.
          </div>
        )}
      </div>
    </div>
  )
}

export function ModelTab({
  weights,
  totalAbsoluteWeight,
  scoreFilters,
  onToggleScoreFilter,
  methodSettings,
  onMethodSettingsChange,
  scoreBands,
  scenarioComparison,
  regions,
  totalRegionCount,
  excludedRegionCount,
  scoreSpread,
}: {
  weights: ScoreMetricWeightMap
  totalAbsoluteWeight: number
  scoreFilters: ScoreFilterState
  onToggleScoreFilter: (filter: ScoreFilterKey) => void
  methodSettings: ScoreMethodSettings
  onMethodSettingsChange: (settings: ScoreMethodSettings) => void
  scoreBands: ScoreBandSummary[]
  scenarioComparison: ScenarioComparison | null
  regions: ScoredBoundaryRegion[]
  totalRegionCount: number
  excludedRegionCount: number
  scoreSpread: { min: number; max: number; average: number }
}) {
  const activeFilters = SCORE_FILTER_DEFINITIONS.filter((filter) => scoreFilters[filter.key])
  const maxBandCount = Math.max(...scoreBands.map((band) => band.count), 1)
  const activeMetrics = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
  const deprivationRegions = regions.filter((region) => region.equityAudit.deprivationQuintile !== null)
  const deprivationWeightedAverage = deprivationRegions.length
    ? deprivationRegions.reduce(
        (sum, region) => sum + region.score * (region.equityAudit.deprivationQuintile || 1),
        0,
      ) / deprivationRegions.reduce((sum, region) => sum + (region.equityAudit.deprivationQuintile || 1), 0)
    : null
  const topBurdenOverlap = [...regions]
    .sort((a, b) => b.equityAudit.burdenOverlap - a.equityAudit.burdenOverlap)
    .slice(0, 3)
  const updateMethodSettings = <Key extends keyof ScoreMethodSettings>(key: Key, value: ScoreMethodSettings[Key]) =>
    onMethodSettingsChange({ ...methodSettings, [key]: value })
  const activeHealthyPlanPairKey = useMemo(() => {
    return (
      HEALTHYPLAN_PAIRWISE_PRESETS.find(
        (preset) =>
          preset.demographicMetric === methodSettings.healthyPlanPriority.demographicMetric &&
          preset.environmentMetric === methodSettings.healthyPlanPriority.environmentMetric,
      )?.key ?? 'custom'
    )
  }, [
    methodSettings.healthyPlanPriority.demographicMetric,
    methodSettings.healthyPlanPriority.environmentMetric,
  ])

  return (
    <div className="space-y-3 p-4" data-score-builder-section="model">
      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-cyan-600" />
          <div className="text-sm font-semibold text-foreground">Methodology</div>
        </div>
        <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>
            Each metric is automatically normalized from 0 to 1 with the selected method against the currently loaded
            regions. Positive weights prefer high normalized values; negative weights prefer low values.
          </p>
          <p>
            Scores are relative to the currently loaded boundary level; filters do not redefine percentiles. Use for
            planning triage, not validated exposure, health, or funding eligibility determination.
          </p>
          <p>
            The final score uses the selected aggregation method after active weights are converted to weight shares.
            EJI-style mode uses active metric weights only to select indicators; module ranks are weighted equally.
            Active weights are normalized by total influence, so a useful model can use any total.
          </p>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Influence</div>
            <div className="font-semibold text-foreground">{totalAbsoluteWeight.toLocaleString()}</div>
          </div>
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Metrics</div>
            <div className="font-semibold text-foreground">{activeMetrics.length}</div>
          </div>
          <div className="rounded border border-border bg-muted/20 p-2">
            <div className="text-[10px] uppercase text-muted-foreground">Average</div>
            <div className="font-semibold text-foreground">{formatScore(scoreSpread.average)}</div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">Equity audit</div>
        <div className="space-y-2 text-xs text-muted-foreground">
          <div>
            Deprivation-weighted average:{' '}
            <span className="font-semibold text-foreground">
              {deprivationWeightedAverage == null ? 'No CIMD data loaded' : formatScore(deprivationWeightedAverage)}
            </span>
          </div>
          <div className="space-y-1">
            {topBurdenOverlap.map((region) => (
              <div key={region.region.id} className="flex items-center justify-between rounded bg-muted/25 px-2 py-1">
                <span className="truncate">
                  #{region.rank} {region.region.name}
                </span>
                <span className="font-semibold text-foreground">
                  {(region.equityAudit.burdenOverlap * 100).toFixed(0)} overlap
                </span>
              </div>
            ))}
          </div>
          {regions.some((region) => region.equityAudit.cutoffWarning) && (
            <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
              Some regions sit near score-band cutoffs; treat hard thresholds as sensitive.
            </div>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 text-sm font-semibold text-foreground">Method controls</div>
        <div className="grid gap-2 text-xs">
          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground">Normalization</span>
            <AppSelect
              value={methodSettings.normalization}
              onValueChange={(value) =>
                updateMethodSettings('normalization', value as ScoreMethodSettings['normalization'])
              }
              options={[
                { value: 'percentile', label: 'Percentile rank' },
                { value: 'winsorizedMinMax', label: 'Winsorized min-max' },
                { value: 'minMax', label: 'Min-max' },
                { value: 'zScore', label: 'Z-score' },
              ]}
              triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
            />
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground">Aggregation</span>
            <AppSelect
              value={methodSettings.aggregation}
              onValueChange={(value) =>
                updateMethodSettings('aggregation', value as ScoreMethodSettings['aggregation'])
              }
              options={[
                { value: 'additive', label: 'Weighted average' },
                { value: 'geometric', label: 'Geometric mean' },
                { value: 'cumulativeBurden', label: 'Cumulative burden' },
                { value: 'modulePercentileRankedSum', label: 'EJI-style module ranked sum' },
                { value: 'healthyPlanPairwisePriority', label: 'HealthyPlan-style pairwise priority' },
                { value: 'accessThreshold', label: 'Access threshold score' },
              ]}
              triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
            />
          </label>
          {methodSettings.aggregation === 'healthyPlanPairwisePriority' && (
            <div className="grid gap-2 rounded-md border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-900/70 dark:bg-amber-950/25">
              <label className="space-y-1">
                <span className="block font-medium text-amber-950 dark:text-amber-100">Pairwise recipe</span>
                <AppSelect
                  value={activeHealthyPlanPairKey}
                  onValueChange={(value) => {
                    if (value === 'custom') return
                    const preset = HEALTHYPLAN_PAIRWISE_PRESETS.find((entry) => entry.key === value)
                    if (!preset) return
                    updateMethodSettings('healthyPlanPriority', {
                      demographicMetric: preset.demographicMetric,
                      environmentMetric: preset.environmentMetric,
                    })
                  }}
                  options={[
                    ...HEALTHYPLAN_PAIRWISE_PRESETS.map((preset) => ({
                      value: preset.key,
                      label: preset.label,
                    })),
                    { value: 'custom', label: 'Custom pair' },
                  ]}
                  triggerClassName="h-8 rounded border-amber-300 text-xs focus:ring-1 focus:ring-amber-500 dark:border-amber-900"
                />
              </label>
              <label className="space-y-1">
                <span className="block font-medium text-amber-950 dark:text-amber-100">
                  Vulnerable population proxy
                </span>
                <AppSelect
                  value={methodSettings.healthyPlanPriority.demographicMetric ?? ''}
                  onValueChange={(value) =>
                    updateMethodSettings('healthyPlanPriority', {
                      ...methodSettings.healthyPlanPriority,
                      demographicMetric: value as ScoreMetricKey,
                    })
                  }
                  options={healthyPlanDemographicMetrics.map((metric) => ({ value: metric.key, label: metric.label }))}
                  triggerClassName="h-8 rounded border-amber-300 text-xs focus:ring-1 focus:ring-amber-500 dark:border-amber-900"
                />
              </label>
              <label className="space-y-1">
                <span className="block font-medium text-amber-950 dark:text-amber-100">Built environment proxy</span>
                <AppSelect
                  value={methodSettings.healthyPlanPriority.environmentMetric ?? ''}
                  onValueChange={(value) =>
                    updateMethodSettings('healthyPlanPriority', {
                      ...methodSettings.healthyPlanPriority,
                      environmentMetric: value as ScoreMetricKey,
                    })
                  }
                  options={healthyPlanEnvironmentMetrics.map((metric) => ({ value: metric.key, label: metric.label }))}
                  triggerClassName="h-8 rounded border-amber-300 text-xs focus:ring-1 focus:ring-amber-500 dark:border-amber-900"
                />
              </label>
              <p className="text-[10px] leading-snug text-amber-900 dark:text-amber-100/85">
                This applies the HealthyPlan threshold to the selected pair; it is a screening mode, not a weighted
                composite score.
              </p>
            </div>
          )}
          {methodSettings.aggregation === 'accessThreshold' && (
            <div className="grid gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 p-2 dark:border-emerald-900/70 dark:bg-emerald-950/25">
              <label className="space-y-1">
                <span className="block font-medium text-emerald-950 dark:text-emerald-100">Access threshold</span>
                <input
                  type="number"
                  min={5}
                  max={100}
                  step={5}
                  value={Math.round(methodSettings.accessThreshold.minimumAccess * 100)}
                  onChange={(event) =>
                    updateMethodSettings('accessThreshold', {
                      ...methodSettings.accessThreshold,
                      minimumAccess: Math.max(0.05, Math.min(1, Number(event.target.value) / 100)),
                    })
                  }
                  className="h-8 rounded border border-emerald-300 bg-background px-2 text-xs dark:border-emerald-900"
                />
              </label>
              <label className="space-y-1">
                <span className="block font-medium text-emerald-950 dark:text-emerald-100">Required access hits</span>
                <input
                  type="number"
                  min={1}
                  max={SCORE_ACCESS_THRESHOLD_METRICS.length}
                  value={methodSettings.accessThreshold.minimumHits}
                  onChange={(event) =>
                    updateMethodSettings('accessThreshold', {
                      ...methodSettings.accessThreshold,
                      minimumHits: Math.max(1, Math.min(SCORE_ACCESS_THRESHOLD_METRICS.length, Number(event.target.value))),
                    })
                  }
                  className="h-8 rounded border border-emerald-300 bg-background px-2 text-xs dark:border-emerald-900"
                />
              </label>
              <p className="text-[10px] leading-snug text-emerald-900 dark:text-emerald-100/85">
                Counts access indicators at or above the threshold, then scores against the required number of hits.
              </p>
            </div>
          )}
          {methodSettings.aggregation === 'modulePercentileRankedSum' && (
            <div className="grid gap-2 rounded-md border border-cyan-200 bg-cyan-50/70 p-2 dark:border-cyan-900/70 dark:bg-cyan-950/25">
              <div className="font-medium text-cyan-950 dark:text-cyan-100">Module editor</div>
              {SCORE_METRICS.filter((metric) => weights[metric.key] !== 0).map((metric) => (
                <label key={metric.key} className="grid gap-1">
                  <span className="text-[10px] font-medium text-cyan-950 dark:text-cyan-100">{metric.shortLabel}</span>
                  <AppSelect
                    value={methodSettings.metricModuleOverrides[metric.key] || metric.indexModule || 'localContext'}
                    onValueChange={(value) =>
                      updateMethodSettings('metricModuleOverrides', {
                        ...methodSettings.metricModuleOverrides,
                        [metric.key]: value as ScoreIndexModule,
                      })
                    }
                    options={Object.entries(SCORE_INDEX_MODULE_LABELS).map(([value, label]) => ({ value, label }))}
                    triggerClassName="h-8 rounded border-cyan-300 text-xs focus:ring-1 focus:ring-cyan-500 dark:border-cyan-900"
                  />
                </label>
              ))}
            </div>
          )}
          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground">Missing data</span>
            <AppSelect
              value={methodSettings.missingData}
              onValueChange={(value) =>
                updateMethodSettings('missingData', value as ScoreMethodSettings['missingData'])
              }
              options={[
                { value: 'zero', label: 'Treat missing as zero' },
                { value: 'neutral', label: 'Treat missing as neutral' },
              ]}
              triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
            />
          </label>
          <label className="space-y-1">
            <span className="block font-medium text-muted-foreground">Map output</span>
            <AppSelect
              value={methodSettings.visualOutput}
              onValueChange={(value) =>
                updateMethodSettings('visualOutput', value as ScoreMethodSettings['visualOutput'])
              }
              options={[
                { value: 'interpolated', label: 'Interpolated ramp' },
                { value: 'binned', label: '5 score bins' },
              ]}
              triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
            />
          </label>
          <button
            type="button"
            onClick={() => updateMethodSettings('sensitivity', !methodSettings.sensitivity)}
            className={cn(
              'flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors',
              methodSettings.sensitivity
                ? 'border-cyan-500/60 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/35 dark:text-cyan-100'
                : 'border-input text-muted-foreground hover:text-foreground',
            )}
          >
            <span>
              <span className="block font-semibold">Sensitivity test</span>
              <span className="block text-[10px] text-muted-foreground">
                Perturb active weights by 15% across 24 trials.
              </span>
            </span>
            <span className="font-bold">{methodSettings.sensitivity ? 'ON' : 'OFF'}</span>
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <div className="text-sm font-semibold text-foreground">Hard filters</div>
          </div>
          <span className="text-[11px] text-muted-foreground">
            {regions.length} of {totalRegionCount} eligible
          </span>
        </div>
        <div className="space-y-2">
          {SCORE_FILTER_DEFINITIONS.map((filter) => {
            const active = scoreFilters[filter.key]
            return (
              <button
                key={filter.key}
                type="button"
                data-score-builder-hard-filter={filter.key}
                onClick={() => onToggleScoreFilter(filter.key)}
                className={cn(
                  'flex w-full items-start justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                  active
                    ? 'border-cyan-500/60 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/35 dark:text-cyan-100'
                    : 'border-input bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <span>
                  <span className="block text-xs font-semibold">{filter.label}</span>
                  <span className="mt-0.5 block text-[10px] text-muted-foreground">{filter.description}</span>
                </span>
                <span className={cn('shrink-0 text-xs font-bold', active ? 'text-cyan-600' : 'text-muted-foreground')}>
                  {active ? 'ON' : 'OFF'}
                </span>
              </button>
            )
          })}
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          {activeFilters.length
            ? `${excludedRegionCount} region${excludedRegionCount === 1 ? '' : 's'} excluded before ranking.`
            : 'No hard filters are active; all loaded regions remain eligible.'}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-background p-3">
        <div className="mb-2 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-semibold text-foreground">Score bands</div>
        </div>
        <div className="space-y-2">
          {scoreBands.map((band) => (
            <div key={band.key}>
              <div className="mb-1 flex items-center justify-between text-[11px]">
                <span className="font-semibold text-foreground">{band.label}</span>
                <span className="text-muted-foreground">{band.count} regions</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    'h-full rounded-full',
                    band.key === 'high'
                      ? 'bg-emerald-500'
                      : band.key === 'moderate'
                        ? 'bg-cyan-500'
                        : band.key === 'low'
                          ? 'bg-amber-500'
                          : 'bg-rose-500',
                  )}
                  style={{ width: `${Math.max(3, (band.count / maxBandCount) * 100)}%` }}
                />
              </div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {band.min}-{band.max} · {band.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {scenarioComparison && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="mb-2 text-sm font-semibold text-amber-950 dark:text-amber-100">Scenario compare</div>
          <div className="grid grid-cols-2 gap-2 text-[11px] text-amber-900 dark:text-amber-100">
            <div className="rounded border border-amber-200/70 bg-white/50 p-2 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="text-[10px] uppercase text-amber-700 dark:text-amber-300">Current top</div>
              <div className="font-semibold">{scenarioComparison.currentTopName || 'None'}</div>
              <div>{formatScore(scenarioComparison.currentTopScore)}</div>
            </div>
            <div className="rounded border border-amber-200/70 bg-white/50 p-2 dark:border-amber-900 dark:bg-amber-950/20">
              <div className="text-[10px] uppercase text-amber-700 dark:text-amber-300">{scenarioComparison.label}</div>
              <div className="font-semibold">{scenarioComparison.referenceTopName || 'None'}</div>
              <div>{formatScore(scenarioComparison.referenceTopScore)}</div>
            </div>
          </div>
          <div className="mt-2 text-[11px] text-amber-800 dark:text-amber-200">
            Average delta vs {scenarioComparison.label}:{' '}
            <span className="font-semibold">
              {scenarioComparison.averageDelta >= 0 ? '+' : ''}
              {formatScore(scenarioComparison.averageDelta)}
            </span>
            {scenarioComparison.topChanged ? ' · top region changed' : ' · top region unchanged'}
            <br />
            Sensitivity: top area held in {(scenarioComparison.stableTopShare * 100).toFixed(0)}% of trials · avg rank
            shift {scenarioComparison.averageRankShift.toFixed(1)}
          </div>
          <div className="mt-2 grid gap-2 text-[11px] text-amber-900 dark:text-amber-100 sm:grid-cols-3">
            <div>
              <div className="font-semibold">Changed most</div>
              {scenarioComparison.changedMost.slice(0, 3).map((entry) => (
                <div key={entry.regionId} className="truncate">
                  {entry.regionName} {entry.delta >= 0 ? '+' : ''}
                  {formatScore(entry.delta)}
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold">Always high</div>
              {scenarioComparison.alwaysHighPriority.slice(0, 3).map((entry) => (
                <div key={entry.regionId} className="truncate">
                  {entry.regionName}
                </div>
              ))}
            </div>
            <div>
              <div className="font-semibold">Sensitive</div>
              {scenarioComparison.sensitiveRegions.slice(0, 3).map((entry) => (
                <div key={entry.regionId} className="truncate">
                  {entry.regionName} {entry.rankShift.toFixed(1)}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-dashed border-border bg-muted/10 p-3 text-xs text-muted-foreground">
        Rubric mode is the next larger model change: metric values would be binned into named classes before weighting,
        similar to GIS-MCDA scoring matrices.
      </div>
    </div>
  )
}

function DensityTab({
  densityMetric,
  onDensityMetricChange,
  onBuildDensityScore,
  densitySummary,
  densityLeaders,
  selectedRegion,
  onRegionSelect,
}: {
  densityMetric: ScoreMetricKey
  onDensityMetricChange: (metric: ScoreMetricKey) => void
  onBuildDensityScore: (metric: ScoreMetricKey) => void
  densitySummary: { min: number; max: number; median: number; average: number } | null
  densityLeaders: ScoredBoundaryRegion[]
  selectedRegion: ScoredBoundaryRegion | null
  onRegionSelect: (regionId: string) => void
}) {
  return (
    <div className="space-y-2 p-4" data-score-builder-section="density">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor="score-builder-density" className="text-xs font-medium text-muted-foreground">
          Heat-map metric
        </label>
        <AppSelect
          id="score-builder-density"
          aria-label="Density metric"
          value={densityMetric}
          onValueChange={(value) => onDensityMetricChange(value as ScoreMetricKey)}
          options={DENSITY_METRIC_OPTIONS.map((metric) => ({ value: metric, label: getMetricLabel(metric) }))}
          className="w-44"
          triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">Build score from heat map</div>
            <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              Use the selected metric as a one-layer score so the map, rankings, exports, and share URL all follow this
              dataset.
            </div>
          </div>
          <button
            type="button"
            data-score-builder-build-density-score="true"
            onClick={() => onBuildDensityScore(densityMetric)}
            className="shrink-0 rounded-md border border-cyan-500/50 bg-cyan-50 px-2 py-1 text-xs font-medium text-cyan-800 transition-colors hover:bg-cyan-100 dark:bg-cyan-950/30 dark:text-cyan-100"
          >
            Build score
          </button>
        </div>
      </div>

      {densitySummary ? (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {(['median', 'average', 'min', 'max'] as const).map((stat) => (
              <div key={stat} className="rounded border border-border bg-muted/30 p-2">
                <div className="text-[10px] capitalize text-muted-foreground">{stat}</div>
                <div className="font-semibold text-foreground">
                  {formatMetricValue(densityMetric, densitySummary[stat], true)}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-1">
            {densityLeaders.map((entry) => (
              <button
                key={`density-${entry.region.id}`}
                onClick={() => onRegionSelect(entry.region.id)}
                className={cn(
                  'flex w-full items-center justify-between rounded border border-border bg-background px-2 py-1.5 text-xs transition-colors hover:bg-accent',
                  selectedRegion?.region.id === entry.region.id && 'bg-cyan-50 dark:bg-cyan-950/40',
                )}
              >
                <span className="truncate text-left text-foreground">{entry.region.name}</span>
                <span className="font-medium text-cyan-700 dark:text-cyan-300">
                  {formatMetricValue(densityMetric, entry.metrics[densityMetric], true)}
                </span>
              </button>
            ))}
          </div>
          <div className="text-[10px] text-muted-foreground">{getMetricDescription(densityMetric)}</div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">No values available for this density lens.</div>
      )}
    </div>
  )
}

function CorrelateTab({
  correlateMode,
  onToggleCorrelateMode,
  metricX,
  metricY,
  onMetricXChange,
  onMetricYChange,
  visStyle,
  onVisStyleChange,
  result,
  topPairs,
  onApplyTopPair,
}: {
  correlateMode: boolean
  onToggleCorrelateMode: () => void
  metricX: ScoreMetricKey
  metricY: ScoreMetricKey
  onMetricXChange: (metric: ScoreMetricKey) => void
  onMetricYChange: (metric: ScoreMetricKey) => void
  visStyle: 'bivariate' | 'residual'
  onVisStyleChange: (style: 'bivariate' | 'residual') => void
  result: CorrelationResult
  topPairs: MetricCorrelation[]
  onApplyTopPair: (metricX: ScoreMetricKey, metricY: ScoreMetricKey) => void
}) {
  const metricOptions = useMemo(() => {
    const groups = Object.keys(SCORE_METRICS_BY_CATEGORY)
    const out: Array<{ value: ScoreMetricKey; label: string }> = []
    for (const category of groups) {
      const categoryMetrics = SCORE_METRICS_BY_CATEGORY[category]
      const categoryLabel =
        METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] ?? category
      for (const metric of categoryMetrics) {
        out.push({ value: metric.key, label: `${categoryLabel} · ${metric.label}` })
      }
    }
    return out.sort((a, b) => a.label.localeCompare(b.label))
  }, [])

  const stats = result.stats
  const xLabel = getMetricLabel(metricX)
  const yLabel = getMetricLabel(metricY)
  const flipAxes = () => {
    const newX = metricY
    const newY = metricX
    onMetricXChange(newX)
    onMetricYChange(newY)
  }

  return (
    <div className="space-y-3 p-4" data-score-builder-section="correlate">
      <div className="rounded-lg border border-border bg-muted/20 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">Correlation mode</div>
            <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              Repaints regions by the relationship between two metrics. The current scoring map is hidden while this is on.
            </div>
          </div>
          <button
            type="button"
            onClick={onToggleCorrelateMode}
            aria-pressed={correlateMode}
            className={cn(
              'shrink-0 rounded-md border px-2 py-1 text-xs font-medium transition-colors',
              correlateMode
                ? 'border-cyan-500 bg-cyan-500 text-white hover:bg-cyan-600'
                : 'border-input bg-background text-foreground hover:bg-accent',
            )}
          >
            {correlateMode ? 'On' : 'Off'}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-medium text-muted-foreground">Metric X</label>
          <AppSelect
            aria-label="Correlation metric X"
            value={metricX}
            onValueChange={(value) => onMetricXChange(value as ScoreMetricKey)}
            options={metricOptions}
            className="w-56"
            triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-medium text-muted-foreground">Metric Y</label>
          <AppSelect
            aria-label="Correlation metric Y"
            value={metricY}
            onValueChange={(value) => onMetricYChange(value as ScoreMetricKey)}
            options={metricOptions}
            className="w-56"
            triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
          />
        </div>
        <div className="flex items-center justify-end">
          <button
            type="button"
            onClick={flipAxes}
            className="inline-flex items-center gap-1 rounded border border-input px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <FlipHorizontal className="h-3 w-3" /> Swap X / Y
          </button>
        </div>
      </div>

      <div className="rounded-lg border border-border p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase text-muted-foreground">Map style</span>
          <div className="inline-flex overflow-hidden rounded border border-input">
            <button
              type="button"
              onClick={() => onVisStyleChange('bivariate')}
              className={cn(
                'px-2 py-1 text-[11px] font-medium transition-colors',
                visStyle === 'bivariate'
                  ? 'bg-cyan-500 text-white'
                  : 'bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              Bivariate
            </button>
            <button
              type="button"
              onClick={() => onVisStyleChange('residual')}
              className={cn(
                'px-2 py-1 text-[11px] font-medium transition-colors',
                visStyle === 'residual'
                  ? 'bg-cyan-500 text-white'
                  : 'bg-background text-muted-foreground hover:bg-accent',
              )}
            >
              Residual
            </button>
          </div>
        </div>
        <div className="text-[10px] leading-snug text-muted-foreground">
          {visStyle === 'bivariate'
            ? 'Each region is colored by its (X tertile, Y tertile) cell in the 3×3 grid. Top-right of the grid = high on both.'
            : 'Each region is colored by its residual from a least-squares line of Y on X. Red = above the line; blue = below.'}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Pearson r" value={stats ? stats.pearson.toFixed(2) : '–'} />
        <StatTile label="r²" value={stats ? stats.rSquared.toFixed(2) : '–'} />
        <StatTile label="n" value={stats ? String(stats.n) : '–'} />
      </div>
      {stats && (stats.xMin === stats.xMax || stats.yMin === stats.yMax) && (
        <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[10px] leading-snug text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
          {stats.xMin === stats.xMax
            ? `${getMetricLabel(metricX)} has the same value for every region — likely the data source is off in the left panel.`
            : `${getMetricLabel(metricY)} has the same value for every region — likely the data source is off in the left panel.`}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <StatTile
          label={
            <>
              Spearman <span className="normal-case">ρ</span>
            </>
          }
          value={stats ? stats.spearman.toFixed(2) : '–'}
        />
        <StatTile
          label="Strength"
          value={stats ? describeStrength(stats.pearson) : '–'}
        />
      </div>

      <CorrelationScatter result={result} xLabel={xLabel} yLabel={yLabel} active={correlateMode} />

      <div>
        <div className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
          Strongest pairs (|r|)
        </div>
        {topPairs.length === 0 ? (
          <div className="text-xs text-muted-foreground">
            {correlateMode ? 'Computing pairs…' : 'Turn correlation mode on to see the strongest pairs across all metrics.'}
          </div>
        ) : (
          <div className="space-y-1">
            {topPairs.map((pair) => (
              <button
                key={`${pair.metricX}-${pair.metricY}`}
                type="button"
                onClick={() => onApplyTopPair(pair.metricX, pair.metricY)}
                className="flex w-full items-center justify-between gap-2 rounded border border-border bg-background px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent"
              >
                <span className="min-w-0 truncate text-foreground">
                  {getMetricLabel(pair.metricX)} <span className="text-muted-foreground">×</span>{' '}
                  {getMetricLabel(pair.metricY)}
                </span>
                <span
                  className={cn(
                    'shrink-0 font-medium',
                    pair.pearson >= 0 ? 'text-cyan-700 dark:text-cyan-300' : 'text-rose-700 dark:text-rose-300',
                  )}
                >
                  {pair.pearson.toFixed(2)} · n={pair.n}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: ReactNode; value: string }) {
  return (
    <div className="rounded border border-border bg-muted/20 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="text-sm font-semibold text-foreground">{value}</div>
    </div>
  )
}

function describeStrength(r: number): string {
  const abs = Math.abs(r)
  if (abs < 0.1) return 'None'
  if (abs < 0.3) return 'Weak'
  if (abs < 0.5) return 'Moderate'
  if (abs < 0.7) return 'Strong'
  return 'Very strong'
}

function CorrelationScatter({
  result,
  xLabel,
  yLabel,
  active,
}: {
  result: CorrelationResult
  xLabel: string
  yLabel: string
  active: boolean
}) {
  const { stats, points } = result
  if (!stats || points.length === 0) {
    return (
      <div className="rounded border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
        {active
          ? 'No region has finite values for both metrics in the current boundary level.'
          : 'Turn correlation mode on to plot the scatter and load statistics.'}
      </div>
    )
  }

  const width = 280
  const height = 200
  const margin = { top: 10, right: 12, bottom: 26, left: 32 }
  const innerW = width - margin.left - margin.right
  const innerH = height - margin.top - margin.bottom

  const xRange = stats.xMax - stats.xMin || 1
  const yRange = stats.yMax - stats.yMin || 1

  const cellsX = 18
  const cellsY = 14
  const counts = new Map<string, number>()
  let maxCount = 0
  for (const point of points) {
    const cx = Math.min(cellsX - 1, Math.floor(((point.x - stats.xMin) / xRange) * cellsX))
    const cy = Math.min(cellsY - 1, Math.floor(((point.y - stats.yMin) / yRange) * cellsY))
    const key = `${cx},${cy}`
    const next = (counts.get(key) ?? 0) + 1
    counts.set(key, next)
    if (next > maxCount) maxCount = next
  }
  const cellW = innerW / cellsX
  const cellH = innerH / cellsY

  const lineX0 = stats.xMin
  const lineX1 = stats.xMax
  const lineY0 = stats.slope * lineX0 + stats.intercept
  const lineY1 = stats.slope * lineX1 + stats.intercept

  const xAt = (xValue: number) => margin.left + ((xValue - stats.xMin) / xRange) * innerW
  const yAt = (yValue: number) => margin.top + innerH - ((yValue - stats.yMin) / yRange) * innerH

  const cells: JSX.Element[] = []
  for (const [key, count] of counts) {
    const [cx, cy] = key.split(',').map(Number)
    const intensity = Math.max(0, Math.min(1, count / maxCount))
    const fill = `rgba(8, 145, 178, ${0.15 + 0.7 * intensity})`
    cells.push(
      <rect
        key={key}
        x={margin.left + cx * cellW}
        y={margin.top + innerH - (cy + 1) * cellH}
        width={cellW}
        height={cellH}
        fill={fill}
      />,
    )
  }

  return (
    <div className="rounded border border-border bg-background p-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Scatter density for ${xLabel} vs ${yLabel}`}
      >
        <rect
          x={margin.left}
          y={margin.top}
          width={innerW}
          height={innerH}
          fill="hsl(var(--muted))"
          opacity={0.25}
        />
        {cells}
        <line
          x1={xAt(lineX0)}
          y1={yAt(lineY0)}
          x2={xAt(lineX1)}
          y2={yAt(lineY1)}
          stroke="#0f172a"
          strokeWidth={1.25}
          strokeDasharray="3 3"
        />
        <line x1={margin.left} y1={margin.top + innerH} x2={margin.left + innerW} y2={margin.top + innerH} stroke="currentColor" strokeWidth={0.75} opacity={0.4} />
        <line x1={margin.left} y1={margin.top} x2={margin.left} y2={margin.top + innerH} stroke="currentColor" strokeWidth={0.75} opacity={0.4} />
        <text
          x={margin.left + innerW / 2}
          y={height - 6}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          opacity={0.7}
        >
          {xLabel}
        </text>
        <text
          x={-margin.top - innerH / 2}
          y={11}
          textAnchor="middle"
          fontSize={10}
          fill="currentColor"
          opacity={0.7}
          transform="rotate(-90)"
        >
          {yLabel}
        </text>
      </svg>
      <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Cells shaded by region count · dashed line = least-squares fit</span>
        <span>{points.length} regions</span>
      </div>
    </div>
  )
}

function RegionsTab({
  loading,
  regions,
  visibleRows,
  filteredRegions,
  selectedRegion,
  selectedRegionDrivers,
  comparisonRegions,
  comparisonSet,
  weights,
  scoreSpread,
  searchQuery,
  onSearchQueryChange,
  onRegionSelect,
  onClearRegionSelection,
  onOpenRegionInsight,
  onToggleComparison,
  onClearComparison,
  onExport,
}: {
  loading: boolean
  regions: ScoredBoundaryRegion[]
  visibleRows: ScoredBoundaryRegion[]
  filteredRegions: ScoredBoundaryRegion[]
  selectedRegion: ScoredBoundaryRegion | null
  selectedRegionDrivers: ScoreDriver[]
  comparisonRegions: ScoredBoundaryRegion[]
  comparisonSet: Set<string>
  weights: ScoreMetricWeightMap
  scoreSpread: { min: number; max: number; average: number }
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  onRegionSelect: (regionId: string) => void
  onClearRegionSelection: () => void
  onOpenRegionInsight: (regionId: string) => void
  onToggleComparison: (regionId: string) => void
  onClearComparison: () => void
  onExport: (format: 'csv' | 'geojson') => void
}) {
  return (
    <div className="space-y-3 p-4" data-score-builder-section="regions">
      {/* Search + export */}
      <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search by code or name..."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 pl-7 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => onExport('csv')}
              title="Export CSV"
              className="rounded border border-input p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onExport('geojson')}
              title="Export GeoJSON"
              className="rounded border border-input px-1.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              .geo
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between" data-score-builder-region-stats="true">
          <span>
            {filteredRegions.length} of {regions.length} regions
          </span>
          {filteredRegions.length > MAX_VISIBLE_ROWS && <span>Showing {MAX_VISIBLE_ROWS}</span>}
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span>
            Score range {formatScore(scoreSpread.min)} - {formatScore(scoreSpread.max)}
          </span>
          <span>Avg {formatScore(scoreSpread.average)}</span>
        </div>
      </div>

      {/* Comparison panel */}
      {comparisonRegions.length > 0 && (
        <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-amber-900 dark:text-amber-100">
              Compare ({comparisonRegions.length}/3)
            </span>
            <button
              onClick={onClearComparison}
              className="text-[11px] text-amber-700 hover:text-amber-900 dark:text-amber-300"
            >
              Clear
            </button>
          </div>
          <div className="space-y-1">
            {comparisonRegions.map((r) => (
              <div key={r.region.id} className="flex items-center justify-between text-[11px]">
                <span className="truncate text-amber-900 dark:text-amber-100">
                  #{r.rank} {r.region.name}
                </span>
                <span className="font-semibold text-amber-700 dark:text-amber-300">{formatScore(r.score)}</span>
              </div>
            ))}
          </div>
          {comparisonRegions.length >= 2 && (
            <>
              <RadarChart regions={comparisonRegions} weights={weights} className="mt-2" />
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[10px]">
                  <thead>
                    <tr className="text-amber-700 dark:text-amber-300">
                      <th className="pr-2 text-left font-medium">Metric</th>
                      {comparisonRegions.map((r) => (
                        <th key={r.region.id} className="px-1 text-right font-medium">
                          {r.region.name.slice(0, 12)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {SCORE_METRICS.filter((m) => weights[m.key] !== 0)
                      .slice(0, 6)
                      .map((m) => (
                        <tr key={m.key} className="text-amber-800 dark:text-amber-200">
                          <td className="pr-2 text-left">{m.shortLabel}</td>
                          {comparisonRegions.map((r) => (
                            <td key={r.region.id} className="px-1 text-right font-mono">
                              {formatMetricValue(m.key, r.metrics[m.key], true)}
                            </td>
                          ))}
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Selected region card */}
      {selectedRegion && (
        <div className="rounded-lg border border-cyan-300/50 bg-cyan-50 p-3 dark:border-cyan-900/70 dark:bg-cyan-950/25">
          <div className="mb-2">
            <div className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">{selectedRegion.region.name}</div>
            <div className="text-xs text-cyan-700 dark:text-cyan-300">
              Rank #{selectedRegion.rank} | Score {formatScore(selectedRegion.score)}
            </div>
            <div className="mt-0.5 text-[11px] font-medium text-cyan-800 dark:text-cyan-200">
              {selectedRegion.rankConfidence} · rank #{selectedRegion.rankInterval[0]}-#
              {selectedRegion.rankInterval[1]} · score {formatScore(selectedRegion.scoreInterval[0])}-
              {formatScore(selectedRegion.scoreInterval[1])}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-cyan-800 dark:text-cyan-200">
            <div>Area: {selectedRegion.region.areaKm2.toFixed(1)} km²</div>
            <div>Sensors: {selectedRegion.counts.monitorCount.toLocaleString()}</div>
            <div>Parks: {selectedRegion.counts.parkCount.toLocaleString()}</div>
            <div>Restaurants: {selectedRegion.counts.restaurantCount.toLocaleString()}</div>
            <div>Coverage: {(selectedRegion.dataCoverageScore * 100).toFixed(0)}%</div>
          </div>
          {selectedRegionDrivers.length > 0 && (
            <div className="mt-2 text-[11px] text-cyan-800 dark:text-cyan-200">
              Top drivers:{' '}
              {selectedRegionDrivers
                .map((driver) => `${driver.intentLabel} ${formatDriverDelta(driver.scoreDelta)}`)
                .join(', ')}{' '}
              pts
            </div>
          )}
          <div className="mt-2 flex items-center gap-2">
            <button
              data-score-builder-region-insight={selectedRegion.region.id}
              onClick={() => onOpenRegionInsight(selectedRegion.region.id)}
              className="rounded border border-cyan-400/70 bg-white/70 px-2 py-1 text-xs font-medium text-cyan-900 transition-colors hover:bg-white dark:border-cyan-800 dark:bg-cyan-950/20 dark:text-cyan-100"
            >
              View Insight
            </button>
            <button
              onClick={() => onToggleComparison(selectedRegion.region.id)}
              className={cn(
                'rounded border px-2 py-1 text-xs transition-colors',
                comparisonSet.has(selectedRegion.region.id)
                  ? 'border-amber-400 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/20 dark:text-amber-200'
                  : 'border-cyan-300/70 text-cyan-800 hover:bg-cyan-100/70 dark:border-cyan-900 dark:text-cyan-300',
              )}
            >
              {comparisonSet.has(selectedRegion.region.id) ? 'Unpin' : 'Compare'}
            </button>
            <button
              onClick={onClearRegionSelection}
              className="rounded border border-cyan-300/70 px-2 py-1 text-xs text-cyan-800 transition-colors hover:bg-cyan-100/70 dark:border-cyan-900 dark:text-cyan-300 dark:hover:bg-cyan-950/40"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Region list */}
      {loading ? (
        <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
          Building region scores...
        </div>
      ) : (
        <div className="space-y-2">
          {visibleRows.map((entry) => {
            const selected = selectedRegion?.region.id === entry.region.id
            const pinned = comparisonSet.has(entry.region.id)
            const topDrivers = getScoreDrivers(entry, weights, 2)
            return (
              <div
                key={entry.region.id}
                className={cn(
                  'rounded-lg border border-border bg-background p-2 transition-colors',
                  selected && 'border-cyan-300 bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950/35',
                  pinned && !selected && 'border-amber-300/60 dark:border-amber-900/60',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button onClick={() => onRegionSelect(entry.region.id)} className="min-w-0 flex-1 text-left">
                    <div className="line-clamp-1 text-sm font-medium text-foreground">
                      #{entry.rank} {entry.region.name}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Code {entry.region.code} | Density{' '}
                      {formatMetricValue('overallDensity', entry.metrics.overallDensity)}
                    </div>
                    {topDrivers.length > 0 && (
                      <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                        Top:{' '}
                        {topDrivers
                          .map((driver) => `${driver.intentLabel} ${formatDriverDelta(driver.scoreDelta)}`)
                          .join(', ')}{' '}
                        pts
                      </div>
                    )}
                    {entry.dataCoverageScore < 0.6 && (
                      <div className="mt-1 inline-flex rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
                        Thin data coverage
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {entry.rankConfidence} · rank #{entry.rankInterval[0]}-#{entry.rankInterval[1]} · score{' '}
                      {formatScore(entry.scoreInterval[0])}-{formatScore(entry.scoreInterval[1])}
                    </div>
                  </button>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">
                      {formatScore(entry.score)}
                    </span>
                    <button
                      data-score-builder-region-insight={entry.region.id}
                      onClick={() => onOpenRegionInsight(entry.region.id)}
                      className="rounded border border-input px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    >
                      Insight
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
          {visibleRows.length === 0 && (
            <div className="rounded border border-border bg-muted/20 p-3 text-sm text-muted-foreground">
              No regions match this filter.
            </div>
          )}
        </div>
      )}
    </div>
  )
}
