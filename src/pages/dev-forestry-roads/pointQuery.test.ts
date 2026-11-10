import { describe, expect, it } from 'vitest'
import { createRoadStationSampler, distance, offsetCoordinate } from './engine'
import {
  depthLabel,
  levelsAt,
  locateStationOffset,
  projectOntoRoad,
  queryPoint,
  queryStationOffset,
  roadSectionLookup,
} from './pointQuery'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, RoadStation, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const local = (lng: number, lat: number) => ({
  east: (lng - origin[0]) * (Math.PI / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180),
  north: (lat - origin[1]) * (Math.PI / 180) * 6371008.8,
})
// A cross slope rising to the east, so the left (west) of a northbound road is low.
const ground: TerrainSource = { elevationAt: (lng, lat) => 800 + 0.2 * local(lng, lat).east }

function road(id = 'r', points: Coordinate[] = [origin, offsetCoordinate(origin, 0, 300)]): Alignment {
  return {
    id,
    name: `Road ${id}`,
    color: '#16817a',
    points: points.map((coordinate, i) => ({ id: `${id}${i}`, coordinate, radiusM: 0 })),
    vertical: [
      { id: 's', chainage: 0, elevation: 801, curveLength: 0 },
      { id: 'e', chainage: 300, elevation: 807, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
}
const sectionAt = (alignment: Alignment, chainage: number) =>
  createRoadStationSampler(alignment, ground, DEFAULT_ROAD_SETTINGS).at(chainage)

describe('projecting a point onto a road', () => {
  it('gives the station, and a negative offset to the left looking up-station', () => {
    const northbound = road()
    const centre = offsetCoordinate(origin, 0, 120)
    const left = projectOntoRoad(northbound, offsetCoordinate(centre, 270, 7))!
    expect(left.chainage).toBeCloseTo(120, 2)
    expect(left.offset).toBeCloseTo(-7, 2)
    expect(left.beyond).toBeNull()
    const right = projectOntoRoad(northbound, offsetCoordinate(centre, 90, 4.5))!
    expect(right.offset).toBeCloseTo(4.5, 2)
  })
  it('follows a horizontal curve, not the chord between its points', () => {
    const corner = offsetCoordinate(origin, 0, 200)
    const curved: Alignment = {
      ...road('c', [origin, corner, offsetCoordinate(corner, 90, 200)]),
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: corner, radiusM: 60 },
        { id: 'c', coordinate: offsetCoordinate(corner, 90, 200), radiusM: 0 },
      ],
    }
    // The corner point itself lies outside the arc, on the left of a road turning right.
    const atCorner = projectOntoRoad(curved, corner)!
    expect(atCorner.offset).toBeLessThan(-10)
    // A point located on the curve projects back to where it was put.
    const located = locateStationOffset(curved, 190, -3)!
    const back = projectOntoRoad(curved, located.coordinate)!
    expect(back.chainage).toBeCloseTo(190, 1)
    expect(back.offset).toBeCloseTo(-3, 2)
  })
  it('says when the point lies before the start or past the end', () => {
    const northbound = road()
    expect(projectOntoRoad(northbound, offsetCoordinate(origin, 180, 20))!.beyond).toBe('start')
    expect(projectOntoRoad(northbound, offsetCoordinate(origin, 0, 330))!.beyond).toBe('end')
    expect(projectOntoRoad(northbound, offsetCoordinate(origin, 90, 20))!.beyond).toBeNull()
  })
})

describe('locating a typed station and offset', () => {
  it('puts a negative offset to the left and holds the station to the road', () => {
    const northbound = road()
    const at = locateStationOffset(northbound, 85, -6)!
    expect(at.chainage).toBe(85)
    expect(local(...at.coordinate).east).toBeCloseTo(-6, 2)
    expect(local(...at.coordinate).north).toBeCloseTo(85, 2)
    expect(locateStationOffset(northbound, 400, 0)!.chainage).toBeCloseTo(300, 6)
  })
})

describe('levels at a point', () => {
  it('reads ground, design and the cut or fill depth at the station typed', () => {
    const result = queryStationOffset(road(), 85, 0, ground, sectionAt)!
    expect(result.chainage).toBe(85)
    expect(result.ground).toBeCloseTo(800, 6)
    expect(result.design).toBeCloseTo(801 + (6 * 85) / 300, 4)
    expect(result.depth).toBeCloseTo(1 + (6 * 85) / 300, 4)
    expect(depthLabel(result.depth)).toBe('Fill 2.70 m')
  })
  it('queries the nearest road and names it', () => {
    const near = road('near')
    const far = road('far', [
      offsetCoordinate(origin, 90, 200),
      offsetCoordinate(offsetCoordinate(origin, 90, 200), 0, 300),
    ])
    const point = offsetCoordinate(offsetCoordinate(origin, 0, 50), 90, 30)
    const result = queryPoint([far, near], point, ground, sectionAt)!
    expect(result.roadId).toBe('near')
    expect(result.offset).toBeCloseTo(30, 1)
    expect(distance(result.coordinate, point)).toBe(0)
  })
  it('keeps the design unknown outside the footprint and the depth unknown without ground', () => {
    const result = queryStationOffset(road(), 100, 60, ground, sectionAt)!
    expect(result.design).toBeNull()
    expect(result.designUnknown).toBe('outside-footprint')
    expect(result.depth).toBeNull()
    const gap: TerrainSource = { elevationAt: () => Number.NaN }
    const station = sectionAt(road(), 100)
    expect(levelsAt(station, 0, null).depth).toBeNull()
    expect(levelsAt(null, 0, 800)).toEqual({ design: null, depth: null, designUnknown: 'no-section' })
    const noGround = queryStationOffset(road(), 100, 0, gap, sectionAt)!
    expect(noGround.ground).toBeNull()
    expect(noGround.depth).toBeNull()
    expect(depthLabel(null)).toBeNull()
  })
  it('reports a cut where the design lies below the ground', () => {
    const station = sectionAt(road(), 100) as RoadStation
    const levels = levelsAt(station, 0, (station.designElevation ?? 0) + 1.5)
    expect(levels.depth).toBeCloseTo(-1.5, 6)
    expect(depthLabel(levels.depth)).toBe('Cut 1.50 m')
  })
  it('refuses an offset beyond the limit', () => {
    expect(queryStationOffset(road(), 100, 5000, ground, sectionAt)).toBeNull()
  })
})

describe('the section lookup', () => {
  it('evaluates a road exactly at a station, and has no section for a road that cannot compile', () => {
    const lookup = roadSectionLookup(ground, DEFAULT_ROAD_SETTINGS, {})
    expect(lookup(road(), 85)?.chainage).toBe(85)
    const broken = { ...road('x'), points: [{ id: 'p', coordinate: [Number.NaN, 0] as Coordinate, radiusM: 0 }] }
    expect(lookup(broken, 10)).toBeNull()
  })
})
