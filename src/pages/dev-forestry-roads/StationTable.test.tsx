import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeRoad, offsetCoordinate } from './engine'
import { STATION_COLUMNS } from './stationReport'
import { StationTable } from './StationTable'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Coordinate } from './types'

const origin: Coordinate = [-122.8, 53.9]
const analysis = analyzeRoad(
  {
    id: 'r',
    name: 'Road',
    color: '#16817a',
    points: [
      { id: 'a', coordinate: origin, radiusM: 0 },
      { id: 'b', coordinate: offsetCoordinate(origin, 0, 450), radiusM: 0 },
    ],
    vertical: [
      { id: 's', chainage: 0, elevation: 799, curveLength: 0 },
      { id: 'e', chainage: 450, elevation: 799, curveLength: 0 },
    ],
    template: { ...DEFAULT_TEMPLATE },
    overrides: [],
  },
  { elevationAt: () => 800 },
  DEFAULT_ROAD_SETTINGS,
)

// Count the cells the table formats: each call is one cell of one rendered row.
let cells = 0
const original = STATION_COLUMNS.map((c) => c.value)
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The toolbar's popovers schedule frames; the unit suite runs in Node.
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id))
  const listeners = { addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
  vi.stubGlobal('matchMedia', () => ({ matches: false, ...listeners }))
  cells = 0
  STATION_COLUMNS.forEach((c, i) => {
    c.value = (row) => {
      cells++
      return original[i](row)
    }
  })
})
afterEach(() => {
  STATION_COLUMNS.forEach((c, i) => (c.value = original[i]))
  vi.unstubAllGlobals()
})

describe('StationTable rendering', () => {
  it('does not redraw its rows when the page re-renders with the same road, and only two on a station change', () => {
    const onStation = () => {}
    const props = { analysis, station: 0, onStation }
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(StationTable, props))
    })
    const firstRender = cells
    const rows = analysis.stations.length
    expect(rows).toBeGreaterThan(10)
    expect(firstRender % rows).toBe(0)
    const perRow = firstRender / rows

    // A drainage click re-renders the page; the table's own props are unchanged.
    cells = 0
    act(() => renderer.update(createElement(StationTable, { ...props })))
    expect(cells).toBe(0)

    // Selecting another station redraws the row losing the selection and the row gaining it.
    act(() => renderer.update(createElement(StationTable, { ...props, station: 200 })))
    expect(cells).toBe(2 * perRow)
    act(() => renderer.unmount())
  })
})
