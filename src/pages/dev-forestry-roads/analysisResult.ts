import { analyzeRoad } from './engine'
import type { Alignment, ContextFeature, RoadAnalysis, RoadSettings, TerrainSource } from './types'

/**
 * Coverage at or above this share of road length counts as complete sections: 100 % less a
 * floating-point tolerance on the summed interval lengths. The engine's coverage warning and the
 * engineering result's completeness use the same rule; compare with `hasCompleteCoverage`.
 */
export const COMPLETE_COVERAGE_PERCENT = 100 - 1e-5

export const hasCompleteCoverage = (analysis: Pick<RoadAnalysis, 'coveragePercent'>) =>
  analysis.coveragePercent >= COMPLETE_COVERAGE_PERCENT

/** Invalid intermediate edits must be reviewable without taking down the workspace. */
export function safeAnalyzeRoad(
  alignment: Alignment,
  source: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[] = [],
  options: Parameters<typeof analyzeRoad>[4] = {},
): RoadAnalysis {
  try {
    return analyzeRoad(alignment, source, settings, context, options)
  } catch (cause) {
    return {
      stations: [],
      centerline: alignment.points.map((p) => p.coordinate),
      crossings: [],
      length: 0,
      cutVolumeM3: 0,
      fillVolumeM3: 0,
      balanceM3: 0,
      surfaceVolumeM3: 0,
      clearingAreaM2: 0,
      estimatedCost: 0,
      maxGradePercent: 0,
      completeLength: 0,
      coveragePercent: 0,
      warnings: [
        `Correct this alignment before calculating: ${cause instanceof Error ? cause.message : 'Invalid geometry.'}`,
      ],
    }
  }
}
