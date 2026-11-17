import { describe, expect, it } from 'vitest'
import {
  crossDrainSpacingGuidance,
  crossDrainStretchGuidance,
  switchbackChainages,
  SWITCHBACK_TURN_DEG,
} from './crossDrainSpacing'
import { crossDrainSpacingM } from './engineeringManual'

/** Stations every `step` m whose grade is `grade(chainage)`. */
const stations = (length: number, grade: (chainage: number) => number | null, step = 10) =>
  Array.from({ length: Math.round(length / step) + 1 }, (_, i) => ({
    chainage: i * step,
    gradePercent: grade(i * step),
  }))

// 10% for the first 60 m, then 14%: two of the table's rows in one stretch.
const mixed = stations(200, (c) => (c < 60 ? 10 : 14))

describe('crossDrainStretchGuidance', () => {
  it('holds a mixed-grade stretch to its shortest band, where the steepest grade alone reads longer', () => {
    const run = crossDrainStretchGuidance({ stations: mixed, start: 0, end: 90, hazard: 'high' })
    // The steepest grade alone (14%, the 12%+ row) reads 100 m: a 90 m run would pass.
    expect(run.steepestOnlyLimitM).toBe(100)
    expect(crossDrainSpacingM(14).high).toBe(100)
    // The 9–12% band in the same run allows 75 m, and it governs.
    expect(run.governing).toMatchObject({ label: '9–12%', limitM: 75 })
    expect(run.state).toBe('over')
    expect(run.bands.map((band) => [band.label, band.lengthM, band.limitM])).toEqual([
      ['9–12%', 55, 75],
      ['12%+', 35, 100],
    ])
    // Only the band over 12% asks for a rock-lined ditch.
    expect(run.rockLineDitchM).toBe(35)
  })

  it('agrees with the steepest grade where the table falls with grade', () => {
    const run = crossDrainStretchGuidance({ stations: mixed, start: 0, end: 90, hazard: 'slight' })
    expect(run.governing).toMatchObject({ label: '12%+', limitM: 150 })
    expect(run.steepestOnlyLimitM).toBe(150)
    expect(run.state).toBe('within')
    expect(run.rockLineDitchM).toBe(0)
  })

  it('splits each interval at its middle and invents no grade between stations', () => {
    const run = crossDrainStretchGuidance({
      stations: stations(20, (c) => (c === 0 ? 2 : 8)),
      start: 0,
      end: 20,
      hazard: 'moderate',
    })
    // 2% then 8%: no 3–6% band appears.
    expect(run.bands.map((band) => [band.label, band.lengthM])).toEqual([
      ['0–3%', 5],
      ['6–9%', 15],
    ])
  })

  it('does not determine a run where part of it has no grade, unless the known part is already over', () => {
    const gap = stations(200, (c) => (c >= 100 ? null : 4))
    const open = crossDrainStretchGuidance({ stations: gap, start: 0, end: 120, hazard: 'slight' })
    expect(open).toMatchObject({ state: 'not-determined', unknownM: 25 })
    const over = crossDrainStretchGuidance({ stations: gap, start: 0, end: 200, hazard: 'high' })
    expect(over.state).toBe('over')
    expect(crossDrainStretchGuidance({ stations: [], start: 0, end: 50, hazard: 'high' })).toMatchObject({
      state: 'not-determined',
      governing: null,
      unknownM: 50,
    })
  })

  it('lists the low points and switchbacks inside the stretch only', () => {
    const run = crossDrainStretchGuidance({
      stations: mixed,
      start: 50,
      end: 120,
      hazard: 'moderate',
      lowPoints: [40, 80],
      switchbacks: [119, 150],
    })
    expect(run.lowPoints).toEqual([80])
    expect(run.switchbacks).toEqual([119])
  })
})

describe('crossDrainSpacingM on a class boundary', () => {
  it('takes the shorter spacing of the two rows', () => {
    // 12% is in both "9–12%" and "12+%": high hazard reads 75 m, not 100 m.
    expect(crossDrainSpacingM(12)).toEqual({ slight: 150, moderate: 100, high: 75 })
    expect(crossDrainSpacingM(-6)).toEqual({ slight: 250, moderate: 150, high: 100 })
  })
})

describe('crossDrainSpacingGuidance', () => {
  it('reads the runs between culverts and from each road end', () => {
    const read = crossDrainSpacingGuidance({
      stations: mixed,
      lengthM: 200,
      culverts: [{ chainage: 90 }, { chainage: 90 }, { chainage: 170 }],
      hazard: 'high',
    })
    expect(read.stretches.map((run) => [run.start, run.end, run.state])).toEqual([
      [0, 90, 'over'],
      [90, 170, 'within'],
      [170, 200, 'within'],
    ])
    expect(read.over).toHaveLength(1)
  })
})

describe('switchbackChainages', () => {
  const turning = (turnDeg: number) => {
    const out: { chainage: number; bearing: number; curveRadiusM: number | null }[] = []
    for (let c = 0; c <= 200; c += 10) {
      const onCurve = c > 80 && c <= 120
      const progress = Math.min(Math.max((c - 80) / 40, 0), 1)
      out.push({ chainage: c, bearing: (350 + progress * turnDeg) % 360, curveRadiusM: onCurve ? 15 : null })
    }
    return out
  }
  it('finds a curve that turns past the hairpin angle', () => {
    expect(switchbackChainages(turning(160))).toEqual([100])
    expect(switchbackChainages(turning(SWITCHBACK_TURN_DEG - 20))).toEqual([])
    expect(switchbackChainages(turning(-170))).toEqual([100])
  })
})
