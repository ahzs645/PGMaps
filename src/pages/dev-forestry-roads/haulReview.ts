/**
 * The project's haul destination inputs, and what they say about one road: where it joins the
 * loaded roads, the loaded truck's turn there, and the haul and cycle time from it. Pure: no DOM or
 * network access.
 */
import {
  buildHaulNetwork,
  DEFAULT_HAUL_SPEEDS,
  DEFAULT_HAUL_TERMINAL,
  DEFAULT_OFF_NETWORK_FACTOR,
  HAUL_DESTINATION_PRESETS,
  HAUL_LIMITS,
  HAUL_ROAD_CLASSES,
  haulField,
  haulNetworkRoads,
  haulRouteFrom,
  roundTripMinutesAt,
  type HaulDestination,
  type HaulField,
  type HaulRoute,
  type HaulSpeeds,
  type HaulTerminalTimes,
} from './haulDestination'
import {
  DEFAULT_JUNCTION_RULE,
  measureJunction,
  parseJunctionRule,
  type JunctionMeasure,
  type JunctionRule,
} from './junctionOrientation'
import { distance } from './engine'
import type { ContextFeature, Coordinate } from './types'

/** Saved on the project as `haulDestination`. Every field is the project's own input. */
export interface HaulDestinationSettings {
  destination: HaulDestination | null
  speeds: HaulSpeeds
  terminal: HaulTerminalTimes
  offNetworkFactor: number
  junction: JunctionRule
}
export function createHaulSettings(destination: HaulDestination | null = null): HaulDestinationSettings {
  return {
    destination,
    speeds: structuredClone(DEFAULT_HAUL_SPEEDS),
    terminal: { ...DEFAULT_HAUL_TERMINAL },
    offNetworkFactor: DEFAULT_OFF_NETWORK_FACTOR,
    junction: { ...DEFAULT_JUNCTION_RULE },
  }
}

/** A road end within this of a loaded road is a junction (the TFL 30 roads met their hosts within 15 m). */
export const JUNCTION_CONTACT_M = 15

const record = (raw: unknown, label: string) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error(`${label} must be an object.`)
  return raw as Record<string, unknown>
}
const ranged = (value: unknown, label: string, [min, max]: readonly [number, number]) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw Error(`${label} must be between ${min} and ${max}.`)
  return value
}

export function parseHaulSettings(raw: unknown): HaulDestinationSettings {
  const r = record(raw, 'The haul destination settings')
  let destination: HaulDestination | null = null
  if (r.destination !== null && r.destination !== undefined) {
    const d = record(r.destination, 'The haul destination')
    if (typeof d.id !== 'string' || !d.id || d.id.length > 100) throw Error('The haul destination needs an id.')
    if (typeof d.name !== 'string' || !d.name.trim() || d.name.length > 200)
      throw Error('The haul destination needs a name of up to 200 characters.')
    const c = d.coordinate
    if (!Array.isArray(c) || c.length !== 2) throw Error('The haul destination needs a longitude and latitude.')
    destination = {
      id: d.id,
      name: d.name,
      coordinate: [ranged(c[0], 'Destination longitude', [-180, 180]), ranged(c[1], 'Destination latitude', [-85, 85])],
    }
  }
  const speedsRaw = r.speeds === undefined ? {} : record(r.speeds, 'Haul speeds')
  const speeds = structuredClone(DEFAULT_HAUL_SPEEDS)
  for (const roadClass of HAUL_ROAD_CLASSES) {
    if (speedsRaw[roadClass] === undefined) continue
    const s = record(speedsRaw[roadClass], `Haul speeds for ${roadClass}`)
    for (const key of ['loadedKmh', 'emptyKmh'] as const)
      speeds[roadClass][key] = s[key] === null ? null : ranged(s[key], `${roadClass} ${key}`, HAUL_LIMITS.speedKmh)
  }
  const terminalRaw = r.terminal === undefined ? {} : record(r.terminal, 'Haul terminal times')
  const terminal = { ...DEFAULT_HAUL_TERMINAL }
  for (const key of ['loadMin', 'unloadMin', 'delayMin'] as const)
    if (terminalRaw[key] !== undefined) terminal[key] = ranged(terminalRaw[key], `Haul ${key}`, HAUL_LIMITS.terminalMin)
  return {
    destination,
    speeds,
    terminal,
    offNetworkFactor:
      r.offNetworkFactor === undefined
        ? DEFAULT_OFF_NETWORK_FACTOR
        : ranged(r.offNetworkFactor, 'The off-network detour factor', HAUL_LIMITS.offNetworkFactor),
    junction: r.junction === undefined ? { ...DEFAULT_JUNCTION_RULE } : parseJunctionRule(r.junction),
  }
}

/** A preset by id, so a picker can show which one a saved destination is. */
export const presetDestination = (id: string) => HAUL_DESTINATION_PRESETS.find((preset) => preset.id === id) ?? null

type NetworkAlignment = { id: string; name: string; points: readonly { coordinate: Coordinate }[] }
// Building the network reads every loaded road; reuse it while the roads and inputs are unchanged.
const fieldCache = new WeakMap<readonly ContextFeature[], Map<string, HaulField>>()

/**
 * The haul field for the project's roads, leaving out `excludeId` (the road being judged, so its own
 * haul is not routed back up it). Null when no destination is chosen.
 */
export function projectHaulField(
  project: { context: readonly ContextFeature[]; alignments: readonly NetworkAlignment[] },
  settings: HaulDestinationSettings | undefined,
  excludeId?: string,
): HaulField | null {
  if (!settings?.destination) return null
  const others = project.alignments.filter((a) => a.id !== excludeId)
  const key = JSON.stringify([
    settings.destination.coordinate,
    settings.speeds,
    settings.offNetworkFactor,
    others.map((a) => [a.id, a.points.map((p) => p.coordinate)]),
  ])
  let byKey = fieldCache.get(project.context)
  if (!byKey) fieldCache.set(project.context, (byKey = new Map()))
  const cached = byKey.get(key)
  if (cached) return cached
  const network = buildHaulNetwork(haulNetworkRoads(project.context, others))
  const field = haulField(network, settings.destination, settings.speeds, settings.offNetworkFactor)
  if (byKey.size > 8) byKey.clear()
  byKey.set(key, field)
  return field
}

export interface RoadJunctionReview {
  end: 'start' | 'end'
  coordinate: Coordinate
  measure: JunctionMeasure | null
  route: HaulRoute
}
export type RoadHaulReview =
  | { status: 'no-destination' }
  | { status: 'no-junction'; reason: string; destination: HaulDestination }
  /** The haul network could not be built, e.g. it is over its size limit. */
  | { status: 'unavailable'; reason: string; destination: HaulDestination }
  | {
      status: 'assessed'
      destination: HaulDestination
      rule: JunctionRule
      junction: RoadJunctionReview
      /** Loaded trucks run toward the junction. */
      loadedDirection: 'start-to-end' | 'end-to-start'
      /** Both ends meet loaded roads: the junction judged is the one with the shorter haul. */
      bothEndsJoin: boolean
    }

/**
 * The haul review of one road. `centreline` is the road as analysed (station points); the points are
 * used when it is absent. The junction is the road end within `JUNCTION_CONTACT_M` of a loaded road;
 * when both ends are, it is the one with the faster haul. The loaded truck arrives along the road's
 * last 50 m toward that end.
 */
export function reviewRoadHaul(
  project: {
    context: readonly ContextFeature[]
    alignments: readonly NetworkAlignment[]
    haulDestination?: HaulDestinationSettings
  },
  alignment: NetworkAlignment,
  centreline?: readonly Coordinate[],
): RoadHaulReview {
  const settings = project.haulDestination
  if (!settings?.destination) return { status: 'no-destination' }
  const destination = settings.destination
  const line = centreline && centreline.length > 1 ? [...centreline] : alignment.points.map((p) => p.coordinate)
  if (line.length < 2) return { status: 'no-junction', destination, reason: 'The road has fewer than two points.' }
  let field: HaulField | null
  try {
    field = projectHaulField(project, settings, alignment.id)
  } catch (error) {
    return { status: 'unavailable', destination, reason: error instanceof Error ? error.message : String(error) }
  }
  if (!field) return { status: 'no-destination' }
  const roadLength = line.slice(1).reduce((sum, point, i) => sum + distance(line[i], point), 0)
  const ends = (['start', 'end'] as const).map((end) => {
    const coordinate = end === 'start' ? line[0] : line[line.length - 1]
    const route = haulRouteFrom(field, coordinate, {
      accessLengthM: roadLength,
      terminal: settings.terminal,
      toleranceM: JUNCTION_CONTACT_M,
    })
    return { end, coordinate, route, minutes: roundTripMinutesAt(field, coordinate, JUNCTION_CONTACT_M) }
  })
  const joined = ends.filter((e) => e.route.attachDistanceM !== null)
  if (!joined.length)
    return {
      status: 'no-junction',
      destination,
      reason: `Neither end of the road is within ${JUNCTION_CONTACT_M} m of a loaded road or another road in this project.`,
    }
  const chosen = [...joined].sort((a, b) => a.minutes - b.minutes || (a.end === 'start' ? -1 : 1))[0]
  const toward = chosen.end === 'start' ? [...line].reverse() : line
  const departure = chosen.route.departureBearing
  return {
    status: 'assessed',
    destination,
    rule: settings.junction,
    junction: {
      end: chosen.end,
      coordinate: chosen.coordinate,
      measure: departure === null ? null : measureJunction(toward, departure, settings.junction),
      route: chosen.route,
    },
    loadedDirection: chosen.end === 'start' ? 'end-to-start' : 'start-to-end',
    bothEndsJoin: joined.length === 2,
  }
}
