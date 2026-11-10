/**
 * Landings as input to extraction reach, and the catchment each landing serves, on synthetic ground.
 */
import { describe, expect, it } from 'vitest'
import { cableCoverBatches, cableLandings, type CableCandidate } from './cableCoverage'
import { DEFAULT_CABLE_RULE } from './cableCoverageRule'
import { runToCompletion } from './cooperative'
import {
  LANDING_JOIN_M,
  landingInputFeatures,
  nearestRoadPoint,
  pointsAlong,
  resolveLandings,
  roadLengthM,
  roadStretch,
  validateLandings,
  type LandingInput,
} from './extractionLandings'
import {
  DEFAULT_EXTRACTION_SETTINGS,
  extractionOnGrid,
  prepareExtractionGrid,
  X_BEYOND,
  X_COVERED,
  X_UNKNOWN,
  type ExtractionGrid,
  type ExtractionSettings,
} from './extractionReach'
import { catchmentMapFeatures, landingCatchments } from './landingCatchments'
import type { SkidRoad } from './skidReach'
import type { Coordinate } from './types'

const LON0 = -122.5,
  LAT0 = 54.2,
  M = 111_195,
  COS = Math.cos((LAT0 * Math.PI) / 180)
const toGrid = (c: Coordinate): [number, number] => [(c[0] - LON0) * M * COS, (c[1] - LAT0) * M]
const toLonLat = ([x, y]: [number, number]): Coordinate => [LON0 + x / (M * COS), LAT0 + y / M]
const rect = (x0: number, y0: number, x1: number, y1: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    (
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ] as [number, number][]
    ).map(toLonLat),
  ],
})
const road = (id: string, points: [number, number][], use: SkidRoad['use'] = 'truck'): SkidRoad => ({
  id,
  name: id,
  kind: 'existing',
  coordinates: points.map(toLonLat),
  use,
})
const point = (id: string, x: number, y: number, status: LandingInput['status'] = 'existing'): LandingInput => ({
  id,
  name: id,
  status,
  yarder: 'either',
  coordinates: [toLonLat([x, y])],
  source: 'plan',
})
const MAIN = road('main', [
  [-400, 0],
  [400, 0],
])

function grid(
  landings: LandingInput[] = [],
  roads: SkidRoad[] = [MAIN],
  z: (x: number, y: number) => number = () => 1000,
  settings: ExtractionSettings = DEFAULT_EXTRACTION_SETTINGS,
): ExtractionGrid {
  return runToCompletion(
    prepareExtractionGrid({
      block: rect(-300, 10, 300, 300),
      roads,
      ground: { elevationAt: (lon, lat) => z(...toGrid([lon, lat])) },
      toGrid,
      toLonLat,
      settings,
      landings,
      cellM: 10,
      offBlockM: 50,
    }),
  )
}
const cellAt = (eg: ExtractionGrid, x: number, y: number) => {
  const { origin, cellM, width } = eg.sg.grid
  return Math.round((origin[1] - y) / cellM) * width + Math.round((x - origin[0]) / cellM)
}

describe('landing geometry', () => {
  const line = [toLonLat([0, 0]), toLonLat([100, 0]), toLonLat([100, 200])]
  it('cuts a stretch of a road by distance along it, or one point at a station', () => {
    expect(roadLengthM(line, toGrid)).toBeCloseTo(300, 6)
    const stretch = roadStretch(line, 50, 150, toGrid, toLonLat).map(toGrid)
    expect(stretch).toHaveLength(3)
    expect(stretch[0][0]).toBeCloseTo(50, 6)
    expect(stretch[1][0]).toBeCloseTo(100, 6)
    expect(stretch[1][1]).toBeCloseTo(0, 6)
    expect(stretch[2][1]).toBeCloseTo(50, 6)
    const station = roadStretch(line, 120, 120, toGrid, toLonLat).map(toGrid)
    expect(station).toHaveLength(1)
    expect(station[0][0]).toBeCloseTo(100, 6)
    expect(station[0][1]).toBeCloseTo(20, 6)
    expect(() => roadStretch(line, 0, 400, toGrid, toLonLat)).toThrow(/within the road/)
  })

  it('finds the nearest road point and spaces points along a line', () => {
    expect(
      nearestRoadPoint(
        [50, 30],
        [
          [
            [0, 0],
            [100, 0],
          ],
        ],
      ),
    ).toEqual({ xy: [50, 0], distanceM: 30 })
    expect(nearestRoadPoint([0, 0], [])).toBeNull()
    expect(
      pointsAlong(
        [
          [0, 0],
          [100, 0],
        ],
        25,
      ),
    ).toHaveLength(5)
    expect(pointsAlong([[3, 4]], 25)).toEqual([[3, 4]])
  })

  it('refuses a landing without status, side or position, and too many landings', () => {
    expect(() => validateLandings([{ ...point('a', 0, 0), status: 'built' as never }])).toThrow(/existing or proposed/)
    expect(() => validateLandings([{ ...point('a', 0, 0), yarder: 'left' as never }])).toThrow(/above, below/)
    expect(() => validateLandings([{ ...point('a', 0, 0), coordinates: [] }])).toThrow(/no position/)
    expect(() => validateLandings([point('a', 0, 0), point('a', 1, 1)])).toThrow(/own id/)
    expect(() => validateLandings(Array.from({ length: 41 }, (_, k) => point(`l${k}`, 0, 0)))).toThrow(/at most 40/)
  })

  it('joins a point near a road to it, leaves a far one alone, and reports one off the grid', () => {
    const eg = grid([point('near', -200, 15), point('far', 0, 200)])
    const [near, far] = eg.landings!
    // The cells joining it reach the road's own cells.
    expect(near.cells.some((i) => eg.roadCells[0].includes(i))).toBe(true)
    expect(near.roadDistanceM).toBeCloseTo(15, 6)
    expect(far.cells).toEqual([cellAt(eg, 0, 200)])
    expect(far.roadDistanceM! > LANDING_JOIN_M).toBe(true)
    const placed = resolveLandings(eg.sg, [point('in', 0, 0), point('out', 5000, 0)])
    expect(placed.offGrid).toEqual(['out'])
    expect(() => grid([point('out', 5000, 0)])).toThrow(/No landing lies on the grid/)
  })

  it('draws landings as labelled markers and stretches as lines', () => {
    const features = landingInputFeatures(
      [point('L1', 0, 0), { ...point('L2', 0, 0), coordinates: [toLonLat([0, 0]), toLonLat([50, 0])] }],
      () => '#000000',
    )
    expect(features.map((f) => f.geometry.type)).toEqual(['Point', 'LineString', 'Point'])
    expect(features[0].properties?.label).toBe('L1 · existing')
  })
})

describe('ground machines with landings', () => {
  const both = [point('west', -200, 0), point('east', 200, 0)]

  it('without landings, keeps every road cell and reports catchments by road', () => {
    const eg = grid()
    const result = runToCompletion(extractionOnGrid(eg))
    expect(result.summary.coveredShare).toBe(1)
    const c = landingCatchments(result)
    expect(c.by).toBe('road')
    expect(c.rows.map((r) => r.name)).toEqual(['main'])
    expect(c.rows[0].share).toBe(1)
    expect(c.rows[0].ha).toBeCloseTo(result.summary.stateHa.covered, 6)
  })

  it('takes logs only to the landings, along the road as on a trail, and splits the block between them', () => {
    const eg = grid(both)
    const result = runToCompletion(extractionOnGrid(eg))
    const strict = result.state.cells[0]
    // Midway between the landings: no nearer than the straight line to one, and within the 350 m reach.
    const middle = cellAt(eg, 0, 100)
    expect(result.state.states[middle]).toBe(X_COVERED)
    expect(strict.totalM[middle]).toBeGreaterThan(Math.hypot(200, 100) - 10)
    expect(strict.totalM[middle]).toBeLessThanOrEqual(350)
    // Some ground leaves along the road: its distance includes a stretch of road.
    expect(eg.sg.blockCells.some((i) => strict.trackM[i] > 0)).toBe(true)
    // The far corner is out of reach of both landings.
    expect(result.state.states[cellAt(eg, 0, 290)]).toBe(X_BEYOND)
    expect(result.summary.coveredShare).toBeLessThan(1)
    const c = landingCatchments(result)
    expect(c.by).toBe('landing')
    expect(c.rows.map((r) => r.name)).toEqual(['west', 'east'])
    expect(c.group[cellAt(eg, -250, 100)]).toBe(0)
    expect(c.group[cellAt(eg, 250, 100)]).toBe(1)
    expect(c.unassignedHa).toBe(0)
    expect(c.rows[0].ha + c.rows[1].ha).toBeCloseTo(result.summary.stateHa.covered, 6)
    expect(c.rows[0].share + c.rows[1].share).toBeCloseTo(1, 9)
    // Symmetric ground: the two catchments match within a column of cells.
    expect(Math.abs(c.rows[0].ha - c.rows[1].ha)).toBeLessThanOrEqual(0.3 + 1e-9)
    for (const row of c.rows) {
      expect(row.meanM! > 0 && row.meanM! < row.farthestM!).toBe(true)
      expect(row.farthestM!).toBeLessThanOrEqual(350 + 1e-6)
    }
    const features = catchmentMapFeatures(result, c)
    expect(new Set(features.map((f) => f.properties?.color)).size).toBe(2)
    expect(features.every((f) => f.properties?.fill === true)).toBe(true)
  })

  it('runs with a chosen subset of landings for the existing-only comparison', () => {
    const eg = grid([point('west', -200, 0), point('east', 200, 0, 'proposed')])
    const before = runToCompletion(
      extractionOnGrid(
        eg,
        () => true,
        (l) => l.status === 'existing',
      ),
    )
    const after = runToCompletion(extractionOnGrid(eg))
    expect(before.state.states[cellAt(eg, 250, 100)]).toBe(X_BEYOND)
    expect(after.state.states[cellAt(eg, 250, 100)]).toBe(X_COVERED)
    const c = landingCatchments(before)
    expect(c.rows[1].cells).toBe(0)
    expect(c.rows[1].meanM).toBeNull()
  })

  it('resolves a skid trail to the landing (or road) it joins', () => {
    const trail = road(
      'trail',
      [
        [0, 0],
        [0, 280],
      ],
      'track',
    )
    const withRoad = runToCompletion(extractionOnGrid(grid([], [MAIN, trail])))
    const byRoad = landingCatchments(withRoad)
    expect(byRoad.rows.map((r) => r.name)).toEqual(['main'])
    const eg = grid([point('east', 200, 0), point('west', -50, 0)], [MAIN, trail])
    const result = runToCompletion(extractionOnGrid(eg))
    const c = landingCatchments(result)
    // Down the trail, then 50 m along the road to the west landing.
    const top = cellAt(eg, 10, 240)
    expect(result.state.states[top]).toBe(X_COVERED)
    expect(result.state.cells[0].trackM[top]).toBeGreaterThan(200)
    expect(c.group[top]).toBe(1)
  })

  it('keeps missing ground unknown and out of every catchment', () => {
    const eg = grid(both, [MAIN], (x) => (x > 240 ? NaN : 1000))
    const result = runToCompletion(extractionOnGrid(eg))
    const unknown = cellAt(eg, 270, 100)
    expect(result.state.states[unknown]).toBe(X_UNKNOWN)
    const c = landingCatchments(result)
    expect(c.group[unknown]).toBe(-1)
    expect(c.rows.reduce((sum, r) => sum + r.ha, 0) + c.unassignedHa).toBeCloseTo(c.coveredHa, 9)
  })
})

describe('cable landings', () => {
  it('starts lines from the landings only, a stretch every landing spacing, each with its yarder side', () => {
    const settings = { ...DEFAULT_EXTRACTION_SETTINGS, machine: 'cable' as const }
    const stretch: LandingInput = {
      ...point('stretch', 0, 0, 'proposed'),
      coordinates: [toLonLat([-100, 0]), toLonLat([100, 0])],
      yarder: 'below',
    }
    const eg = grid([point('p', -200, 0), stretch], [MAIN], () => 1000, settings)
    const ground = new Float64Array(eg.sg.grid.values)
    const landings = cableLandings(eg, ground, () => true, 50)
    expect(landings.filter((l) => l.group === 0)).toHaveLength(1)
    expect(landings.filter((l) => l.group === 1)).toHaveLength(5)
    expect(landings.find((l) => l.group === 1)!.designed).toBe(true)
    expect(landings.find((l) => l.group === 0)!.designed).toBe(false)
    expect(landings.find((l) => l.group === 1)!.position).toBe('below')
    // A line whose yarder stands above its tail is dropped from a "below" landing, kept from "either".
    const z = Float64Array.from({ length: 80 }, (_, k) => 1000 - k)
    const candidate = (landing: number): CableCandidate => ({
      landing,
      bearingDeg: 0,
      dx: 5,
      z,
      maxTailM: 300,
      stop: 'length',
      unknownReachM: null,
    })
    const rule = { ...DEFAULT_CABLE_RULE, position: 'either' as const }
    const below = landings.findIndex((l) => l.group === 1)
    const either = landings.findIndex((l) => l.group === 0)
    expect(cableCoverBatches(rule, 10, [candidate(below), candidate(either)], landings).index).toEqual([1])
    expect(cableCoverBatches(rule, 10, [candidate(below), candidate(either)]).index).toEqual([0, 1])
  })
})
