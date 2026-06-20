/**
 * Score-builder walkability source-surface model.
 *
 * The Index Lab can render the live citywide Mobility Index (MI) raster as its
 * map surface when the Walkability data source is active. Two ways drive that
 * raster:
 *
 * 1. Derived (default) — the eight coarse walkability *metric* weights are
 *    projected onto the 44 report factor references through
 *    `SCORE_METRIC_TO_REPORT_REFS`. This keeps the surface in lockstep with the
 *    score equation, but it is lossy: factors with no matching metric stay at 0.
 * 2. Direct — the user tunes the 44 factor references (and the report variant
 *    config toggles) themselves, so the full report MI can be reproduced.
 */
import {
  HEATMAP_DEFAULT_FACTOR_WEIGHTS,
  HEATMAP_REPORT_FIDELITY_OPTIONS,
  WALKABILITY_REPORT_FACTOR_REFS,
  normalizeHeatmapOptions,
  type HeatmapFactorWeightState,
  type HeatmapOptionState,
} from '@/maps/pgdata/walkabilityFactors'
import type { ScoreMetricKey, ScoreMetricWeightMap } from '../types'

/** Worker options applied when the surface is derived from metric weights. */
export const DERIVED_SURFACE_OPTIONS: HeatmapOptionState = { ...HEATMAP_REPORT_FIDELITY_OPTIONS }

/** Maps a coarse walkability metric onto the report factor references it stands in for. */
export const SCORE_METRIC_TO_REPORT_REFS: Partial<Record<ScoreMetricKey, string[]>> = {
  sidewalkDensity: ['G1', 'G5'],
  walkwayDensity: ['G1'],
  walkabilityIntersectionDensity: ['F1', 'G2', 'G3', 'G4', 'G5'],
  walkabilityCrossingDensity: ['F0'],
  class3CrosswalkDensity: ['F0'],
  childcareDensity: ['C0'],
  transitStopDensity: ['F9', 'G0'],
  accessibleTransitStopDensity: ['F9', 'G0'],
  frequentTransitStopAccess: ['F9', 'G0'],
  accessibleFrequentTransitAccess: ['F9', 'G0'],
  transitServiceSpan: ['F9', 'G0'],
  transitTripsPerStop: ['F9', 'G0'],
  parkWalk10Access: ['A2', 'A3', 'A4', 'A5'],
  parkWalk20Access: ['A2', 'A3', 'A4', 'A5'],
  parkTransit20Access: ['A2', 'A3', 'A4', 'A5', 'F9', 'G0'],
  walkabilityPoiDensity: [
    'A0', 'A1', 'B0', 'B1', 'B2', 'B3',
    'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
    'D0', 'D1', 'D2', 'D3', 'D4',
    'E0', 'E1', 'E2', 'E3', 'E4', 'E5', 'E6',
  ],
}

/** Projects metric weights onto a 0–2 factor-weight map normalized to the strongest factor. */
export function buildSourceGridFactorWeights(weights?: ScoreMetricWeightMap): HeatmapFactorWeightState {
  const factorScores = Object.fromEntries(WALKABILITY_REPORT_FACTOR_REFS.map((ref) => [ref, 0])) as HeatmapFactorWeightState
  if (!weights) return factorScores

  for (const [metricKey, weight] of Object.entries(weights) as Array<[ScoreMetricKey, number]>) {
    if (!weight) continue
    const refs = SCORE_METRIC_TO_REPORT_REFS[metricKey]
    if (!refs?.length) continue
    const contribution = weight / refs.length
    for (const ref of refs) {
      factorScores[ref] = Math.max(0, (factorScores[ref] ?? 0) + contribution)
    }
  }

  const maxScore = Math.max(...Object.values(factorScores))
  if (maxScore <= 0) return factorScores
  return Object.fromEntries(
    WALKABILITY_REPORT_FACTOR_REFS.map((ref) => [ref, Math.max(0, Math.min(2, (factorScores[ref] / maxScore) * 2))]),
  )
}

/**
 * Walkability source-surface tuning. Held as visualization state alongside the
 * score equation (like the scenario baseline) rather than in the scored model.
 */
export interface WalkabilitySurfaceTuning {
  /** When true, the factor weights/options below drive the raster directly. */
  enabled: boolean
  factorWeights: HeatmapFactorWeightState
  options: HeatmapOptionState
}

export function createDefaultWalkabilitySurfaceTuning(): WalkabilitySurfaceTuning {
  return {
    enabled: false,
    factorWeights: { ...HEATMAP_DEFAULT_FACTOR_WEIGHTS },
    options: { ...HEATMAP_REPORT_FIDELITY_OPTIONS },
  }
}

export interface ResolvedWalkabilitySurfaceModel {
  factorWeights: HeatmapFactorWeightState
  options: HeatmapOptionState
}

/** Resolves the factor weights + worker options the raster should use. */
export function resolveWalkabilitySurfaceModel(
  tuning: WalkabilitySurfaceTuning | undefined,
  metricWeights: ScoreMetricWeightMap | undefined,
): ResolvedWalkabilitySurfaceModel {
  if (tuning?.enabled) {
    return { factorWeights: tuning.factorWeights, options: normalizeHeatmapOptions(tuning.options) }
  }
  return {
    factorWeights: buildSourceGridFactorWeights(metricWeights),
    options: { ...DERIVED_SURFACE_OPTIONS },
  }
}
