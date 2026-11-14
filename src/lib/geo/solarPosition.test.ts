import { describe, expect, it } from 'vitest'
import { sunPosition } from './solarPosition'

const princeGeorge = { lng: -122.6456, lat: 53.9104 }

describe('sun position', () => {
  it('matches NOAA’s solar calculator', () => {
    // NOAA's solar calculation spreadsheet equations, worked separately (Nanite Forest's own port gives the same
    // figures to 0.01°), geometric (no refraction), Prince George.
    const cases: Array<[string, number, number]> = [
      ['2026-01-21T00:15:00Z', 0.87, 233.13],
      ['2026-07-15T21:00:00Z', 56.47, 198.48],
      ['2026-03-20T20:00:00Z', 36.05, 174.46],
      ['2026-06-21T04:00:00Z', 4.4, 304.86],
    ]
    for (const [iso, elevation, azimuth] of cases) {
      const sun = sunPosition(new Date(iso), princeGeorge)
      expect(sun.elevationDegrees).toBeCloseTo(elevation, 1)
      expect(sun.azimuthDegrees).toBeCloseTo(azimuth, 1)
    }
  })

  it('is below the horizon at night and due south near noon', () => {
    expect(sunPosition(Date.parse('2026-01-21T08:00:00Z'), princeGeorge).elevationDegrees).toBeLessThan(-30)
    const noon = sunPosition(Date.parse('2026-06-21T20:12:00Z'), princeGeorge)
    expect(Math.abs(noon.azimuthDegrees - 180)).toBeLessThan(2)
    // 90 − 53.91 + 23.44
    expect(noon.elevationDegrees).toBeCloseTo(59.5, 0)
  })
})
