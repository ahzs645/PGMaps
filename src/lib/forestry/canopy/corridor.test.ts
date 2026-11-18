import { describe, expect, it } from 'vitest'
import { corridorCanopy, gapRuns, type CorridorStation } from './corridor'

// A road running due north from 54° N: east is the right-hand side, so offsets are + to the east.
const lat0 = 54,
  lon0 = -122.8
const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180)
const stations: CorridorStation[] = Array.from({ length: 21 }, (_, i) => ({
  chainage: i * 10,
  coordinate: [lon0, lat0 + (i * 10) / 111_320],
  bearing: 0,
}))
const offsetOf = (lon: number) => (lon - lon0) * kx

describe('corridorCanopy', () => {
  it('finds timber in the clearing and trees that can reach the running surface', () => {
    // Open to 12 m left; a 25 m stand from 12 m left outward; open on the right.
    const sample = (lon: number) => (offsetOf(lon) <= -12 ? 25 : 0)
    const [first] = corridorCanopy(stations, sample, { halfWidthM: 30, stepM: 1, defaultClearingHalfWidthM: 10 })
    expect(first.centreM).toBe(0)
    expect(first.clearingTimberShare).toBe(0)
    expect(first.gap).toBe(false) // timber on one side only
    // From −12 to −28 m, every 25 m tree reaches the edge of a 3 m half-width running surface.
    expect(first.reachingTrees).toBeGreaterThanOrEqual(16)
    expect(first.tallestReaching?.heightM).toBe(25)
    expect(first.tallestReaching!.offsetM).toBeLessThan(0) // left is negative
  })

  it('reads a straight opening between stands as a gap, and reports its chainage run', () => {
    // A 4 m wide open strip down the centreline from chainage 50 to 150, timber either side.
    const sample = (lon: number, lat: number) => {
      const ch = ((lat - lat0) * 111_320) | 0
      return Math.abs(offsetOf(lon)) <= 2.5 && ch >= 50 && ch <= 150 ? 0 : 22
    }
    const result = corridorCanopy(stations, sample, { halfWidthM: 30, stepM: 0.5, defaultClearingHalfWidthM: 3 })
    expect(result.filter((r) => r.gap).map((r) => r.chainage)).toEqual([
      50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150,
    ])
    expect(gapRuns(result, 30)).toEqual([{ fromM: 50, toM: 150 }])
    expect(gapRuns(result, 200)).toEqual([])
  })

  it('uses a station’s own clearing edges and skips samples a source cannot give', () => {
    const sample = (lon: number) => (offsetOf(lon) > 0 ? NaN : 30)
    const [s] = corridorCanopy([{ ...stations[0], leftClearingM: 6, rightClearingM: 20 }], sample, {
      halfWidthM: 10,
      stepM: 1,
    })
    expect(s.sampled).toBe(11) // −10 … 0
    expect(s.clearingTimberShare).toBe(1)
    expect(s.reachingTrees).toBe(4) // −7 … −10, outside the 6 m left edge
  })
})
