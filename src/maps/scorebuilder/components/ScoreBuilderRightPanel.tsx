import { useMemo, useState } from 'react'
import { Download, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'
import {
  DENSITY_METRIC_OPTIONS,
  SCORE_EXAMPLES,
  SCORE_METRICS,
  SCORE_METRICS_BY_CATEGORY,
  SCORE_PRESETS,
} from '../constants'
import { METRIC_CATEGORY_LABELS } from '../types'
import type {
  ScoredBoundaryRegion,
  ScoreDataSource,
  ScoreMetricKey,
  ScoreMetricWeightMap,
} from '../types'
import { RadarChart } from './RadarChart'

type RightPanelTab = 'examples' | 'equation' | 'density' | 'regions'

interface ScoreBuilderRightPanelProps {
  className?: string
  loading: boolean
  dataErrors: string[]
  weights: ScoreMetricWeightMap
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onApplyPreset: (presetKey: string) => void
  activePresetKey: string | null
  equationPreview: string
  scoreSpread: { min: number; max: number; average: number }
  densityMetric: ScoreMetricKey
  onDensityMetricChange: (metric: ScoreMetricKey) => void
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
  activeExampleKey: string | null
  onApplyExample: (key: string) => void
  isDesktop: boolean
}

const MAX_VISIBLE_ROWS = 220

const TAB_ORDER: RightPanelTab[] = ['examples', 'equation', 'density', 'regions']
const TAB_LABELS: Record<RightPanelTab, string> = {
  examples: 'Examples',
  equation: 'Equation',
  density: 'Density',
  regions: 'Regions',
}

function getMetricLabel(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.label || key
}

function getMetricDescription(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.description || ''
}

function getMetricFormat(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.format || 'count'
}

function getDataSourceLabel(source: ScoreDataSource): string {
  if (source === 'airQuality') return 'Air'
  if (source === 'parks') return 'Parks'
  if (source === 'restaurants') return 'Food'
  if (source === 'census') return 'Census'
  if (source === 'bcAssessment') return 'Property'
  if (source === 'crime') return 'Crime'
  return source
}

function formatMetricValue(metric: ScoreMetricKey, value: number, compact = false): string {
  const format = getMetricFormat(metric)

  if (metric === 'foodRiskScore') {
    const riskScore = value * 100
    return compact ? `${riskScore.toFixed(0)}/100 risk` : `${riskScore.toFixed(1)} / 100 risk index`
  }
  if (metric === 'crimePerCapita') {
    const perThousand = value * 1_000
    return compact
      ? `${perThousand.toLocaleString(undefined, { maximumFractionDigits: 1 })}/1k residents`
      : `${perThousand.toLocaleString(undefined, { maximumFractionDigits: 2 })} incidents / 1,000 residents`
  }
  if (format === 'density') {
    const scaled = value * 1_000
    return compact
      ? `${scaled.toLocaleString(undefined, { maximumFractionDigits: 1 })}/1k km²`
      : `${scaled.toLocaleString(undefined, { maximumFractionDigits: 2 })} / 1,000 km²`
  }
  if (format === 'ratio') return `${(value * 100).toFixed(1)}%`
  if (format === 'percent') return `${(value * 100).toFixed(1)}%`
  if (format === 'currency') {
    if (compact) {
      if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`
      return `$${Math.round(value / 1000).toLocaleString()}k`
    }
    return value.toLocaleString(undefined, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
  }
  if (format === 'years') return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} yrs`
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatScore(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function clampWeight(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)))
}

function getTopDrivers(
  region: ScoredBoundaryRegion,
  weights: ScoreMetricWeightMap,
  limit = 2,
): Array<{ key: ScoreMetricKey; label: string; scoreDelta: number }> {
  return SCORE_METRICS
    .filter((metric) => weights[metric.key] !== 0)
    .map((metric) => ({
      key: metric.key,
      label: metric.shortLabel,
      scoreDelta: region.contributions[metric.key] * 100,
    }))
    .filter((driver) => Math.abs(driver.scoreDelta) >= 0.005)
    .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
    .slice(0, limit)
}

function formatDriverDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
}

export function ScoreBuilderRightPanel({
  className,
  loading,
  dataErrors,
  weights,
  onWeightChange,
  onApplyPreset,
  activePresetKey,
  equationPreview,
  scoreSpread,
  densityMetric,
  onDensityMetricChange,
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
  activeExampleKey,
  onApplyExample,
  isDesktop,
}: ScoreBuilderRightPanelProps) {
  const [activeTab, setActiveTab] = useState<RightPanelTab>('equation')

  const comparisonSet = useMemo(() => new Set(comparisonIds), [comparisonIds])
  const visibleRows = useMemo(() => filteredRegions.slice(0, MAX_VISIBLE_ROWS), [filteredRegions])

  const activeExample = useMemo(
    () => SCORE_EXAMPLES.find((example) => example.key === activeExampleKey) || null,
    [activeExampleKey],
  )
  const activePreset = useMemo(
    () => SCORE_PRESETS.find((preset) => preset.key === activePresetKey) || null,
    [activePresetKey],
  )
  const selectedRegionDrivers = useMemo(
    () => (selectedRegion ? getTopDrivers(selectedRegion, weights, 2) : []),
    [selectedRegion, weights],
  )
  const totalAbsoluteWeight = useMemo(() => {
    return SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
  }, [weights])

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden border-l border-border bg-background/95 shadow-xl backdrop-blur',
        className,
      )}
      data-score-builder-right-panel="true"
    >
      <div className="border-b border-border px-4 py-3">
        <h1 className="text-base font-bold text-foreground">Score Builder</h1>
        <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
          {activeExample
            ? `${activeExample.label}: ${activeExample.question}`
            : activePreset
              ? `${activePreset.label}: ${activePreset.description}`
              : 'Choose a scenario or build a custom scoring equation.'}
        </p>
      </div>

      {/* Tabs */}
      <div role="tablist" className="flex shrink-0 border-b border-border bg-background/95">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            role="tab"
            type="button"
            aria-selected={activeTab === tab}
            data-score-builder-tab={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              'relative flex-1 px-3 py-2.5 text-xs font-medium transition-colors',
              activeTab === tab
                ? 'text-cyan-700 dark:text-cyan-300'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {TAB_LABELS[tab]}
            {activeTab === tab && (
              <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-cyan-500" />
            )}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        {dataErrors.length > 0 && (
          <div className="m-3 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
            <p className="font-medium">Unable to build scores</p>
            {dataErrors.map((err, i) => <p key={i}>{err}</p>)}
          </div>
        )}

        {activeTab === 'examples' && (
          <ExamplesTab
            activeExampleKey={activeExampleKey}
            onApplyExample={onApplyExample}
          />
        )}

        {activeTab === 'equation' && (
          <EquationTab
            isDesktop={isDesktop}
            weights={weights}
            onWeightChange={onWeightChange}
            onApplyPreset={onApplyPreset}
            activePresetKey={activePresetKey}
            activePreset={activePreset}
            activeExample={activeExample}
            equationPreview={equationPreview}
            totalAbsoluteWeight={totalAbsoluteWeight}
          />
        )}

        {activeTab === 'density' && (
          <DensityTab
            densityMetric={densityMetric}
            onDensityMetricChange={onDensityMetricChange}
            densitySummary={densitySummary}
            densityLeaders={densityLeaders}
            selectedRegion={selectedRegion}
            onRegionSelect={onRegionSelect}
          />
        )}

        {activeTab === 'regions' && (
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

function ExamplesTab({
  activeExampleKey,
  onApplyExample,
}: {
  activeExampleKey: string | null
  onApplyExample: (key: string) => void
}) {
  return (
    <div
      className="space-y-3 p-4"
      data-score-builder-section="examples"
    >
      <p className="text-[11px] text-muted-foreground">
        Pick a scenario to configure boundaries, data sources, and scoring weights together.
      </p>

      {[
        { source: 'census' as const, title: 'Census Boundaries (Prince George)' },
        { source: 'bcHealth' as const, title: 'Health Authority Boundaries (BC-wide)' },
      ].map(({ source, title }) => {
        const group = SCORE_EXAMPLES.filter((e) => e.boundarySource === source)
        if (!group.length) return null
        return (
          <div key={source}>
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </div>
            <div className="space-y-2">
              {group.map((example) => {
                const active = activeExampleKey === example.key
                const levelLabel = source === 'bcHealth'
                  ? { healthAuthority: 'HA', hsda: 'HSDA', lha: 'LHA', chsa: 'CHSA' }[example.boundaryLevel] || example.boundaryLevel
                  : { cd: 'CD', csd: 'CSD', ct: 'CT', da: 'DA' }[example.boundaryLevel] || example.boundaryLevel
                return (
                  <button
                    key={example.key}
                    onClick={() => onApplyExample(example.key)}
                    className={cn(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      active
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
                    <div className="mt-1 text-xs font-medium text-cyan-700 dark:text-cyan-300">
                      {example.question}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">
                      {example.description}
                    </div>
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

function EquationTab({
  isDesktop,
  weights,
  onWeightChange,
  onApplyPreset,
  activePresetKey,
  activePreset,
  activeExample,
  equationPreview,
  totalAbsoluteWeight,
}: {
  isDesktop: boolean
  weights: ScoreMetricWeightMap
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onApplyPreset: (presetKey: string) => void
  activePresetKey: string | null
  activePreset: typeof SCORE_PRESETS[number] | null
  activeExample: typeof SCORE_EXAMPLES[number] | null
  equationPreview: string
  totalAbsoluteWeight: number
}) {
  return (
    <div
      className="space-y-3 p-4"
      data-score-builder-section="equation"
    >
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Presets
        </div>
        <div className="flex flex-wrap gap-2">
          {SCORE_PRESETS.map((preset) => (
            <button
              key={preset.key}
              onClick={() => onApplyPreset(preset.key)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                activePresetKey === preset.key
                  ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100'
                  : 'border-input text-muted-foreground hover:text-foreground',
              )}
              title={preset.description}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-md border border-border bg-muted/15 p-2 text-xs text-muted-foreground">
        {activePreset
          ? `${activePreset.label} intent: ${activePreset.description}`
          : activeExample
            ? `Scenario intent: ${activeExample.description}`
            : 'Preset buttons shift the score toward common planning questions; custom weights refine the equation.'}
      </div>

      {!isDesktop && (
        <div
          data-score-builder-mobile-note="true"
          className="rounded-md border border-cyan-200/70 bg-cyan-50 p-2 text-xs text-cyan-800 dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-200"
        >
          Custom metric weight editing is available on desktop. Mobile supports preset scoring and region insight review.
        </div>
      )}

      {isDesktop && (
        <div className="space-y-4">
          {Object.entries(SCORE_METRICS_BY_CATEGORY).map(([category, metrics]) => (
            <div key={category}>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] || category}
              </div>
              <div className="space-y-2">
                {metrics.map((metric) => (
                  <div key={metric.key} className="rounded-lg border border-border bg-muted/25 p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-semibold text-foreground">{metric.label}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {metric.description}
                        </div>
                      </div>
                      <input
                        type="number"
                        data-score-builder-equation-number={metric.key}
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
                      data-score-builder-equation-slider={metric.key}
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
        </div>
      )}

      <div className="rounded-md border border-border bg-background p-2">
        <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Equation</div>
        <div className="font-mono text-[11px] text-foreground">{equationPreview}</div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          |weights| sum: {totalAbsoluteWeight.toLocaleString()}
        </div>
      </div>
    </div>
  )
}

function DensityTab({
  densityMetric,
  onDensityMetricChange,
  densitySummary,
  densityLeaders,
  selectedRegion,
  onRegionSelect,
}: {
  densityMetric: ScoreMetricKey
  onDensityMetricChange: (metric: ScoreMetricKey) => void
  densitySummary: { min: number; max: number; median: number; average: number } | null
  densityLeaders: ScoredBoundaryRegion[]
  selectedRegion: ScoredBoundaryRegion | null
  onRegionSelect: (regionId: string) => void
}) {
  return (
    <div
      className="space-y-2 p-4"
      data-score-builder-section="density"
    >
      <div className="flex items-center justify-between gap-2">
        <label
          htmlFor="score-builder-density"
          className="text-xs font-medium text-muted-foreground"
        >
          Density metric
        </label>
        <select
          id="score-builder-density"
          value={densityMetric}
          onChange={(event) => onDensityMetricChange(event.target.value as ScoreMetricKey)}
          className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
        >
          {DENSITY_METRIC_OPTIONS.map((metric) => (
            <option key={metric} value={metric}>
              {getMetricLabel(metric)}
            </option>
          ))}
        </select>
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
          <div className="text-[10px] text-muted-foreground">
            {getMetricDescription(densityMetric)}
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground">
          No values available for this density lens.
        </div>
      )}
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
  selectedRegionDrivers: Array<{ key: ScoreMetricKey; label: string; scoreDelta: number }>
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
    <div
      className="space-y-3 p-4"
      data-score-builder-section="regions"
    >
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
        <div
          className="flex items-center justify-between"
          data-score-builder-region-stats="true"
        >
          <span>{filteredRegions.length} of {regions.length} regions</span>
          {filteredRegions.length > MAX_VISIBLE_ROWS && (
            <span>Showing {MAX_VISIBLE_ROWS}</span>
          )}
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span>Score range {formatScore(scoreSpread.min)} - {formatScore(scoreSpread.max)}</span>
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
                <span className="font-semibold text-amber-700 dark:text-amber-300">
                  {formatScore(r.score)}
                </span>
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
                    {SCORE_METRICS.filter((m) => weights[m.key] !== 0).slice(0, 6).map((m) => (
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
            <div className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">
              {selectedRegion.region.name}
            </div>
            <div className="text-xs text-cyan-700 dark:text-cyan-300">
              Rank #{selectedRegion.rank} | Score {formatScore(selectedRegion.score)}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-cyan-800 dark:text-cyan-200">
            <div>Area: {selectedRegion.region.areaKm2.toFixed(1)} km²</div>
            <div>Sensors: {selectedRegion.counts.monitorCount.toLocaleString()}</div>
            <div>Parks: {selectedRegion.counts.parkCount.toLocaleString()}</div>
            <div>Restaurants: {selectedRegion.counts.restaurantCount.toLocaleString()}</div>
          </div>
          {selectedRegionDrivers.length > 0 && (
            <div className="mt-2 text-[11px] text-cyan-800 dark:text-cyan-200">
              Top drivers: {selectedRegionDrivers.map((driver) => `${driver.label} ${formatDriverDelta(driver.scoreDelta)}`).join(', ')} pts
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
            const topDrivers = getTopDrivers(entry, weights, 2)
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
                  <button
                    onClick={() => onRegionSelect(entry.region.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="line-clamp-1 text-sm font-medium text-foreground">
                      #{entry.rank} {entry.region.name}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Code {entry.region.code} | Density {formatMetricValue('overallDensity', entry.metrics.overallDensity)}
                    </div>
                    {topDrivers.length > 0 && (
                      <div className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">
                        Top: {topDrivers.map((driver) => `${driver.label} ${formatDriverDelta(driver.scoreDelta)}`).join(', ')} pts
                      </div>
                    )}
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
