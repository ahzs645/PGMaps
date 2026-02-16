import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { AirQualityMap } from './components/AirQualityMap'
import { AirQualitySidebar } from './components/AirQualitySidebar'
import { getNetworkColor } from './constants'
import { useAirQualityData } from './hooks/useAirQualityData'
import type { AirMonitor } from './types'
import type { AirQualityMapBounds } from './components/AirQualityMap'

function normalizeLongitude(lon: number): number {
  return ((lon + 540) % 360) - 180
}

function isMonitorInBounds(monitor: AirMonitor, bounds: AirQualityMapBounds | null): boolean {
  if (!bounds) return true

  const lat = monitor.latitude
  const lon = normalizeLongitude(monitor.longitude)
  const west = normalizeLongitude(bounds.west)
  const east = normalizeLongitude(bounds.east)

  const withinLatitude = lat >= bounds.south && lat <= bounds.north
  const withinLongitude = west <= east
    ? lon >= west && lon <= east
    : lon >= west || lon <= east

  return withinLatitude && withinLongitude
}

export default function AirQualitySection() {
  const { monitors, loading, error } = useAirQualityData()

  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([])
  const [networksInitialized, setNetworksInitialized] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selectedMonitor, setSelectedMonitor] = useState<AirMonitor | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [mapBounds, setMapBounds] = useState<AirQualityMapBounds | null>(null)

  const allNetworks = useMemo(() => {
    return Array.from(new Set(monitors.map((monitor) => monitor.network))).sort((a, b) => a.localeCompare(b))
  }, [monitors])

  useEffect(() => {
    if (!networksInitialized && allNetworks.length > 0) {
      setSelectedNetworks(allNetworks)
      setNetworksInitialized(true)
    }
  }, [allNetworks, networksInitialized])

  const filteredMonitors = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return monitors.filter((monitor) => {
      const matchesNetwork = selectedNetworks.includes(monitor.network)
      const matchesSearch = !normalizedQuery || [
        monitor.name,
        monitor.network,
        monitor.city,
        monitor.province,
        monitor.parameters.join(' ')
      ].filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery)
      return matchesNetwork && matchesSearch
    })
  }, [monitors, selectedNetworks, searchQuery])

  const totalMonitorsInView = useMemo(() => {
    return monitors.filter((monitor) => isMonitorInBounds(monitor, mapBounds))
  }, [mapBounds, monitors])

  const visibleMonitorsInView = useMemo(() => {
    return filteredMonitors.filter((monitor) => isMonitorInBounds(monitor, mapBounds))
  }, [filteredMonitors, mapBounds])

  useEffect(() => {
    if (!selectedMonitor) return
    const stillVisible = filteredMonitors.some((monitor) => monitor.id === selectedMonitor.id)
    if (!stillVisible) {
      setSelectedMonitor(null)
    }
  }, [filteredMonitors, selectedMonitor])

  const toggleNetwork = useCallback((network: string) => {
    setSelectedNetworks((current) => {
      if (current.includes(network)) {
        return current.filter((item) => item !== network)
      }
      return [...current, network]
    })
  }, [])

  const selectedLegendNetworks = useMemo(() => {
    return allNetworks.filter((network) => selectedNetworks.includes(network)).slice(0, 8)
  }, [allNetworks, selectedNetworks])

  const handleBoundsChange = useCallback((bounds: AirQualityMapBounds) => {
    setMapBounds(bounds)
  }, [])

  return (
    <div className="relative flex h-full w-full bg-slate-100 dark:bg-slate-950">
      {showSidebar && (
        <AirQualitySidebar
          monitors={monitors}
          filteredMonitors={visibleMonitorsInView}
          visibleMonitorCount={visibleMonitorsInView.length}
          totalMonitorCount={totalMonitorsInView.length}
          selectedMonitor={selectedMonitor}
          selectedNetworks={selectedNetworks}
          searchQuery={searchQuery}
          showHeatmap={showHeatmap}
          loading={loading}
          error={error}
          onSearchQueryChange={setSearchQuery}
          onToggleHeatmap={() => setShowHeatmap((prev) => !prev)}
          onToggleNetwork={toggleNetwork}
          onSelectAllNetworks={() => setSelectedNetworks(allNetworks)}
          onClearNetworks={() => setSelectedNetworks([])}
          onMonitorClick={setSelectedMonitor}
          onClearSelection={() => setSelectedMonitor(null)}
        />
      )}

      <button
        onClick={() => setShowSidebar(!showSidebar)}
        aria-label={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
        className={`absolute top-6 z-20 flex h-10 w-8 items-center justify-center border border-l-0 border-slate-300/80 bg-slate-50/95 text-slate-600 shadow-md backdrop-blur transition-[left,background-color,color,border-color] hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/95 dark:text-slate-200 dark:hover:bg-slate-800 ${
          showSidebar ? 'left-[350px] rounded-r-lg' : 'left-0 rounded-r-lg'
        }`}
      >
        {showSidebar ? (
          <ChevronsLeft className="h-4 w-4" />
        ) : (
          <ChevronsRight className="h-4 w-4" />
        )}
      </button>

      <div className="relative flex-1">
        <AirQualityMap
          monitors={filteredMonitors}
          selectedMonitor={selectedMonitor}
          showHeatmap={showHeatmap}
          onBoundsChange={handleBoundsChange}
          onMonitorClick={setSelectedMonitor}
          onMonitorClear={() => setSelectedMonitor(null)}
        />

        <div className="absolute bottom-6 right-6 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur">
          <h4 className="mb-2 text-xs font-semibold text-foreground">
            {showHeatmap ? 'Heatmap (Monitor Density)' : `Networks (${selectedNetworks.length})`}
          </h4>
          <div className="space-y-1">
            {showHeatmap ? (
              <>
                <div className="h-2 w-40 rounded bg-gradient-to-r from-sky-500 via-green-500 via-60% to-red-500" />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </>
            ) : (
              <>
                {selectedLegendNetworks.map((network) => (
                  <div key={network} className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: getNetworkColor(network) }} />
                    <span className="text-xs text-muted-foreground">{network}</span>
                  </div>
                ))}
                {selectedNetworks.length > selectedLegendNetworks.length && (
                  <div className="pt-1 text-xs text-muted-foreground">
                    +{selectedNetworks.length - selectedLegendNetworks.length} more
                  </div>
                )}
              </>
            )}
            {showHeatmap && (
              <div className="pt-1 text-xs text-muted-foreground">
                Network points are hidden while heatmap is enabled
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
