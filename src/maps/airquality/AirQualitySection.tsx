import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
import { calculateCorrectedPm25 } from './lib/corrections'
import {
  getDefaultLevelForSource,
  getLevelOptionsForSource,
  isValidLevelForSource,
  useStudyAreaRegions,
} from '@/lib/studyArea'
import type {
  AirMonitor,
  AirQualityAreaStats,
  AirQualityBasemap,
  AirQualityCorrectionModel,
  AirQualityObservationLayer,
  BoundarySource,
  RegionLevel,
  SelectedBoundaryRegion,
  SensorDensityStats,
} from './types'
import type { AirQualityMapBounds } from './components/AirQualityMap'

const REGION_LEVEL_LABELS: Record<RegionLevel, string> = {
  healthAuthority: 'Health Authority',
  hsda: 'Health Service Delivery Area',
  lha: 'Local Health Area',
  chsa: 'Community Health Service Area',
  regionalDistrict: 'Regional District',
  cd: 'Census Division',
  csd: 'Census Subdivision',
  ct: 'Census Tract',
  da: 'Dissemination Area',
  elementarySchoolCatchment: 'Elementary School Catchment',
  secondarySchoolCatchment: 'Secondary School Catchment',
  majorWatershed: 'Major River Basin',
  watershedGroup: 'Watershed Group',
  assessmentWatershed: 'Assessment Watershed',
  nrArea: 'NR Area',
  nrRegion: 'NR Region',
  nrDistrict: 'NR District',
  ungulateWinterRange: 'Ungulate Winter Range',
  crownTenure: 'Crown Tenure',
  rangeTenurePolygon: 'Range Tenure',
  rangePasture: 'Range Pasture',
  mineralTenure: 'Mineral / Placer / Coal Tenure',
}

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
const DEFAULT_OBSERVATION_LAYERS: AirQualityObservationLayer[] = [
  'rawPA',
  'correctedPA',
  'rawEGG',
  'correctedEGG',
  'agencyFEM'
]
type BoundaryPickerFeature = GeoJSON.Feature<
  GeoJSON.Polygon | GeoJSON.MultiPolygon,
  {
    code: string
    name: string
    monitorCount: number
  }
>

interface BoundaryLegendStats {
  areaCount: number
  monitoredAreaCount: number
  totalMonitors: number
  maxMonitorCount: number
}

function isBoundarySource(value: string | null): value is BoundarySource {
  return (
    value === 'bcHealth' ||
    value === 'regionalDistrict' ||
    value === 'census' ||
    value === 'cityPG' ||
    value === 'watershed'
  )
}

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

function monitorMatchesObservationLayers(
  monitor: AirMonitor,
  observationLayers: AirQualityObservationLayer[]
): boolean {
  if (monitor.network === 'PA') {
    return observationLayers.includes('rawPA') || observationLayers.includes('correctedPA')
  }

  if (monitor.network === 'EGG') {
    return observationLayers.includes('rawEGG') || observationLayers.includes('correctedEGG')
  }

  if (monitor.network === 'FEM' || monitor.network === 'BC ENV') {
    return observationLayers.includes('agencyFEM')
  }

  return true
}

function isMonitorInFeatureBounds(monitor: AirMonitor, bounds: [number, number, number, number]): boolean {
  const [west, south, east, north] = bounds
  return (
    monitor.latitude >= south &&
    monitor.latitude <= north &&
    monitor.longitude >= west &&
    monitor.longitude <= east
  )
}

function isMonitorInRegionFeature(
  monitor: AirMonitor,
  feature: GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>
): boolean {
  return booleanPointInPolygon(
    point([monitor.longitude, monitor.latitude]),
    feature
  )
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

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function calculateAreaStats(
  monitors: AirMonitor[],
  correctionModel: AirQualityCorrectionModel
): AirQualityAreaStats {
  const rawValues: number[] = []
  const correctedValues: number[] = []

  monitors.forEach((monitor) => {
    const correction = calculateCorrectedPm25(monitor, correctionModel)
    if (correction.rawPm25 !== null) rawValues.push(correction.rawPm25)
    if (correction.correctedPm25 !== null) correctedValues.push(correction.correctedPm25)
  })

  return {
    monitorCount: monitors.length,
    pm25MonitorCount: correctedValues.length,
    rawPm25Average: average(rawValues),
    correctedPm25Average: average(correctedValues),
    correctedPm25Min: correctedValues.length ? Math.min(...correctedValues) : null,
    correctedPm25Max: correctedValues.length ? Math.max(...correctedValues) : null,
    networkCount: new Set(monitors.map((monitor) => monitor.network)).size,
  }
}

export default function AirQualitySection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { monitors, loading, error } = useAirQualityData()

  const initialBoundarySource: BoundarySource = (() => {
    const candidate = searchParams.get('src')
    return isBoundarySource(candidate) ? candidate : 'bcHealth'
  })()
  const initialBoundaryLevel: RegionLevel = (() => {
    const candidate = searchParams.get('level') as RegionLevel | null
    if (candidate && isValidLevelForSource(initialBoundarySource, candidate)) return candidate
    if (initialBoundarySource === 'bcHealth') return 'lha'
    if (initialBoundarySource === 'census') return 'da'
    return getDefaultLevelForSource(initialBoundarySource)
  })()

  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([])
  const [networksInitialized, setNetworksInitialized] = useState(false)
  const [boundarySource, setBoundarySource] = useState<BoundarySource>(initialBoundarySource)
  const [selectedRegionLevel, setSelectedRegionLevel] = useState<RegionLevel>(initialBoundaryLevel)
  const [selectedRegionCode, setSelectedRegionCode] = useState<string | null>(() => searchParams.get('region'))
  const [searchQuery, setSearchQuery] = useState(() => searchParams.get('q') || '')
  const [showHeatmap, setShowHeatmap] = useState(() => searchParams.get('heatmap') === '1')
  const [showPoints, setShowPoints] = useState(() => searchParams.get('points') !== '0')
  const [basemap, setBasemap] = useState<AirQualityBasemap>(() => (searchParams.get('basemap') as AirQualityBasemap) || 'light')
  const [correctionModel, setCorrectionModel] = useState<AirQualityCorrectionModel>(() => (searchParams.get('model') as AirQualityCorrectionModel) || 'epaBarkjohn')
  const [observationLayers, setObservationLayers] = useState<AirQualityObservationLayer[]>(DEFAULT_OBSERVATION_LAYERS)
  const [selectedMonitor, setSelectedMonitor] = useState<AirMonitor | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [mapBounds, setMapBounds] = useState<AirQualityMapBounds | null>(null)

  const {
    regions: studyAreaRegions,
    loading: boundaryLoading,
    error: boundaryError,
  } = useStudyAreaRegions(boundarySource, selectedRegionLevel)

  const selectedStudyAreaRegion = useMemo(() => {
    if (!selectedRegionCode) return null
    return studyAreaRegions.find((region) => region.code === selectedRegionCode) ?? null
  }, [selectedRegionCode, studyAreaRegions])

  const selectedRegionFeature = selectedStudyAreaRegion?.feature ?? null
  const selectedRegion: SelectedBoundaryRegion | null = selectedStudyAreaRegion
    ? {
        source: selectedStudyAreaRegion.source,
        level: selectedStudyAreaRegion.level,
        code: selectedStudyAreaRegion.code,
        name: selectedStudyAreaRegion.name,
        levelLabel: REGION_LEVEL_LABELS[selectedStudyAreaRegion.level] ?? selectedStudyAreaRegion.level,
      }
    : null

  useEffect(() => {
    const params = new URLSearchParams(searchParams)
    if (boundarySource !== 'bcHealth') params.set('src', boundarySource)
    else params.delete('src')
    params.set('level', selectedRegionLevel)
    if (searchQuery.trim()) params.set('q', searchQuery.trim())
    else params.delete('q')
    if (showHeatmap) params.set('heatmap', '1')
    else params.delete('heatmap')
    if (!showPoints) params.set('points', '0')
    else params.delete('points')
    if (basemap !== 'light') params.set('basemap', basemap)
    else params.delete('basemap')
    if (correctionModel !== 'epaBarkjohn') params.set('model', correctionModel)
    else params.delete('model')
    if (selectedMonitor) params.set('monitor', selectedMonitor.id)
    else params.delete('monitor')
    if (selectedRegionCode) params.set('region', selectedRegionCode)
    else params.delete('region')
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [basemap, boundarySource, correctionModel, searchParams, searchQuery, selectedMonitor, selectedRegionCode, selectedRegionLevel, setSearchParams, showHeatmap, showPoints])

  const regionLevelOptions = useMemo(() => {
    return getLevelOptionsForSource(boundarySource).map((option) => ({
      value: option.value as RegionLevel,
      label: option.label,
    }))
  }, [boundarySource])

  const selectedRegionBounds = useMemo(() => {
    if (!selectedRegionFeature) return null
    return bbox(selectedRegionFeature)
  }, [selectedRegionFeature])

  const boundaryScopeFeature = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> | null>(() => {
    if (studyAreaRegions.length === 0) return null
    return {
      type: 'FeatureCollection',
      features: studyAreaRegions.map((region) => region.feature),
    }
  }, [studyAreaRegions])

  const boundaryScopeBounds = useMemo<[number, number, number, number] | null>(() => {
    if (studyAreaRegions.length === 0) return null
    return studyAreaRegions.reduce<[number, number, number, number]>(
      (bounds, region) => [
        Math.min(bounds[0], region.bounds[0]),
        Math.min(bounds[1], region.bounds[1]),
        Math.max(bounds[2], region.bounds[2]),
        Math.max(bounds[3], region.bounds[3]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity]
    )
  }, [studyAreaRegions])

  const monitorsInRegionScope = useMemo(() => {
    if (selectedRegionFeature && selectedRegionBounds) {
      return monitors
        .filter((monitor) => isMonitorInFeatureBounds(monitor, selectedRegionBounds))
        .filter((monitor) => isMonitorInRegionFeature(monitor, selectedRegionFeature))
    }

    if (studyAreaRegions.length > 0 && boundaryScopeBounds) {
      return monitors
        .filter((monitor) => isMonitorInFeatureBounds(monitor, boundaryScopeBounds))
        .filter((monitor) => studyAreaRegions.some((region) => (
          isMonitorInFeatureBounds(monitor, region.bounds) &&
          isMonitorInRegionFeature(monitor, region.feature)
        )))
    }

    return monitors
  }, [boundaryScopeBounds, monitors, selectedRegionBounds, selectedRegionFeature, studyAreaRegions])

  const allNetworks = useMemo(() => {
    return Array.from(new Set(monitorsInRegionScope.map((monitor) => monitor.network))).sort((a, b) => a.localeCompare(b))
  }, [monitorsInRegionScope])

  useEffect(() => {
    if (!networksInitialized && allNetworks.length > 0) {
      setSelectedNetworks(allNetworks)
      setNetworksInitialized(true)
    }
  }, [allNetworks, networksInitialized])

  const boundaryFilteredMonitors = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return monitors.filter((monitor) => {
      const matchesNetwork = selectedNetworks.includes(monitor.network)
      const matchesObservationLayer = monitorMatchesObservationLayers(monitor, observationLayers)
      const matchesSearch = !normalizedQuery || getMonitorSearchText(monitor).includes(normalizedQuery)
      return matchesNetwork && matchesObservationLayer && matchesSearch
    })
  }, [monitors, observationLayers, searchQuery, selectedNetworks])

  const boundaryMonitorCountByCode = useMemo(() => {
    const counts = new Map<string, number>()
    studyAreaRegions.forEach((region) => counts.set(region.code, 0))
    if (studyAreaRegions.length === 0 || !boundaryScopeBounds) return counts

    boundaryFilteredMonitors
      .filter((monitor) => isMonitorInFeatureBounds(monitor, boundaryScopeBounds))
      .forEach((monitor) => {
        const region = studyAreaRegions.find((candidate) => (
          isMonitorInFeatureBounds(monitor, candidate.bounds) &&
          isMonitorInRegionFeature(monitor, candidate.feature)
        ))
        if (region) {
          counts.set(region.code, (counts.get(region.code) ?? 0) + 1)
        }
      })

    return counts
  }, [boundaryFilteredMonitors, boundaryScopeBounds, studyAreaRegions])

  const boundaryLegendStats = useMemo<BoundaryLegendStats | null>(() => {
    if (studyAreaRegions.length === 0) return null
    const counts = studyAreaRegions.map((region) => boundaryMonitorCountByCode.get(region.code) ?? 0)
    return {
      areaCount: studyAreaRegions.length,
      monitoredAreaCount: counts.filter((count) => count > 0).length,
      totalMonitors: counts.reduce((sum, count) => sum + count, 0),
      maxMonitorCount: Math.max(0, ...counts),
    }
  }, [boundaryMonitorCountByCode, studyAreaRegions])

  const mapBoundaryFeatures = useMemo<BoundaryPickerFeature[]>(() => {
    return studyAreaRegions.map((region) => ({
      type: 'Feature',
      geometry: region.feature.geometry,
      properties: {
        code: region.code,
        name: region.name,
        monitorCount: boundaryMonitorCountByCode.get(region.code) ?? 0,
      },
    }))
  }, [boundaryMonitorCountByCode, studyAreaRegions])

  const mapBoundaryFeatureCollection = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: mapBoundaryFeatures
    } satisfies GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { code: string; name: string; monitorCount: number }>
  }, [mapBoundaryFeatures])

  const filteredMonitors = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return monitorsInRegionScope.filter((monitor) => {
      const matchesNetwork = selectedNetworks.includes(monitor.network)
      const matchesObservationLayer = monitorMatchesObservationLayers(monitor, observationLayers)
      const matchesSearch = !normalizedQuery || getMonitorSearchText(monitor).includes(normalizedQuery)
      return matchesNetwork && matchesObservationLayer && matchesSearch
    })
  }, [monitorsInRegionScope, observationLayers, searchQuery, selectedNetworks])

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

  const densityScopeAreaKm2 = useMemo(() => {
    if (selectedRegionFeature) return area(selectedRegionFeature) / 1_000_000
    if (boundaryScopeFeature) {
      return studyAreaRegions.reduce((sum, region) => sum + region.areaKm2, 0)
    }
    if (boundsAreaFeature) return area(boundsAreaFeature) / 1_000_000
    return null
  }, [boundaryScopeFeature, boundsAreaFeature, selectedRegionFeature, studyAreaRegions])

  const densityScopeMonitors = useMemo(() => {
    if (selectedRegionFeature) return filteredMonitors
    if (boundaryScopeFeature) return filteredMonitors
    return visibleMonitorsInView
  }, [boundaryScopeFeature, filteredMonitors, selectedRegionFeature, visibleMonitorsInView])

  const densityStats = useMemo(() => {
    if (densityScopeAreaKm2 === null) return null
    return calculateDensityStats(densityScopeMonitors, densityScopeAreaKm2)
  }, [densityScopeAreaKm2, densityScopeMonitors])

  const areaStats = useMemo(() => {
    return calculateAreaStats(densityScopeMonitors, correctionModel)
  }, [correctionModel, densityScopeMonitors])

  const densityScopeLabel = selectedRegion
    ? `${selectedRegion.levelLabel}: ${selectedRegion.name}`
    : boundaryScopeFeature
      ? `${REGION_LEVEL_LABELS[selectedRegionLevel] ?? selectedRegionLevel} boundaries`
      : 'Current map view'

  const sidebarMonitors = selectedRegion || boundaryScopeFeature ? filteredMonitors : visibleMonitorsInView
  const sidebarMonitorCountLabel = selectedRegion || boundaryScopeFeature ? 'monitors in study area' : 'monitors in view'

  useEffect(() => {
    if (!selectedMonitor) return
    const stillVisible = filteredMonitors.some((monitor) => monitor.id === selectedMonitor.id)
    if (!stillVisible) {
      setSelectedMonitor(null)
    }
  }, [filteredMonitors, selectedMonitor])

  useEffect(() => {
    const monitorId = searchParams.get('monitor')
    if (!monitorId || selectedMonitor) return
    const monitor = monitors.find((item) => item.id === monitorId)
    if (monitor) setSelectedMonitor(monitor)
  }, [monitors, searchParams, selectedMonitor])

  const toggleNetwork = useCallback((network: string) => {
    setSelectedNetworks((current) => {
      if (current.includes(network)) {
        return current.filter((item) => item !== network)
      }
      return [...current, network]
    })
  }, [])

  const toggleObservationLayer = useCallback((layer: AirQualityObservationLayer) => {
    setObservationLayers((current) => {
      if (current.includes(layer)) {
        return current.filter((item) => item !== layer)
      }
      return [...current, layer]
    })
  }, [])

  const visibleLegendNetworks = useMemo(() => {
    return Array.from(new Set(visibleMonitorsInView.map((monitor) => monitor.network)))
      .filter((network) => selectedNetworks.includes(network))
      .sort((a, b) => a.localeCompare(b))
  }, [selectedNetworks, visibleMonitorsInView])

  const handleBoundsChange = useCallback((bounds: AirQualityMapBounds) => {
    setMapBounds(bounds)
  }, [])

  const handleRegionLevelChange = useCallback((level: RegionLevel) => {
    setSelectedRegionLevel(level)
    setSelectedRegionCode(null)
  }, [])

  const handleBoundarySourceChange = useCallback((source: BoundarySource) => {
    setBoundarySource(source)
    setSelectedRegionLevel((current) => (
      isValidLevelForSource(source, current) ? current : getDefaultLevelForSource(source)
    ))
    setSelectedRegionCode(null)
  }, [])

  const handleMapBoundarySelect = useCallback((code: string) => {
    setSelectedRegionCode(code)
  }, [])

  const handleBrowseBoundaryClick = useCallback((feature: { code: string }) => {
    handleMapBoundarySelect(feature.code)
  }, [handleMapBoundarySelect])

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      mobilePeek={(
        <div className="min-w-0 text-left">
          <div className="truncate text-xs font-semibold text-foreground">
            Air Quality | {visibleMonitorsInView.length.toLocaleString()} visible
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {selectedMonitor?.name || selectedRegion?.name || `${selectedNetworks.length} networks`}
          </div>
        </div>
      )}
      sidebar={(
        <AirQualitySidebar
          className="h-full w-full border-0 shadow-none md:w-[350px] md:border-r md:shadow-xl"
          monitors={monitorsInRegionScope}
          filteredMonitors={sidebarMonitors}
          visibleMonitorCount={sidebarMonitors.length}
          visibleMonitorCountLabel={sidebarMonitorCountLabel}
          selectedMonitor={selectedMonitor}
          selectedNetworks={selectedNetworks}
          boundarySource={boundarySource}
          selectedRegionLevel={selectedRegionLevel}
          regionLevelOptions={regionLevelOptions}
          boundaryLoading={boundaryLoading}
          boundaryError={boundaryError}
          densityStats={densityStats}
          areaStats={areaStats}
          densityScopeLabel={densityScopeLabel}
          searchQuery={searchQuery}
          showHeatmap={showHeatmap}
          showPoints={showPoints}
          basemap={basemap}
          correctionModel={correctionModel}
          observationLayers={observationLayers}
          loading={loading}
          error={error}
          onBasemapChange={setBasemap}
          onCorrectionModelChange={setCorrectionModel}
          onToggleObservationLayer={toggleObservationLayer}
          onBoundarySourceChange={handleBoundarySourceChange}
          onRegionLevelChange={handleRegionLevelChange}
          onSearchQueryChange={setSearchQuery}
          onToggleHeatmap={() => setShowHeatmap((prev) => !prev)}
          onTogglePoints={() => setShowPoints((prev) => !prev)}
          onToggleNetwork={toggleNetwork}
          onSelectAllNetworks={() => setSelectedNetworks(allNetworks)}
          onClearNetworks={() => setSelectedNetworks([])}
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
          browseBoundariesVisible={mapBoundaryFeatures.length > 0}
          selectedBrowseBoundaryCode={
            selectedRegion?.source === boundarySource && selectedRegion?.level === selectedRegionLevel
              ? selectedRegion.code
              : null
          }
          maxBrowseBoundaryMonitorCount={boundaryLegendStats?.maxMonitorCount ?? 0}
          showHeatmap={showHeatmap}
          showPoints={showPoints}
          basemap={basemap}
          correctionModel={correctionModel}
          onBoundsChange={handleBoundsChange}
          onMonitorClick={setSelectedMonitor}
          onBrowseBoundaryClick={handleBrowseBoundaryClick}
          onMonitorClear={() => setSelectedMonitor(null)}
        />

        <div className="absolute bottom-36 right-4 z-10 max-w-[240px] rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
          <div className="space-y-3">
            {boundaryLegendStats && (
              <div className="space-y-1">
                <h4 className="text-xs font-semibold text-foreground">
                  {REGION_LEVEL_LABELS[selectedRegionLevel] ?? 'Study'} areas ({boundaryLegendStats.areaCount})
                </h4>
                <div
                  className="h-2 w-40 rounded"
                  style={{
                    background: 'linear-gradient(90deg, #e0f2fe 0%, #7dd3fc 35%, #0ea5e9 70%, #0369a1 100%)',
                  }}
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>0 monitors</span>
                  <span>{boundaryLegendStats.maxMonitorCount.toLocaleString()} max</span>
                </div>
                <div className="pt-1 text-xs text-muted-foreground">
                  {boundaryLegendStats.monitoredAreaCount.toLocaleString()} of {boundaryLegendStats.areaCount.toLocaleString()} areas have monitors
                </div>
                <div className="text-xs text-muted-foreground">
                  {boundaryLegendStats.totalMonitors.toLocaleString()} monitors in study area
                </div>
              </div>
            )}

            {showHeatmap && (
              <div className="space-y-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
                <h4 className="text-xs font-semibold text-foreground">Heatmap</h4>
                <div
                  className="h-2 w-40 rounded"
                  style={{
                    background: 'linear-gradient(90deg, #0ea5e9 0%, #22c55e 60%, #ef4444 100%)',
                  }}
                />
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Low</span>
                  <span>High</span>
                </div>
              </div>
            )}

            {showPoints && (
              <div className="space-y-1 border-t border-border pt-3 first:border-t-0 first:pt-0">
                <h4 className="text-xs font-semibold text-foreground">
                  Networks in view ({visibleLegendNetworks.length})
                </h4>
                {visibleLegendNetworks.length > 0 ? (
                  <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                    {visibleLegendNetworks.map((network) => (
                      <div key={network} className="flex items-center gap-2">
                        <span className="h-3 w-3 rounded-full" style={{ backgroundColor: getNetworkColor(network) }} />
                        <span className="text-xs text-muted-foreground">{network}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground">No visible network points</div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </MapSectionLayout>
  )
}
