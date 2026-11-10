import { describe, expect, it } from 'vitest'
import { DEFAULT_DESIGN_STANDARDS, type DesignStandards } from './designStandards'
import { analyzeRoad, offsetCoordinate } from './engine'
import { sightDistanceRow } from './readiness'
import {
  brakingFriction,
  crestSightDistance,
  curveSightClearings,
  profileSightDistance,
  reviewRoadSight,
  sampleProfile,
  sightAroundCurve,
  sightlineOffset,
  stoppingSightDistance,
} from './sightDistance'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, RoadAnalysis, RoadStation, TerrainSource } from './types'

// Reference numbers: RFLTools functional specification §13 (textbook formulas, TAC 2017 / AASHTO 2018).

/** +4 % to the BVC at 200 (elevation 108), a symmetric 100 m crest about the PVI at 250, −4 % to 500. */
const crest = (s: number) => {
  if (s <= 200) return 100 + 0.04 * s
  if (s <= 300) return 108 + 0.04 * (s - 200) - (0.08 / 200) * (s - 200) ** 2
  return 108 - 0.04 * (s - 300)
}

const origin: Coordinate = [-122.75, 53.917]

/**
 * Synthetic stations: a centreline given by `place`, flat sections across (design on the formation,
 * ground beyond) at the centreline elevation, and an optional wall on the right.
 */
function stationsAlong(
  count: number,
  spacing: number,
  place: (s: number) => { coordinate: Coordinate; bearing: number },
  options: {
    elevation?: (s: number) => number
    width?: number
    wallAtM?: number
    groundGap?: [number, number]
  } = {},
): RoadStation[] {
  const width = options.width ?? 2
  const offsets = [...new Set([...Array.from({ length: 81 }, (_, i) => -20 + i * 0.5), 5, 5.0001])].sort(
    (a, b) => a - b,
  )
  return Array.from({ length: count + 1 }, (_, i) => {
    const s = i * spacing
    const z = (options.elevation ?? (() => 100))(s)
    const missing = options.groundGap && s >= options.groundGap[0] && s <= options.groundGap[1]
    const { coordinate, bearing } = place(s)
    return {
      index: i,
      chainage: s,
      coordinate,
      bearing,
      groundElevation: missing ? null : z,
      designElevation: z,
      gradePercent: null,
      groundGradePercent: null,
      curveRadiusM: null,
      leftWidth: width,
      rightWidth: width,
      section: offsets.map((offset) => ({
        offset,
        ground: missing ? null : options.wallAtM !== undefined && offset > options.wallAtM + 5e-5 ? z + 10 : z,
        design: Math.abs(offset) <= width ? z : null,
      })),
      leftDaylightM: width,
      rightDaylightM: width,
      cutAreaM2: 0,
      fillAreaM2: 0,
      cutVolumeM3: 0,
      fillVolumeM3: 0,
      massM3: 0,
      complete: true,
      flags: [],
    }
  })
}
const analysisOf = (stations: RoadStation[]): RoadAnalysis => ({
  stations,
  centerline: stations.map((s) => s.coordinate),
  crossings: [],
  length: stations[stations.length - 1].chainage,
  cutVolumeM3: 0,
  fillVolumeM3: 0,
  balanceM3: 0,
  surfaceVolumeM3: 0,
  clearingAreaM2: 0,
  estimatedCost: 0,
  maxGradePercent: 0,
  completeLength: 0,
  coveragePercent: 100,
  warnings: [],
})
const north = (s: number) => ({ coordinate: offsetCoordinate(origin, 0, s), bearing: 0 })
/** A right-hand curve of radius R starting north at the origin; the centre lies R to the east. */
const rightCurve = (radius: number) => (s: number) => {
  const angle = s / radius
  const east = radius - radius * Math.cos(angle),
    northing = radius * Math.sin(angle)
  return {
    coordinate: offsetCoordinate(origin, (Math.atan2(east, northing) * 180) / Math.PI, Math.hypot(east, northing)),
    bearing: (angle * 180) / Math.PI,
  }
}
type SightRoad = Parameters<typeof reviewRoadSight>[0]['alignment']
const road = (patch: Record<string, unknown> = {}) =>
  ({
    template: { ...DEFAULT_TEMPLATE, leftWidth: 2, rightWidth: 2 },
    curveDesign: undefined,
    ...patch,
  }) as SightRoad

describe('stopping sight distance (TAC wet-pavement friction, t = 2.5 s)', () => {
  it('reproduces the reference table', () => {
    expect(stoppingSightDistance(30, 2.5, brakingFriction(30), 0)).toBeCloseTo(29.68, 2)
    expect(stoppingSightDistance(50, 2.5, 0.35, 0)).toBeCloseTo(62.81, 2)
    expect(stoppingSightDistance(50, 2.5, 0.35, -0.08)).toBeCloseTo(71.14, 2)
    expect(stoppingSightDistance(50, 2.5, 0.35, 0.08)).toBeCloseTo(57.59, 2)
    expect(stoppingSightDistance(60, 2.5, brakingFriction(60), 0)).toBeCloseTo(84.57, 2)
    // Single-lane meeting at 50 km/h on the level.
    expect(2 * stoppingSightDistance(50, 2.5, 0.35, 0)!).toBeCloseTo(125.6, 1)
  })
  it('takes the next higher tabulated speed between rows, and refuses a grade that cancels braking', () => {
    expect(brakingFriction(45)).toBe(0.35)
    expect(brakingFriction(20)).toBe(0.4)
    expect(brakingFriction(120)).toBe(0.28)
    expect(stoppingSightDistance(50, 2.5, 0.3, -0.31)).toBeNull()
  })
})

describe('profile sight distance over a crest (h1 1.05 m, h2 0.38 m)', () => {
  const step = 0.01
  const profile = sampleProfile(crest, 500, step)
  const look = (eye: number) =>
    profileSightDistance(profile, step, Math.round(eye / step), 1, { eyeHeightM: 1.05, objectHeightM: 0.38, maxM: 250 })
  it('matches the closed form and the scan by eye station', () => {
    expect(crestSightDistance(100, 8, 1.05, 0.38)).toBeCloseTo(82.06, 2)
    expect(crestSightDistance(40, 4, 1.05, 0.38)).toBeCloseTo(87.33, 2)
    expect(look(100).availableM).toBeCloseTo(143.18, 1)
    expect(look(150).availableM).toBeCloseTo(102.41, 1)
    expect(look(175).availableM).toBeCloseTo(87.83, 1)
    expect(look(200).availableM).toBeCloseTo(82.05, 1)
    expect(look(209).availableM).toBeCloseTo(82.05, 1)
    expect(look(225).availableM).toBeCloseTo(83.1, 1)
    expect(look(200).limitedBy).toBe('surface')
    expect(look(250)).toEqual({ availableM: 250, limitedBy: 'clear' })
  })
  it('stops at missing elevation as unknown, and at the road end', () => {
    const gap = profile.map((z, i) => (i * step > 240 && i * step < 241 ? null : z))
    const result = profileSightDistance(gap, step, Math.round(200 / step), 1, {
      eyeHeightM: 1.05,
      objectHeightM: 0.38,
      maxM: 250,
    })
    expect(result.limitedBy).toBe('unknown')
    expect(result.availableM).toBeLessThan(41)
    expect(
      profileSightDistance(profile, step, Math.round(450 / step), 1, {
        eyeHeightM: 1.05,
        objectHeightM: 0.38,
        maxM: 250,
      }).limitedBy,
    ).toBe('road-end')
  })
})

describe('horizontal sightline offset', () => {
  it('reproduces the reference cases', () => {
    expect(sightAroundCurve(60, 5)).toBeCloseTo(49.34, 2)
    expect(sightAroundCurve(100, 4)).toBeCloseTo(56.76, 2)
    expect(sightAroundCurve(40, 6)).toBeCloseTo(44.39, 1)
    expect(sightlineOffset(60, 62.81)).toBeCloseTo(8.03, 2)
    expect(sightlineOffset(100, 62.81)).toBeCloseTo(4.89, 2)
  })
  it('needs less clearance when the sightline runs past a short curve onto its tangents', () => {
    expect(sightlineOffset(60, 62.81, 30)).toBeLessThan(sightlineOffset(60, 62.81))
    expect(sightlineOffset(60, 30, 30)).toBeCloseTo(sightlineOffset(60, 30), 9)
  })
  it('compares the clearance needed on the inside of each curve with the clearing', () => {
    const stations = stationsAlong(60, 1, rightCurve(60))
    stations.forEach((s) => (s.rightClearingM = 6))
    const [curve] = curveSightClearings([{ start: 0, end: 60, length: 60, radius: 60, direction: 'right' }], stations, {
      levelRequiredM: 62.81,
      singleLane: true,
    })
    expect(curve.neededFromCentreM).toBeCloseTo(sightlineOffset(60, 62.81, 60), 6)
    expect(curve.clearedFromCentreM).toBe(6)
    expect(curve.short).toBe(true)
  })
})

describe('sight distance on the road surface (3D)', () => {
  it('finds the crest limit over a straight road, measured along the road', () => {
    const stations = stationsAlong(500, 1, north, { elevation: crest, width: 4 })
    const review = reviewRoadSight({
      analysis: analysisOf(stations),
      alignment: road({
        template: { ...DEFAULT_TEMPLATE, leftWidth: 4, rightWidth: 4 },
        curveDesign: { designSpeedKmh: 70 },
      }),
      profileAt: crest,
    })
    expect(review.singleLane).toBe(false)
    const eye = review.eyes.find((e) => e.chainage === 200 && e.direction === 'ahead')!
    expect(eye.limitedBy).toBe('surface')
    // The 1 m target step quantises the 82.06 m closed form down.
    expect(eye.availableM).toBe(82)
    expect(review.short.length).toBeGreaterThan(0)
  })
  it('finds the curve limit set by a wall on the inside: S = 2R·acos((R − M)/R)', () => {
    const stations = stationsAlong(200, 1, rightCurve(60), { wallAtM: 5 })
    const review = reviewRoadSight({
      analysis: analysisOf(stations),
      alignment: road({ curveDesign: { designSpeedKmh: 50 }, sightDistance: { singleLane: false } }),
    })
    expect(review.singleLane).toBe(false)
    // The eye looks along the right lane (offset +1 on a 2 m half-width): path radius 59, 4 m to the wall.
    const expected = sightAroundCurve(59, 4)
    const eye = review.eyes.find((e) => e.chainage === 50 && e.direction === 'ahead')!
    expect(eye.limitedBy).toBe('surface')
    expect(eye.availableM).toBeGreaterThanOrEqual(Math.floor(expected) - 1)
    expect(eye.availableM).toBeLessThanOrEqual(expected + 0.5)
  })
  it('reports unknown where a sightline crosses missing terrain, never clear', () => {
    const stations = stationsAlong(300, 1, north, { groundGap: [150, 152] })
    // Missing terrain beyond the formation, with the formation itself known.
    stations.forEach((s) => {
      if (s.chainage >= 150 && s.chainage <= 152)
        s.section = s.section.map((p) => (Math.abs(p.offset) <= 2 ? { ...p, ground: 100 } : p))
    })
    const curve = stationsAlong(300, 1, rightCurve(80), { groundGap: [150, 152] })
    const review = reviewRoadSight({
      analysis: analysisOf(curve),
      alignment: road({ curveDesign: { designSpeedKmh: 50 }, sightDistance: { singleLane: true } }),
    })
    expect(review.unknown.length).toBeGreaterThan(0)
    expect(review.unknown.every((eye) => eye.limitedBy === 'unknown')).toBe(true)
    const straight = reviewRoadSight({
      analysis: analysisOf(stations),
      alignment: road({ curveDesign: { designSpeedKmh: 50 }, sightDistance: { singleLane: true } }),
    })
    // On a straight, level road the line never leaves the formation: nothing is unknown or short.
    expect(straight.short).toEqual([])
    expect(straight.unknown).toEqual([])
  })
  it('stands trees beyond the clearing edge when a height is entered', () => {
    const stations = stationsAlong(200, 1, rightCurve(60))
    stations.forEach((s) => (s.rightClearingM = 5))
    const alignment = (vegetationHeightM: number | null) =>
      road({ curveDesign: { designSpeedKmh: 50 }, sightDistance: { singleLane: true, vegetationHeightM } })
    const open = reviewRoadSight({ analysis: analysisOf(stations), alignment: alignment(null) })
    expect(open.short).toEqual([])
    const treed = reviewRoadSight({ analysis: analysisOf(stations), alignment: alignment(20) })
    const eye = treed.eyes.find((e) => e.chainage === 50 && e.direction === 'ahead')!
    expect(eye.limitedBy).toBe('vegetation')
    expect(eye.availableM).toBeCloseTo(sightAroundCurve(60, 5), 0)
  })
  it('needs a design speed', () => {
    const review = reviewRoadSight({ analysis: analysisOf(stationsAlong(10, 1, north)), alignment: road() })
    expect(review.status).toBe('no-speed')
    expect(
      reviewRoadSight({
        analysis: analysisOf(stationsAlong(10, 1, north)),
        alignment: road(),
        standards: { designSpeedKmh: 30 },
      }).status,
    ).toBe('checked')
  })
})

describe('Review row: stopping sight distance along the road', () => {
  const at = (east: number, northing: number) =>
    offsetCoordinate(origin, (Math.atan2(east, northing) * 180) / Math.PI, Math.hypot(east, northing))
  const local = (lon: number, lat: number) => ({
    north: (((lat - origin[1]) * Math.PI) / 180) * 6371008.8,
    east: (((lon - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180),
  })
  const flat: TerrainSource = { elevationAt: () => 800 }
  /** Ground rising 60 % to the east, so a road turning east cuts deep into the bank on its inside. */
  const bank: TerrainSource = { elevationAt: (lon, lat) => 800 + Math.max(0, local(lon, lat).east - 4) * 0.6 }
  const alignment = (patch: Partial<Alignment> = {}): Alignment => ({
    id: 'spur',
    name: 'Spur',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: at(0, 0), radiusM: 0 },
      { id: 'b', coordinate: at(0, 200), radiusM: 40 },
      { id: 'c', coordinate: at(200, 260), radiusM: 0 },
    ],
    vertical: [],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    ...patch,
  })
  const row = (road: Alignment, terrain: TerrainSource, standards?: DesignStandards) =>
    sightDistanceRow({
      alignment: road,
      analysis: analyzeRoad(road, terrain, DEFAULT_ROAD_SETTINGS),
      settings: DEFAULT_ROAD_SETTINGS,
      standards,
    })
  const withSpeed = { ...DEFAULT_DESIGN_STANDARDS, designSpeedKmh: 30 }
  it('is not assessed without a design speed', () => {
    const result = row(alignment(), flat)
    expect(result.state).toBe('not-assessed')
    expect(result.action?.target).toBe('standards')
  })
  it('is met on open, level ground', () => {
    const result = row(alignment(), flat, withSpeed)
    expect(result.state).toBe('met')
    expect(result.judgedOn).toContain('measured along the road')
  })
  it('needs attention where the cut bank inside a tight curve hides the road', () => {
    const result = row(alignment(), bank, { ...withSpeed, designSpeedKmh: 50 })
    expect(result.state).toBe('attention')
    expect(result.severity).toBe('limit')
    expect(result.measured).toMatch(/limited by the road surface or ground/)
  })
  it('is not assessed where a sightline crosses missing terrain', () => {
    const holed: TerrainSource = {
      elevationAt: (lon, lat) => {
        const { east, north } = local(lon, lat)
        return east > 8 && north > 150 && north < 260 ? NaN : 800
      },
    }
    const result = row(alignment(), holed, withSpeed)
    expect(result.state).toBe('not-assessed')
    expect(result.result).toMatch(/unknown/)
  })
})
