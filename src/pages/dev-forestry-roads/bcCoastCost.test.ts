import { describe, expect, it } from 'vitest'
import {
  COAST_COST_SOURCE,
  COAST_POINTS_OF_ORIGIN,
  calculateCoastRoadBenchmark,
  type CoastRoadBenchmarkInput,
} from './bcCoastCost'

const baseline: CoastRoadBenchmarkInput = {
  category: 'OMLB',
  hardness: 'soft-medium',
  isolationFraction: 0,
  isolationEligibilityConfirmed: false,
  pointOfOrigin: null,
  pointOfOriginReviewed: true,
  tabularEligibilityConfirmed: true,
}

describe('Coast appraisal road benchmark', () => {
  it('keeps the source edition and cost base distinct from the estimate date', () => {
    expect(COAST_COST_SOURCE.effectiveDate).toBe('2026-01-01')
    expect(COAST_COST_SOURCE.costBaseYear).toBe(2024)
    const result = calculateCoastRoadBenchmark(baseline)
    expect(result.valid).toBe(true)
    expect(result.unitCostCadPerKm).toBe(72601)
    expect(result.source).toBe(COAST_COST_SOURCE)
  })

  it('reproduces a hard-rock MRK segment with both permitted additions', () => {
    // Table 5-1: 144,177 + (0.5 × 7,615) + 7,548 = 155,532.50 CAD/km.
    const result = calculateCoastRoadBenchmark({
      ...baseline,
      category: 'MRK',
      hardness: 'hard',
      isolationFraction: 0.5,
      isolationEligibilityConfirmed: true,
      pointOfOrigin: 'GRIS',
    })
    expect(result.unitCostCadPerKm).toBe(155532.5)
    expect(result.baseCadPerKm).toBe(144177)
    expect(result.isolationAddOnCadPerKm).toBe(3807.5)
    expect(result.pointOfOriginAddOnCadPerKm).toBe(7548)
  })

  it('uses the highest published rock-face category without extending beyond it', () => {
    const result = calculateCoastRoadBenchmark({ ...baseline, category: 'XXRK', hardness: 'hard' })
    expect(result.unitCostCadPerKm).toBe(250466)
    expect(result.notes.some((note) => note.includes('above 7.50 m'))).toBe(true)
    expect(
      calculateCoastRoadBenchmark({ ...baseline, category: 'XXXRK' as CoastRoadBenchmarkInput['category'] }).valid,
    ).toBe(false)
  })

  it('restricts the geographic addition to the five published point-of-origin areas', () => {
    expect(COAST_POINTS_OF_ORIGIN.filter((row) => row.addOnCadPerKm > 0).map((row) => row.code)).toEqual([
      'DRSE',
      'GKIN',
      'GRIS',
      'MIDC',
      'NTHC',
    ])
    expect(calculateCoastRoadBenchmark({ ...baseline, pointOfOrigin: 'SEVI' }).unitCostCadPerKm).toBe(72601)
    expect(calculateCoastRoadBenchmark({ ...baseline, pointOfOrigin: 'NTHC' }).unitCostCadPerKm).toBe(80149)
    expect(
      calculateCoastRoadBenchmark({
        ...baseline,
        pointOfOrigin: 'west-coast' as CoastRoadBenchmarkInput['pointOfOrigin'],
      }).valid,
    ).toBe(false)
  })

  it.each([undefined, false])(
    'refuses unknown point-of-origin geography instead of pricing it at zero (%s)',
    (pointOfOriginReviewed) => {
      const result = calculateCoastRoadBenchmark({ ...baseline, pointOfOrigin: null, pointOfOriginReviewed })
      expect(result.valid).toBe(false)
      expect(result.unitCostCadPerKm).toBeNull()
      expect(result.pointOfOriginAddOnCadPerKm).toBeNull()
      expect(result.errors.join(' ')).toContain('no eligible addition')
    },
  )

  it('accepts reviewed absence or an explicit valid area without an extra review flag', () => {
    expect(calculateCoastRoadBenchmark(baseline).pointOfOriginAddOnCadPerKm).toBe(0)
    const selected = calculateCoastRoadBenchmark({
      ...baseline,
      pointOfOrigin: 'GRIS',
      pointOfOriginReviewed: undefined,
    })
    expect(selected.valid).toBe(true)
    expect(selected.pointOfOriginAddOnCadPerKm).toBe(7548)
    expect(selected.unitCostCadPerKm).toBe(80149)
  })

  it('requires explicit tabular and isolation eligibility instead of inferring them from region', () => {
    expect(calculateCoastRoadBenchmark({ ...baseline, tabularEligibilityConfirmed: false }).unitCostCadPerKm).toBeNull()
    const unconfirmed = calculateCoastRoadBenchmark({ ...baseline, isolationFraction: 1 })
    expect(unconfirmed.valid).toBe(false)
    expect(unconfirmed.unitCostCadPerKm).toBeNull()
    expect(unconfirmed.errors.join(' ')).toContain('isolation eligibility')
    expect(
      calculateCoastRoadBenchmark({ ...baseline, isolationFraction: 1, isolationEligibilityConfirmed: true })
        .unitCostCadPerKm,
    ).toBe(80216)
  })

  it.each([-0.01, 1.01, NaN, Infinity, -Infinity])(
    'refuses invalid isolation fraction %s rather than clamping it',
    (isolationFraction) => {
      const result = calculateCoastRoadBenchmark({
        ...baseline,
        isolationFraction,
        isolationEligibilityConfirmed: true,
      })
      expect(result.valid).toBe(false)
      expect(result.unitCostCadPerKm).toBeNull()
      expect(result.baseCadPerKm).toBeNull()
    },
  )

  it('does not treat an unknown hardness as soft rock', () => {
    const result = calculateCoastRoadBenchmark({
      ...baseline,
      hardness: 'unknown' as CoastRoadBenchmarkInput['hardness'],
    })
    expect(result.valid).toBe(false)
    expect(result.unitCostCadPerKm).toBeNull()
  })
})
