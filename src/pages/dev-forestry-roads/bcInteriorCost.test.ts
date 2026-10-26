import { describe, expect, it } from 'vitest'
import {
  BC_INTERIOR_COST_SOURCE,
  INTERIOR_ROAD_GROUPS,
  interiorRoadBenchmark,
  type InteriorBenchmarkInput,
} from './bcInteriorCost'

const example: InteriorBenchmarkInput = {
  roadGroup: 4,
  sideSlopePercent: 30,
  rockPercent: 20,
  roadType: 'long-term',
  becZone: 'ESSF',
  soilMoisture: 'wet',
}

describe('BC Interior 2026 appraisal cross-check', () => {
  it('keeps the publication date distinct from its 2024 cost base', () => {
    expect(BC_INTERIOR_COST_SOURCE.effectiveDate).toBe('2026-07-01')
    expect(BC_INTERIOR_COST_SOURCE.costBaseYear).toBe(2024)
    expect(INTERIOR_ROAD_GROUPS.map((group) => group.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('reproduces a hand-worked Group 4 wet ESSF long-term section', () => {
    // 7,281 + 7,890 (30 percent) + 7,153 + 945 + 2,078 = 25,347 CAD/km.
    const result = interiorRoadBenchmark({ ...example, lengthM: 1200 })
    expect(result.status).toBe('available')
    expect(result.subgradePerKm).toBe(25347)
    expect(result.subgradeTotal).toBeCloseTo(30416.4, 8)
    expect(result.errors).toEqual([])
  })

  it('uses side slope as a percent and rounds as the manual specifies', () => {
    const result = interiorRoadBenchmark({ ...example, sideSlopePercent: 30.5 })
    expect(result.slopeUsedPercent).toBe(31)
    expect(result.subgradePerKm).toBe(25610)
    expect(result.subgradeTotal).toBeNull()
  })

  it('applies the Group 6 SBS term without an ESSF term', () => {
    // 5,497 + 5,260 (20 percent) + 4,961 = 15,718 CAD/km.
    const result = interiorRoadBenchmark({
      ...example,
      roadGroup: 6,
      sideSlopePercent: 20,
      roadType: 'short-term',
      becZone: 'SBS',
      soilMoisture: 'dry',
    })
    expect(result.subgradePerKm).toBe(15718)
  })

  it('applies mutually exclusive BEC terms for Group 2 and Group 9', () => {
    // Group 2: 8,559 + 7,890 + 7,153 + 945 + 5,696 = 30,243.
    expect(interiorRoadBenchmark({ ...example, roadGroup: 2, becZone: 'ICH' }).subgradePerKm).toBe(30243)
    expect(interiorRoadBenchmark({ ...example, roadGroup: 2, becZone: 'CWH' }).subgradePerKm).toBe(30243)
    // Group 9: 13,105 + 7,890 + 7,153 + 945 + 5,267 = 34,360.
    expect(interiorRoadBenchmark({ ...example, roadGroup: 9, becZone: 'MS' }).subgradePerKm).toBe(34360)
    expect(interiorRoadBenchmark({ ...example, roadGroup: 9, becZone: 'ICH' }).subgradePerKm).toBe(33707)
  })

  it('checks each remaining published group at a common reference case', () => {
    // Long term, 30% side slope, wet, ESSF. Independently transcribed source totals.
    const expected: [number, number][] = [
      [3, 26493],
      [5, 24954],
      [7, 22518],
      [8, 29692],
      [10, 31134],
      [11, 49781],
      [12, 41316],
    ]
    for (const [roadGroup, total] of expected)
      expect(interiorRoadBenchmark({ ...example, roadGroup }).subgradePerKm).toBe(total)
  })

  it('requires missing geology, location and environmental inputs', () => {
    const result = interiorRoadBenchmark({
      roadGroup: null,
      sideSlopePercent: null,
      rockPercent: null,
      roadType: null,
      becZone: null,
      soilMoisture: null,
    })
    expect(result.status).toBe('needs-input')
    expect(result.errors).toHaveLength(6)
    expect(result.subgradePerKm).toBeNull()
    expect(result.subgradeTotal).toBeNull()
  })

  it('permits the 50 percent boundary but does not clip higher values into the table', () => {
    expect(interiorRoadBenchmark({ ...example, sideSlopePercent: 50, rockPercent: 50 }).status).toBe('available')
    for (const change of [{ sideSlopePercent: 50.01 }, { rockPercent: 50.01 }]) {
      const result = interiorRoadBenchmark({ ...example, ...change })
      expect(result.status).toBe('not-applicable')
      expect(result.subgradePerKm).toBeNull()
    }
  })

  it.each<Partial<InteriorBenchmarkInput>>([
    { roadGroup: 1 },
    { roadGroup: 13 },
    { roadGroup: 2.5 },
    { roadType: 'snow-ice' },
    { lengthM: 99.9 },
    { conditions: { terrainClass: 4 } },
    { conditions: { terrainClass: 5 } },
    { conditions: { runningSurfaceWidthM: 6.1, primaryAccessRoad: true } },
    { conditions: { requiresEndHaul: true } },
    { conditions: { requiresOverlandConstruction: true } },
    { conditions: { existingRoad: true } },
  ])('refuses a known condition outside this equation: %j', (change) => {
    const result = interiorRoadBenchmark({ ...example, ...change })
    expect(result.status).toBe('not-applicable')
    expect(result.subgradePerKm).toBeNull()
    expect(result.subgradeTotal).toBeNull()
  })

  it.each<Partial<InteriorBenchmarkInput>>([
    { sideSlopePercent: Number.NaN },
    { sideSlopePercent: -1 },
    { rockPercent: Number.POSITIVE_INFINITY },
    { rockPercent: 101 },
    { rockPercent: -1 },
    { lengthM: 0 },
    { lengthM: Number.NaN },
    { lengthM: Number.MAX_VALUE },
    { conditions: { runningSurfaceWidthM: -1 } },
  ])('returns no plausible cost for invalid input: %j', (change) => {
    const result = interiorRoadBenchmark({ ...example, ...change })
    expect(result.status).toBe('needs-input')
    expect(result.subgradePerKm).toBeNull()
    expect(result.subgradeTotal).toBeNull()
  })
})
