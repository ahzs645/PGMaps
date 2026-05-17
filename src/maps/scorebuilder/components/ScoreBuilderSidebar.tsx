import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, ChevronUp, Copy, Download } from 'lucide-react'
import { DatasetInfo } from '@/components/DatasetInfo'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
import { AppSelect } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import {
  BOUNDARY_SOURCE_OPTIONS,
  DENSITY_METRIC_OPTIONS,
  HEALTHYPLAN_PAIRWISE_PRESETS,
  SCORE_METRICS,
  SCORE_METRICS_BY_CATEGORY,
  SCORE_PRESETS,
  SCORE_BUILDER_EXAMPLES,
  getScorePresetMethodology,
} from '../constants'
import type {
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
import { formatMetricValue, formatScore, getMetricDescription, getMetricLabel } from '../lib/metrics'
import { presetAppliesToBoundary } from '../lib/presets'
import { formatDriverDelta, getScoreDrivers } from '../lib/scoreDrivers'
import { RadarChart } from './RadarChart'
import { ScorePresetDialog } from './ScorePresetDialog'

type ScoreBuilderSectionId =
  | 'examples'
  | 'setup'
  | 'dataSources'
  | 'equation'
  | 'methodology'
  | 'model'
  | 'robustness'
  | 'density'
  | 'regions'

type ExpandedSectionsState = Record<ScoreBuilderSectionId, boolean>

function formatNormalizationMethod(method: ScoreMethodSettings['normalization']): string {
  if (method === 'percentile') return 'percentile rank'
  if (method === 'winsorizedMinMax') return 'winsorized min-max'
  if (method === 'zScore') return 'z-score'
  return 'min-max'
}

function formatAggregationMethod(method: ScoreMethodSettings['aggregation']): string {
  if (method === 'healthyPlanPairwisePriority') return 'HealthyPlan-style pairwise priority'
  if (method === 'modulePercentileRankedSum') return 'EJI-style module ranked sum'
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

interface ScoreBuilderSidebarProps {
  className?: string
  loading: boolean
  dataErrors: string[]
  boundarySource: BoundarySource
  onBoundarySourceChange: (source: BoundarySource) => void
  selectedRegionLevel: RegionLevel
  onRegionLevelChange: (level: RegionLevel) => void
  boundaryLevelOptions: Array<{ value: RegionLevel; label: string }>
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
  onExport: (format: 'csv' | 'geojson') => void
  onShareUrl?: () => Promise<string>
  activeExampleKey: string | null
  onApplyExample: (key: string) => void
  isDesktop: boolean
}

const MAX_VISIBLE_ROWS = 220
const SECTION_ORDER: ScoreBuilderSectionId[] = [
  'examples',
  'setup',
  'dataSources',
  'equation',
  'methodology',
  'model',
  'robustness',
  'density',
  'regions',
]
const SECTION_LABELS: Record<ScoreBuilderSectionId, string> = {
  examples: 'Examples',
  setup: 'Setup',
  dataSources: 'Data Sources',
  equation: 'Equation',
  methodology: 'Method',
  model: 'Model',
  robustness: 'Robust',
  density: 'Density',
  regions: 'Regions',
}

function createExpandedSections(isDesktop: boolean): ExpandedSectionsState {
  if (isDesktop) {
    return {
      examples: true,
      setup: false,
      dataSources: false,
      equation: false,
      methodology: false,
      model: false,
      robustness: false,
      density: false,
      regions: true,
    }
  }
  return {
    examples: true,
    setup: false,
    dataSources: false,
    equation: false,
    methodology: false,
    model: false,
    robustness: false,
    density: false,
    regions: true,
  }
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

const SCORE_FILTER_DEFINITIONS: Array<{ key: ScoreFilterKey; label: string; description: string }> = [
  {
    key: 'requirePopulation',
    label: 'Require population data',
    description: 'Exclude regions without census population.',
  },
  {
    key: 'requireParks',
    label: 'Require parks or trails',
    description: 'Exclude regions with no parks, trails, or amenities.',
  },
  {
    key: 'limitCrime',
    label: 'Lower crime pressure',
    description: 'Keep regions at or below median crime per capita.',
  },
  {
    key: 'limitFoodRisk',
    label: 'Lower food-risk pressure',
    description: 'Keep regions at or below median food risk.',
  },
]

export function ScoreBuilderSidebar({
  className,
  loading,
  dataErrors,
  boundarySource,
  onBoundarySourceChange,
  selectedRegionLevel,
  onRegionLevelChange,
  boundaryLevelOptions,
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
}: ScoreBuilderSidebarProps) {
  const [shareStatus, setShareStatus] = useState<'idle' | 'copying' | 'copied' | 'failed'>('idle')
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])
  const enabledSourceSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const comparisonSet = useMemo(() => new Set(comparisonIds), [comparisonIds])
  const displayedBoundarySource = canUseWalkabilitySourceSurface && mapSurface === 'source' ? undefined : boundarySource

  const visibleRows = useMemo(() => filteredRegions.slice(0, MAX_VISIBLE_ROWS), [filteredRegions])
  const activeExample = useMemo(
    () => SCORE_BUILDER_EXAMPLES.find((example) => example.key === activeExampleKey) || null,
    [activeExampleKey],
  )
  const activePreset = useMemo(
    () => SCORE_PRESETS.find((preset) => preset.key === activePresetKey) || null,
    [activePresetKey],
  )
  const activePresetMethodology = useMemo(
    () => (activePreset ? getScorePresetMethodology(activePreset) : null),
    [activePreset],
  )
  const visiblePresets = useMemo(
    () => SCORE_PRESETS.filter((preset) => presetAppliesToBoundary(preset, boundarySource)),
    [boundarySource],
  )
  const selectedRegionDrivers = useMemo(
    () => (selectedRegion ? getScoreDrivers(selectedRegion, weights, 2) : []),
    [selectedRegion, weights],
  )
  const equityAuditSummary = useMemo(() => {
    const deprivationRegions = regions.filter((region) => region.equityAudit.deprivationQuintile !== null)
    const deprivationWeightedAverage = deprivationRegions.length
      ? deprivationRegions.reduce(
          (sum, region) => sum + region.score * (region.equityAudit.deprivationQuintile || 1),
          0,
        ) / deprivationRegions.reduce((sum, region) => sum + (region.equityAudit.deprivationQuintile || 1), 0)
      : null
    return {
      deprivationWeightedAverage,
      topBurdenOverlap: [...regions]
        .sort((a, b) => b.equityAudit.burdenOverlap - a.equityAudit.burdenOverlap)
        .slice(0, 3),
      hasCutoffWarnings: regions.some((region) => region.equityAudit.cutoffWarning),
    }
  }, [regions])

  const totalAbsoluteWeight = useMemo(() => {
    return SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
  }, [weights])
  const activeMetricCount = useMemo(() => SCORE_METRICS.filter((metric) => weights[metric.key] !== 0).length, [weights])
  const healthyPlanDemographicMetrics = useMemo(() => SCORE_METRICS.filter(isHealthyPlanDemographicMetric), [])
  const healthyPlanEnvironmentMetrics = useMemo(() => SCORE_METRICS.filter(isHealthyPlanEnvironmentMetric), [])
  const activeHealthyPlanPairKey = useMemo(() => {
    return (
      HEALTHYPLAN_PAIRWISE_PRESETS.find(
        (preset) =>
          preset.demographicMetric === methodSettings.healthyPlanPriority.demographicMetric &&
          preset.environmentMetric === methodSettings.healthyPlanPriority.environmentMetric,
      )?.key ?? 'custom'
    )
  }, [methodSettings.healthyPlanPriority])
  const updateMethodSettings = <Key extends keyof ScoreMethodSettings>(key: Key, value: ScoreMethodSettings[Key]) =>
    onMethodSettingsChange({ ...methodSettings, [key]: value })

  const [expandedSections, setExpandedSections] = useState<ExpandedSectionsState>(() =>
    createExpandedSections(isDesktop),
  )
  const [activeSection, setActiveSection] = useState<ScoreBuilderSectionId>('examples')
  const [showAllEquationMetrics, setShowAllEquationMetrics] = useState(false)
  const [presetDialogOpen, setPresetDialogOpen] = useState(false)

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Record<ScoreBuilderSectionId, HTMLElement | null>>({
    examples: null,
    setup: null,
    dataSources: null,
    equation: null,
    methodology: null,
    model: null,
    robustness: null,
    density: null,
    regions: null,
  })
  const sectionRatios = useRef<Record<ScoreBuilderSectionId, number>>({
    examples: 0,
    setup: 0,
    dataSources: 0,
    equation: 0,
    methodology: 0,
    model: 0,
    robustness: 0,
    density: 0,
    regions: 0,
  })

  useEffect(() => {
    setExpandedSections(createExpandedSections(isDesktop))
  }, [isDesktop])

  const evaluateActiveSection = useCallback(() => {
    const root = scrollContainerRef.current
    if (!root) return
    const referenceTop = root.scrollTop + 120
    let candidate: ScoreBuilderSectionId = SECTION_ORDER[0]
    SECTION_ORDER.forEach((id) => {
      const section = sectionRefs.current[id]
      if (!section) return
      if (section.offsetTop <= referenceTop) candidate = id
    })
    setActiveSection(candidate)
  }, [])

  useEffect(() => {
    const root = scrollContainerRef.current
    if (!root) return
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const sectionId = entry.target.getAttribute('data-score-builder-section-id') as ScoreBuilderSectionId | null
          if (!sectionId) return
          sectionRatios.current[sectionId] = entry.isIntersecting ? entry.intersectionRatio : 0
        })
        evaluateActiveSection()
      },
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    )
    SECTION_ORDER.forEach((id) => {
      const section = sectionRefs.current[id]
      if (section) observer.observe(section)
    })
    const handleScroll = () => evaluateActiveSection()
    root.addEventListener('scroll', handleScroll, { passive: true })
    evaluateActiveSection()
    return () => {
      observer.disconnect()
      root.removeEventListener('scroll', handleScroll)
    }
  }, [evaluateActiveSection])

  const setSectionRef = useCallback((sectionId: ScoreBuilderSectionId, element: HTMLElement | null) => {
    sectionRefs.current[sectionId] = element
  }, [])

  const toggleSection = useCallback((sectionId: ScoreBuilderSectionId) => {
    setExpandedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }))
  }, [])

  const scrollToSection = useCallback((sectionId: ScoreBuilderSectionId) => {
    const root = scrollContainerRef.current
    if (!root || !sectionRefs.current[sectionId]) return
    setExpandedSections((current) => ({ ...current, [sectionId]: true }))
    setActiveSection(sectionId)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const nextSection = sectionRefs.current[sectionId]
        if (!nextSection) return
        root.scrollTo({ top: Math.max(0, nextSection.offsetTop - 62), behavior: 'smooth' })
      })
    })
  }, [])

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

  const renderSectionHeader = (sectionId: ScoreBuilderSectionId) => {
    const sectionOpen = expandedSections[sectionId]
    return (
      <button
        type="button"
        onClick={() => toggleSection(sectionId)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        aria-expanded={sectionOpen}
      >
        <h2 className="text-sm font-semibold text-foreground">{SECTION_LABELS[sectionId]}</h2>
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
        'z-10 flex h-full min-h-0 w-[360px] flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur',
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
          <div className="flex flex-wrap gap-1.5">
            {SECTION_ORDER.map((sectionId) => (
              <button
                key={sectionId}
                type="button"
                data-score-builder-section-nav={sectionId}
                onClick={() => scrollToSection(sectionId)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  activeSection === sectionId
                    ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100'
                    : 'border-input text-muted-foreground hover:text-foreground',
                )}
              >
                {SECTION_LABELS[sectionId]}
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
            <div className="space-y-3 px-4 pb-4">
              <div className="rounded-lg border border-cyan-200 bg-cyan-50/70 p-3 text-xs dark:border-cyan-900/60 dark:bg-cyan-950/25">
                <div className="mb-2 font-semibold text-cyan-900 dark:text-cyan-100">Guided index workflow</div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-cyan-900/80 dark:text-cyan-100/80">
                  <div><span className="font-semibold">1.</span> Choose scenario</div>
                  <div><span className="font-semibold">2.</span> Review data</div>
                  <div><span className="font-semibold">3.</span> Tune weights</div>
                  <div><span className="font-semibold">4.</span> Inspect regions</div>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {activeExample
                  ? `Active scenario configures ${activeExample.boundaryLevel.toUpperCase()} boundaries, ${activeExample.dataSources.map(getDataSourceLabel).join(', ')}, and the matching weights.`
                  : 'Pick a PG scenario to configure boundaries, data sources, and scoring weights.'}
              </p>

              {/* Group examples by boundary source */}
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
                        const active = activeExampleKey === example.key
                        const levelLabel =
                          { ct: 'CT', da: 'DA', chsa: 'CHSA' }[example.boundaryLevel as 'ct' | 'da' | 'chsa'] ||
                          example.boundaryLevel
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
                sourceOptions={BOUNDARY_SOURCE_OPTIONS}
                level={selectedRegionLevel}
                levelOptions={boundaryLevelOptions}
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
                showPoints={showPoints}
                onTogglePoints={onTogglePoints}
                levelSelectId="score-builder-level"
                dataPrefix="score-builder"
              />

              <div className="mx-4 mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-base font-semibold text-foreground">{regions.length}</div>
                  <div className="text-[10px] text-muted-foreground">regions</div>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-base font-semibold text-foreground">{enabledDataSources.length}</div>
                  <div className="text-[10px] text-muted-foreground">sources</div>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-base font-semibold text-foreground">{formatScore(scoreSpread.average)}</div>
                  <div className="text-[10px] text-muted-foreground">avg score</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* DATA SOURCES */}
        <section
          ref={(el) => setSectionRef('dataSources', el)}
          data-score-builder-section-id="dataSources"
          data-score-builder-section="dataSources"
          className="border-b border-border"
        >
          {renderSectionHeader('dataSources')}
          {expandedSections.dataSources && (
            <div className="space-y-2 px-4 pb-4">
              {SCORE_DATA_SOURCES.map((ds) => {
                const active = enabledSourceSet.has(ds.id)
                return (
                  <div key={ds.id}>
                    <button
                      aria-label={`${ds.label} ${ds.id === 'bcAssessment' ? 'Property' : ''} ${active ? 'ON' : 'OFF'}`}
                      onClick={() => onToggleDataSource(ds.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors',
                        active
                          ? 'border-cyan-500/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100'
                          : 'border-input bg-background text-muted-foreground hover:text-foreground',
                      )}
                    >
                      <div>
                        <div className="font-medium">{ds.label}</div>
                        <div className="text-[10px] text-muted-foreground">{ds.description}</div>
                      </div>
                      <span className={cn('text-xs font-semibold', active ? 'text-cyan-600' : 'text-muted-foreground')}>
                        {active ? 'ON' : 'OFF'}
                      </span>
                    </button>

                    {/* Network sub-filters for Air Quality */}
                    {ds.id === 'airQuality' && active && (
                      <div className="ml-2 mt-1 space-y-1 border-l-2 border-cyan-200 pl-2 dark:border-cyan-900">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">{selectedNetworks.length} networks</span>
                          <div className="flex gap-2">
                            <button
                              onClick={onSelectAllNetworks}
                              className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
                            >
                              All
                            </button>
                            <button onClick={onClearNetworks} className="text-muted-foreground hover:text-foreground">
                              None
                            </button>
                          </div>
                        </div>
                        <div className="max-h-28 space-y-0.5 overflow-y-auto">
                          {networkCounts.map(([network, count]) => (
                            <button
                              key={network}
                              onClick={() => onToggleNetwork(network)}
                              className={cn(
                                'flex w-full items-center justify-between rounded px-2 py-1 text-[11px] transition-colors',
                                selectedNetworkSet.has(network)
                                  ? 'bg-cyan-50 text-cyan-900 dark:bg-cyan-950/30 dark:text-cyan-100'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              <span className="truncate">{network}</span>
                              <span>{count.toLocaleString()}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
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
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
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
                  <div className="text-[10px] text-muted-foreground">
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
                {Object.entries(SCORE_METRICS_BY_CATEGORY).map(([category, metrics]) => (
                  <div key={category}>
                    {(showAllEquationMetrics || metrics.some((metric) => weights[metric.key] !== 0)) && (
                      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                        {METRIC_CATEGORY_LABELS[category as keyof typeof METRIC_CATEGORY_LABELS] || category}
                      </div>
                    )}
                    <div className="space-y-2">
                      {metrics
                        .filter((metric) => showAllEquationMetrics || weights[metric.key] !== 0)
                        .map((metric) => (
                          <div
                            key={metric.key}
                            className={cn(
                              'rounded-lg border p-3',
                              weights[metric.key] !== 0
                                ? 'border-cyan-300/60 bg-cyan-50/50 dark:border-cyan-900/60 dark:bg-cyan-950/20'
                                : 'border-border bg-muted/25',
                            )}
                          >
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div>
                                <div className="text-xs font-semibold text-foreground">{metric.label}</div>
                                <div className="text-[10px] text-muted-foreground">{metric.description}</div>
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
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Equation</div>
                <div className="font-mono text-[11px] text-foreground">{equationPreview}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">
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
            <div className="space-y-3 px-4 pb-4">
              <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                <div className="mb-1 text-sm font-semibold text-foreground">COINr-lite method</div>
                <p>
                  Metrics are normalized across the current region set, directionalized by signed weights, then
                  aggregated into a 0-100 composite score.
                </p>
                <p className="mt-2">
                  Scores are relative to the currently loaded boundary level; filters do not redefine percentiles. Use
                  for planning triage, not validated exposure, health, or funding eligibility determination.
                </p>
                <p className="mt-2">
                  Current settings: {formatNormalizationMethod(methodSettings.normalization)},{' '}
                  {formatAggregationMethod(methodSettings.aggregation)}, missing data {methodSettings.missingData}.
                </p>
              </div>

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
                  {SCORE_METRICS.filter((metric) => weights[metric.key] !== 0).map((metric) => (
                    <div key={metric.key} className="rounded border border-border bg-muted/15 p-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-semibold text-foreground">{metric.label}</div>
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {metric.uncertainty}
                        </span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {metric.directionLabel} · weight {weights[metric.key]} · {metric.dataSourceLabel} ·{' '}
                        {metric.spatialMethod}
                      </div>
                      <div className="mt-1 text-[10px] text-muted-foreground">
                        {metric.freshnessLabel} · {metric.comparisonBasis}
                      </div>
                      {metric.caveat && (
                        <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">{metric.caveat}</div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
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
            <div className="space-y-3 px-4 pb-4">
              <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                <div className="mb-1 text-sm font-semibold text-foreground">Methodology</div>
                <p>
                  Metrics are normalized with the selected method across the current region set. Positive weights prefer
                  high values; negative weights prefer low values.
                </p>
                <p className="mt-2">
                  Scores are relative to the currently loaded boundary level; filters do not redefine percentiles. Use
                  for planning triage, not validated exposure, health, or funding eligibility determination.
                </p>
                <p className="mt-2 font-mono text-[11px] text-foreground">
                  score = 100 * aggregate(weight share * directional value)
                </p>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded bg-muted/40 p-2">
                    <div className="font-semibold text-foreground">{totalAbsoluteWeight.toLocaleString()}</div>
                    <div className="text-[10px]">influence</div>
                  </div>
                  <div className="rounded bg-muted/40 p-2">
                    <div className="font-semibold text-foreground">{activeMetricCount}</div>
                    <div className="text-[10px]">metrics</div>
                  </div>
                  <div className="rounded bg-muted/40 p-2">
                    <div className="font-semibold text-foreground">
                      {regions.length}/{totalRegionCount}
                    </div>
                    <div className="text-[10px]">eligible</div>
                  </div>
                </div>
              </div>

              {activePresetMethodology && (
                <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                  <div className="mb-2 text-sm font-semibold text-foreground">Preset methodology notes</div>
                  <div>
                    <span className="font-semibold text-foreground">Purpose:</span> {activePresetMethodology.purpose}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold text-foreground">Components:</span>{' '}
                    {activePresetMethodology.components.join(', ') || 'Custom metric set'}
                  </div>
                  <div className="mt-1">
                    <span className="font-semibold text-foreground">Normalization:</span>{' '}
                    {activePresetMethodology.normalization}
                  </div>
                  {activePresetMethodology.proxy && (
                    <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
                      Proxy recipe. Use for screening, not as a validated exposure or health index.
                    </div>
                  )}
                  <div className="mt-2">
                    <div className="font-semibold text-foreground">Known limits</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {activePresetMethodology.knownLimits.map((limit) => (
                        <li key={limit}>{limit}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-2">
                    <div className="font-semibold text-foreground">Data still needed</div>
                    <ul className="mt-1 list-disc space-y-1 pl-4">
                      {activePresetMethodology.dataNeeded.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}

              <div className="rounded-lg border border-border bg-background p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">Equity audit</div>
                <div className="space-y-2 text-xs text-muted-foreground">
                  <div>
                    Deprivation-weighted average:{' '}
                    <span className="font-semibold text-foreground">
                      {equityAuditSummary.deprivationWeightedAverage == null
                        ? 'No CIMD data loaded'
                        : formatScore(equityAuditSummary.deprivationWeightedAverage)}
                    </span>
                  </div>
                  <div className="space-y-1">
                    {equityAuditSummary.topBurdenOverlap.map((region) => (
                      <div
                        key={region.region.id}
                        className="flex items-center justify-between rounded bg-muted/25 px-2 py-1"
                      >
                        <span className="truncate">
                          #{region.rank} {region.region.name}
                        </span>
                        <span className="font-semibold text-foreground">
                          {(region.equityAudit.burdenOverlap * 100).toFixed(0)} overlap
                        </span>
                      </div>
                    ))}
                  </div>
                  {equityAuditSummary.hasCutoffWarnings && (
                    <div className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/25 dark:text-amber-200">
                      Some regions sit near score-band cutoffs; treat hard thresholds as sensitive.
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">Method controls</div>
                <div className="space-y-2 text-xs">
                  <label className="space-y-1">
                    <span className="block font-medium text-muted-foreground">Normalization</span>
                    <AppSelect
                      value={methodSettings.normalization}
                      onValueChange={(value) =>
                        updateMethodSettings(
                          'normalization',
                          value as ScoreMethodSettings['normalization'],
                        )
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
                      ]}
                      triggerClassName="h-8 rounded text-xs focus:ring-1 focus:ring-cyan-500"
                    />
                  </label>
                  {methodSettings.aggregation === 'healthyPlanPairwisePriority' && (
                    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50/70 p-2 dark:border-amber-900/70 dark:bg-amber-950/25">
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
                          options={healthyPlanDemographicMetrics.map((metric) => ({
                            value: metric.key,
                            label: metric.label,
                          }))}
                          triggerClassName="h-8 rounded border-amber-300 text-xs focus:ring-1 focus:ring-amber-500 dark:border-amber-900"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="block font-medium text-amber-950 dark:text-amber-100">
                          Built environment proxy
                        </span>
                        <AppSelect
                          value={methodSettings.healthyPlanPriority.environmentMetric ?? ''}
                          onValueChange={(value) =>
                            updateMethodSettings('healthyPlanPriority', {
                              ...methodSettings.healthyPlanPriority,
                              environmentMetric: value as ScoreMetricKey,
                            })
                          }
                          options={healthyPlanEnvironmentMetrics.map((metric) => ({
                            value: metric.key,
                            label: metric.label,
                          }))}
                          triggerClassName="h-8 rounded border-amber-300 text-xs focus:ring-1 focus:ring-amber-500 dark:border-amber-900"
                        />
                      </label>
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
                      'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left transition-colors',
                      methodSettings.sensitivity
                        ? 'border-cyan-500/60 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/35 dark:text-cyan-100'
                        : 'border-input text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <span>
                      <span className="block font-semibold">Sensitivity test</span>
                      <span className="block text-[10px] text-muted-foreground">
                        Perturb weights by 15% across 24 trials.
                      </span>
                    </span>
                    <span className="font-bold">{methodSettings.sensitivity ? 'ON' : 'OFF'}</span>
                  </button>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">Hard filters</div>
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
                          'flex w-full items-start justify-between gap-2 rounded-md border px-3 py-2 text-left text-xs transition-colors',
                          active
                            ? 'border-cyan-500/60 bg-cyan-50 text-cyan-950 dark:bg-cyan-950/35 dark:text-cyan-100'
                            : 'border-input text-muted-foreground hover:text-foreground',
                        )}
                      >
                        <span>
                          <span className="block font-semibold">{filter.label}</span>
                          <span className="block text-[10px] text-muted-foreground">{filter.description}</span>
                        </span>
                        <span className={cn('font-bold', active ? 'text-cyan-600' : 'text-muted-foreground')}>
                          {active ? 'ON' : 'OFF'}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {excludedRegionCount} region{excludedRegionCount === 1 ? '' : 's'} excluded before ranking.
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background p-3">
                <div className="mb-2 text-sm font-semibold text-foreground">Score bands</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {scoreBands.map((band) => (
                    <div key={band.key} className="rounded border border-border bg-muted/25 p-2">
                      <div className="font-semibold text-foreground">{band.label}</div>
                      <div className="text-lg font-bold text-cyan-700 dark:text-cyan-300">{band.count}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {band.min}-{band.max}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {scenarioComparison && (
                <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                  <div className="mb-1 text-sm font-semibold">Scenario compare</div>
                  <div>
                    Current: {scenarioComparison.currentTopName || 'None'} (
                    {formatScore(scenarioComparison.currentTopScore)})
                  </div>
                  <div>
                    {scenarioComparison.label}: {scenarioComparison.referenceTopName || 'None'} (
                    {formatScore(scenarioComparison.referenceTopScore)})
                  </div>
                  <div className="mt-1">
                    Avg delta {scenarioComparison.averageDelta >= 0 ? '+' : ''}
                    {formatScore(scenarioComparison.averageDelta)}
                  </div>
                  <div className="mt-1">
                    Sensitivity {(scenarioComparison.stableTopShare * 100).toFixed(0)}% stable · avg rank shift{' '}
                    {scenarioComparison.averageRankShift.toFixed(1)}
                  </div>
                </div>
              )}
            </div>
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
            <div className="space-y-3 px-4 pb-4">
              <div className="rounded-lg border border-border bg-background p-3 text-xs text-muted-foreground">
                <div className="mb-1 text-sm font-semibold text-foreground">Rank confidence</div>
                <p>
                  Checks 15% weight perturbations, leave-one-indicator-out runs, and alternate normalization methods.
                </p>
              </div>
              {scenarioComparison && (
                <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                  Top area held in {(scenarioComparison.stableTopShare * 100).toFixed(0)}% of perturbation trials;
                  average rank shift was {scenarioComparison.averageRankShift.toFixed(1)}.
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
                          median {result.medianRank.toFixed(1)} · rank #{result.rankInterval[0]}-#
                          {result.rankInterval[1]}
                        </div>
                      </div>
                      <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                        {result.stability}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Score {formatScore(result.scoreInterval[0])}-{formatScore(result.scoreInterval[1])}
                    </div>
                  </div>
                ))}
                {robustnessResults.length === 0 && (
                  <div className="rounded border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                    Turn on sensitivity testing in the Model section to generate results.
                  </div>
                )}
              </div>
            </div>
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
            <div className="space-y-2 px-4 pb-4">
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
                      Use this metric as a one-layer score for the map, rankings, exports, and share URL.
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
            <div className="space-y-3 px-4">
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
                    <div className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">
                      {selectedRegion.region.name}
                    </div>
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

              {/* Search + export */}
              <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => onSearchQueryChange(event.target.value)}
                    placeholder="Search boundary by code or name..."
                    className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  />
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
                <div className="flex items-center justify-between">
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

              {/* Errors */}
              {dataErrors.length > 0 && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                  <p className="font-medium">Data loading issues</p>
                  {dataErrors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
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
          )}
        </section>
      </div>
    </div>
  )
}
