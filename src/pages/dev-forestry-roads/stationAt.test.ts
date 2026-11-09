import { describe, expect, it } from 'vitest'
import { analyzeRoad, createRoadStationSampler, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { roadStationAt } from './stationAt'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, TerrainSource } from './types'

const origin: Coordinate = [-122.8, 53.9]
const local = (lng: number, lat: number) => ({
  east: (lng - origin[0]) * (Math.PI / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180),
  north: (lat - origin[1]) * (Math.PI / 180) * 6371008.8,
})
// Rolling ground with a cross slope, so a section at 85 is not the section at 80 or 90.
const ground: TerrainSource = {
  elevationAt: (lng, lat) => {
    const p = local(lng, lat)
    return 800 + 4 * Math.sin(p.north / 23) + 0.08 * p.east
  },
}
function road(): Alignment {
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 300), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'e', chainage: 300, elevation: 806, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  }
}
const station = (chainage: number, alignment = road()) => {
  const analysis = analyzeRoad(alignment, ground, DEFAULT_ROAD_SETTINGS)
  const sampler = createRoadStationSampler(alignment, ground, DEFAULT_ROAD_SETTINGS)
  return { analysis, at: roadStationAt(analysis, chainage, (s) => sampler.at(s))! }
}

describe('a station typed between calculation stations', () => {
  it('is evaluated where it was typed, not at the nearest 10 m station', () => {
    const { analysis, at } = station(85)
    expect(analysis.stations.some((s) => s.chainage === 85)).toBe(false)
    expect(at.chainage).toBe(85)
    expect(at.designElevation).toBeCloseTo(800 + (6 * 85) / 300, 9)
    expect(at.groundElevation).toBeCloseTo(800 + 4 * Math.sin(85 / 23), 4)
    expect(at.complete).toBe(true)
    // The same section the engine cuts when 85 is a calculation station: a haul site makes it one.
    const withKnot = road()
    withKnot.engineering = createEngineeringDesign()
    withKnot.engineering.sites = [
      {
        id: 'pit',
        name: 'Pit',
        kind: 'borrow',
        chainage: 85,
        accessDistanceM: 0,
        capacityM3: null,
        unitRate: 0,
        fixedCost: 0,
      },
    ]
    const calculated = analyzeRoad(withKnot, ground, DEFAULT_ROAD_SETTINGS).stations.find((s) => s.chainage === 85)!
    expect(at.cutAreaM2).toBeCloseTo(calculated.cutAreaM2!, 9)
    expect(at.fillAreaM2).toBeCloseTo(calculated.fillAreaM2!, 9)
    expect(at.leftDaylightM).toBeCloseTo(calculated.leftDaylightM!, 9)
    expect(at.section).toEqual(calculated.section)
    expect(at.gradePercent).toBeCloseTo(2, 9)
    // It differs from both neighbours, which is why snapping to them was wrong.
    const [s80, s90] = [80, 90].map((c) => analysis.stations.find((s) => s.chainage === c)!)
    for (const neighbour of [s80, s90])
      expect(
        Math.abs(at.cutAreaM2! - neighbour.cutAreaM2!) + Math.abs(at.fillAreaM2! - neighbour.fillAreaM2!),
      ).toBeGreaterThan(0.1)
    // Interval volumes belong to calculation intervals; the mass ordinate is read off the diagram's line.
    expect(at.cutVolumeM3).toBeNull()
    expect(at.massM3).toBeCloseTo((s80.massM3! + s90.massM3!) / 2, 9)
    expect(at.index).toBe(s80.index)
  })

  it('returns the calculated station itself when the chainage is one', () => {
    const { analysis, at } = station(90)
    expect(at).toBe(analysis.stations.find((s) => s.chainage === 90))
    expect(station(90.0003).at.chainage).toBe(90)
    expect(station(716.1 - 626).at.chainage).toBeCloseTo(90.1, 9)
  })

  it('holds a chainage past either end to the road', () => {
    const { analysis, at } = station(2000)
    expect(at).toBe(analysis.stations.at(-1))
    expect(station(-5).at.chainage).toBe(0)
  })

  it('takes the ground grade of its interval on a road that follows the ground', () => {
    const following = road()
    following.vertical = []
    const { analysis, at } = station(85, following)
    expect(at.designElevation).toBe(at.groundElevation)
    expect(at.gradePercent).toBe(analysis.stations.find((s) => s.chainage === 90)!.groundGradePercent)
  })

  it('falls back to the nearest calculated station without an evaluator or when it fails', () => {
    const analysis = analyzeRoad(road(), ground, DEFAULT_ROAD_SETTINGS)
    const s90 = analysis.stations.find((s) => s.chainage === 90)
    expect(roadStationAt(analysis, 86)).toBe(s90)
    expect(
      roadStationAt(analysis, 86, () => {
        throw new Error('no section')
      }),
    ).toBe(s90)
  })
})
