import { analyzeRoad } from './engine'
import { EngineeringInputError, type InvalidInput } from './inputErrors'
import type { Alignment, ContextFeature, RoadAnalysis, RoadSettings, TerrainSource } from './types'

/**
 * Coverage at or above this share of road length counts as complete sections: 100 % less a
 * floating-point tolerance on the summed interval lengths. The engine's coverage warning and the
 * engineering result's completeness use the same rule; compare with `hasCompleteCoverage`.
 */
export const COMPLETE_COVERAGE_PERCENT = 100 - 1e-5

export const hasCompleteCoverage = (analysis: Pick<RoadAnalysis, 'coveragePercent'>) =>
  analysis.coveragePercent >= COMPLETE_COVERAGE_PERCENT

/**
 * The section and engineering inputs of a road, as distinct from its line and grade. An analysis
 * that fails on these is recalculated with the last set that worked, so an invalid edit to a
 * material, range or template leaves the road, its profile and its quantities on screen.
 */
export type DesignInputs = Pick<Alignment, 'template' | 'engineering' | 'overrides' | 'curveDesign'>

export const designInputsOf = (alignment: Alignment): DesignInputs => ({
  template: alignment.template,
  engineering: alignment.engineering,
  overrides: alignment.overrides,
  curveDesign: alignment.curveDesign,
})

const failure = (cause: unknown): InvalidInput => ({
  message: cause instanceof Error ? cause.message : 'This input cannot be calculated.',
  ...(cause instanceof EngineeringInputError ? { target: cause.target } : {}),
})

/**
 * Invalid intermediate edits must be reviewable without taking down the workspace. With
 * `lastValid` (the inputs of the last analysis that calculated), a failure returns the road
 * calculated from those inputs on the current line, and `invalidInput` says what was left out.
 * Without it, or when the line itself is the problem, the result is empty and its warning says why.
 */
export function safeAnalyzeRoad(
  alignment: Alignment,
  source: TerrainSource,
  settings: RoadSettings,
  context: ContextFeature[] = [],
  options: Parameters<typeof analyzeRoad>[4] = {},
  lastValid?: DesignInputs,
): RoadAnalysis {
  try {
    return analyzeRoad(alignment, source, settings, context, options)
  } catch (cause) {
    const invalidInput = failure(cause)
    if (lastValid)
      try {
        const kept = analyzeRoad({ ...alignment, ...lastValid }, source, settings, context, options)
        if (kept.stations.length) return { ...kept, invalidInput }
      } catch {
        // The line or the settings are the problem, not the latest input: report the first failure.
      }
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
        invalidInput.target
          ? `Correct this input before calculating: ${invalidInput.message}`
          : `Correct this alignment before calculating: ${cause instanceof Error ? cause.message : 'Invalid geometry.'}`,
      ],
      invalidInput,
    }
  }
}
