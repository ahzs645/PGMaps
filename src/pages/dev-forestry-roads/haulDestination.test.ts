import { describe, expect, it } from 'vitest'
import {
  buildHaulNetwork,
  DEFAULT_HAUL_SPEEDS,
  departureBearingAt,
  haulField,
  haulNetworkRoads,
  haulRouteFrom,
  type HaulDestination,
  type HaulNetworkRoad,
  type HaulSpeeds,
} from './haulDestination'
import type { ContextFeature, Coordinate } from './types'

const RAD = Math.PI / 180,
  R = 6371008.8
const origin: Coordinate = [-122, 54]
/** Metres east and north of the origin. */
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (R * RAD * Math.cos(origin[1] * RAD)),
  origin[1] + y / (R * RAD),
]
const road = (id: string, roadClass: HaulNetworkRoad['roadClass'], ...xy: [number, number][]): HaulNetworkRoad => ({
  id,
  name: id,
  roadClass,
  coordinates: xy.map(([x, y]) => point(x, y)),
})
const destination = (x: number, y: number): HaulDestination => ({ id: 'd', name: 'Town', coordinate: point(x, y) })
const terminal = { loadMin: 30, unloadMin: 20, delayMin: 0 }

/**
 * A 10 km FSR running east from the origin, a permit road leaving it at 5 km and running 2 km north
 * (its end 10 m short of the FSR, as mapped roads often are), and an unconnected road 4 km north
 * that only widens the loaded extent.
 */
const roads = [
  road('main', 'fsr', [0, 0], [5000, 0], [10000, 0]),
  road('spur', 'permit', [5000, 10], [5000, 2000]),
  road('far', 'mapped', [0, 4000], [10000, 4000]),
]

describe('haul network', () => {
  it('joins a road end lying within the snap tolerance of another line, and not lines that only cross', () => {
    const network = buildHaulNetwork(roads)
    expect(network.joins).toBe(1)
    const crossing = buildHaulNetwork([road('a', 'fsr', [0, 0], [1000, 0]), road('b', 'fsr', [500, -500], [500, 500])])
    expect(crossing.joins).toBe(0)
    const gap = buildHaulNetwork([road('a', 'fsr', [0, 0], [1000, 0]), road('b', 'fsr', [500, 40], [500, 500])])
    expect(gap.joins).toBe(0)
  })

  it('reads mapped roads by their source class and the project roads as new road, leaving out closed roads', () => {
    const feature = (id: string, roadClass: 'fsr' | 'permit' | 'user', condition: 'unknown' | 'closed' = 'unknown') =>
      ({
        id,
        name: id,
        kind: 'existing-road',
        geometry: { type: 'LineString', coordinates: [point(0, 0), point(100, 0)] },
        roadEvidence: { source: 'user', roadClass, condition, conditionBasis: 'unreviewed', reuseAllowed: false },
      }) satisfies ContextFeature
    const read = haulNetworkRoads(
      [feature('f', 'fsr'), feature('p', 'permit'), feature('u', 'user'), feature('x', 'fsr', 'closed')],
      [
        { id: 'r1', name: 'Road 1', points: [{ coordinate: point(0, 0) }, { coordinate: point(0, 100) }] },
        { id: 'r2', name: 'Road 2', points: [{ coordinate: point(0, 0) }, { coordinate: point(0, 50) }] },
      ],
      ['r2'],
    )
    expect(read.map((r) => [r.id, r.roadClass])).toEqual([
      ['context:f', 'fsr'],
      ['context:p', 'permit'],
      ['context:u', 'mapped'],
      ['alignment:r1', 'proposed'],
    ])
  })
})

describe('haul to a destination', () => {
  it('routes out of the loaded roads toward the destination and estimates the rest', () => {
    // Town 40 km east: the haul leaves the FSR at its east end, 30 km short.
    const field = haulField(buildHaulNetwork(roads), destination(40000, 0), DEFAULT_HAUL_SPEEDS, 1.4)
    const route = haulRouteFrom(field, point(5000, 1000), { accessLengthM: 500, terminal })
    expect(route.status).toBe('network')
    expect(route.legs.map((leg) => [leg.roadClass, Math.round(leg.lengthM), leg.estimated])).toEqual([
      ['proposed', 500, false],
      ['permit', 1000, false],
      ['fsr', 5000, false],
      ['off-network', 42000, true],
    ])
    expect(route.networkM).toBeCloseTo(6500, -1)
    expect(route.estimatedM).toBeCloseTo(42000, -1)
    // Loaded: 0.5 km at 15, 1 km at 35, 5 km at 40, 42 km at 55 km/h.
    const loaded = (0.5 / 15 + 1 / 35 + 5 / 40 + 42 / 55) * 60
    const empty = (0.5 / 20 + 1 / 45 + 5 / 50 + 42 / 65) * 60
    expect(route.loadedMin).toBeCloseTo(loaded, 0)
    expect(route.emptyMin).toBeCloseTo(empty, 0)
    expect(route.cycleMin).toBeCloseTo(loaded + empty + 50, 0)
    expect(route.loadedMin!).toBeGreaterThan(route.emptyMin!)
    // Down the permit road, south.
    expect(route.departureBearing).toBeCloseTo(180, 0)
    expect(route.reason).toContain('estimated')
  })

  it('leaves along the host toward the destination, whichever side it is on', () => {
    const network = buildHaulNetwork(roads)
    const east = haulField(network, destination(40000, 0), DEFAULT_HAUL_SPEEDS)
    const west = haulField(network, destination(-40000, 0), DEFAULT_HAUL_SPEEDS)
    expect(departureBearingAt(east, point(3000, 0))).toBeCloseTo(90, 0)
    expect(departureBearingAt(west, point(3000, 0))).toBeCloseTo(270, 0)
    expect(departureBearingAt(east, point(3000, 500))).toBeNull()
  })

  it('never leaves by a dead end inside the loaded area, even when it points at the destination', () => {
    // Town due north: the permit road's end (2 km north, inside the loaded extent) is not a way out.
    const field = haulField(buildHaulNetwork(roads), destination(5000, 60000), DEFAULT_HAUL_SPEEDS)
    const route = haulRouteFrom(field, point(5000, 1500), { terminal })
    expect(route.departureBearing).toBeCloseTo(180, 0)
    expect(route.legs.find((leg) => leg.roadClass === 'fsr')!.lengthM).toBeCloseTo(5000, -1)
  })

  it('lets a group of roads with no way out leave by its dead end nearest the destination, and says so', () => {
    // A lone mapped road in the middle of the loaded area: loaded data is patchy, so one of its ends
    // must lead on. The one nearer a town to the north is taken, and the route says it was assumed.
    const network = buildHaulNetwork([...roads, road('lone', 'mapped', [7000, 1500], [7000, 2500])])
    const field = haulField(network, destination(7000, 60000), DEFAULT_HAUL_SPEEDS)
    const route = haulRouteFrom(field, point(7000, 2000), { terminal })
    expect(route.status).toBe('network')
    expect(route.exitAssumed).toBe(true)
    expect(route.departureBearing).toBeCloseTo(0, 0)
    expect(route.reason).toContain('may be a spur')
    expect(haulRouteFrom(field, point(5000, 1500), { terminal }).exitAssumed).toBe(false)
  })

  it('keeps a leg without an entered speed unknown, never zero', () => {
    const speeds: HaulSpeeds = { ...DEFAULT_HAUL_SPEEDS, permit: { loadedKmh: null, emptyKmh: 45 } }
    const field = haulField(buildHaulNetwork(roads), destination(40000, 0), speeds)
    const route = haulRouteFrom(field, point(5000, 1000), { terminal })
    expect(route.oneWayM).toBeGreaterThan(0)
    expect(route.legs.find((leg) => leg.roadClass === 'permit')!.loadedMin).toBeNull()
    expect(route.loadedMin).toBeNull()
    expect(route.emptyMin).not.toBeNull()
    expect(route.cycleMin).toBeNull()
    expect(route.reason).toContain('enter its speeds')
  })

  it('reports a junction off the loaded roads, or with no way out, as unknown', () => {
    const field = haulField(buildHaulNetwork(roads), destination(40000, 0), DEFAULT_HAUL_SPEEDS)
    const off = haulRouteFrom(field, point(3000, 200), { terminal })
    expect(off.status).toBe('unknown')
    expect(off.oneWayM).toBeNull()
    expect(off.cycleMin).toBeNull()
    expect(off.reason).toContain('more than 30 m')
    // A loop road in the middle of a wider loaded area has no way out.
    const island = buildHaulNetwork([
      ...roads,
      road('loop', 'mapped', [6000, 1500], [7000, 1500], [7000, 2500], [6000, 2500], [6000, 1500]),
    ])
    const stuck = haulRouteFrom(haulField(island, destination(40000, 0), DEFAULT_HAUL_SPEEDS), point(6500, 1500), {
      terminal,
    })
    expect(stuck.status).toBe('unknown')
    expect(stuck.reason).toContain('No loaded road')
    const empty = haulRouteFrom(haulField(buildHaulNetwork([]), destination(0, 0), DEFAULT_HAUL_SPEEDS), point(0, 0), {
      terminal,
    })
    expect(empty.status).toBe('unknown')
  })

  it('takes the faster way, not the shorter one', () => {
    // A slow road with the town 1.5 km off its west end, and a fast FSR looping from its east end
    // round to 1.5 km the other side of the town.
    const network = buildHaulNetwork([
      road('main', 'mapped', [0, 0], [5000, 0], [10000, 0]),
      road('bypass', 'fsr', [10000, 0], [10000, -3000], [0, -3000]),
      road('far', 'mapped', [0, 4000], [10000, 4000]),
    ])
    const speeds: HaulSpeeds = {
      ...DEFAULT_HAUL_SPEEDS,
      mapped: { loadedKmh: 5, emptyKmh: 5 },
      fsr: { loadedKmh: 80, emptyKmh: 80 },
    }
    const field = haulField(network, destination(0, -1500), speeds)
    // 8 km out: 2 km east on the slow road, then the FSR, beats 8 km west on it.
    expect(departureBearingAt(field, point(8000, 0))).toBeCloseTo(90, 0)
    expect(departureBearingAt(field, point(500, 0))).toBeCloseTo(270, 0)
  })
})
