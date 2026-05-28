import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import area from '@turf/area'
import bbox from '@turf/bbox'
import bboxPolygon from '@turf/bbox-polygon'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import convex from '@turf/convex'
import { featureCollection, point } from '@turf/helpers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { LegendItem, MapGradientLegendItem, MapLegendPanel, MapLegendSection } from '@/components/ui/map-panels'
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
  AirQualityBoundaryColorMetric,
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
    lowCostDensity: number
    otherDensity: number
    overallDensity: number
    correctedPm25Average: number | null
    rawPm25Average: number | null
    networkCount: number
    colorValue: number | null
    hasColorValue: boolean
  }
>

interface BoundaryLegendStats {
  areaCount: number
  monitoredAreaCount: number
  totalMonitors: number
  maxColorValue: number
}

interface BoundaryRegionStats {
  monitorCount: number
  lowCostCount: number
  otherCount: number
  areaKm2: number
  lowCostDensity: number
  otherDensity: number
  overallDensity: number
  rawPm25Average: number | null
  correctedPm25Average: number | null
  networkCount: number
}

function isBoundarySource(value: string | null): value is BoundarySource {
  return (
    value === 'bcHealth' ||
    value === 'regionalDistrict' ||
    value === 'census' ||
    value === 'cityPG' ||
    value === 'watershed' ||
    value === 'nrAdmin' ||
    value === 'uwr'
  )
}

function isBoundaryColorMetric(value: string | null): value is AirQualityBoundaryColorMetric {
  return (
    value === 'sensorCount' ||
    value === 'overallDensity' ||
    value === 'lowCostDensity' ||
    value === 'otherDensity' ||
    value === 'correctedPm25' ||
    value === 'rawPm25' ||
    value === 'networkCount'
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

function createEmptyBoundaryStats(areaKm2: number): BoundaryRegionStats {
  return {
    monitorCount: 0,
    lowCostCount: 0,
    otherCount: 0,
    areaKm2,
    lowCostDensity: 0,
    otherDensity: 0,
    overallDensity: 0,
    rawPm25Average: null,
    correctedPm25Average: null,
    networkCount: 0,
  }
}

function getBoundaryColorValue(
  stats: BoundaryRegionStats,
  metric: AirQualityBoundaryColorMetric
): number | null {
  switch (metric) {
    case 'sensorCount':
      return stats.monitorCount
    case 'overallDensity':
      return stats.overallDensity
    case 'lowCostDensity':
      return stats.lowCostDensity
    case 'otherDensity':
      return stats.otherDensity
    case 'correctedPm25':
      return stats.correctedPm25Average
    case 'rawPm25':
      return stats.rawPm25Average
    case 'networkCount':
      return stats.networkCount
  }
}

function getBoundaryMetricLabel(metric: AirQualityBoundaryColorMetric): string {
  switch (metric) {
    case 'sensorCount':
      return 'Total sensors'
    case 'overallDensity':
      return 'Sensors per km²'
    case 'lowCostDensity':
      return 'Low-cost sensors per km²'
    case 'otherDensity':
      return 'Other sensors per km²'
    case 'correctedPm25':
      return 'Corrected PM2.5'
    case 'rawPm25':
      return 'Raw PM2.5'
    case 'networkCount':
      return 'Networks'
  }
}

function formatBoundaryMetricValue(value: number, metric: AirQualityBoundaryColorMetric): string {
  if (!Number.isFinite(value)) return 'No data'
  switch (metric) {
    case 'sensorCount':
    case 'networkCount':
      return Math.round(value).toLocaleString()
    case 'overallDensity':
    case 'lowCostDensity':
    case 'otherDensity':
      return value > 0 ? `1 per ${(1 / value).toFixed(1)} km²` : '0'
    case 'correctedPm25':
    case 'rawPm25':
      return `${value.toFixed(1)} ug/m3`
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
  const [showBoundaries, setShowBoundaries] = useState(() => (
    searchParams.get('boundaries') === '1' ||
    searchParams.has('src') ||
    searchParams.has('level') ||
    searchParams.has('region')
  ))
  const [basemap, setBasemap] = useState<AirQualityBasemap>(() => (searchParams.get('basemap') as AirQualityBasemap) || 'light')
  const [correctionModel, setCorrectionModel] = useState<AirQualityCorrectionModel>(() => (searchParams.get('model') as AirQualityCorrectionModel) || 'epaBarkjohn')
  const [boundaryColorMetric, setBoundaryColorMetric] = useState<AirQualityBoundaryColorMetric>(() => {
    const candidate = searchParams.get('poly')
    return isBoundaryColorMetric(candidate) ? candidate : 'sensorCount'
  })
  const [observationLayers, setObservationLayers] = useState<AirQualityObservationLayer[]>(DEFAULT_OBSERVATION_LAYERS)
  const [selectedMonitor, setSelectedMonitor] = useState<AirMonitor | null>(null)
  const [showSidebar, setShowSidebar] = useState(true)
  const [mapBounds, setMapBounds] = useState<AirQualityMapBounds | null>(null)
  const closedMonitorIdRef = useRef<string | null>(null)
  const suppressUrlSyncUntilRef = useRef(0)

  const {
    regions: studyAreaRegions,
    loading: boundaryLoading,
    error: boundaryError,
  } = useStudyAreaRegions(boundarySource, selectedRegionLevel)

  const activeStudyAreaRegions = useMemo(
    () => (showBoundaries ? studyAreaRegions : []),
    [showBoundaries, studyAreaRegions]
  )

  const selectedStudyAreaRegion = useMemo(() => {
    if (!selectedRegionCode) return null
    return activeStudyAreaRegions.find((region) => region.code === selectedRegionCode) ?? null
  }, [activeStudyAreaRegions, selectedRegionCode])

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
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href]')
      if (!(link instanceof HTMLAnchorElement)) return
      const url = new URL(link.href, window.location.href)
      if (url.origin === window.location.origin && url.pathname !== '/airquality') {
        suppressUrlSyncUntilRef.current = Date.now() + 1000
      }
    }

    document.addEventListener('click', handleDocumentClick, true)
    return () => document.removeEventListener('click', handleDocumentClick, true)
  }, [])

  useEffect(() => {
    if (Date.now() < suppressUrlSyncUntilRef.current) return
    if (typeof window !== 'undefined' && window.location.pathname !== '/airquality') return

    const params = new URLSearchParams(searchParams)
    if (boundarySource !== 'bcHealth') params.set('src', boundarySource)
    else params.delete('src')
    if (showBoundaries) params.set('level', selectedRegionLevel)
    else params.delete('level')
    if (showBoundaries) params.set('boundaries', '1')
    else params.delete('boundaries')
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
    if (boundaryColorMetric !== 'sensorCount') params.set('poly', boundaryColorMetric)
    else params.delete('poly')
    if (selectedMonitor) {
      params.set('monitor', selectedMonitor.id)
    } else if (closedMonitorIdRef.current === params.get('monitor')) {
      params.delete('monitor')
    }
    if (showBoundaries && selectedRegionCode) params.set('region', selectedRegionCode)
    else params.delete('region')
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [basemap, boundaryColorMetric, boundarySource, correctionModel, searchParams, searchQuery, selectedMonitor, selectedRegionCode, selectedRegionLevel, setSearchParams, showBoundaries, showHeatmap, showPoints])

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
    if (activeStudyAreaRegions.length === 0) return null
    return {
      type: 'FeatureCollection',
      features: activeStudyAreaRegions.map((region) => region.feature),
    }
  }, [activeStudyAreaRegions])

  const boundaryScopeBounds = useMemo<[number, number, number, number] | null>(() => {
    if (activeStudyAreaRegions.length === 0) return null
    return activeStudyAreaRegions.reduce<[number, number, number, number]>(
      (bounds, region) => [
        Math.min(bounds[0], region.bounds[0]),
        Math.min(bounds[1], region.bounds[1]),
        Math.max(bounds[2], region.bounds[2]),
        Math.max(bounds[3], region.bounds[3]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity]
    )
  }, [activeStudyAreaRegions])

  const monitorsInRegionScope = useMemo(() => {
    if (selectedRegionFeature && selectedRegionBounds) {
      return monitors
        .filter((monitor) => isMonitorInFeatureBounds(monitor, selectedRegionBounds))
        .filter((monitor) => isMonitorInRegionFeature(monitor, selectedRegionFeature))
    }

    if (activeStudyAreaRegions.length > 0 && boundaryScopeBounds) {
      return monitors
        .filter((monitor) => isMonitorInFeatureBounds(monitor, boundaryScopeBounds))
        .filter((monitor) => activeStudyAreaRegions.some((region) => (
          isMonitorInFeatureBounds(monitor, region.bounds) &&
          isMonitorInRegionFeature(monitor, region.feature)
        )))
    }

    return monitors
  }, [activeStudyAreaRegions, boundaryScopeBounds, monitors, selectedRegionBounds, selectedRegionFeature])

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

  const boundaryStatsByCode = useMemo(() => {
    const statsByCode = new Map<string, BoundaryRegionStats>()
    const rawValuesByCode = new Map<string, number[]>()
    const correctedValuesByCode = new Map<string, number[]>()
    const networksByCode = new Map<string, Set<string>>()

    activeStudyAreaRegions.forEach((region) => {
      statsByCode.set(region.code, createEmptyBoundaryStats(region.areaKm2))
      rawValuesByCode.set(region.code, [])
      correctedValuesByCode.set(region.code, [])
      networksByCode.set(region.code, new Set<string>())
    })
    if (activeStudyAreaRegions.length === 0 || !boundaryScopeBounds) return statsByCode

    boundaryFilteredMonitors
      .filter((monitor) => isMonitorInFeatureBounds(monitor, boundaryScopeBounds))
      .forEach((monitor) => {
        const region = activeStudyAreaRegions.find((candidate) => (
          isMonitorInFeatureBounds(monitor, candidate.bounds) &&
          isMonitorInRegionFeature(monitor, candidate.feature)
        ))
        if (region) {
          const stats = statsByCode.get(region.code)
          if (!stats) return

          const correction = calculateCorrectedPm25(monitor, correctionModel)
          stats.monitorCount += 1
          if (LOW_COST_NETWORKS.has(monitor.network)) stats.lowCostCount += 1
          else stats.otherCount += 1
          if (correction.rawPm25 !== null) rawValuesByCode.get(region.code)?.push(correction.rawPm25)
          if (correction.correctedPm25 !== null) correctedValuesByCode.get(region.code)?.push(correction.correctedPm25)
          networksByCode.get(region.code)?.add(monitor.network)
        }
      })

    statsByCode.forEach((stats, code) => {
      stats.lowCostDensity = stats.areaKm2 > 0 ? stats.lowCostCount / stats.areaKm2 : 0
      stats.otherDensity = stats.areaKm2 > 0 ? stats.otherCount / stats.areaKm2 : 0
      stats.overallDensity = stats.areaKm2 > 0 ? stats.monitorCount / stats.areaKm2 : 0
      stats.rawPm25Average = average(rawValuesByCode.get(code) ?? [])
      stats.correctedPm25Average = average(correctedValuesByCode.get(code) ?? [])
      stats.networkCount = networksByCode.get(code)?.size ?? 0
    })

    return statsByCode
  }, [activeStudyAreaRegions, boundaryFilteredMonitors, boundaryScopeBounds, correctionModel])

  const boundaryLegendStats = useMemo<BoundaryLegendStats | null>(() => {
    if (activeStudyAreaRegions.length === 0) return null
    const stats = activeStudyAreaRegions.map((region) => boundaryStatsByCode.get(region.code) ?? createEmptyBoundaryStats(region.areaKm2))
    const colorValues = stats
      .map((item) => getBoundaryColorValue(item, boundaryColorMetric))
      .filter((value): value is number => value !== null && Number.isFinite(value))
    return {
      areaCount: activeStudyAreaRegions.length,
      monitoredAreaCount: stats.filter((item) => item.monitorCount > 0).length,
      totalMonitors: stats.reduce((sum, item) => sum + item.monitorCount, 0),
      maxColorValue: Math.max(0, ...colorValues),
    }
  }, [activeStudyAreaRegions, boundaryColorMetric, boundaryStatsByCode])

  const mapBoundaryFeatures = useMemo<BoundaryPickerFeature[]>(() => {
    return activeStudyAreaRegions.map((region) => {
      const stats = boundaryStatsByCode.get(region.code) ?? createEmptyBoundaryStats(region.areaKm2)
      const colorValue = getBoundaryColorValue(stats, boundaryColorMetric)
      const hasColorValue = colorValue !== null && Number.isFinite(colorValue)
      return {
        type: 'Feature',
        geometry: region.feature.geometry,
        properties: {
          code: region.code,
          name: region.name,
          monitorCount: stats.monitorCount,
          lowCostDensity: stats.lowCostDensity,
          otherDensity: stats.otherDensity,
          overallDensity: stats.overallDensity,
          correctedPm25Average: stats.correctedPm25Average,
          rawPm25Average: stats.rawPm25Average,
          networkCount: stats.networkCount,
          colorValue,
          hasColorValue,
        },
      }
    })
  }, [activeStudyAreaRegions, boundaryColorMetric, boundaryStatsByCode])

  const mapBoundaryFeatureCollection = useMemo(() => {
    return {
      type: 'FeatureCollection',
      features: mapBoundaryFeatures
    } satisfies GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, BoundaryPickerFeature['properties']>
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
      return activeStudyAreaRegions.reduce((sum, region) => sum + region.areaKm2, 0)
    }
    if (boundsAreaFeature) return area(boundsAreaFeature) / 1_000_000
    return null
  }, [activeStudyAreaRegions, boundaryScopeFeature, boundsAreaFeature, selectedRegionFeature])

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
      closedMonitorIdRef.current = selectedMonitor.id
      setSelectedMonitor(null)

      const params = new URLSearchParams(searchParams)
      if (params.get('monitor') === selectedMonitor.id) {
        params.delete('monitor')
        setSearchParams(params, { replace: true })
      }
    }
  }, [filteredMonitors, searchParams, selectedMonitor, setSearchParams])

  useEffect(() => {
    const monitorId = searchParams.get('monitor')
    if (!monitorId || selectedMonitor) return
    if (closedMonitorIdRef.current === monitorId) return
    const monitor = monitors.find((item) => item.id === monitorId)
    if (monitor) setSelectedMonitor(monitor)
  }, [monitors, searchParams, selectedMonitor])

  useEffect(() => {
    if (!searchParams.get('monitor')) {
      closedMonitorIdRef.current = null
    }
  }, [searchParams])

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

  const legendNetworkRows = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    const counts = new Map<string, number>()
    monitorsInRegionScope
      .filter((monitor) => monitorMatchesObservationLayers(monitor, observationLayers))
      .filter((monitor) => !normalizedQuery || getMonitorSearchText(monitor).includes(normalizedQuery))
      .filter((monitor) => isMonitorInBounds(monitor, mapBounds))
      .forEach((monitor) => {
        counts.set(monitor.network, (counts.get(monitor.network) ?? 0) + 1)
      })

    return Array.from(counts.entries())
      .map(([network, count]) => ({
        network,
        count,
        active: selectedNetworks.includes(network),
      }))
      .sort((a, b) => b.count - a.count || a.network.localeCompare(b.network))
  }, [mapBounds, monitorsInRegionScope, observationLayers, searchQuery, selectedNetworks])
  const showLegend = Boolean(boundaryLegendStats) || showHeatmap || showPoints

  const selectLegendNetworks = useCallback(() => {
    setSelectedNetworks((current) => Array.from(new Set([...current, ...legendNetworkRows.map((row) => row.network)])))
  }, [legendNetworkRows])

  const clearLegendNetworks = useCallback(() => {
    const legendNetworks = new Set(legendNetworkRows.map((row) => row.network))
    setSelectedNetworks((current) => current.filter((network) => !legendNetworks.has(network)))
  }, [legendNetworkRows])

  const handleBoundsChange = useCallback((bounds: AirQualityMapBounds) => {
    setMapBounds(bounds)
  }, [])

  const handleMonitorClear = useCallback(() => {
    closedMonitorIdRef.current = selectedMonitor?.id ?? null
    setSelectedMonitor(null)
    const params = new URLSearchParams(searchParams)
    params.delete('monitor')
    setSearchParams(params, { replace: true })
  }, [searchParams, selectedMonitor, setSearchParams])

  const handleRegionLevelChange = useCallback((level: RegionLevel) => {
    setShowBoundaries(true)
    setSelectedRegionLevel(level)
    setSelectedRegionCode(null)
  }, [])

  const handleBoundarySourceChange = useCallback((source: BoundarySource) => {
    setShowBoundaries(true)
    setBoundarySource(source)
    setSelectedRegionLevel((current) => (
      isValidLevelForSource(source, current) ? current : getDefaultLevelForSource(source)
    ))
    setSelectedRegionCode(null)
  }, [])

  const handleClearBoundaries = useCallback(() => {
    setShowBoundaries(false)
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
      showMobilePeek={false}
      sidebar={(
        <AirQualitySidebar
          className="h-full w-full border-0 shadow-none md:w-[350px] md:border-r md:shadow-xl"
          monitors={monitorsInRegionScope}
          filteredMonitors={sidebarMonitors}
          visibleMonitorCount={sidebarMonitors.length}
          visibleMonitorCountLabel={sidebarMonitorCountLabel}
          selectedMonitor={selectedMonitor}
          selectedNetworks={selectedNetworks}
          boundariesVisible={showBoundaries}
          boundarySource={boundarySource}
          selectedRegionLevel={selectedRegionLevel}
          regionLevelOptions={regionLevelOptions}
          boundaryLoading={showBoundaries && boundaryLoading}
          boundaryError={showBoundaries ? boundaryError : null}
          densityStats={densityStats}
          areaStats={areaStats}
          densityScopeLabel={densityScopeLabel}
          searchQuery={searchQuery}
          showHeatmap={showHeatmap}
          showPoints={showPoints}
          basemap={basemap}
          boundaryColorMetric={boundaryColorMetric}
          correctionModel={correctionModel}
          observationLayers={observationLayers}
          loading={loading}
          error={error}
          onBasemapChange={setBasemap}
          onBoundaryColorMetricChange={setBoundaryColorMetric}
          onCorrectionModelChange={setCorrectionModel}
          onToggleObservationLayer={toggleObservationLayer}
          onBoundarySourceChange={handleBoundarySourceChange}
          onClearBoundaries={handleClearBoundaries}
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
          browseBoundaryColorMetric={boundaryColorMetric}
          maxBrowseBoundaryColorValue={boundaryLegendStats?.maxColorValue ?? 0}
          showHeatmap={showHeatmap}
          showPoints={showPoints}
          basemap={basemap}
          correctionModel={correctionModel}
          loading={loading || (showBoundaries && boundaryLoading)}
          onBoundsChange={handleBoundsChange}
          onMonitorClick={setSelectedMonitor}
          onBrowseBoundaryClick={handleBrowseBoundaryClick}
          onMonitorClear={handleMonitorClear}
        />

        {showLegend && (
          <MapLegendPanel className="max-w-[240px]" title="Legend" collapsible contentClassName="space-y-3">
            <div className="space-y-3">
              {boundaryLegendStats && (
                <MapLegendSection
                  title={`${REGION_LEVEL_LABELS[selectedRegionLevel] ?? 'Study'} areas`}
                  value={boundaryLegendStats.areaCount.toLocaleString()}
                >
                  <MapGradientLegendItem
                    colors={boundaryColorMetric === 'correctedPm25' || boundaryColorMetric === 'rawPm25'
                      ? ['#dcfce7', '#fde047', '#fb923c', '#b91c1c']
                      : ['#e0f2fe', '#7dd3fc', '#0ea5e9', '#0369a1']}
                    minLabel={getBoundaryMetricLabel(boundaryColorMetric)}
                    maxLabel={`${formatBoundaryMetricValue(boundaryLegendStats.maxColorValue, boundaryColorMetric)} max`}
                  />
                  <div className="pt-1 text-xs text-muted-foreground">
                    {boundaryLegendStats.monitoredAreaCount.toLocaleString()} of {boundaryLegendStats.areaCount.toLocaleString()} areas have monitors
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {boundaryLegendStats.totalMonitors.toLocaleString()} monitors in study area
                  </div>
                </MapLegendSection>
              )}

              {showHeatmap && (
                <MapLegendSection title="Heatmap" className="border-t border-border pt-3 first:border-t-0 first:pt-0">
                  <MapGradientLegendItem colors={['#0ea5e9', '#22c55e', '#ef4444']} minLabel="Low" maxLabel="High" />
                </MapLegendSection>
              )}

              {showPoints && (
                <MapLegendSection
                  title="Networks in view"
                  value={legendNetworkRows.length.toLocaleString()}
                  actions={legendNetworkRows.length > 0 ? (
                    <>
                      <button
                        type="button"
                        onClick={selectLegendNetworks}
                        className="font-medium text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300"
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={clearLegendNetworks}
                        className="font-medium text-muted-foreground hover:text-foreground"
                      >
                        None
                      </button>
                    </>
                  ) : null}
                  className="border-t border-border pt-3 first:border-t-0 first:pt-0"
                >
                  {legendNetworkRows.length > 0 ? (
                    <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
                      {legendNetworkRows.map((row) => (
                        <LegendItem
                          key={row.network}
                          color={getNetworkColor(row.network)}
                          label={row.network}
                          value={row.count.toLocaleString()}
                          active={row.active}
                          onClick={() => toggleNetwork(row.network)}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">No visible network points</div>
                  )}
                </MapLegendSection>
              )}
            </div>
          </MapLegendPanel>
        )}
      </div>
    </MapSectionLayout>
  )
}
