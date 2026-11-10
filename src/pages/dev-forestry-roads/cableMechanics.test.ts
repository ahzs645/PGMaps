import { describe, expect, it } from 'vitest'
import {
  analyzeSkylineSpan,
  EXAMPLE_RIGGING,
  heightAlong,
  parabolicLoadSagM,
  riggingErrors,
  riggingForces,
  STANDARD_GRAVITY as g,
} from './cableMechanics'
import type { CableRigging, SkylineSpanResult } from './cableMechanics'

/**
 * Reference numbers come from running the published mechanics in two independent tools (see
 * docs/forestry-road-design/cable-mechanics-and-reach.md, "How the numbers were checked"):
 * - an elastic-catenary span solver (Irvine 1981) with an 18 mm skyline, 1.85 kg/m,
 *   E·A = 100 kN/mm² × full circle, 35,000 kgf ÷ 2.5 allowable, 2,500 + 400 kg load and
 *   0.5 + 0.5 kg/m running lines;
 * - a Zweifel (1960) fixed-length span with a 22 mm skyline, 23.2 N/m, E·A = 100 kN/mm² × 0.7 of
 *   the circle, 35 kN load and a base tension at the lower support.
 */
const tensionLimited: CableRigging = {
  ...EXAMPLE_RIGGING,
  tensionMode: 'allowable',
  ropeMassKgPerM: 1.85,
  ropeDiameterMm: 18,
  metallicFillFactor: 1,
  elasticModulusKNPerMm2: 100,
  breakingForceKN: (35_000 * g) / 1000,
  safetyFactor: 2.5,
  payloadKg: 2500,
  carriageKg: 400,
  runningLinesKgPerM: 1,
}
const fixedLength: CableRigging = {
  ...EXAMPLE_RIGGING,
  tensionMode: 'base',
  ropeMassKgPerM: 23.2 / g,
  ropeDiameterMm: 22,
  metallicFillFactor: 0.7,
  elasticModulusKNPerMm2: 100,
  breakingForceKN: 10_000,
  safetyFactor: 1,
  baseTensionKN: 60,
  extraRopeM: 0,
  payloadKg: 35_000 / g,
  carriageKg: 0,
  runningLinesKgPerM: 0,
}

function solved(horizontalM: number, verticalM: number, rigging: CableRigging): SkylineSpanResult {
  const outcome = analyzeSkylineSpan({ horizontalM, verticalM }, rigging)
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.result
}
const sagAt = (result: SkylineSpanResult, x: number) =>
  heightAlong(
    result.loadPath.map((p) => ({ x: p.x, z: p.sagBelowChordM })),
    x,
  )!

describe('tension-limited elastic catenary', () => {
  it.each([
    // span, drop to the far support, rope beyond chord, mid-span sag below the chord
    [200, 0, 0.19, 11.277],
    [300, 60, 0.519, 18.416],
    [300, 100, 0.506, 19.411],
    [500, 150, 1.498, 34.529],
    [700, 200, 3.086, 51.758],
  ])('%i × %i m span matches the reference within 0.5 %% of sag', (d, h, spare, sag) => {
    const r = solved(d, -h, tensionLimited)
    expect(r.maxTension.tensionN).toBeCloseTo((35_000 * g) / 2.5, -2)
    expect(r.tensionOk).toBe(true)
    // The reference carries half the running lines as a point load on the carriage; PGMaps spreads
    // half their weight along the skyline (Pestal). The two agree at mid-span and drift apart a
    // little as the rope gets longer, which shows in the spare rope on the longest spans.
    expect(r.midSpan.sagBelowChordM).toBeGreaterThan(sag * 0.995)
    expect(r.midSpan.sagBelowChordM).toBeLessThan(sag * 1.005)
    expect(Math.abs(r.unstrainedLengthM - r.chordM - spare)).toBeLessThan(Math.max(0.005, spare * 0.04))
  })

  it('traces a load path that hangs lower near the supports than a parabola with the same mid-span sag', () => {
    const level = solved(200, 0, tensionLimited)
    expect(sagAt(level, 19.27)).toBeCloseTo(5.717, 1)
    expect(sagAt(level, 49.42)).toBeCloseTo(9.316, 1)
    const inclined = solved(300, -60, tensionLimited)
    expect(sagAt(inclined, 27.03)).toBeCloseTo(9.285, 1)
    expect(sagAt(inclined, 71.16)).toBeCloseTo(15.146, 1)
    expect(sagAt(inclined, 223.03)).toBeCloseTo(15.365, 1)
    expect(sagAt(inclined, 269.44)).toBeCloseTo(9.56, 1)
    // The assumed-sag model's parabola through the same mid-span sag.
    const parabola = (r: SkylineSpanResult, x: number) => {
      const t = x / r.span.horizontalM
      return 4 * r.midSpan.sagBelowChordM * t * (1 - t)
    }
    expect(sagAt(level, 19.27) - parabola(level, 19.27)).toBeGreaterThan(1.5)
    expect(sagAt(inclined, 27.03) - parabola(inclined, 27.03)).toBeGreaterThan(2.5)
    // The path is continuous and ends on both supports.
    expect(inclined.loadPath[0]).toMatchObject({ x: 0, z: 0 })
    expect(inclined.loadPath.at(-1)!.x).toBeCloseTo(300, 9)
    expect(inclined.loadPath.at(-1)!.z).toBeCloseTo(-60, 9)
    for (let i = 1; i < inclined.loadPath.length; i++)
      expect(inclined.loadPath[i].x).toBeGreaterThan(inclined.loadPath[i - 1].x)
  })

  it('puts the largest tension at the upper support with the load at mid-span', () => {
    const r = solved(300, -60, tensionLimited)
    expect(r.maxTension.atSupport).toBe('near')
    expect(r.maxTension.loadX).toBeCloseTo(r.midSpan.x, 6)
    // The empty skyline at the same length is far slacker in tension and hangs above the load path.
    expect(Math.max(r.emptyNearTensionN, r.emptyFarTensionN)).toBeLessThan(r.allowableN / 2)
    const emptyMid = heightAlong(r.emptyRope, r.midSpan.x)!
    expect(emptyMid).toBeGreaterThan(r.midSpan.z)
  })
})

describe('fixed-length skyline from a base tension', () => {
  it.each([
    // span, rise, base tension kN, rope beyond the span, Zweifel loaded tension kN
    [200, 58, 40, 0, 171.84],
    [200, 58, 60, 0, 182.83],
    [200, 58, 80, 0, 192.75],
    [200, 58, 100, 0, 202.84],
    [200, 58, 60, 40, 174.16],
    [200, 58, 60, 200, 152.14],
    [300, 88, 60, 0, 183.15],
    [100, 28, 60, 0, 181.48],
  ])('%i × %i m at %i kN (+%i m rope) matches Zweifel within 1 %%', (b, h, base, extra, zweifel) => {
    const r = solved(b, h, { ...fixedLength, baseTensionKN: base, extraRopeM: extra })
    expect(r.emptyNearTensionN / 1000).toBeCloseTo(base, 3)
    // Zweifel holds the tension increase uniform along a parabolic rope; the catenary resolves it.
    // The mean tension at the carriage agrees within 0.4 % on every row.
    expect(Math.abs(r.midSpan.loadTensionN / 1000 / zweifel - 1)).toBeLessThan(0.01)
  })

  it('loaded tension barely depends on span length, and paid-out rope brings it down', () => {
    const tensions = [100, 200, 300].map((b) => solved(b, b * 0.29, fixedLength).midSpan.loadTensionN / 1000)
    for (const t of tensions) {
      expect(t).toBeGreaterThan(180)
      expect(t).toBeLessThan(185)
    }
    const slack = solved(200, 58, { ...fixedLength, extraRopeM: 200 })
    expect(slack.midSpan.loadTensionN / 1000).toBeLessThan(tensions[1] - 25)
  })

  it('flags a load that raises the tension past the allowable', () => {
    const r = solved(200, 58, { ...fixedLength, breakingForceKN: 424, safetyFactor: 3 })
    expect(r.allowableN).toBeCloseTo(141_333, 0)
    expect(r.tensionOk).toBe(false)
    expect(r.maxTension.tensionN).toBeGreaterThan(180_000)
  })
})

describe('inputs', () => {
  it('reproduces the parabolic quick sag', () => {
    const chord = 200
    const load = 2900 * g + 0.5 * g * (0.5 * chord * 0.5 + 0.5 * chord * 0.5)
    expect(parabolicLoadSagM(chord, load, 1.85 * g, (35_000 * g) / 2.5)).toBeCloseTo(11.196, 3)
    const long = Math.hypot(700, 200)
    const longLoad = 2900 * g + 0.5 * g * (0.5 * long * 0.5 + 0.5 * long * 0.5)
    expect(parabolicLoadSagM(long, longLoad, 1.85 * g, (35_000 * g) / 2.5)).toBeCloseTo(48.821, 3)
  })

  it('converts the rigging to forces', () => {
    const f = riggingForces(EXAMPLE_RIGGING)
    expect(f.metallicAreaMm2).toBeCloseTo(Math.PI * 121 * 0.7, 6)
    expect(f.stiffnessN).toBeCloseTo(100_000 * Math.PI * 121 * 0.7, 3)
    expect(f.loadN).toBeCloseTo(3500 * g, 6)
    expect(f.allowableN).toBeCloseTo(424_000 / 3, 6)
  })

  it('refuses non-physical rigging and spans it cannot carry', () => {
    expect(riggingErrors(EXAMPLE_RIGGING)).toEqual([])
    expect(riggingErrors({ ...EXAMPLE_RIGGING, ropeMassKgPerM: 0 })[0]).toMatch(/Skyline mass/)
    expect(riggingErrors({ ...EXAMPLE_RIGGING, safetyFactor: NaN })[0]).toMatch(/Safety factor/)
    expect(riggingErrors({ ...EXAMPLE_RIGGING, tensionMode: 'tight' as never })[0]).toMatch(/tensioned/)
    expect(riggingErrors({ ...EXAMPLE_RIGGING, tensionMode: 'base', baseTensionKN: 200 })[0]).toMatch(
      /below the allowable/,
    )
    expect(riggingErrors({ ...EXAMPLE_RIGGING, payloadKg: 30_000 })[0]).toMatch(/half the load/)
    expect(analyzeSkylineSpan({ horizontalM: 0.5, verticalM: 0 }, EXAMPLE_RIGGING)).toMatchObject({ ok: false })
    expect(analyzeSkylineSpan({ horizontalM: NaN, verticalM: 0 }, EXAMPLE_RIGGING)).toMatchObject({ ok: false })
    // A heavy load on a long span cannot be held within the allowable tension at any rope length.
    const heavy = analyzeSkylineSpan(
      { horizontalM: 2500, verticalM: 0 },
      { ...EXAMPLE_RIGGING, ropeMassKgPerM: 8, payloadKg: 6000 },
    )
    expect(heavy).toMatchObject({ ok: false, error: expect.stringMatching(/allowable tension/) })
  })

  it('solves the example rigging on an example span quickly enough for a reach search', () => {
    const started = performance.now()
    for (let d = 100; d <= 1000; d += 100)
      expect(analyzeSkylineSpan({ horizontalM: d, verticalM: d * 0.3 }, EXAMPLE_RIGGING).ok).toBe(true)
    expect(performance.now() - started).toBeLessThan(2000)
  })
})
