import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EngineeringBands, profileGradeSpans, profileHorizontalCurveSpans } from './EngineeringBands'
import { analyzeRoad, horizontalCurveSummary, offsetCoordinate } from './engine'
import { horizontalCurveEvents } from './planAnnotations'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Alignment, Coordinate } from './types'

vi.mock('@pgmaps/geo-toolkit/visualizations/react', () => ({
  SizedChart: ({ children }: { children: (width: number) => ReactNode }) => children(640),
}))

const origin: Coordinate = [-122.8, 53.9]
const pi = offsetCoordinate(origin, 0, 300)
const road = (spiralM = 0, turn: 'left' | 'right' = 'right'): Alignment => ({
  id: 'curve-road',
  name: 'Curve road',
  color: '#16817a',
  points: [
    { id: 'start', coordinate: origin, radiusM: 0 },
    { id: 'pi', coordinate: pi, radiusM: 80, spiralM },
    { id: 'end', coordinate: offsetCoordinate(pi, turn === 'right' ? 90 : 270, 300), radiusM: 0 },
  ],
  template: { ...DEFAULT_TEMPLATE },
  vertical: [],
  overrides: [],
})
const analysisFor = (alignment: Alignment) => analyzeRoad(alignment, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

describe('horizontal profile bands', () => {
  it('shows the full spiralled turn with a separate circular span and actual named events', () => {
    for (const direction of ['left', 'right'] as const) {
      const alignment = road(40, direction)
      const analysis = analysisFor(alignment)
      const [span] = profileHorizontalCurveSpans(analysis, alignment)
      const [curve] = horizontalCurveSummary(alignment)
      expect(span.start).toBeCloseTo(curve.start - 40, 7)
      expect(span.end).toBeCloseTo(curve.end + 40, 7)
      // A 90° turn of R=80 m with 40 m entry/exit spirals has 85.66 m circular arc,
      // but a 165.66 m full span. Showing only the arc would omit 80 m of the road.
      expect(span.end - span.start).toBeCloseTo((80 * Math.PI) / 2 + 40, 5)
      expect(span.circularSpan!.end - span.circularSpan!.start).toBeCloseTo((80 * Math.PI) / 2 - 40, 5)
      expect(span.label).toContain(direction === 'left' ? 'H1 L' : 'H1 R')
      expect(span.label).toContain('R 80')
      expect(span.label).toContain('Δ 90°')
      const events = horizontalCurveEvents(curve)
      expect(events.map((event) => event.label)).toEqual(['TS', 'SC', 'CS', 'ST'])
      expect(events.map((event) => event.chainage)).toEqual([span.start, curve.start, curve.end, span.end])
      expect(span.detail).toContain(`${direction} turn`)
      expect(span.detail).toContain('full deflection 90°')
    }
  })

  it('uses BC/EC without invented spiral spans on a simple curve', () => {
    const alignment = road()
    const [span] = profileHorizontalCurveSpans(analysisFor(alignment), alignment)
    const [curve] = horizontalCurveSummary(alignment)
    expect(span.start).toBeCloseTo(220, 5)
    expect(span.end - span.start).toBeCloseTo((80 * Math.PI) / 2, 5)
    expect(span.circularSpan).toBeUndefined()
    expect(horizontalCurveEvents(curve).map((event) => event.label)).toEqual(['BC', 'EC'])
    expect(span.detail).not.toContain('spirals')
  })

  it('omits unavailable/unfitted curves and terrain-only overlays without concealing known geometry at DEM gaps', () => {
    const alignment = road(40)
    const analysis = analysisFor(alignment)
    expect(profileHorizontalCurveSpans(analysis, alignment, true)).toEqual([])
    expect(profileHorizontalCurveSpans({ ...analysis, length: 0 }, alignment)).toEqual([])
    expect(profileHorizontalCurveSpans({ ...analysis, length: NaN }, alignment)).toEqual([])
    const rejected = road()
    rejected.points[1].radiusM = 10000
    expect(profileHorizontalCurveSpans(analysisFor(rejected), rejected)).toEqual([])
    const missingTerrain = analyzeRoad(alignment, { elevationAt: () => NaN }, DEFAULT_ROAD_SETTINGS)
    expect(profileHorizontalCurveSpans(missingTerrain, alignment)).toHaveLength(1)
    expect(profileGradeSpans(missingTerrain, alignment).every((span) => span.label.startsWith('Unknown'))).toBe(true)
  })

  it('shows a single-PVI formation as one level design tangent even with missing terrain, while terrain-only stays ground', async () => {
    const alignment = road()
    alignment.vertical = [{ id: 'level', chainage: 120, elevation: 812, curveLength: 0 }]
    const analysis = analyzeRoad(alignment, { elevationAt: () => NaN }, DEFAULT_ROAD_SETTINGS)
    const spans = profileGradeSpans(analysis, alignment)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ start: 0, end: analysis.length })
    expect(spans[0].label).toMatch(/^0%/)
    expect(spans[0].detail).toContain('Design tangent')
    expect(profileGradeSpans(analysis, alignment, true).every((span) => span.label.startsWith('Unknown'))).toBe(true)

    const props = { alignment, analysis, station: 120, onStation: vi.fn() }
    await act(async () => {
      renderer = create(createElement(EngineeringBands, props))
    })
    expect(renderer!.root.findAllByType('text').some((text) => text.children.includes('Tangent'))).toBe(true)
    expect(renderer!.root.findAllByType('text').some((text) => text.children.includes('Ground'))).toBe(false)
    await act(async () => renderer!.update(createElement(EngineeringBands, { ...props, terrainOnly: true })))
    expect(renderer!.root.findAllByType('text').some((text) => text.children.includes('Ground'))).toBe(true)
    expect(renderer!.root.findAllByType('text').some((text) => text.children.includes('Tangent'))).toBe(false)
  })

  it('uses the shared profile range and station callback, and removes design rows in terrain-only mode', async () => {
    const alignment = road(40)
    const analysis = analysisFor(alignment)
    const onStation = vi.fn()
    const props = { alignment, analysis, station: 250, onStation, range: [200, 400] as [number, number] }
    await act(async () => {
      renderer = create(createElement(EngineeringBands, props))
    })
    const root = renderer!.root.findByProps({ 'data-testid': 'road-engineering-bands' })
    expect(root.props['data-range-start']).toBe(200)
    expect(root.props['data-range-end']).toBe(400)
    expect(renderer!.root.findAllByType('text').some((text) => text.children.includes('H curve'))).toBe(true)
    const preventDefault = vi.fn()
    await act(async () => renderer!.root.findByType('svg').props.onKeyDown({ key: 'ArrowRight', preventDefault }))
    expect(onStation).toHaveBeenLastCalledWith(260)
    expect(preventDefault).toHaveBeenCalledOnce()
    await act(async () => renderer!.update(createElement(EngineeringBands, { ...props, terrainOnly: true })))
    expect(renderer!.root.findAllByType('text').some((text) => text.children.includes('H curve'))).toBe(false)
    expect(
      renderer!.root.findAllByType('title').some((title) => String(title.children).includes('full deflection')),
    ).toBe(false)
  })
})
