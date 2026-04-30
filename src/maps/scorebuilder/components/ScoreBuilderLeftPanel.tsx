import { useMemo } from 'react'
import { Layers } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { BoundarySource, RegionLevel } from '@/maps/airquality'
import { BOUNDARY_SOURCE_OPTIONS } from '../constants'
import type { ScoreDataSource } from '../types'
import { SCORE_DATA_SOURCES } from '../types'

interface ScoreBuilderLeftPanelProps {
  className?: string
  boundarySource: BoundarySource
  onBoundarySourceChange: (source: BoundarySource) => void
  selectedRegionLevel: RegionLevel
  onRegionLevelChange: (level: RegionLevel) => void
  boundaryLevelOptions: Array<{ value: RegionLevel; label: string }>
  enabledDataSources: ScoreDataSource[]
  onToggleDataSource: (source: ScoreDataSource) => void
  networkCounts: Array<[string, number]>
  selectedNetworks: string[]
  onToggleNetwork: (network: string) => void
  onSelectAllNetworks: () => void
  onClearNetworks: () => void
  showPoints: boolean
  onTogglePoints: () => void
  regionCount: number
}

export function ScoreBuilderLeftPanel({
  className,
  boundarySource,
  onBoundarySourceChange,
  selectedRegionLevel,
  onRegionLevelChange,
  boundaryLevelOptions,
  enabledDataSources,
  onToggleDataSource,
  networkCounts,
  selectedNetworks,
  onToggleNetwork,
  onSelectAllNetworks,
  onClearNetworks,
  showPoints,
  onTogglePoints,
  regionCount,
}: ScoreBuilderLeftPanelProps) {
  const enabledSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur',
        className,
      )}
      data-score-builder-left-panel="true"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Layers className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold text-foreground">Layers</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">{regionCount} regions</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        {/* Boundary section */}
        <section
          className="border-b border-border p-4"
          data-score-builder-section="setup"
        >
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Boundaries
          </h3>

          <div className="space-y-1.5">
            {BOUNDARY_SOURCE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                data-score-builder-boundary-source={option.value}
                onClick={() => onBoundarySourceChange(option.value)}
                className={cn(
                  'w-full rounded-md border px-3 py-2 text-left transition-colors',
                  boundarySource === option.value
                    ? 'border-cyan-500/70 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/35 dark:text-cyan-100'
                    : 'border-input bg-background text-muted-foreground hover:text-foreground',
                )}
              >
                <div className="text-xs font-medium">{option.label}</div>
                <div className="text-[10px] text-muted-foreground">{option.description}</div>
              </button>
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <label
              htmlFor="score-builder-level"
              className="text-[11px] font-medium text-muted-foreground"
            >
              Boundary level
            </label>
            <button
              type="button"
              onClick={onTogglePoints}
              className={cn(
                'rounded border px-2 py-1 text-[11px] transition-colors',
                showPoints
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400'
                  : 'border-input text-muted-foreground hover:text-foreground',
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
            className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500"
          >
            {boundaryLevelOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </section>

        {/* Data sources */}
        <section
          className="p-4"
          data-score-builder-section="filters"
        >
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Data sources
          </h3>

          <div className="space-y-2">
            {SCORE_DATA_SOURCES.map((ds) => {
              const active = enabledSet.has(ds.id)
              return (
                <div key={ds.id}>
                  <button
                    type="button"
                    onClick={() => onToggleDataSource(ds.id)}
                    className={cn(
                      'flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors',
                      active
                        ? 'border-cyan-500/60 bg-cyan-50 text-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-100'
                        : 'border-input bg-background text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="font-medium">{ds.label}</div>
                      <div className="line-clamp-1 text-[10px] text-muted-foreground">
                        {ds.description}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'ml-2 shrink-0 text-xs font-semibold',
                        active ? 'text-cyan-600' : 'text-muted-foreground',
                      )}
                    >
                      {active ? 'ON' : 'OFF'}
                    </span>
                  </button>

                  {ds.id === 'airQuality' && active && (
                    <div className="ml-2 mt-1 space-y-1 border-l-2 border-cyan-200 pl-2 dark:border-cyan-900">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="text-muted-foreground">
                          {selectedNetworks.length} networks
                        </span>
                        <div className="flex gap-2">
                          <button
                            onClick={onSelectAllNetworks}
                            className="text-cyan-600 hover:text-cyan-700 dark:text-cyan-400"
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
                      <div className="max-h-32 space-y-0.5 overflow-y-auto">
                        {networkCounts.map(([network, count]) => (
                          <button
                            key={network}
                            data-score-builder-network={network}
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
        </section>
      </div>
    </div>
  )
}
