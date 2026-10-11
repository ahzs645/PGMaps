import { describe, expect, it } from 'vitest'
import { computeViewshedRow, createViewshedResult, viewshedLayout, type ViewshedInput } from './analysis'
import { metersPerDegree } from '../dev-forestry/visibility'
import type { ElevationSource } from '../dev-forestry/terrain'

const input: ViewshedInput = {
  observer: { lng: -122.75, lat: 53.92 }, radiusMeters: 1000,
  observerHeightMeters: 1.6, targetHeightMeters: 2, demZoom: 13, localTerrain: null,
}
function compute(source: ElevationSource, settings = input) {
  const result = createViewshedResult(source, settings, 20)
  for (let row = 0; row < result.layout.size; row++) computeViewshedRow(source, settings, result, row)
  return result
}
describe('terrain viewshed', () => {
  it('sees every sampled point on flat ground with elevated endpoints and leaves the exterior transparent', () => {
    const result = compute({ elevationAt: () => 500 })
    expect(result.visible).toBeGreaterThan(7000)
    expect(result.occluded).toBe(0)
    expect(result.unknown).toBe(0)
    expect(result.pixels[3]).toBe(0)
    expect(result.visible).toBeLessThan(result.layout.size ** 2)
  })
  it('a ridge hides ground behind it; raising the observer clears more ground', () => {
    const scale = metersPerDegree(input.observer.lat)
    const ridge: ElevationSource = { elevationAt(lng) {
      const east = (lng - input.observer.lng) * scale.lng
      return east > 150 && east < 230 ? 530 : 500
    } }
    const low = compute(ridge)
    const high = compute(ridge, { ...input, observerHeightMeters: 120 })
    expect(low.occluded).toBeGreaterThan(1000)
    expect(high.occluded).toBeLessThan(low.occluded)
    expect(high.visible).toBeGreaterThan(low.visible)
  })
  it('keeps missing terrain unknown rather than treating it as sea level', () => {
    const result = compute({ elevationAt: (lng) => lng < input.observer.lng - 0.002 ? NaN : 500 })
    expect(result.unknown).toBeGreaterThan(1000)
    expect(result.visible).toBeGreaterThan(1000)
    expect(result.occluded).toBe(0)
    expect(() => compute({ elevationAt: () => NaN })).toThrow('No terrain at the observer')
  })
  it('propagates missing interior terrain to a sightline with known endpoints', () => {
    const scale = metersPerDegree(input.observer.lat)
    const result = compute({ elevationAt(lng) {
      const east = (lng - input.observer.lng) * scale.lng
      return east > 150 && east < 230 ? NaN : 500
    } })
    expect(result.unknown).toBeGreaterThan(1000)
    expect(result.occluded).toBe(0)
  })
  it('bounds output and rejects invalid or excessive requests', () => {
    expect(viewshedLayout({ ...input, radiusMeters: 10000 }, 1).size).toBe(128)
    for (const radiusMeters of [0, NaN, Infinity, 10001]) {
      expect(() => viewshedLayout({ ...input, radiusMeters }, 20)).toThrow()
    }
    expect(() => viewshedLayout({ ...input, observer: { lng: 0, lat: 0 } }, 20)).toThrow()
    expect(() => viewshedLayout({ ...input, observerHeightMeters: -1 }, 20)).toThrow()
  })
})
