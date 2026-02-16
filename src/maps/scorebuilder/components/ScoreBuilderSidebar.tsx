import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'
import type { BoundaryLevel } from '@/maps/airquality'
import {
  BOUNDARY_LEVEL_OPTIONS,
  DENSITY_METRIC_OPTIONS,
  SCORE_METRICS,
  SCORE_PRESETS
} from '../constants'
import type {
  ScoredBoundaryRegion,
  ScoreMetricKey,
  ScoreMetricWeightMap
} from '../types'

interface ScoreBuilderSidebarProps {
  className?: string
  loadingMonitors: boolean
  loadingRegions: boolean
  monitorsError: string | null
  regionsError: string | null
  boundaryLevel: BoundaryLevel
  onBoundaryLevelChange: (level: BoundaryLevel) => void
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
}

const MAX_VISIBLE_ROWS = 220

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
  boundaryLevel,
  onBoundaryLevelChange,
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
  onClearRegionSelection
}: ScoreBuilderSidebarProps) {
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])

  const visibleRows = useMemo(() => {
    return filteredRegions.slice(0, MAX_VISIBLE_ROWS)
  }, [filteredRegions])

  const selectedContributionRows = useMemo(() => {
    if (!selectedRegion) return []

    return SCORE_METRICS
      .filter((metric) => Math.abs(weights[metric.key]) > 0)
      .map((metric) => {
        const contributionRaw = selectedRegion.contributions[metric.key]
        const scoreDelta = contributionRaw * 50

        return {
          key: metric.key,
          label: metric.shortLabel,
          metricValue: selectedRegion.metrics[metric.key],
          normalizedValue: selectedRegion.normalizedMetrics[metric.key],
          weight: weights[metric.key],
          scoreDelta
        }
      })
      .sort((a, b) => Math.abs(b.scoreDelta) - Math.abs(a.scoreDelta))
  }, [selectedRegion, weights])

  const totalAbsoluteWeight = useMemo(() => {
    return SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
  }, [weights])

  return (
    <div className={cn('z-10 flex h-full w-[360px] flex-col border-r border-border bg-background/95 shadow-xl backdrop-blur', className)}>
      <div className="border-b border-border bg-background/95 p-4">
        <h1 className="text-xl font-bold text-foreground">Score Builder</h1>
        <p className="text-sm text-muted-foreground">Blend point and boundary data with adjustable equations.</p>
      </div>

      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-2 flex items-center justify-between">
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
          value={boundaryLevel}
          onChange={(event) => onBoundaryLevelChange(event.target.value as BoundaryLevel)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          {BOUNDARY_LEVEL_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
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

      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Point Filters</h2>
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

        <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
          {networkCounts.map(([network, count]) => {
            const selected = selectedNetworkSet.has(network)
            return (
              <button
                key={network}
                onClick={() => onToggleNetwork(network)}
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

      <div className="border-b border-border bg-background/95 p-4">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Equation Builder</h2>
        <div className="mb-3 flex flex-wrap gap-2">
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

        <div className="space-y-3">
          {SCORE_METRICS.map((metric) => (
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

        <div className="mt-3 rounded-md border border-border bg-background p-2">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Equation</div>
          <div className="font-mono text-[11px] text-foreground">{equationPreview}</div>
          <div className="mt-1 text-[10px] text-muted-foreground">
            |weights| sum: {totalAbsoluteWeight.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="border-b border-border bg-background/95 p-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">Density Lens</h2>
          <select
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
            <div className="mb-2 grid grid-cols-2 gap-2 text-xs">
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
            <div className="mt-1 text-[10px] text-muted-foreground">{getMetricDescription(densityMetric)}</div>
          </>
        ) : (
          <div className="text-xs text-muted-foreground">No values available for this density lens.</div>
        )}
      </div>

      {selectedRegion && (
        <div className="border-b border-cyan-300/50 bg-cyan-50 p-4 dark:border-cyan-900/70 dark:bg-cyan-950/25">
          <div className="mb-2 flex items-start justify-between gap-2">
            <div>
              <div className="text-sm font-semibold text-cyan-900 dark:text-cyan-100">{selectedRegion.region.name}</div>
              <div className="text-xs text-cyan-700 dark:text-cyan-300">
                Rank #{selectedRegion.rank} | Score {formatScore(selectedRegion.score)}
              </div>
            </div>
            <button
              onClick={onClearRegionSelection}
              className="text-cyan-700 hover:text-cyan-900 dark:text-cyan-300 dark:hover:text-cyan-100"
              aria-label="Clear selected region"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="mb-2 grid grid-cols-2 gap-2 text-[11px] text-cyan-800 dark:text-cyan-200">
            <div>Area: {selectedRegion.region.areaKm2.toFixed(1)} km²</div>
            <div>Sensors: {selectedRegion.counts.monitorCount.toLocaleString()}</div>
            <div>Low-cost: {selectedRegion.counts.lowCostCount.toLocaleString()}</div>
            <div>Reference: {selectedRegion.counts.referenceCount.toLocaleString()}</div>
          </div>

          <div className="space-y-1">
            {selectedContributionRows.map((row) => {
              const positive = row.scoreDelta >= 0
              return (
                <div key={row.key} className="rounded border border-cyan-200/60 bg-white/70 px-2 py-1 text-[11px] dark:border-cyan-900 dark:bg-cyan-950/40">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-cyan-900 dark:text-cyan-100">{row.label}</span>
                    <span className={cn('font-semibold', positive ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300')}>
                      {positive ? '+' : ''}{row.scoreDelta.toFixed(2)} pts
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-cyan-700 dark:text-cyan-300">
                    <span>weight {row.weight}</span>
                    <span>norm {(row.normalizedValue * 100).toFixed(1)}%</span>
                    <span>{formatMetricValue(row.key, row.metricValue, true)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loadingMonitors || loadingRegions ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          Building region scores...
        </div>
      ) : monitorsError || regionsError ? (
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="text-center text-sm text-red-500">
            <p className="font-medium">Unable to build scores</p>
            {monitorsError && <p>{monitorsError}</p>}
            {regionsError && <p>{regionsError}</p>}
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="sticky top-0 space-y-2 border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
            <input
              type="text"
              value={searchQuery}
              onChange={(event) => onSearchQueryChange(event.target.value)}
              placeholder="Search boundary by code or name..."
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
            <div className="flex items-center justify-between">
              <span>{filteredRegions.length} of {regions.length} regions</span>
              {filteredRegions.length > MAX_VISIBLE_ROWS && <span>Showing {MAX_VISIBLE_ROWS}</span>}
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span>Score range {formatScore(scoreSpread.min)} - {formatScore(scoreSpread.max)}</span>
              <span>Avg {formatScore(scoreSpread.average)}</span>
            </div>
          </div>

          <div className="divide-y divide-border">
            {visibleRows.map((entry) => {
              const selected = selectedRegion?.region.id === entry.region.id
              return (
                <button
                  key={entry.region.id}
                  onClick={() => onRegionSelect(entry.region.id)}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                    selected && 'bg-cyan-50 dark:bg-cyan-950/35'
                  )}
                >
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="line-clamp-1 text-sm font-medium text-foreground">
                      #{entry.rank} {entry.region.name}
                    </span>
                    <span className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">{formatScore(entry.score)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Code {entry.region.code} | Density {formatMetricValue('overallDensity', entry.metrics.overallDensity)}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
