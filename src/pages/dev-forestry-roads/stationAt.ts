/**
 * The road station a reader asked for by chainage. Calculation stations sit at the station spacing
 * and at design breakpoints; a typed station such as 85 or 716.1 usually lies between two of them.
 * No DOM.
 */
import { isGradeBreachFlag } from './designStandards'
import { nearestStation } from './engine'
import type { RoadAnalysis, RoadStation } from './types'

/** A chainage this close to a calculated station is that station. */
export const STATION_MATCH_M = 0.0005

/**
 * The calculated station at `chainage` when there is one, otherwise the section evaluated exactly
 * there by `evaluate` (a `createRoadStationSampler` for the same road, terrain and settings). The
 * chainage is held to the road. Interval volumes belong to calculation intervals, so an evaluated
 * station has none; its mass ordinate is read off the straight line the diagram draws between its
 * neighbours. The grade standard is judged over runs of calculated stations, so an evaluated station
 * takes the grade flag, or the lack of one, of the neighbour whose grade it has. Without `evaluate`,
 * or if the section cannot be evaluated, the nearest calculated station is returned.
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
  // Grades are reported per interval: this station takes those of the interval it lies in.
  const gradePercent = section.gradePercent ?? after.groundGradePercent
  const gradeFlag = gradePercent === null ? undefined : gradeFlagBetween(gradePercent, before, after)
  return {
    ...section,
    ...(gradeFlag ? { flags: [...section.flags, gradeFlag] } : {}),
    index: nearest.index,
    groundGradePercent: after.groundGradePercent,
    gradePercent,
    massM3: before.massM3 === null || after.massM3 === null ? null : before.massM3 + (after.massM3 - before.massM3) * t,
  }
}

/**
 * Between two stations the grade is constant, or changes steadily inside a vertical curve. The
 * neighbour with the nearer grade stands for this station; a tie goes to the one ahead, whose
 * interval this station lies in.
 */
function gradeFlagBetween(gradePercent: number, before: RoadStation, after: RoadStation): string | undefined {
  const gap = (station: RoadStation) =>
    station.gradePercent === null ? Infinity : Math.abs(station.gradePercent - gradePercent)
  return (gap(before) < gap(after) ? before : after).flags.find(isGradeBreachFlag)
}

/**
 * What to tell a reader whose typed station is not the station shown, or null when it is. `shown`
 * is the station the views resolved to; `line` names what the stations run along.
 */
export function typedStationNote(
  entered: number,
  shown: number | null,
  length: number,
  line: 'road' | 'terrain profile',
  format: { value: (value: number) => string; station: (chainage: number) => string },
): string | null {
  if (shown === null)
    return `No station is calculated on this ${line} yet, so station ${format.value(entered)} cannot be shown.`
  if (entered < 0)
    return `Station ${format.value(entered)} is before the ${line}'s start; showing ${format.station(shown)}.`
  if (entered > length)
    return `Station ${format.value(entered)} is past the ${line}'s end; showing ${format.station(shown)}.`
  if (Math.abs(shown - entered) <= STATION_MATCH_M) return null
  return line === 'road'
    ? `No section could be evaluated at station ${format.value(entered)}; showing the nearest calculated station, ${format.station(shown)}.`
    : `A terrain profile reads the ground at its calculated stations only; showing the nearest to ${format.value(entered)}, ${format.station(shown)}.`
}
