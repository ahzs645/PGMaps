import { describe, expect, it } from 'vitest'

import { ridgeLayerLandform } from './ridgeLayers'
import type { ElevationSource } from './terrain'
import { metersPerDegree, pointInPolygon, type PolygonGeometry } from './visibility'

const ORIGIN = { lng: -122.7, lat: 54.5 }
const SCALE = metersPerDegree(ORIGIN.lat)
const at = (eastMeters: number, northMeters = 0) => ({
  lng: ORIGIN.lng + eastMeters / SCALE.lng,
  lat: ORIGIN.lat + northMeters / SCALE.lat,
})
const east = (lng: number) => (lng - ORIGIN.lng) * SCALE.lng

/** A valley viewer, a low ridge 2.5 km east, and a high range 7 km east, both running north–south. */
const RIDGES: ElevationSource = {
  elevationAt: (lng) => {
    const x = east(lng)
    return 120 * Math.exp(-(((x - 2500) / 400) ** 2) / 2) + 500 * Math.exp(-(((x - 7000) / 1000) ** 2) / 2)
  },
}

const rect = (x0: number, x1: number, y0: number, y1: number): PolygonGeometry => {
  const a = at(x0, y0),
    b = at(x1, y1)
  return {
    type: 'Polygon',
    coordinates: [
      [
        [a.lng, a.lat],
        [b.lng, a.lat],
        [b.lng, b.lat],
        [a.lng, b.lat],
        [a.lng, a.lat],
      ],
    ],
  }
}

const inside = (geometry: GeoJSON.Polygon, x: number, y = 0) => {
  const p = at(x, y)
  return pointInPolygon(geometry, p.lng, p.lat)
}

describe('ridgeLayerLandform', () => {
  it('takes the far range’s face, stopped in front by the nearer ridge and behind by the skyline', () => {
    const block = rect(6300, 6700, -300, 300)
    const landform = ridgeLayerLandform(RIDGES, block, [at(0)])!
    expect(landform).not.toBeNull()
    expect(landform.method).toBe('ridge-layer')
    expect(inside(landform.geometry, 6500)).toBe(true)
    // Not the near ridge, and not the hidden ground between.
    expect(inside(landform.geometry, 2200)).toBe(false)
    expect(inside(landform.geometry, 4500)).toBe(false)
    // Not the far side of the crest.
    expect(inside(landform.geometry, 8200)).toBe(false)
    expect(landform.boundedBy['nearer-ridge']).toBeGreaterThan(0.1)
    expect(landform.boundedBy.skyline).toBeGreaterThan(0.1)
    // The range runs on north and south past the search area.
    expect(landform.reachedLimit).toBe(true)
    expect(landform.stationsSeeing).toBe(1)
  })

  it('lists the bands nearest first and marks the block’s', () => {
    const landform = ridgeLayerLandform(RIDGES, rect(6300, 6700, -300, 300), [at(0)])!
    const near = landform.layers[0]
    expect(inside(near.geometry, 2200)).toBe(true)
    expect(near.containsBlock).toBe(false)
    const own = landform.layers.find((layer) => layer.containsBlock)!
    expect(own.meanDistanceMeters).toBeGreaterThan(near.meanDistanceMeters)
  })

  it('keeps a block on the near ridge to the near ridge', () => {
    const landform = ridgeLayerLandform(RIDGES, rect(2000, 2300, -300, 300), [at(0)])!
    expect(inside(landform.geometry, 2150)).toBe(true)
    expect(inside(landform.geometry, 6500)).toBe(false)
  })

  it('finds nothing for a block the road cannot see', () => {
    // Behind the near ridge, below the far range's visible band.
    expect(ridgeLayerLandform(RIDGES, rect(4300, 4600, -200, 200), [at(0)])).toBeNull()
  })

  it('unions the layer along a drive and counts the stations that see the block', () => {
    const block = rect(6300, 6700, -300, 300)
    const stations = [at(0, -3000), at(0, 0), at(0, 3000)]
    const landform = ridgeLayerLandform(RIDGES, block, stations)!
    expect(landform.stationCount).toBe(3)
    expect(landform.stationsSeeing).toBe(3)
    expect(inside(landform.geometry, 6500, 3000)).toBe(true)
  })

  it('stops at the valley floor rather than running down to the road', () => {
    // A plain at 0 m from the road to a slope that rises from 3 km out.
    const plain: ElevationSource = { elevationAt: (lng) => Math.max(0, east(lng) - 3000) * 0.3 }
    const landform = ridgeLayerLandform(plain, rect(3800, 4200, -300, 300), [at(0)])!
    expect(inside(landform.geometry, 4000)).toBe(true)
    expect(inside(landform.geometry, 1500)).toBe(false)
    expect(landform.boundedBy.flat).toBeGreaterThan(0.1)
    expect(landform.layers.some((layer) => layer.containsBlock)).toBe(true)
  })

  it('reads a viewer standing inside the search area', () => {
    // Station 1 km west of the block, between the two ridges, on the valley floor.
    const landform = ridgeLayerLandform(RIDGES, rect(6300, 6700, -300, 300), [at(5000)])!
    expect(inside(landform.geometry, 6500)).toBe(true)
    expect(inside(landform.geometry, 2200)).toBe(false)
  })
})
