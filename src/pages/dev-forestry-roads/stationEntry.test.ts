import { describe, expect, it } from 'vitest'
import { stationEntry } from './stationEntry'
import type { RoadStationing } from './roadStationing'

describe('stationEntry', () => {
  it('keeps chainage in metres on a road without stationing', () => {
    for (const s of [undefined, { startStation: 0, equations: [] }]) {
      const entry = stationEntry(s, 1000)
      expect(entry.named).toBe(false)
      expect(entry.label('Assignment 1 start')).toBe('Assignment 1 start (m)')
      expect(entry.label('Site 1 station')).toBe('Site 1 station (m)')
      expect(entry.show(250)).toBe(250)
      expect(entry.take(1200, 250)).toBe(1200)
      expect(entry.limits).toBeNull()
    }
  })

  it('shows and takes station names on a road starting at 1+400', () => {
    const entry = stationEntry({ startStation: 1400, equations: [] }, 2800)
    expect(entry.named).toBe(true)
    expect(entry.label('Assignment 1 start')).toBe('Assignment 1 start (station)')
    expect(entry.label('Site 1 station')).toBe('Site 1 station')
    expect(entry.show(0)).toBe(1400)
    expect(entry.show(899.5)).toBe(2299.5)
    expect(entry.take(2299.5, 0)).toBeCloseTo(899.5, 9)
    // A name off the road goes to the nearest end, never past it.
    expect(entry.take(100, 500)).toBe(0)
    expect(entry.take(9000, 500)).toBe(2800)
    expect(entry.limits!.min).toBeLessThan(0)
  })

  it('leaves the stored chainage alone when the name shown is typed back', () => {
    // A file measured on its grid: chainage is not station minus start exactly.
    const stationing: RoadStationing = { startStation: 902.503639918, chainageScale: 1.0000000047235047, equations: [] }
    const entry = stationEntry(stationing, 1546.4)
    const stored = 123.456789123
    const shown = Math.round(entry.show(stored) * 1e6) / 1e6
    expect(entry.take(shown, stored)).toBe(stored)
    expect(entry.take(shown + 1, stored)).not.toBe(stored)
  })

  it('places a repeated name at the occurrence nearest the field', () => {
    // A back equation at 1+500 names 1+450…1+500 twice.
    const stationing: RoadStationing = { startStation: 1000, equations: [{ back: 1500, ahead: 1450 }] }
    const entry = stationEntry(stationing, 1000)
    expect(entry.take(1475, 470)).toBeCloseTo(475, 9)
    expect(entry.take(1475, 530)).toBeCloseTo(525, 9)
  })

  it('takes a blank optional end as the field gives it', () => {
    const entry = stationEntry({ startStation: 1400, equations: [] }, 2800)
    expect(entry.take(1500, null)).toBeCloseTo(100, 9)
  })
})
