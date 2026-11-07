import { describe, expect, it } from 'vitest'
import {
  directionalGradeLimit,
  haulGradeText,
  parseRouteSearchOptions,
  suggestRoutes,
  type HaulGradeLimits,
} from './routing'
import type { Coordinate, RoadSettings, TerrainSource } from './types'

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
/** A plane rising 14% to the north. */
const steep: TerrainSource = {
  elevationAt: (lon, lat) => 700 + 0.14 * xy(lon, lat)[1],
}
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
const steepSettings = { ...settings, maxGradePercent: 15 }
const haul = (patch: Partial<HaulGradeLimits>): HaulGradeLimits => ({
  loadedDirection: 'start-to-end',
  maxLoadedUphillPercent: null,
  maxLoadedDownhillPercent: null,
  maxEmptyUphillPercent: null,
  ...patch,
})
/** Steepest signed start-to-end grade along the returned route, sampled every metre. */
function steepest(coordinates: Coordinate[]) {
  let up = -Infinity,
    down = -Infinity
  for (let i = 1; i < coordinates.length; i++) {
    const a = xy(...coordinates[i - 1]),
      b = xy(...coordinates[i]),
      run = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (run < 1e-6) continue
    const grade = (0.14 * (b[1] - a[1]) * 100) / run
    up = Math.max(up, grade)
    down = Math.max(down, -grade)
  }
  return { up, down }
}
const start = point(0, 0),
  end = point(0, 300)

describe('directional grade limits', () => {
  it('applies the loaded limit uphill and the stricter of loaded-downhill and empty-uphill the other way', () => {
    const limits = haul({ maxLoadedUphillPercent: 8, maxLoadedDownhillPercent: 16, maxEmptyUphillPercent: 14 })
    expect(directionalGradeLimit(5, 12, limits)).toBe(8)
    expect(directionalGradeLimit(-5, 18, limits)).toBe(14)
    expect(directionalGradeLimit(-5, 12, limits)).toBe(12)
    expect(directionalGradeLimit(5, 12, { ...limits, loadedDirection: 'end-to-start' })).toBe(12)
    expect(directionalGradeLimit(-5, 12, { ...limits, loadedDirection: 'end-to-start' })).toBe(8)
    expect(directionalGradeLimit(5, 12, null)).toBe(12)
  })

  it('validates limits and keeps older projects without them', () => {
    expect(parseRouteSearchOptions({}).haulGrades).toBeNull()
    expect(parseRouteSearchOptions({ haulGrades: haul({ maxEmptyUphillPercent: 18 }) }).haulGrades).toEqual(
      haul({ maxEmptyUphillPercent: 18 }),
    )
    expect(() => parseRouteSearchOptions({ haulGrades: haul({ maxLoadedUphillPercent: 0 }) })).toThrow(
      /directional grade limits/,
    )
    expect(() => parseRouteSearchOptions({ haulGrades: { ...haul({}), loadedDirection: 'uphill' } })).toThrow(
      /loaded trucks travel/,
    )
    expect(haulGradeText(haul({ maxLoadedUphillPercent: 8, maxEmptyUphillPercent: 18 }))).toBe(
      'Loaded travel start to end: loaded uphill ≤8%, empty uphill ≤18%.',
    )
  })

  // On a 14% plane the search's gentlest climbing move is a diagonal at about 9.9%, so a 9% limit in
  // the climbing direction leaves no route, and the same limit facing the other way changes nothing.
  it('blocks a climb that is too steep for loaded trucks going up', () => {
    const open = suggestRoutes(start, end, steep, steepSettings).routes[0]
    expect(steepest(open.coordinates).up).toBeGreaterThan(9)
    expect(() =>
      suggestRoutes(start, end, steep, steepSettings, [], { haulGrades: haul({ maxLoadedUphillPercent: 9 }) }),
    ).toThrow(/directional limits \(Loaded travel start to end: loaded uphill ≤9%\./)
  })

  it('allows the same climb when loaded trucks come down it', () => {
    const route = suggestRoutes(start, end, steep, steepSettings, [], {
      haulGrades: haul({ loadedDirection: 'end-to-start', maxLoadedUphillPercent: 9 }),
    })
    expect(steepest(route.routes[0].coordinates).up).toBeGreaterThan(9)
    expect(route.message).toContain('Loaded travel end to start: loaded uphill ≤9%.')
  })

  it('holds the empty truck to its own uphill limit on the way back in', () => {
    expect(() =>
      suggestRoutes(start, end, steep, steepSettings, [], {
        haulGrades: haul({ loadedDirection: 'end-to-start', maxEmptyUphillPercent: 9 }),
      }),
    ).toThrow(/empty uphill ≤9%/)
    const route = suggestRoutes(start, end, steep, steepSettings, [], {
      haulGrades: haul({ loadedDirection: 'end-to-start', maxEmptyUphillPercent: 10 }),
    }).routes[0]
    expect(steepest(route.coordinates).up).toBeLessThanOrEqual(10 + 1e-6)
  })
})
