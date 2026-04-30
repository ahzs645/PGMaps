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
  type RegionLevel
} from '@/maps/airquality'
import { useCensusData } from '@/maps/census/hooks/useCensusData'
import { useRestaurantData } from '@/maps/foodmap/hooks/useRestaurantData'
import { useParksData } from '@/maps/parks/hooks/useParksData'
import { useBcAssessmentData } from '@/maps/bcassessment/hooks/useBcAssessmentData'
import { useCrimeData } from '@/maps/pgdata/hooks/useCrimeData'
import {
  CENSUS_BOUNDARY_LEVEL_OPTIONS,
  HEALTH_BOUNDARY_LEVEL_OPTIONS,
  SCORE_METRICS,
  SCORE_EXAMPLES,
  createDefaultWeights,
  createMetricValueMap,
  getScorePaletteColor,
  getScorePaletteProfile,
  LOW_COST_NETWORKS,
  SCORE_PRESETS,
  encodeWeightsToParams,
  decodeWeightsFromParams
} from './constants'
import { ScoreBuilderMap } from './components/ScoreBuilderMap'
import { ScoreBuilderRegionInsightDialog } from './components/ScoreBuilderRegionInsightDialog'
import { ScoreBuilderSidebar } from './components/ScoreBuilderSidebar'
import { ScoreBuilderLeftPanel } from './components/ScoreBuilderLeftPanel'
import { ScoreBuilderRightPanel } from './components/ScoreBuilderRightPanel'
import { useMediaQuery } from './hooks/useMediaQuery'
import { useScoreBuilderRegions } from './hooks/useScoreBuilderRegions'
import type {
  RegionDataCounts,
  ScoredBoundaryRegion,
  ScoreDataSource,
  ScoreMetricKey,
  ScoreMetricWeightMap
} from './types'

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

function normalizeMetric(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return 0.5
  return Math.max(0, Math.min(1, (value - min) / (max - min)))
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function computeMedian(values: number[]): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[midpoint]
  return (sorted[midpoint - 1] + sorted[midpoint]) / 2
}

function bboxCenter(geometry: GeoJSON.Geometry): [number, number] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
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

function hazardWeight(rating: string | null | undefined): number {
  switch ((rating || '').toLowerCase()) {
    case 'moderate': return 0.7
    case 'low': return 0.3
    default: return 0.5
  }
}

function computeValueGrowth(history: number[] | null | undefined): number | null {
  if (!history || history.length < 2) return null
  const first = history[0]
  const last = history[history.length - 1]
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null
  return (last - first) / first
}

function metricToDataSource(category: string): ScoreDataSource | null {
  if (category === 'airQuality') return 'airQuality'
  if (category === 'parksRec') return 'parks'
  if (category === 'foodSafety') return 'restaurants'
  if (category === 'demographics') return 'census'
  if (category === 'property') return 'bcAssessment'
  if (category === 'safety') return 'crime'
  return null
}

function scoreDataSourcesEqual(a: ScoreDataSource[], b: ScoreDataSource[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((source) => bSet.has(source))
}

function scoreWeightsEqual(a: ScoreMetricWeightMap, b: ScoreMetricWeightMap): boolean {
  return SCORE_METRICS.every((metric) => a[metric.key] === b[metric.key])
}

function isInRegion(
  lng: number, lat: number,
  feature: GeoJSON.Feature<GeoJSON.Point>,
  region: { bounds: [number, number, number, number]; feature: GeoJSON.Feature }
): boolean {
  const [west, south, east, north] = region.bounds
  if (lng < west || lng > east || lat < south || lat > north) return false
  return booleanPointInPolygon(feature, region.feature as GeoJSON.Feature<GeoJSON.Polygon | GeoJSON.MultiPolygon>)
}

const ALL_DATA_SOURCES: ScoreDataSource[] = ['airQuality', 'parks', 'restaurants', 'census', 'bcAssessment', 'crime']
const CURRENT_YEAR = new Date().getFullYear()

export default function ScoreBuilderSection() {
  const [searchParams, setSearchParams] = useSearchParams()

  const { monitors, loading: loadingMonitors, error: monitorsError } = useAirQualityData()
  const { parks, trails, amenities, loading: loadingParks, error: parksError } = useParksData()
  const { restaurants, loading: loadingRestaurants, error: restaurantsError } = useRestaurantData()
  const { unitsByLevel, loading: loadingCensus, error: censusError } = useCensusData()

  const [showSidebar, setShowSidebar] = useState(true)
  const [showRightSidebar, setShowRightSidebar] = useState(true)
  const [boundarySource, setBoundarySource] = useState<BoundarySource>(
    () => (searchParams.get('src') as BoundarySource) || 'bcHealth'
  )
  const [healthBoundaryLevel, setHealthBoundaryLevel] = useState<BoundaryLevel>(
    () => (searchParams.get('level') as BoundaryLevel) || 'lha'
  )
  const [censusBoundaryLevel, setCensusBoundaryLevel] = useState<CensusBoundaryLevel>(
    () => (searchParams.get('level') as CensusBoundaryLevel) || 'csd'
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
  const [enabledDataSources, setEnabledDataSources] = useState<ScoreDataSource[]>(
    () => {
      const fromUrl = searchParams.get('ds')
      if (fromUrl) {
        const parsed = fromUrl.split(',').filter((s) => ALL_DATA_SOURCES.includes(s as ScoreDataSource)) as ScoreDataSource[]
        if (parsed.length) return parsed
      }
      return ['airQuality']
    }
  )
  const [comparisonIds, setComparisonIds] = useState<string[]>([])
  const [activeExampleKey, setActiveExampleKey] = useState<string | null>(() => {
    // If no URL params, auto-load first example
    if (!searchParams.get('w')) return SCORE_EXAMPLES[0]?.key || null
    return null
  })
  const isDesktop = useMediaQuery('(min-width: 768px)')

  // URL persistence
  useEffect(() => {
    const params = new URLSearchParams()
    params.set('src', boundarySource)
    params.set('level', boundarySource === 'bcHealth' ? healthBoundaryLevel : censusBoundaryLevel)
    params.set('w', encodeWeightsToParams(weights))
    params.set('ds', enabledDataSources.join(','))
    setSearchParams(params, { replace: true })
  }, [boundarySource, healthBoundaryLevel, censusBoundaryLevel, weights, enabledDataSources, setSearchParams])

  const selectedRegionLevel: RegionLevel = boundarySource === 'bcHealth'
    ? healthBoundaryLevel
    : censusBoundaryLevel

  const boundaryLevelOptions = useMemo<Array<{ value: RegionLevel; label: string }>>(() => {
    if (boundarySource === 'bcHealth') {
      return HEALTH_BOUNDARY_LEVEL_OPTIONS.map((option) => ({
        value: option.value, label: option.label
      }))
    }
    return CENSUS_BOUNDARY_LEVEL_OPTIONS.map((option) => ({
      value: option.value, label: option.label
    }))
  }, [boundarySource])

  const {
    regions,
    loading: loadingRegions,
    error: regionsError
  } = useScoreBuilderRegions(boundarySource, selectedRegionLevel)

  const enabledSourceSet = useMemo(() => new Set(enabledDataSources), [enabledDataSources])
  const { properties, loading: loadingProperties, error: propertiesError } = useBcAssessmentData(enabledSourceSet.has('bcAssessment'))
  const { incidents, loading: loadingCrime, error: crimeError } = useCrimeData(enabledSourceSet.has('crime'))

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
      feature: point([monitor.longitude, monitor.latitude])
    }))
  }, [filteredMonitors])

  // Park centroid points
  const parkPointRecords = useMemo<Array<PointRecord & { areaSqKm: number }>>(() => {
    if (!enabledSourceSet.has('parks')) return []
    return parks.map((park) => {
      const center = bboxCenter(park.geometry)
      if (!center) return null
      return {
        lng: center[0], lat: center[1],
        feature: point(center),
        areaSqKm: (park.area || 0) / 1_000_000
      }
    }).filter(Boolean) as Array<PointRecord & { areaSqKm: number }>
  }, [enabledSourceSet, parks])

  // Trail midpoint points
  const trailPointRecords = useMemo<Array<PointRecord & { lengthKm: number }>>(() => {
    if (!enabledSourceSet.has('parks')) return []
    return trails.filter((t) => t.coordinates.length >= 2).map((trail) => {
      const mid = Math.floor(trail.coordinates.length / 2)
      const [lng, lat] = trail.coordinates[mid]
      return {
        lng, lat,
        feature: point([lng, lat]),
        lengthKm: (trail.length || 0) / 1000
      }
    })
  }, [enabledSourceSet, trails])

  // Amenity points
  const amenityPointRecords = useMemo<PointRecord[]>(() => {
    if (!enabledSourceSet.has('parks')) return []
    return amenities
      .filter((a) => Number.isFinite(a.latitude) && Number.isFinite(a.longitude))
      .map((a) => ({
        lng: a.longitude, lat: a.latitude,
        feature: point([a.longitude, a.latitude])
      }))
  }, [amenities, enabledSourceSet])

  // Restaurant points
  const restaurantPointRecords = useMemo<Array<PointRecord & {
    hazard: number
    inspectionCount: number
    criticalViolations: number
    followUps: number
  }>>(() => {
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
          criticalViolations: inspections.reduce((sum, inspection) => sum + (inspection.critical_violations_count || 0), 0),
          followUps: inspections.reduce((sum, inspection) => (
            sum + (String(inspection.follow_up_required || '').toLowerCase() === 'yes' ? 1 : 0)
          ), 0)
        }
      })
  }, [enabledSourceSet, restaurants])

  // Census DA centroid points
  const censusPointRecords = useMemo<Array<PointRecord & { population: number }>>(() => {
    if (!enabledSourceSet.has('census')) return []
    return unitsByLevel.da.map((unit) => {
      const center = bboxCenter(unit.geometry)
      if (!center) return null
      return {
        lng: center[0], lat: center[1],
        feature: point(center),
        population: unit.population || 0
      }
    }).filter(Boolean) as Array<PointRecord & { population: number }>
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
        da: property.da
      }))
  }, [enabledSourceSet, properties])

  const crimePointRecords = useMemo<CrimePointRecord[]>(() => {
    if (!enabledSourceSet.has('crime')) return []
    const validIncidents = incidents.filter((incident) => (
      Number.isFinite(incident.latitude) && Number.isFinite(incident.longitude) && !Number.isNaN(incident.date.getTime())
    ))
    const latestTime = validIncidents.reduce((latest, incident) => Math.max(latest, incident.date.getTime()), 0)
    const recentCutoff = latestTime > 0 ? latestTime - 180 * 24 * 60 * 60 * 1000 : 0
    return validIncidents.map((incident) => ({
      lng: incident.longitude,
      lat: incident.latitude,
      feature: point([incident.longitude, incident.latitude]),
      date: incident.date,
      recent: recentCutoff > 0 && incident.date.getTime() >= recentCutoff
    }))
  }, [enabledSourceSet, incidents])

  const regionMetricRows = useMemo(() => {
    return regions.map((region) => {
      const counts: RegionDataCounts = {
        monitorCount: 0, lowCostCount: 0, referenceCount: 0, activeCount: 0,
        parkCount: 0, parkAreaSqKm: 0, trailCount: 0, trailLengthKm: 0,
        amenityCount: 0, restaurantCount: 0, restaurantHazardSum: 0,
        inspectionCount: 0, criticalViolationCount: 0, followUpInspectionCount: 0,
        populationSum: 0,
        parcelCount: 0, assessedValueSum: 0, landValueSum: 0, buildingValueSum: 0,
        propertyGrowthSum: 0, propertyGrowthCount: 0, yearBuiltSum: 0, yearBuiltCount: 0,
        vacantParcelCount: 0, multiFamilyParcelCount: 0, commercialParcelCount: 0,
        crimeCount: 0, recentCrimeCount: 0
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
        monitor.parameters.forEach((p) => { const n = p.trim(); if (n) parameters.add(n) })
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
        const directCensusMatch = region.source === 'census'
          && (region.level === 'ct' || region.level === 'da')
          && rec[region.level as 'ct' | 'da'] === region.code
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

      const safeArea = region.areaKm2 > 0 ? region.areaKm2 : 1
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
      metricValues.restaurantDensity = counts.restaurantCount / safeArea
      metricValues.foodRiskScore = counts.restaurantCount > 0 ? counts.restaurantHazardSum / counts.restaurantCount : 0
      metricValues.criticalViolationRate = counts.inspectionCount > 0 ? counts.criticalViolationCount / counts.inspectionCount : 0
      metricValues.followUpRate = counts.inspectionCount > 0 ? counts.followUpInspectionCount / counts.inspectionCount : 0
      metricValues.populationDensity = counts.populationSum / safeArea
      metricValues.parcelDensity = counts.parcelCount / safeArea
      metricValues.avgAssessedValue = counts.parcelCount > 0 ? counts.assessedValueSum / counts.parcelCount : 0
      metricValues.valueGrowth10y = counts.propertyGrowthCount > 0 ? counts.propertyGrowthSum / counts.propertyGrowthCount : 0
      metricValues.buildingAge = counts.yearBuiltCount > 0 ? Math.max(0, CURRENT_YEAR - (counts.yearBuiltSum / counts.yearBuiltCount)) : 0
      metricValues.vacantParcelShare = counts.parcelCount > 0 ? counts.vacantParcelCount / counts.parcelCount : 0
      metricValues.multiFamilyShare = counts.parcelCount > 0 ? counts.multiFamilyParcelCount / counts.parcelCount : 0
      metricValues.commercialShare = counts.parcelCount > 0 ? counts.commercialParcelCount / counts.parcelCount : 0
      metricValues.landValueShare = counts.assessedValueSum > 0 ? counts.landValueSum / counts.assessedValueSum : 0
      metricValues.crimeDensity = counts.crimeCount / safeArea
      metricValues.crimePerCapita = counts.populationSum > 0 ? counts.crimeCount / counts.populationSum : 0
      metricValues.recentCrimeShare = counts.crimeCount > 0 ? counts.recentCrimeCount / counts.crimeCount : 0

      return { region, metrics: metricValues, counts }
    })
  }, [monitorPointRecords, parkPointRecords, trailPointRecords, amenityPointRecords, restaurantPointRecords, censusPointRecords, propertyPointRecords, crimePointRecords, regions])

  const metricRanges = useMemo(() => {
    return SCORE_METRICS.reduce((accumulator, metric) => {
      const values = regionMetricRows
        .map((row) => row.metrics[metric.key])
        .filter((value) => Number.isFinite(value))
      const min = values.length ? Math.min(...values) : 0
      const max = values.length ? Math.max(...values) : 1
      return { ...accumulator, [metric.key]: { min, max } }
    }, {} as Record<ScoreMetricKey, { min: number; max: number }>)
  }, [regionMetricRows])

  const totalAbsoluteWeight = useMemo(() => {
    return SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
  }, [weights])

  const activePresetKey = useMemo(() => {
    const match = SCORE_PRESETS.find((preset) => scoreWeightsEqual(preset.weights, weights))
    return match?.key || null
  }, [weights])

  const inferredExampleKey = useMemo(() => {
    const match = SCORE_EXAMPLES.find((example) => (
      example.boundarySource === boundarySource
      && example.boundaryLevel === selectedRegionLevel
      && scoreDataSourcesEqual(example.dataSources, enabledDataSources)
      && scoreWeightsEqual(example.weights, weights)
    ))
    return match?.key || null
  }, [boundarySource, enabledDataSources, selectedRegionLevel, weights])

  const resolvedExampleKey = activeExampleKey || inferredExampleKey

  const scorePaletteProfile = useMemo(() => {
    return getScorePaletteProfile(activePresetKey, resolvedExampleKey)
  }, [activePresetKey, resolvedExampleKey])

  const scoredRegions = useMemo<ScoredBoundaryRegion[]>(() => {
    const ranked = regionMetricRows.map((row) => {
      const normalizedMetrics = createMetricValueMap(0)
      const contributions = createMetricValueMap(0)
      let rawScore = 0

      SCORE_METRICS.forEach((metric) => {
        const value = row.metrics[metric.key]
        const range = metricRanges[metric.key]
        const normalizedValue = normalizeMetric(value, range.min, range.max)
        const weight = weights[metric.key]
        const directionalValue = weight >= 0 ? normalizedValue : 1 - normalizedValue
        normalizedMetrics[metric.key] = normalizedValue
        contributions[metric.key] = totalAbsoluteWeight > 0
          ? (Math.abs(weight) * directionalValue) / totalAbsoluteWeight
          : 0
        rawScore += contributions[metric.key]
      })

      const score = totalAbsoluteWeight > 0
        ? clampScore(rawScore * 100)
        : 50

      return { ...row, normalizedMetrics, contributions, score, scoreColor: getScorePaletteColor(score, scorePaletteProfile), rank: 0 }
    })

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.metrics.overallDensity !== a.metrics.overallDensity) return b.metrics.overallDensity - a.metrics.overallDensity
      return a.region.name.localeCompare(b.region.name)
    })

    return ranked.map((row, index) => ({ ...row, rank: index + 1 }))
  }, [metricRanges, regionMetricRows, scorePaletteProfile, totalAbsoluteWeight, weights])

  const filteredRegions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return scoredRegions
    return scoredRegions.filter((entry) => (
      entry.region.name.toLowerCase().includes(query) || entry.region.code.toLowerCase().includes(query)
    ))
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

  const scoreSpread = useMemo(() => {
    if (!scoredRegions.length) return { min: 0, max: 0, average: 0 }
    const values = scoredRegions.map((entry) => entry.score)
    const sum = values.reduce((total, value) => total + value, 0)
    return { min: Math.min(...values), max: Math.max(...values), average: sum / values.length }
  }, [scoredRegions])

  const densitySummary = useMemo(() => {
    const values = scoredRegions
      .map((entry) => entry.metrics[densityMetric])
      .filter((value) => Number.isFinite(value))
    if (!values.length) return null
    const sum = values.reduce((total, value) => total + value, 0)
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      median: computeMedian(values),
      average: sum / values.length
    }
  }, [densityMetric, scoredRegions])

  const densityLeaders = useMemo(() => {
    return [...scoredRegions]
      .sort((a, b) => b.metrics[densityMetric] - a.metrics[densityMetric])
      .slice(0, 3)
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

  const handleWeightChange = useCallback((metric: ScoreMetricKey, value: number) => {
    setActiveExampleKey(null)
    setWeights((current) => ({ ...current, [metric]: value }))
  }, [])

  const applyExample = useCallback((exampleKey: string) => {
    const example = SCORE_EXAMPLES.find((e) => e.key === exampleKey)
    if (!example) return
    setActiveExampleKey(exampleKey)
    setBoundarySource(example.boundarySource)
    if (example.boundarySource === 'bcHealth') {
      setHealthBoundaryLevel(example.boundaryLevel as BoundaryLevel)
    } else {
      setCensusBoundaryLevel(example.boundaryLevel as CensusBoundaryLevel)
    }
    setEnabledDataSources([...example.dataSources])
    setWeights({ ...example.weights })
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
  }, [allNetworks])

  // Auto-apply first example on mount (once networks are loaded)
  const appliedInitialExample = useRef(false)
  useEffect(() => {
    if (appliedInitialExample.current) return
    if (!activeExampleKey || allNetworks.length === 0) return
    // Only auto-apply if no URL weights were provided
    if (searchParams.get('w')) { appliedInitialExample.current = true; return }
    appliedInitialExample.current = true
    applyExample(activeExampleKey)
  }, [activeExampleKey, allNetworks, applyExample, searchParams])

  const handleApplyPreset = useCallback((presetKey: string) => {
    const preset = SCORE_PRESETS.find((entry) => entry.key === presetKey)
    if (!preset) return
    setActiveExampleKey(null)
    setWeights({ ...preset.weights })
    // Auto-enable data sources used by preset
    const needed = new Set<ScoreDataSource>()
    SCORE_METRICS.forEach((m) => {
      if (preset.weights[m.key] !== 0) {
        const source = metricToDataSource(m.category)
        if (source) needed.add(source)
      }
    })
    setEnabledDataSources(Array.from(needed))
  }, [])

  const toggleNetwork = useCallback((network: string) => {
    setSelectedNetworks((current) => {
      if (current.includes(network)) return current.filter((entry) => entry !== network)
      return [...current, network]
    })
  }, [])

  const selectAllNetworks = useCallback(() => { setSelectedNetworks(allNetworks) }, [allNetworks])
  const clearNetworks = useCallback(() => { setSelectedNetworks([]) }, [])

  const handleRegionLevelChange = useCallback((level: RegionLevel) => {
    if (boundarySource === 'bcHealth') setHealthBoundaryLevel(level as BoundaryLevel)
    else setCensusBoundaryLevel(level as CensusBoundaryLevel)
  }, [boundarySource])

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

  const clearComparison = useCallback(() => { setComparisonIds([]) }, [])

  const handleExport = useCallback((format: 'csv' | 'geojson') => {
    if (format === 'csv') {
      const metricKeys = SCORE_METRICS.map((m) => m.key)
      const header = ['Rank', 'Name', 'Code', 'Score', 'Area (km²)', ...SCORE_METRICS.map((m) => m.label)]
      const rows = scoredRegions.map((r) => [
        r.rank, r.region.name, r.region.code, r.score.toFixed(1), r.region.areaKm2.toFixed(1),
        ...metricKeys.map((k) => r.metrics[k].toFixed(4))
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
            rank: r.rank, name: r.region.name, code: r.region.code,
            score: r.score, areaKm2: r.region.areaKm2,
            ...Object.fromEntries(SCORE_METRICS.map((m) => [m.key, r.metrics[m.key]]))
          }
        }))
      }
      downloadBlob(JSON.stringify(fc, null, 2), 'score-builder-regions.geojson', 'application/geo+json')
    }
  }, [scoredRegions])

  const loading = loadingMonitors || loadingRegions || loadingParks || loadingRestaurants || loadingCensus || loadingProperties || loadingCrime
  const dataErrors = useMemo(() => {
    const errors: string[] = []
    if (monitorsError) errors.push(monitorsError)
    if (regionsError) errors.push(regionsError)
    if (parksError) errors.push(parksError)
    if (restaurantsError) errors.push(restaurantsError)
    if (censusError) errors.push(censusError)
    if (propertiesError) errors.push(propertiesError)
    if (crimeError) errors.push(crimeError)
    return errors
  }, [monitorsError, regionsError, parksError, restaurantsError, censusError, propertiesError, crimeError])

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
      onApplyPreset={handleApplyPreset}
      activePresetKey={activePresetKey}
      equationPreview={equationPreview}
      scoreSpread={scoreSpread}
      densityMetric={densityMetric}
      onDensityMetricChange={setDensityMetric}
      densitySummary={densitySummary}
      densityLeaders={densityLeaders}
      regions={scoredRegions}
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
        sidebar={isDesktop ? desktopLeftPanel : mobileSidebar}
        rightSidebar={isDesktop ? desktopRightPanel : undefined}
        showDesktopRightSidebar={showRightSidebar}
        onToggleDesktopRightSidebar={() => setShowRightSidebar((current) => !current)}
        desktopRightSidebarWidth={380}
      >
        <div className="relative h-full">
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
          </div>
        </div>
      </MapSectionLayout>

      <ScoreBuilderRegionInsightDialog
        open={regionInsightOpen}
        onOpenChange={handleRegionInsightOpenChange}
        region={regionInsightRegion}
        weights={weights}
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
