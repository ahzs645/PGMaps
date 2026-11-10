import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertExpectedDifferences,
  compareNative,
  type NativeEvidence,
} from '../../../scripts/forestry-castor/native-reference/compare'

const evidence = JSON.parse(
  readFileSync(
    process.env.CASTOR_NATIVE_OUTPUT ?? resolve('scripts/forestry-castor/native-reference/native-output.json'),
    'utf8',
  ),
) as NativeEvidence
const comparisons = compareNative(evidence)

describe('actual pinned R/SpaDES multi-period reference', () => {
  it('covers every reviewed native value and explicitly explained difference', () => {
    expect(comparisons).toHaveLength(13)
    expect(comparisons.reduce((sum, result) => sum + result.comparisons, 0)).toBe(4492)
    expect(comparisons.reduce((sum, result) => sum + result.differences.length, 0)).toBe(482)
  })

  for (const comparison of comparisons) {
    it(`matches the reviewed native comparison: ${comparison.id}`, () => {
      const source = evidence.cases.find((entry) => entry.id === comparison.id)!
      expect(source.snapshots.map((snapshot) => [snapshot.period, snapshot.phase])).toEqual([
        [0, 'initial'],
        [1, 'before'],
        [1, 'after'],
        [2, 'before'],
        [2, 'after'],
        [3, 'before'],
        [3, 'after'],
      ])
      expect(comparison.sourceError).toBeNull()
      expect(comparison.comparisons).toBeGreaterThan(50)
      assertExpectedDifferences([comparison])
    })
  }

  it('rejects stale native input evidence instead of silently comparing other inputs', () => {
    expect(() => compareNative({ ...evidence, casesSha256: 'stale' })).toThrow('these exact inputs')
  })

  it('rejects an incomplete native run', () => {
    expect(() => compareNative({ ...evidence, cases: evidence.cases.slice(1) })).toThrow('Every fixture')
  })

  it('rejects a changed native runtime or numerical package version', () => {
    expect(() => compareNative({ ...evidence, R: '4.6.0' })).toThrow('reviewed R runtime')
    expect(() => compareNative({ ...evidence, packages: { ...evidence.packages, RSQLite: 'changed' } })).toThrow(
      'Native package version: RSQLite',
    )
  })

  it('rejects missing source provenance', () => {
    expect(() => compareNative({ ...evidence, sources: {} })).toThrow()
  })

  it('rejects a missing period snapshot', () => {
    const changed = structuredClone(evidence)
    changed.cases[0].snapshots.pop()
    expect(() => compareNative(changed)).toThrow('missing or out-of-order snapshots')
  })

  it('rejects reordered or missing snapshot pixels', () => {
    const changed = structuredClone(evidence)
    changed.cases[0].snapshots[0].pixels.reverse()
    expect(() => compareNative(changed)).toThrow('snapshot pixel order')
  })

  it('rejects incomplete output rasters', () => {
    const changed = structuredClone(evidence)
    changed.cases[0].snapshots[0].harvestYear.pop()
    expect(() => compareNative(changed)).toThrow('raster length')
  })

  it('rejects nonfinite numerical evidence', () => {
    const changed = structuredClone(evidence)
    changed.cases[0].snapshots[0].pixels[0].height = Number.NaN
    expect(() => compareNative(changed)).toThrow('nonfinite value')
  })

  it('fails on an unexplained native numerical change', () => {
    const changed = structuredClone(evidence)
    changed.cases[0].snapshots[2].pixels[0].age += 0.01
    expect(() => assertExpectedDifferences(compareNative(changed))).toThrow()
  })
})
