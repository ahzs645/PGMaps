import { describe, expect, it } from 'vitest'
import { downstreamCells, flowDirections, longestFlowPath, flowPathProfile } from './hydrology'
import type { IdfCurve } from './idfCurve'
import type { SurfaceGrid } from './surfaceGrid'
import {
  culvertTiming,
  kirpichTcMin,
  parseConcentrationSettings,
  profileSlope,
  smoothProfile,
  type PathProfile,
} from './timeOfConcentration'

const FT = 0.3048
const idf: IdfCurve = {
  stationName: 'Test',
  returnPeriodYears: 10,
  source: 'Entered by hand',
  use: 'table',
  table: [
    { durationMin: 5, intensityMmPerHr: 90 },
    { durationMin: 60, intensityMmPerHr: 25 },
    { durationMin: 1440, intensityMmPerHr: 2 },
  ],
}

describe('Kirpich time of concentration', () => {
  it("matches TxDOT's worked example (Hydraulic Design Manual ch. 4 §11, Figure 4-7)", () => {
    // Main channel 5,280 ft from outlet (700 ft) to divide (750 ft), less 500 ft of overland
    // flow: L = 4,780 ft at S = 50/5,280. TxDOT reads the channel time as about 32 min.
    expect(kirpichTcMin(4780 * FT, 50 / 5280)).toBeCloseTo(32, 0)
    // The metric form agrees with the imperial one, 0.0078 · L(ft)^0.77 · S^−0.385, to 0.2 %.
    const imperial = 0.0078 * 4780 ** 0.77 * (50 / 5280) ** -0.385
    expect(Math.abs(kirpichTcMin(4780 * FT, 50 / 5280) / imperial - 1)).toBeLessThan(0.002)
  })
})

describe('flow-path slope', () => {
  // Flat for 4 m from the outlet, then rising 3 m over the next 6 m.
  const profile: PathProfile = { distanceM: [0, 4, 10], elevationM: [100, 100, 103] }
  it('reads the 10–85, equal-area and end-to-end slopes (hand calculation)', () => {
    // 10–85: z(8.5) = 102.25, z(1.0) = 100 → 2.25 / 7.5 = 0.30.
    expect(profileSlope(profile, '10-85')).toBeCloseTo(0.3, 12)
    // Equal-area: area over the outlet level (0 + 3)/2 · 6 = 9 m² → 2 · 9 / 10² = 0.18.
    expect(profileSlope(profile, 'equal-area')).toBeCloseTo(0.18, 12)
    expect(profileSlope(profile, 'end-to-end')).toBeCloseTo(0.3, 12)
    expect(profileSlope({ distanceM: [0], elevationM: [5] }, '10-85')).toBeNull()
  })

  it('a 12 m moving mean leaves a straight profile alone and evens out a pit', () => {
    const d = Array.from({ length: 101 }, (_, k) => k)
    const straight = { distanceM: d, elevationM: d.map((x) => 0.05 * x) }
    expect(profileSlope(smoothProfile(straight, 12), '10-85')).toBeCloseTo(0.05, 12)
    // A 1 m deep stump hole at the 10 % point moves the raw 10–85 slope by 1.3 points; the mean, by 0.1.
    const pitted = { distanceM: d, elevationM: d.map((x) => 0.05 * x - (x === 10 ? 1 : 0)) }
    expect(profileSlope(pitted, '10-85')! - 0.05).toBeCloseTo(1 / 75, 6)
    expect(Math.abs(profileSlope(smoothProfile(pitted, 12), '10-85')! - 0.05)).toBeLessThan(0.0015)
  })

  it('follows the longest D8 path up a synthetic grid', () => {
    // 21 × 60 cells of 1 m falling south at 5 %: every cell drains straight down its column.
    const width = 21,
      height = 60
    const grid = (side: number): SurfaceGrid => {
      const values = new Float64Array(width * height)
      for (let row = 0; row < height; row++)
        for (let col = 0; col < width; col++)
          values[row * width + col] = 0.05 * (height - 1 - row) + side * Math.abs(col - 10)
      return { origin: [0, height - 1], cellM: 1, width, height, values }
    }
    const read = (g: SurfaceGrid) => {
      const dirs = flowDirections(g)
      const next = downstreamCells(dirs, g)
      const lengths = longestFlowPath(dirs, g, next)
      const outlet = (height - 1) * width + 10
      return { lengths, outlet, profile: flowPathProfile(g, next, lengths, g.values, outlet) }
    }
    const plane = read(grid(0))
    expect(plane.lengths[plane.outlet]).toBe(height)
    expect(plane.profile.distanceM).toHaveLength(height)
    // On the 12 m mean every method reads the plane's 5 %.
    for (const method of ['10-85', 'equal-area', 'end-to-end'] as const)
      expect(profileSlope(smoothProfile(plane.profile, 12), method)).toBeCloseTo(0.05, 12)
    // A valley (sides rising 2 % to the centre column): the longest path comes in from a corner,
    // and the traced path is that longest path less the outlet cell's own length.
    const valley = read(grid(0.02))
    expect(valley.profile.distanceM.at(-1)).toBeCloseTo(valley.lengths[valley.outlet] - 1, 9)
    expect(valley.lengths[valley.outlet]).toBeGreaterThan(height)
    const s = profileSlope(valley.profile, 'end-to-end')!
    expect(s).toBeGreaterThan(0.02)
    expect(s).toBeLessThan(0.07)
  })
})

describe('one culvert’s timing', () => {
  const steady = (slope: number, lengthM: number): PathProfile => ({
    distanceM: [0, lengthM],
    elevationM: [0, slope * lengthM],
  })
  it('reads the IDF at Kirpich Tc inside its range, with no flags', () => {
    const t = culvertTiming({
      areaHa: 10,
      pathLengthM: 500,
      profile: steady(0.05, 500),
      cellM: 4,
      settings: { slopeMethod: '10-85', minimumTcMin: 5 },
      idf,
    })
    expect(t.kirpichTcMin).toBeCloseTo(kirpichTcMin(500, 0.05), 9)
    expect(t.tcMin).toBe(t.kirpichTcMin)
    expect(t.flags).toEqual([])
    expect(t.smoothingWindowM).toBe(0)
    expect(t.intensityMmPerHr).toBeGreaterThan(25)
    expect(t.intensityMmPerHr).toBeLessThan(90)
  })

  it("flags a catchment outside Kirpich's range rather than using it silently", () => {
    const small = culvertTiming({
      areaHa: 0.1,
      pathLengthM: 60,
      profile: steady(0.25, 60),
      cellM: 1,
      settings: { slopeMethod: '10-85', minimumTcMin: 5 },
      idf,
    })
    expect(small.flags).toEqual(['area-below-kirpich', 'slope-above-kirpich', 'minimum-tc'])
    expect(small.tcMin).toBe(5)
    expect(small.intensityMmPerHr).toBe(90)
    const flat = culvertTiming({
      areaHa: 60,
      pathLengthM: 400,
      profile: steady(0, 400),
      cellM: 1,
      settings: { slopeMethod: 'equal-area', minimumTcMin: 10 },
      idf,
    })
    expect(flat.flags).toEqual(['area-above-kirpich', 'no-measurable-slope'])
    expect(flat.kirpichTcMin).toBeNull()
    expect(flat.tcMin).toBe(10)
  })

  it('parses the setting by hand', () => {
    const value = { enabled: true, slopeMethod: 'equal-area', minimumTcMin: 5, idf }
    expect(parseConcentrationSettings(value)).toEqual(value)
    expect(() => parseConcentrationSettings({ ...value, slopeMethod: 'steepest' })).toThrow(/slope method/)
    expect(() => parseConcentrationSettings({ ...value, minimumTcMin: 0 })).toThrow(/minimum time/)
  })
})
