import { createElement, Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrossSectionChart } from './Charts'
import { analyzeRoad, offsetCoordinate } from './engine'
import { createEngineeringDesign } from './engineeringTypes'
import { SectionPaneTools, useSectionTools, type SectionTools } from './SectionPaneTools'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('span', { 'aria-label': label }, children),
}))
// The section's options open in a popover; here its panel renders in place, always open.
vi.mock('@/components/ui/toolbar-popover', () => ({
  ToolbarPopover: ({ children }: { children: ReactNode | ((close: () => void) => ReactNode) }) =>
    createElement(Fragment, null, typeof children === 'function' ? children(() => {}) : children),
}))

const origin: Coordinate = [-122.8, 53.9]
// Flat ground under a formation 15 m up at 150: a fill whose batter runs past a 10 m section reach.
const ground = { elevationAt: () => 800 }
const settings = { ...DEFAULT_ROAD_SETTINGS, crossSectionHalfWidth: 10 }
function road(): Alignment {
  return {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 300), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'm', chainage: 150, elevation: 815, curveLength: 0 },
      { id: 'e', chainage: 300, elevation: 800, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
    engineering: {
      ...createEngineeringDesign(),
      templates: [{ id: 'wide', name: 'Wide', template: { ...DEFAULT_TEMPLATE, leftWidth: 5, rightWidth: 5 } }],
      assignments: [
        { id: 'a1', start: 0, end: 40, templateId: 'wide', side: 'both', transitionM: 0 },
        { id: 'a2', start: 200, end: 260, templateId: 'wide', side: 'both', transitionM: 0 },
      ],
    },
  }
}

let renderer: ReactTestRenderer | undefined
type Latest = {
  alignment: Alignment
  tools: SectionTools
  notices: string[]
  edits: number
  /** Puts the road back as an undo does. */
  restore: (alignment: Alignment) => void
  setStation: (chainage: number) => void
}
const probe: { current?: Latest } = {}
beforeEach(() => vi.stubGlobal('window', new EventTarget()))
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})

function Pane({ notices }: { notices: string[] }) {
  const [alignment, setAlignment] = useState(road)
  const [edits, setEdits] = useState(0)
  const [chainage, setChainage] = useState(20)
  const analysis = useMemo(() => analyzeRoad(alignment, ground, settings), [alignment])
  const tools = useSectionTools({ alignment, displayedAlignment: alignment, analysis })
  // The test reads the pane's state after each act, when effects have run.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a probe, refreshed after every render
  useEffect(() => {
    probe.current = { alignment, tools, notices, edits, restore: setAlignment, setStation: setChainage }
  })
  const station = analysis.stations.find((s) => s.chainage === chainage)
  return createElement(SectionPaneTools, {
    tools,
    station,
    terrainOnly: false,
    editable: true,
    updateAlignment: (change) => {
      setAlignment(change)
      setEdits((n) => n + 1)
    },
    onStation: setChainage,
    onNotice: (text) => notices.push(text),
  })
}
const text = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(text).join('')
function mount() {
  act(() => {
    renderer = create(createElement(Pane, { notices: [] }))
  })
  const root = renderer!.root
  const button = (label: RegExp) =>
    root.find((node) => node.type === 'button' && label.test(node.props['aria-label'] ?? text(node)))
  const input = (label: string) => root.find((node) => node.type === 'input' && node.props['aria-label'] === label)
  return {
    root,
    click: (label: RegExp) => act(() => button(label).props.onClick()),
    type: (label: string, value: string) => act(() => input(label).props.onChange({ target: { value } })),
    button,
    has: (testId: string) => root.findAll((node) => node.props['data-testid'] === testId).length > 0,
    content: () => text(root),
  }
}

describe('the section view tools', () => {
  it('toggles Hold scale and pins, then unpins, the shown section', () => {
    const view = mount()
    view.click(/^Hold scale$/)
    expect(probe.current!.tools.holdScale).toBe(true)
    expect(view.button(/^Hold scale$/).props['aria-pressed']).toBe(true)
    view.click(/^Pin this section$/)
    expect(probe.current!.tools.pinnedStation?.chainage).toBe(20)
    view.click(/^Unpin section 0\+020\.0$/)
    expect(probe.current!.tools.pinnedStation).toBeUndefined()
  })

  it('keeps Hold scale and Whole-road scale exclusive, and remembers Whole-road scale', () => {
    const storage = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    })
    const view = mount()
    view.click(/^Hold scale$/)
    view.click(/^Whole-road scale$/)
    expect(probe.current!.tools.roadScale).toBe(true)
    expect(probe.current!.tools.holdScale).toBe(false)
    expect(view.button(/^Whole-road scale$/).props['aria-pressed']).toBe(true)
    expect(storage.get('pgmaps-road-section-whole-road-scale')).toBe('1')
    view.click(/^Hold scale$/)
    expect(probe.current!.tools.roadScale).toBe(false)
    expect(storage.get('pgmaps-road-section-whole-road-scale')).toBe('0')
  })

  it('states the pinned outline’s shift beside Unpin, where the compact pane shows it', () => {
    const view = mount()
    view.click(/^Pin this section$/)
    act(() => probe.current!.setStation(60))
    const shift = view.root.find((node) => node.props['data-testid'] === 'road-section-pinned-shift')
    // Formation 806 m at 60 against 802 m at 20 on the 15 m climb to 150.
    expect(text(shift)).toBe('moved 4 m')
    expect(shift.props.title).toMatch(/^Moved 4 m to share this station's formation level/)
  })
})

describe('Use this section for…', () => {
  it('gives the named template to a typed range and lists where the batter never met the ground', () => {
    const view = mount()
    view.click(/^Use this section for…$/)
    // The range starts at the selected station, and the profile waits for a drag.
    expect(probe.current!.tools.range?.from).toBe('20')
    expect(probe.current!.tools.rangePick).toBeDefined()
    view.type('Range from station metres', '100')
    view.type('Range to station metres', '180')
    view.click(/^Apply$/)
    expect(probe.current!.edits).toBe(1)
    expect(probe.current!.alignment.engineering!.assignments.map((a) => [a.start, a.end])).toEqual([
      [0, 40],
      [100, 180],
      [200, 260],
    ])
    expect(probe.current!.notices.at(-1)).toBe('Wide now runs 0+100.0–0+180.0. Undo takes it back.')
    expect(probe.current!.tools.rangePick).toBeUndefined()
    expect(view.content()).toMatch(/Batter never met the ground at \d+ stations of 0\+100\.0–0\+180\.0/)
    // Each listed station is a way to it.
    view.click(/^Go to 0\+150\.0/)
  })

  it('keeps the form and the list in a scrolling part, so the chart above keeps its room', () => {
    const view = mount()
    view.click(/^Use this section for…$/)
    view.type('Range from station metres', '100')
    view.type('Range to station metres', '180')
    view.click(/^Apply$/)
    const tools = view.root.find((node) => node.props['data-testid'] === 'road-section-tools')
    const body = view.root.find((node) => node.props['data-testid'] === 'road-section-tools-body')
    expect(tools.props.className).not.toMatch(/\bshrink-0\b/)
    expect(tools.props.className).toMatch(/\bmax-h-/)
    expect(body.props.className).toMatch(/\boverflow-y-auto\b/)
    expect(body.findAll((node) => node.props['data-testid'] === 'road-section-range')).toHaveLength(1)
    expect(body.findAll((node) => node.props['data-testid'] === 'road-section-batter-misses')).toHaveLength(1)
  })

  it('drops the batter check once an undo takes the range back, and while a new range waits for Replace', () => {
    const view = mount()
    view.click(/^Use this section for…$/)
    view.type('Range from station metres', '100')
    view.type('Range to station metres', '180')
    view.click(/^Apply$/)
    expect(view.has('road-section-batter-misses')).toBe(true)
    const given = probe.current!.alignment
    act(() => probe.current!.restore(road()))
    expect(view.has('road-section-batter-misses')).toBe(false)
    // A redo brings it back.
    act(() => probe.current!.restore(given))
    expect(view.has('road-section-batter-misses')).toBe(true)
    view.type('Range to station metres', '230')
    view.click(/^Apply$/)
    expect(view.content()).toMatch(/is trimmed/)
    expect(view.has('road-section-batter-misses')).toBe(false)
  })

  it('asks before changing ranges already there, and changes nothing on Cancel', () => {
    const view = mount()
    view.click(/^Use this section for…$/)
    view.type('Range to station metres', '230')
    view.click(/^Apply$/)
    expect(probe.current!.edits).toBe(0)
    expect(view.content()).toMatch(/Range 2 \(Wide, 0\+200\.0–0\+260\.0\) is trimmed/)
    view.click(/^Cancel$/)
    expect(probe.current!.edits).toBe(0)
    view.click(/^Apply$/)
    view.click(/^Replace$/)
    expect(probe.current!.edits).toBe(1)
    expect(probe.current!.alignment.engineering!.assignments.map((a) => [a.start, a.end])).toEqual([[0, 260]])
  })

  it('states why a range cannot be used', () => {
    const view = mount()
    view.click(/^Use this section for…$/)
    view.type('Range to station metres', '20.4')
    view.click(/^Apply$/)
    expect(probe.current!.edits).toBe(0)
    expect(view.content()).toMatch(/Choose a range at least 1 m long/)
  })

  it('takes a range dragged on the profile, rounded to the decimetre', () => {
    const view = mount()
    view.click(/^Use this section for…$/)
    act(() => probe.current!.tools.rangePick!.onRange([60.04, 90.26]))
    expect([probe.current!.tools.range?.from, probe.current!.tools.range?.to]).toEqual(['60', '90.3'])
    expect(probe.current!.tools.rangePick?.range).toEqual([60, 90.3])
    expect(view.has('road-section-range')).toBe(true)
    // Escape ends the pick and keeps the range.
    act(() => {
      window.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' }))
    })
    expect(probe.current!.tools.rangePick).toBeUndefined()
    expect(probe.current!.tools.range?.to).toBe('90.3')
  })
})

describe('the cross-section chart', () => {
  it('names the pinned section beside its legend', async () => {
    const alignment = road()
    const analysis = analyzeRoad(alignment, ground, settings)
    const at = (chainage: number) => analysis.stations.find((s) => s.chainage === chainage)
    await act(async () => {
      renderer = create(
        createElement(CrossSectionChart, {
          alignment,
          analysis,
          station: at(60),
          pinnedStation: at(20),
          holdScale: true,
        }),
      )
    })
    const label = renderer!.root.find((node) => node.props['data-testid'] === 'road-section-pinned-label')
    expect(text(label)).toBe('Pinned 0+020.0')
    expect(label.props.title).toMatch(/^Moved 4 m to share this station's formation level/)
  })
})
