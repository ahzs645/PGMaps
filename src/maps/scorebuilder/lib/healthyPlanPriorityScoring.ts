import { getEquityPriorityColor } from '@/lib/healthyplan'
import { SCORE_METRICS, createMetricValueMap, getScorePaletteOutputColor, type ScorePaletteProfile } from '../constants'
import type {
  ScoredBoundaryRegion,
  ScoreMetricKey,
  ScoreMetricRangeMap,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'
import { metricHasCoverage } from './metrics'
import { clampScore, normalizeWithMethod, type MetricValueListMap, type RegionMetricRow } from './scoring'

function decileRank(value: number, sortedValues: readonly number[]): number | null {
  const finiteValues = sortedValues.filter(Number.isFinite)
  if (!Number.isFinite(value) || !finiteValues.length) return null
  const below = finiteValues.filter((candidate) => candidate < value).length
  const equal = finiteValues.filter((candidate) => candidate === value).length
  return Math.max(1, Math.min(10, Math.ceil(((below + equal / 2) / finiteValues.length) * 10)))
}

function metricBenefitValue(metric: (typeof SCORE_METRICS)[number], value: number): number {
  return metric.direction === 'higherIsWorse' ? -value : value
}

function isDemographicCandidate(metric: (typeof SCORE_METRICS)[number]): boolean {
  return metric.component === 'sensitivity' || metric.category === 'demographics' || metric.category === 'deprivation'
}

function isEnvironmentCandidate(metric: (typeof SCORE_METRICS)[number]): boolean {
  return (
    metric.component === 'environmentalBurden' ||
    metric.component === 'serviceAccess' ||
    metric.component === 'adaptiveCapacity' ||
    metric.category === 'airQuality' ||
    metric.category === 'parksRec' ||
    metric.category === 'heatShade' ||
    metric.category === 'transit' ||
    metric.category === 'walkability'
  )
}

function choosePair(weights: ScoreMetricWeightMap): {
  demographicMetric: (typeof SCORE_METRICS)[number] | null
  environmentMetric: (typeof SCORE_METRICS)[number] | null
} {
  const activeMetrics = SCORE_METRICS.filter((metric) => weights[metric.key] !== 0)
  const byWeight = (left: (typeof SCORE_METRICS)[number], right: (typeof SCORE_METRICS)[number]) =>
    Math.abs(weights[right.key]) - Math.abs(weights[left.key])
  const demographicMetric = activeMetrics.filter(isDemographicCandidate).sort(byWeight)[0] ?? null
  const environmentMetric =
    activeMetrics
      .filter(isEnvironmentCandidate)
      .filter((metric) => metric.key !== demographicMetric?.key)
      .sort(byWeight)[0] ?? null

  return { demographicMetric, environmentMetric }
}

function getComparisonUniverseLabel(
  source: RegionMetricRow['region']['source'],
  level: RegionMetricRow['region']['level'],
): string {
  const sourceLabel =
    source === 'bcHealth'
      ? 'BC health regions'
      : source === 'cityPG'
        ? 'CityPG school catchments'
        : source === 'watershed'
          ? 'BC Freshwater Atlas watershed boundaries'
          : 'Prince George census regions'
  return `HealthyPlan-style priority ranks one vulnerability metric against one built-environment metric within ${sourceLabel} at the currently loaded ${level} boundary level.`
}

export function scoreRegionRowsWithHealthyPlanPriority({
  rows,
  weights,
  settings,
  metricRanges,
  metricValueLists,
  paletteProfile,
  demographicMetricKey,
  environmentMetricKey,
}: {
  rows: RegionMetricRow[]
  weights: ScoreMetricWeightMap
  settings: ScoreMethodSettings
  metricRanges: ScoreMetricRangeMap
  metricValueLists: MetricValueListMap
  paletteProfile: ScorePaletteProfile
  demographicMetricKey?: ScoreMetricKey | null
  environmentMetricKey?: ScoreMetricKey | null
}): ScoredBoundaryRegion[] {
  const inferredPair = choosePair(weights)
  const demographicMetric =
    SCORE_METRICS.find((metric) => metric.key === demographicMetricKey) ?? inferredPair.demographicMetric
  const environmentMetric =
    SCORE_METRICS.find((metric) => metric.key === environmentMetricKey) ?? inferredPair.environmentMetric
  if (!demographicMetric || !environmentMetric) {
    return rows.map((row, index) => ({
      ...row,
      normalizedMetrics: createMetricValueMap(0),
      contributions: createMetricValueMap(0),
      score: 0,
      scoreColor: getScorePaletteOutputColor(0, paletteProfile, settings.visualOutput),
      rank: index + 1,
      dataCoverageScore: 0,
      rankConfidence: 'Sensitive result' as const,
      rankInterval: [index + 1, index + 1],
      scoreInterval: [0, 0],
      comparisonUniverseLabel:
        'HealthyPlan-style priority needs at least one active vulnerability metric and one active built-environment metric.',
      equityAudit: {
        referenceRank: null,
        rankDelta: 0,
        referenceScore: null,
        deprivationQuintile: null,
        burdenOverlap: 0,
        cutoffWarning: 'Add one vulnerability metric and one built-environment metric.',
      },
      scoreMethodLabel: 'HealthyPlan-style pairwise priority',
      missingDataFlags: ['HealthyPlan-style priority pair is incomplete.'],
    }))
  }

  const demographicValues = rows
    .map((row) => row.metrics[demographicMetric.key])
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  const environmentBenefitValues = rows
    .map((row) => metricBenefitValue(environmentMetric, row.metrics[environmentMetric.key]))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)

  const scoredRows = rows.map((row) => {
    const normalizedMetrics = createMetricValueMap(0)
    const contributions = createMetricValueMap(0)
    const demographicValue = row.metrics[demographicMetric.key]
    const environmentValue = row.metrics[environmentMetric.key]
    const environmentBenefitValue = metricBenefitValue(environmentMetric, environmentValue)
    const demographicRank = decileRank(demographicValue, demographicValues)
    const environmentRank = decileRank(environmentBenefitValue, environmentBenefitValues)
    const priorityScore =
      demographicRank !== null && environmentRank !== null && demographicRank > 5 && environmentRank < 6
        ? demographicRank - environmentRank
        : null
    const priorityColor = getEquityPriorityColor(priorityScore)
    const score = priorityScore === null ? 0 : clampScore((priorityScore / 9) * 100)

    SCORE_METRICS.forEach((metric) => {
      normalizedMetrics[metric.key] = normalizeWithMethod(
        row.metrics[metric.key],
        metricValueLists[metric.key] ?? [],
        metricRanges[metric.key],
        settings.normalization,
      )
    })
    contributions[demographicMetric.key] = demographicRank === null ? 0 : demographicRank / 10
    contributions[environmentMetric.key] = environmentRank === null ? 0 : (10 - environmentRank) / 10

    const hasDemographicCoverage = metricHasCoverage(demographicMetric.key, row.counts)
    const hasEnvironmentCoverage = metricHasCoverage(environmentMetric.key, row.counts)
    const dataCoverageScore = Number(hasDemographicCoverage) / 2 + Number(hasEnvironmentCoverage) / 2

    return {
      ...row,
      normalizedMetrics,
      contributions,
      score,
      scoreColor: priorityColor ?? 'rgba(15, 23, 42, 0.08)',
      rank: 0,
      dataCoverageScore,
      rankConfidence:
        dataCoverageScore < 1
          ? ('Sensitive result' as const)
          : priorityScore !== null && priorityScore <= 2
            ? ('Borderline priority' as const)
            : ('Stable priority' as const),
      rankInterval: [0, 0] as [number, number],
      scoreInterval: [score, score] as [number, number],
      comparisonUniverseLabel: getComparisonUniverseLabel(row.region.source, row.region.level),
      equityAudit: {
        referenceRank: null,
        rankDelta: 0,
        referenceScore: null,
        deprivationQuintile: null,
        burdenOverlap: priorityScore === null ? 0 : score / 100,
        cutoffWarning: priorityScore === null ? 'Not an equity-priority area under the HealthyPlan threshold.' : null,
      },
      scoreMethodLabel: 'HealthyPlan-style pairwise priority',
      healthyPlanPriority: {
        demographicMetric: demographicMetric.key,
        environmentMetric: environmentMetric.key,
        demographicRank,
        environmentRank,
        priorityScore,
        priorityColor,
        equityPriority: priorityScore !== null,
      },
      missingDataFlags:
        dataCoverageScore < 1 ? ['HealthyPlan-style priority pair has incomplete coverage for this region.'] : [],
    }
  })

  scoredRows.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    const leftDemo = left.healthyPlanPriority?.demographicRank ?? 0
    const rightDemo = right.healthyPlanPriority?.demographicRank ?? 0
    if (rightDemo !== leftDemo) return rightDemo - leftDemo
    return left.region.name.localeCompare(right.region.name)
  })

  return scoredRows.map((row, index) => ({ ...row, rank: index + 1, rankInterval: [index + 1, index + 1] }))
}
