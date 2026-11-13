import { describe, expect, it } from 'vitest'
import { crossDrainMarks, CROSS_DRAIN_BAND_PAD_M, CROSS_DRAIN_TICK_PAST_EDGE_M } from './crossDrainMarks'
import { distance, offsetCoordinate } from './engine'
import type { Coordinate, RoadStation } from './types'

const start: Coordinate = [-121.55, 54.08]
// A straight road running due east, a station every 10 m, 3 m each side of the centreline.
const stations = Array.from({ length: 21 }, (_, i) => ({
  chainage: i * 10,
  coordinate: offsetCoordinate(start, 90, i * 10),
  bearing: 90,
  leftWidth: 3,
  rightWidth: 3,
})) as unknown as RoadStation[]
const analysis = { stations, length: 200 }
const site = (properties: Record<string, unknown>): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: offsetCoordinate(start, 90, 100) },
  properties: { role: 'low-point', id: 'low-1', areaHa: 0.3, ...properties },
})
const lineLength = (coordinates: Coordinate[]) =>
  coordinates.slice(1).reduce((sum, c, i) => sum + distance(coordinates[i], c), 0)

describe('crossDrainMarks', () => {
  it('draws a site as a band over its stretch and a tick across the road at its largest outlet', () => {
    const marks = crossDrainMarks(
      { type: 'FeatureCollection', features: [site({ chainage: 100, fromChainage: 90, toChainage: 120 })] },
      analysis,
    )
    const band = marks.features.find((f) => f.properties?.role === 'cross-drain-band')!
    const tick = marks.features.find((f) => f.properties?.role === 'cross-drain-tick')!
    expect(marks.features.some((f) => f.properties?.role === 'low-point')).toBe(false)
    expect(lineLength((band.geometry as GeoJSON.LineString).coordinates as Coordinate[])).toBeCloseTo(
      30 + 2 * CROSS_DRAIN_BAND_PAD_M,
      0,
    )
    const [left, right] = (tick.geometry as GeoJSON.LineString).coordinates as Coordinate[]
    expect(distance(left, right)).toBeCloseTo(2 * (3 + CROSS_DRAIN_TICK_PAST_EDGE_M), 1)
    // Left is north of an eastbound road, and the tick is centred on the outlet's station.
    expect(left[1]).toBeGreaterThan(right[1])
    expect(
      distance([(left[0] + right[0]) / 2, (left[1] + right[1]) / 2], offsetCoordinate(start, 90, 100)),
    ).toBeLessThan(0.01)
    expect(band.properties).toMatchObject({ siteId: 'low-1', areaHa: 0.3 })
    expect(tick.properties?.legend).toBe(false)
  })

  it('keeps the band on the road at its ends and passes other features through', () => {
    const pond: GeoJSON.Feature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: start },
      properties: { role: 'pond' },
    }
    const marks = crossDrainMarks(
      { type: 'FeatureCollection', features: [site({ chainage: 0, fromChainage: 0, toChainage: 0 }), pond, site({})] },
      analysis,
    )
    const band = marks.features.find((f) => f.properties?.role === 'cross-drain-band')!
    expect(lineLength((band.geometry as GeoJSON.LineString).coordinates as Coordinate[])).toBeCloseTo(
      CROSS_DRAIN_BAND_PAD_M,
      0,
    )
    expect(marks.features).toContain(pond)
    // A site saved without its chainages is left as it was.
    expect(marks.features.filter((f) => f.properties?.role === 'low-point')).toHaveLength(1)
  })
})
