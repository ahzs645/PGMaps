import { analyzeRoad } from './engine'
import type { Alignment, ContextFeature, RoadAnalysis, RoadSettings, TerrainSource } from './types'

/** Invalid intermediate edits must be reviewable without taking down the workspace. */
export function safeAnalyzeRoad(
  alignment: Alignment,
  source: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[] = [],
): RoadAnalysis {
  try {
    return analyzeRoad(alignment, source, settings, context)
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
