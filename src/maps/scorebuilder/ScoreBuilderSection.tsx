import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import {
  useAirQualityData,
  type AirMonitor,
  type BoundaryLevel,
  type BoundarySource,
  type CensusBoundaryLevel,
  type CityBoundaryLevel,
  type RegionLevel,
} from '@/maps/airquality'
import { useCensusData } from '@/maps/census/hooks/useCensusData'
import { useRestaurantData } from '@/maps/foodmap/hooks/useRestaurantData'
import { useParksData } from '@/maps/parks/hooks/useParksData'
import { useBcAssessmentData } from '@/maps/bcassessment/hooks/useBcAssessmentData'
import { useCrimeData } from '@/maps/pgdata/hooks/useCrimeData'
import {
  CENSUS_BOUNDARY_LEVEL_OPTIONS,
  CITY_BOUNDARY_LEVEL_OPTIONS,
  HEALTH_BOUNDARY_LEVEL_OPTIONS,
  SCORE_BUILDER_EXAMPLES,
  SCORE_METRICS,
  createDefaultWeights,
  createMetricValueMap,
  getScorePaletteProfile,
  getScoreDataSourcesForWeights,
  LOW_COST_NETWORKS,
  SCORE_PRESETS,
  encodeWeightsToParams,
  decodeWeightsFromParams,
} from './constants'
import { ScoreBuilderMap } from './components/ScoreBuilderMap'
import { ScoreBuilderRegionInsightDialog } from './components/ScoreBuilderRegionInsightDialog'
import { ScoreBuilderSidebar } from './components/ScoreBuilderSidebar'
import { ScoreBuilderLeftPanel } from './components/ScoreBuilderLeftPanel'
import { ScoreBuilderRightPanel } from './components/ScoreBuilderRightPanel'
import { ScoreBuilderEquationBar } from './components/ScoreBuilderEquationBar'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useScoreBuilderRegions } from './hooks/useScoreBuilderRegions'
import { useHeatShadeData } from './hooks/useHeatShadeData'
import { useTransitData } from './hooks/useTransitData'
import { useCimdData, type CimdRecord } from './hooks/useCimdData'
import { metricToDataSource } from './lib/metrics'
import { getActivePresetKey, scoreDataSourcesEqual, scoreWeightsEqual } from './lib/presets'
import {
  buildMetricRanges,
  buildMetricValueLists,
  clampScore,
  scoreRegionRows,
  type RegionMetricRow,
} from './lib/scoring'
import type {
  RegionDataCounts,
  RobustnessResult,
  ScoredBoundaryRegion,
  ScoreBuilderRegion,
  ScoreComponentSummary,
  ScoreDataSource,
  ScoreBandSummary,
  ScoreFilterKey,
  ScoreFilterState,
  ScoreMetricKey,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
  ScenarioComparison,
} from './types'
import { METRIC_CATEGORY_LABELS } from './types'
import { decodeScoreBuilderShareState, encodeScoreBuilderShareState } from './lib/shareState'

interface MonitorPointRecord {
  monitor: AirMonitor
  feature: GeoJSON.Feature<GeoJSON.Point>
}

interface PointRecord {
  lng: number
  lat: number
  feature: GeoJSON.Feature<GeoJSON.Point>
}

interface PropertyPointRecord extends PointRecord {
  assessedValue: number
  landValue: number
  buildingValue: number
  valueGrowth: number | null
  yearBuilt: number | null
  category: string
  ct: string | null
  da: string | null
}

interface CrimePointRecord extends PointRecord {
  date: Date
  recent: boolean
}

interface TransitPointRecord extends PointRecord {
  accessible: boolean
  hasShelter: boolean
  frequent: boolean
  weekdayTrips: number
  serviceSpanHours: number
}

interface HeatShadeTreePointRecord extends PointRecord {
  mature: boolean
  canopyAreaSqKm: number
}

interface HeatShadeForestRecord extends PointRecord {
  areaSqKm: number
}

interface HeatShadeFacilityPointRecord extends PointRecord {
  kind: 'communityFacility' | 'responseFacility'
}

interface CimdPointRecord extends PointRecord {
  cimd: CimdRecord
}

function getNormalizationLegendText(method: ScoreMethodSettings['normalization']): string {
  if (method === 'percentile') return 'Score uses percentile-normalized indicators within this boundary level.'
  if (method === 'winsorizedMinMax') return 'Score uses winsorized min-max normalization within this boundary level.'
  if (method === 'zScore') return 'Score uses z-score normalized indicators within this boundary level.'
  return 'Score uses min-max normalized indicators within this boundary level.'
}

function computeMedian(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[midpoint]
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2
}

function bboxCenter(geometry: GeoJSON.Geometry): [number, number] | null {
  let minLng = Infinity,
    minLat = Infinity,
    maxLng = -Infinity,
    maxLat = -Infinity
  const scan = (coords: number[][]) => {
    coords.forEach(([lng, lat]) => {
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
    })
  }
  if (geometry.type === 'Point') return geometry.coordinates as [number, number]
  if (geometry.type === 'LineString') scan(geometry.coordinates)
  else if (geometry.type === 'Polygon') geometry.coordinates.forEach(scan)
  else if (geometry.type === 'MultiPolygon') geometry.coordinates.forEach((p) => p.forEach(scan))
  else return null
  if (!Number.isFinite(minLng)) return null
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2]
}

function regionCenter(region: ScoreBuilderRegion): [number, number] {
  return [(region.bounds[0] + region.bounds[2]) / 2, (region.bounds[1] + region.bounds[3]) / 2]
}

function distanceKm(a: [number, number], b: [number, number]): number {
  const toRad = (value: number) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const deltaLat = toRad(b[1] - a[1])
  const deltaLng = toRad(b[0] - a[0])
  const lat1 = toRad(a[1])
  const lat2 = toRad(b[1])
  const h =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)))
}

function catchmentAccess(
  origin: [number, number],
  points: Array<{ lng: number; lat: number }>,
  maxKm: number,
): number {
  if (!points.length) return 0
  const best = points.reduce((minimum, pointRecord) => {
    return Math.min(minimum, distanceKm(origin, [pointRecord.lng, pointRecord.lat]))
  }, Infinity)
  if (!Number.isFinite(best) || best > maxKm) return 0
  return Math.max(0, Math.min(1, 1 - best / maxKm))
}

function estimateCanopyAreaSqKm(dbh: number | null, treeAge: number | null): number {
  const radiusM = dbh && dbh > 60 ? 8 : dbh && dbh > 30 ? 6 : dbh && dbh > 15 ? 4 : treeAge && treeAge > 25 ? 5 : 2
  return (Math.PI * radiusM * radiusM) / 1_000_000
}

function hazardWeight(rating: string | null | undefined): number {
  switch ((rating || '').toLowerCase()) {
    case 'moderate':
      return 0.7
    case 'low':
      return 0.3
    default:
      return 0.5
  }
}

function computeValueGrowth(history: number[] | null | undefined): number | null {
  if (!history || history.length < 2) return null
  const first = history[0]
  const last = history[history.length - 1]
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null
  return (last - first) / first
}

function isInRegion(
  lng: number,
  lat: number,
  feature: GeoJSON.Feature<GeoJSON.Point>,
  region: { bounds: [number, number, number, number]; feature: GeoJSON.Feature },
): boolean {
  const [west, south, east, north] = region.bounds
  if (lng < west || lng > east || lat < south || lat > north) return false
  return booleanPointInPolygon(feature, region.feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)
}

const ALL_DATA_SOURCES: ScoreDataSource[] = [
  'airQuality',
  'parks',
  'heatShade',
  'restaurants',
  'census',
  'bcAssessment',
  'crime',
  'transit',
  'deprivation',
]
const CURRENT_YEAR = new Date().getFullYear()
const DEFAULT_SCORE_FILTERS: ScoreFilterState = {
  requirePopulation: false,
  requireParks: false,
  limitCrime: false,
  limitFoodRisk: false,
}
const HEALTH_BOUNDARY_LEVEL_VALUES = new Set<BoundaryLevel>(HEALTH_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value))
const CENSUS_BOUNDARY_LEVEL_VALUES = new Set<CensusBoundaryLevel>(
  CENSUS_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value),
)
const CITY_BOUNDARY_LEVEL_VALUES = new Set<CityBoundaryLevel>(CITY_BOUNDARY_LEVEL_OPTIONS.map((option) => option.value))

function parseBoundarySource(value: string | null): BoundarySource {
  return value === 'bcHealth' || value === 'census' || value === 'cityPG' ? value : 'census'
}

function parseHealthBoundaryLevel(value: string | null): BoundaryLevel {
  return HEALTH_BOUNDARY_LEVEL_VALUES.has(value as BoundaryLevel) ? (value as BoundaryLevel) : 'chsa'
}

function parseCensusBoundaryLevel(value: string | null): CensusBoundaryLevel {
  return CENSUS_BOUNDARY_LEVEL_VALUES.has(value as CensusBoundaryLevel) ? (value as CensusBoundaryLevel) : 'ct'
}

function parseCityBoundaryLevel(value: string | null): CityBoundaryLevel {
  return CITY_BOUNDARY_LEVEL_VALUES.has(value as CityBoundaryLevel)
    ? (value as CityBoundaryLevel)
    : 'elementarySchoolCatchment'
}

function parseNormalizationMethod(value: string | null): ScoreMethodSettings['normalization'] {
  if (value === 'minMax' || value === 'winsorizedMinMax' || value === 'percentile' || value === 'zScore') return value
  return 'percentile'
}

function parseAggregationMethod(value: string | null): ScoreMethodSettings['aggregation'] {
  if (value === 'geometric' || value === 'cumulativeBurden') return value
  return 'additive'
}

function parseMissingDataMethod(value: string | null): ScoreMethodSettings['missingData'] {
  return value === 'neutral' ? 'neutral' : 'zero'
}

function summarizeScores(regions: ScoredBoundaryRegion[]): { min: number; max: number; average: number } {
  if (!regions.length) return { min: 0, max: 0, average: 0 }
  const values = regions.map((entry) => entry.score)
  const sum = values.reduce((total, value) => total + value, 0)
  return { min: Math.min(...values), max: Math.max(...values), average: sum / values.length }
}

function buildScoreBandSummary(regions: ScoredBoundaryRegion[]): ScoreBandSummary[] {
  const definitions: Array<Omit<ScoreBandSummary, 'count'>> = [
    { key: 'high', label: 'High fit', description: 'Strongest matches for the active model.', min: 70, max: 100 },
    { key: 'moderate', label: 'Moderate fit', description: 'Worth reviewing with local context.', min: 55, max: 70 },
    { key: 'low', label: 'Low fit', description: 'Below the current model average target.', min: 40, max: 55 },
    { key: 'watchlist', label: 'Watchlist', description: 'Lowest-scoring or constrained areas.', min: 0, max: 40 },
  ]

  return definitions.map((band) => ({
    ...band,
    count: regions.filter((region) =>
      band.key === 'high'
        ? region.score >= band.min
        : band.key === 'watchlist'
          ? region.score < band.max
          : region.score >= band.min && region.score < band.max,
    ).length,
  }))
}

export default function ScoreBuilderSection() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialShareToken = useRef(searchParams.get('s'))
  const initialHasUrlWeights = Boolean(searchParams.get('w') || initialShareToken.current)
  const hasUrlWeightsOnMount = useRef(initialHasUrlWeights)

  const { monitors, loading: loadingMonitors, error: monitorsError } = useAirQualityData()
  const { parks, trails, amenities, loading: loadingParks, error: parksError } = useParksData()
  const { restaurants, loading: loadingRestaurants, error: restaurantsError } = useRestaurantData()
  const { unitsByLevel, loading: loadingCensus, error: censusError } = useCensusData()

  const [showSidebar, setShowSidebar] = useState(true)
  const [showRightSidebar, setShowRightSidebar] = useState(true)
  const [boundarySource, setBoundarySource] = useState<BoundarySource>(() =>
    parseBoundarySource(searchParams.get('src')),
  )
  const [healthBoundaryLevel, setHealthBoundaryLevel] = useState<BoundaryLevel>(() =>
    parseHealthBoundaryLevel(searchParams.get('level')),
  )
  const [censusBoundaryLevel, setCensusBoundaryLevel] = useState<CensusBoundaryLevel>(() =>
    parseCensusBoundaryLevel(searchParams.get('level')),
  )
  const [cityBoundaryLevel, setCityBoundaryLevel] = useState<CityBoundaryLevel>(() =>
    parseCityBoundaryLevel(searchParams.get('level')),
  )
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [regionInsightRegionId, setRegionInsightRegionId] = useState<string | null>(null)
  const [regionInsightOpen, setRegionInsightOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([])
  const [weights, setWeights] = useState<ScoreMetricWeightMap>(() => {
    const fromUrl = searchParams.get('w')
    if (fromUrl) {
      const decoded = decodeWeightsFromParams(fromUrl)
      if (decoded) return decoded
    }
    return createDefaultWeights()
  })
  const [densityMetric, setDensityMetric] = useState<ScoreMetricKey>('overallDensity')
  const [showPoints, setShowPoints] = useState(true)
  const [enabledDataSources, setEnabledDataSources] = useState<ScoreDataSource[]>(() => {
    const fromUrl = searchParams.get('ds')
    if (fromUrl) {
      const parsed = fromUrl
        .split(',')
        .filter((s) => ALL_DATA_SOURCES.includes(s as ScoreDataSource)) as ScoreDataSource[]
      if (parsed.length) return parsed
    }
    return ['airQuality']
  })
  const [comparisonIds, setComparisonIds] = useState<string[]>([])
  const [scoreFilters, setScoreFilters] = useState<ScoreFilterState>(DEFAULT_SCORE_FILTERS)
  const [methodSettings, setMethodSettings] = useState<ScoreMethodSettings>({
    normalization: parseNormalizationMethod(searchParams.get('norm')),
    aggregation: parseAggregationMethod(searchParams.get('agg')),
    missingData: parseMissingDataMethod(searchParams.get('missing')),
    sensitivity: searchParams.get('sens') === 'off' ? false : true,
    normalizationScope: 'activeBoundaryLevel',
  })
  const [activeExampleKey, setActiveExampleKey] = useState<string | null>(() => {
    // If no URL params, auto-load first example
    if (!initialHasUrlWeights) return SCORE_BUILDER_EXAMPLES[0]?.key || null
    return null
  })
  const isDesktop = useMediaQuery('(min-width: 768px)')

  // URL persistence
  useEffect(() => {
    const params = new URLSearchParams()
    params.set('src', boundarySource)
    params.set(
      'level',
      boundarySource === 'bcHealth'
        ? healthBoundaryLevel
        : boundarySource === 'census'
          ? censusBoundaryLevel
          : cityBoundaryLevel,
    )
    params.set('w', encodeWeightsToParams(weights))
    params.set('ds', enabledDataSources.join(','))
    params.set('norm', methodSettings.normalization)
    params.set('agg', methodSettings.aggregation)
    params.set('missing', methodSettings.missingData)
    params.set('sens', methodSettings.sensitivity ? 'on' : 'off')
    params.set('scope', methodSettings.normalizationScope)
    setSearchParams(params, { replace: true })
  }, [
    boundarySource,
    healthBoundaryLevel,
    censusBoundaryLevel,
    cityBoundaryLevel,
    weights,
    enabledDataSources,
    methodSettings,
    setSearchParams,
  ])

  const selectedRegionLevel: RegionLevel =
    boundarySource === 'bcHealth'
      ? healthBoundaryLevel
      : boundarySource === 'census'
        ? censusBoundaryLevel
        : cityBoundaryLevel

  const boundaryLevelOptions = useMemo<Array<{ value: RegionLevel; label: string }>>(() => {
    if (boundarySource === 'bcHealth') {
      return HEALTH_BOUNDARY_LEVEL_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      }))
    }
    if (boundarySource === 'cityPG') {
      return CITY_BOUNDARY_LEVEL_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      }))
    }
    return CENSUS_BOUNDARY_LEVEL_OPTIONS.map((option) => ({
      value: option.value,
      label: option.label,
    }))
  }, [boundarySource])

  const {
    regions,
    loading: loadingRegions,
    error: regionsError,
  } = useScoreBuilderRegions(boundarySource, selectedRegionLevel)

  const enabledSourceSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const {
    properties,
    loading: loadingProperties,
    error: propertiesError,
  } = useBcAssessmentData(enabledSourceSet.has('bcAssessment'))
  const { incidents, loading: loadingCrime, error: crimeError } = useCrimeData(enabledSourceSet.has('crime'))
  const {
    trees: heatShadeTrees,
    forests: heatShadeForests,
    facilities: heatShadeFacilities,
    loading: loadingHeatShade,
    error: heatShadeError,
  } = useHeatShadeData(enabledSourceSet.has('heatShade'))
  const {
    stops: transitStops,
    loading: loadingTransit,
    error: transitError,
  } = useTransitData(enabledSourceSet.has('transit'))
  const {
    records: cimdRecords,
    loading: loadingCimd,
    error: cimdError,
  } = useCimdData(enabledSourceSet.has('deprivation'))

  const networkCounts = useMemo(() => {
    const counts = new Map<string, number>()
    monitors.forEach((monitor) => {
      counts.set(monitor.network, (counts.get(monitor.network) || 0) + 1)
    })
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [monitors])

  const allNetworks = useMemo(() => networkCounts.map(([network]) => network), [networkCounts])

  useEffect(() => {
    setSelectedNetworks((current) => {
      if (!current.length) return current
      const valid = current.filter((network) => allNetworks.includes(network))
      if (valid.length === current.length) return current
      return valid
    })
  }, [allNetworks])

  useEffect(() => {
    setSelectedRegionId(null)
    setRegionInsightOpen(false)
    setRegionInsightRegionId(null)
    setComparisonIds([])
  }, [boundarySource, selectedRegionLevel])

  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])
  const hasActiveNetworks = enabledSourceSet.has('airQuality') && selectedNetworks.length > 0

  const filteredMonitors = useMemo(() => {
    if (!hasActiveNetworks) return []
    return monitors.filter((monitor) => selectedNetworkSet.has(monitor.network))
  }, [hasActiveNetworks, monitors, selectedNetworkSet])

  const monitorPointRecords = useMemo<MonitorPointRecord[]>(() => {
    return filteredMonitors.map((monitor) => ({
      monitor,
      feature: point([monitor.longitude, monitor.latitude]),
    }))
  }, [filteredMonitors])

  // Park centroid points
  const parkPointRecords = useMemo<Array<PointRecord & { areaSqKm: number }>>(() => {
    if (!enabledSourceSet.has('parks')) return []
    return parks
      .map((park) => {
        const center = bboxCenter(park.geometry)
        if (!center) return null
        return {
          lng: center[0],
          lat: center[1],
          feature: point(center),
          areaSqKm: (park.area || 0) / 1_000_000,
        }
      })
      .filter(Boolean) as Array<PointRecord & { areaSqKm: number }>
  }, [enabledSourceSet, parks])

  // Trail midpoint points
  const trailPointRecords = useMemo<Array<PointRecord & { lengthKm: number }>>(() => {
    if (!enabledSourceSet.has('parks')) return []
    return trails
      .filter((t) => t.coordinates.length >= 2)
      .map((trail) => {
        const mid = Math.floor(trail.coordinates.length / 2)
        const [lng, lat] = trail.coordinates[mid]
        return {
          lng,
          lat,
          feature: point([lng, lat]),
          lengthKm: (trail.length || 0) / 1000,
        }
      })
  }, [enabledSourceSet, trails])

  // Amenity points
  const amenityPointRecords = useMemo<PointRecord[]>(() => {
    if (!enabledSourceSet.has('parks')) return []
    return amenities
      .filter((a) => Number.isFinite(a.latitude) && Number.isFinite(a.longitude))
      .map((a) => ({
        lng: a.longitude,
        lat: a.latitude,
        feature: point([a.longitude, a.latitude]),
      }))
  }, [amenities, enabledSourceSet])

  // Restaurant points
  const restaurantPointRecords = useMemo<
    Array<
      PointRecord & {
        hazard: number
        inspectionCount: number
        criticalViolations: number
        followUps: number
      }
    >
  >(() => {
    if (!enabledSourceSet.has('restaurants')) return []
    return restaurants
      .filter((r) => r.latitude != null && r.longitude != null)
      .map((r) => {
        const inspections = r.inspections || []
        return {
          lng: r.longitude as number,
          lat: r.latitude as number,
          feature: point([r.longitude as number, r.latitude as number]),
          hazard: hazardWeight(r.current_hazard_rating || r.hazard_rating),
          inspectionCount: inspections.length,
          criticalViolations: inspections.reduce(
            (sum, inspection) => sum + (inspection.critical_violations_count || 0),
            0,
          ),
          followUps: inspections.reduce(
            (sum, inspection) => sum + (String(inspection.follow_up_required || '').toLowerCase() === 'yes' ? 1 : 0),
            0,
          ),
        }
      })
  }, [enabledSourceSet, restaurants])

  // Census DA centroid points
  const censusPointRecords = useMemo<Array<PointRecord & { population: number }>>(() => {
    if (!enabledSourceSet.has('census')) return []
    return unitsByLevel.da
      .map((unit) => {
        const center = bboxCenter(unit.geometry)
        if (!center) return null
        return {
          lng: center[0],
          lat: center[1],
          feature: point(center),
          population: unit.population || 0,
        }
      })
      .filter(Boolean) as Array<PointRecord & { population: number }>
  }, [enabledSourceSet, unitsByLevel.da])

  const propertyPointRecords = useMemo<PropertyPointRecord[]>(() => {
    if (!enabledSourceSet.has('bcAssessment')) return []
    return properties
      .filter((property) => Number.isFinite(property.latitude) && Number.isFinite(property.longitude))
      .map((property) => ({
        lng: property.longitude,
        lat: property.latitude,
        feature: point([property.longitude, property.latitude]),
        assessedValue: property.totalAssessed || 0,
        landValue: property.totalLand || 0,
        buildingValue: property.totalBuilding || 0,
        valueGrowth: computeValueGrowth(property.histValues),
        yearBuilt: property.yearBuilt,
        category: property.category,
        ct: property.ct,
        da: property.da,
      }))
  }, [enabledSourceSet, properties])

  const crimePointRecords = useMemo<CrimePointRecord[]>(() => {
    if (!enabledSourceSet.has('crime')) return []
    const validIncidents = incidents.filter(
      (incident) =>
        Number.isFinite(incident.latitude) &&
        Number.isFinite(incident.longitude) &&
        !Number.isNaN(incident.date.getTime()),
    )
    const latestTime = validIncidents.reduce((latest, incident) => Math.max(latest, incident.date.getTime()), 0)
    const recentCutoff = latestTime > 0 ? latestTime - 180 * 24 * 60 * 60 * 1000 : 0
    return validIncidents.map((incident) => ({
      lng: incident.longitude,
      lat: incident.latitude,
      feature: point([incident.longitude, incident.latitude]),
      date: incident.date,
      recent: recentCutoff > 0 && incident.date.getTime() >= recentCutoff,
    }))
  }, [enabledSourceSet, incidents])

  const transitPointRecords = useMemo<TransitPointRecord[]>(() => {
    if (!enabledSourceSet.has('transit')) return []
    return transitStops
      .filter((stop) => stop.status === 'ACT')
      .map((stop) => ({
        lng: stop.longitude,
        lat: stop.latitude,
        feature: point([stop.longitude, stop.latitude]),
        accessible: stop.accessible,
        hasShelter: stop.hasShelter,
        frequent: stop.frequent,
        weekdayTrips: stop.weekdayTrips,
        serviceSpanHours: stop.serviceSpanHours,
      }))
  }, [enabledSourceSet, transitStops])

  const heatShadeTreePointRecords = useMemo<HeatShadeTreePointRecord[]>(() => {
    if (!enabledSourceSet.has('heatShade')) return []
    return heatShadeTrees.map((tree) => ({
      lng: tree.longitude,
      lat: tree.latitude,
      feature: point([tree.longitude, tree.latitude]),
      mature: (tree.dbh ?? 0) >= 20 || (tree.treeAge ?? 0) >= 20,
      canopyAreaSqKm: estimateCanopyAreaSqKm(tree.dbh, tree.treeAge),
    }))
  }, [enabledSourceSet, heatShadeTrees])

  const heatShadeForestRecords = useMemo<HeatShadeForestRecord[]>(() => {
    if (!enabledSourceSet.has('heatShade')) return []
    return heatShadeForests
      .map((forest) => {
        const center = bboxCenter(forest.geometry)
        if (!center) return null
        return {
          lng: center[0],
          lat: center[1],
          feature: point(center),
          areaSqKm: forest.areaSqKm,
        }
      })
      .filter((record): record is HeatShadeForestRecord => record !== null)
  }, [enabledSourceSet, heatShadeForests])

  const heatShadeFacilityPointRecords = useMemo<HeatShadeFacilityPointRecord[]>(() => {
    if (!enabledSourceSet.has('heatShade')) return []
    return heatShadeFacilities.map((facility) => ({
      lng: facility.longitude,
      lat: facility.latitude,
      feature: point([facility.longitude, facility.latitude]),
      kind: facility.kind,
    }))
  }, [enabledSourceSet, heatShadeFacilities])

  const cimdPointRecords = useMemo<CimdPointRecord[]>(() => {
    if (!enabledSourceSet.has('deprivation') || cimdRecords.length === 0) return []
    const cimdByDa = new Map<string, CimdRecord>(cimdRecords.map((record) => [record.daCode, record]))
    return unitsByLevel.da
      .map((unit) => {
        const cimd = cimdByDa.get(String(unit.id ?? '').trim())
        if (!cimd) return null
        const center = bboxCenter(unit.geometry)
        if (!center) return null
        return {
          lng: center[0],
          lat: center[1],
          feature: point(center),
          cimd,
        }
      })
      .filter((record): record is CimdPointRecord => record !== null)
  }, [cimdRecords, enabledSourceSet, unitsByLevel.da])

  const regionMetricRows = useMemo<RegionMetricRow[]>(() => {
    return regions.map((region) => {
      const counts: RegionDataCounts = {
        monitorCount: 0,
        lowCostCount: 0,
        referenceCount: 0,
        activeCount: 0,
        parkCount: 0,
        parkAreaSqKm: 0,
        trailCount: 0,
        trailLengthKm: 0,
        amenityCount: 0,
        restaurantCount: 0,
        restaurantHazardSum: 0,
        inspectionCount: 0,
        criticalViolationCount: 0,
        followUpInspectionCount: 0,
        populationSum: 0,
        parcelCount: 0,
        assessedValueSum: 0,
        landValueSum: 0,
        buildingValueSum: 0,
        propertyGrowthSum: 0,
        propertyGrowthCount: 0,
        yearBuiltSum: 0,
        yearBuiltCount: 0,
        vacantParcelCount: 0,
        multiFamilyParcelCount: 0,
        commercialParcelCount: 0,
        crimeCount: 0,
        recentCrimeCount: 0,
        transitStopCount: 0,
        accessibleTransitStopCount: 0,
        transitShelterCount: 0,
        frequentTransitStopCount: 0,
        accessibleFrequentTransitStopCount: 0,
        transitTripCount: 0,
        transitServiceSpanSum: 0,
        treeCount: 0,
        matureTreeCount: 0,
        forestAreaSqKm: 0,
        canopyProxyAreaSqKm: 0,
        coolingFacilityCount: 0,
        responseFacilityCount: 0,
        cimdJoinedCount: 0,
        cimdPopulationWeight: 0,
        cimdCompositeSum: 0,
        cimdResidentialInstabilitySum: 0,
        cimdEconomicDependencySum: 0,
        cimdSituationalVulnerabilitySum: 0,
        cimdEthnoCulturalCompositionSum: 0,
      }
      const networks = new Set<string>()
      const parameters = new Set<string>()

      // Air quality
      monitorPointRecords.forEach(({ monitor, feature }) => {
        if (!isInRegion(monitor.longitude, monitor.latitude, feature, region)) return
        counts.monitorCount += 1
        if (LOW_COST_NETWORKS.has(monitor.network)) counts.lowCostCount += 1
        else counts.referenceCount += 1
        if ((monitor.status || '').toLowerCase() === 'active') counts.activeCount += 1
        networks.add(monitor.network)
        monitor.parameters.forEach((p) => {
          const n = p.trim()
          if (n) parameters.add(n)
        })
      })

      // Parks
      parkPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.parkCount += 1
        counts.parkAreaSqKm += rec.areaSqKm
      })

      // Trails
      trailPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.trailCount += 1
        counts.trailLengthKm += rec.lengthKm
      })

      // Amenities
      amenityPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.amenityCount += 1
      })

      // Restaurants
      restaurantPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.restaurantCount += 1
        counts.restaurantHazardSum += rec.hazard
        counts.inspectionCount += rec.inspectionCount
        counts.criticalViolationCount += rec.criticalViolations
        counts.followUpInspectionCount += rec.followUps
      })

      // Census
      censusPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.populationSum += rec.population
      })

      // BC Assessment
      propertyPointRecords.forEach((rec) => {
        const directCensusMatch =
          region.source === 'census' &&
          (region.level === 'ct' || region.level === 'da') &&
          rec[region.level as 'ct' | 'da'] === region.code
        if (!directCensusMatch && !isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.parcelCount += 1
        counts.assessedValueSum += rec.assessedValue
        counts.landValueSum += rec.landValue
        counts.buildingValueSum += rec.buildingValue
        if (rec.valueGrowth != null) {
          counts.propertyGrowthSum += rec.valueGrowth
          counts.propertyGrowthCount += 1
        }
        if (rec.yearBuilt) {
          counts.yearBuiltSum += rec.yearBuilt
          counts.yearBuiltCount += 1
        }
        if (rec.category === 'vacant') counts.vacantParcelCount += 1
        if (rec.category === 'multi-family') counts.multiFamilyParcelCount += 1
        if (rec.category === 'commercial') counts.commercialParcelCount += 1
      })

      // Crime
      crimePointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.crimeCount += 1
        if (rec.recent) counts.recentCrimeCount += 1
      })

      // Transit
      transitPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.transitStopCount += 1
        if (rec.accessible) counts.accessibleTransitStopCount += 1
        if (rec.hasShelter) counts.transitShelterCount += 1
        if (rec.frequent) counts.frequentTransitStopCount += 1
        if (rec.frequent && rec.accessible) counts.accessibleFrequentTransitStopCount += 1
        counts.transitTripCount += rec.weekdayTrips
        counts.transitServiceSpanSum += rec.serviceSpanHours
      })

      // Heat and shade
      heatShadeTreePointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.treeCount += 1
        if (rec.mature) counts.matureTreeCount += 1
        counts.canopyProxyAreaSqKm += rec.canopyAreaSqKm
      })

      heatShadeForestRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        counts.forestAreaSqKm += rec.areaSqKm
      })

      heatShadeFacilityPointRecords.forEach((rec) => {
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        if (rec.kind === 'communityFacility') counts.coolingFacilityCount += 1
        else counts.responseFacilityCount += 1
      })

      cimdPointRecords.forEach((rec) => {
        const { cimd } = rec
        if (!isInRegion(rec.lng, rec.lat, rec.feature, region)) return
        const weight = cimd.population || 1
        counts.cimdJoinedCount += 1
        counts.cimdPopulationWeight += weight
        counts.cimdCompositeSum += cimd.composite * weight
        counts.cimdResidentialInstabilitySum += cimd.residentialInstability * weight
        counts.cimdEconomicDependencySum += cimd.economicDependency * weight
        counts.cimdSituationalVulnerabilitySum += cimd.situationalVulnerability * weight
        counts.cimdEthnoCulturalCompositionSum += cimd.ethnoCulturalComposition * weight
      })

      const safeArea = region.areaKm2 > 0 ? region.areaKm2 : 1
      const center = regionCenter(region)
      const parkWalk10Access = catchmentAccess(center, parkPointRecords, 0.8)
      const parkWalk20Access = catchmentAccess(center, parkPointRecords, 1.6)
      const coolingWalk15Access = catchmentAccess(
        center,
        heatShadeFacilityPointRecords.filter((record) => record.kind === 'communityFacility'),
        1.2,
      )
      const frequentTransitAccess = catchmentAccess(
        center,
        transitPointRecords.filter((record) => record.frequent),
        0.8,
      )
      const accessibleFrequentTransitAccess = catchmentAccess(
        center,
        transitPointRecords.filter((record) => record.frequent && record.accessible),
        0.8,
      )
      const parkTransit20Access = Math.max(parkWalk20Access, Math.min(1, parkWalk20Access + frequentTransitAccess * 0.35))
      const serviceAccessComposite =
        (parkWalk10Access + parkWalk20Access + coolingWalk15Access + frequentTransitAccess) / 4
      const cimdWeight = counts.cimdPopulationWeight || counts.cimdJoinedCount || 1
      const cimdComposite = counts.cimdPopulationWeight > 0 ? counts.cimdCompositeSum / cimdWeight : 0
      const canopyProxyRatio =
        region.areaKm2 > 0 ? Math.min(1, (counts.canopyProxyAreaSqKm + counts.forestAreaSqKm) / region.areaKm2) : 0
      const shadeGap = Math.max(
        0,
        Math.min(1, (1 - (canopyProxyRatio + coolingWalk15Access) / 2) * (0.5 + Math.min(0.5, cimdComposite / 2))),
      )
      const metricValues = createMetricValueMap(0)
      metricValues.overallDensity = counts.monitorCount / safeArea
      metricValues.lowCostDensity = counts.lowCostCount / safeArea
      metricValues.referenceDensity = counts.referenceCount / safeArea
      metricValues.networkVariety = networks.size
      metricValues.parameterVariety = parameters.size
      metricValues.activeShare = counts.monitorCount > 0 ? counts.activeCount / counts.monitorCount : 0
      metricValues.monitorCount = counts.monitorCount
      metricValues.parkDensity = counts.parkCount / safeArea
      metricValues.parkAreaRatio = region.areaKm2 > 0 ? Math.min(1, counts.parkAreaSqKm / region.areaKm2) : 0
      metricValues.trailDensity = counts.trailLengthKm / safeArea
      metricValues.amenityDensity = counts.amenityCount / safeArea
      metricValues.treeDensity = counts.treeCount / safeArea
      metricValues.matureTreeDensity = counts.matureTreeCount / safeArea
      metricValues.forestAreaRatio = region.areaKm2 > 0 ? Math.min(1, counts.forestAreaSqKm / region.areaKm2) : 0
      metricValues.coolingFacilityDensity = counts.coolingFacilityCount / safeArea
      metricValues.responseFacilityDensity = counts.responseFacilityCount / safeArea
      metricValues.restaurantDensity = counts.restaurantCount / safeArea
      metricValues.foodRiskScore = counts.restaurantCount > 0 ? counts.restaurantHazardSum / counts.restaurantCount : 0
      metricValues.criticalViolationRate =
        counts.inspectionCount > 0 ? counts.criticalViolationCount / counts.inspectionCount : 0
      metricValues.followUpRate =
        counts.inspectionCount > 0 ? counts.followUpInspectionCount / counts.inspectionCount : 0
      metricValues.populationDensity = counts.populationSum / safeArea
      metricValues.parcelDensity = counts.parcelCount / safeArea
      metricValues.avgAssessedValue = counts.parcelCount > 0 ? counts.assessedValueSum / counts.parcelCount : 0
      metricValues.valueGrowth10y =
        counts.propertyGrowthCount > 0 ? counts.propertyGrowthSum / counts.propertyGrowthCount : 0
      metricValues.buildingAge =
        counts.yearBuiltCount > 0 ? Math.max(0, CURRENT_YEAR - counts.yearBuiltSum / counts.yearBuiltCount) : 0
      metricValues.vacantParcelShare = counts.parcelCount > 0 ? counts.vacantParcelCount / counts.parcelCount : 0
      metricValues.multiFamilyShare = counts.parcelCount > 0 ? counts.multiFamilyParcelCount / counts.parcelCount : 0
      metricValues.commercialShare = counts.parcelCount > 0 ? counts.commercialParcelCount / counts.parcelCount : 0
      metricValues.landValueShare = counts.assessedValueSum > 0 ? counts.landValueSum / counts.assessedValueSum : 0
      metricValues.crimeDensity = counts.crimeCount / safeArea
      metricValues.crimePerCapita = counts.populationSum > 0 ? counts.crimeCount / counts.populationSum : 0
      metricValues.recentCrimeShare = counts.crimeCount > 0 ? counts.recentCrimeCount / counts.crimeCount : 0
      metricValues.transitStopDensity = counts.transitStopCount / safeArea
      metricValues.accessibleTransitStopDensity = counts.accessibleTransitStopCount / safeArea
      metricValues.transitShelterDensity = counts.transitShelterCount / safeArea
      metricValues.frequentTransitStopAccess = frequentTransitAccess
      metricValues.transitServiceSpan =
        counts.transitStopCount > 0 ? counts.transitServiceSpanSum / counts.transitStopCount : 0
      metricValues.transitTripsPerStop = counts.transitStopCount > 0 ? counts.transitTripCount / counts.transitStopCount : 0
      metricValues.accessibleFrequentTransitAccess = accessibleFrequentTransitAccess
      metricValues.parkWalk10Access = parkWalk10Access
      metricValues.parkWalk20Access = parkWalk20Access
      metricValues.coolingWalk15Access = coolingWalk15Access
      metricValues.parkTransit20Access = parkTransit20Access
      metricValues.serviceAccessComposite = serviceAccessComposite
      metricValues.canopyProxyRatio = canopyProxyRatio
      metricValues.shadeGap = shadeGap
      metricValues.cimdComposite = cimdComposite
      metricValues.cimdResidentialInstability =
        counts.cimdPopulationWeight > 0 ? counts.cimdResidentialInstabilitySum / cimdWeight : 0
      metricValues.cimdEconomicDependency =
        counts.cimdPopulationWeight > 0 ? counts.cimdEconomicDependencySum / cimdWeight : 0
      metricValues.cimdSituationalVulnerability =
        counts.cimdPopulationWeight > 0 ? counts.cimdSituationalVulnerabilitySum / cimdWeight : 0
      metricValues.cimdEthnoCulturalComposition =
        counts.cimdPopulationWeight > 0 ? counts.cimdEthnoCulturalCompositionSum / cimdWeight : 0

      return { region, metrics: metricValues, counts }
    })
  }, [
    monitorPointRecords,
    parkPointRecords,
    trailPointRecords,
    amenityPointRecords,
    restaurantPointRecords,
    censusPointRecords,
    propertyPointRecords,
    crimePointRecords,
    transitPointRecords,
    heatShadeTreePointRecords,
    heatShadeForestRecords,
    heatShadeFacilityPointRecords,
    cimdPointRecords,
    regions,
  ])

  const metricRanges = useMemo(() => buildMetricRanges(regionMetricRows), [regionMetricRows])

  const metricValueLists = useMemo(() => {
    return buildMetricValueLists(regionMetricRows)
  }, [regionMetricRows])

  const activePresetKey = useMemo(() => {
    return getActivePresetKey(weights, enabledDataSources, boundarySource)
  }, [boundarySource, enabledDataSources, weights])

  const inferredExampleKey = useMemo(() => {
    const match = SCORE_BUILDER_EXAMPLES.find(
      (example) =>
        example.boundarySource === boundarySource &&
        example.boundaryLevel === selectedRegionLevel &&
        scoreDataSourcesEqual(example.dataSources, enabledDataSources) &&
        scoreWeightsEqual(example.weights, weights),
    )
    return match?.key || null
  }, [boundarySource, enabledDataSources, selectedRegionLevel, weights])

  const resolvedExampleKey = activeExampleKey || inferredExampleKey

  const paletteExampleKey = useMemo(() => {
    if (resolvedExampleKey) return resolvedExampleKey
    const match = SCORE_BUILDER_EXAMPLES.find(
      (example) =>
        scoreDataSourcesEqual(example.dataSources, enabledDataSources) && scoreWeightsEqual(example.weights, weights),
    )
    return match?.key || null
  }, [enabledDataSources, resolvedExampleKey, weights])

  const scorePaletteProfile = useMemo(() => {
    return getScorePaletteProfile(activePresetKey, paletteExampleKey)
  }, [activePresetKey, paletteExampleKey])

  const activePreset = useMemo(
    () => SCORE_PRESETS.find((preset) => preset.key === activePresetKey) || null,
    [activePresetKey],
  )

  const activeExample = useMemo(
    () => SCORE_BUILDER_EXAMPLES.find((example) => example.key === resolvedExampleKey) || null,
    [resolvedExampleKey],
  )

  const scoreRows = useCallback(
    (weightMap: ScoreMetricWeightMap, settings: ScoreMethodSettings = methodSettings): ScoredBoundaryRegion[] => {
      return scoreRegionRows({
        rows: regionMetricRows,
        weights: weightMap,
        settings,
        metricRanges,
        metricValueLists,
        paletteProfile: scorePaletteProfile,
      })
    },
    [methodSettings, metricRanges, metricValueLists, regionMetricRows, scorePaletteProfile],
  )

  const unfilteredScoredRegions = useMemo<ScoredBoundaryRegion[]>(() => scoreRows(weights), [scoreRows, weights])

  const filterThresholds = useMemo(() => {
    const crimeValues = unfilteredScoredRegions
      .map((entry) => entry.metrics.crimePerCapita)
      .filter((value) => Number.isFinite(value) && value > 0)
    const foodRiskValues = unfilteredScoredRegions
      .map((entry) => entry.metrics.foodRiskScore)
      .filter((value) => Number.isFinite(value) && value > 0)
    return {
      crimePerCapita: crimeValues.length ? computeMedian(crimeValues) : Infinity,
      foodRiskScore: foodRiskValues.length ? computeMedian(foodRiskValues) : Infinity,
    }
  }, [unfilteredScoredRegions])

  const scoredRegions = useMemo<ScoredBoundaryRegion[]>(() => {
    const filtered = unfilteredScoredRegions.filter((entry) => {
      if (scoreFilters.requirePopulation && entry.counts.populationSum <= 0) return false
      if (
        scoreFilters.requireParks &&
        entry.counts.parkCount + entry.counts.amenityCount <= 0 &&
        entry.counts.trailLengthKm <= 0
      ) {
        return false
      }
      if (scoreFilters.limitCrime && entry.metrics.crimePerCapita > filterThresholds.crimePerCapita) return false
      if (scoreFilters.limitFoodRisk && entry.metrics.foodRiskScore > filterThresholds.foodRiskScore) return false
      return true
    })
    const ranked = filtered.map((row, index) => ({ ...row, rank: index + 1, rankInterval: [index + 1, index + 1] as [number, number] }))
    const referencePreset = SCORE_PRESETS.find((preset) => preset.key === 'balancedCoverage') || SCORE_PRESETS[0]
    const referenceById = new Map(
      referencePreset
        ? scoreRows(referencePreset.weights).map((entry, index) => [entry.region.id, { ...entry, rank: index + 1 }])
        : [],
    )
    return ranked.map((row) => {
      const reference = referenceById.get(row.region.id)
      const nearestBandBoundary = [40, 55, 70].reduce(
        (nearest, boundary) => Math.min(nearest, Math.abs(row.score - boundary)),
        Infinity,
      )
      const deprivationQuintile =
        row.metrics.cimdComposite > 0 ? Math.max(1, Math.min(5, Math.ceil(row.metrics.cimdComposite * 5))) : null
      const burdenOverlap = Math.sqrt(
        Math.max(row.normalizedMetrics.foodRiskScore, row.normalizedMetrics.crimePerCapita, row.normalizedMetrics.shadeGap) *
          Math.max(row.normalizedMetrics.cimdComposite, row.normalizedMetrics.populationDensity),
      )
      return {
        ...row,
        rankConfidence:
          row.dataCoverageScore < 0.6 || nearestBandBoundary <= 2
            ? 'Borderline priority'
            : row.rank <= 12
              ? 'Stable priority'
              : 'Sensitive result',
        equityAudit: {
          referenceRank: reference?.rank ?? null,
          rankDelta: reference ? reference.rank - row.rank : 0,
          referenceScore: reference?.score ?? null,
          deprivationQuintile,
          burdenOverlap: Number.isFinite(burdenOverlap) ? burdenOverlap : 0,
          cutoffWarning: nearestBandBoundary <= 2 ? 'Near score-band cutoff; review rank confidence before using as a threshold.' : null,
        },
      }
    })
  }, [filterThresholds, scoreFilters, scoreRows, unfilteredScoredRegions])

  const filteredRegions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return scoredRegions
    return scoredRegions.filter(
      (entry) => entry.region.name.toLowerCase().includes(query) || entry.region.code.toLowerCase().includes(query),
    )
  }, [scoredRegions, searchQuery])

  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return null
    return scoredRegions.find((entry) => entry.region.id === selectedRegionId) || null
  }, [scoredRegions, selectedRegionId])

  const regionInsightRegion = useMemo(() => {
    if (!regionInsightRegionId) return null
    return scoredRegions.find((entry) => entry.region.id === regionInsightRegionId) || null
  }, [regionInsightRegionId, scoredRegions])

  const comparisonRegions = useMemo(() => {
    return comparisonIds
      .map((id) => scoredRegions.find((r) => r.region.id === id))
      .filter(Boolean) as ScoredBoundaryRegion[]
  }, [comparisonIds, scoredRegions])

  useEffect(() => {
    if (selectedRegionId && !selectedRegion) setSelectedRegionId(null)
  }, [selectedRegion, selectedRegionId])

  useEffect(() => {
    if (regionInsightRegionId && !regionInsightRegion) {
      setRegionInsightOpen(false)
      setRegionInsightRegionId(null)
    }
  }, [regionInsightRegion, regionInsightRegionId])

  const scoreSpread = useMemo(() => summarizeScores(scoredRegions), [scoredRegions])
  const thinCoverageCount = useMemo(
    () => scoredRegions.filter((region) => region.dataCoverageScore < 0.6).length,
    [scoredRegions],
  )

  const scoreBands = useMemo(() => buildScoreBandSummary(scoredRegions), [scoredRegions])

  const componentSummaries = useMemo<ScoreComponentSummary[]>(() => {
    const referenceRegion = selectedRegion || scoredRegions[0]
    const totalWeight = SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
    if (!referenceRegion || totalWeight <= 0) return []

    return Object.entries(METRIC_CATEGORY_LABELS)
      .map(([category, label]) => {
        const metrics = SCORE_METRICS.filter((metric) => metric.category === category && weights[metric.key] !== 0)
        const categoryWeight = metrics.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
        const categoryContribution = metrics.reduce((sum, metric) => sum + referenceRegion.contributions[metric.key], 0)
        return {
          key: category as ScoreComponentSummary['key'],
          label,
          score: categoryWeight > 0 ? clampScore((categoryContribution / (categoryWeight / totalWeight)) * 100) : 0,
          weightShare: categoryWeight / totalWeight,
          activeMetricCount: metrics.length,
        }
      })
      .filter((summary) => summary.activeMetricCount > 0)
  }, [scoredRegions, selectedRegion, weights])

  const robustnessResults = useMemo<RobustnessResult[]>(() => {
    if (!methodSettings.sensitivity || !scoredRegions.length) return []
    const eligibleIds = new Set(scoredRegions.map((entry) => entry.region.id))
    const trackedRegions = scoredRegions.slice(0, 12)
    const rankSamples = new Map<string, number[]>()
    const scoreSamples = new Map<string, number[]>()
    trackedRegions.forEach((entry) => {
      rankSamples.set(entry.region.id, [entry.rank])
      scoreSamples.set(entry.region.id, [entry.score])
    })

    const sampleRows = (rows: ScoredBoundaryRegion[]) => {
      rows
        .filter((entry) => eligibleIds.has(entry.region.id))
        .forEach((entry, index) => {
          if (!rankSamples.has(entry.region.id)) return
          rankSamples.get(entry.region.id)?.push(index + 1)
          scoreSamples.get(entry.region.id)?.push(entry.score)
        })
    }

    for (let trial = 0; trial < 24; trial += 1) {
      const perturbedWeights = { ...weights }
      SCORE_METRICS.forEach((metric, index) => {
        const weight = weights[metric.key]
        if (weight === 0) return
        const wave = Math.sin((trial + 1) * (index + 3) * 1.618)
        perturbedWeights[metric.key] = Math.round(weight * (1 + wave * 0.15))
      })
      sampleRows(scoreRows(perturbedWeights))
    }

    SCORE_METRICS.filter((metric) => weights[metric.key] !== 0).forEach((metric) => {
      sampleRows(scoreRows({ ...weights, [metric.key]: 0 }))
    })
    ;(['minMax', 'winsorizedMinMax', 'percentile', 'zScore'] as const).forEach((normalization) => {
      if (normalization === methodSettings.normalization) return
      sampleRows(scoreRows(weights, { ...methodSettings, normalization }))
    })

    return trackedRegions.map((entry) => {
      const ranks = [...(rankSamples.get(entry.region.id) || [entry.rank])].sort((a, b) => a - b)
      const scores = [...(scoreSamples.get(entry.region.id) || [entry.score])].sort((a, b) => a - b)
      const rankSpread = ranks[ranks.length - 1] - ranks[0]
      return {
        regionId: entry.region.id,
        regionName: entry.region.name,
        baseRank: entry.rank,
        medianRank: computeMedian(ranks),
        rankInterval: [ranks[0], ranks[ranks.length - 1]],
        scoreInterval: [scores[0], scores[scores.length - 1]],
        stability: rankSpread <= 2 ? 'stable' : rankSpread <= 6 ? 'moderate' : 'sensitive',
        topDrivers: SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
          .sort((a, b) => Math.abs(entry.contributions[b.key]) - Math.abs(entry.contributions[a.key]))
          .slice(0, 3)
          .map((metric) => metric.key),
      }
    })
  }, [methodSettings, scoreRows, scoredRegions, weights])

  const scenarioComparison = useMemo<ScenarioComparison | null>(() => {
    const referencePreset = SCORE_PRESETS.find((preset) => preset.key === 'balancedCoverage') || SCORE_PRESETS[0]
    if (!referencePreset || !unfilteredScoredRegions.length) return null
    const referenceRegionScores = scoreRows(referencePreset.weights)
    const eligibleIds = new Set(scoredRegions.map((entry) => entry.region.id))
    const referenceEligible = referenceRegionScores
      .filter((entry) => eligibleIds.has(entry.region.id))
      .map((entry, index) => ({ ...entry, rank: index + 1 }))
    const referenceSpread = summarizeScores(referenceEligible)
    const currentTopId = scoredRegions[0]?.region.id || null
    const trials = methodSettings.sensitivity && currentTopId ? 24 : 0
    let stableTopCount = 0
    let averageRankShift = 0

    if (trials > 0) {
      const baseRankById = new Map(scoredRegions.map((entry) => [entry.region.id, entry.rank]))
      for (let trial = 0; trial < trials; trial += 1) {
        const perturbedWeights = { ...weights }
        SCORE_METRICS.forEach((metric, index) => {
          const weight = weights[metric.key]
          if (weight === 0) return
          const wave = Math.sin((trial + 1) * (index + 3) * 1.618)
          perturbedWeights[metric.key] = Math.round(weight * (1 + wave * 0.15))
        })
        const trialRows = scoreRows(perturbedWeights).filter((entry) => eligibleIds.has(entry.region.id))
        if ((trialRows[0]?.region.id || null) === currentTopId) stableTopCount += 1
        const rankShift =
          trialRows.reduce((sum, entry, index) => {
            const baseRank = baseRankById.get(entry.region.id)
            if (!baseRank) return sum
            return sum + Math.abs(baseRank - (index + 1))
          }, 0) / Math.max(1, trialRows.length)
        averageRankShift += rankShift
      }
      averageRankShift /= trials
    }

    return {
      label: referencePreset.label,
      currentTopName: scoredRegions[0]?.region.name || null,
      currentTopScore: scoredRegions[0]?.score || 0,
      referenceTopName: referenceEligible[0]?.region.name || null,
      referenceTopScore: referenceEligible[0]?.score || 0,
      averageDelta: scoreSpread.average - referenceSpread.average,
      topChanged: (scoredRegions[0]?.region.id || null) !== (referenceEligible[0]?.region.id || null),
      stableTopShare: trials > 0 ? stableTopCount / trials : 1,
      averageRankShift,
    }
  }, [
    methodSettings.sensitivity,
    scoreRows,
    scoreSpread.average,
    scoredRegions,
    unfilteredScoredRegions.length,
    weights,
  ])

  const densitySummary = useMemo(() => {
    const values = scoredRegions.map((entry) => entry.metrics[densityMetric]).filter((value) => Number.isFinite(value))
    if (!values.length) return null
    const sum = values.reduce((total, value) => total + value, 0)
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      median: computeMedian(values),
      average: sum / values.length,
    }
  }, [densityMetric, scoredRegions])

  const densityLeaders = useMemo(() => {
    return [...scoredRegions].sort((a, b) => b.metrics[densityMetric] - a.metrics[densityMetric]).slice(0, 3)
  }, [densityMetric, scoredRegions])

  const equationPreview = useMemo(() => {
    const activeTerms = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
    if (!activeTerms.length) return 'No active terms. Move any weight above or below zero.'
    const terms = activeTerms.map((metric) => {
      const weight = weights[metric.key]
      return weight < 0 ? `${Math.abs(weight)}×low ${metric.shortLabel}` : `${weight}×${metric.shortLabel}`
    })
    return `score = weighted average(${terms.join(' + ')})`
  }, [weights])

  const normalizationLegendText = useMemo(
    () => getNormalizationLegendText(methodSettings.normalization),
    [methodSettings.normalization],
  )

  const handleWeightChange = useCallback((metric: ScoreMetricKey, value: number) => {
    setWeights((current) => ({ ...current, [metric]: value }))
  }, [])

  const applyExample = useCallback(
    (exampleKey: string) => {
      const example = SCORE_BUILDER_EXAMPLES.find((e) => e.key === exampleKey)
      if (!example) return
      setActiveExampleKey(exampleKey)
      setBoundarySource(example.boundarySource)
      if (example.boundarySource === 'bcHealth') {
        setHealthBoundaryLevel(example.boundaryLevel as BoundaryLevel)
      } else if (example.boundarySource === 'census') {
        setCensusBoundaryLevel(example.boundaryLevel as CensusBoundaryLevel)
      } else {
        setCityBoundaryLevel(example.boundaryLevel as CityBoundaryLevel)
      }
      setEnabledDataSources([...example.dataSources])
      setWeights({ ...example.weights })
      setMethodSettings((current) => ({ ...current, ...example.methodSettings }))
      if (example.networkFilter === 'all') {
        // Will be applied once allNetworks is available
        setSelectedNetworks(allNetworks.length > 0 ? allNetworks : [])
      } else if (example.networkFilter === 'none') {
        setSelectedNetworks([])
      } else {
        setSelectedNetworks([...example.networkFilter])
      }
      setSelectedRegionId(null)
      setComparisonIds([])
      setSearchQuery('')
    },
    [allNetworks],
  )

  useEffect(() => {
    const token = initialShareToken.current
    if (!token) return
    let cancelled = false
    decodeScoreBuilderShareState(token)
      .then((state) => {
        if (cancelled || state.version !== 1) return
        setActiveExampleKey(null)
        setBoundarySource(parseBoundarySource(state.boundarySource))
        setHealthBoundaryLevel(parseHealthBoundaryLevel(state.healthBoundaryLevel))
        setCensusBoundaryLevel(parseCensusBoundaryLevel(state.censusBoundaryLevel))
        setCityBoundaryLevel(parseCityBoundaryLevel(state.cityBoundaryLevel ?? null))
        setEnabledDataSources([...state.enabledDataSources])
        setSelectedNetworks([...state.selectedNetworks])
        setWeights({ ...createDefaultWeights(), ...state.weights })
        if (state.methodSettings) {
          setMethodSettings((current) => ({ ...current, ...state.methodSettings }))
        }
      })
      .catch(() => {
        // Malformed share tokens should not block the regular score builder.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Auto-apply first example on mount (once networks are loaded)
  const appliedInitialExample = useRef(false)
  useEffect(() => {
    if (appliedInitialExample.current) return
    if (!activeExampleKey || allNetworks.length === 0) return
    // Only auto-apply if no URL weights were provided
    if (hasUrlWeightsOnMount.current) {
      appliedInitialExample.current = true
      return
    }
    appliedInitialExample.current = true
    applyExample(activeExampleKey)
  }, [activeExampleKey, allNetworks, applyExample])

  const handleApplyPreset = useCallback(
    (presetKey: string) => {
      const preset = SCORE_PRESETS.find((entry) => entry.key === presetKey)
      if (!preset) return
      setActiveExampleKey(null)
      setWeights({ ...preset.weights })
      setMethodSettings((current) => ({ ...current, ...preset.methodSettings }))
      if (preset.recommendedBoundarySource) {
        setBoundarySource(preset.recommendedBoundarySource)
      }
      if (preset.recommendedBoundaryLevel) {
        if (preset.recommendedBoundarySource === 'bcHealth') {
          setHealthBoundaryLevel(parseHealthBoundaryLevel(preset.recommendedBoundaryLevel))
        } else if (preset.recommendedBoundarySource === 'census') {
          setCensusBoundaryLevel(parseCensusBoundaryLevel(preset.recommendedBoundaryLevel))
        } else if (preset.recommendedBoundarySource === 'cityPG') {
          setCityBoundaryLevel(parseCityBoundaryLevel(preset.recommendedBoundaryLevel))
        }
      }
      const neededSources = getScoreDataSourcesForWeights(preset.weights)
      setEnabledDataSources(neededSources)
      setSelectedNetworks(neededSources.includes('airQuality') ? allNetworks : [])
      setShowPoints(neededSources.includes('airQuality'))
    },
    [allNetworks],
  )

  const handleAddMetric = useCallback(
    (metric: ScoreMetricKey, value: number) => {
      handleWeightChange(metric, value)
      const definition = SCORE_METRICS.find((entry) => entry.key === metric)
      const source = definition ? metricToDataSource(definition.category) : null
      if (!source) return
      setEnabledDataSources((current) => (current.includes(source) ? current : [...current, source]))
      if (source === 'airQuality') {
        setSelectedNetworks((current) => (current.length ? current : allNetworks))
      }
    },
    [allNetworks, handleWeightChange],
  )

  const handleShareUrl = useCallback(async () => {
    const token = await encodeScoreBuilderShareState({
      version: 1,
      boundarySource,
      healthBoundaryLevel,
      censusBoundaryLevel,
      cityBoundaryLevel,
      enabledDataSources,
      selectedNetworks,
      weights,
      methodSettings,
    })
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('s', token)
    window.history.replaceState(null, '', url)
    try {
      await navigator.clipboard?.writeText(url.toString())
    } catch {
      // The URL is still visible in the address bar if clipboard permissions are unavailable.
    }
    return url.toString()
  }, [
    boundarySource,
    censusBoundaryLevel,
    cityBoundaryLevel,
    enabledDataSources,
    healthBoundaryLevel,
    methodSettings,
    selectedNetworks,
    weights,
  ])

  const toggleNetwork = useCallback((network: string) => {
    setSelectedNetworks((current) => {
      if (current.includes(network)) return current.filter((entry) => entry !== network)
      return [...current, network]
    })
  }, [])

  const selectAllNetworks = useCallback(() => {
    setSelectedNetworks(allNetworks)
  }, [allNetworks])
  const clearNetworks = useCallback(() => {
    setSelectedNetworks([])
  }, [])

  const handleRegionLevelChange = useCallback(
    (level: RegionLevel) => {
      if (boundarySource === 'bcHealth') setHealthBoundaryLevel(parseHealthBoundaryLevel(level))
      else if (boundarySource === 'census') setCensusBoundaryLevel(parseCensusBoundaryLevel(level))
      else setCityBoundaryLevel(parseCityBoundaryLevel(level))
    },
    [boundarySource],
  )

  const handleOpenRegionInsight = useCallback((regionId: string) => {
    setSelectedRegionId(regionId)
    setRegionInsightRegionId(regionId)
    setRegionInsightOpen(true)
  }, [])

  const handleRegionInsightOpenChange = useCallback((open: boolean) => {
    setRegionInsightOpen(open)
    if (!open) setRegionInsightRegionId(null)
  }, [])

  const toggleDataSource = useCallback((source: ScoreDataSource) => {
    setEnabledDataSources((current) => {
      if (current.includes(source)) return current.filter((s) => s !== source)
      return [...current, source]
    })
  }, [])

  const toggleComparison = useCallback((regionId: string) => {
    setComparisonIds((current) => {
      if (current.includes(regionId)) return current.filter((id) => id !== regionId)
      if (current.length >= 3) return current
      return [...current, regionId]
    })
  }, [])

  const clearComparison = useCallback(() => {
    setComparisonIds([])
  }, [])

  const toggleScoreFilter = useCallback((filter: ScoreFilterKey) => {
    setScoreFilters((current) => ({ ...current, [filter]: !current[filter] }))
  }, [])

  const handleExport = useCallback(
    (format: 'csv' | 'geojson') => {
      if (format === 'csv') {
        const metricKeys = SCORE_METRICS.map((m) => m.key)
        const header = [
          'Rank',
          'Rank confidence',
          'Rank interval',
          'Score',
          'Score interval',
          'Comparison universe',
          'Name',
          'Code',
          'Area (km²)',
          ...SCORE_METRICS.map((m) => m.label),
        ]
        const rows = scoredRegions.map((r) => [
          r.rank,
          r.rankConfidence,
          `${r.rankInterval[0]}-${r.rankInterval[1]}`,
          r.score.toFixed(1),
          `${r.scoreInterval[0].toFixed(1)}-${r.scoreInterval[1].toFixed(1)}`,
          r.comparisonUniverseLabel,
          r.region.name,
          r.region.code,
          r.region.areaKm2.toFixed(1),
          ...metricKeys.map((k) => r.metrics[k].toFixed(4)),
        ])
        const csv = [header.join(','), ...rows.map((r) => r.map((v) => `"${v}"`).join(','))].join('\n')
        downloadBlob(csv, 'score-builder-regions.csv', 'text/csv')
      } else {
        const fc: GeoJSON.FeatureCollection = {
          type: 'FeatureCollection',
          features: scoredRegions.map((r) => ({
            type: 'Feature',
            geometry: r.region.feature.geometry,
            properties: {
              rank: r.rank,
              name: r.region.name,
              code: r.region.code,
              score: r.score,
              rankConfidence: r.rankConfidence,
              rankInterval: r.rankInterval,
              scoreInterval: r.scoreInterval,
              comparisonUniverse: r.comparisonUniverseLabel,
              equityAudit: r.equityAudit,
              areaKm2: r.region.areaKm2,
              ...Object.fromEntries(SCORE_METRICS.map((m) => [m.key, r.metrics[m.key]])),
            },
          })),
        }
        downloadBlob(JSON.stringify(fc, null, 2), 'score-builder-regions.geojson', 'application/geo+json')
      }
    },
    [scoredRegions],
  )

  const loading =
    loadingMonitors ||
    loadingRegions ||
    loadingParks ||
    loadingRestaurants ||
    loadingCensus ||
    loadingProperties ||
    loadingCrime ||
    loadingHeatShade ||
    loadingTransit ||
    loadingCimd
  const dataErrors = useMemo(() => {
    const errors: string[] = []
    if (monitorsError) errors.push(monitorsError)
    if (regionsError) errors.push(regionsError)
    if (parksError) errors.push(parksError)
    if (restaurantsError) errors.push(restaurantsError)
    if (censusError) errors.push(censusError)
    if (propertiesError) errors.push(propertiesError)
    if (crimeError) errors.push(crimeError)
    if (heatShadeError) errors.push(heatShadeError)
    if (transitError) errors.push(transitError)
    if (cimdError) errors.push(cimdError)
    return errors
  }, [
    monitorsError,
    regionsError,
    parksError,
    restaurantsError,
    censusError,
    propertiesError,
    crimeError,
    heatShadeError,
    transitError,
    cimdError,
  ])

  const desktopLeftPanel = (
    <ScoreBuilderLeftPanel
      boundarySource={boundarySource}
      onBoundarySourceChange={setBoundarySource}
      selectedRegionLevel={selectedRegionLevel}
      onRegionLevelChange={handleRegionLevelChange}
      boundaryLevelOptions={boundaryLevelOptions}
      enabledDataSources={enabledDataSources}
      onToggleDataSource={toggleDataSource}
      networkCounts={networkCounts}
      selectedNetworks={selectedNetworks}
      onToggleNetwork={toggleNetwork}
      onSelectAllNetworks={selectAllNetworks}
      onClearNetworks={clearNetworks}
      showPoints={showPoints}
      onTogglePoints={() => setShowPoints((current) => !current)}
      regionCount={scoredRegions.length}
    />
  )

  const desktopRightPanel = (
    <ScoreBuilderRightPanel
      loading={loading}
      dataErrors={dataErrors}
      weights={weights}
      onWeightChange={handleWeightChange}
      onAddMetric={handleAddMetric}
      onApplyPreset={handleApplyPreset}
      boundarySource={boundarySource}
      activePresetKey={activePresetKey}
      equationPreview={equationPreview}
      metricRanges={metricRanges}
      scoreSpread={scoreSpread}
      densityMetric={densityMetric}
      onDensityMetricChange={setDensityMetric}
      densitySummary={densitySummary}
      densityLeaders={densityLeaders}
      regions={scoredRegions}
      totalRegionCount={unfilteredScoredRegions.length}
      excludedRegionCount={Math.max(0, unfilteredScoredRegions.length - scoredRegions.length)}
      scoreFilters={scoreFilters}
      onToggleScoreFilter={toggleScoreFilter}
      methodSettings={methodSettings}
      onMethodSettingsChange={setMethodSettings}
      componentSummaries={componentSummaries}
      robustnessResults={robustnessResults}
      scoreBands={scoreBands}
      scenarioComparison={scenarioComparison}
      filteredRegions={filteredRegions}
      selectedRegion={selectedRegion}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onRegionSelect={setSelectedRegionId}
      onClearRegionSelection={() => setSelectedRegionId(null)}
      onOpenRegionInsight={handleOpenRegionInsight}
      comparisonIds={comparisonIds}
      comparisonRegions={comparisonRegions}
      onToggleComparison={toggleComparison}
      onClearComparison={clearComparison}
      onExport={handleExport}
      onShareUrl={handleShareUrl}
      activeExampleKey={resolvedExampleKey}
      onApplyExample={applyExample}
      isDesktop={isDesktop}
    />
  )

  const mobileSidebar = (
    <ScoreBuilderSidebar
      className="h-full w-full border-0 shadow-none"
      loading={loading}
      dataErrors={dataErrors}
      boundarySource={boundarySource}
      onBoundarySourceChange={setBoundarySource}
      selectedRegionLevel={selectedRegionLevel}
      onRegionLevelChange={handleRegionLevelChange}
      boundaryLevelOptions={boundaryLevelOptions}
      networkCounts={networkCounts}
      selectedNetworks={selectedNetworks}
      onToggleNetwork={toggleNetwork}
      onSelectAllNetworks={selectAllNetworks}
      onClearNetworks={clearNetworks}
      showPoints={showPoints}
      onTogglePoints={() => setShowPoints((current) => !current)}
      enabledDataSources={enabledDataSources}
      onToggleDataSource={toggleDataSource}
      weights={weights}
      onWeightChange={handleWeightChange}
      onApplyPreset={handleApplyPreset}
      activePresetKey={activePresetKey}
      equationPreview={equationPreview}
      scoreSpread={scoreSpread}
      densityMetric={densityMetric}
      onDensityMetricChange={setDensityMetric}
      densitySummary={densitySummary}
      densityLeaders={densityLeaders}
      regions={scoredRegions}
      totalRegionCount={unfilteredScoredRegions.length}
      excludedRegionCount={Math.max(0, unfilteredScoredRegions.length - scoredRegions.length)}
      scoreFilters={scoreFilters}
      onToggleScoreFilter={toggleScoreFilter}
      methodSettings={methodSettings}
      onMethodSettingsChange={setMethodSettings}
      componentSummaries={componentSummaries}
      robustnessResults={robustnessResults}
      scoreBands={scoreBands}
      scenarioComparison={scenarioComparison}
      filteredRegions={filteredRegions}
      selectedRegion={selectedRegion}
      searchQuery={searchQuery}
      onSearchQueryChange={setSearchQuery}
      onRegionSelect={setSelectedRegionId}
      onClearRegionSelection={() => setSelectedRegionId(null)}
      onOpenRegionInsight={handleOpenRegionInsight}
      comparisonIds={comparisonIds}
      comparisonRegions={comparisonRegions}
      onToggleComparison={toggleComparison}
      onClearComparison={clearComparison}
      onExport={handleExport}
      onShareUrl={handleShareUrl}
      activeExampleKey={resolvedExampleKey}
      onApplyExample={applyExample}
      isDesktop={isDesktop}
    />
  )

  return (
    <>
      <MapSectionLayout
        showDesktopSidebar={showSidebar}
        onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
        desktopSidebarWidth={300}
        mobileInitialSheetState="half"
        sidebar={isDesktop ? desktopLeftPanel : mobileSidebar}
        rightSidebar={isDesktop ? desktopRightPanel : undefined}
        showDesktopRightSidebar={showRightSidebar}
        onToggleDesktopRightSidebar={() => setShowRightSidebar((current) => !current)}
        desktopRightSidebarWidth={380}
      >
        <div className="relative flex h-full min-h-0 flex-col">
          {isDesktop && (
            <ScoreBuilderEquationBar
              weights={weights}
              activePresetKey={activePresetKey}
              activeRecipeLabel={activeExample?.label || activePreset?.label || 'Custom index'}
              activeRecipeDescription={
                activeExample
                  ? activeExample.question
                  : activePreset
                    ? activePreset.description
                    : 'Custom weights saved in the URL.'
              }
              boundarySource={boundarySource}
              equationPreview={equationPreview}
              onWeightChange={handleWeightChange}
              onAddMetric={handleAddMetric}
              onApplyPreset={handleApplyPreset}
              onExport={handleExport}
            />
          )}

          <div className="relative min-h-0 flex-1">
            <ScoreBuilderMap
              regions={scoredRegions}
              selectedRegionId={selectedRegionId}
              monitors={filteredMonitors}
              showPoints={showPoints}
              paletteProfile={scorePaletteProfile}
              onRegionClick={setSelectedRegionId}
            />

            <div className="absolute bottom-24 right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
              <h4 className="mb-2 text-xs font-semibold text-foreground">{scorePaletteProfile.label}</h4>
              <div
                className="h-2 w-44 rounded"
                style={{ background: `linear-gradient(to right, ${scorePaletteProfile.colors.join(', ')})` }}
              />
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{scorePaletteProfile.legend.low}</span>
                <span>{scorePaletteProfile.legend.high}</span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-muted-foreground">
                <div>
                  <div className="uppercase">Min</div>
                  <div className="font-medium text-foreground">{scoreSpread.min.toFixed(1)}</div>
                </div>
                <div>
                  <div className="uppercase">Avg</div>
                  <div className="font-medium text-foreground">{scoreSpread.average.toFixed(1)}</div>
                </div>
                <div>
                  <div className="uppercase">Max</div>
                  <div className="font-medium text-foreground">{scoreSpread.max.toFixed(1)}</div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-muted-foreground">
                {enabledDataSources.length} data source(s) active across {regions.length} regions.
              </div>
              <div className="mt-1 text-[10px] leading-snug text-muted-foreground">{normalizationLegendText}</div>
              {thinCoverageCount > 0 && (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                  {thinCoverageCount} region{thinCoverageCount === 1 ? '' : 's'} have thin active-data coverage.
                </div>
              )}
            </div>
          </div>
        </div>
      </MapSectionLayout>

      <ScoreBuilderRegionInsightDialog
        open={regionInsightOpen}
        onOpenChange={handleRegionInsightOpenChange}
        region={regionInsightRegion}
        weights={weights}
        methodSettings={methodSettings}
        isMobile={!isDesktop}
      />
    </>
  )
}

function downloadBlob(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
