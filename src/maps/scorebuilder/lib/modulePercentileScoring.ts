import {
  SCORE_INDEX_DOMAIN_LABELS,
  SCORE_INDEX_MODULE_LABELS,
  SCORE_METRICS,
  createMetricValueMap,
  getScorePaletteOutputColor,
  type ScorePaletteProfile,
} from '../constants'
import type {
  ScoredBoundaryRegion,
  ScoreDomainResult,
  ScoreIndexDomain,
  ScoreIndexModule,
  ScoreMetricRangeMap,
  ScoreMetricValueMap,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
  ScoreModuleResult,
} from '../types'
import { metricHasCoverage } from './metrics'
import { clampScore, normalizeWithMethod, type MetricValueListMap, type RegionMetricRow } from './scoring'

const MODULE_ORDER: ScoreIndexModule[] = [
  'socialVulnerability',
  'environmentalBurden',
  'healthVulnerability',
  'climateBurden',
  'localContext',
]

function percentileRank(value: number, values: number[]): number {
  if (!Number.isFinite(value)) return 0
  const rankedValues = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!rankedValues.length) return 0.5
  const below = rankedValues.filter((candidate) => candidate < value).length
  const equal = rankedValues.filter((candidate) => candidate === value).length
  return Math.max(0, Math.min(1, (below + equal * 0.5) / rankedValues.length))
}

function metricBurdenValue(
  metric: (typeof SCORE_METRICS)[number],
  normalizedValue: number,
  allNormalizedValues: number[],
): number {
  if (metric.valueBehavior === 'topTertileFlag') {
    const threshold = percentileRank(normalizedValue, allNormalizedValues) > 0.6666 ? 1 : 0
    return threshold
  }
  if (metric.valueBehavior === 'inverseContinuous') return 1 - normalizedValue
  return normalizedValue
}

function activeIndexMetrics(weights: ScoreMetricWeightMap) {
  return SCORE_METRICS.filter((metric) => weights[metric.key] !== 0 && metric.indexModule)
}

function getComparisonUniverseLabel(source: RegionMetricRow['region']['source'], level: RegionMetricRow['region']['level']): string {
  const sourceLabel =
    source === 'bcHealth'
      ? 'BC health regions'
      : source === 'cityCommunity'
        ? 'CityPG community polygons'
      : source === 'cityPG'
        ? 'CityPG school catchments'
        : source === 'watershed'
          ? 'BC Freshwater Atlas watershed boundaries'
          : source === 'census'
            ? level === 'db' ? 'Prince George dissemination blocks' : 'BC census regions'
            : 'selected boundary regions'
  return `EJI-style percentile ranks are relative to ${sourceLabel} at the currently loaded ${level} boundary level; filters do not redefine percentiles.`
}

export function scoreRegionRowsWithModulePercentiles({
  rows,
  weights,
  settings,
  metricRanges,
  metricValueLists,
  paletteProfile,
}: {
  rows: RegionMetricRow[]
  weights: ScoreMetricWeightMap
  settings: ScoreMethodSettings
  metricRanges: ScoreMetricRangeMap
  metricValueLists: MetricValueListMap
  paletteProfile: ScorePaletteProfile
}): ScoredBoundaryRegion[] {
  const activeMetrics = activeIndexMetrics(weights)
  if (!activeMetrics.length) {
    return rows.map((row, index) => ({
      ...row,
      normalizedMetrics: createMetricValueMap(0),
      contributions: createMetricValueMap(0),
      score: 50,
      scoreColor: getScorePaletteOutputColor(50, paletteProfile, settings.visualOutput),
      rank: index + 1,
      dataCoverageScore: 1,
      rankConfidence: 'Sensitive result',
      rankInterval: [index + 1, index + 1],
      scoreInterval: [50, 50],
      comparisonUniverseLabel: getComparisonUniverseLabel(row.region.source, row.region.level),
      equityAudit: {
        referenceRank: null,
        rankDelta: 0,
        referenceScore: null,
        deprivationQuintile: null,
        burdenOverlap: 0,
        cutoffWarning: null,
      },
      scoreMethodLabel: 'EJI-style module percentile ranked sum',
      moduleScores: [],
      domainScores: [],
      missingDataFlags: ['No active EJI-style indicators.'],
    }))
  }

  const normalizedByRegion = new Map<string, ScoreMetricValueMap>()
  const burdenByRegion = new Map<string, ScoreMetricValueMap>()
  const missingFlagsByRegion = new Map<string, string[]>()
  const moduleRawByRegion = new Map<string, Record<ScoreIndexModule, number>>()
  const moduleCountsByRegion = new Map<string, Record<ScoreIndexModule, { active: number; missing: number }>>()
  const domainRawByRegion = new Map<string, Record<ScoreIndexDomain, { module: ScoreIndexModule; sum: number; count: number }>>()

  rows.forEach((row) => {
    const normalizedMetrics = createMetricValueMap(0)
    const burdenMetrics = createMetricValueMap(0)
    const missingFlags: string[] = []
    const moduleRaw = {} as Record<ScoreIndexModule, number>
    const moduleCounts = {} as Record<ScoreIndexModule, { active: number; missing: number }>
    const domainRaw = {} as Record<ScoreIndexDomain, { module: ScoreIndexModule; sum: number; count: number }>

    activeMetrics.forEach((metric) => {
      const hasCoverage = metricHasCoverage(metric.key, row.counts)
      const missingPolicy = metric.missingDataPolicy ?? settings.missingData
      const normalizedValue =
        !hasCoverage && missingPolicy === 'neutral'
          ? 0.5
          : !hasCoverage && (missingPolicy === 'zero' || missingPolicy === 'zeroWithFlag')
            ? 0
            : normalizeWithMethod(
                row.metrics[metric.key],
                metricValueLists[metric.key] ?? [],
                metricRanges[metric.key],
                'percentile',
              )
      const allNormalizedValues = rows.map((candidate) =>
        normalizeWithMethod(
          candidate.metrics[metric.key],
          metricValueLists[metric.key] ?? [],
          metricRanges[metric.key],
          'percentile',
        ),
      )
      const burdenValue = metricBurdenValue(metric, normalizedValue, allNormalizedValues)
      const module = settings.metricModuleOverrides[metric.key] || metric.indexModule || 'localContext'
      const domain = metric.indexDomain || 'services'

      normalizedMetrics[metric.key] = normalizedValue
      burdenMetrics[metric.key] = burdenValue
      moduleRaw[module] = (moduleRaw[module] ?? 0) + burdenValue
      moduleCounts[module] = moduleCounts[module] || { active: 0, missing: 0 }
      moduleCounts[module].active += 1
      if (!hasCoverage) {
        moduleCounts[module].missing += 1
        if (missingPolicy === 'excludeRegion') {
          missingFlags.push(`${metric.label}: missing active data; EJI-style policy would exclude this region.`)
        } else if (missingPolicy === 'zeroWithFlag') {
          missingFlags.push(`${metric.label}: missing value treated as zero.`)
        }
      }
      domainRaw[domain] = domainRaw[domain] || { module, sum: 0, count: 0 }
      domainRaw[domain].sum += burdenValue
      domainRaw[domain].count += 1
    })

    normalizedByRegion.set(row.region.id, normalizedMetrics)
    burdenByRegion.set(row.region.id, burdenMetrics)
    missingFlagsByRegion.set(row.region.id, missingFlags)
    moduleRawByRegion.set(row.region.id, moduleRaw)
    moduleCountsByRegion.set(row.region.id, moduleCounts)
    domainRawByRegion.set(row.region.id, domainRaw)
  })

  const activeModules = MODULE_ORDER.filter((module) =>
    activeMetrics.some((metric) => (settings.metricModuleOverrides[metric.key] || metric.indexModule || 'localContext') === module),
  )
  const moduleRankValues = new Map<ScoreIndexModule, number[]>()
  activeModules.forEach((module) => {
    moduleRankValues.set(
      module,
      rows.map((row) => moduleRawByRegion.get(row.region.id)?.[module] ?? 0),
    )
  })

  const draftRows = rows.map((row) => {
    const normalizedMetrics = normalizedByRegion.get(row.region.id) || createMetricValueMap(0)
    const burdenMetrics = burdenByRegion.get(row.region.id) || createMetricValueMap(0)
    const moduleRaw = moduleRawByRegion.get(row.region.id) || ({} as Record<ScoreIndexModule, number>)
    const moduleCounts = moduleCountsByRegion.get(row.region.id) || ({} as Record<ScoreIndexModule, { active: number; missing: number }>)
    const domainRaw = domainRawByRegion.get(row.region.id) || ({} as Record<ScoreIndexDomain, { module: ScoreIndexModule; sum: number; count: number }>)

    const moduleScores: ScoreModuleResult[] = activeModules.map((module) => {
      const rawScore = moduleRaw[module] ?? 0
      return {
        key: module,
        label: SCORE_INDEX_MODULE_LABELS[module],
        rawScore,
        rank: percentileRank(rawScore, moduleRankValues.get(module) ?? []),
        activeMetricCount: moduleCounts[module]?.active ?? 0,
        missingMetricCount: moduleCounts[module]?.missing ?? 0,
      }
    })

    const combinedRaw = moduleScores.reduce((sum, module) => sum + module.rank, 0)
    return {
      row,
      normalizedMetrics,
      burdenMetrics,
      moduleScores,
      domainRaw,
      combinedRaw,
    }
  })

  const finalRankValues = draftRows.map((entry) => entry.combinedRaw)

  const scoredRows = draftRows.map((entry) => {
    const score = clampScore(percentileRank(entry.combinedRaw, finalRankValues) * 100)
    const contributions = createMetricValueMap(0)
    activeMetrics.forEach((metric) => {
      const module = settings.metricModuleOverrides[metric.key] || metric.indexModule || 'localContext'
      const moduleScore = entry.moduleScores.find((candidate) => candidate.key === module)
      const moduleMetricCount = Math.max(1, moduleScore?.activeMetricCount ?? 1)
      contributions[metric.key] = ((moduleScore?.rank ?? 0) / Math.max(1, activeModules.length)) / moduleMetricCount
    })

    const domainScores: ScoreDomainResult[] = Object.entries(entry.domainRaw).map(([domain, value]) => ({
      key: domain as ScoreIndexDomain,
      label: SCORE_INDEX_DOMAIN_LABELS[domain as ScoreIndexDomain] || domain,
      module: value.module,
      score: clampScore((value.sum / Math.max(1, value.count)) * 100),
      activeMetricCount: value.count,
    }))

    const activeMetricCoverage = activeMetrics.filter((metric) => metricHasCoverage(metric.key, entry.row.counts)).length
    const dataCoverageScore = activeMetrics.length ? activeMetricCoverage / activeMetrics.length : 1
    const missingDataFlags = missingFlagsByRegion.get(entry.row.region.id) || []

    return {
      ...entry.row,
      normalizedMetrics: entry.normalizedMetrics,
      contributions,
      score,
      scoreColor: getScorePaletteOutputColor(score, paletteProfile, settings.visualOutput),
      rank: 0,
      dataCoverageScore,
      rankConfidence: missingDataFlags.length
        ? ('Sensitive result' as const)
        : dataCoverageScore < 0.75
          ? ('Borderline priority' as const)
          : ('Stable priority' as const),
      rankInterval: [0, 0] as [number, number],
      scoreInterval: [score, score] as [number, number],
      comparisonUniverseLabel: getComparisonUniverseLabel(entry.row.region.source, entry.row.region.level),
      equityAudit: {
        referenceRank: null,
        rankDelta: 0,
        referenceScore: null,
        deprivationQuintile:
          entry.row.metrics.cimdComposite > 0 ? Math.max(1, Math.min(5, Math.ceil(entry.row.metrics.cimdComposite * 5))) : null,
        burdenOverlap: Math.sqrt(
          Math.max(entry.normalizedMetrics.foodRiskScore, entry.normalizedMetrics.crimePerCapita, entry.normalizedMetrics.shadeGap) *
            Math.max(entry.normalizedMetrics.cimdComposite, entry.normalizedMetrics.populationDensity),
        ),
        cutoffWarning: missingDataFlags.length ? 'Missing-data policy affects this EJI-style score.' : null,
      },
      scoreMethodLabel: 'EJI-style module percentile ranked sum',
      moduleScores: entry.moduleScores,
      domainScores,
      missingDataFlags,
    }
  })

  scoredRows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    return a.region.name.localeCompare(b.region.name)
  })

  return scoredRows.map((row, index) => ({
    ...row,
    rank: index + 1,
    rankInterval: [index + 1, index + 1],
  }))
}
