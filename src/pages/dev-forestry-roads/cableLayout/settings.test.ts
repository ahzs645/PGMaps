import { describe, expect, it } from 'vitest'
import { EXAMPLE_RIGGING } from '../cableMechanics'
import { offsetCoordinate } from '../engine'
import { parseProject } from '../project'
import { createDemoProject } from '../terrain'
import type { CableLine, Coordinate, TerrainSource } from '../types'
import type { CableLayoutResult, LayoutSupport } from './cableLayout'
import { cableLayoutCsv } from './exports'
import { layoutLimitRows } from './limits'
import { layoutOverlay } from './overlay'
import {
  DEFAULT_SUPPORT_LAYOUT,
  chartDistance,
  layoutRun,
  parseSupportLayout,
  savedLayoutToAnalyse,
  supportLayoutErrors,
} from './settings'

const yarder: Coordinate = [-122.75, 53.9]
const far = offsetCoordinate(yarder, 90, 300)
/** 30 % downhill eastwards from the yarder; unknown more than 10 m past the far end. */
const terrain: TerrainSource = {
  elevationAt(lng: number) {
    const east = ((lng - yarder[0]) / (far[0] - yarder[0])) * 300
    return east > 310 ? NaN : 1000 - 0.3 * east
  },
}
const line: CableLine = {
  id: 'd1',
  name: 'Test',
  start: yarder,
  end: far,
  startHeight: 12,
  endHeight: 10,
  deflectionPercent: 5,
  sagModel: 'mechanics',
  rigging: EXAMPLE_RIGGING,
  supportLayout: DEFAULT_SUPPORT_LAYOUT,
}

describe('support layout settings', () => {
  it('accepts the defaults and fills an old or partial block', () => {
    expect(supportLayoutErrors(DEFAULT_SUPPORT_LAYOUT)).toEqual([])
    expect(parseSupportLayout({})).toEqual(DEFAULT_SUPPORT_LAYOUT)
    expect(parseSupportLayout({ maxSupportHeightM: 30, fixedSupports: [{ stationM: 120 }] })).toMatchObject({
      maxSupportHeightM: 30,
      fixedSupports: [{ stationM: 120 }],
    })
  })

  it('refuses values outside their limits and contradictions', () => {
    expect(() => parseSupportLayout({ heightStepM: 0 })).toThrow(/Height step/)
    expect(() => parseSupportLayout({ startKind: 'crane' })).toThrow(/start/)
    expect(() => parseSupportLayout({ minSupportHeightM: 30, maxSupportHeightM: 20 })).toThrow(/lowest support/)
    expect(() =>
      parseSupportLayout({ fixedSupports: [{ stationM: 200 }], noSupportSectors: [{ fromM: 150, toM: 250 }] }),
    ).toThrow(/inside a no-support sector/)
    expect(() => parseSupportLayout({ endKind: 'anchor', clearanceBeforeEndM: 0 })).toThrow(/anchor end/)
    expect(() => parseSupportLayout({ fixedSupports: Array(51).fill({ stationM: 1 }) })).toThrow(/at most 50/)
    expect(() =>
      parseSupportLayout({
        saved: {
          preTensionKN: 80,
          complete: true,
          supports: [
            { stationM: 0, heightM: 12 },
            { stationM: 0, heightM: 10 },
          ],
        },
      }),
    ).toThrow(/forwards/)
  })

  it('round-trips through a project file, and old files still load', () => {
    const project = createDemoProject()
    const saved = {
      preTensionKN: 80,
      complete: true,
      supports: [
        { stationM: 0, heightM: 12 },
        { stationM: 150, heightM: 10 },
      ],
    }
    const cable = {
      ...project.cables[0],
      sagModel: 'mechanics' as const,
      rigging: EXAMPLE_RIGGING,
      supportLayout: { ...DEFAULT_SUPPORT_LAYOUT, noSupportSectors: [{ fromM: 10, toM: 30 }], saved },
    }
    const reloaded = parseProject(JSON.parse(JSON.stringify({ ...project, cables: [cable] })))
    expect(reloaded.cables[0].supportLayout).toEqual(cable.supportLayout)
    expect(parseProject(JSON.parse(JSON.stringify(project))).cables[0].supportLayout).toBeUndefined()
    expect(() =>
      parseProject(
        JSON.parse(JSON.stringify({ ...project, cables: [{ ...cable, supportLayout: { maxLoadedDeg: 120 } }] })),
      ),
    ).toThrow(/Max loaded break/)
  })
})

describe('layout run', () => {
  it('samples the ground every metre from the yarder past both ends, as far as it is known', () => {
    const prepared = layoutRun(line, terrain, DEFAULT_SUPPORT_LAYOUT)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    const { input, lengthM, yarderAtEnd } = prepared.run
    expect(lengthM).toBeCloseTo(300, 0)
    expect(yarderAtEnd).toBe(false)
    expect(input.profile.x0).toBe(-20)
    // Ground is known only 10 m past the far end, so the anchor sits there.
    const last = input.profile.x0 + (input.profile.z.length - 1) * input.profile.dx
    expect(last).toBeGreaterThanOrEqual(lengthM)
    expect(last).toBeLessThanOrEqual(lengthM + 11)
    expect(input.profile.z[20]).toBeCloseTo(1000, 3)
    expect(input.towerHeightM).toBe(12)
    expect(input.loadKN).toBeCloseTo((3000 + 500) * 0.00980665, 6)
    expect(input.allowableKN).toBeCloseTo(424 / 3, 6)
    expect(input.tensionHighKN).toBe(141)
  })

  it('says why a line cannot run', () => {
    expect(layoutRun({ ...line, sagModel: 'assumed' }, terrain, DEFAULT_SUPPORT_LAYOUT)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/Rope and load/),
    })
    expect(layoutRun(line, terrain, { ...DEFAULT_SUPPORT_LAYOUT, fixedSupports: [{ stationM: 400 }] })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/beyond the line/),
    })
  })

  it('maps stations from a yarder at the far end onto the chart', () => {
    const reversed = { ...line, yarderAt: 'end' as const }
    const prepared = layoutRun(reversed, terrain, DEFAULT_SUPPORT_LAYOUT)
    expect(prepared.ok).toBe(true)
    if (!prepared.ok) return
    expect(prepared.run.yarderAtEnd).toBe(true)
    // The yarder height is the D-line's yarder height wherever it stands.
    expect(prepared.run.input.towerHeightM).toBe(12)
    expect(chartDistance(prepared.run, 0)).toBeCloseTo(prepared.run.lengthM, 6)
  })

  it('re-checks a saved layout with the ends as the D-line is now', () => {
    const prepared = layoutRun({ ...line, startHeight: 15 }, terrain, DEFAULT_SUPPORT_LAYOUT)
    if (!prepared.ok) throw Error(prepared.error)
    const saved = {
      preTensionKN: 80,
      complete: true,
      supports: [
        { stationM: 0, heightM: 12 },
        { stationM: 150, heightM: 10 },
        { stationM: prepared.run.lengthM, heightM: 8 },
      ],
    }
    expect(savedLayoutToAnalyse(prepared.run, saved)?.supports[0]).toEqual({ stationM: 0, heightM: 15 })
    expect(
      savedLayoutToAnalyse(prepared.run, { ...saved, supports: [saved.supports[0], { stationM: 900, heightM: 1 }] }),
    ).toBeNull()
  })
})

const support = (patch: Partial<LayoutSupport>): LayoutSupport => ({
  kind: 'support',
  stationM: 0,
  groundM: 900,
  heightM: 10,
  fixed: false,
  emptyTensionKN: 80,
  angleInDeg: null,
  angleOutDeg: null,
  emptyBreakDeg: null,
  loadedBreakDeg: null,
  loadedLimitDeg: null,
  liftOffLimitDeg: null,
  saddleRopeKN: null,
  saddleCarriageOnKN: null,
  saddleBeforeKN: null,
  saddleAfterKN: null,
  maxForceKN: null,
  pullAngleDeg: null,
  ...patch,
})
const result: CableLayoutResult = {
  status: 'complete',
  reason: 'none',
  reasonAtM: null,
  reasonValue: null,
  reasonValue2: null,
  preTensionKN: 80,
  tieLowKN: 80,
  tieHighKN: 85,
  tieCount: 6,
  objective: 36_745,
  reachM: 300,
  spansTotal: 100,
  spansEvaluated: 100,
  verifications: 1,
  ropeLengthM: 320,
  unstrainedLengthM: 319,
  maxTensionKN: 130,
  maxTensionSpan: 0,
  allowableKN: 141,
  tensionOk: true,
  minClearanceM: 7.4,
  minClearanceAtM: 120,
  clearanceKnown: true,
  liftOff: false,
  maxEmptyHeightM: 20,
  supports: [
    support({ kind: 'yarder', heightM: 12 }),
    support({ stationM: 150, emptyBreakDeg: 2, loadedBreakDeg: 25, loadedLimitDeg: 30, liftOffLimitDeg: 1 }),
    support({ stationM: 300, emptyBreakDeg: 10, loadedBreakDeg: 61, loadedLimitDeg: 60 }),
    support({ kind: 'anchor', stationM: 320, heightM: 0, maxForceKN: 120, pullAngleDeg: 20 }),
  ],
  spans: [],
  samples: [{ stationM: 0, loadM: 1012, emptyM: 1012, groundM: 1000 }],
  peaksM: [200],
  candidateSitesM: [],
  arcs: [],
}

describe('layout outputs', () => {
  it('judges each limit in three states', () => {
    const rows = Object.fromEntries(layoutLimitRows(result, DEFAULT_SUPPORT_LAYOUT, 7).map((r) => [r.id, r.state]))
    expect(rows).toMatchObject({
      clearance: 'met',
      tension: 'met',
      gravity: 'not-assessed',
      'loaded-intermediate': 'met',
      'loaded-end': 'not-met',
      'lift-off': 'met',
      'hold-down': 'not-met',
    })
    const unknown = layoutLimitRows({ ...result, clearanceKnown: false }, DEFAULT_SUPPORT_LAYOUT, 7)
    expect(unknown.find((r) => r.id === 'clearance')?.state).toBe('not-assessed')
  })

  it('draws supports and sectors in chart distance', () => {
    const overlay = layoutOverlay(
      { lengthM: 300, yarderAtEnd: true },
      { ...DEFAULT_SUPPORT_LAYOUT, noSupportSectors: [{ fromM: 10, toM: 50 }] },
      result,
    )
    expect(overlay.sectors).toEqual([[250, 290]])
    expect(overlay.supports.map((s) => s.x)).toEqual([300, 150, 0, -20])
    expect(overlay.peaks).toEqual([100])
    expect(overlay.summary).toMatch(/1 support · pre-tension 80 kN/)
  })

  it('writes one CSV row per support, span and the line', () => {
    const csv = cableLayoutCsv('Line "A"', result).trim().split('\n')
    expect(csv).toHaveLength(1 + 4 + 0 + 1)
    const columns = csv[0].split(',').length
    expect(csv.slice(1).every((row) => row.replace(/"[^"]*"/g, 'x').split(',').length === columns)).toBe(true)
    expect(csv[1]).toContain('"Line ""A"""')
  })
})
