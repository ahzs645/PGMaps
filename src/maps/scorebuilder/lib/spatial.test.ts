import { describe, expect, it } from 'vitest'
import { PointGrid, boundsAround, catchmentAccess, distanceKm, gridCatchmentAccess, regionsBounds } from './spatial'

/** Deterministic points around Prince George, so a failure reproduces. */
function scatteredPoints(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index,
    lng: -122.75 + Math.sin(index * 12.9898) * 0.6,
    lat: 53.92 + Math.sin(index * 78.233) * 0.3,
  }))
}

describe('PointGrid', () => {
  const points = scatteredPoints(2000)
  const grid = new PointGrid(points, (point) => [point.lng, point.lat])

  it.each([
    [[-122.8, 53.9, -122.7, 53.95]],
    [[-122.76, 53.91, -122.75, 53.92]],
    [[-123.5, 53.0, -122.0, 54.5]],
    // Larger than the grid's cell count, which takes the walk-the-cells path.
    [[-139, 48, -114, 60]],
  ] as Array<[[number, number, number, number]]>)('finds every point a full scan finds in %j', (bounds) => {
    const [west, south, east, north] = bounds
    const expected = points.filter((p) => p.lng >= west && p.lng <= east && p.lat >= south && p.lat <= north)
    const found = new Set(grid.near(bounds).map((point) => point.id))
    expect(expected.filter((point) => !found.has(point.id))).toEqual([])
  })

  it('returns far fewer candidates than the dataset for a small region', () => {
    expect(grid.near([-122.76, 53.91, -122.75, 53.92]).length).toBeLessThan(points.length / 20)
  })

  it('finds nothing in an empty grid', () => {
    expect(new PointGrid<{ lng: number; lat: number }>([], (p) => [p.lng, p.lat]).near([-123, 53, -122, 54])).toEqual(
      [],
    )
  })
})

describe('boundsAround', () => {
  it('contains every point within the radius, north of 50°', () => {
    const origin: [number, number] = [-122.75, 53.92]
    const [west, south, east, north] = boundsAround(origin, 1.6)
    for (const point of scatteredPoints(4000)) {
      if (distanceKm(origin, [point.lng, point.lat]) > 1.6) continue
      expect(point.lng).toBeGreaterThanOrEqual(west)
      expect(point.lng).toBeLessThanOrEqual(east)
      expect(point.lat).toBeGreaterThanOrEqual(south)
      expect(point.lat).toBeLessThanOrEqual(north)
    }
  })
})

describe('gridCatchmentAccess', () => {
  it('matches the full scan exactly', () => {
    const points = scatteredPoints(1500)
    const grid = new PointGrid(points, (point) => [point.lng, point.lat])
    for (const origin of scatteredPoints(200).map((point): [number, number] => [
      point.lat - 176.7,
      point.lng + 176.6,
    ])) {
      for (const maxKm of [0.8, 1.2, 1.6]) {
        expect(gridCatchmentAccess(origin, grid, maxKm)).toBe(catchmentAccess(origin, points, maxKm))
      }
    }
  })
})

describe('regionsBounds', () => {
  it('unions region bounds and returns null for none', () => {
    expect(regionsBounds([{ bounds: [-123, 53, -122, 54] }, { bounds: [-124, 53.5, -122.5, 55] }])).toEqual([
      -124, 53, -122, 55,
    ])
    expect(regionsBounds([])).toBeNull()
  })
})
