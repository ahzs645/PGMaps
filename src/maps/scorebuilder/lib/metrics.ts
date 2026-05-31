import { SCORE_METRICS } from '../constants'
import type { RegionDataCounts, ScoreDataSource, ScoreMetricKey } from '../types'

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
  if (category === 'custom') return null
  return null
}

export function metricHasCoverage(metric: ScoreMetricKey, counts: RegionDataCounts): boolean {
  const definition = SCORE_METRICS.find((entry) => entry.key === metric)
  const source = definition ? metricToDataSource(definition.category) : null
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
      ? `${perThousand.toLocaleString(undefined, { maximumFractionDigits: 1 })}/1k residents`
      : `${perThousand.toLocaleString(undefined, { maximumFractionDigits: 2 })} incidents / 1,000 residents`
  }
  if (format === 'density') {
    const scaled = value * 1_000
    return compact
      ? `${scaled.toLocaleString(undefined, { maximumFractionDigits: 1 })}/1k km2`
      : `${scaled.toLocaleString(undefined, { maximumFractionDigits: 2 })} / 1,000 km2`
  }
  if (format === 'ratio' || format === 'percent') return `${(value * 100).toFixed(1)}%`
  if (format === 'currency') {
    if (compact) {
      if (Math.abs(value) >= 1_000_000) {
        return `$${(value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}M`
      }
      return `$${Math.round(value / 1000).toLocaleString()}k`
    }
    return value.toLocaleString(undefined, { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })
  }
  if (format === 'years') return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} yrs`
  if (Number.isInteger(value)) return value.toLocaleString()
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

export function formatScore(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 })
}
