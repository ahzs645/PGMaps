import { describe, expect, it } from 'vitest'

import {
  flightTracks,
  PHOTO_CONE_FALLBACK_METERS,
  PHOTO_CONE_MAX_METERS,
  PHOTO_CONE_MIN_METERS,
  photoCameraCollections,
  photoConeLength,
  photoPairCollection,
  type PlanPhotoCamera,
} from './photoCamerasGeometry'

// A made-up place: no real photo position.
const camera = (id: string, minutes: number | null, extra: Partial<PlanPhotoCamera> = {}): PlanPhotoCamera => ({
  id,
  lng: -120 + minutes! / 1000,
  lat: 50,
  bearing: 90,
  hfov: 60,
  farMeters: 5000,
  takenAtUtc: minutes === null ? null : new Date(Date.UTC(2026, 10, 1, 18, minutes)).toISOString(),
  ...extra,
})

const metresBetween = ([lng1, lat1]: number[], [lng2, lat2]: number[]) =>
  Math.hypot((lng2 - lng1) * 111_320 * Math.cos((lat1 * Math.PI) / 180), (lat2 - lat1) * 110_574)

describe('photo cameras on the plan', () => {
  it('reaches each cone to its frame’s far hit, within bounds', () => {
    expect(photoConeLength(5000)).toBe(5000)
    expect(photoConeLength(50)).toBe(PHOTO_CONE_MIN_METERS)
    expect(photoConeLength(90_000)).toBe(PHOTO_CONE_MAX_METERS)
    expect(photoConeLength(null)).toBe(PHOTO_CONE_FALLBACK_METERS)
    const { cones } = photoCameraCollections([camera('a', 0, { farMeters: 8000 })], null)
    const ring = (cones.features[0].geometry as GeoJSON.Polygon).coordinates[0]
    const reach = Math.max(...ring.map((point) => metresBetween(ring[0], point)))
    expect(reach).toBeGreaterThan(7900)
    expect(reach).toBeLessThan(8100)
    // Facing east: the wedge's far points lie east of the camera.
    expect(ring.slice(1, -1).every((point) => point[0] > ring[0][0])).toBe(true)
  })

  it('joins each flight in time order and leaves untimed cameras off the track', () => {
    const cameras = [
      camera('c', 30),
      camera('a', 0),
      camera('x', null),
      camera('b', 12),
      camera('d', 5, { flightId: 'second' }),
      camera('e', 2, { flightId: 'second' }),
      camera('lonely', 1, { flightId: 'third' }),
    ]
    expect(flightTracks(cameras)).toEqual([
      ['a', 'b', 'c'],
      ['e', 'd'],
    ])
    const { tracks, eyes } = photoCameraCollections(cameras, 'b')
    expect(tracks.features).toHaveLength(2)
    expect((tracks.features[0].geometry as GeoJSON.LineString).coordinates).toHaveLength(3)
    // Every camera gets a point, the untimed one included; the active one is drawn last.
    expect(eyes.features).toHaveLength(7)
    expect(eyes.features.at(-1)?.properties).toMatchObject({ id: 'b', active: 1 })
  })

  it('skips a camera with no usable pose rather than drawing it at 0, 0', () => {
    const { cones, eyes } = photoCameraCollections([camera('a', 0, { bearing: Number.NaN })], null)
    expect(cones.features).toHaveLength(0)
    expect(eyes.features).toHaveLength(0)
  })

  it('draws paired points, their residuals and the reference point', () => {
    const marks = photoPairCollection(
      [
        { id: 'p1', lng: -120, lat: 50, solved: { lng: -120.001, lat: 50 } },
        { id: 'p2', lng: -120.01, lat: 50.01, off: true },
      ],
      { lng: -120.02, lat: 50 },
    )
    expect(marks.features.map((feature) => feature.properties?.kind)).toEqual(['residual', 'pair', 'pair', 'reference'])
    expect(marks.features[2].properties?.off).toBe(1)
  })
})
