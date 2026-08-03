import { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { StudyAreaSelector } from '@/components/StudyAreaSelector'
import { AppSelect } from '@/components/ui/select'
import {
  FilterChipGroup,
  MapSidebarShell,
  SearchInput,
  SelectedItemCard,
  SidebarSection,
  ToggleChip,
} from '@/components/ui/map-panels'
import { BOUNDARY_SOURCE_OPTIONS } from '@/lib/studyArea'
import { DATASETS } from '@/lib/dataCatalog'
import { cn } from '@/lib/utils'
import { getNetworkColor } from '../constants'
import { calculateCorrectedPm25, formatMeasurement, formatPm25 } from '../lib/corrections'
import type { AirQualityActions, AirQualityViewState } from '../hooks/useAirQualityState'
import type {
  AirMonitor,
  AirQualityAreaStats,
  AirQualityBoundaryColorMetric,
  BoundarySource,
  RegionLevel,
  SensorDensityStats,
} from '../types'

interface AirQualitySidebarProps {
  className?: string
  state: AirQualityViewState
  actions: AirQualityActions
  monitors: AirMonitor[]
  filteredMonitors: AirMonitor[]
  visibleMonitorCount: number
  visibleMonitorCountLabel: string
  regionLevelOptions: Array<{ value: RegionLevel; label: string }>
  boundaryLoading: boolean
  boundaryError: string | null
  densityStats: SensorDensityStats | null
  areaStats: AirQualityAreaStats | null
  densityScopeLabel: string
  loading: boolean
  error: string | null
}

const MAX_VISIBLE_ROWS = 250

const BOUNDARY_COLOR_OPTIONS: Array<{ value: AirQualityBoundaryColorMetric; label: string }> = [
  { value: 'sensorCount', label: 'Total sensors' },
  { value: 'overallDensity', label: 'Sensors per km²' },
  { value: 'lowCostDensity', label: 'Low-cost sensors per km²' },
  { value: 'otherDensity', label: 'Other sensors per km²' },
  { value: 'correctedPm25', label: 'Corrected PM2.5' },
  { value: 'rawPm25', label: 'Raw PM2.5' },
  { value: 'networkCount', label: 'Networks' },
]

function uniqueParameters(parameters: string[]): string[] {
  return Array.from(new Set(parameters.map((parameter) => parameter.trim()).filter(Boolean)))
}

function formatDensityValue(value: number, count: number): string {
  if (!Number.isFinite(value) || value <= 0 || count <= 0) return 'None'
  return `1 per ${(1 / value).toFixed(1)} km²`
}

function formatAveragePm25(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'No data'
  return `${value.toFixed(1)} ug/m3`
}

export function AirQualitySidebar({
  className,
  state,
  actions,
  monitors,
  filteredMonitors,
  visibleMonitorCount,
  visibleMonitorCountLabel,
  regionLevelOptions,
  boundaryLoading,
  boundaryError,
  densityStats,
  areaStats,
  densityScopeLabel,
  loading,
  error,
}: AirQualitySidebarProps) {
  const {
    searchQuery,
    selectedNetworks,
    showHeatmap,
    showPoints,
    boundariesVisible,
    boundarySource,
    selectedRegionLevel,
    boundaryColorMetric,
    correctionModel,
    selectedMonitor,
  } = state
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
    <MapSidebarShell
      className={cn('relative', className)}
      title="Air Quality"
      subtitle="Monitoring Networks"
      dataset={DATASETS.airQuality}
      actions={
        <>
          <ToggleChip active={showPoints} onClick={actions.togglePoints} tone="sky">
            {showPoints ? 'Hide points' : 'Show points'}
          </ToggleChip>
          <ToggleChip active={showHeatmap} onClick={actions.toggleHeatmap} tone="orange">
            Heatmap
          </ToggleChip>
        </>
      }
    >
      <StudyAreaSelector<BoundarySource, RegionLevel>
        source={boundariesVisible ? boundarySource : undefined}
        sourceOptions={BOUNDARY_SOURCE_OPTIONS}
        level={selectedRegionLevel}
        levelOptions={boundariesVisible ? regionLevelOptions : []}
        onSourceChange={actions.setBoundarySource}
        onSelectedSourceClick={actions.clearBoundaries}
        onLevelChange={actions.setRegionLevel}
        levelSelectId="air-quality-study-area-level"
      />

      {(boundaryLoading || boundaryError) && (
        <div className="border-b border-border bg-background/95 px-4 pb-4 text-xs">
          {boundaryLoading && <p className="text-muted-foreground">Loading boundaries...</p>}
          {boundaryError && <p className="text-red-600 dark:text-red-400">{boundaryError}</p>}
        </div>
      )}

      {densityStats && (
        <SidebarSection title="Area Summary">
          <div className="space-y-2 text-sm">
            <div>
              <label htmlFor="air-quality-boundary-color" className="mb-1.5 block text-xs font-medium text-foreground">
                Polygon color
              </label>
              <AppSelect
                id="air-quality-boundary-color"
                value={boundaryColorMetric}
                onValueChange={(value) => actions.setBoundaryColorMetric(value as AirQualityBoundaryColorMetric)}
                options={BOUNDARY_COLOR_OPTIONS}
                triggerClassName="h-8 text-xs"
              />
            </div>
            {areaStats && (
              <>
                <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/25 p-3 text-xs">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Corrected PM2.5</div>
                    <div className="text-base font-semibold text-foreground">
                      {formatAveragePm25(areaStats.correctedPm25Average)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Raw PM2.5</div>
                    <div className="text-base font-semibold text-foreground">
                      {formatAveragePm25(areaStats.rawPm25Average)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">PM2.5 sensors</div>
                    <div className="font-medium text-foreground">{areaStats.pm25MonitorCount}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Networks</div>
                    <div className="font-medium text-foreground">{areaStats.networkCount}</div>
                  </div>
                </div>
                {(areaStats.correctedPm25Min !== null || areaStats.correctedPm25Max !== null) && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Corrected range:</span>
                    <span>
                      {formatAveragePm25(areaStats.correctedPm25Min)} - {formatAveragePm25(areaStats.correctedPm25Max)}
                    </span>
                  </div>
                )}
              </>
            )}
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
              <span className="font-semibold text-foreground">
                {formatDensityValue(densityStats.overall, densityStats.totalCount)}
              </span>
            </div>
            <div className="pt-1 text-xs text-muted-foreground">{densityScopeLabel}</div>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Search area:</span>
                <span>{densityStats.areaKm2.toFixed(1)} km²</span>
              </div>
              {densityStats.actualCoverageKm2 > 0 && (
                <div className="flex items-center justify-between">
                  <span>Actual coverage:</span>
                  <span>
                    {densityStats.actualCoverageKm2.toFixed(1)} km² ({densityStats.coveragePercent.toFixed(1)}%)
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between font-medium text-foreground">
                <span>Total sensors:</span>
                <span>{densityStats.totalCount}</span>
              </div>
            </div>
          </div>
        </SidebarSection>
      )}

      <SidebarSection>
        <label className="mb-2 block text-xs font-medium text-foreground">Search monitors</label>
        <SearchInput
          value={searchQuery}
          onChange={(event) => actions.setSearchQuery(event.target.value)}
          placeholder="Search monitors, city, network, parameter..."
          className="focus:ring-sky-500"
        />
      </SidebarSection>

      <SidebarSection
        title="Networks"
        actions={
          <>
            <button
              onClick={() => actions.setNetworks(networkCounts.map(([network]) => network))}
              className="text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
            >
              All
            </button>
            <button onClick={() => actions.setNetworks([])} className="text-xs text-muted-foreground hover:text-foreground">
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
          </>
        }
      >
        <FilterChipGroup
          items={networkCounts.map(([network, count]) => ({
            value: network,
            label: network,
            count,
            color: getNetworkColor(network),
          }))}
          selectedValues={selectedNetworks}
          onToggle={actions.toggleNetwork}
          layout={showExpandedNetworks ? 'wrap' : 'scroll'}
          className={showExpandedNetworks ? 'max-h-36 overflow-y-auto' : undefined}
          chipClassName="px-3 py-1"
        />
      </SidebarSection>

      {selectedMonitor && (
        <SidebarSection>
          <SelectedItemCard
            tone="sky"
            title={selectedMonitor.name}
            subtitle={
              [selectedMonitor.city, selectedMonitor.province].filter(Boolean).join(', ') || 'Location available'
            }
            onClear={actions.clearMonitor}
            clearLabel="Clear selected monitor"
            badges={
              <>
                <span className="flex items-center gap-1 rounded border border-sky-300/60 bg-sky-100/70 px-1.5 py-0.5 text-xs font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-900/50 dark:text-sky-100">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: getNetworkColor(selectedMonitor.network) }}
                  />
                  {selectedMonitor.network}
                </span>
                {selectedMonitor.status && (
                  <span className="rounded bg-sky-100 px-2 py-0.5 text-xs font-medium uppercase dark:bg-sky-900/60">
                    {selectedMonitor.status}
                  </span>
                )}
                {selectedMonitorParameters.map((parameter) => (
                  <span
                    key={`${selectedMonitor.id}-${parameter}`}
                    className="rounded border border-sky-300/60 bg-sky-100/70 px-1.5 py-0.5 text-xs font-medium text-sky-900 dark:border-sky-800/60 dark:bg-sky-900/50 dark:text-sky-100"
                  >
                    {parameter}
                  </span>
                ))}
              </>
            }
          >
            {selectedMonitorCorrection && (
              <div className="mt-3 rounded-md border border-sky-300/70 bg-background/70 p-3 text-xs dark:border-sky-800/70">
                <div className="mb-2 font-semibold text-sky-900 dark:text-sky-100">
                  {selectedMonitorCorrection.label}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Raw PM2.5</div>
                    <div className="font-medium text-foreground">{formatPm25(selectedMonitorCorrection.rawPm25)}</div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Corrected</div>
                    <div className="font-medium text-foreground">
                      {formatPm25(selectedMonitorCorrection.correctedPm25)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">RH</div>
                    <div className="font-medium text-foreground">
                      {formatMeasurement(selectedMonitorCorrection.humidity, '%')}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Uncertainty</div>
                    <div className="font-medium text-foreground">
                      {selectedMonitorCorrection.uncertainty === null
                        ? 'No data'
                        : `+/- ${selectedMonitorCorrection.uncertainty.toFixed(1)} ug/m3`}
                    </div>
                  </div>
                </div>
                <p className="mt-2 text-xs leading-snug text-muted-foreground">{selectedMonitorCorrection.note}</p>
              </div>
            )}
          </SelectedItemCard>
        </SidebarSection>
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
            <span>
              {visibleMonitorCount} {visibleMonitorCountLabel}
            </span>
            {filteredMonitors.length > MAX_VISIBLE_ROWS && <span>Showing first {MAX_VISIBLE_ROWS}</span>}
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
                  onClick={() => actions.selectMonitor(monitor)}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-colors hover:bg-accent',
                    isSelected && 'bg-sky-50 dark:bg-sky-950/30',
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
                          className="rounded border bg-background px-1.5 py-0.5 text-xs text-muted-foreground"
                        >
                          {parameter}
                        </span>
                      ))}
                      {hiddenParameterCount > 0 && (
                        <span className="text-xs text-muted-foreground">+{hiddenParameterCount} more</span>
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
    </MapSidebarShell>
  )
}
