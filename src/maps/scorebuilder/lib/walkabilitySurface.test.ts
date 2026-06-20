import { describe, expect, it } from 'vitest'
import {
  HEATMAP_REPORT_FIDELITY_OPTIONS,
  WALKABILITY_REPORT_FACTOR_REFS,
  isFactorDroppedByOptions,
} from '@/maps/pgdata/walkabilityFactors'
import {
  buildSourceGridFactorWeights,
  createDefaultWalkabilitySurfaceTuning,
  resolveWalkabilitySurfaceModel,
} from './walkabilitySurface'

describe('walkability factor model', () => {
  it('exposes all 44 report factor references', () => {
    expect(WALKABILITY_REPORT_FACTOR_REFS).toHaveLength(44)
    // F5 is intentionally absent in the 2017 report factor set.
    expect(WALKABILITY_REPORT_FACTOR_REFS).not.toContain('F5')
    expect(WALKABILITY_REPORT_FACTOR_REFS).toContain('A0')
    expect(WALKABILITY_REPORT_FACTOR_REFS).toContain('G5')
  })
})

describe('buildSourceGridFactorWeights', () => {
  it('returns all-zero factor weights when no metric weights are given', () => {
    const weights = buildSourceGridFactorWeights(undefined)
    expect(Object.keys(weights)).toHaveLength(44)
    expect(Object.values(weights).every((value) => value === 0)).toBe(true)
  })

  it('projects a single metric onto its report factors, normalized to 2x', () => {
    // sidewalkDensity stands in for G1 + G5.
    const weights = buildSourceGridFactorWeights({ sidewalkDensity: 20 })
    expect(weights.G1).toBe(2)
    expect(weights.G5).toBe(2)
    expect(weights.F0).toBe(0)
  })

  it('leaves factors at zero for metrics with no report mapping', () => {
    const weights = buildSourceGridFactorWeights({ populationDensity: 50 })
    expect(Object.values(weights).every((value) => value === 0)).toBe(true)
  })

  it('accumulates contributions from metrics that share a factor', () => {
    const weights = buildSourceGridFactorWeights({ walkabilityCrossingDensity: 10, class3CrosswalkDensity: 10 })
    // Both map to F0, so it should be the strongest factor (normalized to 2x).
    expect(weights.F0).toBe(2)
  })
})

describe('resolveWalkabilitySurfaceModel', () => {
  it('derives factor weights from metric weights when there is no tuning', () => {
    const resolved = resolveWalkabilitySurfaceModel(undefined, { sidewalkDensity: 20 })
    expect(resolved.options).toEqual(HEATMAP_REPORT_FIDELITY_OPTIONS)
    expect(resolved.factorWeights.G1).toBe(2)
  })

  it('derives from metric weights while direct control is disabled', () => {
    const tuning = createDefaultWalkabilitySurfaceTuning()
    const resolved = resolveWalkabilitySurfaceModel(tuning, { sidewalkDensity: 20 })
    // The tuning factor weights (all 1) are ignored; the derived projection wins.
    expect(resolved.factorWeights.G1).toBe(2)
    expect(resolved.factorWeights.F0).toBe(0)
  })

  it('uses the direct factor weights and options when enabled', () => {
    const tuning = {
      ...createDefaultWalkabilitySurfaceTuning(),
      enabled: true,
      factorWeights: { ...createDefaultWalkabilitySurfaceTuning().factorWeights, F0: 0.5 },
      options: { ...HEATMAP_REPORT_FIDELITY_OPTIONS, dropPopAge: false },
    }
    const resolved = resolveWalkabilitySurfaceModel(tuning, { sidewalkDensity: 999 })
    expect(resolved.factorWeights.F0).toBe(0.5)
    expect(resolved.factorWeights.G1).toBe(1)
    expect(resolved.options.dropPopAge).toBe(false)
  })
})

describe('isFactorDroppedByOptions', () => {
  it('drops population/age factors under report fidelity', () => {
    expect(isFactorDroppedByOptions('F2', HEATMAP_REPORT_FIDELITY_OPTIONS)).toBe(true)
    expect(isFactorDroppedByOptions('F7', HEATMAP_REPORT_FIDELITY_OPTIONS)).toBe(true)
    expect(isFactorDroppedByOptions('G1', HEATMAP_REPORT_FIDELITY_OPTIONS)).toBe(false)
  })
})

describe('createDefaultWalkabilitySurfaceTuning', () => {
  it('defaults to disabled, all factors at report weight, report-fidelity options', () => {
    const tuning = createDefaultWalkabilitySurfaceTuning()
    expect(tuning.enabled).toBe(false)
    expect(tuning.options).toEqual(HEATMAP_REPORT_FIDELITY_OPTIONS)
    expect(Object.values(tuning.factorWeights).every((value) => value === 1)).toBe(true)
  })
})
