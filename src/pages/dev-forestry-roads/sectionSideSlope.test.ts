import { describe, expect, it } from 'vitest'
import {
  SIDE_SLOPE_REACH_M,
  roadSidehill,
  sectionSideSlopes,
  sidehillClass,
  sidehillSpans,
  sidehillShareAtLeast,
  sidehillSummary,
  sideSlopeChecks,
} from './sectionSideSlope'
import type { SectionSample } from './types'

/** Samples every metre from −35 to 35 m on ground z(offset). */
const section = (ground: (offset: number) => number | null): SectionSample[] =>
  Array.from({ length: 71 }, (_, i) => {
    const offset = i - 35
    return { offset, ground: ground(offset), design: null }
  })

describe('sectionSideSlopes', () => {
  it('reads a plane sidehill as uphill on one side and downhill on the other', () => {
    // Rising 20 % toward the right.
    const { left, right, across } = sectionSideSlopes(section((x) => 700 + 0.2 * x))
    expect(right!.percent).toBeCloseTo(20, 6)
    expect(left!.percent).toBeCloseTo(-20, 6)
    expect(across!.percent).toBeCloseTo(20, 6)
    expect(across!.uphill).toBe('right')
    // Each side is fitted from the centreline out to the reach, left at negative offsets.
    expect(right!.from.offset).toBe(0)
    expect(right!.to.offset).toBe(SIDE_SLOPE_REACH_M)
    expect(left!.to.offset).toBe(-SIDE_SLOPE_REACH_M)
    expect(left!.to.z).toBeCloseTo(700 - 0.2 * SIDE_SLOPE_REACH_M, 6)
  })

  it('reads a ridge as falling away on both sides and level across', () => {
    const { left, right, across } = sectionSideSlopes(section((x) => 700 - 0.3 * Math.abs(x)))
    expect(left!.percent).toBeCloseTo(-30, 6)
    expect(right!.percent).toBeCloseTo(-30, 6)
    expect(across!.uphill).toBeNull()
  })

  it('ignores ground past the reach', () => {
    // A break at 18 m, as on a bench: the slope beyond it does not reach the fit.
    const { right } = sectionSideSlopes(section((x) => (x <= 18 ? 700 + 0.1 * x : 701.8 + 0.6 * (x - 18))))
    expect(right!.percent).toBeCloseTo(10, 6)
  })

  it('stops a side at the first terrain gap and drops a side shorter than the minimum span', () => {
    const gapped = sectionSideSlopes(section((x) => (x === 8 || x === -3 ? null : 700 + 0.25 * x)))
    expect(gapped.right!.to.offset).toBe(7)
    expect(gapped.right!.percent).toBeCloseTo(25, 6)
    expect(gapped.left).toBeNull()
    // Across never bridges the left gap: it runs from the last known left sample.
    expect(gapped.across!.from.offset).toBe(-2)
  })

  it('reports nothing without ground', () => {
    expect(sectionSideSlopes(section(() => null))).toEqual({ left: null, right: null, across: null })
  })
})

describe('sideSlopeChecks', () => {
  const batters = { cutHV: 0.75, fillHV: 1.5 }
  it('flags ground falling away at the fill batter and past the full-bench screen', () => {
    expect(sideSlopeChecks(-50, batters, 60)).toEqual([])
    expect(sideSlopeChecks(-62, batters, 60)).toEqual(['full-bench-screen'])
    expect(sideSlopeChecks(-100 / 1.5, batters, 60)).toEqual(['fill-never-catches', 'full-bench-screen'])
  })
  it('flags ground rising at the cut batter', () => {
    expect(sideSlopeChecks(120, batters, 60)).toEqual([])
    expect(sideSlopeChecks(140, batters, 60)).toEqual(['cut-never-catches'])
  })
  it('does not compare a batter of zero', () => {
    expect(sideSlopeChecks(-500, { cutHV: 0, fillHV: 0 }, 60)).toEqual(['full-bench-screen'])
  })
})

describe('road sidehill', () => {
  // Stations every 10 m from 0 to 100, on a plane rising toward the right at 10 % up to 50 m and 65 % after.
  const stations = Array.from({ length: 11 }, (_, i) => {
    const chainage = i * 10
    const pct = chainage < 50 ? 10 : 65
    return { chainage, section: section((x) => 700 + (pct / 100) * x) }
  })

  it('reads each station as a magnitude and its uphill side', () => {
    const rows = roadSidehill(stations)
    expect(rows[0].percent).toBeCloseTo(10, 6)
    expect(rows[0].uphill).toBe('right')
    expect(rows[10].percent).toBeCloseTo(65, 6)
  })

  it('joins consecutive stations of one class into spans that meet half-way', () => {
    const spans = sidehillSpans(roadSidehill(stations), 0, 100)
    expect(spans.map((s) => [s.start, s.end, s.sidehillClass])).toEqual([
      [0, 45, 'gentle'],
      [45, 100, 'full-bench'],
    ])
  })

  it('gives the length-weighted median over a range, and the steep shares', () => {
    const rows = roadSidehill(stations)
    const whole = sidehillSummary(rows, 0, 100)!
    // 45 m at 10 % and 55 m at 65 %: the median falls in the steep part.
    expect(whole.medianPercent).toBeCloseTo(65, 6)
    expect(whole.fullBenchShare).toBeCloseTo(0.55, 6)
    expect(whole.pastAppraisalShare).toBeCloseTo(0.55, 6)
    expect(whole.knownLengthM).toBeCloseTo(100, 6)
    expect(whole.maxPercent).toBeCloseTo(65, 6)
    const early = sidehillSummary(rows, 0, 40)!
    expect(early.medianPercent).toBeCloseTo(10, 6)
    expect(early.stations).toBe(5)
  })

  it('leaves stations without terrain out of the median but in the range length', () => {
    const rows = roadSidehill(stations).map((r) => (r.chainage >= 50 ? { ...r, percent: null, uphill: null } : r))
    const summary = sidehillSummary(rows, 0, 100)!
    expect(summary.medianPercent).toBeCloseTo(10, 6)
    expect(summary.knownLengthM).toBeCloseTo(45, 6)
    expect(summary.lengthM).toBeCloseTo(100, 6)
    expect(sidehillSummary(rows, 60, 100)).toBeNull()
  })

  it("gives the share at or past any limit, such as the Coast manual's 150 %", () => {
    const rows = roadSidehill(stations)
    expect(sidehillShareAtLeast(rows, 0, 100, 60)).toBeCloseTo(0.55, 6)
    expect(sidehillShareAtLeast(rows, 0, 100, 150)).toBe(0)
    expect(sidehillShareAtLeast(rows, 0, 100, 0)).toBeCloseTo(1, 6)
    const unknown = rows.map((r) => ({ ...r, percent: null, uphill: null }))
    expect(sidehillShareAtLeast(unknown, 0, 100, 150)).toBeNull()
  })

  it('classes at the appraisal limit and the full-bench screen', () => {
    expect(sidehillClass(49.9)).toBe('steep')
    expect(sidehillClass(50)).toBe('past-appraisal')
    expect(sidehillClass(60)).toBe('full-bench')
  })
})
