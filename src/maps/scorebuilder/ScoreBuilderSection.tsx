import { useCallback, useEffect, useMemo, useState } from 'react'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point } from '@turf/helpers'
import { MapSectionLayout } from '@/components/layout/MapSectionLayout'
import { useAirQualityData, type AirMonitor, type BoundaryLevel } from '@/maps/airquality'
import {
  SCORE_METRICS,
  createDefaultWeights,
  createMetricValueMap,
  getScoreColor,
  LOW_COST_NETWORKS,
  SCORE_PRESETS
} from './constants'
import { ScoreBuilderMap } from './components/ScoreBuilderMap'
import { ScoreBuilderSidebar } from './components/ScoreBuilderSidebar'
import { useScoreBuilderRegions } from './hooks/useScoreBuilderRegions'
import type {
  ScoredBoundaryRegion,
  ScoreMetricKey,
  ScoreMetricWeightMap
} from './types'

interface MonitorPointRecord {
  monitor: AirMonitor
  feature: GeoJSON.Feature<GeoJSON.Point>
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

  if (sorted.length % 2 === 1) {
    return sorted[midpoint]
  }

  return (sorted[midpoint - 1] + sorted[midpoint]) / 2
}

export default function ScoreBuilderSection() {
  const { monitors, loading: loadingMonitors, error: monitorsError } = useAirQualityData()
  const [showSidebar, setShowSidebar] = useState(true)
  const [boundaryLevel, setBoundaryLevel] = useState<BoundaryLevel>('lha')
  const [selectedRegionId, setSelectedRegionId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedNetworks, setSelectedNetworks] = useState<string[]>([])
  const [weights, setWeights] = useState<ScoreMetricWeightMap>(() => createDefaultWeights())
  const [densityMetric, setDensityMetric] = useState<ScoreMetricKey>('overallDensity')
  const [showPoints, setShowPoints] = useState(true)

  const {
    regions,
    loading: loadingRegions,
    error: regionsError
  } = useScoreBuilderRegions(boundaryLevel)

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
  }, [boundaryLevel])

  const selectedNetworkSet = useMemo(() => new Set(selectedNetworks), [selectedNetworks])
  const hasActiveNetworks = selectedNetworks.length > 0

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

  const regionMetricRows = useMemo(() => {
    if (!hasActiveNetworks) return []

    return regions.map((region) => {
      const [west, south, east, north] = region.bounds
      let monitorCount = 0
      let lowCostCount = 0
      let referenceCount = 0
      let activeCount = 0
      const networks = new Set<string>()
      const parameters = new Set<string>()

      monitorPointRecords.forEach(({ monitor, feature }) => {
        if (
          monitor.longitude < west
          || monitor.longitude > east
          || monitor.latitude < south
          || monitor.latitude > north
        ) {
          return
        }

        if (!booleanPointInPolygon(feature, region.feature)) {
          return
        }

        monitorCount += 1
        if (LOW_COST_NETWORKS.has(monitor.network)) {
          lowCostCount += 1
        } else {
          referenceCount += 1
        }

        if ((monitor.status || '').toLowerCase() === 'active') {
          activeCount += 1
        }

        networks.add(monitor.network)
        monitor.parameters.forEach((parameter) => {
          const normalized = parameter.trim()
          if (normalized) {
            parameters.add(normalized)
          }
        })
      })

      const safeArea = region.areaKm2 > 0 ? region.areaKm2 : 1
      const metricValues = createMetricValueMap(0)
      metricValues.overallDensity = monitorCount / safeArea
      metricValues.lowCostDensity = lowCostCount / safeArea
      metricValues.referenceDensity = referenceCount / safeArea
      metricValues.networkVariety = networks.size
      metricValues.parameterVariety = parameters.size
      metricValues.activeShare = monitorCount > 0 ? activeCount / monitorCount : 0
      metricValues.monitorCount = monitorCount

      return {
        region,
        metrics: metricValues,
        counts: {
          monitorCount,
          lowCostCount,
          referenceCount,
          activeCount
        }
      }
    })
  }, [hasActiveNetworks, monitorPointRecords, regions])

  const metricRanges = useMemo(() => {
    return SCORE_METRICS.reduce((accumulator, metric) => {
      const values = regionMetricRows
        .map((row) => row.metrics[metric.key])
        .filter((value) => Number.isFinite(value))

      const min = values.length ? Math.min(...values) : 0
      const max = values.length ? Math.max(...values) : 1

      return {
        ...accumulator,
        [metric.key]: { min, max }
      }
    }, {} as Record<ScoreMetricKey, { min: number; max: number }>)
  }, [regionMetricRows])

  const totalAbsoluteWeight = useMemo(() => {
    return SCORE_METRICS.reduce((sum, metric) => sum + Math.abs(weights[metric.key]), 0)
  }, [weights])

  const scoredRegions = useMemo<ScoredBoundaryRegion[]>(() => {
    const ranked = regionMetricRows.map((row) => {
      const normalizedMetrics = createMetricValueMap(0)
      const contributions = createMetricValueMap(0)
      let rawScore = 0

      SCORE_METRICS.forEach((metric) => {
        const value = row.metrics[metric.key]
        const range = metricRanges[metric.key]
        const normalizedValue = normalizeMetric(value, range.min, range.max)

        normalizedMetrics[metric.key] = normalizedValue
        contributions[metric.key] = totalAbsoluteWeight > 0
          ? (weights[metric.key] * normalizedValue) / totalAbsoluteWeight
          : 0

        rawScore += contributions[metric.key]
      })

      const score = totalAbsoluteWeight > 0
        ? clampScore(((rawScore + 1) / 2) * 100)
        : 50

      return {
        ...row,
        normalizedMetrics,
        contributions,
        score,
        scoreColor: getScoreColor(score),
        rank: 0
      }
    })

    ranked.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (b.metrics.overallDensity !== a.metrics.overallDensity) {
        return b.metrics.overallDensity - a.metrics.overallDensity
      }
      return a.region.name.localeCompare(b.region.name)
    })

    return ranked.map((row, index) => ({
      ...row,
      rank: index + 1
    }))
  }, [metricRanges, regionMetricRows, totalAbsoluteWeight, weights])

  const filteredRegions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return scoredRegions

    return scoredRegions.filter((entry) => (
      entry.region.name.toLowerCase().includes(query)
      || entry.region.code.toLowerCase().includes(query)
    ))
  }, [scoredRegions, searchQuery])

  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return null
    return scoredRegions.find((entry) => entry.region.id === selectedRegionId) || null
  }, [scoredRegions, selectedRegionId])

  useEffect(() => {
    if (selectedRegionId && !selectedRegion) {
      setSelectedRegionId(null)
    }
  }, [selectedRegion, selectedRegionId])

  const scoreSpread = useMemo(() => {
    if (!scoredRegions.length) {
      return { min: 0, max: 0, average: 0 }
    }

    const values = scoredRegions.map((entry) => entry.score)
    const sum = values.reduce((total, value) => total + value, 0)

    return {
      min: Math.min(...values),
      max: Math.max(...values),
      average: sum / values.length
    }
  }, [scoredRegions])

  const densitySummary = useMemo(() => {
    const values = scoredRegions
      .map((entry) => entry.metrics[densityMetric])
      .filter((value) => Number.isFinite(value))

    if (!values.length) {
      return null
    }

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
    if (!activeTerms.length) {
      return 'No active terms. Move any weight above or below zero.'
    }

    const terms = activeTerms.map((metric) => `${weights[metric.key]}×${metric.shortLabel}`)
    return `score = (${terms.join(' + ')}) / Σ|weight|`
  }, [weights])

  const activePresetKey = useMemo(() => {
    const match = SCORE_PRESETS.find((preset) => (
      SCORE_METRICS.every((metric) => preset.weights[metric.key] === weights[metric.key])
    ))

    return match?.key || null
  }, [weights])

  const handleWeightChange = useCallback((metric: ScoreMetricKey, value: number) => {
    setWeights((current) => ({
      ...current,
      [metric]: value
    }))
  }, [])

  const handleApplyPreset = useCallback((presetKey: string) => {
    const preset = SCORE_PRESETS.find((entry) => entry.key === presetKey)
    if (!preset) return
    setWeights({ ...preset.weights })
  }, [])

  const toggleNetwork = useCallback((network: string) => {
    setSelectedNetworks((current) => {
      if (current.includes(network)) {
        return current.filter((entry) => entry !== network)
      }
      return [...current, network]
    })
  }, [])

  const selectAllNetworks = useCallback(() => {
    setSelectedNetworks(allNetworks)
  }, [allNetworks])

  const clearNetworks = useCallback(() => {
    setSelectedNetworks([])
  }, [])

  return (
    <MapSectionLayout
      showDesktopSidebar={showSidebar}
      onToggleDesktopSidebar={() => setShowSidebar((current) => !current)}
      sidebar={(
        <ScoreBuilderSidebar
          className="h-full w-full border-0 shadow-none md:w-[360px] md:border-r md:shadow-xl"
          loadingMonitors={loadingMonitors}
          loadingRegions={loadingRegions}
          monitorsError={monitorsError}
          regionsError={regionsError}
          boundaryLevel={boundaryLevel}
          onBoundaryLevelChange={setBoundaryLevel}
          networkCounts={networkCounts}
          selectedNetworks={selectedNetworks}
          onToggleNetwork={toggleNetwork}
          onSelectAllNetworks={selectAllNetworks}
          onClearNetworks={clearNetworks}
          showPoints={showPoints}
          onTogglePoints={() => setShowPoints((current) => !current)}
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
        />
      )}
    >
      <div className="relative h-full">
        <ScoreBuilderMap
          regions={scoredRegions}
          selectedRegionId={selectedRegionId}
          monitors={filteredMonitors}
          showPoints={showPoints}
          onRegionClick={setSelectedRegionId}
        />

        <div className="absolute bottom-24 right-4 z-10 rounded-xl border border-border bg-background/95 p-4 shadow-xl backdrop-blur md:bottom-6 md:right-6">
          <h4 className="mb-2 text-xs font-semibold text-foreground">Composite Score</h4>
          <div className="h-2 w-44 rounded bg-gradient-to-r from-red-900 via-orange-600 via-55% to-green-700" />
          <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Lower priority</span>
            <span>Higher priority</span>
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
            Showing {filteredMonitors.length.toLocaleString()} monitors across {selectedNetworks.length.toLocaleString()} active networks.
          </div>
        </div>
      </div>
    </MapSectionLayout>
  )
}
