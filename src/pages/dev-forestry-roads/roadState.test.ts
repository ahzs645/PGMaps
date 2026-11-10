/**
 * State score, class, harmonic conductivity, sinuosity and line difference against the figures of a
 * reference run of ALSroads 0.2.0, 10 November 2026 (its own scoring, line and difference code run
 * unmodified), and against hand-derived cases from its functional specification. Synthetic inputs only.
 */
import { describe, expect, it } from 'vitest'
import type { XY } from './roadGrid'
import {
  DEFAULT_ROAD_FIND_SETTINGS,
  changedRoadFindSettings,
  harmonicConductivity,
  lineDifference,
  parseRoadFindSettings,
  roadState,
  roadStateClass,
  sinuosity,
} from './roadState'

describe('road state score and class', () => {
  it.each([
    // P %, drivable m, shoulders %, conductivity → score, class (reference run)
    [5, 6, 90, 0.7, 100, 1],
    [20, 4, 60, 0.4, 60.4, 2],
    [30, 2, 50, 0.3, 19.6, 4],
    [45, 0.5, 10, 0.2, 0, 4],
    [0, 5, 75, 0.5, 100, 1],
    [100, 0, 0, 0, 0, 4],
    [12, 3.4, 62.5, 0.45, 70.8, 2],
  ])(
    'P %d %%, W %d m, S %d %%, Σ %d → %d, class %d',
    (vegetationPercent, drivableWidthM, shoulderPercent, conductivity, score, stateClass) => {
      const state = roadState({ vegetationPercent, drivableWidthM, shoulderPercent, conductivity })
      expect(state.score).toBe(score)
      expect(state.stateClass).toBe(stateClass)
    },
  )

  it('rounds each sub-score to three decimals before the mean (hand check of the 60.4 row)', () => {
    const state = roadState({ vegetationPercent: 20, drivableWidthM: 4, shoulderPercent: 60, conductivity: 0.4 })
    expect(state.subScores).toEqual({ vegetation: 0.667, drivableWidth: 0.75, conductivity: 0.6, shoulders: 0.4 })
  })

  it('classes scores at the 75 / 50 / 25 floors', () => {
    expect([0, 24.9, 25, 49.9, 50, 74.9, 75, 100].map(roadStateClass)).toEqual([4, 4, 3, 3, 2, 2, 1, 1])
  })

  it('applies edited thresholds', () => {
    const local = { ...DEFAULT_ROAD_FIND_SETTINGS.state, drivableWidthM: [1, 3] as [number, number] }
    expect(
      roadState({ vegetationPercent: 5, drivableWidthM: 3, shoulderPercent: 90, conductivity: 0.7 }, local).score,
    ).toBe(100)
  })
})

describe('path conductivity', () => {
  it('is the length-weighted harmonic mean, not the arithmetic mean', () => {
    // 100 m: 50 m at 1 and 50 m at 0.25 → cost 50 + 200 = 250 → 0.40, where the arithmetic mean is 0.625.
    const sigma = harmonicConductivity([
      { lengthM: 50, value: 1 },
      { lengthM: 50, value: 0.25 },
    ])
    expect(sigma).toBe(0.4)
    expect(
      roadState({ vegetationPercent: 0, drivableWidthM: 5, shoulderPercent: 75, conductivity: sigma! }).subScores
        .conductivity,
    ).toBe(0.6)
    expect(
      roadState({ vegetationPercent: 0, drivableWidthM: 5, shoulderPercent: 75, conductivity: 0.625 }).subScores
        .conductivity,
    ).toBe(1)
  })

  it('skips unusable samples and is null without any', () => {
    expect(harmonicConductivity([{ lengthM: 1, value: Number.NaN }])).toBeNull()
    expect(
      harmonicConductivity([
        { lengthM: 1, value: 0.5 },
        { lengthM: 1, value: Number.NaN },
      ]),
    ).toBe(0.5)
  })
})

describe('sinuosity', () => {
  it('matches the reference run', () => {
    expect(
      sinuosity([
        [0, 0],
        [30, 40],
        [60, 0],
      ]),
    ).toBeCloseTo(1.666667, 6)
    const semicircle: XY[] = Array.from({ length: 181 }, (_, i) => [
      100 * Math.cos((Math.PI * i) / 180),
      100 * Math.sin((Math.PI * i) / 180),
    ])
    expect(sinuosity(semicircle)).toBeCloseTo(1.570776, 6)
  })

  it('is null for a loop', () => {
    expect(
      sinuosity([
        [0, 0],
        [10, 0],
        [0, 0],
      ]),
    ).toBeNull()
  })
})

describe('line difference', () => {
  const record: XY[] = [
    [0, 0],
    [100, 0],
  ]
  it('reads a parallel shift as the shift', () => {
    expect(
      lineDifference(record, [
        [0, 5],
        [100, 5],
      ]),
    ).toEqual({ p50: 5, p90: 5, max: 5, endMaxM: 5 })
  })

  it('pairs by nearest point, so a longer overlapping line reads 0 along it and 20 m at its end', () => {
    // The reference run pairs by fraction along both lines and reads 10 / 18.8 / 20 m here.
    const d = lineDifference(record, [
      [0, 0],
      [120, 0],
    ])!
    expect([d.p50, d.p90, d.max]).toEqual([0, 0, 0])
    expect(d.endMaxM).toBe(20)
  })

  it('measures a bowed line to its nearest point', () => {
    const d = lineDifference(record, [
      [0, 0],
      [50, 10],
      [100, 0],
    ])!
    // Nearest to (50, 0) is 10 · cos(atan 0.2) = 9.81 m; the ends coincide.
    expect(d.max).toBeCloseTo(9.806, 3)
    expect(d.endMaxM).toBe(0)
  })
})

describe('road search settings', () => {
  it('fills defaults, and refuses values out of range or inverted pairs by name', () => {
    expect(parseRoadFindSettings({})).toEqual(DEFAULT_ROAD_FIND_SETTINGS)
    expect(() => parseRoadFindSettings({ corridorM: 120 })).toThrow(/Search corridor/)
    expect(() => parseRoadFindSettings({ confidence: 1 })).toThrow(/Pull to the record/)
    expect(() => parseRoadFindSettings({ state: { drivableWidthM: [5, 1] } })).toThrow(/Drivable width/)
  })

  it('lists only what changed', () => {
    expect(changedRoadFindSettings(DEFAULT_ROAD_FIND_SETTINGS)).toEqual([])
    expect(changedRoadFindSettings({ ...DEFAULT_ROAD_FIND_SETTINGS, corridorM: 60, maxBrushShare: 0.2 })).toEqual([
      'corridor 60 m',
      'drivable 20 %',
    ])
  })
})
