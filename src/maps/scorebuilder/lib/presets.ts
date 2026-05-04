import type { BoundarySource } from '@/maps/airquality'
import { SCORE_METRICS, SCORE_PRESETS, getScoreDataSourcesForWeights } from '../constants'
import type { ScoreDataSource, ScoreMetricWeightMap, ScorePreset } from '../types'

export function scoreDataSourcesEqual(a: ScoreDataSource[], b: ScoreDataSource[]): boolean {
  if (a.length !== b.length) return false
  const bSet = new Set(b)
  return a.every((source) => bSet.has(source))
}

export function scoreWeightsEqual(a: ScoreMetricWeightMap, b: ScoreMetricWeightMap): boolean {
  return SCORE_METRICS.every((metric) => a[metric.key] === b[metric.key])
}

export function presetAppliesToBoundary(preset: ScorePreset, boundarySource: BoundarySource): boolean {
  if (preset.boundarySources) return preset.boundarySources.includes(boundarySource)

  const sources = getScoreDataSourcesForWeights(preset.weights)
  if (boundarySource === 'bcHealth') return sources.length === 1 && sources[0] === 'airQuality'
  if (boundarySource === 'cityPG') {
    const sourceSet = new Set(sources)
    const cityFriendlySources = new Set<ScoreDataSource>([
      'airQuality',
      'parks',
      'heatShade',
      'restaurants',
      'census',
      'crime',
      'transit',
      'deprivation',
    ])
    return sources.every((source) => cityFriendlySources.has(source)) && !sourceSet.has('bcAssessment')
  }
  return true
}

export function getActivePresetKey(
  weights: ScoreMetricWeightMap,
  enabledDataSources: ScoreDataSource[],
  boundarySource: BoundarySource,
): string | null {
  const match = SCORE_PRESETS.find((preset) => {
    return (
      presetAppliesToBoundary(preset, boundarySource) &&
      scoreWeightsEqual(preset.weights, weights) &&
      scoreDataSourcesEqual(getScoreDataSourcesForWeights(preset.weights), enabledDataSources)
    )
  })
  return match?.key || null
}
