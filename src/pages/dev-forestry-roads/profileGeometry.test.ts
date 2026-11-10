import { describe, expect, it } from 'vitest'
import {
  clearanceStretches,
  existingCrossfall,
  fitVerticalCurve,
  profileK,
  vehicleClearance,
  type LowVehicle,
} from './profileGeometry'
import type { RoadStation } from './types'

// Reference numbers: RFLTools functional specification §13.5 and §10 (textbook formulas).
describe('vertical curve fit', () => {
  const crest = (s: number) => 100 + 0.04 * s - 0.0004 * s * s
  it('recovers the reference crest: K 12.5, BVC (0, 100), PVI (50, 102), EVC (100, 100)', () => {
    const fit = fitVerticalCurve(Array.from({ length: 11 }, (_, i): [number, number] => [i * 10, crest(i * 10)]))!
    expect(fit.a).toBeCloseTo(-0.0004, 10)
    expect(fit.b).toBeCloseTo(0.04, 10)
    expect(fit.c).toBeCloseTo(100, 9)
    expect(fit.g1Percent).toBeCloseTo(4, 9)
    expect(fit.g2Percent).toBeCloseTo(-4, 9)
    expect(fit.k).toBeCloseTo(12.5, 9)
    expect(fit.bvc).toEqual([0, expect.closeTo(100, 9)])
    expect(fit.pvi).toEqual([50, expect.closeTo(102, 9)])
    expect(fit.evc).toEqual([100, expect.closeTo(100, 9)])
    expect(fit.maxResidualM).toBeLessThan(1e-9)
  })
  it('reads K along a profile and leaves a window with missing ground unknown', () => {
    const points = Array.from({ length: 101 }, (_, i) => ({ chainage: i, elevation: i === 90 ? null : crest(i) }))
    const k = profileK(points, 40)
    expect(k[50].kind).toBe('crest')
    expect(k[50].k).toBeCloseTo(12.5, 6)
    expect(k[80].k).toBeNull()
    expect(k[0].k).toBeNull()
  })
})

describe('existing crossfall', () => {
  const station = (chainage: number, ground: (offset: number) => number | null): RoadStation =>
    ({
      chainage,
      section: [-6, -3, -1, 0, 1, 3, 6].map((offset) => ({ offset, ground: ground(offset), design: null })),
    }) as unknown as RoadStation
  it('reads a plane across and a crown, negative falling away from the centre', () => {
    const plane = existingCrossfall([station(0, (o) => 100 - 0.02 * o)], {
      leftOffsetM: -3,
      rightOffsetM: 3,
      centreOffsetM: null,
      window: 1,
    })[0]
    expect(plane.leftPercent).toBeCloseTo(2, 9)
    expect(plane.rightPercent).toBeCloseTo(-2, 9)
    const crown = existingCrossfall([station(0, (o) => 100.1 - 0.02 * Math.abs(o))], {
      leftOffsetM: -3,
      rightOffsetM: 3,
      centreOffsetM: 0,
      window: 1,
    })[0]
    expect(crown.leftPercent).toBeCloseTo(-2, 9)
    expect(crown.rightPercent).toBeCloseTo(-2, 9)
  })
  it('smooths with a moving quadratic and keeps a missing station unknown', () => {
    const stations = Array.from({ length: 9 }, (_, i) =>
      station(i * 10, (o) => (i === 4 && o > 0 ? null : 100 - (0.01 + 0.001 * i) * o)),
    )
    const result = existingCrossfall(stations, { leftOffsetM: -3, rightOffsetM: 3, centreOffsetM: 0, window: 5 })
    // A crossfall changing linearly along the road is reproduced exactly.
    expect(result[2].rightPercent).toBeCloseTo(-(1 + 0.1 * 2), 9)
    expect(result[4].rightPercent).toBeNull()
    expect(result[4].leftPercent).toBeCloseTo(1 + 0.1 * 4, 9)
  })
})

describe('low vehicle clearance', () => {
  const vehicle: LowVehicle = {
    name: 'test',
    wheelbaseM: 10,
    clearanceM: 0.1,
    frontOverhangM: 0,
    rearOverhangM: 0,
    overhangClearanceM: 0,
  }
  /** A parabolic crest at 100 m of rate r per metre. */
  const crest = (k: number) => (s: number) => 100 - (s - 100) ** 2 / (200 * k)
  it('hangs up over a crest exactly when W²·r/8 exceeds the clearance', () => {
    // r = 1/(100 K): W²r/8 = 0.125 m at K 1 (hangs), 0.0625 m at K 2 (clears).
    expect(vehicleClearance(crest(1), 200, vehicle).conflicts.some((c) => c.kind === 'hang-up')).toBe(true)
    expect(vehicleClearance(crest(2), 200, vehicle).conflicts).toEqual([])
    const worst = Math.max(...vehicleClearance(crest(1), 200, vehicle).conflicts.map((c) => c.depthM))
    expect(worst).toBeCloseTo(0.125 - 0.1, 3)
  })
  it('scrapes a rear overhang in a sharp sag', () => {
    const sag = (s: number) => 100 + (s - 100) ** 2 / (200 * 0.5)
    const result = vehicleClearance(sag, 200, { ...vehicle, rearOverhangM: 4, overhangClearanceM: 0.2 })
    expect(result.conflicts.some((c) => c.kind === 'rear-overhang')).toBe(true)
  })
  it('counts missing ground as unknown, never clear', () => {
    const holed = (s: number) => (s > 50 && s < 55 ? null : 100)
    const result = vehicleClearance(holed, 200, vehicle)
    expect(result.unknownM).toBeGreaterThan(0)
    expect(result.conflicts).toEqual([])
  })
})

describe('clearanceStretches', () => {
  it('joins consecutive touches into one stretch per place and leads with the deepest', () => {
    const conflicts = [
      { chainage: 100, kind: 'hang-up' as const, depthM: 0.01 },
      { chainage: 100.5, kind: 'hang-up' as const, depthM: 0.05 },
      { chainage: 101, kind: 'hang-up' as const, depthM: 0.02 },
      { chainage: 101, kind: 'rear-overhang' as const, depthM: 0.03 },
      { chainage: 250, kind: 'hang-up' as const, depthM: 0.12 },
    ]
    const stretches = clearanceStretches(conflicts, 0.5)
    expect(stretches.map((s) => [s.kind, s.fromM, s.toM, s.worstChainage, s.depthM])).toEqual([
      ['hang-up', 250, 250, 250, 0.12],
      ['hang-up', 100, 101, 100.5, 0.05],
      ['rear-overhang', 101, 101, 101, 0.03],
    ])
  })

  it('returns nothing when nothing touches', () => {
    expect(clearanceStretches([])).toEqual([])
  })
})
