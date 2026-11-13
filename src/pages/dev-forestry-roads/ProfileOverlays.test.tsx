import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CableChart, CrossSectionChart, MassHaulChart, ProfileChart } from './Charts'
import { ChartMeasurementReadout } from './ChartMeasurement'
import { DEFAULT_DESIGN_STANDARDS, gradeRule } from './designStandards'
import { analyzeRoad, offsetCoordinate } from './engine'
import { curvePoints, pviDragReadout, tangentGrades } from './profileAnnotations'
import {
  ProfileCurvePoints,
  ProfileGradeTrouble,
  PviDragReadoutBox,
  pviReadoutBoxAt,
  type ProfilePlotFrame,
} from './ProfileOverlays'
import { ProfileValueBands } from './ProfileValueBands'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

vi.mock('@pgmaps/geo-toolkit/visualizations/react', () => ({
  SizedChart: ({ children }: { children: (width: number) => ReactNode }) => children(800),
  ChartViewport: ({ children }: { children: (height: number) => ReactNode }) => children(320),
}))

const origin: Coordinate = [-122.8, 53.9]
const alignment: Alignment = {
  id: 'r',
  name: 'Road',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: origin, radiusM: 0 },
    { id: 'b', coordinate: offsetCoordinate(origin, 90, 800), radiusM: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  vertical: [
    { id: 'p0', chainage: 0, elevation: 800, curveLength: 0 },
    { id: 'p1', chainage: 200, elevation: 820, curveLength: 100 },
    { id: 'p2', chainage: 400, elevation: 810, curveLength: 0 },
    { id: 'p3', chainage: 800, elevation: 814, curveLength: 0 },
  ],
  overrides: [],
}
const metresEast = (lng: number) =>
  ((lng - origin[0]) * Math.PI * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180)) / 180
// Ground missing between 600 and 650 m.
const analysis = analyzeRoad(
  alignment,
  { elevationAt: (lng) => (metresEast(lng) > 595 && metresEast(lng) < 655 ? Number.NaN : 812) },
  DEFAULT_ROAD_SETTINGS,
)
const limits = { rule: gradeRule({ maxGradePercent: 8 }, DEFAULT_DESIGN_STANDARDS) }
const frame: ProfilePlotFrame = {
  x: (c) => 58 + c,
  y: (z) => 300 - (z - 790) * 8,
  top: 14,
  bottom: 284,
  left: 58,
  right: 858,
}
const texts = (node: ReactTestInstance) =>
  node
    .findAll((n) => n.type === 'text')
    .map((n) =>
      n.children
        .filter((c) => typeof c === 'string')
        .join('')
        .trim(),
    )

let renderer: ReactTestRenderer | undefined
const storage = new Map<string, string>()
beforeEach(() => {
  storage.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
  })
  // The chart's popovers animate through the toolkit's motion helpers.
  vi.stubGlobal('window', {
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
    setTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
    clearTimeout,
  })
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.unstubAllGlobals()
})
const render = async (element: ReactNode) => {
  await act(async () => {
    renderer = create(element as never)
  })
  return renderer!.root
}

describe('profile overlays', () => {
  it('draws over-limit tangents red over the design line', async () => {
    const root = await render(
      createElement(
        'svg',
        null,
        createElement(ProfileGradeTrouble, {
          tangents: tangentGrades(alignment, analysis.length, limits),
          stations: analysis.stations,
          frame,
          domain: [0, 800],
        }),
      ),
    )
    const paths = root.findAll((n) => n.type === 'path')
    expect(paths.map((p) => p.props['data-grade-verdict'])).toEqual(['over-limit'])
    expect(paths[0].props.stroke).toBe('#dc2626')
  })

  it('labels curve points, flags a sag without a culvert and selects a point by keyboard', async () => {
    const onStation = vi.fn()
    const root = await render(
      createElement(
        'svg',
        null,
        createElement(ProfileCurvePoints, {
          points: curvePoints(alignment, analysis.length, []),
          frame,
          domain: [0, 800],
          onStation,
        }),
      ),
    )
    expect(texts(root)).toEqual([
      'BVC 0+150.0 · 815.00',
      'HP 0+216.7 · 818.33',
      'EVC 0+250.0 · 817.50',
      'LP 0+400.0 · 810.00 · no culvert',
    ])
    const sag = root.find((n) => n.props['data-curve-point'] === 'low')
    expect(sag.props['data-no-culvert']).toBe(true)
    expect(sag.props.role).toBe('button')
    await act(async () => sag.props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }))
    expect(onStation).toHaveBeenCalledWith(400)
  })

  it('thins labels when zoomed out so none overlaps', async () => {
    const squeezed = { ...frame, x: (c: number) => 58 + c / 10 }
    const root = await render(
      createElement(
        'svg',
        null,
        createElement(ProfileCurvePoints, {
          points: curvePoints(alignment, analysis.length, []),
          frame: squeezed,
          domain: [0, 800],
          onStation: () => {},
        }),
      ),
    )
    // 150–250 m is 10 px wide: the high point keeps its label and the curve ends drop out.
    expect(texts(root)).toEqual(['HP 0+216.7 · 818.33', 'LP 0+400.0 · 810.00 · no culvert'])
  })

  it('shows grade in and out and the deepest cut and fill while a PVI is dragged', async () => {
    const readout = pviDragReadout(analysis, alignment, 'p1')!
    const root = await render(
      createElement(
        'svg',
        null,
        createElement(PviDragReadoutBox, {
          readout,
          tangents: tangentGrades(alignment, analysis.length, limits),
          stations: analysis.stations,
          frame,
        }),
      ),
    )
    const lines = texts(root)
    expect(lines).toContain('PVI 0+200.0 · 820.00 m')
    expect(lines).toContain('In +10.0%')
    expect(lines).toContain('Out −5.0%')
    expect(lines.some((line) => /^Back C 12\.00 @ 0\+000\.0 · F \d/.test(line))).toBe(true)
    const gradeIn = root.find((n) => n.type === 'text' && n.children.includes('In +10.0%'))
    expect(gradeIn.props.fill).toBe('#dc2626')
    expect(root.findAll((n) => n.props['data-deepest'] === 'cut')).toHaveLength(2)
  })
})

describe('profile value bands', () => {
  it('prints values at calculated stations, unknown where terrain is missing, and selects by click and keys', async () => {
    const onStation = vi.fn()
    const root = await render(
      createElement(ProfileValueBands, {
        analysis,
        alignment,
        start: 0,
        end: 800,
        station: 0,
        onStation,
      }),
    )
    const ground = root.find((n) => n.props['data-band'] === 'ground')
    const values = ground.findAll((n) => n.type === 'text' && n.props['data-band-value'] !== undefined)
    expect(values.length).toBeGreaterThan(5)
    expect(values.some((v) => v.props['data-band-value'] === 'unknown')).toBe(true)
    expect(root.findAll((n) => n.props['data-band'] === 'curvature')).toHaveLength(1)
    await act(async () => values[2].props.onPointerDown({ preventDefault() {} }))
    expect(onStation).toHaveBeenLastCalledWith(values[2].props['data-station'])
    const svg = root.find((n) => n.type === 'svg')
    await act(async () => svg.props.onKeyDown({ key: 'ArrowRight', preventDefault() {} }))
    expect(onStation).toHaveBeenLastCalledWith(values[1].props['data-station'])
  })
})

describe('profile chart', () => {
  it('shows the drag readout only while a PVI is held, without changing the drag', async () => {
    const onVerticalChange = vi.fn()
    const root = await render(
      createElement(ProfileChart, {
        analysis,
        alignment,
        station: 200,
        onStation: () => {},
        onVerticalChange,
        gradeLimits: limits,
      }),
    )
    const readout = () => root.findAll((n) => n.props['data-testid'] === 'road-profile-pvi-readout')
    expect(readout()).toHaveLength(0)
    const handle = root.find((n) => n.type === 'circle' && n.props['aria-label'] === 'PVI 2 elevation')
    await act(async () =>
      handle.props.onPointerDown({
        stopPropagation() {},
        pointerId: 1,
        currentTarget: { ownerSVGElement: null, focus() {} },
      }),
    )
    expect(readout()).toHaveLength(1)
    expect(texts(readout()[0])).toContain('PVI 0+200.0 · 820.00 m')
    expect(onVerticalChange).not.toHaveBeenCalled()
    const svg = root.find((n) => n.type === 'svg' && n.props['data-testid'] === 'road-profile-chart')
    await act(async () => svg.props.onPointerUp({ pointerId: 1, currentTarget: { hasPointerCapture: () => false } }))
    expect(readout()).toHaveLength(0)
  })

  it('colours over-limit grade labels and remembers the value bands toggle in this browser', async () => {
    const props = {
      analysis,
      alignment,
      station: 100,
      onStation: () => {},
      onVerticalChange: () => {},
      gradeLimits: limits,
    }
    const root = await render(createElement(ProfileChart, props))
    const red = root.findAll((n) => n.type === 'text' && n.props['data-grade-trouble'] === true)
    expect(red.length).toBe(1)
    expect(red[0].props.fill).toBe('#dc2626')
    expect(root.findAll((n) => n.props['data-testid'] === 'road-profile-curve-points')).toHaveLength(1)
    expect(root.findAll((n) => n.props['data-testid'] === 'road-profile-value-bands')).toHaveLength(0)
    const toggle = root.find((n) => n.type === 'button' && n.props['aria-label'] === 'Value bands')
    expect(toggle.props['aria-pressed']).toBe(false)
    await act(async () => toggle.props.onClick())
    expect(root.findAll((n) => n.props['data-testid'] === 'road-profile-value-bands')).toHaveLength(1)
    expect(storage.get('pgmaps-road-profile-value-bands')).toBe('1')
    await act(async () => renderer!.unmount())
    const again = await render(createElement(ProfileChart, props))
    expect(again.findAll((n) => n.props['data-testid'] === 'road-profile-value-bands')).toHaveLength(1)
  })
})

describe('incomplete cross-sections', () => {
  it('keeps the reason outside the SVG and visible with details folded, while retaining the resolved side', async () => {
    const base = analysis.stations.find((s) => s.chainage === 100)!
    const reason = 'Left daylight unresolved: batter runs past the 35 m section reach'
    const station = {
      ...base,
      complete: false,
      leftDaylightM: null,
      rightDaylightM: 7.25,
      incompleteReasons: [reason],
      cutAreaM2: null,
      fillAreaM2: null,
    }
    const root = await render(createElement(CrossSectionChart, { alignment, analysis, station }))
    const content = (node: ReactTestInstance | string): string =>
      typeof node === 'string' ? node : node.children.map(content).join('')
    const notice = () => root.findByProps({ 'data-testid': 'road-section-incomplete' })
    expect(content(notice())).toContain(`${reason}. It is left out of quantities.`)
    for (let parent = notice().parent; parent; parent = parent.parent) expect(parent.type).not.toBe('svg')
    expect(texts(root).some((label) => label.includes('Incomplete section'))).toBe(false)
    const readout = root.findByProps({ 'data-testid': 'road-section-readout' })
    const row = (label: string) => readout.findAllByType('dt').find((n) => content(n) === `${label}:`)!.parent!
    expect(content(row('Dayl L/R'))).toBe('Dayl L/R:— / 7.3')
    expect(content(row('Cut A'))).toBe('Cut A:— m²')
    expect(content(row('Fill A'))).toBe('Fill A:— m²')
    const toggle = root.find((n) => n.type === 'button' && n.props['aria-label'] === 'Details below chart')
    await act(async () => toggle.props.onClick())
    expect(root.findByProps({ 'data-chart-slot': true }).props['data-chart-view']).toBe('chart')
    for (let parent = notice().parent; parent; parent = parent.parent) {
      expect((parent.props.className ?? '').split(' ')).not.toContain('hidden')
    }
  })
})

describe('placing the dragged PVI readout', () => {
  const plot = { top: 20, bottom: 320, left: 50, right: 650 }
  it('goes above the handle when it fits', () => {
    expect(pviReadoutBoxAt(200, 200, 150, 66, plot)).toEqual({ x: 212, y: 124 })
  })
  it('near the top of the plot, goes below the snapped-grade lines instead of over them', () => {
    const box = pviReadoutBoxAt(200, 40, 150, 66, plot)
    // The drag cursor writes its lines from 6 to about 43 px under the handle, right of it here.
    expect(box.y).toBeGreaterThanOrEqual(40 + 46)
  })
  it('in a plot too short for either, sits beside the handle away from those lines', () => {
    const short = { ...plot, bottom: 140 }
    const box = pviReadoutBoxAt(400, 60, 150, 66, short)
    expect(box.x + 150).toBeLessThanOrEqual(400 - 12)
    // Near the right edge the lines go left, so the box goes right.
    const right = pviReadoutBoxAt(540, 60, 80, 66, short)
    expect(right.x).toBe(552)
  })
})

describe('chart distance measurements', () => {
  const content = (node: ReactTestInstance | string): string =>
    typeof node === 'string' ? node : node.children.map(content).join('')
  const readout = (root: ReactTestInstance) => content(root.findByProps({ 'data-testid': 'chart-measurement-readout' }))
  const target = () => ({
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 320 }),
    focus: vi.fn(),
    setPointerCapture: vi.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: vi.fn(),
  })
  const pointer = (currentTarget: ReturnType<typeof target>, x: number, extra: object = {}) => ({
    currentTarget,
    target: currentTarget,
    button: 0,
    buttons: 1,
    shiftKey: true,
    pointerId: 1,
    clientX: x,
    clientY: 100,
    preventDefault: vi.fn(),
    ...extra,
  })
  const xAt = (value: number, start: number, end: number) => 58 + ((value - start) / (end - start)) * 726
  const click = async (chart: ReactTestInstance, x: number) => {
    const svg = target()
    await act(async () => chart.props.onPointerDown(pointer(svg, x)))
    await act(async () => chart.props.onPointerUp(pointer(svg, x)))
  }

  it('measures reversed profile endpoints without selecting stations or editing the road, and survives zoom', async () => {
    const onStation = vi.fn(),
      onVerticalChange = vi.fn()
    const root = await render(
      createElement(ProfileChart, { analysis, alignment, station: 200, onStation, onVerticalChange }),
    )
    const chart = root.findByProps({ 'data-testid': 'road-profile-chart' })
    await click(chart, xAt(350, 0, analysis.length))
    expect(readout(root)).toContain('From 0+350.0')
    await click(chart, xAt(125, 0, analysis.length))
    expect(readout(root)).toBe('225.0 m horizontal0+125.0–0+350.0Avg slope: 0.0 %')
    expect(onStation).not.toHaveBeenCalled()
    expect(onVerticalChange).not.toHaveBeenCalled()

    const band = () => root.findByProps({ 'data-testid': 'chart-measurement-band' }).findByType('rect')
    const width = band().props.width
    await act(async () => root.findByProps({ 'aria-label': 'Zoom profile in' }).props.onClick())
    expect(readout(root)).toContain('225.0 m horizontal')
    expect(band().props.width).toBeCloseTo(width * 2, 5)
    const scale = root.findAll((n) => n.props.ariaLabel === 'Profile vertical exaggeration')[0]
    await act(async () => scale.props.onValueChange('5'))
    expect(readout(root)).toContain('225.0 m horizontal')

    await click(chart, xAt(100, chart.props['data-range-start'], chart.props['data-range-end']))
    expect(readout(root)).toContain('From 0+100.0')
    await act(async () => root.findByProps({ 'aria-label': 'Clear distance measurement' }).props.onClick())
    expect(root.findAllByProps({ 'data-testid': 'chart-measurement-readout' })).toHaveLength(0)
  })

  it('measures a section drag across negative and positive offsets without shifting the road', async () => {
    const onShift = vi.fn()
    const root = await render(
      createElement(CrossSectionChart, { alignment, analysis, station: analysis.stations[0], onShift }),
    )
    const chart = root.findByProps({ 'data-testid': 'road-section-chart' })
    const [left, right] = chart.props['data-domain'].split(',').map(Number)
    const svg = target()
    await act(async () => chart.props.onPointerDown(pointer(svg, xAt(-10, left, right))))
    await act(async () => chart.props.onPointerMove(pointer(svg, xAt(5, left, right), { shiftKey: false })))
    await act(async () => chart.props.onPointerUp(pointer(svg, xAt(5, left, right), { shiftKey: false })))
    expect(readout(root)).toContain('15.0 m horizontal-10.0 m–5.0 mAvg ground slope: 0.0 %')
    expect(onShift).not.toHaveBeenCalled()

    await act(async () => chart.props.onPointerDown(pointer(svg, xAt(0, left, right), { shiftKey: false })))
    await act(async () => chart.props.onPointerUp(pointer(svg, xAt(2, left, right), { shiftKey: false })))
    expect(onShift).toHaveBeenCalledWith(2)
  })

  it('clears with Escape during a drag without falling through to station inspection', async () => {
    const onStation = vi.fn()
    const root = await render(createElement(ProfileChart, { analysis, alignment, station: 200, onStation }))
    const chart = root.findByProps({ 'data-testid': 'road-profile-chart' })
    const svg = target()
    await act(async () => chart.props.onPointerDown(pointer(svg, 200)))
    await act(async () => chart.props.onPointerMove(pointer(svg, 300)))
    expect(readout(root)).toContain('m horizontal')
    await act(async () => chart.props.onKeyDown({ key: 'Escape', preventDefault() {}, stopPropagation() {} }))
    await act(async () => chart.props.onPointerMove(pointer(svg, 350)))
    await act(async () => chart.props.onPointerUp(pointer(svg, 350)))
    expect(root.findAllByProps({ 'data-testid': 'chart-measurement-readout' })).toHaveLength(0)
    expect(onStation).not.toHaveBeenCalled()
  })

  it('leaves the section-application range picker in control of Shift-drags', async () => {
    const onRange = vi.fn()
    const root = await render(
      createElement(ProfileChart, {
        analysis,
        alignment,
        station: 200,
        onStation: vi.fn(),
        rangePick: { range: null, onRange },
      }),
    )
    const chart = root.findByProps({ 'data-testid': 'road-profile-chart' })
    const svg = target()
    await act(async () => chart.props.onPointerDown(pointer(svg, xAt(100, 0, analysis.length))))
    await act(async () => chart.props.onPointerMove(pointer(svg, xAt(250, 0, analysis.length))))
    expect(onRange.mock.calls[0][0][0]).toBeCloseTo(100)
    expect(onRange.mock.calls[0][0][1]).toBeCloseTo(250)
    expect(root.findAllByProps({ 'data-testid': 'chart-measurement-readout' })).toHaveLength(0)
  })

  it('measures the mass chart along chainage, independent of its volume axis', async () => {
    const onStation = vi.fn()
    const root = await render(createElement(MassHaulChart, { analysis, station: 200, onStation }))
    const chart = root.findByProps({ 'data-testid': 'road-mass-chart' })
    await click(chart, xAt(100, 0, analysis.length))
    await click(chart, xAt(400, 0, analysis.length))
    expect(readout(root)).toBe('300.0 m horizontal0+100.0–0+400.0')
    expect(onStation).not.toHaveBeenCalled()
  })

  it('measures a D-line even without a linked distance cursor', async () => {
    const root = await render(
      createElement(CableChart, {
        analysis: {
          length: 100,
          complete: true,
          minClearance: 10,
          samples: [
            { distance: 0, ground: 100, cable: 110, clearance: 10 },
            { distance: 100, ground: 120, cable: 130, clearance: 10 },
          ],
        },
      }),
    )
    const chart = root.findByProps({ 'data-testid': 'road-cable-chart' })
    await click(chart, xAt(10, 0, 100))
    await click(chart, xAt(80, 0, 100))
    expect(readout(root)).toBe('70.0 m horizontal10.0 m–80.0 mAvg ground slope: +20.0 %')
  })

  it('separates ground slope from formation grade and leaves a missing-ground slope unknown', async () => {
    const props = { analysis, alignment, station: 200, onStation: vi.fn() }
    const root = await render(createElement(ProfileChart, props))
    const chart = root.findByProps({ 'data-testid': 'road-profile-chart' })
    await click(chart, xAt(0, 0, analysis.length))
    await click(chart, xAt(100, 0, analysis.length))
    expect(readout(root)).toContain('Avg ground slope: 0.0 %Avg formation grade: +10.0 %')
    await click(chart, xAt(580, 0, analysis.length))
    await click(chart, xAt(700, 0, analysis.length))
    expect(readout(root)).toContain('Avg ground slope: —Avg formation grade: +1.0 %')
    await act(async () =>
      renderer!.update(createElement(ProfileChart, { ...props, alignment: { ...alignment, id: 'other' } })),
    )
    expect(root.findAllByProps({ 'data-testid': 'chart-measurement-readout' })).toHaveLength(0)
  })

  it.each([
    { ground: 13.61, formation: 13.64, expected: 'Avg slope: +13.6 %' },
    { ground: -0.01, formation: 0.01, expected: 'Avg slope: 0.0 %' },
    { ground: 13.6, formation: 13.7, expected: 'Avg ground slope: +13.6 %Avg formation grade: +13.7 %' },
    { ground: null, formation: null, expected: 'Avg ground slope: —Avg formation grade: —' },
  ])(
    'combines only known slopes that match at display precision: $ground / $formation',
    async ({ ground, formation, expected }) => {
      // The reading alone: selection and slope calculations are covered by the chart gestures above.
      const measurement = {
        selection: { start: 1768.5, end: 2140.2 },
        clear: vi.fn(),
        key: vi.fn(),
      }
      const root = await render(
        createElement(ChartMeasurementReadout, {
          measurement,
          frame: { left: 58, right: 16, bottom: 36 },
          formatEndpoint: String,
          slopes: () => [
            { label: 'Avg ground slope', percent: ground },
            { label: 'Avg formation grade', percent: formation },
          ],
        }),
      )
      expect(readout(root)).toContain(expected)
      if (expected.startsWith('Avg slope:')) expect(readout(root)).not.toContain('Avg ground slope:')
    },
  )
})
