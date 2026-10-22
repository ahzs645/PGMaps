import { describe, expect, it } from 'vitest'
import { suggestRoute, suggestRoutes } from './routing'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

const R = 6371008.8,
  RAD = Math.PI / 180,
  origin: Coordinate = [-122, 54]
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (R * RAD * Math.cos(origin[1] * RAD)),
  origin[1] + y / (R * RAD),
]
const xy = (longitude: number, latitude: number) => [
  (longitude - origin[0]) * R * RAD * Math.cos(origin[1] * RAD),
  (latitude - origin[1]) * R * RAD,
]
const terrain = (at: (x: number, y: number) => number): TerrainSource => ({
  elevationAt: (lon, lat) => {
    const [x, y] = xy(lon, lat)
    return at(x, y)
  },
})
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 12,
  minRadius: 20,
  cutRate: 1,
  fillRate: 1,
  surfacingRate: 1,
  clearingRate: 1,
  shrinkFactor: 1,
}
const box = (x0: number, y0: number, x1: number, y1: number): ContextFeature => ({
  id: 'avoid',
  name: 'Excluded',
  kind: 'avoid',
  geometry: {
    type: 'Polygon',
    coordinates: [[point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1), point(x0, y0)]],
  },
})

function sampleReturned(coordinates: Coordinate[], at: TerrainSource) {
  const samples: Array<{ x: number; y: number; elevation: number }> = []
  for (let i = 1; i < coordinates.length; i++) {
    const a = xy(...coordinates[i - 1]),
      b = xy(...coordinates[i]),
      count = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])))
    for (let j = 0; j <= count; j++) {
      const x = a[0] + ((b[0] - a[0]) * j) / count,
        y = a[1] + ((b[1] - a[1]) * j) / count
      samples.push({ x, y, elevation: at.elevationAt(...point(x, y)) })
    }
  }
  return samples
}

describe('bounded terrain-cost route suggestion', () => {
  it('is deterministic, retains exact endpoints and returns a bounded, explicitly preliminary result', () => {
    const flat = terrain(() => 700),
      start = point(0, 0),
      end = point(200, 0)
    const a = suggestRoute(start, end, flat, settings, []),
      b = suggestRoute(start, end, flat, settings, [])
    expect(a).toEqual(b)
    expect(a.coordinates[0]).toEqual(start)
    expect(a.coordinates[a.coordinates.length - 1]).toEqual(end)
    expect(a.visited).toBeLessThanOrEqual(40_000)
    expect(a.message).toContain('Terrain-cost route suggestion')
    expect(a.message).toContain('≤1 m')
  })

  it('routes around a no-data patch without bridging it in returned segments', () => {
    const source = terrain((x, y) => (x > 70 && x < 130 && Math.abs(y) < 35 ? NaN : 700))
    const route = suggestRoute(point(0, 0), point(200, 0), source, settings, [])
    const samples = sampleReturned(route.coordinates, source)
    expect(samples.every((sample) => Number.isFinite(sample.elevation))).toBe(true)
    expect(samples.some((sample) => Math.abs(sample.y) >= 35)).toBe(true)
  })

  it('does not cut diagonally across an exclusion polygon', () => {
    const source = terrain(() => 700),
      route = suggestRoute(point(0, 0), point(200, 0), source, settings, [box(60, -35, 140, 35)])
    const samples = sampleReturned(route.coordinates, source)
    expect(samples.some((p) => p.x >= 60 && p.x <= 140 && p.y >= -35 && p.y <= 35)).toBe(false)
    expect(() => suggestRoute(point(100, 0), point(200, 0), source, settings, [box(60, -35, 140, 35)])).toThrow(
      /endpoint.*exclusion/i,
    )
  })

  it('accepts a gentle grade, but rejects an unavoidable steep terrain step', () => {
    const gentle = terrain((x) => 700 + 0.05 * x)
    expect(suggestRoute(point(0, 0), point(200, 0), gentle, settings).coordinates.length).toBeGreaterThan(1)
    const cliff = terrain((x) => (x < 100 ? 700 : 750))
    expect(() => suggestRoute(point(0, 0), point(200, 0), cliff, settings)).toThrow(
      /No terrain-cost path|finer terrain check/,
    )
  })

  it('rejects missing endpoint coverage and a continuous missing-data barrier', () => {
    expect(() =>
      suggestRoute(
        point(0, 0),
        point(200, 0),
        terrain(() => NaN),
        settings,
      ),
    ).toThrow(/valid terrain coverage/)
    const barrier = terrain((x) => (x > 90 && x < 110 ? NaN : 700))
    expect(() => suggestRoute(point(0, 0), point(200, 0), barrier, settings)).toThrow(/No terrain-cost path/)
  })

  it('validates the grade setting and bounded route extent', () => {
    const flat = terrain(() => 700)
    expect(() => suggestRoute(point(0, 0), point(200, 0), flat, { ...settings, maxGradePercent: 0 })).toThrow(/grade/)
    expect(() => suggestRoute(point(0, 0), point(16000, 0), flat, settings)).toThrow(/15 km/)
    expect(() => suggestRoute(point(0, 0), point(1, 0), flat, settings)).toThrow(/2 m apart/)
  })
})

describe('route search costs, headings and alternatives', () => {
  const flat = terrain(() => 800)
  const start = point(0, 0),
    end = point(400, 0)
  it('returns distinct alternatives ranked by cost', () => {
    const result = suggestRoutes(start, end, flat, settings, [], { alternatives: 4 })
    expect(result.routes.length).toBeGreaterThan(1)
    const costs = result.routes.map((r) => r.cost)
    expect([...costs].sort((a, b) => a - b)).toEqual(costs)
    expect(result.routes[0].lengthM).toBeCloseTo(400, -1)
    expect(result.message).toContain('ranked alternatives')
  })

  it('prices stream crossings in dollars and detours when a crossing costs more than the way round', () => {
    const stream: ContextFeature = {
      id: 's',
      name: 'Creek',
      kind: 'stream',
      geometry: { type: 'LineString', coordinates: [point(200, -60), point(200, 60)] },
    }
    const cheap = suggestRoutes(start, end, flat, settings, [stream], { crossingCost: 1 }).routes[0]
    expect(cheap.crossings).toBe(1)
    const dear = suggestRoutes(start, end, flat, settings, [stream], { crossingCost: 1e7 }).routes[0]
    expect(dear.crossings).toBe(0)
    expect(dear.lengthM).toBeGreaterThan(cheap.lengthM)
  })

  it('crosses a cost zone at its price instead of being blocked', () => {
    const zone = { ...box(150, -300, 250, 300), routeCostPerM: 50 }
    const through = suggestRoutes(start, end, flat, settings, [zone]).routes[0]
    // 100 m inside at $50/m extra on a $100/m base.
    expect(through.cost).toBeCloseTo(400 * 100 + 100 * 50, -3)
    expect(() => suggestRoute(start, end, flat, settings, [box(150, -900, 250, 900)])).toThrow()
  })

  it('leaves the start and reaches the end within 45° of fixed headings', () => {
    const route = suggestRoutes(start, end, flat, settings, [], { startHeading: 0, endHeading: 180 }).routes[0]
    const [x1, y1] = xy(...route.coordinates[1])
    expect(Math.abs((Math.atan2(x1, y1) * 180) / Math.PI)).toBeLessThanOrEqual(45 + 1e-6)
    const [xa, ya] = xy(...route.coordinates.at(-2)!),
      [xb, yb] = xy(...route.coordinates.at(-1)!)
    const arrive = ((Math.atan2(xb - xa, yb - ya) * 180) / Math.PI + 360) % 360
    expect(Math.abs(arrive - 180)).toBeLessThanOrEqual(45 + 1e-6)
  })
})
