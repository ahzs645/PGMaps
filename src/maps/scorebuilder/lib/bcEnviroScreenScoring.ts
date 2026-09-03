import {
  BC_ENVIRO_SCREEN_METRICS,
  bcEnviroScreenIndicatorKey,
  createMetricValueMap,
  getScorePaletteOutputColor,
  type BcEnviroScreenComponent,
  type ScorePaletteProfile,
} from '../constants'
import type {
  ScoredBoundaryRegion,
  ScoreMetricKey,
  ScoreMetricValueMap,
  ScoreMetricWeightMap,
  ScoreMethodSettings,
} from '../types'
import type { RegionMetricRow } from './scoring'
import {
  BC_ENVIRO_SCREEN_DEFAULT_FORMULA,
  compileBcEnviroScreenFormula,
  type CompiledBcEnviroScreenFormula,
} from './bcEnviroScreenFormula'

const COMPONENTS: BcEnviroScreenComponent[] = [
  'exposures',
  'environmentalEffects',
  'sensitivePopulations',
  'socioeconomicFactors',
]

function oneBasedPercentileRanks(rows: RegionMetricRow[], metricKey: ScoreMetricKey): Map<string, number> {
  const nonzero = rows
    .map((row) => ({ id: row.region.id, value: row.metrics[metricKey] }))
    .filter((entry) => Number.isFinite(entry.value) && entry.value !== 0)
    .sort((a, b) => a.value - b.value)
  const scores = new Map<string, number>()
  let position = 0
  while (position < nonzero.length) {
    let end = position + 1
    while (end < nonzero.length && nonzero[end].value === nonzero[position].value) end += 1
    const averageRank = (position + 1 + end) / 2
    const percentile = averageRank / nonzero.length
    for (let index = position; index < end; index += 1) scores.set(nonzero[index].id, percentile)
    position = end
  }
  rows.forEach((row) => {
    if (row.metrics[metricKey] === 0) scores.set(row.region.id, 0)
  })
  return scores
}

function weightedMean(values: Array<{ value: number | null; weight: number }>): number | null {
  const present = values.filter((entry) => entry.value != null && entry.weight > 0) as Array<{
    value: number
    weight: number
  }>
  const weight = present.reduce((sum, entry) => sum + entry.weight, 0)
  return weight > 0 ? present.reduce((sum, entry) => sum + entry.value * entry.weight, 0) / weight : null
}

function componentWeight(settings: ScoreMethodSettings, component: BcEnviroScreenComponent): number {
  return settings.bcEnviroScreenComponentWeights[component]
}

export function scoreRegionRowsWithBcEnviroScreen({
  rows,
  weights,
  settings,
  paletteProfile,
}: {
  rows: RegionMetricRow[]
  weights: ScoreMetricWeightMap
  settings: ScoreMethodSettings
  paletteProfile: ScorePaletteProfile
}): ScoredBoundaryRegion[] {
  const activeMetrics = BC_ENVIRO_SCREEN_METRICS.filter((metric) => (weights[metric.key] ?? 0) > 0)
  const ranks = new Map(
    BC_ENVIRO_SCREEN_METRICS.map((metric) => [metric.key, oneBasedPercentileRanks(rows, metric.key)]),
  )
  const totalIndicatorWeight = activeMetrics.reduce((sum, metric) => sum + (weights[metric.key] ?? 0), 0)
  const indicatorKeys = BC_ENVIRO_SCREEN_METRICS.map((metric) => bcEnviroScreenIndicatorKey(metric.key)).filter(
    (key): key is string => Boolean(key),
  )
  const formulaExpression =
    settings.bcEnviroScreenFormula.mode === 'custom'
      ? settings.bcEnviroScreenFormula.expression
      : BC_ENVIRO_SCREEN_DEFAULT_FORMULA
  let compiledFormula: CompiledBcEnviroScreenFormula | null = null
  let formulaError: string | null = null
  try {
    compiledFormula = compileBcEnviroScreenFormula(formulaExpression, indicatorKeys)
  } catch (error) {
    formulaError = error instanceof Error ? error.message : 'Invalid BC EnviroScreen formula.'
  }

  const drafts = rows.map((row) => {
    const normalizedMetrics = createMetricValueMap(0)
    const contributions = createMetricValueMap(0)
    const missingIndicators: ScoreMetricKey[] = []
    const warnings = new Set<string>()
    activeMetrics.forEach((metric) => {
      const percentile = ranks.get(metric.key)?.get(row.region.id)
      if (percentile == null) missingIndicators.push(metric.key)
      else {
        normalizedMetrics[metric.key] = percentile
        contributions[metric.key] =
          totalIndicatorWeight > 0 ? ((weights[metric.key] ?? 0) / totalIndicatorWeight) * percentile : 0
      }
      const status = row.bcEnviroScreenSourceStatuses?.[metric.key]
      if (status && status !== 'independent-match') warnings.add(`${metric.shortLabel}: ${status}`)
    })

    const components = Object.fromEntries(
      COMPONENTS.map((component) => [
        component,
        weightedMean(
          activeMetrics
            .filter((metric) => metric.bcEnviroScreenComponent === component)
            .map((metric) => ({
              value: ranks.get(metric.key)?.get(row.region.id) ?? null,
              weight: weights[metric.key] ?? 0,
            })),
        ),
      ]),
    ) as Record<BcEnviroScreenComponent, number | null>

    const populationUnscaled = weightedMean([
      { value: components.sensitivePopulations, weight: componentWeight(settings, 'sensitivePopulations') },
      { value: components.socioeconomicFactors, weight: componentWeight(settings, 'socioeconomicFactors') },
    ])
    const landscapeUnscaled = weightedMean([
      { value: components.exposures, weight: componentWeight(settings, 'exposures') },
      { value: components.environmentalEffects, weight: componentWeight(settings, 'environmentalEffects') },
    ])
    return {
      row,
      normalizedMetrics,
      contributions,
      components,
      populationUnscaled,
      landscapeUnscaled,
      missingIndicators,
      warnings,
    }
  })

  const populationMax = Math.max(0, ...drafts.map((draft) => draft.populationUnscaled ?? 0))
  const landscapeMax = Math.max(0, ...drafts.map((draft) => draft.landscapeUnscaled ?? 0))
  const scored = drafts.map((draft) => {
    const populationCharacteristicsScore =
      draft.populationUnscaled != null && populationMax > 0 ? (draft.populationUnscaled / populationMax) * 10 : null
    const landscapeBurdenScore =
      draft.landscapeUnscaled != null && landscapeMax > 0 ? (draft.landscapeUnscaled / landscapeMax) * 10 : null
    const formulaContext = Object.fromEntries(
      BC_ENVIRO_SCREEN_METRICS.map((metric) => [
        bcEnviroScreenIndicatorKey(metric.key) ?? metric.key,
        ranks.get(metric.key)?.get(draft.row.region.id) ?? null,
      ]),
    )
    Object.assign(formulaContext, {
      exposures: draft.components.exposures,
      environmental_effects: draft.components.environmentalEffects,
      sensitive_populations: draft.components.sensitivePopulations,
      socioeconomic_factors: draft.components.socioeconomicFactors,
      landscape_burden: landscapeBurdenScore,
      population_characteristics: populationCharacteristicsScore,
    })
    const formulaScore = compiledFormula?.evaluate(formulaContext) ?? null
    const score = formulaScore == null ? 0 : Math.max(0, Math.min(100, formulaScore))
    const coverage = activeMetrics.length
      ? (activeMetrics.length - draft.missingIndicators.length) / activeMetrics.length
      : 1
    return {
      ...draft.row,
      normalizedMetrics: draft.normalizedMetrics as ScoreMetricValueMap,
      contributions: draft.contributions as ScoreMetricValueMap,
      score,
      scoreColor: getScorePaletteOutputColor(score, paletteProfile, settings.visualOutput),
      rank: 0,
      dataCoverageScore: coverage,
      rankConfidence: coverage === 1 ? ('Stable priority' as const) : ('Sensitive result' as const),
      rankInterval: [0, 0] as [number, number],
      scoreInterval: [score, score] as [number, number],
      comparisonUniverseLabel:
        'BC EnviroScreen percentiles are fixed to the complete 89-LHA provincial comparison universe; map filters do not recalculate them.',
      equityAudit: {
        referenceRank: null,
        rankDelta: 0,
        referenceScore: null,
        deprivationQuintile: null,
        burdenOverlap: 0,
        cutoffWarning: null,
      },
      scoreMethodLabel:
        settings.bcEnviroScreenFormula.mode === 'custom'
          ? 'BC EnviroScreen custom formula'
          : 'BC EnviroScreen percentile product',
      missingDataFlags: [
        ...draft.missingIndicators.map((key) => `${key}: missing; excluded from its component mean.`),
        ...draft.warnings,
        ...(formulaError ? [`Custom formula: ${formulaError}`] : []),
      ],
      bcEnviroScreen: {
        components: draft.components,
        landscapeBurdenScore,
        populationCharacteristicsScore,
        formulaMode: settings.bcEnviroScreenFormula.mode,
        formulaExpression,
        formulaError,
        missingIndicators: draft.missingIndicators,
        sourceStatusWarnings: [...draft.warnings],
      },
    }
  })

  scored.sort((a, b) => b.score - a.score || a.region.name.localeCompare(b.region.name))
  return scored.map((row, index) => ({ ...row, rank: index + 1, rankInterval: [index + 1, index + 1] }))
}
