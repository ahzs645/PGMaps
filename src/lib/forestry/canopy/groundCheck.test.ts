import { describe, expect, it } from 'vitest'
import { differenceStats, groundCheck, groundCheckSummary, type GroundPoint } from './groundCheck'

describe('differenceStats', () => {
  it('keeps the median and a robust spread through a few outliers', () => {
    const d = [...Array(97).fill(1), 40, -40, 60]
    const s = differenceStats(d)!
    expect(s.medianM).toBe(1)
    expect(s.robustSpreadM).toBe(0)
    expect(s.rmseM).toBeGreaterThan(7)
  })
  it('says nothing about nothing', () => expect(differenceStats([])).toBeNull())
})

describe('groundCheck', () => {
  // Two passes along a line; the terrain sits 1.6 m above the reference everywhere.
  const points: GroundPoint[] = []
  for (const group of ['2022-08-25 spot 1', '2023-08-05 spot 5'])
    for (let i = 0; i < 400; i++) {
      const lat = 54 + i * 0.5 * 9e-6
      points.push({ lon: -122.8, lat, h: 800 + i * 0.05 + (i % 3) * 0.1, group })
    }
  const terrain = (_lon: number, lat: number) => 800 + ((lat - 54) / 9e-6) * 0.1 + 1.6

  it('bins a dense track so it is not counted point by point', () => {
    const bins = groundCheck(points, terrain, { binM: 20 })
    // 400 points × 0.5 m = 200 m of track per pass, in 20 m bins.
    expect(bins.length).toBeGreaterThanOrEqual(20)
    expect(bins.length).toBeLessThanOrEqual(24)
    expect(new Set(bins.map((b) => b.group)).size).toBe(2)
    expect(bins.every((b) => Math.abs(b.difference - 1.6) < 0.25)).toBe(true)
  })

  it('summarises by slope class and by pass, and leaves out bins the terrain does not cover', () => {
    const bins = groundCheck(points, (lon, lat) => (lat > 54.0012 ? NaN : terrain(lon, lat)), {
      slopeAt: (_lon, lat) => (lat < 54.0006 ? 5 : 35),
    })
    const summary = groundCheckSummary(bins)
    expect(summary.all!.medianM).toBeCloseTo(1.6, 0)
    expect(summary.bySlope.map((s) => s.slope)).toEqual(['0–10 %', '10–30 %', '30–50 %', '50 % +'])
    expect(summary.bySlope[0].stats!.bins).toBeGreaterThan(0)
    expect(summary.bySlope[1].stats).toBeNull()
    expect(summary.bySlope[2].stats!.bins).toBeGreaterThan(0)
    expect(summary.byGroup.map((g) => g.group)).toEqual(['2022-08-25 spot 1', '2023-08-05 spot 5'])
  })
})
