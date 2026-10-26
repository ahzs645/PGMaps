import { describe, expect, it } from 'vitest'
import {
  CUBIC_METRES_PER_CUBIC_YARD,
  calculateEquipmentUnitCost,
  calculateMaterialUnitCost,
  calculateTruckCycleUnitCost,
  type MaterialUnitCostInput,
} from './costRateTools'

describe('unit-safe road cost rate tools', () => {
  it('converts a tonne quote using compacted mass and leaves an unrelated loose factor unset', () => {
    const result = calculateMaterialUnitCost({
      quoteUnit: 'tonne',
      priceCad: 25,
      tonnesPerCompactedM3: 2.2,
      looseM3PerCompactedM3: null,
    })
    expect(result.unitCostCad).toBeCloseTo(55, 10)
    expect(result.unit).toBe('CAD/compacted m³')
  })

  it('uses the exact cubic-yard conversion and preserves a compacted-volume round trip', () => {
    // One international yard is exactly 3 × 0.3048 metres.
    expect(CUBIC_METRES_PER_CUBIC_YARD).toBeCloseTo((3 * 0.3048) ** 3, 14)
    const result = calculateMaterialUnitCost({
      quoteUnit: 'loose-yd3',
      priceCad: 40,
      tonnesPerCompactedM3: null,
      looseM3PerCompactedM3: 1.25,
    })
    // 100 loose yd³ cost $4,000; dividing by the same compacted volume recovers the unit rate.
    const compactedM3 = (100 * (3 * 0.3048) ** 3) / 1.25
    expect(result.unitCostCad).toBeCloseTo(4000 / compactedM3, 10)
    expect(result.unitCostCad! * compactedM3).toBeCloseTo(4000, 8)
  })

  it('prices a complete truck cycle in compacted units without adding a second return leg', () => {
    // $180/hour × 40 minutes ÷ 60 ÷ 12 compacted m³ = $10/m³.
    const result = calculateTruckCycleUnitCost({ allInRateCadPerHour: 180, cycleMinutes: 40, compactedPayloadM3: 12 })
    expect(result.unitCostCad).toBe(10)
    expect(result.unit).toBe('CAD/compacted m³')
  })

  it('uses net crew production on the same hourly basis', () => {
    expect(calculateEquipmentUnitCost({ allInCrewCadPerHour: 450, netBankM3PerHour: 30 })).toEqual({
      valid: true,
      unitCostCad: 15,
      unit: 'CAD/bank m³',
      errors: [],
    })
  })

  it('requires explicit units and material factors rather than manufacturing defaults', () => {
    const unknown: MaterialUnitCostInput = {
      quoteUnit: null,
      priceCad: null,
      tonnesPerCompactedM3: null,
      looseM3PerCompactedM3: null,
    }
    expect(calculateMaterialUnitCost(unknown).unitCostCad).toBeNull()
    expect(calculateMaterialUnitCost({ ...unknown, quoteUnit: 'tonne', priceCad: 25 }).valid).toBe(false)
    expect(calculateMaterialUnitCost({ ...unknown, quoteUnit: 'loose-yd3', priceCad: 25 }).valid).toBe(false)
    expect(
      calculateTruckCycleUnitCost({ allInRateCadPerHour: null, cycleMinutes: 40, compactedPayloadM3: 12 }).valid,
    ).toBe(false)
  })

  it.each([0, -1, null, NaN, Infinity])(
    'refuses invalid material factors and zero/invalid denominators: %s',
    (value) => {
      expect(
        calculateMaterialUnitCost({
          quoteUnit: 'tonne',
          priceCad: 10,
          tonnesPerCompactedM3: value,
          looseM3PerCompactedM3: null,
        }).valid,
      ).toBe(false)
      expect(
        calculateMaterialUnitCost({
          quoteUnit: 'loose-yd3',
          priceCad: 10,
          tonnesPerCompactedM3: null,
          looseM3PerCompactedM3: value,
        }).valid,
      ).toBe(false)
      expect(
        calculateTruckCycleUnitCost({ allInRateCadPerHour: 180, cycleMinutes: 40, compactedPayloadM3: value }).valid,
      ).toBe(false)
      expect(
        calculateTruckCycleUnitCost({ allInRateCadPerHour: 180, cycleMinutes: value, compactedPayloadM3: 12 }).valid,
      ).toBe(false)
      expect(calculateEquipmentUnitCost({ allInCrewCadPerHour: 450, netBankM3PerHour: value }).valid).toBe(false)
    },
  )

  it('allows a zero price only when explicitly supplied with valid quantities', () => {
    expect(
      calculateMaterialUnitCost({
        quoteUnit: 'tonne',
        priceCad: 0,
        tonnesPerCompactedM3: 2.2,
        looseM3PerCompactedM3: null,
      }).unitCostCad,
    ).toBe(0)
    expect(
      calculateTruckCycleUnitCost({ allInRateCadPerHour: 0, cycleMinutes: 40, compactedPayloadM3: 12 }).unitCostCad,
    ).toBe(0)
    expect(calculateEquipmentUnitCost({ allInCrewCadPerHour: 0, netBankM3PerHour: 30 }).unitCostCad).toBe(0)
  })

  it.each([-1, NaN, Infinity])('rejects invalid prices: %s', (price) => {
    expect(
      calculateMaterialUnitCost({
        quoteUnit: 'tonne',
        priceCad: price,
        tonnesPerCompactedM3: 2.2,
        looseM3PerCompactedM3: null,
      }).valid,
    ).toBe(false)
    expect(
      calculateTruckCycleUnitCost({ allInRateCadPerHour: price, cycleMinutes: 40, compactedPayloadM3: 12 }).valid,
    ).toBe(false)
    expect(calculateEquipmentUnitCost({ allInCrewCadPerHour: price, netBankM3PerHour: 30 }).valid).toBe(false)
  })

  it('refuses numeric overflow instead of returning an infinite price', () => {
    expect(
      calculateMaterialUnitCost({
        quoteUnit: 'tonne',
        priceCad: Number.MAX_VALUE,
        tonnesPerCompactedM3: 2,
        looseM3PerCompactedM3: null,
      }).unitCostCad,
    ).toBeNull()
    expect(
      calculateTruckCycleUnitCost({ allInRateCadPerHour: Number.MAX_VALUE, cycleMinutes: 120, compactedPayloadM3: 1 })
        .unitCostCad,
    ).toBeNull()
    expect(
      calculateEquipmentUnitCost({ allInCrewCadPerHour: Number.MAX_VALUE, netBankM3PerHour: 0.5 }).unitCostCad,
    ).toBeNull()
  })
})
