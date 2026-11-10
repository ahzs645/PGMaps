import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EXAMPLE_RIGGING } from './cableMechanics'
import type { CableLayoutResult, LayoutSupport } from './cableLayout/cableLayout'
import { analyzeCableLayout } from './cableLayout/cableLayoutClient'
import { clearEditCheck, clearLayoutFocus, getLayoutFocus } from './cableLayout/editStore'
import { EDIT_CHECK_DELAY_MS, type EditedLayout } from './cableLayout/layoutEdit'
import { layoutOverlay } from './cableLayout/overlay'
import { DEFAULT_SUPPORT_LAYOUT, layoutRun } from './cableLayout/settings'
import type { CableChartEdit } from './cableLayout/useLayoutEdit'
import { CableLayoutChartLayer } from './CableLayoutChartLayer'
import { CableLayoutEditButtons, CableLayoutEditor } from './CableLayoutEditor'
import { CableChart } from './Charts'
import { NumberField } from './Controls'
import { analyzeCable, offsetCoordinate } from './engine'
import type { CableLine, Coordinate, TerrainSource } from './types'

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))
vi.mock('./cableLayout/cableLayoutClient', () => ({ analyzeCableLayout: vi.fn() }))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))
const analyze = vi.mocked(analyzeCableLayout)

let renderer: ReactTestRenderer | undefined
beforeEach(() => {
  vi.useFakeTimers()
  analyze.mockReset()
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  clearEditCheck('d1')
  clearLayoutFocus()
  vi.useRealTimers()
})
const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')
const button = (root: ReactTestInstance, label: RegExp) =>
  root.find(
    (node) => node.type === 'button' && (label.test(text(node).trim()) || label.test(node.props['aria-label'] ?? '')),
  )

const start: Coordinate = [-122.72, 53.89]
const slope: TerrainSource = { elevationAt: (lng) => 1000 - (lng - start[0]) * 20_000 }
const base: CableLine = {
  id: 'd1',
  name: 'D-line',
  start,
  end: offsetCoordinate(start, 90, 300),
  startHeight: 12,
  endHeight: 10,
  deflectionPercent: 5,
  sagModel: 'mechanics',
  rigging: EXAMPLE_RIGGING,
}
const saved = {
  preTensionKN: 90,
  complete: true,
  supports: [
    { stationM: 0, heightM: 12 },
    { stationM: 150, heightM: 14 },
    { stationM: 300, heightM: 10 },
  ],
}
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
/** A checked layout with one intermediate support at `at` m, `height` m high. */
const checked = (at: number, height: number, minClearanceM: number): CableLayoutResult => ({
  status: 'complete',
  reason: 'none',
  reasonAtM: null,
  reasonValue: null,
  reasonValue2: null,
  preTensionKN: 90,
  tieLowKN: null,
  tieHighKN: null,
  tieCount: 0,
  objective: null,
  reachM: 300,
  spansTotal: 0,
  spansEvaluated: 0,
  verifications: 0,
  ropeLengthM: 320,
  unstrainedLengthM: 319,
  maxTensionKN: 120,
  maxTensionSpan: 0,
  allowableKN: 141,
  tensionOk: true,
  minClearanceM,
  minClearanceAtM: 80,
  clearanceKnown: true,
  liftOff: false,
  maxEmptyHeightM: 20,
  supports: [
    support({ kind: 'yarder', heightM: 12 }),
    support({
      stationM: at,
      heightM: height,
      emptyBreakDeg: 4,
      loadedBreakDeg: 20,
      loadedLimitDeg: 30,
      liftOffLimitDeg: 1,
      maxForceKN: 40,
    }),
    support({ stationM: 300, emptyBreakDeg: 10, loadedBreakDeg: 25, loadedLimitDeg: 60 }),
  ],
  spans: [
    {
      fromM: 0,
      toM: at,
      chordM: at,
      emptySagM: 1,
      loadedSagM: 4,
      loadedTensionKN: 100,
      peakTensionKN: 120,
      solved: true,
      unknownGroundAtM: null,
      minClearanceM,
      minClearanceAtM: 80,
      worstShortfallM: 7 - minClearanceM,
      worstAtM: 80,
      clearanceOk: minClearanceM >= 7,
      gravityOk: true,
      gravityFailsAtM: null,
      tensionOk: true,
    },
  ],
  samples: [],
  peaksM: [],
  candidateSitesM: [],
  arcs: [],
})
const edited: EditedLayout = {
  origin: 'found',
  preTensionKN: 90,
  start: { heightM: 12 },
  end: { heightM: 10 },
  supports: [{ stationM: 130, heightM: 14, name: 'Fir 70', category: 'tree' }],
}
const lineWith = (e?: EditedLayout): CableLine => ({
  ...base,
  supportLayout: { ...DEFAULT_SUPPORT_LAYOUT, saved, ...(e ? { edited: e } : {}) },
})

describe('adjusting the support layout in the sidebar', () => {
  it('starts an edit from the found layout or with no supports', async () => {
    const onEdit = vi.fn()
    await act(async () => {
      renderer = create(createElement(CableLayoutEditButtons, { line: lineWith(), terrain: slope, onEdit }))
    })
    await act(async () => button(renderer!.root, /^Adjust layout$/).props.onClick())
    const fromFound = onEdit.mock.calls[0][0](lineWith()) as CableLine
    expect(fromFound.supportLayout?.edited).toMatchObject({
      origin: 'found',
      preTensionKN: 90,
      supports: [{ stationM: 150, heightM: 14 }],
    })
    await act(async () => button(renderer!.root, /^Place supports by hand$/).props.onClick())
    const byHand = onEdit.mock.calls[1][0](lineWith()) as CableLine
    expect(byHand.supportLayout?.edited).toMatchObject({ origin: 'hand', supports: [] })
    // Saved results are kept: the edit sits beside them.
    expect(byHand.supportLayout?.saved).toEqual(saved)
  })

  it('re-checks after an edit settles and compares the found and current values', async () => {
    analyze.mockResolvedValue(checked(130, 14, 5.5))
    const onEdit = vi.fn()
    const found = checked(150, 14, 7.4)
    await act(async () => {
      renderer = create(createElement(CableLayoutEditor, { line: lineWith(edited), terrain: slope, onEdit, found }))
    })
    const root = renderer!.root
    expect(text(root.findByProps({ 'data-testid': 'cable-layout-edit-status' }))).toMatch(/checking/)
    // The found layout is checked on the line as it is now, for the Found column; the edit waits.
    const stations = () => analyze.mock.calls.map((c) => c[1].supports[1].stationM)
    expect(stations()).toEqual([150])
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EDIT_CHECK_DELAY_MS)
    })
    expect(stations()).toEqual([150, 130])
    expect(text(root.findByProps({ 'data-testid': 'cable-layout-edit-status' }))).toMatch(/re-checked/)
    const table = root.findByProps({ 'data-testid': 'cable-layout-compare' })
    const row = (id: string) => table.find((n) => n.type === 'tr' && n.props['data-row'] === id)
    expect(text(row('clearance'))).toContain('7.4 m')
    expect(text(row('clearance'))).toContain('5.5 m')
    expect(row('clearance').props['data-changed']).toBe(true)
    expect(row('stations').props['data-changed']).toBe(true)
    expect(row('supports').props['data-changed']).toBeUndefined()

    // Picking a row locates it on the chart and plan (chart distance from the D-line's start).
    await act(async () => button(row('clearance'), /Load clearance/).props.onClick())
    expect(getLayoutFocus()).toMatchObject({ cableId: 'd1', rowId: 'clearance', x: 80 })

    // Station and height fields, add and delete all write the edit through the D-line's edit.
    const field = (label: string) => root.findAll((n) => n.type === NumberField && n.props.label === label)[0]
    await act(async () => field('Station (m)').props.onChange(140))
    expect((onEdit.mock.calls.at(-1)![0](lineWith(edited)) as CableLine).supportLayout?.edited?.supports[0]).toEqual({
      stationM: 140,
      heightM: 14,
      name: 'Fir 70',
      category: 'tree',
    })
    await act(async () => button(root, /^Delete support 1$/).props.onClick())
    expect((onEdit.mock.calls.at(-1)![0](lineWith(edited)) as CableLine).supportLayout?.edited?.supports).toEqual([])
    await act(async () => button(root, /Add support in the longest span/).props.onClick())
    expect(
      (onEdit.mock.calls.at(-1)![0](lineWith(edited)) as CableLine).supportLayout?.edited?.supports.map(
        (s) => s.stationM,
      ),
    ).toHaveLength(2)
    await act(async () => button(root, /^Discard edits$/).props.onClick())
    expect((onEdit.mock.calls.at(-1)![0](lineWith(edited)) as CableLine).supportLayout).not.toHaveProperty('edited')
  }, 30_000)
})

describe('editing on the D-line chart', () => {
  it('says how to edit on the chart', async () => {
    const line = lineWith(edited)
    const edit = { edited } as CableChartEdit
    await act(async () => {
      renderer = create(createElement(CableChart, { analysis: analyzeCable(line, slope), edit, onDistance: vi.fn() }))
    })
    expect(text(renderer!.root.findByProps({ 'data-testid': 'road-cable-edit-hint' }))).toMatch(
      /Drag a support handle.*Double-click the profile/,
    )
  })

  it('draws handles, symbols and marks, and moves a support with the keyboard', async () => {
    const line = lineWith(edited)
    const prepared = layoutRun(line, slope, line.supportLayout!)
    if (!prepared.ok) throw Error(prepared.error)
    const run = prepared.run
    const overlay = layoutOverlay(run, line.supportLayout!, checked(130, 14, 5.5), {
      edited: { layout: edited, profile: run.input.profile, towerHeightM: 12, pending: false },
      focus: { points: [{ stationM: 80, label: 'short 1.5 m' }] },
    })
    const edit: CableChartEdit = {
      edited,
      settings: line.supportLayout!,
      lengthM: run.lengthM,
      yarderAtEnd: false,
      commit: vi.fn(),
      preview: vi.fn(),
      addSupport: vi.fn(),
      addSector: vi.fn(),
    }
    const onDistance = vi.fn()
    const frame = {
      left: 50,
      top: 24,
      bottom: 36,
      plotWidth: 600,
      plotHeight: 200,
      x: (v: number) => 50 + v * 2,
      y: (v: number) => 224 - (v - 850),
    }
    await act(async () => {
      renderer = create(
        createElement(
          'svg',
          null,
          createElement(CableLayoutChartLayer, {
            layout: overlay,
            edit,
            frame,
            domain: [0, 300, 850, 1050] as const,
            height: 260,
            onDistance,
          }),
        ),
      )
    })
    const root = renderer!.root
    expect(root.findAllByProps({ 'data-testid': 'road-cable-support-symbol' })[0].props['data-category']).toBe('tree')
    expect(text(root.findAllByProps({ 'data-testid': 'road-cable-support-name' })[0])).toBe('Fir 70')
    expect(text(root.findAllByProps({ 'data-testid': 'road-cable-focus' })[0])).toBe('short 1.5 m')
    const handles = root.findAll((n) => n.type === 'circle' && n.props['data-testid'] === 'road-cable-support-handle')
    // Support 1 and the support end; a yarder start has no handle.
    expect(handles.map((h) => h.props['data-support-handle'])).toEqual([0, 'end'])
    expect(handles[0].props['aria-label']).toMatch(/^Support 1 \(Fir 70\) at 130 m, 14\.0 m high/)
    const key = (h: ReactTestInstance, k: string, shiftKey = false) =>
      act(async () => h.props.onKeyDown({ key: k, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() }))
    const commits = vi.mocked(edit.commit).mock.calls
    await key(handles[0], 'ArrowRight')
    expect(commits[0][0].supports[0]).toMatchObject({ stationM: 131, heightM: 14 })
    expect(onDistance).toHaveBeenLastCalledWith(131)
    await key(handles[0], 'ArrowUp', true)
    expect(commits[1][0].supports[0]).toMatchObject({ stationM: 130, heightM: 16 })
    await key(handles[1], 'ArrowLeft')
    expect(commits).toHaveLength(2)
    await key(handles[1], 'ArrowDown')
    expect(commits[2][0].end.heightM).toBe(9.5)
    await key(handles[0], 'Delete')
    expect(commits[3][0].supports).toEqual([])

    // A drag past the threshold picks its axis: sideways moves the support, the plan cursor follows.
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    const svg = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 700, height: 260 }) }
    const pointer = (clientX: number, clientY: number) => ({
      button: 0,
      shiftKey: false,
      pointerId: 1,
      clientX,
      clientY,
      currentTarget: { ownerSVGElement: svg, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() },
      stopPropagation: vi.fn(),
    })
    const handle = () => root.findAll((n) => n.type === 'circle' && n.props['data-support-handle'] === 0)[0]
    await act(async () => handle().props.onPointerDown(pointer(310, 100)))
    await act(async () => handle().props.onPointerMove(pointer(312, 101)))
    expect(edit.preview).not.toHaveBeenCalled()
    await act(async () => handle().props.onPointerMove(pointer(330, 103)))
    expect(vi.mocked(edit.preview).mock.calls.at(-1)![0]!.supports[0]).toMatchObject({ stationM: 140, heightM: 14 })
    expect(onDistance).toHaveBeenLastCalledWith(140)
    expect(root.findAllByProps({ 'data-testid': 'road-cable-support-ghost' })).toHaveLength(1)
    await act(async () => handle().props.onPointerUp(pointer(330, 103)))
    expect(commits.at(-1)![0].supports[0]).toMatchObject({ stationM: 140, heightM: 14 })
    expect(root.findAllByProps({ 'data-testid': 'road-cable-support-ghost' })).toHaveLength(0)
    vi.unstubAllGlobals()
  })
})
