import { describe, expect, it } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { fitHorizontalRadii, straightPointIds } from './horizontalTools'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate, RoadPoint } from './types'

const origin: Coordinate = [-122.8, 53.9]
// North 200 m, then east 200 m (90°), then north 60 m (90°).
const corner = offsetCoordinate(origin, 0, 200)
const east = offsetCoordinate(corner, 90, 200)
const end = offsetCoordinate(east, 0, 60)
const points: RoadPoint[] = [origin, corner, east, end].map((coordinate, i) => ({
  id: `p${i}`,
  coordinate,
  radiusM: 0,
}))
const road = (p: RoadPoint[]): Alignment => ({
  id: 'r',
  name: 'Road',
  color: '#16817a',
  points: p,
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [],
})

describe('bulk horizontal curves', () => {
  it('applies a default radius to every corner and shrinks those the tangents cannot hold', () => {
    const { points: fitted, report } = fitHorizontalRadii(points, { kind: 'radius', radiusM: 35 })
    expect(fitted[1].radiusM).toBe(35)
    // The last corner has a 60 m leg after it: its 90° trim cannot reach 60 m.
    expect(report).toHaveLength(2)
    const big = fitHorizontalRadii(points, { kind: 'radius', radiusM: 150 })
    expect(big.report[1].limitedBy).toBe('tangents')
    expect(big.points[2].radiusM).toBeLessThanOrEqual(60 * 0.98)
    const warnings = analyzeRoad(road(big.points), { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS).warnings
    expect(warnings.some((w) => w.includes('does not fit') || w.includes('overlaps'))).toBe(false)
  })

  it('gives the radius asked for where the tangents hold it, at any deflection', () => {
    // 300 m legs: none is short of room. The fit used to come back 0.1 m under on about a quarter of
    // these, so a curve set to the minimum radius was flagged as below it.
    const middle = offsetCoordinate(origin, 90, 300)
    for (const radius of [15, 20, 25, 30, 35, 40, 50, 60])
      for (let deflection = 10; deflection <= 150; deflection += 5) {
        const line: RoadPoint[] = [origin, middle, offsetCoordinate(middle, 90 - deflection, 300)].map(
          (coordinate, i) => ({ id: `q${i}`, coordinate, radiusM: 0 }),
        )
        const { points: fitted, report } = fitHorizontalRadii(
          line,
          { kind: 'radius', radiusM: radius },
          { minRadiusM: radius },
        )
        expect(fitted[1].radiusM, `${radius} m at ${deflection}°`).toBe(radius)
        expect(report[0]).toMatchObject({ limitedBy: 'requested', belowMinimum: false })
      }
  })

  it('fits the largest radius within a tolerance of the pegged corner', () => {
    // A 90° corner with E = 2 m: R = 2 / (sec 45° − 1) ≈ 4.83 m.
    const { points: fitted, report } = fitHorizontalRadii(
      points,
      { kind: 'tolerance', toleranceM: 2 },
      { minRadiusM: 25 },
    )
    expect(fitted[1].radiusM).toBeCloseTo(4.8, 1)
    expect(report[0].belowMinimum).toBe(true)
    const loose = fitHorizontalRadii(points, { kind: 'tolerance', toleranceM: 20 })
    expect(loose.points[1].radiusM).toBeCloseTo(48.2, 0)
  })

  it('keeps radii the user already set when asked to fill only sharp corners', () => {
    const set = points.map((p, i) => (i === 1 ? { ...p, radiusM: 80 } : p))
    const { points: fitted } = fitHorizontalRadii(set, { kind: 'radius', radiusM: 35 }, { onlySharp: true })
    expect(fitted[1].radiusM).toBe(80)
    expect(fitted[2].radiusM).toBeGreaterThan(0)
  })
})

describe('straightPointIds', () => {
  const point = (id: string, lng: number, lat: number) => ({
    id,
    coordinate: [lng, lat] as [number, number],
    radiusM: 0,
  })

  it('finds middle points on a straight run and keeps the ends and real turns', () => {
    const points = [
      point('a', 0, 0),
      point('b', 0, 0.001),
      point('c', 0, 0.002),
      point('d', 0.001, 0.003),
      point('e', 0.002, 0.004),
    ]
    expect(straightPointIds(points)).toEqual(['b', 'd'])
  })

  it('does not let a slow curve of small turns disappear', () => {
    const points = Array.from({ length: 40 }, (_, i) => {
      const angle = (i * Math.PI) / 80
      return point(`p${i}`, Math.sin(angle) * 0.01, Math.cos(angle) * 0.01)
    })
    const kept = points.length - straightPointIds(points).length
    expect(kept).toBeGreaterThan(5)
  })
})
