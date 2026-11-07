import { describe, expect, it } from 'vitest'
import type { GroundMaterial, MaterialVolumeFactorConvention } from './engineeringTypes'
import {
  convertMaterialVolumeFactor,
  createMaterialVolumeFactorProvenance,
  materialCompactionFactorPatch,
  parseMaterialVolumeFactorProvenance,
} from './materialFactors'

describe('explicit material volume factor conventions', () => {
  it('leaves compacted per bank unchanged and inverts bank per compacted without rounding', () => {
    expect(convertMaterialVolumeFactor(0.8, 'compacted-per-bank')).toBe(0.8)
    expect(convertMaterialVolumeFactor(0.8, 'bank-per-compacted')).toBe(1.25)
    expect(convertMaterialVolumeFactor(1.1, 'bank-per-compacted')).toBe(1 / 1.1)
    expect(convertMaterialVolumeFactor(1 / 1.1, 'bank-per-compacted')).toBeCloseTo(1.1, 14)
    // A convention error changes 100 bank m³ from 125 compacted m³ to 80 m³.
    expect(100 * convertMaterialVolumeFactor(0.8, 'bank-per-compacted')).toBe(125)
    expect(100 * convertMaterialVolumeFactor(0.8, 'compacted-per-bank')).toBe(80)
  })

  it.each([0, -1, NaN, Infinity, -Infinity])('rejects invalid entered ratio %s', (factor) => {
    expect(() => convertMaterialVolumeFactor(factor, 'compacted-per-bank')).toThrow(/finite positive/)
    expect(() => convertMaterialVolumeFactor(factor, 'bank-per-compacted')).toThrow(/finite positive/)
  })

  it('rejects an unknown convention and reciprocal overflow', () => {
    expect(() => convertMaterialVolumeFactor(1, 'loose-per-bank' as MaterialVolumeFactorConvention)).toThrow(
      /convention/,
    )
    expect(() => convertMaterialVolumeFactor(Number.MIN_VALUE, 'bank-per-compacted')).toThrow(/finite positive/)
  })

  it('keeps conversion evidence explicit and enforces the existing saved material range', () => {
    expect(createMaterialVolumeFactorProvenance(0.8, 'bank-per-compacted', '  Assumed ratio, review p. 242  ')).toEqual(
      {
        convention: 'bank-per-compacted',
        enteredFactor: 0.8,
        canonicalFactor: 1.25,
        source: 'Assumed ratio, review p. 242',
      },
    )
    expect(createMaterialVolumeFactorProvenance(1, 'compacted-per-bank', ' ')).not.toHaveProperty('source')
    expect(convertMaterialVolumeFactor(100, 'bank-per-compacted')).toBe(0.01)
    expect(() => createMaterialVolumeFactorProvenance(100, 'bank-per-compacted')).toThrow(/between 0.1 and 2/)
  })

  it.each([
    null,
    [],
    { convention: 'unknown', enteredFactor: 1, canonicalFactor: 1 },
    { convention: 'bank-per-compacted', enteredFactor: 0, canonicalFactor: 1 },
    { convention: 'bank-per-compacted', enteredFactor: Infinity, canonicalFactor: 1 },
    { convention: 'bank-per-compacted', enteredFactor: 0.8, canonicalFactor: NaN },
    { convention: 'bank-per-compacted', enteredFactor: 0.8, canonicalFactor: 0.8 },
    { convention: 'bank-per-compacted', enteredFactor: 0.8, canonicalFactor: 1.25, source: 123 },
    { convention: 'bank-per-compacted', enteredFactor: 0.8, canonicalFactor: 1.25, source: 'x'.repeat(501) },
  ])('rejects invalid or internally inconsistent evidence %#', (raw) => {
    expect(() => parseMaterialVolumeFactorProvenance(raw, 1.25)).toThrow(/volume factor/i)
  })

  it('rejects evidence that disagrees with the material and clears it on a changed direct edit', () => {
    const evidence = createMaterialVolumeFactorProvenance(0.8, 'bank-per-compacted')
    expect(() => parseMaterialVolumeFactorProvenance(evidence, 0.8)).toThrow(/inconsistent/)
    const material: GroundMaterial = {
      id: 'soil',
      name: 'Soil',
      color: '#806040',
      cutRate: 5,
      reusableFraction: 0.8,
      compactionFactor: 1.25,
      volumeFactorProvenance: evidence,
    }
    expect(materialCompactionFactorPatch(material, 1.25).volumeFactorProvenance).toBe(evidence)
    expect(materialCompactionFactorPatch(material, 0.9)).toEqual({
      compactionFactor: 0.9,
      volumeFactorProvenance: undefined,
    })
    expect(material.volumeFactorProvenance).toBe(evidence)
  })
})

describe('independent area balances for the quoted tutorial inputs', () => {
  // Values transcribed from the supplied review, not a direct RoadEng execution.
  // Cut factor 1, reusable fraction 1; bank and compacted areas are different states.
  it('requires 2.36 bank m² for cut 9.3 m², fill 10.6 m² and bank / compacted 1.1', () => {
    const canonical = convertMaterialVolumeFactor(1.1, 'bank-per-compacted')
    const usableCompactedCutArea = 9.3 * canonical
    const compactedDeficit = 10.6 - usableCompactedCutArea
    expect(compactedDeficit / canonical).toBeCloseTo(2.36, 12)
    expect(10.6 * 1.1 - 9.3).toBeCloseTo(2.36, 12)
  })

  it('leaves 0.82 bank m² for the same areas and bank / compacted 0.8', () => {
    const canonical = convertMaterialVolumeFactor(0.8, 'bank-per-compacted')
    const usableCompactedCutArea = 9.3 * canonical
    const compactedSurplus = usableCompactedCutArea - 10.6
    expect(compactedSurplus / canonical).toBeCloseTo(0.82, 12)
    expect(9.3 - 10.6 * 0.8).toBeCloseTo(0.82, 12)
  })
})
