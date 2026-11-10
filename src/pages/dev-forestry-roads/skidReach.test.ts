import { describe, expect, it } from 'vitest'
import { runCooperatively, runToCompletion } from './cooperative'
import {
  allowedSkidReachM,
  BEYOND,
  COVERED,
  DEFAULT_SKID_RULE,
  emptyReachField,
  maskOutlines,
  prepareSkidGrid,
  propagateReach,
  skidReachMapFeatures,
  skidReachSteps,
  skidRoadsFromProject,
  sourceCells,
  STEEP,
  UNKNOWN,
  validateSkidRule,
  type SkidReachInput,
  type SkidReachResult,
} from './skidReach'
import type { SurfaceGrid } from './surfaceGrid'
import type { Coordinate } from './types'

// A local equirectangular frame, so grid metres are exact in the tests.
const LON0 = -122.5,
  LAT0 = 54.2,
  M = 111_195,
  COS = Math.cos((LAT0 * Math.PI) / 180)
const toGrid = (c: Coordinate): [number, number] => [(c[0] - LON0) * M * COS, (c[1] - LAT0) * M]
const toLonLat = ([x, y]: [number, number]): Coordinate => [LON0 + x / (M * COS), LAT0 + y / M]
const ground = (z: (x: number, y: number) => number) => ({
  elevationAt: (lon: number, lat: number) => z(...toGrid([lon, lat])),
})
const rect = (x0: number, y0: number, x1: number, y1: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0],
    ].map((p) => toLonLat(p as [number, number])),
  ],
})
const line = (...points: [number, number][]) => points.map(toLonLat)
/** Block 400 m wide and 600 m deep north of a road along y = 5 (a row of cell centres). */
const southRoad = { id: 'road', name: 'Road', kind: 'existing' as const, coordinates: line([-400, 5], [400, 5]) }
const run = (z: (x: number, y: number) => number, extra: Partial<SkidReachInput> = {}): SkidReachResult =>
  runToCompletion(
    skidReachSteps({
      block: rect(-200, 10, 200, 610),
      roads: [southRoad],
      ground: ground(z),
      toGrid,
      toLonLat,
      rule: DEFAULT_SKID_RULE,
      ...extra,
    }),
  )
/** Status of the block cells at height `y` (cell centre), keyed by x. */
const statusAt = (result: SkidReachResult, y: number) => {
  const { grid } = result.skidGrid
  const row = Math.round((grid.origin[1] - y) / grid.cellM)
  const out = new Set<number>()
  for (let col = 0; col < grid.width; col++) {
    const i = row * grid.width + col
    if (result.skidGrid.block[i]) out.add(result.status[i])
  }
  return [...out]
}

describe('allowedSkidReachM', () => {
  it('falls linearly from the level reach to the uphill reach and holds there', () => {
    expect(allowedSkidReachM(0, DEFAULT_SKID_RULE)).toBe(350)
    expect(allowedSkidReachM(-25, DEFAULT_SKID_RULE)).toBe(350)
    expect(allowedSkidReachM(15, DEFAULT_SKID_RULE)).toBe(275)
    expect(allowedSkidReachM(30, DEFAULT_SKID_RULE)).toBe(200)
    expect(allowedSkidReachM(45, DEFAULT_SKID_RULE)).toBe(200)
  })
  it('refuses an uphill reach longer than the level one', () => {
    expect(() => validateSkidRule({ ...DEFAULT_SKID_RULE, adverseReachM: 400 })).toThrow(/uphill reach/)
  })
})

describe('skid reach along the ground', () => {
  it('covers 350 m on level ground', () => {
    const result = run(() => 500)
    expect(statusAt(result, 355)).toEqual([COVERED])
    expect(statusAt(result, 365)).toEqual([BEYOND])
    expect(result.summary.farthest?.covered).toBe(false)
    expect(result.summary.coveredShare).toBeCloseTo(35 / 60, 2)
  })
  it('shortens the reach when logs are dragged uphill to the road', () => {
    // Ground falls 15 % away from the road: allowed 275 m along the ground, 271.9 m level.
    const result = run((_, y) => 500 - 0.15 * y)
    expect(statusAt(result, 275)).toEqual([COVERED])
    expect(statusAt(result, 285)).toEqual([BEYOND])
  })
  it('keeps the level reach for a downhill skid, measured along the slope', () => {
    // 350 m along a 15 % slope is 346.1 m level.
    const result = run((_, y) => 500 + 0.15 * y)
    expect(statusAt(result, 345)).toEqual([COVERED])
    expect(statusAt(result, 355)).toEqual([BEYOND])
  })
  it('reports ground over the slope limit as too steep, and the ground behind it as beyond reach', () => {
    const result = run((_, y) => (y < 200 ? 0 : y < 300 ? 0.5 * (y - 200) : 50))
    expect(statusAt(result, 255)).toEqual([STEEP])
    expect(statusAt(result, 405)).toEqual([BEYOND])
    expect(result.summary.steepHa).toBeGreaterThan(0)
    const s = result.summary
    expect(s.coveredOfSkiddable).toBeCloseTo(s.coveredHa / (s.blockHa - s.steepHa - s.unknownHa), 9)
  })
  it('never counts ground behind missing terrain as covered', () => {
    const result = run((_, y) => (y >= 100 && y <= 120 ? NaN : 500))
    expect(statusAt(result, 55)).toEqual([COVERED])
    expect(statusAt(result, 115)).toEqual([UNKNOWN])
    // Reachable only across the gap: unknown, not beyond.
    expect(statusAt(result, 205)).toEqual([UNKNOWN])
    // Out of reach even across level ground: beyond.
    expect(statusAt(result, 405)).toEqual([BEYOND])
    expect(result.summary.unknownHa).toBeGreaterThan(0)
  })
  it('does not skid across a barrier line, even diagonally', () => {
    const across = run(() => 500, { barriers: [line([-400, 200], [400, 200])] })
    expect(statusAt(across, 185)).toEqual([COVERED])
    expect(statusAt(across, 225)).toEqual([BEYOND])
    // y = x + 400, from corner to corner of the grid.
    const diagonal = run(() => 500, { barriers: [line([-800, -400], [800, 1200])] })
    const { grid, block } = diagonal.skidGrid
    let farSide = 0
    for (let i = 0; i < block.length; i++) {
      if (!block[i]) continue
      const row = Math.floor(i / grid.width)
      const x = grid.origin[0] + (i - row * grid.width) * grid.cellM,
        y = grid.origin[1] - row * grid.cellM
      if (y > x + 400 + 2 * grid.cellM) {
        farSide++
        expect(diagonal.status[i]).not.toBe(COVERED)
      }
    }
    expect(farSide).toBeGreaterThan(0)
  })
  it('gives the same field when a road is added later as when both were there from the start', () => {
    const north = { id: 'north', name: 'North', kind: 'design' as const, coordinates: line([-400, 615], [400, 615]) }
    const both = run((x, y) => 500 + 0.1 * y - 0.05 * x, { roads: [southRoad, north] })
    const first = run((x, y) => 500 + 0.1 * y - 0.05 * x)
    const sg = both.skidGrid
    const field = emptyReachField(sg.block.length)
    const southOnly = { ...sg, sourceRoad: first.skidGrid.sourceRoad }
    runToCompletion(propagateReach(southOnly, field, sourceCells(southOnly), false))
    const northCells = sourceCells(sg).filter((i) => first.skidGrid.sourceRoad[i] < 0)
    runToCompletion(propagateReach(sg, field, northCells, false))
    for (let i = 0; i < field.reach.length; i++)
      if (Number.isFinite(both.strict.reach[i])) expect(field.reach[i]).toBeCloseTo(both.strict.reach[i], 9)
      else expect(field.reach[i]).toBe(Infinity)
  })
  it('stops when cancelled', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      runCooperatively(
        skidReachSteps({
          block: rect(-200, 10, 200, 610),
          roads: [southRoad],
          ground: ground(() => 500),
          toGrid,
          toLonLat,
          rule: DEFAULT_SKID_RULE,
        }),
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('draws beyond-reach ground as outlines', () => {
    const features = skidReachMapFeatures(run(() => 500))
    expect(features.length).toBeGreaterThan(0)
    expect(features.every((f) => f.geometry.type === 'LineString' && f.properties?.role === 'beyond')).toBe(true)
  })
})

describe('maskOutlines', () => {
  const grid: SurfaceGrid = { origin: [0, 0], cellM: 1, width: 5, height: 5, values: new Float64Array(25) }
  const of = (cells: number[]) => maskOutlines(grid, (i) => cells.includes(i))
  it('outlines a square as one closed ring of four corners', () => {
    const rings = of([6, 7, 11, 12])
    expect(rings).toHaveLength(1)
    expect(rings[0]).toHaveLength(5)
    expect(rings[0][0]).toEqual(rings[0][4])
  })
  it('keeps the six corners of an L', () => {
    expect(of([6, 11, 12])[0]).toHaveLength(7)
  })
  it('returns a hole as its own ring', () => {
    expect(of([6, 7, 8, 11, 13, 16, 17, 18])).toHaveLength(2)
  })
})

describe('prepareSkidGrid', () => {
  it('grows the cell to stay within the cell budget', () => {
    const sg = runToCompletion(
      prepareSkidGrid({
        block: rect(0, 0, 6000, 6000),
        roads: [],
        ground: ground(() => 1),
        toGrid,
        toLonLat,
        rule: DEFAULT_SKID_RULE,
      }),
    )
    expect(sg.grid.cellM).toBeGreaterThan(10)
    expect(sg.grid.width * sg.grid.height).toBeLessThanOrEqual(250_000)
  })
})

describe('skidRoadsFromProject', () => {
  const lineFeature = (id: string, evidence?: object) => ({
    id,
    name: id,
    kind: 'existing-road' as const,
    geometry: { type: 'LineString' as const, coordinates: [toLonLat([0, 0]), toLonLat([100, 0])] },
    ...(evidence ? { roadEvidence: evidence as never } : {}),
  })
  const alignment = (id: string, extra = {}) => ({
    id,
    name: id,
    color: '#000',
    points: [
      { id: `${id}-a`, coordinate: toLonLat([0, 50]), radiusM: 0 },
      { id: `${id}-b`, coordinate: toLonLat([100, 50]), radiusM: 0 },
    ],
    vertical: [],
    template: {} as never,
    overrides: [],
    ...extra,
  })
  const project = {
    designPlaceholderId: 'placeholder',
    context: [
      lineFeature('open'),
      lineFeature('closed', { condition: 'closed' }),
      lineFeature('retired', { condition: 'unknown', lifecycleStatus: 'RETIRED' }),
    ],
    alignments: [
      alignment('placeholder'),
      alignment('design'),
      alignment('connector', { fsrConnection: { endpoint: 'start' } }),
    ],
  }
  it('counts active mapped roads and designed roads, never closed or retired ones or the placeholder', () => {
    const roads = skidRoadsFromProject(project as never, new Map(), { mapped: true, designed: true })
    expect(roads.map((r) => r.id)).toEqual(['open', 'design', 'connector'])
    // A connector's last point is its FSR junction, so loaded trucks leave by its end.
    expect(roads.find((r) => r.id === 'connector')?.haulToward).toBe('end')
  })
  it('leaves out what the run is told not to count', () => {
    expect(
      skidRoadsFromProject(project as never, new Map(), { mapped: false, designed: true }).map((r) => r.id),
    ).toEqual(['design', 'connector'])
    expect(
      skidRoadsFromProject(project as never, new Map(), { mapped: true, designed: false }).map((r) => r.id),
    ).toEqual(['open'])
  })
})
