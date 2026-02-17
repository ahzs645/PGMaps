import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import {
  BOUNDARY_SOURCE_OPTIONS,
  DENSITY_METRIC_OPTIONS,
  SCORE_METRICS,
  SCORE_PRESETS
} from '../constants'
import type {
  ScoredBoundaryRegion,
  ScoreMetricKey,
  ScoreMetricWeightMap
} from '../types'

type ScoreBuilderSectionId = 'setup' | 'filters' | 'equation' | 'density' | 'regions'

type ExpandedSectionsState = Record<ScoreBuilderSectionId, boolean>

interface ScoreBuilderSidebarProps {
  className?: string
  loadingMonitors: boolean
  loadingRegions: boolean
  monitorsError: string | null
  regionsError: string | null
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
  weights: ScoreMetricWeightMap
  onWeightChange: (metric: ScoreMetricKey, value: number) => void
  onApplyPreset: (presetKey: string) => void
  activePresetKey: string | null
  equationPreview: string
  scoreSpread: {
    min: number
    max: number
    average: number
  }
  densityMetric: ScoreMetricKey
  onDensityMetricChange: (metric: ScoreMetricKey) => void
  densitySummary: {
    min: number
    max: number
    median: number
    average: number
  } | null
  densityLeaders: ScoredBoundaryRegion[]
  regions: ScoredBoundaryRegion[]
  filteredRegions: ScoredBoundaryRegion[]
  selectedRegion: ScoredBoundaryRegion | null
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  onRegionSelect: (regionId: string) => void
  onClearRegionSelection: () => void
  onOpenRegionInsight: (regionId: string) => void
  isDesktop: boolean
}

const MAX_VISIBLE_ROWS = 220
const SECTION_ORDER: ScoreBuilderSectionId[] = ['setup', 'filters', 'equation', 'density', 'regions']
const SECTION_LABELS: Record<ScoreBuilderSectionId, string> = {
  setup: 'Setup',
  filters: 'Point Filters',
  equation: 'Equation',
  density: 'Density',
  regions: 'Regions'
}

function createExpandedSections(isDesktop: boolean): ExpandedSectionsState {
  if (isDesktop) {
    return {
      setup: true,
      filters: true,
      equation: true,
      density: false,
      regions: true
    }
  }

  return {
    setup: true,
    filters: false,
    equation: false,
    density: false,
    regions: true
  }
}

function getMetricLabel(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.label || key
}

function getMetricDescription(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.description || ''
}

function getMetricFormat(key: ScoreMetricKey): 'density' | 'count' | 'ratio' {
  return SCORE_METRICS.find((metric) => metric.key === key)?.format || 'count'
}

function formatMetricValue(metric: ScoreMetricKey, value: number, compact = false): string {
  const format = getMetricFormat(metric)

  if (format === 'density') {
    const scaled = value * 1_000
    return compact
      ? scaled.toFixed(2)
      : `${scaled.toLocaleString(undefined, { maximumFractionDigits: 2 })} / 1,000 km²`
  }

  if (format === 'ratio') {
    return `${(value * 100).toFixed(1)}%`
  }

  if (Number.isInteger(value)) {
    return value.toLocaleString()
  }

  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function formatScore(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}

function clampWeight(value: number): number {
  return Math.max(-100, Math.min(100, Math.round(value)))
}

export function ScoreBuilderSidebar({
  className,
  loadingMonitors,
  loadingRegions,
  monitorsError,
  regionsError,
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
  isDesktop
}: ScoreBuilderSidebarProps) {
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])

  const visibleRows = useMemo(() => {
    return filteredRegions.slice(0, MAX_VISIBLE_ROWS)
  }, [filteredRegions])

  const totalAbsoluteWeight = useMemo(() => {
    return SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
  }, [weights])

  const [expandedSections, setExpandedSections] = useState<ExpandedSectionsState>(() => createExpandedSections(isDesktop))
  const [activeSection, setActiveSection] = useState<ScoreBuilderSectionId>('setup')

  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const sectionRefs = useRef<Record<ScoreBuilderSectionId, HTMLElement | null>>({
    setup: null,
    filters: null,
    equation: null,
    density: null,
    regions: null
  })
  const sectionRatios = useRef<Record<ScoreBuilderSectionId, number>>({
    setup: 0,
    filters: 0,
    equation: 0,
    density: 0,
    regions: 0
  })

  useEffect(() => {
    setExpandedSections(createExpandedSections(isDesktop))
  }, [isDesktop])

  const evaluateActiveSection = useCallback(() => {
    let candidate: ScoreBuilderSectionId = SECTION_ORDER[0]
    let highestRatio = -1

    SECTION_ORDER.forEach((id) => {
      const ratio = sectionRatios.current[id]
      if (ratio > highestRatio) {
        highestRatio = ratio
        candidate = id
      }
    })

    if (highestRatio > 0) {
      setActiveSection(candidate)
      return
    }

    const root = scrollContainerRef.current
    if (!root) return

    const referenceTop = root.scrollTop + 120
    let fallback: ScoreBuilderSectionId = SECTION_ORDER[0]

    SECTION_ORDER.forEach((id) => {
      const section = sectionRefs.current[id]
      if (!section) return
      if (section.offsetTop <= referenceTop) {
        fallback = id
      }
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
      {
        root,
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1]
      }
    )

    SECTION_ORDER.forEach((id) => {
      const section = sectionRefs.current[id]
      if (!section) return
      observer.observe(section)
    })

    const handleScroll = () => {
      evaluateActiveSection()
    }

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
    setExpandedSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId]
    }))
  }, [])

  const scrollToSection = useCallback((sectionId: ScoreBuilderSectionId) => {
    const root = scrollContainerRef.current
    const section = sectionRefs.current[sectionId]
    if (!root || !section) return

    const rootTop = root.getBoundingClientRect().top
    const sectionTop = section.getBoundingClientRect().top
    const targetTop = sectionTop - rootTop + root.scrollTop - 62

    root.scrollTo({
      top: Math.max(0, targetTop),
      behavior: 'smooth'
    })

    setActiveSection(sectionId)
  }, [])

  const renderSectionHeader = (sectionId: ScoreBuilderSectionId) => {
    const sectionOpen = expandedSections[sectionId]

    return (
      <button
        type="button"
        onClick={() => toggleSection(sectionId)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        data-score-builder-toggle={sectionId}
        aria-expanded={sectionOpen}
        aria-controls={`score-builder-panel-${sectionId}`}
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
        <p className="text-sm text-muted-foreground">Blend point and boundary data with adjustable equations.</p>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-y-auto"
        data-score-builder-scroll="true"
      >
        <div className="sticky top-0 z-20 border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
          <div className="flex flex-wrap gap-1.5">
            {SECTION_ORDER.map((sectionId) => {
              const isActive = activeSection === sectionId
              return (
                <button
                  key={sectionId}
                  type="button"
                  onClick={() => scrollToSection(sectionId)}
                  data-score-builder-tab={sectionId}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    isActive
                      ? 'border-cyan-500 bg-cyan-50 text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-100'
                      : 'border-input text-muted-foreground hover:text-foreground'
                  )}
                >
                  {SECTION_LABELS[sectionId]}
                </button>
              )
            })}
          </div>
        </div>

        <section
          ref={(element) => setSectionRef('setup', element)}
          id="score-builder-section-setup"
          data-score-builder-section="setup"
          data-score-builder-section-id="setup"
          className="border-b border-border"
        >
          {renderSectionHeader('setup')}
          {expandedSections.setup && (
            <div id="score-builder-panel-setup" className="space-y-3 px-4 pb-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-muted-foreground">Boundary source</label>
                <div className="space-y-1.5">
                  {BOUNDARY_SOURCE_OPTIONS.map((option) => {
                    const active = boundarySource === option.value

                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onBoundarySourceChange(option.value)}
                        data-score-builder-boundary-source={option.value}
                        className={cn(
                          'w-full rounded-md border px-3 py-2 text-left transition-colors',
                          active
                            ? 'border-cyan-500/70 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-100'
                            : 'border-input bg-background text-muted-foreground hover:text-foreground'
                        )}
                      >
                        <div className="text-xs font-medium">{option.label}</div>
                        <div className="text-[10px] text-muted-foreground">{option.description}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="score-builder-level">Boundary level</label>
                <button
                  onClick={onTogglePoints}
                  className={cn(
                    'rounded border px-2 py-1 text-xs transition-colors',
                    showPoints
                      ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                      : 'border-input text-muted-foreground hover:text-foreground'
                  )}
                >
                  {showPoints ? 'Hide points' : 'Show points'}
                </button>
              </div>

              <select
                id="score-builder-level"
                data-score-builder-level-select="true"
                value={selectedRegionLevel}
                onChange={(event) => onRegionLevelChange(event.target.value as RegionLevel)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
              >
                {boundaryLevelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-base font-semibold text-foreground">{regions.length}</div>
                  <div className="text-[10px] text-muted-foreground">regions</div>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-base font-semibold text-foreground">{selectedNetworks.length}</div>
                  <div className="text-[10px] text-muted-foreground">networks</div>
                </div>
                <div className="rounded-md bg-muted/40 p-2">
                  <div className="text-base font-semibold text-foreground">{formatScore(scoreSpread.average)}</div>
                  <div className="text-[10px] text-muted-foreground">avg score</div>
                </div>
              </div>
            </div>
          )}
        </section>

        <section
          ref={(element) => setSectionRef('filters', element)}
          id="score-builder-section-filters"
          data-score-builder-section="filters"
          data-score-builder-section-id="filters"
          className="border-b border-border"
        >
          {renderSectionHeader('filters')}
          {expandedSections.filters && (
            <div id="score-builder-panel-filters" className="space-y-2 px-4 pb-4">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">{selectedNetworks.length} active networks</div>
                <div className="flex items-center gap-2 text-xs">
                  <button
                    onClick={onSelectAllNetworks}
                    className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400 dark:hover:text-cyan-300"
                  >
                    All
                  </button>
                  <button
                    onClick={onClearNetworks}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    None
                  </button>
                </div>
              </div>

              <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                {networkCounts.map(([network, count]) => {
                  const selected = selectedNetworkSet.has(network)
                  return (
                    <button
                      key={network}
                      onClick={() => onToggleNetwork(network)}
                      data-score-builder-network={network}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md border px-2 py-1.5 text-xs transition-colors',
                        selected
                          ? 'border-cyan-500/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100'
                          : 'border-input bg-background text-muted-foreground hover:text-foreground'
                      )}
                    >
                      <span className="truncate text-left">{network}</span>
                      <span>{count.toLocaleString()}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        <section
          ref={(element) => setSectionRef('equation', element)}
          id="score-builder-section-equation"
          data-score-builder-section="equation"
          data-score-builder-section-id="equation"
          className="border-b border-border"
        >
          {renderSectionHeader('equation')}
          {expandedSections.equation && (
            <div id="score-builder-panel-equation" className="space-y-3 px-4 pb-4">
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

              {!isDesktop && (
                <div className="rounded-md border border-cyan-200/70 bg-cyan-50 p-2 text-xs text-cyan-800 dark:border-cyan-900/70 dark:bg-cyan-950/30 dark:text-cyan-200" data-score-builder-mobile-note="true">
                  Custom metric weight editing is available on desktop. Mobile supports preset scoring and region insight review.
                </div>
              )}

              {isDesktop && (
                <div className="space-y-3">
                  {SCORE_METRICS.map((metric) => (
                    <div key={metric.key} className="rounded-lg border border-border bg-muted/25 p-3" data-score-builder-equation-slider={metric.key}>
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
                          data-score-builder-equation-number={metric.key}
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
              )}

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

        <section
          ref={(element) => setSectionRef('density', element)}
          id="score-builder-section-density"
          data-score-builder-section="density"
          data-score-builder-section-id="density"
          className="border-b border-border"
        >
          {renderSectionHeader('density')}
          {expandedSections.density && (
            <div id="score-builder-panel-density" className="space-y-2 px-4 pb-4">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="score-builder-density" className="text-xs font-medium text-muted-foreground">Density metric</label>
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
                    <div className="rounded border border-border bg-muted/30 p-2">
                      <div className="text-[10px] text-muted-foreground">Median</div>
                      <div className="font-semibold text-foreground">{formatMetricValue(densityMetric, densitySummary.median, true)}</div>
                    </div>
                    <div className="rounded border border-border bg-muted/30 p-2">
                      <div className="text-[10px] text-muted-foreground">Average</div>
                      <div className="font-semibold text-foreground">{formatMetricValue(densityMetric, densitySummary.average, true)}</div>
                    </div>
                    <div className="rounded border border-border bg-muted/30 p-2">
                      <div className="text-[10px] text-muted-foreground">Min</div>
                      <div className="font-semibold text-foreground">{formatMetricValue(densityMetric, densitySummary.min, true)}</div>
                    </div>
                    <div className="rounded border border-border bg-muted/30 p-2">
                      <div className="text-[10px] text-muted-foreground">Max</div>
                      <div className="font-semibold text-foreground">{formatMetricValue(densityMetric, densitySummary.max, true)}</div>
                    </div>
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

        <section
          ref={(element) => setSectionRef('regions', element)}
          id="score-builder-section-regions"
          data-score-builder-section="regions"
          data-score-builder-section-id="regions"
          className="pb-4"
        >
          {renderSectionHeader('regions')}
          {expandedSections.regions && (
            <div id="score-builder-panel-regions" className="space-y-3 px-4">
              {selectedRegion && (
                <div className="rounded-lg border border-cyan-300/50 bg-cyan-50 p-3 dark:border-cyan-900/70 dark:bg-cyan-950/25">
                  <div className="mb-2">
                    <div className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">{selectedRegion.region.name}</div>
                    <div className="text-xs text-cyan-700 dark:text-cyan-300">Rank #{selectedRegion.rank} | Score {formatScore(selectedRegion.score)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[11px] text-cyan-800 dark:text-cyan-200">
                    <div>Area: {selectedRegion.region.areaKm2.toFixed(1)} km²</div>
                    <div>Sensors: {selectedRegion.counts.monitorCount.toLocaleString()}</div>
                    <div>Low-cost: {selectedRegion.counts.lowCostCount.toLocaleString()}</div>
                    <div>Reference: {selectedRegion.counts.referenceCount.toLocaleString()}</div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      onClick={() => onOpenRegionInsight(selectedRegion.region.id)}
                      className="rounded border border-cyan-400/70 bg-white/70 px-2 py-1 text-xs font-medium text-cyan-900 transition-colors hover:bg-white dark:border-cyan-800 dark:bg-cyan-950/20 dark:text-cyan-100"
                      data-score-builder-view-insight="selected"
                    >
                      View Insight
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

              <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-2 text-xs text-muted-foreground">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => onSearchQueryChange(event.target.value)}
                  placeholder="Search boundary by code or name..."
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
                />
                <div className="flex items-center justify-between">
                  <span data-score-builder-region-stats="true">{filteredRegions.length} of {regions.length} regions</span>
                  {filteredRegions.length > MAX_VISIBLE_ROWS && <span>Showing {MAX_VISIBLE_ROWS}</span>}
                </div>
                <div className="flex items-center justify-between text-[11px]">
                  <span>Score range {formatScore(scoreSpread.min)} - {formatScore(scoreSpread.max)}</span>
                  <span>Avg {formatScore(scoreSpread.average)}</span>
                </div>
              </div>

              {loadingMonitors || loadingRegions ? (
                <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
                  Building region scores...
                </div>
              ) : monitorsError || regionsError ? (
                <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
                  <p className="font-medium">Unable to build scores</p>
                  {monitorsError && <p>{monitorsError}</p>}
                  {regionsError && <p>{regionsError}</p>}
                </div>
              ) : (
                <div className="space-y-2" data-score-builder-region-list="true">
                  {visibleRows.map((entry) => {
                    const selected = selectedRegion?.region.id === entry.region.id
                    return (
                      <div
                        key={entry.region.id}
                        className={cn(
                          'rounded-lg border border-border bg-background p-2 transition-colors',
                          selected && 'border-cyan-300 bg-cyan-50 dark:border-cyan-900 dark:bg-cyan-950/35'
                        )}
                        data-score-builder-region-row={entry.region.id}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            onClick={() => onRegionSelect(entry.region.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="line-clamp-1 text-sm font-medium text-foreground">#{entry.rank} {entry.region.name}</div>
                            <div className="mt-0.5 text-xs text-muted-foreground">
                              Code {entry.region.code} | Density {formatMetricValue('overallDensity', entry.metrics.overallDensity)}
                            </div>
                          </button>

                          <div className="flex shrink-0 items-center gap-1">
                            <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">{formatScore(entry.score)}</span>
                            <button
                              onClick={() => onOpenRegionInsight(entry.region.id)}
                              className="rounded border border-input px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                              data-score-builder-region-insight={entry.region.id}
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
