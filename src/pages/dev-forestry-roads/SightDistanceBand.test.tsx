import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { SightDistanceBand } from './SightDistanceBand'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import { TurnoutSightTable } from './TurnoutSightTable'
import { reviewTurnoutSight } from './turnoutSight'
import type { Alignment, Coordinate, TerrainSource, WidthOverride } from './types'

vi.mock('@pgmaps/geo-toolkit/visualizations/react', () => ({
  SizedChart: ({ children }: { children: (width: number) => ReactNode }) => children(640),
}))

const origin: Coordinate = [-122.75, 53.917]
const at = (east: number, northing: number) =>
  offsetCoordinate(origin, (Math.atan2(east, northing) * 180) / Math.PI, Math.hypot(east, northing))
const local = (lon: number, lat: number) => ({
  north: (((lat - origin[1]) * Math.PI) / 180) * 6371008.8,
  east: (((lon - origin[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((origin[1] * Math.PI) / 180),
})
/** A 15 m knoll inside the right turn; the road stays level. */
const knoll: TerrainSource = {
  elevationAt: (lon, lat) => {
    const p = local(lon, lat)
    return 800 + (Math.hypot(p.east - 40, p.north - 170) < 30 ? 15 : 0)
  },
}
const turnout = (id: string, start: number): WidthOverride => ({
  id,
  name: `T${id}`,
  kind: 'turnout',
  start,
  end: start + 30,
  taper: 7.5,
  side: 'right',
  extraWidth: 4,
})
const road: Alignment = {
  id: 'spur',
  name: 'Spur',
  color: '#16817a',
  points: [
    { id: 'a', coordinate: at(0, 0), radiusM: 0 },
    { id: 'b', coordinate: at(0, 200), radiusM: 40 },
    { id: 'c', coordinate: at(200, 260), radiusM: 0 },
  ],
  vertical: [],
  template: { ...DEFAULT_TEMPLATE },
  overrides: [turnout('1', 20), turnout('2', 140), turnout('3', 260)],
}
const analysis = analyzeRoad(road, knoll, DEFAULT_ROAD_SETTINGS)

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  renderer = undefined
})

describe('sight distance band under the profile', () => {
  it('bars the distance seen against the distance needed, and steps between eye stations by key', async () => {
    const onStation = vi.fn()
    const sight = { standards: { designSpeedKmh: 50 }, stationIntervalM: 10 }
    await act(async () => {
      renderer = create(createElement(SightDistanceBand, { analysis, alignment: road, sight, station: 100, onStation }))
    })
    const band = renderer!.root.find((node) => node.props['data-testid'] === 'road-sight-band')
    expect(band.props['data-short']).toBeGreaterThan(0)
    const bars = renderer!.root.findAll((node) => node.props['data-testid'] === 'road-sight-band-bar')
    expect(bars.some((bar) => bar.props['data-state'] === 'short')).toBe(true)
    expect(bars.some((bar) => bar.props['data-state'] === 'clear')).toBe(true)
    const svg = renderer!.root.findByType('svg')
    await act(async () => svg.props.onKeyDown({ key: 'ArrowRight', preventDefault: vi.fn() }))
    expect(onStation).toHaveBeenLastCalledWith(110)
    await act(async () => svg.props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() }))
    expect(onStation).toHaveBeenLastCalledWith(90)
  })
  it('draws nothing without a design speed', async () => {
    await act(async () => {
      renderer = create(
        createElement(SightDistanceBand, {
          analysis,
          alignment: road,
          sight: { standards: { designSpeedKmh: null } },
          station: 0,
          onStation: vi.fn(),
        }),
      )
    })
    expect(renderer!.toJSON()).toBeNull()
  })
})

describe('turnout list', () => {
  it('lists each pair both ways and selects the first turnout by click or Enter', async () => {
    const onStation = vi.fn()
    const review = reviewTurnoutSight({ analysis, alignment: road })
    await act(async () => {
      renderer = create(createElement(TurnoutSightTable, { review, station: 0, onStation }))
    })
    const rows = renderer!.root.findAll((node) => node.props['data-testid'] === 'road-turnout-pair')
    expect(rows.map((row) => row.props['data-intervisible'])).toEqual(['true', 'false'])
    await act(async () => rows[1].props.onKeyDown({ key: 'Enter', preventDefault: vi.fn() }))
    expect(onStation).toHaveBeenCalledWith(review.pairs[1].from.chainage)
  })
})
