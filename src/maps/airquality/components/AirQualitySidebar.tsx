import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, House, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getNetworkColor } from '../constants'
import type {
  AirMonitor,
  BoundarySource,
  BoundaryRegionRecord,
  RegionLevel,
  SelectedBoundaryRegion,
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
  selectedRegion: SelectedBoundaryRegion | null
  selectedRegionLevel: RegionLevel
  regionLevelOptions: Array<{ value: RegionLevel; label: string }>
  regionOptions: BoundaryRegionRecord[]
  boundaryLoading: boolean
  boundaryError: string | null
  densityStats: SensorDensityStats | null
  densityScopeLabel: string
  searchQuery: string
  showHeatmap: boolean
  loading: boolean
  error: string | null
  onBoundarySourceChange: (source: BoundarySource) => void
  onRegionLevelChange: (level: RegionLevel) => void
  onRegionSelect: (level: RegionLevel, code: string) => void
  onRegionClear: () => void
  onSearchQueryChange: (query: string) => void
  onToggleHeatmap: () => void
  onToggleNetwork: (network: string) => void
  onSelectAllNetworks: () => void
  onClearNetworks: () => void
  mapBoundaryPickerEnabled: boolean
  onMapBoundaryPickerChange: (enabled: boolean) => void
  onMonitorClick: (monitor: AirMonitor) => void
  onClearSelection: () => void
}

const MAX_VISIBLE_ROWS = 250
const BOUNDARY_SOURCE_OPTIONS: Array<{
  value: BoundarySource
  label: string
  description: string
}> = [
  {
    value: 'bcHealth',
    label: 'Health Authority Boundaries',
    description: 'Health Authority -> HSDA -> LHA -> CHSA'
  },
  {
    value: 'census',
    label: 'Census Subdivision Boundaries',
    description: 'Census Division -> CSD -> CT -> DA'
  }
]

function uniqueParameters(parameters: string[]): string[] {
  return Array.from(new Set(parameters.map((parameter) => parameter.trim()).filter(Boolean)))
}

function formatDensityValue(value: number, count: number): string {
  if (!Number.isFinite(value) || value <= 0 || count <= 0) return 'None'
  return `1 per ${(1 / value).toFixed(1)} km²`
}

function getBoundarySourceLabel(source: BoundarySource): string {
  return source === 'bcHealth'
    ? 'Health Authority boundaries'
    : 'Census Subdivision boundaries'
}

export function AirQualitySidebar({
  className,
  monitors,
  filteredMonitors,
  visibleMonitorCount,
  selectedMonitor,
  selectedNetworks,
  boundarySource,
  selectedRegion,
  selectedRegionLevel,
  regionLevelOptions,
  regionOptions,
  boundaryLoading,
  boundaryError,
  densityStats,
  densityScopeLabel,
  searchQuery,
  showHeatmap,
  loading,
  error,
  onBoundarySourceChange,
  onRegionLevelChange,
  onRegionSelect,
  onRegionClear,
  onSearchQueryChange,
  onToggleHeatmap,
  onToggleNetwork,
  onSelectAllNetworks,
  onClearNetworks,
  mapBoundaryPickerEnabled,
  onMapBoundaryPickerChange,
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

  const [showRegionBrowser, setShowRegionBrowser] = useState(false)
  const [regionSearchQuery, setRegionSearchQuery] = useState('')
  const [showExpandedNetworks, setShowExpandedNetworks] = useState(false)

  useEffect(() => {
    if (!showRegionBrowser) {
      setRegionSearchQuery('')
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowRegionBrowser(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [showRegionBrowser])

  const filteredRegionOptions = useMemo(() => {
    const normalizedQuery = regionSearchQuery.trim().toLowerCase()
    if (!normalizedQuery) return regionOptions
    return regionOptions.filter((region) => (
      region.name.toLowerCase().includes(normalizedQuery) ||
      String(region.code).toLowerCase().includes(normalizedQuery)
    ))
  }, [regionOptions, regionSearchQuery])

  return (
    <div
      className={cn(
        'relative z-10 flex h-full min-h-0 w-[350px] flex-col overflow-hidden border-r border-border bg-background/95 shadow-xl backdrop-blur',
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

        <div className="border-b border-border bg-background/95 p-4">
          <div className="mb-3 space-y-1">
            <p className="text-sm font-medium text-foreground">Select a Region</p>
            <p className="text-xs text-muted-foreground">Choose an administrative boundary to analyze</p>
          </div>

          <button
            onClick={() => {
              setShowRegionBrowser(true)
              onMapBoundaryPickerChange(false)
            }}
            disabled={boundaryLoading}
            className={cn(
              'inline-flex w-full items-center justify-center rounded-md px-4 py-2 text-sm font-medium transition-colors',
              selectedRegion
                ? 'border border-input bg-background text-foreground hover:bg-accent'
                : 'bg-primary text-primary-foreground hover:bg-primary/90',
              boundaryLoading && 'opacity-60'
            )}
          >
            <House className="mr-2 h-4 w-4" />
            {boundaryLoading ? 'Loading boundaries...' : selectedRegion ? 'Change Region' : 'Browse Regions'}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowRegionBrowser(false)
              onMapBoundaryPickerChange(!mapBoundaryPickerEnabled)
            }}
            className={cn(
              'mt-2 inline-flex w-full items-center justify-center rounded-md border px-4 py-2 text-sm font-medium transition-colors',
              mapBoundaryPickerEnabled
                ? 'border-sky-500 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/30 dark:text-sky-300'
                : 'border-input bg-background text-foreground hover:bg-accent'
            )}
          >
            {mapBoundaryPickerEnabled ? 'Stop Map Selection' : 'Choose on Map'}
          </button>

          {mapBoundaryPickerEnabled && (
            <p className="mt-2 text-xs text-muted-foreground">
              Boundaries are visible on the map. Click a polygon to select it.
            </p>
          )}

          {selectedRegion && (
            <div className="mt-3 rounded-md bg-muted/50 p-3">
              <div className="text-xs font-medium text-muted-foreground">Selected Region</div>
              <div className="mt-1 text-sm font-semibold text-foreground">{selectedRegion.name}</div>
              <div className="text-xs text-muted-foreground">
                {selectedRegion.levelLabel} (Code {selectedRegion.code})
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {getBoundarySourceLabel(selectedRegion.source)}
              </div>
              <button
                onClick={onRegionClear}
                className="mt-2 text-xs text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
              >
                Clear region
              </button>
            </div>
          )}

          {boundaryError && (
            <div className="mt-2 text-xs text-red-600 dark:text-red-400">{boundaryError}</div>
          )}
        </div>

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

      {showRegionBrowser && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowRegionBrowser(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-background shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="border-b border-border px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Select a Region</p>
                  <p className="text-xs text-muted-foreground">Choose an administrative boundary to analyze</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowRegionBrowser(false)}
                  className="rounded border border-input p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label="Close region selector"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="space-y-3 p-4">
              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Boundary Source</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  {BOUNDARY_SOURCE_OPTIONS.map((option) => {
                    const selected = boundarySource === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => onBoundarySourceChange(option.value)}
                        className={cn(
                          'rounded-md border px-3 py-2 text-left transition-colors',
                          selected
                            ? 'border-sky-500 bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-300'
                            : 'border-input bg-background text-foreground hover:bg-accent'
                        )}
                      >
                        <div className="text-xs font-semibold">{option.label}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">{option.description}</div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-medium text-foreground">Hierarchy Level</p>
                <select
                  value={selectedRegionLevel}
                  onChange={(event) => onRegionLevelChange(event.target.value as RegionLevel)}
                  className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {regionLevelOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>

              <input
                type="text"
                value={regionSearchQuery}
                onChange={(event) => setRegionSearchQuery(event.target.value)}
                placeholder="Search regions..."
                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />

              <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                {filteredRegionOptions.slice(0, 400).map((region) => {
                  const isSelected = (
                    selectedRegion?.source === boundarySource &&
                    selectedRegion?.code === String(region.code) &&
                    selectedRegion?.level === selectedRegionLevel
                  )
                  return (
                    <button
                      key={`${selectedRegionLevel}:${region.code}`}
                      onClick={() => {
                        onRegionSelect(selectedRegionLevel, String(region.code))
                        setShowRegionBrowser(false)
                      }}
                      className={cn(
                        'w-full border-b border-border px-3 py-2 text-left text-xs last:border-b-0',
                        isSelected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60 hover:text-foreground'
                      )}
                    >
                      <div className="font-medium">{region.name}</div>
                      <div className="text-[10px] text-muted-foreground">Code: {region.code}</div>
                    </button>
                  )
                })}
                {filteredRegionOptions.length === 0 && (
                  <div className="px-3 py-4 text-center text-xs text-muted-foreground">
                    No matching regions
                  </div>
                )}
              </div>

              {boundaryLoading && (
                <div className="text-xs text-muted-foreground">Loading boundaries...</div>
              )}

              {boundaryError && (
                <div className="text-xs text-red-600 dark:text-red-400">{boundaryError}</div>
              )}

              <button
                type="button"
                onClick={() => {
                  onMapBoundaryPickerChange(true)
                  setShowRegionBrowser(false)
                }}
                className="inline-flex w-full items-center justify-center rounded-md border border-input bg-background px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-accent"
              >
                Choose on map
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
