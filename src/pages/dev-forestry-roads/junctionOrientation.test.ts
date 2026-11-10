import { describe, expect, it } from 'vitest'
import { blockLandings, suggestBlockAccess } from './blockAccess'
import { suggestFsrConnections } from './fsrConnections'
import {
  approachHeading,
  arrivalBearing,
  DEFAULT_JUNCTION_RULE,
  junctionCandidates,
  loadedTurnDeg,
  measureJunction,
  parseJunctionRule,
  sideOf,
  turnState,
  type JunctionOrientation,
} from './junctionOrientation'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

const RAD = Math.PI / 180,
  R = 6371008.8
const origin: Coordinate = [-122, 54]
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (R * RAD * Math.cos(origin[1] * RAD)),
  origin[1] + y / (R * RAD),
]
const xy = (c: Coordinate) => [(c[0] - origin[0]) * R * RAD * Math.cos(origin[1] * RAD), (c[1] - origin[1]) * R * RAD]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 15,
  minRadius: 20,
  cutRate: 1,
  fillRate: 1,
  surfacingRate: 1,
  clearingRate: 1,
  shrinkFactor: 1,
}
const flat: TerrainSource = { elevationAt: () => 800 }
/** A west–east FSR 2 km long through the origin. */
const host: ContextFeature = {
  id: 'host',
  name: 'Host FSR',
  kind: 'existing-road',
  geometry: { type: 'LineString', coordinates: [point(-1000, 0), point(1000, 0)] },
  roadEvidence: {
    source: 'user',
    roadClass: 'fsr',
    condition: 'unknown',
    conditionBasis: 'unreviewed',
    reuseAllowed: false,
  },
}
/** A 100 m square block whose south edge is 200 m north of the FSR. */
const block: ContextFeature = {
  id: 'block',
  name: 'Block 7',
  kind: 'harvest',
  geometry: {
    type: 'Polygon',
    coordinates: [[point(-50, 200), point(50, 200), point(50, 300), point(-50, 300), point(-50, 200)]],
  },
}
/** The destination is east (bearing 90°) or west along the host, wherever the truck is. */
const toward = (bearing: number): JunctionOrientation => ({
  departureAt: (c) => (Math.abs(xy(c)[1]) < 5 ? bearing : null),
  rule: DEFAULT_JUNCTION_RULE,
})

describe('loaded junction turn', () => {
  it('measures the deflection between arrival and departure headings, 0–180°', () => {
    expect(loadedTurnDeg(350, 10)).toBeCloseTo(20)
    expect(loadedTurnDeg(180, 90)).toBeCloseTo(90)
    expect(loadedTurnDeg(90, 270)).toBeCloseTo(180)
    expect(loadedTurnDeg(135, 90)).toBeCloseTo(45)
    expect(turnState(30, DEFAULT_JUNCTION_RULE)).toBe('preferred')
    expect(turnState(80, DEFAULT_JUNCTION_RULE)).toBe('within')
    expect(turnState(120, DEFAULT_JUNCTION_RULE)).toBe('sharp')
  })

  it('reads the arrival over the last 50 m of the road, so a bend before it does not count', () => {
    // East for 200 m, then south for 100 m to the junction.
    const road = [point(-200, 100), point(0, 100), point(0, 0)]
    expect(arrivalBearing(road)).toBeCloseTo(180, 0)
    const tee = measureJunction(road, 90)!
    expect(tee.turnDeg).toBeCloseTo(90, 0)
    expect(tee.acuteDeg).toBeCloseTo(90, 0)
    // A spur swept toward the haul: south-east into an eastbound host.
    const swept = measureJunction([point(-100, 80), point(0, 0)], 90)!
    expect(swept.turnDeg).toBeCloseTo(38.7, 0)
    expect(swept.state).toBe('preferred')
    expect(measureJunction([point(0, 0), point(0.2, 0)], 90)).toBeNull()
  })

  it('shifts the search window to the side the road comes from', () => {
    expect(sideOf(point(0, 200), point(0, 0), 90)).toBe(1)
    expect(sideOf(point(0, -200), point(0, 0), 90)).toBe(-1)
    // From the north into an eastbound haul: arrive between east (0° turn) and south (90°).
    expect(approachHeading(90, 1, 90)).toBe(135)
    expect(approachHeading(90, -1, 90)).toBe(45)
    expect(approachHeading(90, 1, 45)).toBe(90)
    expect(approachHeading(10, -1, 90)).toBe(325)
  })

  it('validates a saved rule', () => {
    expect(parseJunctionRule({})).toEqual(DEFAULT_JUNCTION_RULE)
    expect(() => parseJunctionRule({ maxTurnDeg: 120 })).toThrow('between 45 and 90')
    expect(() => parseJunctionRule({ maxTurnDeg: 60, preferredTurnDeg: 70 })).toThrow('cannot be larger')
  })
})

describe('junction candidates along the host', () => {
  const landing = point(0, 200)
  const line = (host.geometry as GeoJSON.LineString).coordinates as Coordinate[]
  const nearest = { segmentIndex: 0, fraction: 0.5 }

  it('moves the junction toward the destination, so a straight approach is swept toward the haul', () => {
    const east = junctionCandidates(landing, line, nearest, toward(90).departureAt)
    expect(east.length).toBe(3)
    expect(east[0].offsetM).toBeGreaterThan(0)
    expect(east[0].estimatedTurnDeg).toBeLessThan(90)
    expect(east[0].arrivalHeading).toBe(135)
    for (const c of east) expect(Math.abs(c.offsetM)).toBeLessThanOrEqual(DEFAULT_JUNCTION_RULE.windowM)
    for (let i = 1; i < east.length; i++)
      for (let j = 0; j < i; j++) expect(Math.abs(east[i].offsetM - east[j].offsetM)).toBeGreaterThanOrEqual(40)
    const west = junctionCandidates(landing, line, nearest, toward(270).departureAt)
    expect(west[0].offsetM).toBeLessThan(0)
    expect(west[0].arrivalHeading).toBe(225)
  })

  it('stays at the nearest point when the window is zero, and skips points with no known way out', () => {
    const fixed = junctionCandidates(landing, line, nearest, toward(90).departureAt, {
      ...DEFAULT_JUNCTION_RULE,
      windowM: 0,
    })
    expect(fixed.map((c) => c.offsetM)).toEqual([0])
    expect(junctionCandidates(landing, line, nearest, () => null)).toEqual([])
  })
})

describe('oriented access searches', () => {
  it('block access arrives turned toward the destination, at no less length than the nearest junction', () => {
    const plain = suggestBlockAccess(block, flat, settings, [host]).options[0]
    const oriented = suggestBlockAccess(block, flat, settings, [host], {}, 4, 'fsr', toward(90)).options[0]
    // Unconstrained, the leg runs straight south onto the FSR: a right-angle turn.
    expect(measureJunction(plain.coordinates, 90)!.turnDeg).toBeCloseTo(90, 0)
    expect(oriented.junction!.oriented).toBe(true)
    expect(oriented.junction!.turnDeg!).toBeLessThan(80)
    expect(oriented.lengthM).toBeGreaterThanOrEqual(plain.lengthM - 1e-6)
    expect(xy(oriented.target.coordinate)[0]).toBeGreaterThan(0)
    expect(oriented.coordinates.at(-1)).toEqual(oriented.target.coordinate)
    expect(oriented.coordinates[0]).toEqual(blockLandings(block, [host])[0].landing)
    const west = suggestBlockAccess(block, flat, settings, [host], {}, 4, 'fsr', toward(270)).options[0]
    expect(xy(west.target.coordinate)[0]).toBeLessThan(0)
    expect(west.junction!.turnDeg!).toBeLessThan(80)
    expect(suggestBlockAccess(block, flat, settings, [host], {}, 4, 'fsr', toward(90)).message).toContain(
      'turn out toward the destination',
    )
  })

  it('an FSR connector is oriented the same way', () => {
    const result = suggestFsrConnections(point(0, 300), flat, settings, [host], {}, 'nearest', undefined, toward(90))
    expect(result.selected.junction!.oriented).toBe(true)
    expect(result.selected.junction!.turnDeg!).toBeLessThanOrEqual(90)
    expect(xy(result.selected.target.coordinate)[0]).toBeGreaterThan(0)
  })

  it('falls back to the nearest point when no oriented junction can be placed', () => {
    // No way to the destination is known along the host, so no candidate is placed.
    const option = suggestBlockAccess(block, flat, settings, [host], {}, 4, 'fsr', {
      ...toward(90),
      departureAt: () => null,
    }).options[0]
    expect(option.junction).toEqual({ turnDeg: null, oriented: false, movedM: 0 })
  })
})
