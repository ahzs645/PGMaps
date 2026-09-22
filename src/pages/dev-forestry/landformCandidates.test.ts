import { describe, expect, it } from 'vitest'
import { distanceFromRoadToPolygon, nearestLandformsAlongRoad, distanceToPolygon, nearestLandformCandidates } from './landformCandidates'
import { parseSensitivityUnits } from './bcVisualInventory'

const box = (x: number): GeoJSON.Polygon => ({ type: 'Polygon', coordinates: [[[x,53],[x+.1,53],[x+.1,53.1],[x,53.1],[x,53]]] })
describe('nearest inventory boundaries', () => {
  it('ranks containing and unrated units ahead of a distant rated unit', () => {
    const units = parseSensitivityUnits({ features: [
      { geometry: box(-123), properties: { OBJECTID: 1, VLI_POLYGON_NO: 1 } },
      { geometry: box(-122.7), properties: { OBJECTID: 2, VLI_POLYGON_NO: 2, REC_EVQO_CODE: 'R' } },
      { geometry: box(-120), properties: { OBJECTID: 3, VLI_POLYGON_NO: 3 } },
    ] })
    const result = nearestLandformCandidates(units, { lng: -122.95, lat: 53.05 })
    expect(result.map(c => c.unit.id)).toEqual(['1','2'])
    expect(result[0].distanceMeters).toBe(0)
    expect(result[1].distanceMeters).toBeGreaterThan(15000)
  })
  it('finds a landform crossed between distant road vertices, not just near the start', () => {
    const geometry = box(-123)
    expect(distanceFromRoadToPolygon([[-124,53.05],[-122,53.05]], geometry)).toBe(0)
    const units = parseSensitivityUnits({ features: [{ geometry, properties: { OBJECTID: 1, VLI_POLYGON_NO: 1 } }] })
    expect(nearestLandformCandidates(units, { lng: -124, lat: 53.05 })).toEqual([])
    expect(nearestLandformsAlongRoad(units, [[-124,53.05],[-122,53.05]])[0].distanceMeters).toBe(0)
    expect(distanceFromRoadToPolygon([[-124,52],[-124,52.1]], geometry, 25000)).toBe(Infinity)
  })
  it('handles a road inside a polygon hole, a contained road and degenerate segments', () => {
    const geometry = box(-123)
    geometry.coordinates.push([[-122.98,53.02],[-122.92,53.02],[-122.92,53.08],[-122.98,53.08],[-122.98,53.02]])
    expect(distanceFromRoadToPolygon([[-122.96,53.05],[-122.94,53.05]], geometry)).toBeGreaterThan(1200)
    expect(distanceFromRoadToPolygon([[-122.99,53.05],[-122.99,53.05]], geometry)).toBe(0)
    expect(distanceFromRoadToPolygon([], geometry)).toBe(Infinity)
  })
  it('respects holes and measures edges, not bounding boxes', () => {
    const geometry = box(-123)
    geometry.coordinates.push([[-122.98,53.02],[-122.92,53.02],[-122.92,53.08],[-122.98,53.08],[-122.98,53.02]])
    expect(distanceToPolygon({ lng: -122.95, lat: 53.05 }, geometry)).toBeGreaterThan(1900)
    expect(distanceToPolygon({ lng: -122.995, lat: 53.05 }, geometry)).toBe(0)
    expect(distanceToPolygon({ lng: -122.9, lat: 53.05 }, geometry)).toBeCloseTo(0)
  })
})
