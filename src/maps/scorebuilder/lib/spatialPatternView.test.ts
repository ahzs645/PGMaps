import { describe, expect, it } from 'vitest'
import type { GlobalMoranResult } from './spatialAutocorrelation'
import {
  CLUSTER_COLORS,
  clusterFillColors,
  clusterMapCounts,
  describeGlobalPattern,
  describeResidualPattern,
  formatPermutationP,
} from './spatialPatternView'

function moran(I: number, pPermutation: number): GlobalMoranResult {
  return {
    n: 50,
    I,
    expected: -1 / 49,
    varianceNormality: 0.01,
    zNormality: 0,
    pNormality: 0.5,
    varianceRandomisation: 0.01,
    zRandomisation: 0,
    pRandomisation: 0.5,
    permutations: 999,
    pPermutation,
  }
}

describe('spatial pattern view', () => {
  it('colours every drawn region, a region the run left out as not analysed', () => {
    const byId = new Map([
      ['a', 'HH' as const],
      ['b', 'ns' as const],
    ])
    expect(clusterFillColors(['a', 'b', 'c'], byId)).toEqual({
      a: CLUSTER_COLORS.HH,
      b: CLUSTER_COLORS.ns,
      c: CLUSTER_COLORS.none,
    })
    expect(clusterMapCounts(['a', 'b', 'c'], byId)).toEqual({ HH: 1, LL: 0, HL: 0, LH: 0, ns: 1, none: 1 })
  })

  it('writes the permutation floor as an inequality', () => {
    expect(formatPermutationP(0.001, 999)).toBe('p ≤ 0.001')
    expect(formatPermutationP(0.004, 999)).toBe('p = 0.004')
    expect(formatPermutationP(0.21, 999)).toBe('p = 0.21')
    expect(formatPermutationP(Number.NaN, 0)).toBe('p not tested')
  })

  it('reads a global Moran in one plain line', () => {
    expect(describeGlobalPattern(moran(0.42, 0.001))).toMatch(/^Clustered: .*Moran's I 0\.42, p ≤ 0\.001/)
    expect(describeGlobalPattern(moran(-0.3, 0.01))).toMatch(/^Dispersed/)
    expect(describeGlobalPattern(moran(0.05, 0.3))).toMatch(/^No clear spatial pattern/)
    expect(describeResidualPattern(moran(0.31, 0.002))).toMatch(
      /relationship differs by place, and because neighbouring regions are alike, r overstates the evidence/,
    )
    expect(describeResidualPattern(moran(0.02, 0.4))).toMatch(/^Residuals show no clear spatial pattern/)
  })
})
