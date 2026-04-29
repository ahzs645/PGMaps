import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import {
  BOUNDARY_SOURCE_OPTIONS,
  DENSITY_METRIC_OPTIONS,
  SCORE_METRICS,
  SCORE_METRICS_BY_CATEGORY,
  SCORE_PRESETS,
  SCORE_EXAMPLES
} from '../constants'
import type {
  ScoredBoundaryRegion,
  ScoreDataSource,
  ScoreMetricKey,
  ScoreMetricWeightMap
} from '../types'
import { SCORE_DATA_SOURCES, METRIC_CATEGORY_LABELS } from '../types'
import { RadarChart } from './RadarChart'

type ScoreBuilderSectionId = 'examples' | 'setup' | 'dataSources' | 'equation' | 'density' | 'regions'

type ExpandedSectionsState = Record<ScoreBuilderSectionId, boolean>

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
const SECTION_ORDER: ScoreBuilderSectionId[] = ['examples', 'setup', 'dataSources', 'equation', 'density', 'regions']
const SECTION_LABELS: Record<ScoreBuilderSectionId, string> = {
  examples: 'Examples',
  setup: 'Setup',
  dataSources: 'Data Sources',
  equation: 'Equation',
  density: 'Density',
  regions: 'Regions'
}

function createExpandedSections(isDesktop: boolean): ExpandedSectionsState {
  if (isDesktop) {
    return { examples: true, setup: false, dataSources: false, equation: false, density: false, regions: true }
  }
  return { examples: true, setup: false, dataSources: false, equation: false, density: false, regions: true }
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
  limit = 2
): Array<{ key: ScoreMetricKey; label: string; scoreDelta: number }> {
  return SCORE_METRICS
    .filter((metric) => weights[metric.key] !== 0)
    .map((metric) => ({
      key: metric.key,
      label: metric.shortLabel,
      scoreDelta: region.contributions[metric.key] * 100
    }))
    .filter((driver) => Math.abs(driver.scoreDelta) >= 0.005)
    .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
    .slice(0, limit)
}

function formatDriverDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}`
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
  networkCounts,
  selectedNetworks,
  onToggleNetwork,
  onSelectAllNetworks,
  onClearNetworks,
  showPoints,
  onTogglePoints,
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
  isDesktop
}: ScoreBuilderSidebarProps) {
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])
  const enabledSourceSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const comparisonSet = useMemo(() => new Set(comparisonIds), [comparisonIds])

  const visibleRows = useMemo(() => filteredRegions.slice(0, MAX_VISIBLE_ROWS), [filteredRegions])
  const activeExample = useMemo(
    () => SCORE_EXAMPLES.find((example) => example.key === activeExampleKey) || null,
    [activeExampleKey]
  )
  const activePreset = useMemo(
    () => SCORE_PRESETS.find((preset) => preset.key === activePresetKey) || null,
    [activePresetKey]
  )
  const selectedRegionDrivers = useMemo(
    () => selectedRegion ? getTopDrivers(selectedRegion, weights, 2) : [],
    [selectedRegion, weights]
  )

  const totalAbsoluteWeight = useMemo(() => {
    return SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
  }, [weights])

  const [expandedSections, setExpandedSections] = useState<ExpandedSectionsState>(() => createExpandedSections(isDesktop))
  const [activeSection, setActiveSection] = useState<ScoreBuilderSectionId>('setup')

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Record<ScoreBuilderSectionId, HTMLElement | null>>({
    examples: null, setup: null, dataSources: null, equation: null, density: null, regions: null
  })
  const sectionRatios = useRef<Record<ScoreBuilderSectionId, number>>({
    examples: 0, setup: 0, dataSources: 0, equation: 0, density: 0, regions: 0
  })

  useEffect(() => { setExpandedSections(createExpandedSections(isDesktop)) }, [isDesktop])

  const evaluateActiveSection = useCallback(() => {
    let candidate: ScoreBuilderSectionId = SECTION_ORDER[0]
    let highestRatio = -1
    SECTION_ORDER.forEach((id) => {
      const ratio = sectionRatios.current[id]
      if (ratio > highestRatio) { highestRatio = ratio; candidate = id }
    })
    if (highestRatio > 0) { setActiveSection(candidate); return }
    const root = scrollContainerRef.current
    if (!root) return
    const referenceTop = root.scrollTop + 120
    let fallback: ScoreBuilderSectionId = SECTION_ORDER[0]
    SECTION_ORDER.forEach((id) => {
      const section = sectionRefs.current[id]
      if (!section) return
      if (section.offsetTop <= referenceTop) fallback = id
    })
    setActiveSection(fallback)
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
      { root, threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] }
    )
    SECTION_ORDER.forEach((id) => {
      const section = sectionRefs.current[id]
      if (section) observer.observe(section)
    })
    const handleScroll = () => evaluateActiveSection()
    root.addEventListener('scroll', handleScroll, { passive: true })
    evaluateActiveSection()
    return () => { observer.disconnect(); root.removeEventListener('scroll', handleScroll) }
  }, [evaluateActiveSection])

  const setSectionRef = useCallback((sectionId: ScoreBuilderSectionId, element: HTMLElement | null) => {
    sectionRefs.current[sectionId] = element
  }, [])

  const toggleSection = useCallback((sectionId: ScoreBuilderSectionId) => {
    setExpandedSections((current) => ({ ...current, [sectionId]: !current[sectionId] }))
  }, [])

  const scrollToSection = useCallback((sectionId: ScoreBuilderSectionId) => {
    const root = scrollContainerRef.current
    const section = sectionRefs.current[sectionId]
    if (!root || !section) return
    const rootTop = root.getBoundingClientRect().top
    const sectionTop = section.getBoundingClientRect().top
    const targetTop = sectionTop - rootTop + root.scrollTop - 62
    root.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
    setActiveSection(sectionId)
  }, [])

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
        {sectionOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
    )
  }

  return (
    <div className={cn('z-10 flex h-full min-h-0 w-[360px] flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur', className)}>
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">Score Builder</h1>
        <p className="text-sm text-muted-foreground">
          {activeExample
            ? `${activeExample.label}: ${activeExample.question}`
            : activePreset
              ? `${activePreset.label}: ${activePreset.description}`
              : 'Choose a PG scenario or build a custom scoring equation.'}
        </p>
      </div>

      <div ref={scrollContainerRef} className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        {/* Section nav ribbon */}
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
          <div className="flex flex-wrap gap-1.5">
            {SECTION_ORDER.map((sectionId) => (
              <button
                key={sectionId}
                type="button"
                onClick={() => scrollToSection(sectionId)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                  activeSection === sectionId
                    ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100'
                    : 'border-input text-muted-foreground hover:text-foreground'
                )}
              >
                {SECTION_LABELS[sectionId]}
              </button>
            ))}
          </div>
        </div>

        {/* EXAMPLES */}
        <section ref={(el) => setSectionRef('examples', el)} data-score-builder-section-id="examples" className="border-b border-border">
          {renderSectionHeader('examples')}
          {expandedSections.examples && (
            <div className="space-y-3 px-4 pb-4">
              <p className="text-xs text-muted-foreground">
                {activeExample
                  ? `Active scenario configures ${activeExample.boundaryLevel.toUpperCase()} boundaries, ${activeExample.dataSources.map(getDataSourceLabel).join(', ')}, and the matching weights.`
                  : 'Pick a PG scenario to configure boundaries, data sources, and scoring weights.'}
              </p>

              {/* Group examples by boundary source */}
              {[
                { source: 'census' as const, title: 'Census Boundaries (Prince George)' },
                { source: 'bcHealth' as const, title: 'Health Authority Boundaries (BC-wide)' }
              ].map(({ source, title }) => {
                const group = SCORE_EXAMPLES.filter((e) => e.boundarySource === source)
                if (!group.length) return null
                return (
                  <div key={source}>
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</div>
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
                                : 'border-border bg-background hover:border-cyan-300 hover:bg-accent dark:hover:border-cyan-800'
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
                                <span key={ds} className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
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
        <section ref={(el) => setSectionRef('setup', el)} data-score-builder-section-id="setup" className="border-b border-border">
          {renderSectionHeader('setup')}
          {expandedSections.setup && (
            <div className="space-y-3 px-4 pb-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground">Boundary source</label>
                <div className="space-y-1.5">
                  {BOUNDARY_SOURCE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => onBoundarySourceChange(option.value)}
                      className={cn(
                        'w-full rounded-md border px-3 py-2 text-left transition-colors',
                        boundarySource === option.value
                          ? 'border-cyan-500/70 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-100'
                          : 'border-input bg-background text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <div className="text-xs font-medium">{option.label}</div>
                      <div className="text-[10px] text-muted-foreground">{option.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="score-builder-level">Boundary level</label>
                <button
                  onClick={onTogglePoints}
                  className={cn(
                    'rounded border px-2 py-1 text-xs transition-colors',
                    showPoints ? 'border-sky-500 text-sky-600 dark:text-sky-400' : 'border-input text-muted-foreground hover:text-foreground'
                  )}
                >
                  {showPoints ? 'Hide points' : 'Show points'}
                </button>
              </div>

              <select
                id="score-builder-level"
                value={selectedRegionLevel}
                onChange={(event) => onRegionLevelChange(event.target.value as RegionLevel)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                {boundaryLevelOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>

              <div className="grid grid-cols-3 gap-2 text-center">
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
        <section ref={(el) => setSectionRef('dataSources', el)} data-score-builder-section-id="dataSources" className="border-b border-border">
          {renderSectionHeader('dataSources')}
          {expandedSections.dataSources && (
            <div className="space-y-2 px-4 pb-4">
              {SCORE_DATA_SOURCES.map((ds) => {
                const active = enabledSourceSet.has(ds.id)
                return (
                  <div key={ds.id}>
                    <button
                      onClick={() => onToggleDataSource(ds.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors',
                        active
                          ? 'border-cyan-500/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100'
                          : 'border-input bg-background text-muted-foreground hover:text-foreground'
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
                            <button onClick={onSelectAllNetworks} className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400">All</button>
                            <button onClick={onClearNetworks} className="text-muted-foreground hover:text-foreground">None</button>
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
                                  : 'text-muted-foreground hover:text-foreground'
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
        <section ref={(el) => setSectionRef('equation', el)} data-score-builder-section-id="equation" className="border-b border-border">
          {renderSectionHeader('equation')}
          {expandedSections.equation && (
            <div className="space-y-3 px-4 pb-4">
              <div className="flex flex-wrap gap-2">
                {SCORE_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    onClick={() => onApplyPreset(preset.key)}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs transition-colors',
                      activePresetKey === preset.key
                        ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100'
                        : 'border-input text-muted-foreground hover:text-foreground'
                    )}
                    title={preset.description}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className="rounded-md border border-border bg-muted/15 p-2 text-xs text-muted-foreground">
                {activePreset
                  ? `${activePreset.label} intent: ${activePreset.description}`
                  : activeExample
                    ? `Scenario intent: ${activeExample.description}`
                    : 'Preset buttons shift the score toward common planning questions; custom weights refine the equation.'}
              </div>

              {!isDesktop && (
                <div className="rounded-md border border-cyan-200/70 bg-cyan-50 p-2 text-xs text-cyan-800 dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-200">
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
                </div>
              )}

              <div className="rounded-md border border-border bg-background p-2">
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Equation</div>
                <div className="font-mono text-[11px] text-foreground">{equationPreview}</div>
                <div className="mt-1 text-[10px] text-muted-foreground">|weights| sum: {totalAbsoluteWeight.toLocaleString()}</div>
              </div>
            </div>
          )}
        </section>

        {/* DENSITY */}
        <section ref={(el) => setSectionRef('density', el)} data-score-builder-section-id="density" className="border-b border-border">
          {renderSectionHeader('density')}
          {expandedSections.density && (
            <div className="space-y-2 px-4 pb-4">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="score-builder-density" className="text-xs font-medium text-muted-foreground">Density metric</label>
                <select
                  id="score-builder-density"
                  value={densityMetric}
                  onChange={(event) => onDensityMetricChange(event.target.value as ScoreMetricKey)}
                  className="rounded border border-input bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-500"
                >
                  {DENSITY_METRIC_OPTIONS.map((metric) => (
                    <option key={metric} value={metric}>{getMetricLabel(metric)}</option>
                  ))}
                </select>
              </div>

              {densitySummary ? (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {(['median', 'average', 'min', 'max'] as const).map((stat) => (
                      <div key={stat} className="rounded border border-border bg-muted/30 p-2">
                        <div className="text-[10px] capitalize text-muted-foreground">{stat}</div>
                        <div className="font-semibold text-foreground">{formatMetricValue(densityMetric, densitySummary[stat], true)}</div>
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
                          selectedRegion?.region.id === entry.region.id && 'bg-cyan-50 dark:bg-cyan-950/40'
                        )}
                      >
                        <span className="truncate text-left text-foreground">{entry.region.name}</span>
                        <span className="font-medium text-cyan-700 dark:text-cyan-300">{formatMetricValue(densityMetric, entry.metrics[densityMetric], true)}</span>
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
        <section ref={(el) => setSectionRef('regions', el)} data-score-builder-section-id="regions" className="pb-4">
          {renderSectionHeader('regions')}
          {expandedSections.regions && (
            <div className="space-y-3 px-4">
              {/* Comparison panel */}
              {comparisonRegions.length > 0 && (
                <div className="rounded-lg border border-amber-300/50 bg-amber-50 p-3 dark:border-amber-900/60 dark:bg-amber-950/20">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-900 dark:text-amber-100">Compare ({comparisonRegions.length}/3)</span>
                    <button onClick={onClearComparison} className="text-[11px] text-amber-700 hover:text-amber-900 dark:text-amber-300">Clear</button>
                  </div>
                  <div className="space-y-1">
                    {comparisonRegions.map((r) => (
                      <div key={r.region.id} className="flex items-center justify-between text-[11px]">
                        <span className="truncate text-amber-900 dark:text-amber-100">#{r.rank} {r.region.name}</span>
                        <span className="font-semibold text-amber-700 dark:text-amber-300">{formatScore(r.score)}</span>
                      </div>
                    ))}
                  </div>
                  {comparisonRegions.length >= 2 && (
                    <>
                      <RadarChart
                        regions={comparisonRegions}
                        weights={weights}
                        className="mt-2"
                      />
                      <div className="mt-2 overflow-x-auto">
                        <table className="w-full text-[10px]">
                          <thead>
                            <tr className="text-amber-700 dark:text-amber-300">
                              <th className="pr-2 text-left font-medium">Metric</th>
                              {comparisonRegions.map((r) => (
                                <th key={r.region.id} className="px-1 text-right font-medium">{r.region.name.slice(0, 12)}</th>
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
                    <div className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">{selectedRegion.region.name}</div>
                    <div className="text-xs text-cyan-700 dark:text-cyan-300">Rank #{selectedRegion.rank} | Score {formatScore(selectedRegion.score)}</div>
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
                          : 'border-cyan-300/70 text-cyan-800 hover:bg-cyan-100/70 dark:border-cyan-900 dark:text-cyan-300'
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
                  <span>{filteredRegions.length} of {regions.length} regions</span>
                  {filteredRegions.length > MAX_VISIBLE_ROWS && <span>Showing {MAX_VISIBLE_ROWS}</span>}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span>Score range {formatScore(scoreSpread.min)} - {formatScore(scoreSpread.max)}</span>
                  <span>Avg {formatScore(scoreSpread.average)}</span>
                </div>
              </div>

              {/* Errors */}
              {dataErrors.length > 0 && (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                  <p className="font-medium">Data loading issues</p>
                  {dataErrors.map((err, i) => <p key={i}>{err}</p>)}
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
                          pinned && !selected && 'border-amber-300/60 dark:border-amber-900/60'
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button onClick={() => onRegionSelect(entry.region.id)} className="min-w-0 flex-1 text-left">
                            <div className="line-clamp-1 text-sm font-medium text-foreground">#{entry.rank} {entry.region.name}</div>
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
                            <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">{formatScore(entry.score)}</span>
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
