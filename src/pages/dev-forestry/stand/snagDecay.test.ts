import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESCRIPTION, applyPrescription } from './prescription'
import { treatedStems } from './prescribedCells'
import {
  SNAG_CURVES,
  curveAt,
  fallYear,
  snagCurveFor,
  snagFates,
  snagStatesAt,
  snagsStandingByYear,
  standingShare,
  type SnagCurve,
} from './snagDecay'
import { buildStand } from './standTrees'

/** A test curve, not a published one: half standing at 10 years, a fifth at 20. */
const TEST: SnagCurve = {
  id: 'test',
  label: 'Test',
  species: ['pine', 'spruce', 'fir', 'douglasFir', 'aspen', 'birch'],
  standing: [
    [0, 1],
    [10, 0.5],
    [20, 0.2],
  ],
  heightLeft: [
    [0, 1],
    [20, 0.5],
  ],
  bcData: false,
  source: 'test',
  note: '',
}

const BLOCK: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.8, 53.9],
      [-122.795, 53.9],
      [-122.795, 53.903],
      [-122.8, 53.903],
      [-122.8, 53.9],
    ],
  ],
}

describe('a survival curve', () => {
  it('reads between its points and falls on exponentially past its end', () => {
    expect(curveAt(TEST.standing, 5)).toBeCloseTo(0.75)
    expect(standingShare(TEST.standing, 20)).toBeCloseTo(0.2)
    // Past 20 years at the last span's rate: 0.5 → 0.2 over 10 years.
    expect(standingShare(TEST.standing, 30)).toBeCloseTo(0.2 * 0.4)
  })

  it('gives each draw the year the standing share falls to it, the inverse of the curve', () => {
    expect(fallYear(TEST.standing, 0.75)).toBeCloseTo(5)
    expect(fallYear(TEST.standing, 0.5)).toBeCloseTo(10)
    expect(fallYear(TEST.standing, 0.08)).toBeCloseTo(30)
    for (const u of [0.9, 0.6, 0.3, 0.1, 0.01])
      expect(standingShare(TEST.standing, fallYear(TEST.standing, u))).toBeCloseTo(u)
    expect(
      fallYear(
        [
          [0, 1],
          [10, 0.5],
          [20, 0.5],
        ],
        0.3,
      ),
    ).toBe(Infinity)
  })
})

describe('snags over the years after harvest', () => {
  const stand = buildStand({ geometry: BLOCK, stands: [], clearings: [], inventory: [], anchorLatitude: 53.9 }).stand!
  const prescription = {
    ...DEFAULT_PRESCRIPTION,
    outcome: 'felled' as const,
    target: { kind: 'stemShare' as const, value: 40 },
    snags: { perHa: 30, heightMeters: 8, yearsAfterHarvest: 0 },
  }
  const result = applyPrescription(stand, prescription)
  const fates = snagFates(stand, result, [TEST])

  it('falls each snag once, in the same year every time, and never stands it up again', () => {
    expect(fates.length).toBeGreaterThan(20)
    expect(snagFates(stand, result, [TEST])).toEqual(fates)
    const standingAt = (years: number) =>
      new Set(
        snagStatesAt(fates, years, [TEST])
          .filter((state) => state.standing)
          .map((state) => state.index),
      )
    const five = standingAt(5)
    for (const index of standingAt(15)) expect(five.has(index)).toBe(true)
  })

  it('follows the curve on average', () => {
    const byYear = snagsStandingByYear(fates, 30, [TEST])
    expect(byYear[0].drawn).toBe(fates.length)
    expect(byYear[10].expected).toBeCloseTo(fates.length * 0.5)
    expect(Math.abs(byYear[10].drawn - byYear[10].expected)).toBeLessThan(fates.length * 0.25)
  })

  it('draws a fallen snag as a log and a standing one shorter as it breaks', () => {
    const states = snagStatesAt(fates, 10, [TEST])
    const stems = treatedStems(stand, result, 'felled', 8, states)
    const standing = states.filter((state) => state.standing).length
    expect(stems.snag.length).toBe(standing)
    expect(stems.log.length).toBe(fates.length - standing)
    // Half way to the 20-year half height.
    for (const snag of stems.snag) expect(snag.heightMeters).toBeLessThanOrEqual(8 * 0.75 + 1e-9)
  })

  it('names a borrowed curve, and has one for every drawn species once the table is filled', () => {
    expect(snagCurveFor('aspen', [{ ...TEST, species: ['pine'] }])).toMatchObject({ own: false })
    for (const curve of SNAG_CURVES) {
      expect(curve.standing[0]).toEqual([0, 1])
      for (let i = 1; i < curve.standing.length; i += 1) {
        expect(curve.standing[i][0]).toBeGreaterThan(curve.standing[i - 1][0])
        expect(curve.standing[i][1]).toBeLessThanOrEqual(curve.standing[i - 1][1])
      }
      expect(curve.source.length).toBeGreaterThan(10)
    }
    for (const species of ['pine', 'spruce', 'fir', 'douglasFir', 'aspen', 'birch'] as const)
      expect(snagCurveFor(species)).not.toBeNull()
    expect(snagCurveFor('birch')).toMatchObject({ own: false, curve: { id: 'aspen-angers' } })
    expect(snagCurveFor('pine')).toMatchObject({ own: true, curve: { bcData: true } })
  })
})

describe('the published curves as tabled', () => {
  it('reads Lewis & Thompson’s pine figures back', () => {
    const pine = snagCurveFor('pine')!.curve
    expect(standingShare(pine.standing, 5)).toBeCloseTo(0.99)
    expect(1 - standingShare(pine.standing, 8)).toBeCloseTo(0.28)
  })

  it('loses height at the FVS rates: half by about 27 years for pine, 33 for Douglas-fir', () => {
    const pine = snagCurveFor('pine')!.curve.heightLeft!
    const douglas = snagCurveFor('douglasFir')!.curve.heightLeft!
    expect(curveAt(pine, 25)).toBeGreaterThan(0.5)
    expect(curveAt(pine, 30)).toBeLessThan(0.5)
    expect(curveAt(douglas, 30)).toBeGreaterThan(0.5)
    expect(curveAt(douglas, 35)).toBeLessThan(0.5)
  })
})
