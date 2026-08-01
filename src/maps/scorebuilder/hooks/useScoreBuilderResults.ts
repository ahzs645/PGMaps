import { useCallback, useMemo } from 'react'
import type { RegionLevel } from '@/maps/airquality'
import { SCORE_BUILDER_EXAMPLES, SCORE_PALETTE_PROFILES, SCORE_PRESETS, getScorePaletteProfile } from '../constants'
import { scoreRegionRowsWithHealthyPlanPriority } from '../lib/healthyPlanPriorityScoring'
import { scoreRegionRowsWithModulePercentiles } from '../lib/modulePercentileScoring'
import {
  computePopulationWeightedEquitySummary,
  type PopulationWeightedEquitySummary,
} from '../lib/populationSummary'
import { getActivePresetKey, scoreDataSourcesEqual, scoreWeightsEqual } from '../lib/presets'
import { getScoreDrivers } from '../lib/scoreDrivers'
import {
  clampScore,
  scoreRegionRows,
  type MetricValueListMap,
  type RegionMetricRow,
} from '../lib/scoring'
import { buildScoreBandSummary, summarizeScores } from '../lib/scoreSummaries'
import { computeMedian } from '../lib/spatial'
import {
  METRIC_CATEGORY_LABELS,
  MINIMUM_DATA_COVERAGE,
  type RobustnessResult,
  type ScenarioComparison,
  type ScoreComponentSummary,
  type ScoredBoundaryRegion,
  type ScoreMetricDefinition,
  type ScoreMetricRangeMap,
  type ScoreMetricWeightMap,
} from '../types'
import type { ScoreBuilderControlState } from './scoreBuilderReducer'

export interface ScoreBuilderResultsOptions {
  control: ScoreBuilderControlState
  selectedRegionLevel: RegionLevel
  activeMetricDefinitions: ScoreMetricDefinition[]
  regionMetricRows: RegionMetricRow[]
  metricRanges: ScoreMetricRangeMap
  metricValueLists: MetricValueListMap
}

/**
 * Turns the aggregated region metric rows into scored, ranked, filtered results plus
 * all derived analysis (equity, robustness, scenario comparison, density summaries)
 * and the active preset/example/palette resolution.
 */
export function useScoreBuilderResults({
  control,
  selectedRegionLevel,
  activeMetricDefinitions,
  regionMetricRows,
  metricRanges,
  metricValueLists,
}: ScoreBuilderResultsOptions) {
  const {
    weights,
    methodSettings,
    enabledDataSources,
    boundarySource,
    activeExampleKey,
    scoreFilters,
    searchQuery,
    selectedRegionId,
    regionInsightRegionId,
    comparisonIds,
    densityMetric,
  } = control

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
    const exactMatch = SCORE_BUILDER_EXAMPLES.find(
      (example) =>
        scoreDataSourcesEqual(example.dataSources, enabledDataSources) && scoreWeightsEqual(example.weights, weights),
    )
    if (exactMatch) return exactMatch.key
    const sourceMatch = SCORE_BUILDER_EXAMPLES.find(
      (example) =>
        example.boundarySource === boundarySource &&
        example.boundaryLevel === selectedRegionLevel &&
        scoreDataSourcesEqual(example.dataSources, enabledDataSources),
    )
    return sourceMatch?.key || null
  }, [boundarySource, enabledDataSources, resolvedExampleKey, selectedRegionLevel, weights])

  const scorePaletteProfile = useMemo(() => {
    if (methodSettings.paletteOverride) return SCORE_PALETTE_PROFILES[methodSettings.paletteOverride]
    return getScorePaletteProfile(activePresetKey, paletteExampleKey)
  }, [activePresetKey, methodSettings.paletteOverride, paletteExampleKey])

  const activePreset = useMemo(
    () => SCORE_PRESETS.find((preset) => preset.key === activePresetKey) || null,
    [activePresetKey],
  )

  const activeExample = useMemo(
    () => SCORE_BUILDER_EXAMPLES.find((example) => example.key === resolvedExampleKey) || null,
    [resolvedExampleKey],
  )

  const scoreRows = useCallback(
    (weightMap: ScoreMetricWeightMap, settings = methodSettings): ScoredBoundaryRegion[] => {
      if (settings.aggregation === 'healthyPlanPairwisePriority') {
        return scoreRegionRowsWithHealthyPlanPriority({
          rows: regionMetricRows,
          weights: weightMap,
          settings,
          metricRanges,
          metricValueLists,
          paletteProfile: scorePaletteProfile,
          demographicMetricKey: settings.healthyPlanPriority.demographicMetric,
          environmentMetricKey: settings.healthyPlanPriority.environmentMetric,
        })
      }
      if (settings.aggregation === 'modulePercentileRankedSum') {
        return scoreRegionRowsWithModulePercentiles({
          rows: regionMetricRows,
          weights: weightMap,
          settings,
          metricRanges,
          metricValueLists,
          paletteProfile: scorePaletteProfile,
        })
      }
      return scoreRegionRows({
        rows: regionMetricRows,
        weights: weightMap,
        settings,
        metricRanges,
        metricValueLists,
        paletteProfile: scorePaletteProfile,
        metrics: activeMetricDefinitions,
      })
    },
    [activeMetricDefinitions, methodSettings, metricRanges, metricValueLists, regionMetricRows, scorePaletteProfile],
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
      // Coverage first: a region scored almost entirely from zero-filled metrics is
      // not a low-scoring region, it is an unmeasured one.
      if (scoreFilters.requireCoverage && entry.dataCoverageScore < MINIMUM_DATA_COVERAGE) return false
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
    const ranked = filtered.map((row, index) => ({
      ...row,
      rank: index + 1,
      rankInterval: [index + 1, index + 1] as [number, number],
    }))
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
        Math.max(
          row.normalizedMetrics.foodRiskScore,
          row.normalizedMetrics.crimePerCapita,
          row.normalizedMetrics.shadeGap,
        ) * Math.max(row.normalizedMetrics.cimdComposite, row.normalizedMetrics.populationDensity),
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
          cutoffWarning:
            nearestBandBoundary <= 2
              ? 'Near score-band cutoff; review rank confidence before using as a threshold.'
              : null,
        },
      }
    })
  }, [filterThresholds, scoreFilters, scoreRows, unfilteredScoredRegions])

  const populationEquitySummary = useMemo<PopulationWeightedEquitySummary | null>(() => {
    const configuredDemographicMetric = methodSettings.healthyPlanPriority.demographicMetric
    const configuredEnvironmentMetric = methodSettings.healthyPlanPriority.environmentMetric
    const hasActiveConfiguredPair =
      methodSettings.aggregation === 'healthyPlanPairwisePriority' ||
      Boolean(
        configuredDemographicMetric &&
          configuredEnvironmentMetric &&
          weights[configuredDemographicMetric] !== 0 &&
          weights[configuredEnvironmentMetric] !== 0,
      )
    const demographicMetric =
      (hasActiveConfiguredPair ? configuredDemographicMetric : null) ||
      activeMetricDefinitions.find((metric) => metric.component === 'sensitivity' && weights[metric.key] !== 0)?.key ||
      null
    const environmentMetric =
      (hasActiveConfiguredPair ? configuredEnvironmentMetric : null) ||
      activeMetricDefinitions.find((metric) => metric.component === 'serviceAccess' && weights[metric.key] !== 0)?.key ||
      null
    if (
      methodSettings.aggregation !== 'healthyPlanPairwisePriority' &&
      (!demographicMetric ||
        !environmentMetric ||
        weights[demographicMetric] === 0 ||
        weights[environmentMetric] === 0)
    ) {
      return null
    }
    return computePopulationWeightedEquitySummary({
      regions: scoredRegions,
      metrics: activeMetricDefinitions,
      demographicMetric,
      environmentMetric,
    })
  }, [activeMetricDefinitions, methodSettings.aggregation, methodSettings.healthyPlanPriority, scoredRegions, weights])

  const filteredRegions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return scoredRegions
    return scoredRegions.filter(
      (entry) => entry.region.name.toLowerCase().includes(query) || entry.region.code.toLowerCase().includes(query),
    )
  }, [scoredRegions, searchQuery])

  const scoreSpread = useMemo(() => summarizeScores(scoredRegions), [scoredRegions])

  const selectedRegion = useMemo(() => {
    if (!selectedRegionId) return null
    return scoredRegions.find((entry) => entry.region.id === selectedRegionId) || null
  }, [scoredRegions, selectedRegionId])

  const selectedRegionDrivers = useMemo(
    () => (selectedRegion ? getScoreDrivers(selectedRegion, weights, 2) : []),
    [selectedRegion, weights],
  )

  const regionInsightRegion = useMemo(() => {
    if (!regionInsightRegionId) return null
    return scoredRegions.find((entry) => entry.region.id === regionInsightRegionId) || null
  }, [regionInsightRegionId, scoredRegions])

  const comparisonRegions = useMemo(() => {
    return comparisonIds
      .map((id) => scoredRegions.find((r) => r.region.id === id))
      .filter(Boolean) as ScoredBoundaryRegion[]
  }, [comparisonIds, scoredRegions])

  /** Thin regions still in the ranking — non-zero only when the coverage filter is off. */
  const thinCoverageCount = useMemo(
    () => scoredRegions.filter((region) => region.dataCoverageScore < MINIMUM_DATA_COVERAGE).length,
    [scoredRegions],
  )

  /** Thin regions the coverage filter is holding back, so the map can say so. */
  const lowCoverageExcludedCount = useMemo(() => {
    if (!scoreFilters.requireCoverage) return 0
    return unfilteredScoredRegions.filter((region) => region.dataCoverageScore < MINIMUM_DATA_COVERAGE).length
  }, [scoreFilters.requireCoverage, unfilteredScoredRegions])

  const scoreBands = useMemo(() => buildScoreBandSummary(scoredRegions), [scoredRegions])

  const componentSummaries = useMemo<ScoreComponentSummary[]>(() => {
    const referenceRegion = selectedRegion || scoredRegions[0]
    if (referenceRegion?.moduleScores?.length) {
      return referenceRegion.moduleScores.map((module) => ({
        key: 'deprivation',
        label: module.label,
        score: module.rank * 100,
        weightShare: referenceRegion.moduleScores?.length ? 1 / referenceRegion.moduleScores.length : 0,
        activeMetricCount: module.activeMetricCount,
      }))
    }
    const totalWeight = activeMetricDefinitions.reduce((sum, metric) => sum + Math.abs(weights[metric.key] ?? 0), 0)
    if (!referenceRegion || totalWeight <= 0) return []

    return Object.entries(METRIC_CATEGORY_LABELS)
      .map(([category, label]) => {
        const metrics = activeMetricDefinitions.filter((metric) => metric.category === category && weights[metric.key] !== 0)
        const categoryWeight = metrics.reduce((sum, metric) => sum + Math.abs(weights[metric.key] ?? 0), 0)
        const categoryContribution = metrics.reduce((sum, metric) => sum + (referenceRegion.contributions[metric.key] ?? 0), 0)
        return {
          key: category as ScoreComponentSummary['key'],
          label,
          score: categoryWeight > 0 ? clampScore((categoryContribution / (categoryWeight / totalWeight)) * 100) : 0,
          weightShare: categoryWeight / totalWeight,
          activeMetricCount: metrics.length,
        }
      })
      .filter((summary) => summary.activeMetricCount > 0)
  }, [activeMetricDefinitions, scoredRegions, selectedRegion, weights])

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
      activeMetricDefinitions.forEach((metric, index) => {
        const weight = weights[metric.key]
        if (weight === 0) return
        const wave = Math.sin((trial + 1) * (index + 3) * 1.618)
        perturbedWeights[metric.key] = Math.round(weight * (1 + wave * 0.15))
      })
      sampleRows(scoreRows(perturbedWeights))
    }

    activeMetricDefinitions.filter((metric) => weights[metric.key] !== 0).forEach((metric) => {
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
        topDrivers: activeMetricDefinitions.filter((metric) => weights[metric.key] !== 0)
          .sort((a, b) => Math.abs(entry.contributions[b.key]) - Math.abs(entry.contributions[a.key]))
          .slice(0, 3)
          .map((metric) => metric.key),
      }
    })
  }, [activeMetricDefinitions, methodSettings, scoreRows, scoredRegions, weights])

  const scenarioComparison = useMemo<ScenarioComparison | null>(() => {
    const referencePreset = SCORE_PRESETS.find((preset) => preset.key === 'balancedCoverage') || SCORE_PRESETS[0]
    if (!referencePreset || !unfilteredScoredRegions.length) return null
    const referenceRegionScores = scoreRows(referencePreset.weights)
    const eligibleIds = new Set(scoredRegions.map((entry) => entry.region.id))
    const referenceEligible = referenceRegionScores
      .filter((entry) => eligibleIds.has(entry.region.id))
      .map((entry, index) => ({ ...entry, rank: index + 1 }))
    const referenceSpread = summarizeScores(referenceEligible)
    const referenceById = new Map(referenceEligible.map((entry) => [entry.region.id, entry]))
    const changedMost = scoredRegions
      .map((entry) => ({
        regionId: entry.region.id,
        regionName: entry.region.name,
        delta: entry.score - (referenceById.get(entry.region.id)?.score ?? entry.score),
      }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 5)
    const referenceTopIds = new Set(
      referenceEligible
        .slice(0, Math.max(1, Math.ceil(referenceEligible.length * 0.15)))
        .map((entry) => entry.region.id),
    )
    const alwaysHighPriority = scoredRegions
      .filter(
        (entry) =>
          entry.rank <= Math.max(1, Math.ceil(scoredRegions.length * 0.15)) && referenceTopIds.has(entry.region.id),
      )
      .slice(0, 5)
      .map((entry) => ({ regionId: entry.region.id, regionName: entry.region.name }))
    const currentTopId = scoredRegions[0]?.region.id || null
    const trials = methodSettings.sensitivity && currentTopId ? 24 : 0
    let stableTopCount = 0
    let averageRankShift = 0
    const trialRankShiftById = new Map<string, number>()

    if (trials > 0) {
      const baseRankById = new Map(scoredRegions.map((entry) => [entry.region.id, entry.rank]))
      for (let trial = 0; trial < trials; trial += 1) {
        const perturbedWeights = { ...weights }
        activeMetricDefinitions.forEach((metric, index) => {
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
            const shift = Math.abs(baseRank - (index + 1))
            trialRankShiftById.set(entry.region.id, (trialRankShiftById.get(entry.region.id) || 0) + shift)
            return sum + shift
          }, 0) / Math.max(1, trialRows.length)
        averageRankShift += rankShift
      }
      averageRankShift /= trials
    }
    const sensitiveRegions = Array.from(trialRankShiftById.entries())
      .map(([regionId, rankShift]) => ({
        regionId,
        regionName: scoredRegions.find((entry) => entry.region.id === regionId)?.region.name || regionId,
        rankShift: trials > 0 ? rankShift / trials : 0,
      }))
      .sort((a, b) => b.rankShift - a.rankShift)
      .slice(0, 5)

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
      changedMost,
      alwaysHighPriority,
      sensitiveRegions,
    }
  }, [
    methodSettings.sensitivity,
    activeMetricDefinitions,
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
    if (methodSettings.aggregation === 'healthyPlanPairwisePriority') {
      const demographicMetric = activeMetricDefinitions.find(
        (metric) => metric.key === methodSettings.healthyPlanPriority.demographicMetric,
      )
      const environmentMetric = activeMetricDefinitions.find(
        (metric) => metric.key === methodSettings.healthyPlanPriority.environmentMetric,
      )
      return `priority_score = ${demographicMetric?.shortLabel ?? 'vulnerability'} decile - ${environmentMetric?.shortLabel ?? 'environment'} decile where vulnerability decile > 5 and environment benefit decile < 6`
    }
    const activeTerms = activeMetricDefinitions.filter((metric) => weights[metric.key] !== 0)
    if (!activeTerms.length) return 'No active terms. Move any weight above or below zero.'
    if (methodSettings.aggregation === 'modulePercentileRankedSum') {
      const moduleNames = Array.from(new Set(activeTerms.map((metric) => metric.indexModule || 'localContext')))
      return `score = percentile_rank(sum(module ranks: ${moduleNames.join(' + ')}))`
    }
    if (methodSettings.aggregation === 'accessThreshold') {
      return `score = access hits >= ${(methodSettings.accessThreshold.minimumAccess * 100).toFixed(0)}%, target ${methodSettings.accessThreshold.minimumHits}`
    }
    const terms = activeTerms.map((metric) => {
      const weight = weights[metric.key]
      return weight < 0 ? `${Math.abs(weight)}×low ${metric.shortLabel}` : `${weight}×${metric.shortLabel}`
    })
    return `score = weighted average(${terms.join(' + ')})`
  }, [activeMetricDefinitions, methodSettings.aggregation, methodSettings.accessThreshold, methodSettings.healthyPlanPriority, weights])

  return {
    activePresetKey,
    activePreset,
    resolvedExampleKey,
    activeExample,
    scorePaletteProfile,
    scoreRows,
    unfilteredScoredRegions,
    scoredRegions,
    filteredRegions,
    scoreSpread,
    selectedRegion,
    selectedRegionDrivers,
    regionInsightRegion,
    comparisonRegions,
    thinCoverageCount,
    lowCoverageExcludedCount,
    scoreBands,
    componentSummaries,
    populationEquitySummary,
    robustnessResults,
    scenarioComparison,
    densitySummary,
    densityLeaders,
    equationPreview,
  }
}

export type ScoreBuilderResults = ReturnType<typeof useScoreBuilderResults>
