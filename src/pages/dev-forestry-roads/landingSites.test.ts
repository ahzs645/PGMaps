import { describe, expect, it } from 'vitest'
import { runToCompletion } from './cooperative'
import { DEFAULT_LANDING_OPTIONS, landingMapFeatures, screenLandingSites } from './landingSites'
import { DEFAULT_SKID_RULE, prepareSkidGrid } from './skidReach'
import type { ContextFeature, Coordinate } from './types'

const LON0 = -122.5,
  LAT0 = 54.2,
  M = 111_195,
  COS = Math.cos((LAT0 * Math.PI) / 180)
const toGrid = (c: Coordinate): [number, number] => [(c[0] - LON0) * M * COS, (c[1] - LAT0) * M]
const toLonLat = ([x, y]: [number, number]): Coordinate => [LON0 + x / (M * COS), LAT0 + y / M]
const block: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    (
      [
        [-200, 10],
        [200, 10],
        [200, 610],
        [-200, 610],
        [-200, 10],
      ] as [number, number][]
    ).map(toLonLat),
  ],
}
/** A 20 % slope up to y = 250, then a level bench; the road climbs to an end on the bench. */
const z = (_x: number, y: number) => (y < 250 ? 0.2 * y : 50)
const road = {
  id: 'spur',
  name: 'Spur',
  kind: 'design' as const,
  coordinates: [toLonLat([0, -100]), toLonLat([0, 305])],
}
const grid = (ground = { elevationAt: (lon: number, lat: number) => z(...toGrid([lon, lat])) }) =>
  runToCompletion(prepareSkidGrid({ block, roads: [road], ground, toGrid, toLonLat, rule: DEFAULT_SKID_RULE }))

describe('screenLandingSites', () => {
  it('finds flat footprints on the bench, the road end first, and none on the slope', () => {
    const sg = grid()
    const screen = screenLandingSites(sg, sg.roads, [])
    expect(screen.candidates.length).toBeGreaterThan(0)
    const first = screen.candidates[0]
    expect(first.placement).toBe('road-end')
    expect(first.meanSlopePercent).toBeLessThanOrEqual(DEFAULT_LANDING_OPTIONS.maxMeanSlopePercent)
    expect(first.footprint).toHaveLength(5)
    expect(first.footprint[0]).toEqual(first.footprint[4])
    expect(first.insideBlock).toBe(true)
    for (const candidate of screen.candidates) {
      expect(candidate.meanSlopePercent).toBeLessThanOrEqual(8)
      expect(toGrid(candidate.centre)[1]).toBeGreaterThan(240)
    }
    // Spaced apart.
    for (const a of screen.candidates)
      for (const b of screen.candidates)
        if (a !== b) {
          const [p, q] = [toGrid(a.centre), toGrid(b.centre)]
          expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeGreaterThanOrEqual(100 - 1e-6)
        }
    expect(landingMapFeatures(screen)).toHaveLength(screen.candidates.length)
  })
  it('drops footprints a stream runs through', () => {
    const sg = grid()
    const stream: ContextFeature = {
      id: 'creek',
      name: 'Creek',
      kind: 'stream',
      geometry: { type: 'LineString', coordinates: [toLonLat([-400, 300]), toLonLat([400, 300])] },
    }
    const screen = screenLandingSites(sg, sg.roads, [stream])
    expect(screen.conflicts).toBeGreaterThan(0)
    for (const candidate of screen.candidates) {
      const ys = candidate.footprint.map((c) => toGrid(c)[1])
      expect(Math.min(...ys) > 300 || Math.max(...ys) < 300).toBe(true)
    }
  })
  it('passes over footprints on missing ground rather than calling them flat', () => {
    const sg = grid({
      elevationAt: (lon: number, lat: number) => {
        const [x, y] = toGrid([lon, lat])
        return y > 280 ? NaN : z(x, y)
      },
    })
    const screen = screenLandingSites(sg, sg.roads, [])
    expect(screen.unknownGround).toBeGreaterThan(0)
    expect(screen.candidates.every((c) => c.placement !== 'road-end')).toBe(true)
  })
  it('refuses an out-of-range footprint', () => {
    const sg = grid()
    expect(() => screenLandingSites(sg, sg.roads, [], { ...DEFAULT_LANDING_OPTIONS, widthM: 0 })).toThrow(/footprint/)
  })
})
