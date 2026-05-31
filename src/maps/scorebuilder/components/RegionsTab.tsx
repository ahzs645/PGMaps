import { Download, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SCORE_METRICS } from '../constants'
import type { ScoredBoundaryRegion, ScoreMetricWeightMap } from '../types'
import { formatMetricValue, formatScore } from '../lib/metrics'
import { formatDriverDelta, getScoreDrivers, type ScoreDriver } from '../lib/scoreDrivers'
import type { PopulationWeightedEquitySummary } from '../lib/populationSummary'
import { MAX_VISIBLE_REGION_ROWS } from './scoreBuilderPanelUtils'
import { RadarChart } from './RadarChart'

interface RegionsTabProps {
  className?: string
  loading: boolean
  dataErrors?: string[]
  regions: ScoredBoundaryRegion[]
  visibleRows: ScoredBoundaryRegion[]
  filteredRegions: ScoredBoundaryRegion[]
  selectedRegion: ScoredBoundaryRegion | null
  selectedRegionDrivers: ScoreDriver[]
  comparisonRegions: ScoredBoundaryRegion[]
  comparisonSet: Set<string>
  weights: ScoreMetricWeightMap
  scoreSpread: { min: number; max: number; average: number }
  populationEquitySummary?: PopulationWeightedEquitySummary | null
  searchQuery: string
  onSearchQueryChange: (query: string) => void
  onRegionSelect: (regionId: string) => void
  onClearRegionSelection: () => void
  onOpenRegionInsight: (regionId: string) => void
  onToggleComparison: (regionId: string) => void
  onClearComparison: () => void
  onExport: (format: 'csv' | 'geojson') => void
}

export function RegionsTab({
  className,
  loading,
  dataErrors = [],
  regions,
  visibleRows,
  filteredRegions,
  selectedRegion,
  selectedRegionDrivers,
  comparisonRegions,
  comparisonSet,
  weights,
  scoreSpread,
  populationEquitySummary = null,
  searchQuery,
  onSearchQueryChange,
  onRegionSelect,
  onClearRegionSelection,
  onOpenRegionInsight,
  onToggleComparison,
  onClearComparison,
  onExport,
}: RegionsTabProps) {
  return (
    <div className={cn('space-y-3', className)} data-score-builder-section="regions">
      <div className="space-y-2 rounded-lg border border-border bg-muted/10 p-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              data-map-search-input="true"
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
          {filteredRegions.length > MAX_VISIBLE_REGION_ROWS && <span>Showing {MAX_VISIBLE_REGION_ROWS}</span>}
        </div>
        <div className="flex items-center justify-between text-[11px]">
          <span>
            Score range {formatScore(scoreSpread.min)} - {formatScore(scoreSpread.max)}
          </span>
          <span>Avg {formatScore(scoreSpread.average)}</span>
        </div>
      </div>

      {populationEquitySummary && (
        <div className="rounded-lg border border-cyan-200 bg-cyan-50/70 p-3 text-xs text-cyan-950 dark:border-cyan-900/60 dark:bg-cyan-950/20 dark:text-cyan-100">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
            Equity by the numbers
          </div>
          <div className="mt-1 text-sm font-semibold">{populationEquitySummary.narrative}</div>
          <div className="mt-1 text-[11px] text-cyan-800/80 dark:text-cyan-200/80">
            {populationEquitySummary.priorityPopulation.toLocaleString()} of{' '}
            {populationEquitySummary.totalPopulation.toLocaleString()} people ·{' '}
            {populationEquitySummary.priorityRegionCount} regions
          </div>
        </div>
      )}

      {dataErrors.length > 0 && (
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-300">
          <p className="font-medium">Data loading issues</p>
          {dataErrors.map((err, i) => (
            <p key={i}>{err}</p>
          ))}
        </div>
      )}

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
