import { describe, expect, it } from 'vitest'
import area from '@turf/area'
import { mergeRiparianZones } from './riparianDisplay'

/** A square of `half` degrees around (x, y). */
const square = (x: number, y: number, half: number): GeoJSON.Polygon => ({
  type: 'Polygon',
  coordinates: [
    [
      [x - half, y - half],
      [x + half, y - half],
      [x + half, y + half],
      [x - half, y + half],
      [x - half, y - half],
    ],
  ],
})
const zone = (band: string, geometry: GeoJSON.Polygon, riparianClass = 'S4'): GeoJSON.Feature => ({
  type: 'Feature',
  geometry,
  properties: { riparianBand: band, riparianClass, streamId: Math.random().toString(36) },
})
const featureArea = (features: GeoJSON.Feature[]) =>
  features.reduce((sum, f) => sum + area(f as GeoJSON.Feature<GeoJSON.Polygon>), 0)

describe('mergeRiparianZones', () => {
  it('dissolves overlapping reach buffers into one zone with one outline', () => {
    // Three reaches of one creek whose buffers overlap at the joints.
    const reaches = [
      zone('management', square(0, 0, 0.001)),
      zone('management', square(0.0015, 0, 0.001)),
      zone('management', square(0.003, 0, 0.001)),
    ]
    const { features, merged } = mergeRiparianZones(reaches)
    expect(merged).toBe(true)
    expect(features).toHaveLength(1)
    expect(features[0].properties).toMatchObject({ riparianBand: 'management', reaches: 3, riparianMerged: true })
    // The union covers less than the sum of the overlapping pieces, and no point twice.
    expect(featureArea(features)).toBeLessThan(featureArea(reaches))
    expect(featureArea(features)).toBeCloseTo(area(square(0.0015, 0, 0.001)) * 2.5, -2)
  })

  it('draws the management band only outside the reserve, so no ground is hatched twice', () => {
    const outer = zone('management', square(0, 0, 0.002))
    const reserve = zone('reserve', square(0, 0, 0.001))
    const { features } = mergeRiparianZones([outer, reserve])
    const bands = features.map((f) => f.properties?.riparianBand)
    expect(bands).toEqual(['reserve', 'management'])
    const ring = features.find((f) => f.properties?.riparianBand === 'management')!
    expect(ring.geometry.coordinates).toHaveLength(2) // outer edge and the reserve as a hole
    expect(featureArea(features)).toBeCloseTo(area(square(0, 0, 0.002)), -2)
  })

  it('keeps the unresolved screen outside classified zones', () => {
    const classified = zone('management', square(0, 0, 0.001))
    const unresolved = zone('uncertain', square(0.001, 0, 0.001), 'unknown')
    const { features } = mergeRiparianZones([classified, unresolved])
    const total = featureArea(features)
    const union = area(square(0.0005, 0, 0.001)) * 1.5
    expect(total).toBeCloseTo(union, -2)
    expect(features.filter((f) => f.properties?.riparianBand === 'uncertain')).toHaveLength(1)
  })

  it('merges two bands into one when the caller maps them together', () => {
    const { features } = mergeRiparianZones(
      [zone('management', square(0, 0, 0.001)), zone('uncertain', square(0.0015, 0, 0.001))],
      (f) => (f.properties?.riparianBand === 'reserve' ? 'reserve' : 'management'),
    )
    expect(features).toHaveLength(1)
    expect(features[0].properties?.reaches).toBe(2)
  })

  it('returns separate polygons for separate creeks', () => {
    const { features } = mergeRiparianZones([
      zone('management', square(0, 0, 0.001)),
      zone('management', square(0.01, 0, 0.001)),
    ])
    expect(features).toHaveLength(2)
    expect(features.every((f) => f.geometry.type === 'Polygon')).toBe(true)
  })
})
