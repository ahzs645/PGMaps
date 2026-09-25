import { describe, expect, it } from 'vitest'

import type { PhotoPose } from './photoPose'
import { fitSkyline, photoSkyline, projectDirection, terrainProfile, type Pixels } from './skylineFit'
import type { ElevationSource } from './terrain'

const SKY = [120, 170, 230]
const CLOUD = [235, 236, 238]
const HILL = [70, 95, 60]

function image(width: number, height: number, groundAt: (x: number) => number, paint?: (x: number, y: number) => number[] | null): Pixels {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const colour = paint?.(x, y) ?? (y < groundAt(x) ? SKY : HILL)
      data.set([...colour, 255], (y * width + x) * 4)
    }
  }
  return { width, height, data }
}

const pose = (patch: Partial<PhotoPose> = {}): PhotoPose => ({
  lng: -122.7, lat: 54.6, altitudeMeters: 700, bearing: 300, pitch: 5, roll: 0,
  width: 1000, height: 750, focalPx: 600, k1: 0, k2: 0, ...patch,
})

describe('where the sky ends in a photo', () => {
  it('follows a ridge line, clouds included', () => {
    const ridge = (x: number) => 300 + Math.round(40 * Math.sin(x / 60))
    const pixels = image(400, 500, ridge, (x, y) => (y < 60 && x < 150 ? CLOUD : null))
    const skyline = photoSkyline(pixels, 40)
    for (const point of skyline) expect(Math.abs(point!.y - ridge(Math.floor(point!.x)))).toBeLessThanOrEqual(1)
  })

  it('stops at a hazy blue ridge that colour alone would call sky', () => {
    // Pale sky above, a darker hazed-blue mountain from row 200.
    const pixels = image(50, 400, () => 400, (_x, y) => (y < 200 ? [150, 190, 235] : [95, 110, 150]))
    for (const point of photoSkyline(pixels, 5)) expect(point!.y).toBe(200)
  })

  it('starts below a visor across the top of a dashboard photo', () => {
    const pixels = image(60, 300, () => 180, (_x, y) => (y < 40 ? [90, 90, 92] : null))
    for (const point of photoSkyline(pixels, 6)) expect(point!.y).toBe(180)
  })

  it('scans past the lower edge of a cloud and a pale visor to the real skyline', () => {
    // Pale visor, sky, a cloud band with sky under it, then the ridge at 250.
    const pixels = image(60, 400, () => 250, (_x, y) =>
      y < 30 ? [170, 180, 200] : y >= 100 && y < 130 ? CLOUD : y >= 130 && y < 135 ? [200, 205, 215] : null,
    )
    for (const point of photoSkyline(pixels, 6)) expect(point!.y).toBe(250)
  })

  it('ignores columns with no sky near the top', () => {
    const pixels = image(100, 100, () => 50, (x, y) => (x > 80 && y < 90 ? HILL : null))
    const skyline = photoSkyline(pixels, 10)
    expect(skyline.slice(0, 8).every(Boolean)).toBe(true)
    expect(skyline[9]).toBeNull()
  })
})

describe('fitting the photo to the terrain', () => {
  // A ridge whose height varies with azimuth, 5 km out, on flat ground.
  const ridgeHeight = (azimuth: number) => 250 + 120 * Math.sin((azimuth * Math.PI) / 18)
  const ridge: ElevationSource = {
    elevationAt: (lng, lat) => {
      const east = (lng + 122.7) * 111320 * Math.cos((54.6 * Math.PI) / 180), north = (lat - 54.6) * 110574
      const distance = Math.hypot(east, north)
      if (distance > 8000) return Number.NaN
      const azimuth = ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360
      return distance > 5000 ? 700 + ridgeHeight(azimuth) : 700
    },
  }

  it('recovers a heading and pitch that were a few degrees out', () => {
    const truth = pose({ bearing: 301.6, pitch: 3.9 })
    const recorded = pose() // bearing 300, pitch 5: 1.6° and −1.1° off
    const profile = terrainProfile(recorded, ridge, { from: 250, to: 350, step: 0.1, maxDistanceMeters: 8000 })
    // The photo, as the true pose would have seen that skyline.
    const skyline = Array.from({ length: 120 }, (_, i) => {
      const x = ((i + 0.5) / 120) * truth.width
      const hit = profile.map((p) => projectDirection(truth, p.azimuth, p.elevation)).filter(Boolean).reduce((a, b) => (Math.abs(b!.x - x) < Math.abs(a!.x - x) ? b : a))
      return hit ? { x, y: hit.y } : null
    })
    const fit = fitSkyline(recorded, profile, skyline)!
    expect(fit.nudge.bearing).toBeCloseTo(1.6, 1)
    expect(fit.nudge.pitch).toBeCloseTo(-1.1, 1)
    expect(fit.agreement).toBeGreaterThan(0.9)
  })

  it('does not let trees above the terrain pull the fit, but sky below it counts against a pose', () => {
    const truth = pose()
    const profile = terrainProfile(truth, ridge, { from: 250, to: 350, step: 0.1, maxDistanceMeters: 8000 })
    const skyline = Array.from({ length: 120 }, (_, i) => {
      const x = ((i + 0.5) / 120) * truth.width
      const hit = profile.map((p) => projectDirection(truth, p.azimuth, p.elevation)).filter(Boolean).reduce((a, b) => (Math.abs(b!.x - x) < Math.abs(a!.x - x) ? b : a))
      // A third of the columns have roadside trees standing well above the ridge.
      return hit ? { x, y: i % 3 === 0 ? hit.y - 120 : hit.y } : null
    })
    const fit = fitSkyline(truth, profile, skyline)!
    expect(Math.abs(fit.nudge.bearing)).toBeLessThan(0.15)
    expect(Math.abs(fit.nudge.pitch)).toBeLessThan(0.1)
  })

  it('reads a forested skyline, canopy standing on the ridge, as agreement', () => {
    const truth = pose({ bearing: 299.2, pitch: 5.4 })
    const recorded = pose()
    const profile = terrainProfile(recorded, ridge, { from: 250, to: 350, step: 0.1, maxDistanceMeters: 8000 })
    // The photographed skyline is the canopy: 20 m trees on a ridge 5 km out.
    const skyline = Array.from({ length: 120 }, (_, i) => {
      const x = ((i + 0.5) / 120) * truth.width
      const hit = profile
        .map((p) => projectDirection(truth, p.azimuth, p.elevation + (Math.atan2(20, p.distanceMeters) * 180) / Math.PI))
        .filter(Boolean)
        .reduce((a, b) => (Math.abs(b!.x - x) < Math.abs(a!.x - x) ? b : a))
      return hit ? { x, y: hit.y } : null
    })
    const fit = fitSkyline(recorded, profile, skyline)!
    expect(fit.agreement).toBeGreaterThan(0.9)
    expect(fit.nudge.bearing).toBeCloseTo(-0.8, 0)
    expect(fit.nudge.pitch).toBeCloseTo(0.4, 0)
  })

  it('declines to guess from a photo with almost no sky', () => {
    expect(fitSkyline(pose(), [{ azimuth: 300, elevation: 1, distanceMeters: 5000 }], [null, null, { x: 1, y: 1 }])).toBeNull()
  })
})
