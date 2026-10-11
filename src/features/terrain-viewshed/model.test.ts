import { describe, expect, it } from 'vitest'
import {
  computeViewshed,
  dateTimeInZone,
  destination,
  solarPosition,
  sunVisibility,
  viewshedBounds,
  type ViewshedSettings,
} from './model'
import { haversineMeters } from '@/pages/dev-forestry/visibility'

const SETTINGS: ViewshedSettings = { observer: { lng: 0, lat: 0 }, radiusMeters: 500, heightA: 1.2, heightB: 1.7 }
const FLAT = { elevationAt: () => 100 }

describe('terrain viewshed', () => {
  it('sees flat nearby terrain from both heights and clips to the radius', () => {
    const result = computeViewshed(FLAT, SETTINGS, 20, 24)
    expect(result.counts.total).toBeGreaterThan(400)
    expect(result.counts.total).toBeLessThan(24 * 24)
    expect(result.counts.visibleA).toBe(result.counts.total)
    expect(result.counts.visibleB).toBe(result.counts.total)
    expect(result.counts.unknown).toBe(0)
    expect(result.cells[0]).toBe(0)
  })

  it('a ridge blocks seated sightlines while a taller observer sees over it', () => {
    const source = { elevationAt: (lng: number) => (lng > 0.0008 && lng < 0.0016 ? 110 : 100) }
    const result = computeViewshed(source, { ...SETTINGS, heightB: 30 }, 10, 32)
    expect(result.counts.visibleB).toBeGreaterThan(result.counts.visibleA)
    expect(Array.from(result.cells)).toContain(3)
    expect(sunVisibility(result, { azimuth: 90, altitude: 2 }, 'A').status).toBe('blocked')
    expect(sunVisibility(result, { azimuth: 90, altitude: 2 }, 'B').status).toBe('clear')
  })

  it('missing ground never produces a clear viewshed or a clear sun', () => {
    const result = computeViewshed({ elevationAt: () => NaN }, SETTINGS, 30, 16)
    expect(result.counts.unknown).toBe(result.counts.total)
    expect(result.counts.visibleA).toBe(0)
    expect(sunVisibility(result, { azimuth: 90, altitude: 10 }, 'B').status).toBe('unknown')
  })

  it('unknown terrain beyond a known ridge cannot erase that obstruction', () => {
    const result = computeViewshed(
      { elevationAt: (lng: number) => (lng > 0.002 ? NaN : lng > 0.0008 ? 140 : 100) },
      SETTINGS,
      20,
      16,
    )
    expect(sunVisibility(result, { azimuth: 90, altitude: 2 }, 'A').status).toBe('blocked')
    expect(sunVisibility(result, { azimuth: 90, altitude: 85 }, 'A').status).toBe('unknown')
  })

  it('uses metre distances at northern latitudes and rejects unsupported footprints', () => {
    const origin = { lng: -122, lat: 54 }
    expect(haversineMeters(origin, destination(origin, 90, 5000))).toBeCloseTo(5000, 5)
    const box = viewshedBounds({ ...SETTINGS, observer: origin })
    expect(box[0]).toBeLessThan(origin.lng)
    expect(box[3]).toBeGreaterThan(origin.lat)
    expect(() => viewshedBounds({ ...SETTINGS, observer: { lng: 180, lat: 0 } })).toThrow('date line')
    expect(() => viewshedBounds({ ...SETTINGS, radiusMeters: Infinity })).toThrow('radius')
  })
})

describe('sun planning', () => {
  it('places the solstice noon sun south of Greenwich with the expected altitude', () => {
    const sun = solarPosition(new Date('2026-06-21T12:00:00Z'), { lng: 0, lat: 51.5 })
    expect(sun.altitude).toBeCloseTo(61.94, 0)
    expect(sun.azimuth).toBeGreaterThan(178)
    expect(sun.azimuth).toBeLessThan(182)
    expect(solarPosition(new Date('2026-06-21T00:00:00Z'), { lng: 0, lat: 51.5 }).altitude).toBeLessThan(0)
  })

  it('applies the selected date’s Vancouver DST offset', () => {
    expect(dateTimeInZone('2026-06-21', 240, 'America/Vancouver')?.toISOString()).toBe('2026-06-21T11:00:00.000Z')
    expect(dateTimeInZone('2025-12-21', 240, 'America/Vancouver')?.toISOString()).toBe('2025-12-21T12:00:00.000Z')
    expect(dateTimeInZone('2026-03-08', 150, 'America/Vancouver')).toBeNull()
    expect(dateTimeInZone('', 0, 'UTC')).toBeNull()
  })
})
