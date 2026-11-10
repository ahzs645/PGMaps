/**
 * Junction orientation: a new road should meet its host so that a loaded truck turns out toward the
 * destination through a mild turn, not a hairpin. This measures that turn, places candidate
 * junctions along the host, and gives the route search the end heading that makes it arrive that
 * way. No DOM or network access.
 *
 * The turn is the loaded truck's deflection: the angle between the heading it arrives on (the last
 * stretch of the new road) and the heading it leaves on (the host, toward the destination). 0° drives
 * straight on, 90° is a right-angle tee, 180° is a full hairpin.
 */
import { bearingDeg } from './haulDestination'
import { distance } from './engine'
import type { Coordinate } from './types'

export interface JunctionRule {
  /** The loaded turn a junction may take. The route search enforces at most this. */
  maxTurnDeg: number
  /** Turns up to this cost nothing when placing a junction; above it they cost length. */
  preferredTurnDeg: number
  /** How far along the host either side of the nearest point a junction may move, metres. */
  windowM: number
}
export const DEFAULT_JUNCTION_RULE: JunctionRule = { maxTurnDeg: 90, preferredTurnDeg: 45, windowM: 300 }
/**
 * The route search holds an end heading within ±45° (`routing.ts`), so the widest turn it can be held
 * to while still allowing a straight-on arrival is 90°. A rule tighter than 45° cannot be enforced by
 * that window and is not offered.
 */
export const JUNCTION_RULE_LIMITS = {
  maxTurnDeg: [45, 90],
  preferredTurnDeg: [0, 90],
  windowM: [0, 1000],
} as const
/** The new road's arrival heading is read over its last this-many metres (the TFL 30 study used 50 m). */
export const JUNCTION_ARRIVAL_WINDOW_M = 50
/** Spacing of candidate junctions along the host. */
export const JUNCTION_STEP_M = 20
/** Candidate junctions tried per host, best first; each is a full route search. */
export const MAX_JUNCTION_TRIES = 3
/** Candidates tried for one host are at least this far apart along it. */
export const MIN_JUNCTION_SEPARATION_M = 40
/** Placing a junction: metres of extra new road one degree of turn above the preferred turn is worth. */
export const JUNCTION_TURN_PENALTY_M_PER_DEG = 3
/** Half-width of the route search's heading window (`routing.ts` `headingOk`). */
export const ROUTE_HEADING_WINDOW_DEG = 45

export type JunctionTurnState = 'preferred' | 'within' | 'sharp'

/** Smallest angle between two bearings, 0–180°. */
export function loadedTurnDeg(arrivalBearing: number, departureBearing: number) {
  return Math.abs(((((arrivalBearing - departureBearing) % 360) + 540) % 360) - 180)
}

export function turnState(turnDeg: number, rule: JunctionRule): JunctionTurnState {
  if (turnDeg <= rule.preferredTurnDeg + 1e-9) return 'preferred'
  if (turnDeg <= rule.maxTurnDeg + 1e-9) return 'within'
  return 'sharp'
}

/**
 * The heading a road arrives on at the last point of `line`, read from the point `windowM` back along
 * it. Null when the line is shorter than a metre.
 */
export function arrivalBearing(line: readonly Coordinate[], windowM = JUNCTION_ARRIVAL_WINDOW_M): number | null {
  const end = line[line.length - 1]
  let travelled = 0
  for (let i = line.length - 1; i > 0; i--) {
    const step = distance(line[i - 1], line[i])
    if (travelled + step >= windowM && step > 0) {
      const f = (windowM - travelled) / step
      const from: Coordinate = [
        line[i][0] + f * (line[i - 1][0] - line[i][0]),
        line[i][1] + f * (line[i - 1][1] - line[i][1]),
      ]
      return bearingDeg(from, end)
    }
    travelled += step
  }
  return travelled > 1 ? bearingDeg(line[0], end) : null
}

export interface JunctionMeasure {
  arrivalBearing: number
  departureBearing: number
  turnDeg: number
  /** The acute angle between the new road and the host line, 0–90°. */
  acuteDeg: number
  state: JunctionTurnState
}

/** The loaded turn at a junction, from the new road ordered toward the junction. */
export function measureJunction(
  roadTowardJunction: readonly Coordinate[],
  departureBearing: number,
  rule: JunctionRule = DEFAULT_JUNCTION_RULE,
): JunctionMeasure | null {
  const arrival = arrivalBearing(roadTowardJunction)
  if (arrival === null) return null
  const turnDeg = loadedTurnDeg(arrival, departureBearing)
  return {
    arrivalBearing: arrival,
    departureBearing,
    turnDeg,
    acuteDeg: Math.min(turnDeg, 180 - turnDeg),
    state: turnState(turnDeg, rule),
  }
}

/** +1 when `point` is left of a line through `at` on `bearing` (looking along it), −1 when right. */
export function sideOf(point: Coordinate, at: Coordinate, bearing: number): 1 | -1 {
  const kx = Math.cos(at[1] * (Math.PI / 180))
  const vx = (point[0] - at[0]) * kx,
    vy = point[1] - at[1]
  const dx = Math.sin(bearing * (Math.PI / 180)),
    dy = Math.cos(bearing * (Math.PI / 180))
  return dx * vy - dy * vx >= 0 ? 1 : -1
}

/**
 * The arrival heading to hold the route search to (its ±45° window), so the loaded turn onto the
 * departure bearing stays within `maxTurnDeg`. A road from the left of the departure direction
 * arrives turned clockwise from it, one from the right counter-clockwise; the window is shifted to
 * that side so it spans turns of `maxTurnDeg − 90°` to `maxTurnDeg`.
 */
export function approachHeading(departureBearing: number, side: 1 | -1, maxTurnDeg: number) {
  const shift = Math.max(0, Math.min(ROUTE_HEADING_WINDOW_DEG, maxTurnDeg - ROUTE_HEADING_WINDOW_DEG))
  return (((departureBearing + side * shift) % 360) + 360) % 360
}

/** The reverse bearing: a route searched from the junction leaves it opposite to how trucks arrive. */
export const reverseBearing = (bearing: number) => (bearing + 180) % 360

export interface OrientedJunction {
  coordinate: Coordinate
  /** Along the host from the nearest point, metres; positive in the host line's digitised direction. */
  offsetM: number
  departureBearing: number
  /** Arrival heading for the route search (`endHeading` on a search that ends at the junction). */
  arrivalHeading: number
  /** The turn a straight approach from the landing would take; the routed road may differ. */
  estimatedTurnDeg: number
  /** Straight distance from the landing, metres. */
  approachM: number
  score: number
}

/** Cumulative chainage along a line, metres. */
function chainages(line: readonly Coordinate[]) {
  const out = [0]
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + distance(line[i - 1], line[i]))
  return out
}
function pointAt(line: readonly Coordinate[], along: readonly number[], s: number): Coordinate {
  for (let i = 1; i < line.length; i++)
    if (s <= along[i] || i === line.length - 1) {
      const span = along[i] - along[i - 1]
      const f = span > 0 ? Math.max(0, Math.min(1, (s - along[i - 1]) / span)) : 0
      return [line[i - 1][0] + f * (line[i][0] - line[i - 1][0]), line[i - 1][1] + f * (line[i][1] - line[i - 1][1])]
    }
  return line[line.length - 1]
}

/**
 * Candidate junctions along a host road within the rule's window of the nearest point, best first.
 * Each is scored by the straight approach from the landing plus a length charge for every degree its
 * straight approach would turn above the preferred turn, and a steeper one above the maximum.
 * `departureAt` gives the bearing a loaded truck leaves each host point on (null where unknown; such
 * points are skipped). At most `tries` candidates, `MIN_JUNCTION_SEPARATION_M` apart, are returned.
 */
export function junctionCandidates(
  landing: Coordinate,
  host: readonly Coordinate[],
  nearest: { segmentIndex: number; fraction: number },
  departureAt: (point: Coordinate) => number | null,
  rule: JunctionRule = DEFAULT_JUNCTION_RULE,
  tries = MAX_JUNCTION_TRIES,
): OrientedJunction[] {
  if (host.length < 2) return []
  const along = chainages(host)
  const i = Math.max(0, Math.min(host.length - 2, nearest.segmentIndex))
  const s0 = along[i] + Math.max(0, Math.min(1, nearest.fraction)) * (along[i + 1] - along[i])
  const total = along[along.length - 1]
  const offsets = new Set<number>([0])
  for (let d = JUNCTION_STEP_M; d <= rule.windowM + 1e-9; d += JUNCTION_STEP_M) offsets.add(d).add(-d)
  const scored: OrientedJunction[] = []
  for (const offset of offsets) {
    const s = s0 + offset
    if (s < -1e-6 || s > total + 1e-6) continue
    const coordinate = pointAt(host, along, s)
    const approachM = distance(landing, coordinate)
    if (approachM < 2) continue
    const departure = departureAt(coordinate)
    if (departure === null) continue
    const estimatedTurnDeg = loadedTurnDeg(bearingDeg(landing, coordinate), departure)
    const score =
      approachM +
      JUNCTION_TURN_PENALTY_M_PER_DEG * Math.max(0, estimatedTurnDeg - rule.preferredTurnDeg) +
      JUNCTION_TURN_PENALTY_M_PER_DEG * 3 * Math.max(0, estimatedTurnDeg - rule.maxTurnDeg)
    scored.push({
      coordinate,
      offsetM: offset,
      departureBearing: departure,
      arrivalHeading: approachHeading(departure, sideOf(landing, coordinate, departure), rule.maxTurnDeg),
      estimatedTurnDeg,
      approachM,
      score,
    })
  }
  scored.sort((a, b) => a.score - b.score || Math.abs(a.offsetM) - Math.abs(b.offsetM))
  const kept: OrientedJunction[] = []
  for (const candidate of scored) {
    if (kept.length >= tries) break
    if (kept.every((k) => Math.abs(k.offsetM - candidate.offsetM) >= MIN_JUNCTION_SEPARATION_M - 1e-9))
      kept.push(candidate)
  }
  return kept
}

/** What a caller needs to orient junctions: where loaded trucks head from any host point, and the rule. */
export interface JunctionOrientation {
  departureAt: (point: Coordinate) => number | null
  rule: JunctionRule
}

/** Turns a candidate's arrival heading into the heading a search that starts at the junction leaves on. */
export function junctionStartHeading(candidate: OrientedJunction) {
  return reverseBearing(candidate.arrivalHeading)
}

export function parseJunctionRule(raw: unknown): JunctionRule {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('The junction rule must be an object.')
  const r = raw as Record<string, unknown>
  const read = (key: keyof JunctionRule, label: string) => {
    const value = r[key] === undefined ? DEFAULT_JUNCTION_RULE[key] : r[key]
    const [min, max] = JUNCTION_RULE_LIMITS[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
      throw Error(`${label} must be between ${min} and ${max}.`)
    return value
  }
  const rule = {
    maxTurnDeg: read('maxTurnDeg', 'The largest loaded junction turn (°)'),
    preferredTurnDeg: read('preferredTurnDeg', 'The preferred loaded junction turn (°)'),
    windowM: read('windowM', 'The junction window along the host (m)'),
  }
  if (rule.preferredTurnDeg > rule.maxTurnDeg)
    throw Error('The preferred junction turn cannot be larger than the largest allowed turn.')
  return rule
}
