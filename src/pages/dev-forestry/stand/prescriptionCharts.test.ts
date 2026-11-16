import { describe, expect, it } from 'vitest'
import { DEFAULT_PRESCRIPTION, applyPrescription, type StandPrescription } from './prescription'
import {
  clumpDistribution,
  diameterClasses,
  heightClasses,
  niceTicks,
  normalizedClumpTargets,
  principalAxisBearing,
  speciesBeforeAfter,
  standProfile,
} from './prescriptionCharts'
import { ICO_CLASSES } from './standMetrics'
import { buildStand, type Stand } from './standTrees'

const ANCHOR = 53.9
// About 200 m east–west × 100 m north–south at 53.9° N: its long axis runs east–west.
const BLOCK: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [
    [
      [-122.8, 53.9],
      [-122.797, 53.9],
      [-122.797, 53.9009],
      [-122.8, 53.9009],
      [-122.8, 53.9],
    ],
  ],
}

function stand(): Stand {
  const built = buildStand({ geometry: BLOCK, stands: [], clearings: [], inventory: [], anchorLatitude: ANCHOR })
  if (!built.stand) throw new Error(built.error)
  return built.stand
}

const prescription = (patch: Partial<StandPrescription>): StandPrescription => ({ ...DEFAULT_PRESCRIPTION, ...patch })
const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

describe('prescription charts', () => {
  const s = stand()
  const result = applyPrescription(s, prescription({ target: { kind: 'basalAreaShare', value: 50 } }))

  it('splits diameter and height classes into kept and removed stems that add up to the stand table', () => {
    for (const rows of [diameterClasses(s, result), heightClasses(s, result)]) {
      expect(rows.length).toBeGreaterThan(1)
      expect(rows.length).toBeLessThanOrEqual(24)
      expect(sum(rows.map((row) => row.kept))).toBeCloseTo(result.summaries.retained.stemsPerHa, 6)
      expect(sum(rows.map((row) => row.removed))).toBeCloseTo(result.summaries.removed.stemsPerHa, 6)
    }
    const dbh = diameterClasses(s, result)
    expect(dbh[0].from).toBe(0)
    // Removal from below takes the small stems: the smallest class with stems is mostly removed.
    const first = dbh.find((row) => row.kept + row.removed > 0)!
    expect(first.removed).toBeGreaterThan(first.kept)
    expect(heightClasses(s, result)[0].to - heightClasses(s, result)[0].from).toBeGreaterThanOrEqual(2)
  })

  it('reads species before and after with readable names', () => {
    const rows = speciesBeforeAfter(s, result)
    expect(rows.length).toBeGreaterThan(0)
    expect(sum(rows.map((row) => row.before))).toBeCloseTo(result.summaries.before.stemsPerHa, 6)
    expect(sum(rows.map((row) => row.after))).toBeCloseTo(result.summaries.retained.stemsPerHa, 6)
    for (const row of rows) expect(row.label).toMatch(/^[A-Z]/)
  })

  it('normalises the clump targets and reads the clump shares from the result', () => {
    expect(normalizedClumpTargets([1, 1, 2, 0, 0])).toEqual([0.25, 0.25, 0.5, 0, 0])
    expect(sum(normalizedClumpTargets([0, 0, 0, 0, 0]))).toBeCloseTo(1, 9)
    const rows = clumpDistribution(result, [20, 30, 25, 15, 10])
    expect(rows.map((row) => row.id)).toEqual(ICO_CLASSES.map((c) => c.id))
    expect(sum(rows.map((row) => row.target))).toBeCloseTo(1, 9)
    expect(rows.map((row) => row.before)).toEqual(result.clumps.before.shares)
    expect(rows.map((row) => row.kept)).toEqual(result.clumps.retained.shares)
  })

  it('finds the long axis of a spread of points', () => {
    const line = (bearing: number) =>
      Array.from({ length: 21 }, (_, i) => ({
        x: (i - 10) * Math.sin((bearing * Math.PI) / 180) + (i % 2) * 0.1,
        y: (i - 10) * Math.cos((bearing * Math.PI) / 180),
      }))
    expect(principalAxisBearing(line(0))).toBeCloseTo(0, 0)
    expect(principalAxisBearing(line(45))).toBeCloseTo(45, 0)
    expect(principalAxisBearing(line(120))).toBeCloseTo(120, 0)
    expect(principalAxisBearing([{ x: 0, y: 0 }])).toBe(90)
  })

  it('draws a strip through the block along its long axis, capped and saying how many it left out', () => {
    const profile = standProfile(s, result)
    expect(Math.abs(profile.axisBearingDegrees - 90)).toBeLessThan(5)
    expect(profile.bearingDegrees).toBe(profile.axisBearingDegrees)
    expect(profile.widthMeters).toBe(20)
    expect(profile.lengthMeters).toBeGreaterThan(180)
    expect(profile.lengthMeters).toBeLessThan(210)
    for (const tree of profile.trees) expect(Math.abs(tree.across)).toBeLessThanOrEqual(10)
    expect(profile.trees[0].along).toBe(0)
    expect(profile.counts.kept + profile.counts.removed + profile.counts.protected).toBe(profile.inStrip)
    expect(profile.trees.length + profile.leftOut).toBe(profile.inStrip)
    expect(profile.trees.length).toBeLessThanOrEqual(400)

    const capped = standProfile(s, result, { maxTrees: 50 })
    expect(capped.trees).toHaveLength(50)
    expect(capped.leftOut).toBe(capped.inStrip - 50)
    // Evenly spaced along the strip: the first and last trees stay.
    expect(capped.trees[0].along).toBe(0)
    expect(capped.trees[49].along).toBeCloseTo(capped.lengthMeters, 6)

    const across = standProfile(s, result, { bearingDegrees: 0, widthMeters: 10 })
    expect(across.bearingDegrees).toBe(0)
    expect(across.lengthMeters).toBeLessThan(110)
  })

  it('marks protected trees in the profile', () => {
    const keys = s.trees.slice(0, 4000).map((tree) => tree.key)
    const protectedResult = applyPrescription(
      s,
      prescription({ target: { kind: 'basalAreaShare', value: 50 }, protectedKeys: keys }),
    )
    const profile = standProfile(s, protectedResult)
    expect(profile.counts.protected).toBeGreaterThan(0)
  })

  it('ticks an axis in round steps up to at least the maximum', () => {
    expect(niceTicks(87)).toEqual([0, 25, 50, 75, 100])
    expect(niceTicks(4)).toEqual([0, 1, 2, 3, 4])
    expect(niceTicks(0.37)).toEqual([0, 0.1, 0.2, 0.3, 0.4])
    expect(niceTicks(0)).toEqual([0, 1])
  })
})
