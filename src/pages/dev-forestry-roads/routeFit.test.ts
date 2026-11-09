import { describe, expect, it } from 'vitest'
import { corridorFrame } from './corridorOptimizer'
import { checkCentreline, roadFromRoute, routeRoadFlags } from './routeFit'
import type { ContextFeature, Coordinate, TerrainSource } from './types'

const ORIGIN: Coordinate = [-122.8, 53.9]
const frame = corridorFrame(ORIGIN)
const at = (x: number, y: number) => frame.fromXY([x, y])
/** Flat ground with a square hole of `size` metres centred on (x, y). */
const withHole = (x: number, y: number, size: number): TerrainSource => ({
  elevationAt: (lon, lat) => {
    const [px, py] = frame.toXY([lon, lat])
    return Math.abs(px - x) < size / 2 && Math.abs(py - y) < size / 2 ? NaN : 700
  },
})
/** A grid route with one right-angle corner at (200, 0). */
const route = [at(0, 0), at(100, 0), at(200, 0), at(200, 100), at(200, 200)]

describe('checkCentreline', () => {
  it('measures the length with no ground under it and names blocked areas in the way', () => {
    const straight = [
      { coordinate: at(0, 0), radiusM: 0 },
      { coordinate: at(200, 0), radiusM: 0 },
    ]
    const whole = checkCentreline(straight, withHole(500, 500, 10), [])
    expect(whole.lengthM).toBeCloseTo(200, 6)
    expect(whole).toMatchObject({ offTerrainM: 0, blocked: [] })
    const holed = checkCentreline(straight, withHole(100, 0, 10), [])
    expect(holed.offTerrainM).toBeGreaterThan(8)
    expect(holed.offTerrainM).toBeLessThan(12)
    const area: ContextFeature = {
      id: 'no-go',
      name: 'Old growth',
      kind: 'avoid',
      geometry: { type: 'Polygon', coordinates: [[at(90, -5), at(110, -5), at(110, 5), at(90, 5), at(90, -5)]] },
    }
    expect(checkCentreline(straight, withHole(500, 500, 10), [area]).blocked).toEqual([
      'Old growth: excluded area intersects the fitted route.',
    ])
  })
})

describe('roadFromRoute', () => {
  it('takes the tightest fit that rounds every corner', () => {
    const whole = withHole(500, 500, 10)
    // A 5 m curve through a right angle sits 2.1 m inside the corner: 2 m is too tight, 4 m is enough.
    const small = roadFromRoute(route, whole, [], 5)
    expect(small.maxDeviationM).toBe(4)
    expect(small.fit).toMatchObject({ sourcePoints: 5, fittedPoints: 3, curves: 1, sharpCorners: 0 })
    // A 25 m curve sits 10.4 m inside it, so only the 16 m fit has room, and it stays under twice the minimum.
    const road = roadFromRoute(route, whole, [], 25)
    expect(road.maxDeviationM).toBe(16)
    expect(road.points.map((point) => point.radiusM > 0)).toEqual([false, true, false])
    expect(road.fit!.smallestRadiusM).toBeGreaterThanOrEqual(25)
    expect(road.fit!.smallestRadiusM).toBeLessThanOrEqual(50)
  })

  it('fits curves from 5 m up, and counts none as tight, when no minimum radius is set', () => {
    const road = roadFromRoute(route, withHole(500, 500, 10), [], 0)
    expect(road.fit).toMatchObject({ fittedPoints: 3, curves: 1, sharpCorners: 0 })
    expect(road.points[1].radiusM).toBeGreaterThanOrEqual(5)
    expect(road.points[1].radiusM).toBeLessThanOrEqual(10)
    expect(road).toMatchObject({ tightCurves: 0, sharpCorners: 0 })
    expect(routeRoadFlags(road, 0)).toBe('')
  })

  it('takes the minimum radius rather than run a wider curve over a gap in the terrain', () => {
    // A hole where the 16 m fit's curve would pass. The minimum radius turns inside it.
    const terrain = withHole(188.7, 11.3, 3)
    const road = roadFromRoute(route, terrain, [], 25)
    expect(road.maxDeviationM).toBe(2)
    expect(road.fit).toMatchObject({ fittedPoints: 3, curves: 0 })
    expect(road.points.map((point) => point.radiusM)).toEqual([0, 25, 0])
    expect(road).toMatchObject({ tightCurves: 0, sharpCorners: 0 })
    expect(checkCentreline(road.points, terrain, []).offTerrainM).toBe(0)
  })

  it('gives corners with no room for the minimum radius the largest curve that fits, and counts them', () => {
    // Two 45° turns 28 m apart, against a 60 m minimum. The hole keeps the fit from straightening them out.
    const jog = [at(0, 0), at(200, 0), at(220, 20), at(420, 20)]
    const terrain = withHole(100, 4.8, 3)
    const road = roadFromRoute(jog, terrain, [], 60)
    const radii = road.points.map((point) => point.radiusM)
    expect(radii[1]).toBeGreaterThan(25)
    expect(radii[1]).toBeLessThan(60)
    expect(radii[2]).toBeCloseTo(radii[1], 0)
    expect(road).toMatchObject({ tightCurves: 2, sharpCorners: 0 })
    expect(routeRoadFlags(road, 60)).toBe('2 curves tighter than 60 m')
    expect(checkCentreline(road.points, terrain, []).offTerrainM).toBe(0)
  })

  it('leaves a corner sharp where any curve would leave the terrain', () => {
    // No ground anywhere inside the corner.
    const terrain: TerrainSource = {
      elevationAt: (lon, lat) => {
        const [x, y] = frame.toXY([lon, lat])
        return x < 199.5 && y > 0.5 ? NaN : 700
      },
    }
    const road = roadFromRoute(route, terrain, [], 25)
    expect(road.points.map((point) => point.radiusM)).toEqual([0, 0, 0])
    expect(road).toMatchObject({ tightCurves: 0, sharpCorners: 1 })
    expect(routeRoadFlags(road, 25)).toBe('1 sharp corner')
  })

  it('returns the route as found when every simpler line leaves the terrain', () => {
    // The route steps 1.5 m sideways round a hole. Any fit within 2 m straightens the step out, across it.
    const jog = [at(0, 0), at(100, 0), at(100, 1.5), at(110, 1.5), at(110, 0), at(200, 0)]
    const terrain = withHole(105, 0, 2)
    expect(
      checkCentreline(
        jog.map((coordinate) => ({ coordinate, radiusM: 0 })),
        terrain,
        [],
      ).offTerrainM,
    ).toBe(0)
    const road = roadFromRoute(jog, terrain, [], 25)
    expect(road).toMatchObject({ fit: null, maxDeviationM: null })
    expect(road.points.map((point) => point.coordinate)).toEqual(jog)
    // Its corners are 1.5 m and 10 m apart: no curve of 5 m or more fits them.
    expect(road.points.every((point) => point.radiusM === 0)).toBe(true)
    expect(road.sharpCorners).toBe(4)
  })
})
