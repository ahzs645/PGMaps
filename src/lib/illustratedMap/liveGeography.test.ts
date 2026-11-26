import { describe, expect, it } from 'vitest'
import data from './geography.generated.json'
import { artboardToLngLat, liveHatchAreas, liveLandGeoJson, nestRings, svgPathRings } from './liveGeography'

describe('live geography', () => {
  it('puts the artboard back on the ground', () => {
    // Each land/water checkpoint was projected from a longitude and latitude; undoing the fit and
    // BC Albers lands within about a hundred metres of it (the artboard is rounded to 0.001 px).
    for (const checkpoint of data.checkpoints) {
      const [lng, lat] = artboardToLngLat(checkpoint.point as [number, number])
      expect(Math.abs(lng - checkpoint.coordinate[0])).toBeLessThan(0.002)
      expect(Math.abs(lat - checkpoint.coordinate[1])).toBeLessThan(0.002)
    }
  })

  it('reads absolute paths with curves', () => {
    const [ring] = svgPathRings('M0 0 H10 V5 C10 8 8 10 5 10 L0 10 Z')
    expect(ring[0]).toEqual([0, 0])
    expect(ring[1]).toEqual([10, 0])
    expect(ring[2]).toEqual([10, 5])
    expect(ring.at(-2)).toEqual([5, 10])
    expect(ring.at(-1)).toEqual([0, 10])
  })

  it('keeps the coverage choices apart and the same object for the same choice', () => {
    expect(liveHatchAreas('province').coverage).toBeUndefined()
    expect(liveHatchAreas('coastal').coverage).toHaveLength(1)
    expect(liveHatchAreas('northern').coverage).toHaveLength(2)
    expect(liveHatchAreas('coastal')).toBe(liveHatchAreas('coastal'))
    expect(liveHatchAreas('province').land.length).toBe(data.bcLand.polygons + data.bcLand.holes)
  })

  it('fills the lakes on the live map when lakes are off', () => {
    expect(liveHatchAreas('province', false).land.length).toBeLessThan(data.bcLand.polygons)
    expect(liveHatchAreas('coastal', false)).toBe(liveHatchAreas('coastal', false))
    expect(liveHatchAreas('coastal', false)).not.toBe(liveHatchAreas('coastal'))
    const holes = (collection: GeoJSON.FeatureCollection) =>
      collection.features.reduce(
        (sum, feature) => sum + (feature.geometry as GeoJSON.Polygon).coordinates.length - 1,
        0,
      )
    expect(holes(liveLandGeoJson('bcLand'))).toBe(data.bcLand.holes)
    expect(holes(liveLandGeoJson('bcLand', false))).toBe(0)
  })

  it('leaves out small islands and lakes on the live map as the drawing does', () => {
    const filter = { minIslandKm2: 1, minLakeKm2: 2 }
    expect(liveHatchAreas('province', filter).land.length).toBeLessThan(liveHatchAreas('province').land.length / 3)
    expect(liveHatchAreas('province', filter)).toBe(liveHatchAreas('province', { ...filter }))
    expect(liveLandGeoJson('land', filter).features.length).toBeLessThan(liveLandGeoJson('land').features.length)
  })
})

describe('nested rings', () => {
  it('turns even-odd rings into polygons with holes', () => {
    const square = (x: number, y: number, s: number) =>
      [
        [x, y],
        [x + s, y],
        [x + s, y + s],
        [x, y + s],
      ] as [number, number][]
    // An island in a lake in an island; holes wound the other way, as the build writes them.
    const polygons = nestRings([square(0, 0, 10), square(2, 2, 6).reverse(), square(4, 4, 2), square(20, 0, 3)])
    expect(polygons.map((polygon) => polygon.length).sort()).toEqual([1, 1, 2])
    const bc = liveLandGeoJson('bcLand')
    expect(bc.features.length).toBe(data.bcLand.polygons)
  })
})
