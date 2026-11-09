/**
 * The road station a reader asked for by chainage. Calculation stations sit at the station spacing
 * and at design breakpoints; a typed station such as 85 or 716.1 usually lies between two of them.
 * No DOM.
 */
import { nearestStation } from './engine'
import type { RoadAnalysis, RoadStation } from './types'

/** A chainage this close to a calculated station is that station. */
export const STATION_MATCH_M = 0.0005

/**
 * The calculated station at `chainage` when there is one, otherwise the section evaluated exactly
 * there by `evaluate` (a `createRoadStationSampler` for the same road, terrain and settings). The
 * chainage is held to the road. Interval volumes belong to calculation intervals, so an evaluated
 * station has none; its mass ordinate is read off the straight line the diagram draws between its
 * neighbours. Without `evaluate`, or if the section cannot be evaluated, the nearest calculated
 * station is returned.
 */
export function roadStationAt(
  analysis: RoadAnalysis,
  chainage: number,
  evaluate?: (chainage: number) => RoadStation,
): RoadStation | undefined {
  const stations = analysis.stations
  const nearest = nearestStation(stations, chainage)
  if (!nearest || !evaluate || !Number.isFinite(chainage)) return nearest
  const at = Math.max(0, Math.min(analysis.length, chainage))
  if (Math.abs(nearest.chainage - at) <= STATION_MATCH_M) return nearest
  let section: RoadStation
  try {
    section = evaluate(at)
  } catch {
    return nearest
  }
  const after = stations.find((s) => s.chainage > at) ?? stations[stations.length - 1]
  const before = stations[Math.max(0, after.index - 1)]
  const span = after.chainage - before.chainage
  const t = span > 1e-9 ? (at - before.chainage) / span : 0
  return {
    ...section,
    index: nearest.index,
    // Grades are reported per interval: this station takes those of the interval it lies in.
    groundGradePercent: after.groundGradePercent,
    gradePercent: section.gradePercent ?? after.groundGradePercent,
    massM3: before.massM3 === null || after.massM3 === null ? null : before.massM3 + (after.massM3 - before.massM3) * t,
  }
}
