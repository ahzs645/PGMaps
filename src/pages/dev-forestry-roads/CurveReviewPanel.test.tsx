import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CurveReviewPanel } from './CurveReviewPanel'
import { alignmentLength, analyzeRoad, horizontalCurveSummary, offsetCoordinate } from './engine'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import { downloadText } from '@/lib/download'
import type { Alignment, Coordinate } from './types'

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))
let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
  vi.clearAllMocks()
})

describe('linked curve review controls', () => {
  it('selects exact spiral event stations and exports the same derived review without changing the road', async () => {
    const origin: Coordinate = [-122.8, 53.9]
    const corner = offsetCoordinate(origin, 0, 150)
    const road: Alignment = {
      id: 'r',
      name: 'Spiral review',
      color: '#16817a',
      points: [
        { id: 'a', coordinate: origin, radiusM: 0 },
        { id: 'b', coordinate: corner, radiusM: 50, spiralM: 10 },
        { id: 'c', coordinate: offsetCoordinate(corner, 90, 150), radiusM: 0 },
      ],
      vertical: [],
      template: { ...DEFAULT_TEMPLATE },
      overrides: [],
    }
    road.vertical = [
      { id: 'v0', chainage: 0, elevation: 800, curveLength: 0 },
      { id: 'v1', chainage: alignmentLength(road), elevation: 801, curveLength: 0 },
    ]
    const original = JSON.stringify(road)
    const analysis = analyzeRoad(road, { elevationAt: () => 800 }, DEFAULT_ROAD_SETTINGS)
    const curve = horizontalCurveSummary(road)[0]
    const onStation = vi.fn()
    await act(async () => {
      renderer = create(
        createElement(CurveReviewPanel, {
          alignment: road,
          analysis,
          station: 0,
          onStation,
          terrain: { kind: 'demo', name: 'UI fixture', resolutionM: 1, verticalReference: 'Test datum' },
        }),
      )
    })
    for (const [name, expected] of [
      ['TS', curve.fullStart],
      ['SC', curve.start],
      ['CS', curve.end],
      ['ST', curve.fullEnd],
    ] as const) {
      const button = renderer!.root
        .findAllByType('button')
        .find((node) => node.props['aria-label'] === `H1 ${name} station`)!
      await act(async () => button.props.onClick())
      expect(onStation).toHaveBeenLastCalledWith(expected)
    }
    const csv = renderer!.root.findAllByType('button').find((node) => node.children.includes('Curve CSV'))!
    await act(async () => csv.props.onClick())
    expect(downloadText).toHaveBeenCalledWith(
      expect.stringContaining('"UI fixture",1,"Test datum"'),
      'road-curve-review.csv',
      'text/csv',
    )
    expect(JSON.stringify(road)).toBe(original)
  })
})
