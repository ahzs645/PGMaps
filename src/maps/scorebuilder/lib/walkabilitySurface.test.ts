import { describe, expect, it } from 'vitest'
import {
  HEATMAP_REPORT_FIDELITY_OPTIONS,
  WALKABILITY_REPORT_FACTOR_REFS,
  isFactorDroppedByOptions,
} from '@/maps/pgdata/walkabilityFactors'
import {
  buildSourceGridFactorWeights,
  createDefaultWalkabilitySurfaceTuning,
  encodeWalkabilitySurfaceTuning,
  parseWalkabilitySurfaceTuning,
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

  it('projects a single metric onto its report factors at the report weight', () => {
    // sidewalkDensity stands in for G1 + G5, which split it evenly.
    const weights = buildSourceGridFactorWeights({ sidewalkDensity: 20 })
    expect(weights.G1).toBeCloseTo(1)
    expect(weights.G5).toBeCloseTo(1)
    expect(weights.F0).toBe(0)
  })

  it('leaves factors at zero for metrics with no report mapping', () => {
    const weights = buildSourceGridFactorWeights({ populationDensity: 50 })
    expect(Object.values(weights).every((value) => value === 0)).toBe(true)
  })

  it('accumulates contributions from metrics that share a factor', () => {
    const weights = buildSourceGridFactorWeights({ walkabilityCrossingDensity: 10, class3CrosswalkDensity: 10 })
    // Both map to F0, the only contributing factor, so it carries the full weight.
    expect(weights.F0).toBeCloseTo(1)
    expect(weights.G1).toBe(0)
  })

  it('keeps the contributing factors on the report weight scale', () => {
    // The generated pedestrian-network example: one dominant metric (sidewalk
    // density) alongside a metric spread thinly over 24 POI factors. Scaling to
    // the strongest factor used to collapse the total to ~8 of the report's 44,
    // dropping every cell into the lowest MI band.
    const weights = buildSourceGridFactorWeights({
      transitStopDensity: 10,
      sidewalkDensity: 20,
      walkwayDensity: 12,
      walkabilityIntersectionDensity: 12,
      walkabilityCrossingDensity: 10,
      childcareDensity: 8,
      walkabilityPoiDensity: 10,
      class3CrosswalkDensity: -4,
      pedestrianCrashDensity: -4,
      parkWalk10Access: 10,
    })
    const contributing = WALKABILITY_REPORT_FACTOR_REFS.filter((ref) => weights[ref] > 0)
    const total = contributing.reduce((sum, ref) => sum + weights[ref], 0)
    expect(contributing.length).toBeGreaterThan(30)
    expect(total / contributing.length).toBeCloseTo(1, 5)
    // Relative ordering still follows the recipe.
    expect(weights.G1).toBeGreaterThan(weights.A0)
    expect(Object.values(weights).every((value) => value <= 2)).toBe(true)
  })
})

describe('resolveWalkabilitySurfaceModel', () => {
  it('derives factor weights from metric weights when there is no tuning', () => {
    const resolved = resolveWalkabilitySurfaceModel(undefined, { sidewalkDensity: 20 })
    expect(resolved.options).toEqual(HEATMAP_REPORT_FIDELITY_OPTIONS)
    expect(resolved.factorWeights.G1).toBeCloseTo(1)
  })

  it('derives from metric weights while direct control is disabled', () => {
    const tuning = createDefaultWalkabilitySurfaceTuning()
    const resolved = resolveWalkabilitySurfaceModel(tuning, { sidewalkDensity: 20 })
    // The tuning factor weights (all 1) are ignored; the derived projection wins.
    expect(resolved.factorWeights.G1).toBeCloseTo(1)
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

describe('walkability surface URL serialization', () => {
  it('encodes nothing while direct control is off', () => {
    expect(encodeWalkabilitySurfaceTuning(createDefaultWalkabilitySurfaceTuning())).toBeNull()
  })

  it('parses an absent token back to the default (disabled) tuning', () => {
    expect(parseWalkabilitySurfaceTuning(null)).toEqual(createDefaultWalkabilitySurfaceTuning())
  })

  it('round-trips an enabled tuning at slider resolution', () => {
    const tuning = {
      ...createDefaultWalkabilitySurfaceTuning(),
      enabled: true,
      options: { ...HEATMAP_REPORT_FIDELITY_OPTIONS, tightBuffer: true, dropPopAge: false },
      factorWeights: { ...createDefaultWalkabilitySurfaceTuning().factorWeights, A0: 0, F0: 0.5, G5: 2 },
    }
    const token = encodeWalkabilitySurfaceTuning(tuning)
    expect(token).not.toBeNull()
    const restored = parseWalkabilitySurfaceTuning(token)
    expect(restored.enabled).toBe(true)
    expect(restored.options).toEqual(tuning.options)
    expect(restored.factorWeights.A0).toBe(0)
    expect(restored.factorWeights.F0).toBe(0.5)
    expect(restored.factorWeights.G5).toBe(2)
    expect(restored.factorWeights.B0).toBe(1)
  })

  it('clamps malformed/out-of-range tokens', () => {
    const restored = parseWalkabilitySurfaceTuning('')
    expect(restored).toEqual(createDefaultWalkabilitySurfaceTuning())
  })
})
