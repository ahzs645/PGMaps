import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { DatasetInfo } from '@/components/DatasetInfo'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { BOUNDARY_SOURCE_OPTIONS } from '@/lib/studyArea'
import { DATASETS } from '@/lib/dataCatalog'
import { cn } from '@/lib/utils'
import { getNetworkColor } from '../constants'
import {
  calculateCorrectedPm25,
  formatNumber,
  formatPm25
} from '../lib/corrections'
import type {
  AirMonitor,
  AirQualityBasemap,
  AirQualityCorrectionModel,
  AirQualityObservationLayer,
  BoundarySource,
  RegionLevel,
  SensorDensityStats
} from '../types'

interface AirQualitySidebarProps {
  className?: string
  monitors: AirMonitor[]
  filteredMonitors: AirMonitor[]
  visibleMonitorCount: number
  selectedMonitor: AirMonitor | null
  selectedNetworks: string[]
  boundarySource: BoundarySource
  selectedRegionLevel: RegionLevel
  regionLevelOptions: Array<{ value: RegionLevel; label: string }>
  boundaryLoading: boolean
  boundaryError: string | null
  densityStats: SensorDensityStats | null
  densityScopeLabel: string
  searchQuery: string
  showHeatmap: boolean
  basemap: AirQualityBasemap
  correctionModel: AirQualityCorrectionModel
  observationLayers: AirQualityObservationLayer[]
  loading: boolean
  error: string | null
  onBasemapChange: (basemap: AirQualityBasemap) => void
  onCorrectionModelChange: (model: AirQualityCorrectionModel) => void
  onToggleObservationLayer: (layer: AirQualityObservationLayer) => void
  onBoundarySourceChange: (source: BoundarySource) => void
  onRegionLevelChange: (level: RegionLevel) => void
  onSearchQueryChange: (query: string) => void
  onToggleHeatmap: () => void
  onToggleNetwork: (network: string) => void
  onSelectAllNetworks: () => void
  onClearNetworks: () => void
  onMonitorClick: (monitor: AirMonitor) => void
  onClearSelection: () => void
}

const MAX_VISIBLE_ROWS = 250

function uniqueParameters(parameters: string[]): string[] {
  return Array.from(new Set(parameters.map((parameter) => parameter.trim()).filter(Boolean)))
}

function formatDensityValue(value: number, count: number): string {
  if (!Number.isFinite(value) || value <= 0 || count <= 0) return 'None'
  return `1 per ${(1 / value).toFixed(1)} km²`
}

export function AirQualitySidebar({
  className,
  monitors,
  filteredMonitors,
  visibleMonitorCount,
  selectedMonitor,
  selectedNetworks,
  boundarySource,
  selectedRegionLevel,
  regionLevelOptions,
  boundaryLoading,
  boundaryError,
  densityStats,
  densityScopeLabel,
  searchQuery,
  showHeatmap,
  correctionModel,
  loading,
  error,
  onBoundarySourceChange,
  onRegionLevelChange,
  onSearchQueryChange,
  onToggleHeatmap,
  onToggleNetwork,
  onSelectAllNetworks,
  onClearNetworks,
  onMonitorClick,
  onClearSelection
}: AirQualitySidebarProps) {
  const networkCounts = useMemo(() => {
    const counts = new Map<string, number>()
    monitors.forEach((monitor) => {
      counts.set(monitor.network, (counts.get(monitor.network) || 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [monitors])

  const displayedRows = useMemo(() => {
    return filteredMonitors.slice(0, MAX_VISIBLE_ROWS)
  }, [filteredMonitors])

  const selectedMonitorParameters = useMemo(() => {
    if (!selectedMonitor) return []
    return uniqueParameters(selectedMonitor.parameters)
  }, [selectedMonitor])

  const selectedMonitorCorrection = useMemo(() => {
    if (!selectedMonitor) return null
    return calculateCorrectedPm25(selectedMonitor, correctionModel)
  }, [correctionModel, selectedMonitor])

  const [showExpandedNetworks, setShowExpandedNetworks] = useState(false)

  return (
    <div
      className={cn(
        'relative z-10 flex h-full min-h-0 w-full flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur',
        className
      )}
    >
      <div className="border-b border-border bg-background/95 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-foreground">Air Quality</h1>
            <p className="text-sm text-muted-foreground">Monitoring Networks</p>
          </div>
          <button
            onClick={onToggleHeatmap}
            className={cn(
              'rounded border px-2 py-1 text-xs transition-colors',
              showHeatmap
                ? 'border-orange-500 text-orange-600 dark:text-orange-400'
                : 'border-input text-muted-foreground hover:text-foreground'
            )}
          >
            Heatmap
          </button>
        </div>
      </div>

      <DatasetInfo dataset={DATASETS.airQuality} />

      <div className="flex-1 overflow-y-auto">
        {densityStats && (
          <div className="border-b border-border bg-background/95 p-4">
            <h3 className="mb-3 text-sm font-semibold text-foreground">Sensor Density</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Low-cost:</span>
                <span className="font-medium">{formatDensityValue(densityStats.lowCost, densityStats.lowCostCount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Other:</span>
                <span className="font-medium">{formatDensityValue(densityStats.other, densityStats.otherCount)}</span>
              </div>
              <div className="flex items-center justify-between border-t pt-2">
                <span className="font-medium text-foreground">Overall:</span>
                <span className="font-semibold text-foreground">{formatDensityValue(densityStats.overall, densityStats.totalCount)}</span>
              </div>
              <div className="pt-1 text-[10px] text-muted-foreground">{densityScopeLabel}</div>
              <div className="space-y-1 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Search area:</span>
                  <span>{densityStats.areaKm2.toFixed(1)} km²</span>
                </div>
                {densityStats.actualCoverageKm2 > 0 && (
                  <div className="flex items-center justify-between">
                    <span>Actual coverage:</span>
                    <span>{densityStats.actualCoverageKm2.toFixed(1)} km² ({densityStats.coveragePercent.toFixed(1)}%)</span>
                  </div>
                )}
                <div className="flex items-center justify-between font-medium text-foreground">
                  <span>Total sensors:</span>
                  <span>{densityStats.totalCount}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="border-b border-border bg-background/95 p-4">
          <label className="mb-2 block text-xs font-medium text-foreground">Search monitors</label>
          <input
            type="text"
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search monitors, city, network, parameter..."
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-sky-500"
          />
        </div>

        <div className="border-b border-border bg-background/95 p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-medium text-foreground">Networks</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={onSelectAllNetworks}
                className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
              >
                All
              </button>
              <button
                onClick={onClearNetworks}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                None
              </button>
              <button
                type="button"
                onClick={() => setShowExpandedNetworks((prev) => !prev)}
                className="rounded border border-input p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label={showExpandedNetworks ? 'Show compact networks' : 'Expand networks'}
              >
                {showExpandedNetworks ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>

          <div
            className={cn(
              'flex gap-2 pr-1',
              showExpandedNetworks
                ? 'max-h-36 flex-wrap overflow-y-auto'
                : 'overflow-x-auto pb-1'
            )}
          >
            {networkCounts.map(([network, count]) => {
              const selected = selectedNetworks.includes(network)
              const networkColor = getNetworkColor(network)
              return (
                <button
                  key={network}
                  onClick={() => onToggleNetwork(network)}
                  className={cn(
                    'flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors',
                    !showExpandedNetworks && 'shrink-0',
                    selected
                      ? 'bg-background'
                      : 'border-input bg-background text-foreground hover:bg-accent'
                  )}
                  style={selected ? { borderColor: networkColor } : undefined}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: networkColor }}
                  />
                  <span
                    className="max-w-[110px] truncate"
                    style={selected ? { color: networkColor } : undefined}
                  >
                    {network}
                  </span>
                  <span
                    className={cn('opacity-80', selected ? '' : 'text-muted-foreground')}
                    style={selected ? { color: networkColor } : undefined}
                  >
                    {count}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        <StudyAreaSelector<BoundarySource, RegionLevel>
          source={boundarySource}
          sourceOptions={BOUNDARY_SOURCE_OPTIONS}
          level={selectedRegionLevel}
          levelOptions={regionLevelOptions}
          onSourceChange={onBoundarySourceChange}
          onLevelChange={onRegionLevelChange}
          showPoints={!showHeatmap}
          onTogglePoints={onToggleHeatmap}
          levelSelectId="air-quality-study-area-level"
        />

        {(boundaryLoading || boundaryError) && (
          <div className="border-b border-border bg-background/95 px-4 pb-4 text-xs">
            {boundaryLoading && <p className="text-muted-foreground">Loading boundaries...</p>}
            {boundaryError && <p className="text-red-600 dark:text-red-400">{boundaryError}</p>}
          </div>
        )}

        {selectedMonitor && (
          <div className="border-b border-sky-300/60 bg-sky-50 p-4 dark:border-sky-800/60 dark:bg-sky-950/30">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-sky-900 dark:text-sky-200">{selectedMonitor.name}</div>
                <div className="text-xs text-sky-700 dark:text-sky-300">
                  {[selectedMonitor.city, selectedMonitor.province].filter(Boolean).join(', ') || 'Location available'}
                </div>
              </div>
              <button
                onClick={onClearSelection}
                className="text-sky-700 hover:text-sky-900 dark:text-sky-300 dark:hover:text-sky-100"
                aria-label="Clear selected monitor"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: getNetworkColor(selectedMonitor.network) }}
              />
              <span>{selectedMonitor.network}</span>
              {selectedMonitor.status && (
                <span className="rounded bg-sky-100 px-2 py-0.5 text-[10px] font-medium uppercase dark:bg-sky-900/60">
                  {selectedMonitor.status}
                </span>
              )}
            </div>
            {selectedMonitorParameters.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {selectedMonitorParameters.map((parameter) => (
                  <span
                    key={`${selectedMonitor.id}-${parameter}`}
                    className="rounded border border-sky-300/60 bg-sky-100/70 px-1.5 py-0.5 text-[10px] font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-900/50 dark:text-sky-100"
                  >
                    {parameter}
                  </span>
                ))}
              </div>
            )}
            {selectedMonitorCorrection && (
              <div className="mt-3 rounded-md border border-sky-300/70 bg-background/70 p-3 text-xs dark:border-sky-800/70">
                <div className="mb-2 font-semibold text-sky-900 dark:text-sky-100">
                  {selectedMonitorCorrection.label}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Raw PM2.5</div>
                    <div className="font-medium text-foreground">{formatPm25(selectedMonitorCorrection.rawPm25)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Corrected</div>
                    <div className="font-medium text-foreground">{formatPm25(selectedMonitorCorrection.correctedPm25)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">RH</div>
                    <div className="font-medium text-foreground">{formatNumber(selectedMonitorCorrection.humidity, '%')}</div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Uncertainty</div>
                    <div className="font-medium text-foreground">
                      {selectedMonitorCorrection.uncertainty === null
                        ? 'No data'
                        : `+/- ${selectedMonitorCorrection.uncertainty.toFixed(1)} ug/m3`}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-[10px] leading-snug text-muted-foreground">{selectedMonitorCorrection.note}</p>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
            Loading monitor data...
          </div>
        ) : error ? (
          <div className="p-4">
            <div className="text-center text-sm text-red-500">
              <p className="font-medium">Error loading monitor data</p>
              <p>{error}</p>
            </div>
          </div>
        ) : (
          <div className="pb-6">
            <div className="sticky top-0 flex items-center justify-between border-b border-border bg-background/95 p-2 text-xs text-muted-foreground backdrop-blur">
              <span>{visibleMonitorCount} monitors in view</span>
              {filteredMonitors.length > MAX_VISIBLE_ROWS && (
                <span>Showing first {MAX_VISIBLE_ROWS}</span>
              )}
            </div>
            <div className="divide-y divide-border">
              {displayedRows.map((monitor) => {
                const isSelected = selectedMonitor?.id === monitor.id
                const parameters = uniqueParameters(monitor.parameters)
                const visibleParameters = parameters.slice(0, 3)
                const hiddenParameterCount = Math.max(parameters.length - visibleParameters.length, 0)
                return (
                  <button
                    key={`${monitor.id}-${monitor.network}`}
                    onClick={() => onMonitorClick(monitor)}
                    className={cn(
                      'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                      isSelected && 'bg-sky-50 dark:bg-sky-950/30'
                    )}
                  >
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <span className="line-clamp-1 text-sm font-medium text-foreground">{monitor.name}</span>
                      <span
                        className="mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: getNetworkColor(monitor.network) }}
                      />
                    </div>
                    <div className="mb-1 text-xs text-muted-foreground">{monitor.network}</div>
                    <div className="text-xs text-muted-foreground">
                      {[monitor.city, monitor.province].filter(Boolean).join(', ') || 'No city/province'}
                    </div>
                    {visibleParameters.length > 0 && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {visibleParameters.map((parameter) => (
                          <span
                            key={`${monitor.id}-${parameter}`}
                            className="rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
                          >
                            {parameter}
                          </span>
                        ))}
                        {hiddenParameterCount > 0 && (
                          <span className="text-[10px] text-muted-foreground">+{hiddenParameterCount} more</span>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
              {displayedRows.length === 0 && (
                <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                  No monitors match the current filters.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
