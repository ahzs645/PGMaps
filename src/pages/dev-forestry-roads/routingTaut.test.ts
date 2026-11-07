import { describe, expect, it } from 'vitest'
import { suggestRoutes } from './routing'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

const R = 6371008.8,
  RAD = Math.PI / 180,
  origin: Coordinate = [-122, 54]
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (R * RAD * Math.cos(origin[1] * RAD)),
  origin[1] + y / (R * RAD),
]
const xy = ([longitude, latitude]: Coordinate) => [
  (longitude - origin[0]) * R * RAD * Math.cos(origin[1] * RAD),
  (latitude - origin[1]) * R * RAD,
]
const flat: TerrainSource = { elevationAt: () => 700 }
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
/** Largest change of direction at any interior vertex, degrees. */
const sharpestTurn = (coordinates: Coordinate[]) => {
  let sharpest = 0
  for (let i = 1; i < coordinates.length - 1; i++) {
    const [a, b, c] = [xy(coordinates[i - 1]), xy(coordinates[i]), xy(coordinates[i + 1])]
    const turn = Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])
    sharpest = Math.max(sharpest, Math.abs(((turn / RAD + 540) % 360) - 180))
  }
  return sharpest
}

describe('generated routes are pulled taut', () => {
  it('replaces a grid staircase on open ground with one straight leg', () => {
    const route = suggestRoutes(point(0, 0), point(400, 130), flat, settings).routes[0]
    expect(route.coordinates).toHaveLength(2)
    expect(route.lengthM).toBeCloseTo(Math.hypot(400, 130), 0)
  })

  it('keeps a few straight legs around an exclusion, none of them inside it', () => {
    const block: ContextFeature = {
      id: 'avoid',
      name: 'Excluded',
      kind: 'avoid',
      geometry: {
        type: 'Polygon',
        coordinates: [[point(150, -60), point(250, -60), point(250, 60), point(150, 60), point(150, -60)]],
      },
    }
    const route = suggestRoutes(point(0, 0), point(400, 0), flat, settings, [block]).routes[0]
    expect(route.coordinates.length).toBeLessThanOrEqual(6)
    expect(sharpestTurn(route.coordinates)).toBeLessThan(90)
    for (let i = 1; i < route.coordinates.length; i++) {
      const [a, b] = [xy(route.coordinates[i - 1]), xy(route.coordinates[i])]
      for (let f = 0; f <= 1; f += 0.01) {
        const [x, y] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
        expect(x > 150 && x < 250 && y > -60 && y < 60).toBe(false)
      }
    }
  })
})
