import type { BoundarySource } from '@/lib/studyArea'
import { SCORE_METRICS } from '../constants'
import type {
  RegionDataCounts,
  ScoreDataSource,
  ScoreMetricDefinition,
  ScoreMetricKey,
  ScoreMetricWeightMap,
} from '../types'
import { DEFAULT_LOCALE } from '@/lib/format'

export function metricToDataSource(category: string): ScoreDataSource | null {
  if (category === 'airQuality') return 'airQuality'
  if (category === 'parksRec') return 'parks'
  if (category === 'heatShade') return 'heatShade'
  if (category === 'foodSafety') return 'restaurants'
  if (category === 'demographics') return 'census'
  if (category === 'property') return 'bcAssessment'
  if (category === 'safety') return 'crime'
  if (category === 'transit') return 'transit'
  if (category === 'walkability') return 'walkability'
  if (category === 'deprivation') return 'deprivation'
  if (category === 'healthyPlanPg') return 'healthyPlanPg'
  if (category === 'bcEnviroScreen') return 'bcEnviroScreen'
  if (category === 'custom') return null
  return null
}

/**
 * Why a weighted metric is contributing nothing to the score right now.
 * `sourceOff` is recoverable in one click; `boundary` needs a different study area.
 */
export type MetricUnavailableReason = 'sourceOff' | 'boundary'

export interface MetricAvailability {
  reason: MetricUnavailableReason
  /** The data source to switch on — only set for `sourceOff`. */
  source?: ScoreDataSource
  message: string
}

export function isMetricAvailableOnBoundary(metric: ScoreMetricDefinition, boundarySource: BoundarySource): boolean {
  return !metric.boundarySources || metric.boundarySources.includes(boundarySource)
}

/**
 * Returns why a metric cannot contribute, or null when it is fine. Boundary
 * mismatches are reported first because no data-source toggle can fix them.
 */
export function getMetricUnavailability(
  metric: ScoreMetricDefinition,
  enabledDataSources: Iterable<ScoreDataSource>,
  boundarySource: BoundarySource,
): MetricAvailability | null {
  if (!isMetricAvailableOnBoundary(metric, boundarySource)) {
    return {
      reason: 'boundary',
      message: metric.boundaryRequirementLabel ?? 'Not populated on the current study area.',
    }
  }
  const source = metricToDataSource(metric.category)
  if (!source) return null
  const enabled = enabledDataSources instanceof Set ? enabledDataSources : new Set(enabledDataSources)
  if (enabled.has(source)) return null
  return {
    reason: 'sourceOff',
    source,
    message: 'Its data source is switched off, so it contributes nothing.',
  }
}

/**
 * Weighted metrics that are currently dead weight in the equation. The map is
 * keyed by metric so callers can annotate individual terms rather than showing
 * one aggregate warning.
 */
export function getUnavailableWeightedMetrics(
  metrics: ScoreMetricDefinition[],
  weights: ScoreMetricWeightMap,
  enabledDataSources: ScoreDataSource[],
  boundarySource: BoundarySource,
): Map<ScoreMetricKey, MetricAvailability> {
  const enabled = new Set(enabledDataSources)
  const result = new Map<ScoreMetricKey, MetricAvailability>()
  metrics.forEach((metric) => {
    if ((weights[metric.key] ?? 0) === 0) return
    const unavailable = getMetricUnavailability(metric, enabled, boundarySource)
    if (unavailable) result.set(metric.key, unavailable)
  })
  return result
}

/**
 * Metric key to backing data source. Built once: `metricHasCoverage` runs on the
 * order of (metrics x regions x scoring passes), and a linear scan of the metric
 * list per call dominated the scoring cost.
 */
const DATA_SOURCE_BY_METRIC_KEY: ReadonlyMap<ScoreMetricKey, ScoreDataSource | null> = new Map(
  SCORE_METRICS.map((metric) => [metric.key, metricToDataSource(metric.category)] as const),
)

export function metricHasCoverage(metric: ScoreMetricKey, counts: RegionDataCounts): boolean {
  const source = DATA_SOURCE_BY_METRIC_KEY.get(metric) ?? null
  if (source === 'airQuality') return counts.monitorCount > 0
  if (source === 'parks') return counts.parkCount + counts.trailCount + counts.amenityCount > 0
  if (source === 'heatShade')
    return (
      counts.treeCount +
        counts.matureTreeCount +
        counts.forestAreaSqKm +
        counts.coolingFacilityCount +
        counts.responseFacilityCount >
      0
    )
  if (source === 'restaurants') return counts.restaurantCount > 0
  if (source === 'census') return counts.populationSum > 0
  if (source === 'bcAssessment') return counts.parcelCount > 0
  if (source === 'crime') return counts.crimeCount > 0
  if (source === 'transit') return counts.transitStopCount > 0
  if (source === 'walkability')
    return (
      counts.sidewalkLengthKm +
        counts.walkwayLengthKm +
        counts.walkabilityIntersectionCount +
        counts.walkabilityCrossingCount +
        counts.childcareCount +
        counts.walkabilityPoiCount +
        counts.class3CrosswalkCount +
        counts.pedestrianCrashCount >
      0
    )
  if (source === 'deprivation') return counts.cimdJoinedCount > 0
  if (source === 'healthyPlanPg')
    return (
      counts.healthyFoodOutletAccessCount +
        counts.retailServiceAccessCount +
        counts.educationFacilityAccessCount +
        counts.geocodedBusinessCount >
      0
    )
  if (source === 'bcEnviroScreen') return counts.bcEnviroScreenJoinedCount > 0
  return true
}

export function getMetricLabel(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.label || key
}

export function getMetricDescription(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.description || ''
}

export function getMetricFormat(key: ScoreMetricKey): string {
  return SCORE_METRICS.find((metric) => metric.key === key)?.format || 'count'
}

export function formatMetricValue(metric: ScoreMetricKey, value: number, compact = false): string {
  const format = getMetricFormat(metric)

  if (metric === 'foodRiskScore') {
    const riskScore = value * 100
    return compact ? `${riskScore.toFixed(0)}/100 risk` : `${riskScore.toFixed(1)} / 100 risk index`
  }
  if (metric === 'crimePerCapita') {
    const perThousand = value * 1_000
    return compact
      ? `${perThousand.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })}/1k residents`
      : `${perThousand.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 })} incidents / 1,000 residents`
  }
  if (format === 'density') {
    const scaled = value * 1_000
    return compact
      ? `${scaled.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })}/1k km2`
      : `${scaled.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 })} / 1,000 km2`
  }
  if (format === 'ratio' || format === 'percent') return `${(value * 100).toFixed(1)}%`
  if (format === 'rawPercent') return `${value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 })}%`
  if (format === 'currency') {
    if (compact) {
      if (Math.abs(value) >= 1_000_000) {
        return `$${(value / 1_000_000).toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })}M`
      }
      return `$${Math.round(value / 1000).toLocaleString()}k`
    }
    return value.toLocaleString(DEFAULT_LOCALE, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
  }
  if (format === 'years') return `${value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })} yrs`
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 2 })
}

export function formatScore(value: number): string {
  return value.toLocaleString(DEFAULT_LOCALE, { maximumFractionDigits: 1 })
}
