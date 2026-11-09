import { describe, expect, it } from 'vitest'
import { culvertFallPercent, culvertScreeningCapacity, invertsForFall } from './culvertGrade'
import { fullPipeCapacity } from './hydrology'

const pipe = { lengthM: 12, diameterM: 0.6, inletInvertM: 776.414, outletInvertM: 776.414 }

describe('a culvert gradient entered instead of two inverts', () => {
  it('sets the outlet from the inlet: 5 % over a 12 m span drops 0.6 m', () => {
    const inverts = invertsForFall(pipe, 5, 'inlet')!
    expect(inverts).toEqual({ inletInvertM: 776.414, outletInvertM: 775.814 })
    expect(culvertFallPercent({ ...pipe, ...inverts })).toBeCloseTo(5, 9)
  })
  it('sets the inlet from the outlet when the outlet is the fixed end', () => {
    const inverts = invertsForFall(pipe, 5, 'outlet')!
    expect(inverts).toEqual({ inletInvertM: 777.014, outletInvertM: 776.414 })
    expect(culvertFallPercent({ ...pipe, ...inverts })).toBeCloseTo(5, 9)
  })
  it('reads a level or rising pipe as it is, and needs the held invert', () => {
    expect(culvertFallPercent(pipe)).toBe(0)
    expect(culvertFallPercent({ ...pipe, outletInvertM: 776.534 })).toBeCloseTo(-1, 9)
    expect(culvertFallPercent({ ...pipe, outletInvertM: null })).toBeNull()
    expect(invertsForFall({ ...pipe, inletInvertM: null }, 5, 'inlet')).toBeNull()
    expect(invertsForFall({ ...pipe, outletInvertM: null }, 5, 'outlet')).toBeNull()
    // The gradient reads back as entered, even from an invert with many decimals.
    const odd = { ...pipe, inletInvertM: 748.520082 }
    expect(culvertFallPercent({ ...odd, ...invertsForFall(odd, 5, 'inlet')! })).toBeCloseTo(5, 6)
    expect(invertsForFall({ ...pipe, lengthM: 7 }, 3.33, 'inlet')!.outletInvertM).toBe(776.1809)
  })
})

describe('the capacity of a pipe of that size, before a drainage run', () => {
  it('is the full-pipe Manning figure at the entered fall', () => {
    // 600 mm at 5 %, n 0.024: (1/0.024) × (π·0.6²/4) × (0.6/4)^(2/3) × √0.05 = 0.744 m³/s.
    const result = culvertScreeningCapacity({ ...pipe, outletInvertM: 775.814 }, 0.024)
    expect(result.slopeAssumed).toBe(false)
    expect(result.slope).toBeCloseTo(0.05, 9)
    expect(result.capacityM3s).toBeCloseTo(0.744, 3)
    expect(result.capacityM3s).toBeCloseTo(fullPipeCapacity(0.6, 0.05, 0.024), 12)
  })
  it("assumes the drainage run's 2 % and says so until the outlet is below the inlet", () => {
    for (const inverts of [
      { inletInvertM: 776.414, outletInvertM: 776.414 },
      { inletInvertM: null, outletInvertM: null },
      { inletInvertM: 776, outletInvertM: 776.5 },
    ]) {
      const result = culvertScreeningCapacity({ ...pipe, ...inverts }, 0.024)
      expect(result.slopeAssumed).toBe(true)
      expect(result.capacityM3s).toBeCloseTo(fullPipeCapacity(0.6, 0.02, 0.024), 12)
    }
  })
})
