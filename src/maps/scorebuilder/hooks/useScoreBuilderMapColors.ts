import { useMemo } from 'react'
import { getChoroplethColor } from '@/components/ui/map-styles'
import {
  getScorePaletteOutputColor,
  getWalkabilityReportMiColor,
  type ScorePaletteProfile,
} from '../constants'
import {
  computeCorrelation,
  topMetricCorrelations,
  type CorrelationResult,
  type MetricCorrelation,
} from '../lib/correlation'
import { buildBivariateBreaks, getBivariateColor, getResidualColor } from '../lib/correlationColors'
import type { RegionMetricRow } from '../lib/scoring'
import type { ScoreSpread } from '../lib/scoreSummaries'
import type {
  ScoredBoundaryRegion,
  ScoreMethodSettings,
  ScoreMetricKey,
  ScoreMetricRangeMap,
} from '../types'

export interface ScoreBuilderMapColorsOptions {
  correlateMode: boolean
  correlateMetricX: ScoreMetricKey
  correlateMetricY: ScoreMetricKey
  correlateVisStyle: 'bivariate' | 'residual'
  densityMode: boolean
  densityMetric: ScoreMetricKey
  regionMetricRows: RegionMetricRow[]
  metricRanges: ScoreMetricRangeMap
  scoredRegions: ScoredBoundaryRegion[]
  scorePaletteProfile: ScorePaletteProfile
  visualOutput: ScoreMethodSettings['visualOutput']
  mapColorScale: ScoreMethodSettings['mapColorScale']
  scoreSpread: ScoreSpread
  canUseWalkabilitySourceSurface: boolean
  showWalkabilitySourceSurface: boolean
}

/**
 * Resolves the per-region fill colors for whichever map lens is active
 * (correlate, density, walkability MI bands, or the regular score palette),
 * plus the correlation statistics backing the correlate lens.
 */
export function useScoreBuilderMapColors({
  correlateMode,
  correlateMetricX,
  correlateMetricY,
  correlateVisStyle,
  densityMode,
  densityMetric,
  regionMetricRows,
  metricRanges,
  scoredRegions,
  scorePaletteProfile,
  visualOutput,
  mapColorScale,
  scoreSpread,
  canUseWalkabilitySourceSurface,
  showWalkabilitySourceSurface,
}: ScoreBuilderMapColorsOptions) {
  const correlationResult = useMemo<CorrelationResult>(() => {
    if (!correlateMode) return { stats: null, points: [], residualMaxAbs: 0 }
    return computeCorrelation(regionMetricRows, correlateMetricX, correlateMetricY)
  }, [correlateMode, correlateMetricX, correlateMetricY, regionMetricRows])

  const correlationTopPairs = useMemo<MetricCorrelation[]>(() => {
    if (!correlateMode) return []
    return topMetricCorrelations(regionMetricRows, { limit: 10 })
  }, [correlateMode, regionMetricRows])

  const correlateRegionFillColors = useMemo<Record<string, string> | null>(() => {
    if (!correlateMode) return null
    if (!correlationResult.points.length) return {}
    if (correlateVisStyle === 'residual') {
      const colors: Record<string, string> = {}
      for (const point of correlationResult.points) {
        colors[point.regionId] = getResidualColor(point.residual, correlationResult.residualMaxAbs)
      }
      return colors
    }
    const xs = correlationResult.points.map((point) => point.x)
    const ys = correlationResult.points.map((point) => point.y)
    const breaks = buildBivariateBreaks(xs, ys)
    const colors: Record<string, string> = {}
    for (const point of correlationResult.points) {
      colors[point.regionId] = getBivariateColor(point.x, point.y, breaks)
    }
    return colors
  }, [correlateMode, correlateVisStyle, correlationResult])

  const densityRegionFillColors = useMemo<Record<string, string> | null>(() => {
    if (!densityMode) return null
    const range = metricRanges[densityMetric]
    if (!range || range.max <= range.min) return {}
    const colors: Record<string, string> = {}
    for (const row of regionMetricRows) {
      const value = row.metrics[densityMetric]
      colors[row.region.id] = getChoroplethColor(value, range.min, range.max, 'amber')
    }
    return colors
  }, [densityMode, densityMetric, metricRanges, regionMetricRows])

  const walkabilityBoundaryRegionFillColors = useMemo<Record<string, string> | null>(() => {
    if (!canUseWalkabilitySourceSurface || showWalkabilitySourceSurface) return null
    const colors: Record<string, string> = {}
    for (const region of scoredRegions) {
      colors[region.region.id] = getWalkabilityReportMiColor(region.score)
    }
    return colors
  }, [canUseWalkabilitySourceSurface, scoredRegions, showWalkabilitySourceSurface])

  const scoreRegionFillColors = useMemo<Record<string, string> | null>(() => {
    // Binned output is always absolute (fixed 0-20/20-40/... bands via each region's scoreColor fallback).
    if (visualOutput === 'binned') return null
    const colors: Record<string, string> = {}
    if (mapColorScale === 'absolute') {
      // Map each region's raw 0-100 score straight onto the palette so colors stay put as the model changes.
      for (const region of scoredRegions) {
        colors[region.region.id] = getScorePaletteOutputColor(region.score, scorePaletteProfile, visualOutput)
      }
      return colors
    }
    // Relative: stretch colors between the current lowest/highest scores for maximum contrast.
    if (scoreSpread.max <= scoreSpread.min) return null
    const span = scoreSpread.max - scoreSpread.min
    for (const region of scoredRegions) {
      const stretchedScore = ((region.score - scoreSpread.min) / span) * 100
      colors[region.region.id] = getScorePaletteOutputColor(stretchedScore, scorePaletteProfile, visualOutput)
    }
    return colors
  }, [visualOutput, mapColorScale, scoredRegions, scorePaletteProfile, scoreSpread.max, scoreSpread.min])

  const mapRegionFillColors = correlateMode
    ? correlateRegionFillColors
    : densityMode
      ? densityRegionFillColors
      : walkabilityBoundaryRegionFillColors ?? scoreRegionFillColors

  return { correlationResult, correlationTopPairs, mapRegionFillColors }
}
