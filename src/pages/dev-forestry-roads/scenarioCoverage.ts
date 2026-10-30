import { alignmentLength, offsetCoordinate, positionAt } from './engine'
import type { Alignment, TerrainSource } from './types'

export const SCENARIO_TERRAIN_STEP_M = 10
export const MAX_SCENARIO_TERRAIN_SAMPLES = 100_000

/** Check the ground used by a built-in scenario, including its whole section corridor.
 * Missing terrain remains missing; a scenario with broken coverage is refused before opening.
 * This checks terrain support, not daylight closure, grades or suitability for construction.
 */
export function checkScenarioTerrain(
  alignments: readonly Alignment[],
  source: TerrainSource,
  sectionHalfWidthM: number,
) {
  let samples = 0
  let missing = 0
  for (const alignment of alignments) {
    const length = alignmentLength(alignment)
    const intervals = Math.max(1, Math.ceil(length / SCENARIO_TERRAIN_STEP_M))
    const sideIntervals = Math.max(1, Math.ceil(sectionHalfWidthM / SCENARIO_TERRAIN_STEP_M))
    if (samples + (intervals + 1) * (sideIntervals * 2 + 1) > MAX_SCENARIO_TERRAIN_SAMPLES)
      throw Error('This scenario exceeds the terrain coverage check budget; shorten its roads before publishing it.')
    for (let station = 0; station <= intervals; station++) {
      const at = positionAt(alignment, (length * station) / intervals)
      for (let side = -sideIntervals; side <= sideIntervals; side++) {
        const offset = (sectionHalfWidthM * side) / sideIntervals
        const coordinate = offsetCoordinate(at.coordinate, at.bearing + (offset < 0 ? -90 : 90), Math.abs(offset))
        samples++
        if (!Number.isFinite(source.elevationAt(...coordinate))) missing++
      }
    }
  }
  return { samples, missing, coveragePercent: samples ? ((samples - missing) / samples) * 100 : 0 }
}

export function requireScenarioTerrain(
  alignments: readonly Alignment[],
  source: TerrainSource,
  sectionHalfWidthM: number,
) {
  const coverage = checkScenarioTerrain(alignments, source, sectionHalfWidthM)
  if (!coverage.samples || coverage.missing)
    throw Error(
      `Scenario terrain is incomplete (${coverage.missing} of ${coverage.samples} corridor samples missing). Your open project is unchanged.`,
    )
  return coverage
}
