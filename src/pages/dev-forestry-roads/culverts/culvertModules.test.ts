import { describe, expect, it } from 'vitest'
import type { Culvert } from '../engineeringTypes'
import { fullPipeCapacity } from '../hydrology'
import { culvertChecks, requiredCoverM, requiredEmbedmentM, suggestedCrossDrainSkew } from './culvertChecks'
import { classifyCulvert } from './culvertClass'
import {
  circularCriticalDepth,
  culvertFullFlowCapacity,
  culvertManningN,
  hasHydraulicOptions,
  inletControlHeadwater,
} from './culvertHydraulics'
import { CULVERT_OPTION_KEYS, culvertOptionProblems, parseCulvertOptions, withCulvertOption } from './culvertOptions'
import { barrelOpeningArea, culvertPurposeOf, culvertSizeText, equivalentDiameterM } from './culvertShape'
import { crossDrainSpacingM, STOCK_DIAMETERS_M } from './engineeringManual'

const culvert = (patch: Partial<Culvert> = {}): Culvert => ({
  id: 'c1',
  name: 'Culvert 1',
  kind: 'stream',
  chainage: 100,
  skewDegrees: 0,
  lengthM: 12,
  diameterM: 0.8,
  inletInvertM: 803.4,
  outletInvertM: 803.1,
  minCoverM: 0.6,
  unitCost: 400,
  fixedCost: 1500,
  ...patch,
})

describe('a culvert’s opening', () => {
  it('is one round pipe when no shape field is set', () => {
    expect(barrelOpeningArea(culvert())).toEqual({ areaM2: (Math.PI * 0.8 ** 2) / 4, approximate: false })
    expect(culvertSizeText(culvert())).toBe('Ø 0.8 m')
    expect(culvertSizeText(culvert({ barrels: 2, diameterM: 0.9 }))).toBe('2 × Ø 0.9 m')
    expect(culvertPurposeOf({})).toBe('cross-drain')
  })
  it('reads the rise from the diameter and the width from the span for another shape', () => {
    const box = culvert({ shape: 'box', diameterM: 1.2, spanM: 2.4 })
    expect(barrelOpeningArea(box)).toEqual({ areaM2: 2.88, approximate: false })
    expect(culvertSizeText(box)).toBe('Box 2.4 × 1.2 m')
    expect(equivalentDiameterM(box)).toBeCloseTo(1.915, 3)
  })
  it('uses an arch’s entered end area, and says an ellipse is approximate without one', () => {
    const arch = culvert({ shape: 'pipe-arch', diameterM: 1.5, spanM: 2.1 })
    expect(barrelOpeningArea(arch)).toEqual({ areaM2: (Math.PI * 2.1 * 1.5) / 4, approximate: true })
    expect(barrelOpeningArea({ ...arch, openingAreaM2: 2.6 })).toEqual({ areaM2: 2.6, approximate: false })
  })
})

describe('the optional culvert fields', () => {
  it('read back from a project file, and stay absent when absent', () => {
    expect(parseCulvertOptions({})).toEqual({})
    const all = {
      shape: 'box',
      spanM: 2.4,
      openingAreaM2: 2.9,
      barrels: 2,
      material: 'concrete',
      embedmentM: 0.3,
      inletEdge: 'headwall',
      service: 'temporary',
    }
    expect(parseCulvertOptions(all)).toEqual(all)
    expect(Object.keys(parseCulvertOptions(all)).sort()).toEqual([...CULVERT_OPTION_KEYS].sort())
  })
  it('refuse a value outside its limits or its list', () => {
    expect(() => parseCulvertOptions({ shape: 'oval' })).toThrow('Culvert shape')
    expect(() => parseCulvertOptions({ barrels: 2.5 })).toThrow('whole number')
    expect(() => parseCulvertOptions({ barrels: 9 })).toThrow('between 1 and 6')
    expect(() => parseCulvertOptions({ material: 'wood' })).toThrow('Culvert material')
    expect(() => parseCulvertOptions({ embedmentM: -1 })).toThrow('Culvert embedment')
  })
  it('name what is wrong with an entered set', () => {
    expect(culvertOptionProblems(culvert())).toEqual([])
    expect(culvertOptionProblems(culvert({ embedmentM: 0.9 }))[0]).toMatchObject({ field: 'embedmentM' })
    expect(
      culvertOptionProblems(culvert({ shape: 'open-bottom-arch', embedmentM: 0.2 })).map((p) => p.message),
    ).toContain('an open-bottom arch has no floor to embed; clear the embedment.')
  })
  it('remove the key when a field goes back to its default', () => {
    const base = culvert()
    const set = withCulvertOption(base, 'barrels', 2)
    expect(set.barrels).toBe(2)
    expect(withCulvertOption(set, 'barrels', undefined)).toEqual(base)
    expect('barrels' in withCulvertOption(set, 'barrels', undefined)).toBe(false)
  })
})

describe('major culvert', () => {
  it('is a round pipe of 2,000 mm or more', () => {
    expect(classifyCulvert(culvert({ diameterM: 2 }), null).major).toBe(true)
    expect(classifyCulvert(culvert({ diameterM: 2 }), null).summary).toContain('diameter 2 m')
  })
  it('is not confirmed minor until the design discharge is known', () => {
    const unknown = classifyCulvert(culvert({ diameterM: 1.8 }), null)
    expect(unknown.major).toBeNull()
    expect(unknown.summary).toBe('Not a major culvert by size; the design discharge is not known')
    expect(classifyCulvert(culvert({ diameterM: 1.8 }), 2.5).major).toBe(false)
  })
  it('follows the opening area, the arch span and the design discharge too', () => {
    // A 1.8 m pipe is 2.54 m²; a 2.4 × 1.5 m box is 3.6 m².
    expect(classifyCulvert(culvert({ shape: 'box', diameterM: 1.5, spanM: 2.4 }), 1).major).toBe(true)
    expect(
      classifyCulvert(culvert({ shape: 'pipe-arch', diameterM: 1.2, spanM: 2.2, openingAreaM2: 2 }), 1).major,
    ).toBe(true)
    // The glossary's span is "over 2,130 mm": 2.13 m itself is not.
    expect(
      classifyCulvert(culvert({ shape: 'pipe-arch', diameterM: 1.2, spanM: 2.13, openingAreaM2: 2 }), 1).major,
    ).toBe(false)
    expect(classifyCulvert(culvert({ diameterM: 1.2 }), 6).major).toBe(true)
    expect(classifyCulvert(culvert({ diameterM: 1.2 }), 5.99).major).toBe(false)
  })
})

describe('barrel-full capacity', () => {
  it('is the drainage run’s figure for a plain round pipe, to the last bit', () => {
    for (const [d, slope] of [
      [0.6, 0.05],
      [1.2, 0.02],
      [1.8, 0.004],
    ]) {
      const c = culvert({ diameterM: d })
      expect(hasHydraulicOptions(c)).toBe(false)
      expect(culvertFullFlowCapacity(c, slope, 0.024).capacityM3s).toBe(fullPipeCapacity(d, slope, 0.024))
    }
  })
  it('takes the material’s roughness and every barrel', () => {
    expect(culvertManningN(culvert(), 0.024)).toEqual({ n: 0.024, fromMaterial: false })
    expect(culvertManningN(culvert({ material: 'smooth-plastic' }), 0.024)).toEqual({ n: 0.01, fromMaterial: true })
    const one = fullPipeCapacity(0.8, 0.02, 0.024)
    expect(culvertFullFlowCapacity(culvert({ barrels: 3 }), 0.02, 0.024).capacityM3s).toBeCloseTo(3 * one, 12)
    expect(culvertFullFlowCapacity(culvert({ material: 'concrete' }), 0.02, 0.024).capacityM3s).toBeCloseTo(
      fullPipeCapacity(0.8, 0.02, 0.012),
      12,
    )
  })
  it('reads a box by its own wetted perimeter, and says an arch is approximate', () => {
    // 2.4 × 1.2 m box at 1 %, n 0.012: A 2.88, P 7.2, R 0.4 → (1/0.012)·2.88·0.4^(2/3)·0.1 = 13.03 m³/s.
    const box = culvertFullFlowCapacity(
      culvert({ shape: 'box', diameterM: 1.2, spanM: 2.4, material: 'concrete' }),
      0.01,
      0.024,
    )
    expect(box.capacityM3s).toBeCloseTo(13.03, 2)
    expect(box.approximate).toBe(false)
    expect(
      culvertFullFlowCapacity(culvert({ shape: 'pipe-arch', diameterM: 1.5, spanM: 2.1 }), 0.01, 0.024).approximate,
    ).toBe(true)
  })
})

describe('inlet-control headwater by HDS-5’s equations', () => {
  it('finds the critical depth where the Froude number is one', () => {
    const d = 1.8,
      q = 4.04,
      yc = circularCriticalDepth(q, d)
    const theta = 2 * Math.acos(1 - (2 * yc) / d),
      area = (d * d * (theta - Math.sin(theta))) / 8,
      top = d * Math.sin(theta / 2)
    expect((q * q * top) / (9.81 * area ** 3)).toBeCloseTo(1, 6)
    expect(circularCriticalDepth(0, d)).toBe(0)
  })
  it('reproduces the Engineering Manual’s round-culvert training example', () => {
    // Q100 4.04 m³/s, projecting corrugated pipe. The example reads HW/D 0.85 for 1800 mm from the
    // nomograph, and finds that 1200 mm fails HW/D ≤ 1.0.
    const large = inletControlHeadwater(culvert({ diameterM: 1.8 }), 4.04)!
    expect(large.regime).toBe('unsubmerged')
    expect(large.hwOverD).toBeGreaterThan(0.83)
    expect(large.hwOverD).toBeLessThan(0.89)
    expect(large.edge).toBe('projecting')
    const small = inletControlHeadwater(culvert({ diameterM: 1.2 }), 4.04)!
    expect(small.regime).toBe('submerged')
    expect(small.hwOverD).toBeGreaterThan(1)
  })
  it('rises with flow without a jump where the equations hand over', () => {
    const c = culvert({ diameterM: 1 })
    let previous = 0
    for (let q = 0.05; q <= 3; q += 0.05) {
      const hw = inletControlHeadwater(c, q)!.hwOverD
      expect(hw).toBeGreaterThan(previous)
      expect(hw - previous).toBeLessThan(0.25)
      previous = hw
    }
  })
  it('lowers the headwater with a headwall, and shares the flow between barrels', () => {
    const projecting = inletControlHeadwater(culvert({ diameterM: 1 }), 1.2)!
    const headwall = inletControlHeadwater(culvert({ diameterM: 1, inletEdge: 'headwall' }), 1.2)!
    expect(headwall.hwOverD).toBeLessThan(projecting.hwOverD)
    const two = inletControlHeadwater(culvert({ diameterM: 1, barrels: 2 }), 2.4)!
    expect(two.flowPerBarrelM3s).toBeCloseTo(1.2, 12)
    expect(two.hwOverD).toBeCloseTo(projecting.hwOverD, 12)
  })
  it('gives nothing for a shape or an inlet whose coefficients are not held', () => {
    expect(inletControlHeadwater(culvert({ shape: 'box', spanM: 2 }), 1)).toBeNull()
    expect(inletControlHeadwater(culvert({ material: 'concrete', inletEdge: 'mitered' }), 1)).toBeNull()
  })
})

describe('the Engineering Manual’s rules', () => {
  it('require cover of 600 mm or half the diameter over a stream pipe, 300 mm or half over a cross-drain', () => {
    expect(requiredCoverM({ diameterM: 0.8, kind: 'stream' })).toBe(0.6)
    expect(requiredCoverM({ diameterM: 1.6, kind: 'stream' })).toBe(0.8)
    expect(requiredCoverM({ diameterM: 0.5, kind: 'cross-drain' })).toBe(0.3)
    expect(requiredCoverM({ diameterM: 0.8, kind: 'cross-drain' })).toBe(0.4)
    expect(requiredCoverM({ diameterM: 0.5 })).toBe(0.3)
  })
  it('suggest 3° of cross-drain skew for each 1 % of road grade over 3 %, to 45°', () => {
    expect(suggestedCrossDrainSkew(2)).toBe(0)
    expect(suggestedCrossDrainSkew(7)).toBe(12)
    expect(suggestedCrossDrainSkew(-7)).toBe(12)
    expect(suggestedCrossDrainSkew(20)).toBe(45)
  })
  it('space cross-drains by road gradient and ditch soil, a boundary taking the steeper class', () => {
    expect(crossDrainSpacingM(2)).toEqual({ slight: 350, moderate: 300, high: 200 })
    expect(crossDrainSpacingM(3)).toEqual({ slight: 300, moderate: 200, high: 150 })
    expect(crossDrainSpacingM(-8)).toEqual({ slight: 250, moderate: 150, high: 100 })
    expect(crossDrainSpacingM(11.9)).toEqual({ slight: 200, moderate: 100, high: 75 })
    expect(crossDrainSpacingM(18)).toEqual({ slight: 150, moderate: 100, high: 100 })
  })
  it('embed a round pipe 40 % of its diameter or 0.6 m, a box or pipe arch 20 % of its rise', () => {
    expect(requiredEmbedmentM({ diameterM: 1.2 })).toBe(0.6)
    expect(requiredEmbedmentM({ diameterM: 2 })).toBeCloseTo(0.8, 12)
    expect(requiredEmbedmentM({ diameterM: 1.5, shape: 'box' })).toBeCloseTo(0.3, 12)
    expect(requiredEmbedmentM({ diameterM: 1.5, shape: 'open-bottom-arch' })).toBeNull()
  })
  it('tabulate the stock sizes of Table 3-13', () => {
    expect(STOCK_DIAMETERS_M).toEqual([0.4, 0.5, 0.6, 0.8, 0.9, 1.0, 1.2, 1.4, 1.6, 1.8])
  })
})

describe('the checks on one culvert', () => {
  const geometry = { coverM: 0.75, gradePercent: -2.5, requiredLengthM: 11.2 }
  const flow = { designFlowM3s: 0.4, capacityM3s: 0.9, adequate: true, slope: 0.025, slopeAssumed: false }
  const run = (patch: Partial<Culvert> = {}, more: Partial<Parameters<typeof culvertChecks>[0]> = {}) => {
    const checks = culvertChecks({
      culvert: culvert(patch),
      analysis: geometry,
      roadGradePercent: 7,
      drainage: { state: 'current', check: flow, rainfallMmPerHr: 25 },
      ...more,
    })
    return Object.fromEntries(checks.map((check) => [check.id, check]))
  }
  it('are met for a stream pipe with cover, fall, length, capacity and headwater in range', () => {
    const checks = run()
    for (const id of ['length', 'cover', 'gradient', 'capacity', 'headwater'])
      expect(checks[id], id).toMatchObject({ state: 'met' })
    expect(checks.cover.judgedOn).toContain('here 0.6 m')
    expect(checks.cover.locator).toBe('EM 3.5.5.2, p. 171')
    // A stream culvert follows its channel: no skew guidance.
    expect(checks.skew).toBeUndefined()
    expect(checks['design-flood']).toMatchObject({ state: 'note' })
    expect(checks['design-flood'].result).toContain('Q100')
    expect(checks['design-flood'].result).toContain('25 mm/h')
  })
  it('judge cover by the manual’s rule, not the entered minimum', () => {
    // 0.75 m of cover clears an entered 0.6 m, but a 1.8 m stream pipe needs half its diameter.
    const wide = run({ diameterM: 1.8 })
    expect(wide.cover).toMatchObject({ state: 'not-met', result: 'Least cover 0.75 m is under 0.9 m' })
  })
  it('fail a stream pipe steeper than 10 % and a cross-drain flatter than 1 %', () => {
    expect(run({}, { analysis: { ...geometry, gradePercent: -12 } }).gradient).toMatchObject({ state: 'not-met' })
    expect(run({ kind: 'cross-drain' }, { analysis: { ...geometry, gradePercent: -0.5 } }).gradient).toMatchObject({
      state: 'not-met',
      result: 'Falls 0.5%, under 1%',
    })
    expect(run({}, { analysis: { ...geometry, gradePercent: 1 } }).gradient.result).toBe(
      'The outlet is not below the inlet',
    )
    expect(run({}, { analysis: { ...geometry, gradePercent: -4 } }).gradient.result).toContain('outlet protection')
  })
  it('never read a missing value as met', () => {
    const blank = run({}, { analysis: { coverM: null, gradePercent: null, requiredLengthM: null } })
    for (const id of ['length', 'cover', 'gradient']) expect(blank[id], id).toMatchObject({ state: 'not-assessed' })
    for (const state of ['stale', 'not-run'] as const) {
      const none = run({}, { drainage: { state } })
      expect(none.capacity).toMatchObject({ state: 'not-assessed' })
      expect(none.headwater).toMatchObject({ state: 'not-assessed' })
    }
    expect(run({}, { drainage: { state: 'stale', check: flow } }).capacity.result).toBe(
      'The drainage check is out of date',
    )
  })
  it('note the skew and the run to the next culvert for a cross-drain, without passing or failing them', () => {
    const drain = run(
      { kind: 'cross-drain', diameterM: 0.6 },
      { adjacentRun: { lengthM: 240, to: 'Culvert 2', steepestGradePercent: -7.4 } },
    )
    expect(drain.skew).toMatchObject({
      state: 'note',
      result: 'Road grade 7% suggests 12° from square; entered 0°',
    })
    expect(drain.spacing).toMatchObject({ state: 'note' })
    expect(drain.spacing.result).toBe(
      '240 m to Culvert 2 at up to 7.4%: the manual’s maximum is 250 m on slight, 150 m on moderate and 100 m on high erosion-hazard ditch soil',
    )
  })
  it('fail an undersized pipe on capacity and on headwater', () => {
    const big = { ...flow, designFlowM3s: 2, capacityM3s: 0.9, adequate: false }
    const checks = run({}, { drainage: { state: 'current', check: big } })
    expect(checks.capacity).toMatchObject({ state: 'not-met' })
    expect(checks.headwater).toMatchObject({ state: 'not-met' })
    expect(checks.headwater.result).toMatch(/^HW\/D \d/)
  })
  it('check an embedded pipe’s depth, and leave its capacity and headwater unassessed', () => {
    const shallow = run({ diameterM: 1.6, embedmentM: 0.4 })
    expect(shallow.embedment).toMatchObject({ state: 'not-met', result: 'Embedded 0.4 m is under 0.64 m' })
    expect(shallow.capacity).toMatchObject({ state: 'not-assessed' })
    expect(shallow.headwater).toMatchObject({ state: 'not-assessed' })
    expect(run({ diameterM: 1.6, embedmentM: 0.7 }).embedment).toMatchObject({ state: 'met' })
    // A crossing record that names an embedded culvert asks for a depth that was never entered.
    expect(run({}, { embeddedStructure: true }).embedment).toMatchObject({ state: 'not-assessed' })
    expect(run().embedment).toBeUndefined()
  })
  it('say when a diameter is not a stock size, and when a culvert is temporary', () => {
    expect(run({ diameterM: 0.7 })['stock-size']).toMatchObject({ state: 'note' })
    expect(run()['stock-size']).toBeUndefined()
    expect(run({ service: 'temporary' })['design-flood'].result).toContain('Q10 peak')
  })
})
