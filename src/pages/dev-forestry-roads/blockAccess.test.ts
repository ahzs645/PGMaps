import { describe, expect, it } from 'vitest'
import { blockLandings, steepestGrades, suggestBlockAccess } from './blockAccess'
import type { ContextFeature, Coordinate, RoadSettings, TerrainSource } from './types'

const RAD = Math.PI / 180,
  R = 6371008.8
const origin: Coordinate = [-122, 54]
const point = (x: number, y: number): Coordinate => [
  origin[0] + x / (R * RAD * Math.cos(origin[1] * RAD)),
  origin[1] + y / (R * RAD),
]
const xy = (coordinate: Coordinate) => [
  (coordinate[0] - origin[0]) * R * RAD * Math.cos(origin[1] * RAD),
  (coordinate[1] - origin[1]) * R * RAD,
]
const settings: RoadSettings = {
  stationInterval: 10,
  crossSectionHalfWidth: 30,
  maxGradePercent: 15,
  minRadius: 20,
  cutRate: 1,
  fillRate: 1,
  surfacingRate: 1,
  clearingRate: 1,
  shrinkFactor: 1,
}
const flat: TerrainSource = { elevationAt: () => 800 }
/** A 100 m square block with its south-west corner at the origin. */
const block: ContextFeature = {
  id: 'block',
  name: 'Block 12',
  kind: 'harvest',
  geometry: {
    type: 'Polygon',
    coordinates: [[point(0, 0), point(100, 0), point(100, 100), point(0, 100), point(0, 0)]],
  },
}
/** A north–south FSR section through x, 200 m long. */
const fsr = (id: string, x: number, condition: 'unknown' | 'closed' = 'unknown'): ContextFeature => ({
  id,
  name: `FSR ${id}`,
  kind: 'existing-road',
  geometry: { type: 'LineString', coordinates: [point(x, -50), point(x, 150)] },
  roadEvidence: { source: 'user', roadClass: 'fsr', condition, conditionBasis: 'unreviewed', reuseAllowed: false },
})

describe('block access to nearby FSRs', () => {
  it('lands on the block edge closest to each FSR section, nearest first', () => {
    const landings = blockLandings(block, [fsr('east', 400), fsr('west', -250), fsr('closed', 150, 'closed')])
    expect(landings.map((landing) => landing.target.featureId)).toEqual(['west', 'east'])
    expect(xy(landings[0].landing)[0]).toBeCloseTo(0, 3)
    expect(xy(landings[1].landing)[0]).toBeCloseTo(100, 3)
    expect(landings[0].target.distanceM).toBeCloseTo(250, 0)
    expect(landings[1].target.distanceM).toBeCloseTo(300, 0)
  })

  it('returns one ranked option per reachable FSR, starting at the landing and meeting the FSR exactly', () => {
    const result = suggestBlockAccess(block, flat, settings, [fsr('east', 400), fsr('west', -250)])
    expect(result.options.map((option) => option.target.featureId)).toEqual(['west', 'east'])
    for (const option of result.options) {
      expect(option.coordinates[0]).toEqual(option.landing)
      expect(option.coordinates.at(-1)).toEqual(option.target.coordinate)
      expect(option.steepestLoadedUphillPercent).toBe(0)
    }
    expect(result.message).toContain('2 access options from Block 12')
  })

  it('loads out toward the FSR: a climb out of the block is held to the loaded uphill limit', () => {
    // Ground rises 14% to the east, so the eastern FSR sits uphill of the block.
    const rising: TerrainSource = { elevationAt: (lon, lat) => 800 + 0.14 * xy([lon, lat])[0] }
    const roads = [fsr('east', 400)]
    const open = suggestBlockAccess(block, rising, settings, roads).options[0]
    expect(open.steepestLoadedUphillPercent).toBeGreaterThan(9)
    // The search's gentlest climbing move on this plane is about 9.9%, so 9% leaves no route.
    const limited = (direction: 'start-to-end' | 'end-to-start') =>
      suggestBlockAccess(block, rising, settings, roads, {
        haulGrades: {
          // Whatever the project says, block access hauls from the landing to the FSR.
          loadedDirection: direction,
          maxLoadedUphillPercent: 9,
          maxLoadedDownhillPercent: null,
          maxEmptyUphillPercent: null,
        },
      })
    expect(() => limited('end-to-start')).toThrow(/No access route from Block 12/)
    expect(() => limited('start-to-end')).toThrow(/loaded uphill ≤9%/)
  })

  it('reports why nothing was found rather than returning an unverified road', () => {
    expect(() => suggestBlockAccess(block, flat, settings, [])).toThrow(/No mapped FSR sections are loaded/)
    const line: ContextFeature = { ...block, geometry: { type: 'LineString', coordinates: [point(0, 0), point(1, 1)] } }
    expect(() => blockLandings(line, [fsr('east', 400)])).toThrow(/drawn or imported as an area/)
  })

  it('reads the steepest grade each way along a route', () => {
    const rising: TerrainSource = { elevationAt: (lon, lat) => 800 + 0.1 * xy([lon, lat])[1] }
    const grades = steepestGrades([point(0, 0), point(0, 50), point(0, 20)], rising)
    expect(grades.uphill).toBeCloseTo(10, 6)
    expect(grades.downhill).toBeCloseTo(10, 6)
  })
})
