import { useMemo } from 'react'
import { Layers } from 'lucide-react'
import { DatasetInfo } from '@/components/DatasetInfo'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { cn } from '@/lib/utils'
import { DATASETS } from '@/lib/dataCatalog'
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
  canUseWalkabilitySourceSurface: boolean
  mapSurface: 'source' | 'boundary'
  onMapSurfaceChange: (surface: 'source' | 'boundary') => void
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
  canUseWalkabilitySourceSurface,
  mapSurface,
  onMapSurfaceChange,
}: ScoreBuilderLeftPanelProps) {
  const enabledSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])
  const displayedBoundarySource = canUseWalkabilitySourceSurface && mapSurface === 'source' ? undefined : boundarySource

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
        <h2 className="text-sm font-semibold text-foreground">Index Inputs</h2>
        <span className="ml-auto text-[11px] text-muted-foreground">{regionCount} regions</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto" data-score-builder-scroll="true">
        <DatasetInfo dataset={DATASETS.scoreBuilder} />

        <StudyAreaSelector<BoundarySource, RegionLevel>
          source={displayedBoundarySource}
          sourceOptions={BOUNDARY_SOURCE_OPTIONS}
          level={selectedRegionLevel}
          levelOptions={boundaryLevelOptions}
          onSourceChange={(source) => {
            onBoundarySourceChange(source)
            if (canUseWalkabilitySourceSurface) onMapSurfaceChange('boundary')
          }}
          onSelectedSourceClick={
            canUseWalkabilitySourceSurface ? () => onMapSurfaceChange('source') : undefined
          }
          onLevelChange={onRegionLevelChange}
          showPoints={showPoints}
          onTogglePoints={onTogglePoints}
          levelSelectId="score-builder-level"
          dataPrefix="score-builder"
        />

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
                    aria-label={`${ds.label} ${ds.id === 'bcAssessment' ? 'Property' : ''} ${active ? 'ON' : 'OFF'}`}
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
