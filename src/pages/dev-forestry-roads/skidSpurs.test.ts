import { describe, expect, it } from 'vitest'
import { runToCompletion } from './cooperative'
import { DEFAULT_SKID_RULE, skidReachSteps, type SkidRoad } from './skidReach'
import { linePrefix, suggestSpursSteps, sweptBackHeading, type SpurInput } from './skidSpurs'
import { DEFAULT_ROAD_SETTINGS } from './terrain'
import type { Coordinate } from './types'

const LON0 = -122.5,
  LAT0 = 54.2,
  M = 111_195,
  COS = Math.cos((LAT0 * Math.PI) / 180)
const toGrid = (c: Coordinate): [number, number] => [(c[0] - LON0) * M * COS, (c[1] - LAT0) * M]
const toLonLat = ([x, y]: [number, number]): Coordinate => [LON0 + x / (M * COS), LAT0 + y / M]
const flat = { elevationAt: () => 500 }
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
const road = (haulToward: SkidRoad['haulToward'] = null): SkidRoad => ({
  id: 'main',
  name: 'Main',
  kind: 'existing',
  coordinates: [toLonLat([-900, 5]), toLonLat([900, 5])],
  haulToward,
})
const input: Omit<SpurInput, 'options'> = {
  terrain: flat,
  ground: flat,
  settings: DEFAULT_ROAD_SETTINGS,
  context: [],
  routeOptions: {},
}
const suggest = (block: GeoJSON.Polygon, roads: SkidRoad[], options: SpurInput['options']) => {
  const base = runToCompletion(
    skidReachSteps({ block, roads, ground: flat, toGrid, toLonLat, rule: DEFAULT_SKID_RULE }),
  )
  return runToCompletion(suggestSpursSteps(base, { ...input, options }))
}

describe('sweptBackHeading', () => {
  it('leaves the parent half-way between square and back against the haul', () => {
    // Haul runs east; the block is north: leave to the north-west.
    expect(sweptBackHeading(90, [0, 0], [0, 100])).toBeCloseTo(315, 9)
    // Block south: leave to the south-west.
    expect(sweptBackHeading(90, [0, 0], [0, -100])).toBeCloseTo(225, 9)
  })
})

describe('linePrefix', () => {
  it('cuts a line at a length', () => {
    expect(
      linePrefix(
        [
          [0, 0],
          [10, 0],
          [10, 10],
        ],
        15,
      ),
    ).toEqual([
      [0, 0],
      [10, 0],
      [10, 5],
    ])
  })
})

describe('suggestSpursSteps', () => {
  it('adds spurs from the road until the block is covered, each cut back to what it needs', () => {
    const result = suggest(rect(-200, 10, 200, 810), [road()], { targetShare: 0.98, maxSpurs: 4 })
    expect(result.before.coveredOfSkiddable).toBeLessThan(0.5)
    expect(result.stopped).toBe('target-met')
    expect(result.after.coveredOfSkiddable).toBeGreaterThanOrEqual(0.98)
    expect(result.spurs.length).toBeGreaterThanOrEqual(1)
    const first = result.spurs[0]
    expect(toGrid(first.junction)[1]).toBeCloseTo(5, 3)
    expect(first.parentName).toBe('Main')
    expect(first.gainHa).toBeGreaterThan(5)
    // A spur up the middle needs to reach about 513 m to cover the far corners; it stops short of the far edge.
    expect(toGrid(first.landing)[1]).toBeLessThan(700)
    expect(first.lengthM).toBeLessThan(700)
    expect(first.crossings).toBe(0)
    expect(first.join).toBe('free')
    expect(first.loadedTurnDeg).toBeNull()
  })
  it('joins swept back toward the haul when the parent road says which way loaded trucks go', () => {
    const result = suggest(rect(-200, 10, 200, 810), [road('end')], { targetShare: 0.98, maxSpurs: 4 })
    const first = result.spurs[0]
    expect(first.join).toBe('swept-back')
    // Never swept forward: the loaded truck turns 90° or less onto the main road, toward the haul.
    expect(first.loadedTurnDeg).not.toBeNull()
    expect(first.loadedTurnDeg!).toBeLessThanOrEqual(90 + 1e-6)
    const [a, b] = [toGrid(first.coordinates[0]), toGrid(first.coordinates[1])]
    expect(b[0] - a[0]).toBeLessThanOrEqual(1e-6)
  })
  it('suggests nothing when the block is already within reach', () => {
    const result = suggest(rect(-200, 10, 200, 300), [road()], { targetShare: 0.98, maxSpurs: 4 })
    expect(result.stopped).toBe('already-met')
    expect(result.spurs).toEqual([])
  })
  it('stops at the spur budget', () => {
    const result = suggest(rect(-600, 10, 600, 810), [road()], { targetShare: 0.98, maxSpurs: 1 })
    expect(result.stopped).toBe('spur-budget')
    expect(result.spurs).toHaveLength(1)
    expect(result.after.coveredOfSkiddable).toBeGreaterThan(result.before.coveredOfSkiddable)
  })
  it('counts stream crossings on the spur it keeps', () => {
    const stream = {
      id: 'creek',
      name: 'Creek',
      kind: 'stream' as const,
      geometry: { type: 'LineString' as const, coordinates: [toLonLat([-900, 200]), toLonLat([900, 200])] },
      // Reviewed and priced, so the router may cross it; an unreviewed stream blocks every crossing.
      riparianPolicy: { treatment: 'additional-cost' as const, costPerM: 0 },
    }
    const base = runToCompletion(
      skidReachSteps({
        block: rect(-200, 10, 200, 810),
        roads: [road()],
        ground: flat,
        toGrid,
        toLonLat,
        rule: DEFAULT_SKID_RULE,
      }),
    )
    const result = runToCompletion(
      suggestSpursSteps(base, { ...input, context: [stream], options: { targetShare: 0.98, maxSpurs: 4 } }),
    )
    expect(result.spurs[0].crossings).toBe(1)
  })
})
