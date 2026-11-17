import { describe, expect, it } from 'vitest'
import { appleTilt, gpsTimeUtc } from './exifPose'
import type { PhotoPose } from './photoPose'
import { projectDirection, type ProfilePoint } from './skylineFit'
import { horizonSlice, horizonTable, searchOrientation, sunCheck, sunPosition } from './wideOrientation'

// An invented horizon: a few ridges of different heights and widths, so one heading fits best.
const ridge = (azimuth: number) =>
  1.2 * Math.exp(-(((azimuth - 40) / 18) ** 2)) +
  2.6 * Math.exp(-(((azimuth - 170) / 9) ** 2)) +
  0.8 * Math.exp(-(((azimuth - 230) / 25) ** 2)) +
  0.3 * Math.sin((azimuth * Math.PI) / 30)
const profile: ProfilePoint[] = Array.from({ length: 3600 }, (_, i) => ({
  azimuth: i / 10,
  elevation: ridge(i / 10),
  distanceMeters: 20000,
}))

const camera = (bearing: number, pitch: number, roll: number): PhotoPose => ({
  lng: -122.5,
  lat: 53.7,
  altitudeMeters: 1200,
  bearing,
  pitch,
  roll,
  width: 1050,
  height: 788,
  focalPx: 1000,
  k1: 0,
  k2: 0,
})

/** The skyline a camera would photograph: the horizon projected, read column by column. */
function skylineOf(pose: PhotoPose, columns = 200) {
  const points = profile
    .map((point) => projectDirection(pose, point.azimuth, point.elevation))
    .filter((point): point is { x: number; y: number } => !!point && point.x > -50 && point.x < pose.width + 50)
    .sort((a, b) => a.x - b.x)
  return Array.from({ length: columns }, (_, i) => {
    const x = ((i + 0.5) / columns) * pose.width
    const hi = points.findIndex((point) => point.x >= x)
    if (hi <= 0) return null
    const a = points[hi - 1],
      b = points[hi]
    return { x, y: a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x) }
  })
}

describe('camera search over every heading', () => {
  it('recovers heading, pitch and roll from a skyline, starting from a heading 130° out', () => {
    const truth = camera(165, -2, 3)
    const skyline = skylineOf(truth)
    const found = searchOrientation({
      pose: camera(295, 0, 0),
      profile,
      skyline,
      pitchRange: [-8, 4],
      rollRange: [-6, 6],
    })!
    expect(found).not.toBeNull()
    expect(Math.abs(((found.bearing - 165 + 540) % 360) - 180)).toBeLessThan(0.6)
    expect(found.pitch).toBeCloseTo(-2, 0)
    expect(Math.abs(found.roll - 3)).toBeLessThanOrEqual(0.5)
    expect(found.fit.agreement).toBeGreaterThan(0.9)
    expect(
      found.runnerUp && Math.abs(((found.runnerUp.bearing - found.bearing + 540) % 360) - 180),
    ).toBeGreaterThanOrEqual(15)
  }, 60_000)

  it('reports progress, stops when cancelled and refuses a photo with almost no skyline', () => {
    const steps: number[] = []
    const skyline = skylineOf(camera(40, 0, 0))
    searchOrientation({
      pose: camera(0, 0, 0),
      profile,
      skyline,
      pitchRange: [0, 0],
      rollRange: [0, 1],
      onProgress: (d) => steps.push(d),
    })
    expect(steps).toEqual([0.5, 1])
    expect(searchOrientation({ pose: camera(0, 0, 0), profile, skyline, cancelled: () => true })).toBeNull()
    expect(searchOrientation({ pose: camera(0, 0, 0), profile, skyline: skyline.slice(0, 11) })).toBeNull()
  }, 60_000)

  it('keeps each angle near its prior, so a landmark or flight track decides between candidates', () => {
    const skyline = skylineOf(camera(165, -2, 3))
    const near = searchOrientation({
      pose: camera(0, 0, 0),
      profile,
      skyline,
      priors: {
        heading: { value: 160, tolerance: 20 },
        pitch: { value: -2, tolerance: 3 },
        roll: { value: 3, tolerance: 2 },
      },
    })!
    expect(Math.abs(near.bearing - 165)).toBeLessThan(0.6)
    const elsewhere = searchOrientation({
      pose: camera(0, 0, 0),
      profile,
      skyline,
      priors: {
        heading: { value: 40, tolerance: 10 },
        pitch: { value: -2, tolerance: 3 },
        roll: { value: 3, tolerance: 2 },
      },
    })!
    // Held to 30–50° (plus fitSkyline's ±3° nudge), the search cannot reach the true 165°.
    expect(elsewhere.bearing).toBeGreaterThan(26)
    expect(elsewhere.bearing).toBeLessThan(54)
    expect(elsewhere.meanLoss).toBeGreaterThan(near.meanLoss * 3)
  }, 60_000)

  it('keeps the horizon by azimuth, and slices it continuously across north', () => {
    const table = horizonTable([
      { azimuth: 359.96, elevation: 2, distanceMeters: 1 },
      { azimuth: 90, elevation: 1, distanceMeters: 1 },
    ])
    expect(table[0]).toBe(2)
    expect(table[900]).toBe(1)
    expect(Number.isNaN(table[1])).toBe(true)
    const slice = horizonSlice(profile, 5, 10)
    expect(Math.min(...slice.map((p) => p.azimuth))).toBeCloseTo(-5, 5)
    expect(Math.max(...slice.map((p) => p.azimuth))).toBeCloseTo(15, 5)
  })
})

describe('evidence beside the skyline', () => {
  it('places the sun as NOAA does: low in the south-east on a mid-October morning in the Interior', () => {
    const sun = sunPosition(-122.5, 53.7, new Date('2026-10-16T16:20:31Z'))
    expect(sun.azimuth).toBeGreaterThan(120)
    expect(sun.azimuth).toBeLessThan(135)
    expect(sun.elevation).toBeGreaterThan(8)
    expect(sun.elevation).toBeLessThan(18)
    const check = sunCheck(camera(170, 0, 0), new Date('2026-10-16T16:20:31Z'))
    expect(check.relativeBearing).toBeLessThan(-35)
    expect(check.inFrame).toBe(false)
    expect(sunCheck(camera(sun.azimuth, sun.elevation, 0), new Date('2026-10-16T16:20:31Z')).inFrame).toBe(true)
  })

  it('reads pitch from an Apple maker note, and the GPS fix time as UTC', () => {
    // "Apple iOS\0" header, version, "MM", one IFD entry: tag 8, type 10 (signed rational), 3 values at offset 28.
    const note = new Uint8Array(28 + 24)
    note.set([...'Apple iOS'].map((c) => c.charCodeAt(0)))
    note.set([0x4d, 0x4d], 12)
    const view = new DataView(note.buffer)
    view.setUint16(14, 1)
    view.setUint16(16, 8)
    view.setUint16(18, 10)
    view.setUint32(20, 3)
    view.setUint32(24, 28)
    const vector = [0, -0.996, -0.0872] // gravity mostly along −Y, a little into the face: pitched 5° down
    vector.forEach((v, k) => {
      view.setInt32(28 + k * 8, Math.round(v * 10000))
      view.setInt32(28 + k * 8 + 4, 10000)
    })
    const tilt = appleTilt(note)!
    expect(tilt.pitch).toBeCloseTo(-5, 0)
    expect(tilt.g).toBeCloseTo(1, 2)
    expect(appleTilt(new Uint8Array(4))).toBeNull()
    expect(appleTilt('not bytes')).toBeNull()
    expect(gpsTimeUtc('2026:10:16', [16, 20, 30.99])).toBe('2026-10-16T16:20:30.990Z')
    expect(gpsTimeUtc('2026:10:16', '16:20:30')).toBe('2026-10-16T16:20:30.000Z')
    expect(gpsTimeUtc(undefined, [1, 2, 3])).toBeNull()
  })
})
