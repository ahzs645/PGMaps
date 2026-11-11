import { describe, expect, it } from 'vitest'
import { horizontalFov, viewerConeFeatures } from './viewerCone'

describe('viewer cone', () => {
  it('opens a wedge centred on the bearing, out to its length', () => {
    const cone = viewerConeFeatures({ lng: -122.7, lat: 53.9, bearing: 90, fovDegrees: 60 }, 1000)
    const [wedge, eye] = cone.features
    expect(eye.geometry).toEqual({ type: 'Point', coordinates: [-122.7, 53.9] })
    const ring = (wedge.geometry as GeoJSON.Polygon).coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    // Facing east: every arc point lies east of the eye, and the middle one due east, about 1 km out.
    const arc = ring.slice(1, -1)
    expect(arc.every(([lng]) => lng > -122.7)).toBe(true)
    const middle = arc[(arc.length - 1) / 2]
    expect(middle[1]).toBeCloseTo(53.9, 6)
    const metres = (middle[0] + 122.7) * 111_195 * Math.cos((53.9 * Math.PI) / 180)
    expect(metres).toBeCloseTo(1000, 0)
  })
  it('draws nothing for a viewer that is not there', () => {
    expect(viewerConeFeatures(null, 1000).features).toHaveLength(0)
    expect(viewerConeFeatures({ lng: NaN, lat: 0, bearing: 0, fovDegrees: 60 }, 1000).features).toHaveLength(0)
  })
  it('widens the field of view with the frame', () => {
    expect(horizontalFov(36.87, 1)).toBeCloseTo(36.87, 2)
    expect(horizontalFov(36.87, 2)).toBeCloseTo(67.4, 1)
  })
})
