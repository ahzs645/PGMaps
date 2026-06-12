import { useEffect, useMemo, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoundarySource } from '@/maps/airquality'
import { SCORE_BUILDER_EXAMPLES, SCORE_METRICS, SCORE_PRESETS } from '../constants'
import type { ScoredBoundaryRegion, ScoreMetricKey, ScoreMetricRangeMap, ScoreMetricWeightMap } from '../types'
import type { ScoreBuilderExportFormat } from '../lib/exportRegions'
import type { BaselineComparisonResult, BaselineSnapshot } from '../lib/baselineComparison'
import { presetAppliesToBoundary } from '../lib/presets'
import { getScoreDrivers } from '../lib/scoreDrivers'
import type { CorrelationResult, MetricCorrelation } from '../lib/correlation'
import type { PopulationWeightedEquitySummary } from '../lib/populationSummary'
import { CorrelateTab } from './CorrelateTab'
import { EquationTab } from './EquationTab'
import { DensityTab } from './DensityTab'
import { RegionsTab } from './RegionsTab'

type RightPanelTab = 'equation' | 'density' | 'correlate' | 'regions'

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
  populationEquitySummary: PopulationWeightedEquitySummary | null
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
  onExport: (format: ScoreBuilderExportFormat) => void
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
  baseline: BaselineSnapshot | null
  baselineComparison: BaselineComparisonResult | null
  onPinBaseline: () => void
  onClearBaseline: () => void
}

const TAB_LABELS: Record<RightPanelTab, string> = {
  equation: 'Equation',
  density: 'Density',
  correlate: 'Correlate',
  regions: 'Regions',
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
  populationEquitySummary,
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
  baseline,
  baselineComparison,
  onPinBaseline,
  onClearBaseline,
}: ScoreBuilderRightPanelProps) {
  const [activeTab, setActiveTab] = useState<RightPanelTab>('regions')
  const [shareStatus, setShareStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
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
    })
    return () => cancelAnimationFrame(frame)
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
      const frame = requestAnimationFrame(() => setActiveTab('equation'))
      return () => cancelAnimationFrame(frame)
    }
  }, [activeTab, hasActiveBoundarySurface])

  const comparisonSet = useMemo(() => new Set(comparisonIds), [comparisonIds])
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
            className="p-4"
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
            className="p-4"
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
        )}
      </div>
    </div>
  )
}
