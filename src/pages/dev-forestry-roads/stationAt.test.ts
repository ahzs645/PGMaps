import { describe, expect, it } from 'vitest'
import { analyzeRoad, createRoadStationSampler, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { roadStationAt, typedStationNote } from './stationAt'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

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

describe('a typed station says what its calculated neighbours say', () => {
  const evaluated = (
    chainage: number,
    alignment: Alignment,
    terrain: TerrainSource = ground,
    settings: RoadSettings = DEFAULT_ROAD_SETTINGS,
    context: ContextFeature[] = [],
  ) => {
    const analysis = analyzeRoad(alignment, terrain, settings, context)
    const sampler = createRoadStationSampler(alignment, terrain, settings, { context })
    const neighbours = (...chainages: number[]) =>
      chainages.map((c) => analysis.stations.find((s) => s.chainage === c)!)
    return { analysis, neighbours, at: roadStationAt(analysis, chainage, (s) => sampler.at(s))! }
  }

  it('carries the grade flag of the over-limit pitch it lies in', () => {
    // 2 % formation against a 0.5 % limit: every station is flagged, and so is one typed between two.
    const settings = { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: 0.5 }
    const { at, neighbours } = evaluated(85, road(), ground, settings)
    for (const neighbour of neighbours(80, 90)) expect(neighbour.flags).toContain('Grade exceeds 0.5%')
    expect(at.chainage).toBe(85)
    expect(at.flags).toContain('Grade exceeds 0.5%')
    // Inside the limit, nothing is carried.
    expect(evaluated(85, road()).at.flags.some((flag) => flag.startsWith('Grade exceeds'))).toBe(false)
  })

  it('takes the verdict of the neighbour whose grade it has where a pitch starts', () => {
    // A grade break at 100 m: 1 % before it, 8 % after, against a 5 % limit.
    const broken = road()
    broken.vertical = [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'm', chainage: 100, elevation: 801, curveLength: 0 },
      { id: 'e', chainage: 300, elevation: 817, curveLength: 0 },
    ]
    const settings = { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: 5 }
    const before = evaluated(95, broken, ground, settings)
    expect(before.at.gradePercent).toBeCloseTo(1, 9)
    expect(before.at.flags).not.toContain('Grade exceeds 5%')
    const after = evaluated(105, broken, ground, settings)
    expect(after.at.gradePercent).toBeCloseTo(8, 9)
    expect(after.neighbours(110)[0].flags).toContain('Grade exceeds 5%')
    expect(after.at.flags).toContain('Grade exceeds 5%')
    // A road that follows the ground reports the grade of the interval ending at each station.
    const following = road()
    following.vertical = []
    const steep = evaluated(85, following, ground, { ...DEFAULT_ROAD_SETTINGS, maxGradePercent: 0.01 })
    expect(steep.neighbours(90)[0].flags.some((flag) => flag.startsWith('Grade exceeds'))).toBe(true)
    expect(steep.at.flags).toContain('Grade exceeds 0.01%')
  })

  it('gives the reasons an incomplete section could not be completed', () => {
    // Ground is missing west of the centreline, so no section along the road can daylight there.
    const halfCovered: TerrainSource = {
      elevationAt: (lng, lat) => (local(lng, lat).east < -3 ? NaN : ground.elevationAt(lng, lat)),
    }
    const { at, neighbours } = evaluated(85, road(), halfCovered)
    const [s80] = neighbours(80)
    expect(s80.complete).toBe(false)
    expect(s80.incompleteReasons?.length).toBeGreaterThan(0)
    expect(at.chainage).toBe(85)
    expect(at.complete).toBe(false)
    expect(at.incompleteReasons).toEqual(s80.incompleteReasons)
  })

  it('raises the radius and avoidance-area flags of the point itself', () => {
    const curved = road()
    curved.points = [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 150), radiusM: 20 },
      { id: 'c', coordinate: offsetCoordinate(origin, 120, 250), radiusM: 0 },
    ]
    curved.vertical = []
    const analysis = analyzeRoad(curved, ground, DEFAULT_ROAD_SETTINGS)
    const inCurve = analysis.stations.filter((s) => s.flags.includes('Radius below 25 m'))
    expect(inCurve.length).toBeGreaterThan(1)
    const between = (inCurve[0].chainage + inCurve[1].chainage) / 2
    expect(evaluated(between, curved).at.flags).toContain('Radius below 25 m')

    // The road runs north; a point `east` of the centreline at `north` metres along it.
    const beside = (east: number, north: number) => offsetCoordinate(offsetCoordinate(origin, 0, north), 90, east)
    const box = (south: number, north: number): ContextFeature => ({
      id: 'no-go',
      name: 'Wetland',
      kind: 'avoid',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [beside(-40, south), beside(40, south), beside(40, north), beside(-40, north), beside(-40, south)],
        ],
      },
    })
    // The area's edges are calculated stations; a station typed between them is inside it too.
    const inside = evaluated(85, road(), ground, DEFAULT_ROAD_SETTINGS, [box(72, 98)])
    for (const neighbour of inside.neighbours(80, 90)) expect(neighbour.flags).toContain('Avoidance area: Wetland')
    expect(inside.at.flags).toContain('Avoidance area: Wetland')
    expect(evaluated(105, road(), ground, DEFAULT_ROAD_SETTINGS, [box(72, 98)]).at.flags).not.toContain(
      'Avoidance area: Wetland',
    )
  })
})

describe('the note beside a typed station that is not the station shown', () => {
  const format = { value: (value: number) => String(value), station: (chainage: number) => `0+${chainage.toFixed(1)}` }
  it('says nothing when the typed station is shown', () => {
    expect(typedStationNote(85, 85, 300, 'road', format)).toBeNull()
    expect(typedStationNote(90.0003, 90, 300, 'road', format)).toBeNull()
  })
  it('names the end a value outside the line was held to', () => {
    expect(typedStationNote(2000, 300, 300, 'road', format)).toBe(
      "Station 2000 is past the road's end; showing 0+300.0.",
    )
    expect(typedStationNote(-5, 0, 300, 'terrain profile', format)).toBe(
      "Station -5 is before the terrain profile's start; showing 0+0.0.",
    )
  })
  it('says the nearest calculated station is shown where the typed one cannot be', () => {
    expect(typedStationNote(8, 10, 300, 'terrain profile', format)).toBe(
      'A terrain profile reads the ground at its calculated stations only; showing the nearest to 8, 0+10.0.',
    )
    expect(typedStationNote(8, 10, 300, 'road', format)).toBe(
      'No section could be evaluated at station 8; showing the nearest calculated station, 0+10.0.',
    )
    expect(typedStationNote(8, null, 0, 'road', format)).toBe(
      'No station is calculated on this road yet, so station 8 cannot be shown.',
    )
  })
})
