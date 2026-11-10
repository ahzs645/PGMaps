// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { analyzeSkylineSpan, EXAMPLE_RIGGING } from '../cableMechanics'
import {
  CableLayoutInputError,
  instantiateCableLayout,
  layoutReasonText,
  layoutSteps,
  type CableLayoutEngine,
  type CableLayoutInput,
} from './cableLayout'
import { runToCompletion } from '../cooperative'

let engine: CableLayoutEngine
beforeAll(async () => {
  engine = await instantiateCableLayout(readFileSync(new URL('./cable_layout.wasm', import.meta.url)))
})

const slope = (x: number) => 1000 - 0.4 * x
const valley = (x: number) => 1000 - 0.6 * x + 0.0006 * x * x
const ridge = (x: number) => 1000 - 0.3 * x + 18 * Math.exp(-(((x - 200) / 45) ** 2))

/**
 * SEILAPLAN's Standard parameter set with a 20 kN load, as in the reference run of SEILAPLAN
 * 3.8.2 (10 November 2026): 22 mm skyline, 0.0232 kN/m, E·A = 100 kN/mm² × 266.093 mm², 141 kN
 * allowable, 60–141 kN searched, two-cable system with a 0.0073 kN/m mainline.
 */
function standard(
  terrain: (x: number) => number,
  lineEndM: number,
  patch: Partial<CableLayoutInput> = {},
): CableLayoutInput {
  const x0 = -20
  const z = Float64Array.from({ length: lineEndM + 41 }, (_, i) => terrain(x0 + i))
  return {
    model: 'parity',
    startKind: 'yarder',
    endKind: 'support',
    towerHeightM: 12,
    cableSystem: 'two-cable',
    trafficableFromStartM: 0,
    trafficableBeforeEndM: 0,
    minClearanceM: 7,
    clearanceFromStartM: 20,
    clearanceBeforeEndM: 20,
    zoneClearanceM: -1,
    loadKN: 20,
    ropeKNPerM: 0.0232,
    runningLinesKNPerM: 0.0073,
    stiffnessKN: 100 * 266.093,
    allowableKN: 141,
    tensionLowKN: 60,
    tensionHighKN: 141,
    tensionStepKN: 1,
    minSupportSpacingM: 10,
    candidateSpacingM: 10,
    minHeightM: 8,
    maxHeightM: 22,
    heightStepM: 2,
    builtSupportAboveM: 22,
    liftOffDeg: 1,
    holdDownDeg: 3,
    maxLoadedDeg: 30,
    maxLoadedEndDeg: 60,
    anchorDistanceM: 20,
    anchorReferenceHeightM: 12,
    minGravityGrade: 0,
    lineEndM,
    maxSpans: 1_000_000,
    loadPositions: 32,
    profile: { x0, dx: 1, z },
    fixedSupports: [],
    noSupportSectors: [],
    ...patch,
  }
}

const search = (input: CableLayoutInput) => runToCompletion(layoutSteps(engine, input, 500))
const line = (r: ReturnType<typeof search>) =>
  r.supports.filter((s) => s.kind !== 'anchor').map((s) => [s.stationM, s.heightM])

describe('SEILAPLAN parity (reference run of SEILAPLAN 3.8.2, 10 November 2026)', () => {
  // Supports, objective and spans checked are exact; the pre-tension within 2 kN.
  const vectors: [string, CableLayoutInput, number[][], number, number, number][] = [
    [
      'A',
      standard(slope, 250),
      [
        [0, 12],
        [210, 22],
        [250, 0],
      ],
      27_430,
      2252,
      83,
    ],
    [
      'B',
      standard(valley, 400),
      [
        [0, 12],
        [400, 6],
      ],
      23_781,
      2252,
      66,
    ],
    [
      'C',
      standard(ridge, 400),
      [
        [0, 12],
        [200, 10],
        [400, 10],
      ],
      36_745,
      7524,
      83,
    ],
    [
      'D',
      standard(ridge, 400, { fixedSupports: [{ stationM: 150, heightM: 14 }] }),
      [
        [0, 12],
        [150, 14],
      ],
      37_204,
      4357,
      106,
    ],
    [
      'E',
      standard(ridge, 400, { endKind: 'anchor', noSupportSectors: [{ fromM: 170, toM: 230 }] }),
      [
        [0, 12],
        [200, 10],
        [380, 10],
        [400, 0],
      ],
      36_746,
      3313,
      66,
    ],
    [
      'F',
      standard(valley, 400, { startKind: 'support' }),
      [
        [0, 22],
        [400, 6],
      ],
      11_237,
      3088,
      61,
    ],
  ]
  it.each(vectors)('vector %s', (_, input, supports, objective, spans, tension) => {
    const r = search(input)
    expect(line(r)).toEqual(supports)
    expect(r.objective).toBe(objective)
    expect(r.spansTotal).toBe(spans)
    expect(Math.abs(r.preTensionKN! - tension)).toBeLessThanOrEqual(2)
  })

  it('vector C: peak at 200 m and Zweifel loaded tensions at the chosen tension', () => {
    const r = search(standard(ridge, 400))
    expect(r.peaksM).toEqual([200])
    const at83 = engine.analyze(standard(ridge, 400), {
      preTensionKN: 83,
      complete: true,
      supports: [
        { stationM: 0, heightM: 12 },
        { stationM: 200, heightM: 10 },
        { stationM: 400, heightM: 10 },
      ],
    })
    expect(at83.spans.map((s) => s.loadedTensionKN)).toEqual([expect.closeTo(126.49, 1), expect.closeTo(124.07, 1)])
    expect(at83.spans.map((s) => s.minClearanceM)).toEqual([expect.closeTo(7.34, 1), expect.closeTo(6.46, 1)])
    const support = at83.supports[1]
    expect(support.emptyBreakDeg).toBeCloseTo(12.14, 1)
    expect(support.loadedBreakDeg).toBeCloseTo(20.87, 1)
    expect(support.saddleCarriageOnKN).toBeCloseTo(42.5, 1)
  })

  it('vector G: the Standard set’s own 35 kN load has no layout', () => {
    const r = search(standard(ridge, 400, { loadKN: 35 }))
    expect(r.status).toBe('no-layout')
    expect(layoutReasonText(r)).not.toBe('')
  })
})

describe('catenary model', () => {
  const catenary = (terrain: (x: number) => number, end: number, patch: Partial<CableLayoutInput> = {}) =>
    standard(terrain, end, { model: 'catenary', zoneClearanceM: 0, ...patch })

  it('reproduces cableMechanics.ts on a single span', () => {
    // Yarder 12 m at 0, ground anchor at 300 m: one span, no rope beyond it.
    const input = catenary(slope, 300, { endKind: 'anchor', cableSystem: 'multi-cable' })
    const kNPerKg = 9.80665 / 1000
    const rigging = { ...EXAMPLE_RIGGING, tensionMode: 'base' as const, baseTensionKN: 0 }
    const w = rigging.ropeMassKgPerM * kNPerKg
    const running = rigging.runningLinesKgPerM * kNPerKg
    const load = (rigging.payloadKg + rigging.carriageKg) * kNPerKg
    const t0 = 90
    const r = engine.analyze(
      {
        ...input,
        ropeKNPerM: w,
        runningLinesKNPerM: running,
        loadKN: load,
        stiffnessKN: (100 * Math.PI * 11 ** 2 * 0.7) / 1,
        allowableKN: 1000,
        tensionHighKN: 1000,
      },
      {
        preTensionKN: t0,
        complete: true,
        supports: [
          { stationM: 0, heightM: 12 },
          { stationM: 300, heightM: 0 },
        ],
      },
    )
    // The pre-tension is at the yarder top; cableMechanics takes it at the lower (far) support.
    const drop = 12 + 0.4 * 300
    const lower = t0 - (w + running / 2) * drop
    const span = analyzeSkylineSpan({ horizontalM: 300, verticalM: -drop }, { ...rigging, baseTensionKN: lower })
    expect(span.ok).toBe(true)
    if (!span.ok) return
    expect(r.spans[0].peakTensionKN! / (span.result.maxTension.tensionN / 1000)).toBeCloseTo(1, 2)
    expect(r.spans[0].loadedSagM!).toBeCloseTo(span.result.midSpan.sagBelowChordM, 1)
  })

  it('keeps every support out of an excluded sector and passes its own final check', () => {
    const r = search(catenary(ridge, 400, { endKind: 'anchor', noSupportSectors: [{ fromM: 170, toM: 230 }] }))
    expect(r.status).toBe('complete')
    expect(r.supports.every((s) => s.stationM <= 170 || s.stationM >= 230)).toBe(true)
    expect(r.spans.every((s) => s.clearanceOk && s.tensionOk && s.gravityOk)).toBe(true)
    for (const s of r.supports) {
      if (s.liftOffLimitDeg !== null) expect(s.emptyBreakDeg!).toBeGreaterThanOrEqual(s.liftOffLimitDeg)
      if (s.loadedLimitDeg !== null && s.loadedBreakDeg !== null)
        expect(s.loadedBreakDeg).toBeLessThanOrEqual(s.loadedLimitDeg + 1e-9)
    }
  })

  it('clears the concave valley by the full minimum on its own load path', () => {
    const r = search(catenary(valley, 400))
    expect(r.status).toBe('complete')
    expect(r.minClearanceM!).toBeGreaterThanOrEqual(7 - 1e-6)
  })

  it('reports an incomplete line with the place and limit that stopped it', () => {
    const r = search(catenary(ridge, 400, { fixedSupports: [{ stationM: 150, heightM: 14 }] }))
    expect(r.status).toBe('incomplete')
    expect(r.supports.some((s) => s.stationM === 150 && s.fixed)).toBe(true)
    expect(r.reasonAtM).not.toBeNull()
    expect(layoutReasonText(r)).toMatch(/\d+ m/)
    expect(r.tensionOk).toBe(true)
  })

  it('never proves a span over unknown ground clear', () => {
    const input = catenary(slope, 250)
    const z = Float64Array.from(input.profile.z)
    for (let i = 140; i < 160; i++) z[i] = NaN
    const r = search({ ...input, profile: { ...input.profile, z } })
    expect(r.status).not.toBe('complete')
    expect(r.reason).toBe('unknown-ground')
    expect(r.arcs.filter((a) => a.fromM < 120 && a.toM > 139).every((a) => !a.feasible)).toBe(true)
  })

  it('refuses inputs it cannot run, by code', () => {
    expect(() => search(catenary(ridge, 400, { minClearanceM: 9 }))).toThrow(CableLayoutInputError)
    expect(() =>
      search(
        catenary(ridge, 400, {
          fixedSupports: [{ stationM: 200 }],
          noSupportSectors: [{ fromM: 170, toM: 230 }],
        }),
      ),
    ).toThrow(/inside a no-support sector/)
    expect(() => search(catenary(ridge, 400, { maxSpans: 50 }))).toThrow(/Too many spans/)
  })
})
