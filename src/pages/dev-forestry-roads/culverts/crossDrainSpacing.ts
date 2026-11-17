/**
 * BC guidance for cross-drain spacing along a road (Engineering Manual §3.5.5.6, Table 3-14): which
 * of the table's limits governs each stretch between culverts, read from every grade band the
 * stretch passes through. A preview beside the design, never an input to it: nothing here places a
 * culvert, and the ditch soil's erosion hazard is always the designer's entry, never inferred.
 *
 * The limit comes from each grade band of the stretch, not from its steepest grade alone. On high
 * erosion-hazard soil the table allows 75 m at 9–12% but 100 m (with a rock-lined ditch) above 12%,
 * so a stretch mixing 10% and 14% is held to 75 m, where the steepest grade alone would read 100 m.
 *
 * `crossDrainStretchGuidance` reads one stretch, so the batch cross-drain preview can ask it of any
 * stretch it proposes; `crossDrainSpacingGuidance` reads the runs between a road's culverts.
 *
 * Free of DOM and network access.
 */
import { DEFAULT_SWITCHBACK_ROUTE_OPTIONS } from '../switchbackOptions'
import type { RoadStation } from '../types'
import {
  CROSS_DRAIN_GRADE_ROWS,
  CROSS_DRAIN_SPACING,
  crossDrainGradeRow,
  crossDrainSpacingM,
  type DitchErosionHazard,
} from './engineeringManual'

const EPS = 1e-6

export type SpacingStation = Pick<RoadStation, 'chainage' | 'gradePercent'>

/** The length of a stretch in one row of the table. */
export interface CrossDrainGradeBand {
  /** Row of `CROSS_DRAIN_SPACING.spacingM`. */
  row: number
  /** The row as the table prints it: "9–12%". */
  label: string
  lengthM: number
  /** Steepest design grade read in this band, %. */
  steepestPercent: number
  /** The table's maximum spacing for this band and hazard, m. */
  limitM: number
  /** High-hazard soil over 12%: the table also asks for a rock-lined ditch. */
  rockLineDitch: boolean
}

export interface CrossDrainStretch {
  start: number
  end: number
  lengthM: number
  /** One entry per table row the stretch passes through, flattest first. */
  bands: CrossDrainGradeBand[]
  /** Length where the design grade is not known. */
  unknownM: number
  /** The band with the shortest limit: the stretch's governing limit. Null when no grade is known. */
  governing: CrossDrainGradeBand | null
  /** What the steepest grade alone would read, m; kept to show where it differs from `governing`. */
  steepestOnlyLimitM: number | null
  /**
   * `within`: no longer than the governing limit. `over`: longer. `not-determined`: part of the
   * stretch has no grade and the known part does not already put it over.
   */
  state: 'within' | 'over' | 'not-determined'
  /** Length of the stretch that the table asks to have a rock-lined ditch. */
  rockLineDitchM: number
  /** Sag low points inside the stretch: the manual places a cross-drain there whatever the spacing. */
  lowPoints: number[]
  /** Switchbacks inside the stretch: spacing there is by site, not the table. */
  switchbacks: number[]
}

/**
 * The table's guidance for one stretch of road. Each interval between calculated stations is split
 * at its middle: the first half takes the grade at its start station, the second half the grade at
 * its end, so no grade is invented between two that were calculated.
 */
export function crossDrainStretchGuidance(input: {
  stations: readonly SpacingStation[]
  start: number
  end: number
  hazard: DitchErosionHazard
  lowPoints?: readonly number[]
  switchbacks?: readonly number[]
}): CrossDrainStretch {
  const { hazard } = input
  const start = Math.min(input.start, input.end),
    end = Math.max(input.start, input.end)
  const stations = [...input.stations].sort((a, b) => a.chainage - b.chainage)
  const bands = new Map<number, CrossDrainGradeBand>()
  let unknownM = 0
  const add = (from: number, to: number, grade: number | null) => {
    const length = Math.min(to, end) - Math.max(from, start)
    if (length <= EPS) return
    if (grade === null || !Number.isFinite(grade)) {
      unknownM += length
      return
    }
    const g = Math.abs(grade)
    const row = crossDrainGradeRow(g)
    const limitM = crossDrainSpacingM(g)[hazard]
    const band = bands.get(row)
    if (band) {
      band.lengthM += length
      band.steepestPercent = Math.max(band.steepestPercent, g)
      band.limitM = Math.min(band.limitM, limitM)
      band.rockLineDitch ||= rockLine(hazard, g)
    } else
      bands.set(row, {
        row,
        label: CROSS_DRAIN_GRADE_ROWS[row],
        lengthM: length,
        steepestPercent: g,
        limitM,
        rockLineDitch: rockLine(hazard, g),
      })
  }
  if (!stations.length) unknownM = end - start
  else {
    // Before the first and after the last station, the nearest station's grade.
    add(-Infinity, stations[0].chainage, stations[0].gradePercent)
    for (let i = 1; i < stations.length; i++) {
      const a = stations[i - 1],
        b = stations[i]
      const mid = (a.chainage + b.chainage) / 2
      add(a.chainage, mid, a.gradePercent)
      add(mid, b.chainage, b.gradePercent)
    }
    add(stations[stations.length - 1].chainage, Infinity, stations[stations.length - 1].gradePercent)
  }
  const list = [...bands.values()].sort((a, b) => a.row - b.row)
  const governing = list.reduce<CrossDrainGradeBand | null>(
    (best, band) => (!best || band.limitM < best.limitM - EPS ? band : best),
    null,
  )
  const steepest = list.length ? Math.max(...list.map((band) => band.steepestPercent)) : null
  const lengthM = end - start
  const inside = (chainage: number) => chainage >= start - EPS && chainage <= end + EPS
  return {
    start,
    end,
    lengthM,
    bands: list,
    unknownM,
    governing,
    steepestOnlyLimitM: steepest === null ? null : crossDrainSpacingM(steepest)[hazard],
    state:
      governing && lengthM > governing.limitM + EPS
        ? 'over'
        : unknownM > EPS || !governing
          ? 'not-determined'
          : 'within',
    rockLineDitchM: list.filter((band) => band.rockLineDitch).reduce((sum, band) => sum + band.lengthM, 0),
    lowPoints: (input.lowPoints ?? []).filter(inside),
    switchbacks: (input.switchbacks ?? []).filter(inside),
  }
}

const rockLine = (hazard: DitchErosionHazard, grade: number) =>
  hazard === 'high' && grade > CROSS_DRAIN_SPACING.rockLineDitchAbovePercent + EPS

export interface CrossDrainSpacingGuidance {
  hazard: DitchErosionHazard
  /** The runs between culverts and from each road end, in order along the road. */
  stretches: CrossDrainStretch[]
  over: CrossDrainStretch[]
  notDetermined: CrossDrainStretch[]
}

/**
 * The table's guidance for every run of a road between its culverts (any culvert relieves the
 * ditch) and from each road end, the way Review's spacing row measures runs.
 */
export function crossDrainSpacingGuidance(input: {
  stations: readonly SpacingStation[]
  lengthM: number
  culverts: ReadonlyArray<{ chainage: number }>
  hazard: DitchErosionHazard
  lowPoints?: readonly number[]
  switchbacks?: readonly number[]
}): CrossDrainSpacingGuidance {
  const drains = [...new Set(input.culverts.map((c) => c.chainage))]
    .filter((chainage) => chainage > EPS && chainage < input.lengthM - EPS)
    .sort((a, b) => a - b)
  const edges = input.lengthM > EPS ? [0, ...drains, input.lengthM] : []
  const stretches = edges.slice(1).map((end, i) =>
    crossDrainStretchGuidance({
      stations: input.stations,
      start: edges[i],
      end,
      hazard: input.hazard,
      lowPoints: input.lowPoints,
      switchbacks: input.switchbacks,
    }),
  )
  return {
    hazard: input.hazard,
    stretches,
    over: stretches.filter((s) => s.state === 'over'),
    notDetermined: stretches.filter((s) => s.state === 'not-determined'),
  }
}

/** A change of heading at least this, within one curve, makes it a switchback (the route search's own rule). */
export const SWITCHBACK_TURN_DEG = DEFAULT_SWITCHBACK_ROUTE_OPTIONS.hairpinAngleDeg
/** Curves separated by a tangent shorter than this are read as one turn. */
export const SWITCHBACK_JOIN_M = 20

/**
 * Switchbacks on a calculated road: curved stretches (stations with a curve radius, joined across
 * tangents shorter than `SWITCHBACK_JOIN_M`) whose heading turns `SWITCHBACK_TURN_DEG` or more. The
 * chainage given is the middle of the turn.
 */
export function switchbackChainages(
  stations: ReadonlyArray<Pick<RoadStation, 'chainage' | 'bearing' | 'curveRadiusM'>>,
  turnDeg = SWITCHBACK_TURN_DEG,
): number[] {
  const out: number[] = []
  let turn = 0,
    first: number | null = null,
    last: number | null = null
  const close = () => {
    if (first !== null && last !== null && Math.abs(turn) >= turnDeg - EPS) out.push((first + last) / 2)
    turn = 0
    first = last = null
  }
  for (let i = 1; i < stations.length; i++) {
    const a = stations[i - 1],
      b = stations[i]
    const curved = b.curveRadiusM !== null && b.curveRadiusM > 0
    if (!curved && last !== null && b.chainage - last > SWITCHBACK_JOIN_M) close()
    if (!curved && first === null) continue
    if (first === null) first = a.chainage
    if (curved) last = b.chainage
    turn += ((((b.bearing - a.bearing) % 360) + 540) % 360) - 180
  }
  close()
  return out
}
