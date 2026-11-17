import { describe, expect, it } from 'vitest'
import type { Culvert, CulvertProfilePoint } from '../engineeringTypes'
import { culvertChecks } from './culvertChecks'
import { culvertEndDepths, culvertHeadwater, culvertRoadLevel, templateSurfacingM } from './culvertHeadwater'
import {
  backwaterOutletControl,
  circularCriticalDepth,
  circularNormalDepth,
  entranceLossCoefficient,
  fullFlowOutletControl,
  inletControlHeadwater,
} from './culvertHydraulics'
import { OUTLET_CONTROL } from './engineeringManual'

const FT = 0.3048,
  IN = 0.0254

/**
 * HDS-5 (2012), Design Guideline 1.3, Example Problem No. 1, Culvert Design Form (p. DG1.4), worked
 * in US customary units and converted here to SI: 200 ft³/s, tailwater 3.5 ft, a 200 ft barrel on
 * 1 % (a 2 ft drop), inlet invert at 100 ft, ke 0.2 for every trial (beveled CMP, groove-end
 * concrete). The form reads dc and H off its charts and nomographs; these are the equations behind
 * them, so the figures agree to chart-reading precision.
 */
const example = (diameterIn: number, manningN: number) =>
  fullFlowOutletControl({
    diameterM: diameterIn * IN,
    barrelLengthM: 200 * FT,
    dropM: 2 * FT,
    flowPerBarrelM3s: 200 * FT ** 3,
    manningN,
    entranceLoss: 0.2,
    tailwaterM: 3.5 * FT,
  })
const inletInvertM = 100 * FT

describe('outlet control by HDS-5’s full-flow method', () => {
  it('reproduces HDS-5 Example Problem No. 1 for the concrete trials', () => {
    // 60" RCP: dc 4.1 ft, ho 4.6 ft, H 2.9 ft, outlet-control headwater elevation 105.5 ft.
    const rcp60 = example(60, 0.012)
    expect(rcp60.criticalDepthM / FT).toBeCloseTo(4.1, 0)
    expect(rcp60.outletHeadM / FT).toBeCloseTo(4.52, 2)
    expect(rcp60.outletHeadFrom).toBe('critical-and-crown')
    expect(Math.abs(rcp60.barrelLossM / FT - 2.9)).toBeLessThan(0.05)
    expect(Math.abs(inletInvertM + rcp60.headwaterM - 105.5 * FT)).toBeLessThan(0.02)
    // 54" RCP: ho 4.3 ft, H 4.7 ft, 107.0 ft.
    const rcp54 = example(54, 0.012)
    expect(Math.abs(rcp54.outletHeadM / FT - 4.3)).toBeLessThan(0.05)
    expect(Math.abs(rcp54.barrelLossM / FT - 4.7)).toBeLessThan(0.05)
    expect(Math.abs(inletInvertM + rcp54.headwaterM - 107.0 * FT)).toBeLessThan(0.02)
  })
  it('reproduces the corrugated trials to the nomograph’s reading', () => {
    // 72" CMP: dc 3.8 ft, ho 4.9 ft, H 2.6 ft, 105.5 ft. By the equation H is 2.45 ft (n 0.024).
    const cmp72 = example(72, 0.024)
    expect(Math.abs(cmp72.criticalDepthM / FT - 3.8)).toBeLessThan(0.1)
    expect(Math.abs(cmp72.outletHeadM / FT - 4.9)).toBeLessThan(0.05)
    expect(Math.abs(cmp72.barrelLossM / FT - 2.6)).toBeLessThan(0.2)
    expect(Math.abs(inletInvertM + cmp72.headwaterM - 105.5 * FT)).toBeLessThan(0.05)
    // 60" CMP: H 6.3 ft and 108.9 ft on the form; 5.94 ft and 108.46 ft by the equation. Both are
    // over the allowable 108 ft, the form's reason to try a smoother pipe.
    const cmp60 = example(60, 0.024)
    expect(Math.abs(inletInvertM + cmp60.headwaterM - 108.9 * FT)).toBeLessThan(0.15)
    expect(inletInvertM + cmp60.headwaterM).toBeGreaterThan(108 * FT)
  })
  it('starts the grade line at a tailwater higher than (dc + D)/2, and at (dc + D)/2 when none is known', () => {
    const input = {
      diameterM: 1.2,
      barrelLengthM: 15,
      dropM: 0.3,
      flowPerBarrelM3s: 1.5,
      manningN: 0.024,
      entranceLoss: 0.9,
    }
    const high = fullFlowOutletControl({ ...input, tailwaterM: 1.5 })
    expect(high).toMatchObject({ outletHeadM: 1.5, outletHeadFrom: 'tailwater', tailwaterKnown: true })
    const unknown = fullFlowOutletControl(input)
    expect(unknown.outletHeadFrom).toBe('critical-and-crown')
    expect(unknown.tailwaterKnown).toBe(false)
    expect(unknown.outletHeadM).toBeCloseTo((unknown.criticalDepthM + 1.2) / 2, 12)
    expect(high.headwaterM - unknown.headwaterM).toBeCloseTo(1.5 - unknown.outletHeadM, 12)
  })
  it('reads ke from Table C.2 by material and inlet', () => {
    expect(entranceLossCoefficient({})).toBe(0.9)
    expect(entranceLossCoefficient({ inletEdge: 'headwall' })).toBe(0.5)
    expect(entranceLossCoefficient({ inletEdge: 'mitered', material: 'smooth-plastic' })).toBe(0.7)
    expect(entranceLossCoefficient({ material: 'concrete' })).toBe(0.2)
    expect(entranceLossCoefficient({ material: 'concrete', inletEdge: 'headwall' })).toBe(0.5)
    expect(OUTLET_CONTROL.entranceLossLocator).toContain('Table C.2')
  })
})

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
  material: 'csp',
  ...patch,
})
/** A barrel under a road whose subgrade is `subgrade` m over the middle 6 m. */
const profile = (c: Culvert, subgrade: number, ground = subgrade - 1): CulvertProfilePoint[] =>
  Array.from({ length: 13 }, (_, i) => {
    const invert = c.inletInvertM! + ((c.outletInvertM! - c.inletInvertM!) * i) / 12
    return {
      distanceM: i,
      coordinate: [0, 0],
      groundElevation: ground,
      formationElevation: i >= 3 && i <= 9 ? subgrade + (i === 3 ? 0 : 0.05) : null,
      invertElevation: invert,
      crownElevation: invert + c.diameterM,
    }
  })

describe('the governing control, overtopping and the suggested size', () => {
  const geometry = { coverM: 0.75, gradePercent: -2.5, requiredLengthM: 11.2 }
  const flowOf = (designFlowM3s: number) => ({
    designFlowM3s,
    capacityM3s: 0.9,
    adequate: true,
    slope: 0.025,
    slopeAssumed: false,
  })
  const run = (c: Culvert, flow: number, subgrade: number | null, more: Record<string, unknown> = {}) =>
    Object.fromEntries(
      culvertChecks({
        culvert: c,
        analysis: { ...geometry, ...(subgrade === null ? {} : { profile: profile(c, subgrade) }) },
        roadGradePercent: 4,
        drainage: { state: 'current', check: flowOf(flow), rainfallMmPerHr: 25 },
        surfacingM: 0.3,
        ...more,
      }).map((check) => [check.id, check]),
    )

  it('governs by the higher of the inlet- and outlet-control headwater', () => {
    const c = culvert()
    const hw = culvertHeadwater({ culvert: c, flowM3s: 0.9, barrelLengthM: 12, embedded: false })
    expect(hw.inlet && hw.outlet).toBeTruthy()
    expect(hw.governing!.headwaterM).toBe(Math.max(hw.inlet!.headwaterM, hw.outlet!.headwaterM))
    expect(hw.governing!.control).toBe(hw.outlet!.headwaterM > hw.inlet!.headwaterM ? 'outlet' : 'inlet')
    // A long flat barrel puts the control at the outlet.
    const flat = culvert({ lengthM: 40, inletInvertM: 803.4, outletInvertM: 803.2 })
    const outlet = culvertHeadwater({ culvert: flat, flowM3s: 0.9, barrelLengthM: 40, embedded: false })
    expect(outlet.governing!.control).toBe('outlet')
    expect(outlet.elevationM).toBeCloseTo(803.4 + outlet.governing!.headwaterM, 12)
  })
  it('reads outlet control below 0.75D by a backwater profile, not HDS-5’s full-flow approximation', () => {
    const c = culvert({ lengthM: 20, inletInvertM: 803.4, outletInvertM: 803.3, diameterM: 1.2 })
    const hw = culvertHeadwater({ culvert: c, flowM3s: 0.05, barrelLengthM: 20, embedded: false })
    expect(hw.outlet!.range).toBe('below-method')
    const backwater = hw.outlet!.backwater!
    expect(backwater.state).toBe('subcritical')
    // A part-full profile stands well below the full-flow approximation's (dc + D)/2 outlet head.
    expect(backwater.headwaterM!).toBeLessThan(hw.outlet!.headwaterM)
    expect(backwater.headwaterM!).toBeGreaterThan(backwater.criticalDepthM)
    expect(hw.governing).not.toBeNull()
    expect(hw.governing!.outletMethod).toBe('backwater')
    expect(hw.governing!.hwOverD).toBeCloseTo(Math.max(hw.inlet!.hwOverD, backwater.hwOverD!), 12)
    const checks = run(c, 0.05, 806)
    expect(checks['governing-headwater']).toMatchObject({ state: 'met' })
    expect(checks['governing-headwater'].result).toContain('backwater profile')
    expect(checks.overtopping).toMatchObject({ state: 'met' })
    // The inlet-control check keeps its own figure, as before.
    expect(checks.headwater).toMatchObject({ state: 'met' })
  })
  it('meets overtopping with the freeboard to the road surface and to the subgrade shoulder', () => {
    const checks = run(culvert(), 0.9, 805.5)
    const hw = culvertHeadwater({
      culvert: culvert(),
      flowM3s: 0.9,
      barrelLengthM: Math.hypot(12, 0.3),
      profile: profile(culvert(), 805.5),
      surfacingM: 0.3,
      embedded: false,
    })
    expect(hw.road).toEqual({ lowestSubgradeM: 805.5, lowestSurfaceM: 805.8, surfacingM: 0.3 })
    expect(hw.freeboardM).toBeCloseTo(805.8 - hw.elevationM!, 12)
    expect(hw.shoulderFreeboardM).toBeCloseTo(805.5 - hw.elevationM!, 12)
    expect(checks.overtopping).toMatchObject({ state: 'met' })
    expect(checks.overtopping.result).toContain('below the lowest road surface over the barrel')
    expect(checks.overtopping.result).toContain('below the subgrade shoulder')
    expect(checks.overtopping.locator).toBe('FHWA HDS-5 (2012), 3.1.5, p. 3.15')
  })
  it('fails overtopping when the headwater reaches the road', () => {
    // 2 m³/s through a 0.8 m pipe stands well over its crown; a road 1.2 m over the invert is overtopped.
    const checks = run(culvert(), 2, 804.3)
    expect(checks['governing-headwater']).toMatchObject({ state: 'not-met' })
    expect(checks.overtopping).toMatchObject({ state: 'not-met' })
    expect(checks.overtopping.result).toMatch(/it overtops by \d/)
  })
  it('never reads overtopping as met without inverts, a peak or the road', () => {
    expect(run(culvert({ inletInvertM: null, outletInvertM: null }), 0.9, null).overtopping).toMatchObject({
      state: 'not-assessed',
    })
    const noPeak = Object.fromEntries(
      culvertChecks({
        culvert: culvert(),
        analysis: { ...geometry, profile: profile(culvert(), 805.5) },
        roadGradePercent: 4,
        drainage: { state: 'stale' },
      }).map((check) => [check.id, check]),
    )
    for (const id of ['governing-headwater', 'overtopping', 'suggested-size'])
      expect(noPeak[id], id).toMatchObject({ state: 'not-assessed', result: 'The drainage check is out of date' })
    expect(run(culvert(), 0.9, null).overtopping).toMatchObject({
      state: 'not-assessed',
      result: 'The road over the barrel is not known',
    })
    // No material and no run roughness: outlet control has no Manning n.
    expect(run(culvert({ material: undefined }), 0.9, 805.5)['governing-headwater'].result).toContain('No Manning n')
    // A box is not worked out at all.
    expect(run(culvert({ shape: 'box', spanM: 2 }), 0.9, 805.5).overtopping.state).toBe('not-assessed')
  })
  it('suggests the smallest stock size that keeps the governing HW/D at or below 1, without changing the diameter', () => {
    const c = culvert()
    const hw = culvertHeadwater({ culvert: c, flowM3s: 2, barrelLengthM: 12, embedded: false })
    expect(hw.governing!.hwOverD).toBeGreaterThan(1)
    const size = hw.suggested!
    expect(size.diameterM).toBe(1.4)
    expect(size.hwOverD).toBeLessThanOrEqual(1)
    // The next size down fails on one control or the other.
    const smaller = { ...c, diameterM: 1.2 }
    const below = culvertHeadwater({ culvert: smaller, flowM3s: 2, barrelLengthM: 12, embedded: false }).governing!
    expect(below.hwOverD).toBeGreaterThan(1)
    expect(inletControlHeadwater({ ...c, diameterM: 1.4 }, 2)!.hwOverD).toBeLessThanOrEqual(1)
    expect(c.diameterM).toBe(0.8)
    const note = run(c, 2, 806)['suggested-size']
    expect(note).toMatchObject({ state: 'note' })
    expect(note.result).toMatch(/^Ø 1400 mm by headwater \(HW\/D 0\.\d+, (inlet|outlet) control\); entered Ø 800 mm$/)
    // Too much flow for any stock size.
    expect(culvertHeadwater({ culvert: c, flowM3s: 30, barrelLengthM: 12, embedded: false }).suggestedMissing).toBe(
      'No stock size up to 1800 mm keeps HW/D at or below 1',
    )
  })
})

describe('the road over the barrel and the depth to invert', () => {
  it('reads the lowest subgrade over the barrel and lifts it by the surfacing', () => {
    const c = culvert()
    expect(culvertRoadLevel(profile(c, 805), 0.25)).toEqual({
      lowestSubgradeM: 805,
      lowestSurfaceM: 805.25,
      surfacingM: 0.25,
    })
    expect(culvertRoadLevel(profile(c, 805), null)).toMatchObject({ lowestSurfaceM: 805, surfacingM: null })
    expect(culvertRoadLevel([], 0.3)).toBeNull()
  })
  it('measures ground and road down to the invert', () => {
    const c = culvert()
    const depths = culvertEndDepths(profile(c, 805.5, 804.5), 12, 0.3)
    expect(depths.inletM).toBeCloseTo(804.5 - 803.4, 9)
    expect(depths.outletM).toBeCloseTo(804.5 - 803.1, 9)
    expect(depths.roadM).toBeCloseTo(805.55 + 0.3 - 803.25, 9)
    expect(culvertEndDepths(undefined, 12, 0.3)).toEqual({ inletM: null, outletM: null, roadM: null })
  })
  it('takes surfacing from the course stack, else the side’s surface depth', () => {
    const base = {
      leftWidth: 2.5,
      rightWidth: 2.5,
      crossfallPercent: 2,
      cutSlope: 1,
      fillSlope: 1.5,
      ditchWidth: 1,
      ditchDepth: 0.5,
      surfaceDepth: 0.3,
    }
    expect(templateSurfacingM(base, 'left')).toBe(0.3)
    expect(templateSurfacingM({ ...base, rightSurfaceDepth: 0.2 }, 'right')).toBe(0.2)
    expect(
      templateSurfacingM(
        {
          ...base,
          layers: [
            { id: 'a', name: 'Base', side: 'both', depthM: 0.2 },
            { id: 'b', name: 'Wearing', side: 'left', depthM: 0.1 },
          ],
        },
        'left',
      ),
    ).toBeCloseTo(0.3, 12)
  })
})

describe('outlet control by a backwater profile (standard step, part-full barrel)', () => {
  const G = 9.81
  const section = (y: number, d: number) => {
    const theta = 2 * Math.acos(1 - (2 * y) / d)
    return { area: (d * d * (theta - Math.sin(theta))) / 8, top: d * Math.sin(theta / 2) }
  }
  const base = { diameterM: 0.8, flowPerBarrelM3s: 0.15, manningN: 0.024, entranceLoss: 0.9 }

  it('gives critical depth’s specific energy plus the entrance loss on a level barrel of no length', () => {
    const r = backwaterOutletControl({ ...base, barrelLengthM: 1e-6, dropM: 0 })
    const yc = circularCriticalDepth(base.flowPerBarrelM3s, base.diameterM)
    const velocityHead = base.flowPerBarrelM3s ** 2 / (2 * G * section(yc, base.diameterM).area ** 2)
    expect(r.state).toBe('subcritical')
    expect(r.outletDepthM).toBeCloseTo(yc, 9)
    expect(r.headwaterM!).toBeCloseTo(yc + (1 + base.entranceLoss) * velocityHead, 4)
  })

  it('climbs to normal depth up a long mild barrel', () => {
    const slope = 0.002,
      length = 400
    const r = backwaterOutletControl({ ...base, barrelLengthM: length, dropM: slope * length })
    const yn = circularNormalDepth(base.flowPerBarrelM3s, base.diameterM, base.manningN, slope)!
    expect(yn).toBeGreaterThan(r.criticalDepthM)
    expect(r.state).toBe('subcritical')
    expect(r.normalDepthM).toBeCloseTo(yn, 9)
    expect(Math.abs(r.inletDepthM! - yn) / yn).toBeLessThan(0.01)
  })

  it('finds a steep barrel, where the outlet does not control and inlet control governs', () => {
    const slope = 0.08
    const r = backwaterOutletControl({ ...base, barrelLengthM: 12, dropM: slope * 12 })
    expect(r.normalDepthM!).toBeLessThan(r.criticalDepthM)
    expect(r.state).toBe('steep')
    expect(r.headwaterM).toBeNull()
  })

  it('starts from the tailwater where it stands above critical depth', () => {
    const r = backwaterOutletControl({ ...base, barrelLengthM: 12, dropM: 0.06, tailwaterM: 0.5 })
    expect(r.outletDepthM).toBe(0.5)
    expect(r.inletDepthM!).toBeGreaterThan(0.5 - 0.06)
  })

  it('carries a barrel the profile fills at full-flow friction', () => {
    const r = backwaterOutletControl({ ...base, barrelLengthM: 30, dropM: 0, tailwaterM: 0.79 })
    expect(r.fillsBarrel).toBe(true)
    expect(r.inletDepthM).toBe(base.diameterM)
  })
})
