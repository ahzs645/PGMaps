import { useCallback, useEffect, useMemo, useState } from 'react'
import area from '@turf/area'
import bbox from '@turf/bbox'
import bboxPolygon from '@turf/bbox-polygon'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import convex from '@turf/convex'
import { featureCollection, point } from '@turf/helpers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { AirQualityMap } from './components/AirQualityMap'
import { AirQualitySidebar } from './components/AirQualitySidebar'
import { getNetworkColor } from './constants'
import { useAirQualityData } from './hooks/useAirQualityData'
import { useBoundaryData } from './hooks/useBoundaryData'
import { useCensusBoundaryData } from './hooks/useCensusBoundaryData'
import type {
  AirMonitor,
  BoundaryLevel,
  BoundarySource,
  CensusBoundaryLevel,
  RegionLevel,
  SensorDensityStats
} from './types'
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

const LOW_COST_NETWORKS = new Set(['PA', 'EGG'])
const HEALTH_REGION_LEVEL_OPTIONS: Array<{ value: BoundaryLevel; label: string }> = [
  { value: 'healthAuthority', label: 'Health Authority' },
  { value: 'hsda', label: 'HSDA' },
  { value: 'lha', label: 'LHA' },
  { value: 'chsa', label: 'CHSA' }
]
type BoundaryPickerFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  {
    code: string
    name: string
  }
>

function getMonitorSearchText(monitor: AirMonitor): string {
  return [
    monitor.name,
    monitor.network,
    monitor.city,
    monitor.province,
    monitor.parameters.join(' ')
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function calculateDensityStats(monitors: AirMonitor[], areaKm2: number): SensorDensityStats | null {
  if (!Number.isFinite(areaKm2) || areaKm2 <= 0) return null

  const totalCount = monitors.length
  const lowCostCount = monitors.filter((monitor) => LOW_COST_NETWORKS.has(monitor.network)).length
  const otherCount = totalCount - lowCostCount

  let actualCoverageKm2 = 0
  if (totalCount >= 3) {
    try {
      const points = featureCollection(
        monitors.map((monitor) => point([monitor.longitude, monitor.latitude]))
      )
      const hull = convex(points)
      if (hull) {
        actualCoverageKm2 = area(hull) / 1_000_000
      }
    } catch {
      // Ignore hull failures for sparse/invalid point clusters.
    }
  }

  const boundedCoverageKm2 = Math.min(actualCoverageKm2, areaKm2)

  return {
    lowCost: lowCostCount / areaKm2,
    other: otherCount / areaKm2,
    overall: totalCount / areaKm2,
    areaKm2,
    actualCoverageKm2: boundedCoverageKm2,
    coveragePercent: (boundedCoverageKm2 / areaKm2) * 100,
    totalCount,
    lowCostCount,
    otherCount
  }
}

export default function AirQualitySection() {
  const { monitors, loading, error } = useAirQualityData()
  const healthBoundary = useBoundaryData()
  const censusBoundary = useCensusBoundaryData()
  const {
    selectRegion: selectHealthRegion,
    getFeaturesForLevel: getHealthFeaturesForLevel,
    clearSelection: clearHealthSelection
  } = healthBoundary
  const {
    selectRegion: selectCensusRegion,
    getFeaturesForLevel: getCensusFeaturesForLevel,
    clearSelection: clearCensusSelection
  } = censusBoundary

  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([])
  const [networksInitialized, setNetworksInitialized] = useState(false)
  const [boundarySource, setBoundarySource] = useState<BoundarySource>('bcHealth')
  const [healthRegionLevel, setHealthRegionLevel] = useState<BoundaryLevel>('lha')
  const [censusRegionLevel, setCensusRegionLevel] = useState<CensusBoundaryLevel>('csd')
  const [searchQuery, setSearchQuery] = useState('')
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [selectedMonitor, setSelectedMonitor] = useState<AirMonitor | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [mapBounds, setMapBounds] = useState<AirQualityMapBounds | null>(null)
  const [mapBoundaryPickerEnabled, setMapBoundaryPickerEnabled] = useState(false)
  const [mapBoundaryFeatures, setMapBoundaryFeatures] = useState<BoundaryPickerFeature[]>([])

  const boundaryLoading = boundarySource === 'bcHealth'
    ? healthBoundary.loading
    : censusBoundary.loading

  const boundaryError = boundarySource === 'bcHealth'
    ? healthBoundary.error
    : censusBoundary.error

  const selectedRegion = boundarySource === 'bcHealth'
    ? healthBoundary.selectedRegion
    : censusBoundary.selectedRegion

  const selectedRegionFeature = boundarySource === 'bcHealth'
    ? healthBoundary.selectedRegionFeature
    : censusBoundary.selectedRegionFeature

  const selectedRegionLevel: RegionLevel = boundarySource === 'bcHealth'
    ? healthRegionLevel
    : censusRegionLevel

  const regionLevelOptions = useMemo(() => {
    if (boundarySource === 'bcHealth') {
      return HEALTH_REGION_LEVEL_OPTIONS
    }

    return censusBoundary.levelOptions.map((option) => ({
      value: option.value as RegionLevel,
      label: option.label
    }))
  }, [boundarySource, censusBoundary.levelOptions])

  const regionOptions = useMemo(() => {
    if (boundarySource === 'bcHealth') {
      return healthBoundary.regionsByLevel[healthRegionLevel]
    }
    return censusBoundary.regionsByLevel[censusRegionLevel]
  }, [
    boundarySource,
    censusBoundary.regionsByLevel,
    censusRegionLevel,
    healthBoundary.regionsByLevel,
    healthRegionLevel
  ])

  const mapBoundaryFeatureCollection = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: mapBoundaryFeatures
    } satisfies GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { code: string; name: string }>
  }, [mapBoundaryFeatures])

  const selectedRegionBounds = useMemo(() => {
    if (!selectedRegionFeature) return null
    return bbox(selectedRegionFeature)
  }, [selectedRegionFeature])

  const monitorsInRegionScope = useMemo(() => {
    if (!selectedRegionFeature || !selectedRegionBounds) return monitors

    const [west, south, east, north] = selectedRegionBounds
    return monitors
      .filter((monitor) => (
        monitor.latitude >= south &&
        monitor.latitude <= north &&
        monitor.longitude >= west &&
        monitor.longitude <= east
      ))
      .filter((monitor) => booleanPointInPolygon(
        point([monitor.longitude, monitor.latitude]),
        selectedRegionFeature
      ))
  }, [monitors, selectedRegionBounds, selectedRegionFeature])

  const allNetworks = useMemo(() => {
    return Array.from(new Set(monitorsInRegionScope.map((monitor) => monitor.network))).sort((a, b) => a.localeCompare(b))
  }, [monitorsInRegionScope])

  useEffect(() => {
    if (!networksInitialized && allNetworks.length > 0) {
      setSelectedNetworks(allNetworks)
      setNetworksInitialized(true)
    }
  }, [allNetworks, networksInitialized])

  const filteredMonitors = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return monitorsInRegionScope.filter((monitor) => {
      const matchesNetwork = selectedNetworks.includes(monitor.network)
      const matchesSearch = !normalizedQuery || getMonitorSearchText(monitor).includes(normalizedQuery)
      return matchesNetwork && matchesSearch
    })
  }, [monitorsInRegionScope, searchQuery, selectedNetworks])

  const visibleMonitorsInView = useMemo(() => {
    return filteredMonitors.filter((monitor) => isMonitorInBounds(monitor, mapBounds))
  }, [filteredMonitors, mapBounds])

  const boundsAreaFeature = useMemo(() => {
    if (!mapBounds) return null
    const west = normalizeLongitude(mapBounds.west)
    const east = normalizeLongitude(mapBounds.east)
    if (west > east) return null
    return bboxPolygon([west, mapBounds.south, east, mapBounds.north]) as GeoJSON.Feature<GeoJSON.Polygon>
  }, [mapBounds])

  const densityScopeArea = selectedRegionFeature ?? boundsAreaFeature

  const densityScopeMonitors = useMemo(() => {
    if (selectedRegionFeature) return filteredMonitors
    return visibleMonitorsInView
  }, [filteredMonitors, selectedRegionFeature, visibleMonitorsInView])

  const densityStats = useMemo(() => {
    if (!densityScopeArea) return null
    const areaKm2 = area(densityScopeArea) / 1_000_000
    return calculateDensityStats(densityScopeMonitors, areaKm2)
  }, [densityScopeArea, densityScopeMonitors])

  const densityScopeLabel = selectedRegion
    ? `${selectedRegion.levelLabel}: ${selectedRegion.name}`
    : 'Current map view'

  useEffect(() => {
    let cancelled = false

    const loadMapBoundaries = async () => {
      if (!mapBoundaryPickerEnabled) {
        setMapBoundaryFeatures([])
        return
      }

      const rawFeatures = boundarySource === 'bcHealth'
        ? await getHealthFeaturesForLevel(healthRegionLevel)
        : await getCensusFeaturesForLevel(censusRegionLevel)

      if (cancelled) return

      const normalized = rawFeatures
        .map((feature) => {
          const properties = (feature.properties ?? {}) as Record<string, unknown>
          const code = String(properties.code ?? properties.id ?? '').trim()
          if (!code) return null

          const name = String(properties.name ?? code).trim() || code
          return {
            type: 'Feature',
            geometry: feature.geometry,
            properties: {
              code,
              name
            }
          } satisfies BoundaryPickerFeature
        })
        .filter((feature): feature is BoundaryPickerFeature => Boolean(feature))

      setMapBoundaryFeatures(normalized)
    }

    void loadMapBoundaries()

    return () => {
      cancelled = true
    }
  }, [
    boundarySource,
    censusRegionLevel,
    getCensusFeaturesForLevel,
    getHealthFeaturesForLevel,
    healthRegionLevel,
    mapBoundaryPickerEnabled
  ])

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

  const handleRegionLevelChange = useCallback((level: RegionLevel) => {
    if (boundarySource === 'bcHealth') {
      setHealthRegionLevel(level as BoundaryLevel)
      return
    }

    setCensusRegionLevel(level as CensusBoundaryLevel)
  }, [boundarySource])

  const handleRegionSelect = useCallback((level: RegionLevel, code: string) => {
    if (boundarySource === 'bcHealth') {
      void selectHealthRegion(level as BoundaryLevel, code)
      setMapBoundaryPickerEnabled(false)
      return
    }

    void selectCensusRegion(level as CensusBoundaryLevel, code)
    setMapBoundaryPickerEnabled(false)
  }, [boundarySource, selectCensusRegion, selectHealthRegion])

  const handleMapBoundarySelect = useCallback((code: string) => {
    if (boundarySource === 'bcHealth') {
      void selectHealthRegion(healthRegionLevel, code)
      setMapBoundaryPickerEnabled(false)
      return
    }

    void selectCensusRegion(censusRegionLevel, code)
    setMapBoundaryPickerEnabled(false)
  }, [boundarySource, censusRegionLevel, healthRegionLevel, selectCensusRegion, selectHealthRegion])

  const handleRegionClear = useCallback(() => {
    if (boundarySource === 'bcHealth') {
      clearHealthSelection()
      return
    }

    clearCensusSelection()
  }, [boundarySource, clearCensusSelection, clearHealthSelection])

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      sidebar={(
        <AirQualitySidebar
          className="h-full w-full border-0 shadow-none md:w-[350px] md:border-r md:shadow-xl"
          monitors={monitors}
          filteredMonitors={visibleMonitorsInView}
          visibleMonitorCount={visibleMonitorsInView.length}
          selectedMonitor={selectedMonitor}
          selectedNetworks={selectedNetworks}
          boundarySource={boundarySource}
          selectedRegion={selectedRegion}
          selectedRegionLevel={selectedRegionLevel}
          regionLevelOptions={regionLevelOptions}
          regionOptions={regionOptions}
          boundaryLoading={boundaryLoading}
          boundaryError={boundaryError}
          densityStats={densityStats}
          densityScopeLabel={densityScopeLabel}
          searchQuery={searchQuery}
          showHeatmap={showHeatmap}
          loading={loading}
          error={error}
          onBoundarySourceChange={setBoundarySource}
          onRegionLevelChange={handleRegionLevelChange}
          onRegionSelect={handleRegionSelect}
          onRegionClear={handleRegionClear}
          onSearchQueryChange={setSearchQuery}
          onToggleHeatmap={() => setShowHeatmap((prev) => !prev)}
          onToggleNetwork={toggleNetwork}
          onSelectAllNetworks={() => setSelectedNetworks(allNetworks)}
          onClearNetworks={() => setSelectedNetworks([])}
          mapBoundaryPickerEnabled={mapBoundaryPickerEnabled}
          onMapBoundaryPickerChange={setMapBoundaryPickerEnabled}
          onMonitorClick={setSelectedMonitor}
          onClearSelection={() => setSelectedMonitor(null)}
        />
      )}
    >
      <div className="relative h-full">
        <AirQualityMap
          monitors={filteredMonitors}
          selectedMonitor={selectedMonitor}
          selectedRegionFeature={selectedRegionFeature}
          browseBoundaryFeatures={mapBoundaryFeatureCollection}
          browseBoundariesVisible={mapBoundaryPickerEnabled && !showHeatmap}
          selectedBrowseBoundaryCode={
            selectedRegion?.source === boundarySource && selectedRegion?.level === selectedRegionLevel
              ? selectedRegion.code
              : null
          }
          showHeatmap={showHeatmap}
          onBoundsChange={handleBoundsChange}
          onMonitorClick={setSelectedMonitor}
          onBrowseBoundaryClick={(feature) => handleMapBoundarySelect(feature.code)}
          onMonitorClear={() => setSelectedMonitor(null)}
        />

        <div className="absolute bottom-36 right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
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
    </MapSectionLayout>
  )
}
