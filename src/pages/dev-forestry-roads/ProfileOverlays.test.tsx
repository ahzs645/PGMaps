import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileChart } from './Charts'
import { DEFAULT_DESIGN_STANDARDS, gradeRule } from './designStandards'
import { analyzeRoad, offsetCoordinate } from './engine'
import { curvePoints, pviDragReadout, tangentGrades } from './profileAnnotations'
import { ProfileCurvePoints, ProfileGradeTrouble, PviDragReadoutBox, type ProfilePlotFrame } from './ProfileOverlays'
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
