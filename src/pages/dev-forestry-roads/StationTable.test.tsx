import { createElement, type ReactNode } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NumberField } from '@/components/ui/form-field'
import { downloadText } from '@/lib/download'
import { RoadSelect } from './Controls'
import { analyzeRoad, offsetCoordinate } from './engine'
import { reportingRows, stationReportCsv, STATION_COLUMNS } from './stationReport'
import { StationTable } from './StationTable'
import { DEFAULT_ROAD_SETTINGS, DEFAULT_TEMPLATE } from './terrain'
import type { Coordinate } from './types'

vi.mock('@/lib/download', () => ({ downloadText: vi.fn() }))
// Preserve the toolbar's open state without requiring a browser portal.
vi.mock('@/components/ui/anchored-popover', () => ({
  AnchoredPopover: ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? createElement('div', null, children) : null,
}))
vi.mock('@/components/ui/info-tip', () => ({
  InfoTip: ({ children, label }: { children: ReactNode; label: string }) =>
    createElement('aside', { 'aria-label': label }, children),
}))
vi.mock('@/components/ui/styled-select', async (actual) => ({
  ...(await actual<typeof import('@/components/ui/styled-select')>()),
  StyledSelect: (await import('@/components/ui/styledSelectTestDouble')).StyledSelectTestDouble,
}))

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
let renderer: ReactTestRenderer | undefined
const original = STATION_COLUMNS.map((c) => c.value)
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  // The toolbar's popovers schedule frames; the unit suite runs in Node.
  vi.stubGlobal('window', globalThis)
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id))
  const listeners = { addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }
  vi.stubGlobal('matchMedia', () => ({ matches: false, ...listeners }))
  const stored = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  })
  vi.mocked(downloadText).mockClear()
  cells = 0
  STATION_COLUMNS.forEach((c, i) => {
    c.value = (row) => {
      cells++
      return original[i](row)
    }
  })
})

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === 'string' ? node : node.children.map(textOf).join('')
const buttonNamed = (root: ReactTestInstance, name: string) =>
  root.find((node) => node.type === 'button' && (node.props['aria-label'] === name || textOf(node) === name))
const headers = (root: ReactTestInstance) => root.findByType('thead').findAllByType('th').map(textOf)
const columnRow = (root: ReactTestInstance, id: string) =>
  root.find((node) => node.type === 'li' && node.props['data-contents-row'] === id)

describe('StationTable column choices and downloads', () => {
  it('reorders columns with the keyboard, restores their saved order and keeps unavailable column preferences', () => {
    const props = { analysis, station: 0, onStation: () => {} }
    localStorage.setItem(
      'pgmaps-road-station-column-order-v1',
      JSON.stringify(['ground', 'material:rock', 'formation']),
    )
    act(() => {
      renderer = create(createElement(StationTable, props))
    })
    act(() => buttonNamed(renderer!.root, 'Choose columns').props.onClick())
    const event = { altKey: true, key: 'ArrowUp', target: null, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    act(() => columnRow(renderer!.root, 'formation').props.onKeyDownCapture(event))
    expect(event.preventDefault).toHaveBeenCalled()
    expect(headers(renderer!.root).slice(0, 3)).toEqual(['L-Stnm', 'Formationm', 'Groundm'])
    const saved: string[] = JSON.parse(localStorage.getItem('pgmaps-road-station-column-order-v1')!)
    expect(saved).toContain('material:rock')
    expect(saved.indexOf('formation')).toBeLessThan(saved.indexOf('ground'))

    act(() => renderer!.unmount())
    act(() => {
      renderer = create(createElement(StationTable, props))
    })
    expect(headers(renderer!.root).slice(0, 3)).toEqual(['L-Stnm', 'Formationm', 'Groundm'])
    act(() => buttonNamed(renderer!.root, 'Choose columns').props.onClick())
    act(() => buttonNamed(renderer!.root, 'Usual order').props.onClick())
    expect(headers(renderer!.root).slice(0, 3)).toEqual(['L-Stnm', 'Groundm', 'Formationm'])
  })

  it('exports the shown rows and column order while the full export keeps all reported rows and columns', () => {
    localStorage.setItem(
      'pgmaps-road-station-columns-v2',
      JSON.stringify(
        Object.fromEntries(STATION_COLUMNS.map((c) => [c.id, ['ground', 'formation', 'cutVolume'].includes(c.id)])),
      ),
    )
    localStorage.setItem('pgmaps-road-station-column-order-v1', JSON.stringify(['formation', 'ground', 'cutVolume']))
    const flagged = {
      ...analysis,
      stations: analysis.stations.map((s) => ({ ...s, flags: s.chainage === 200 ? ['Review this station'] : [] })),
    }
    act(() => {
      renderer = create(
        createElement(StationTable, { analysis: flagged, station: 0, onStation: () => {}, roadName: 'West Spur 7' }),
      )
    })
    act(() => buttonNamed(renderer!.root, 'Choose columns').props.onClick())
    act(() =>
      columnRow(renderer!.root, 'ground')
        .findByType('input')
        .props.onChange({ target: { checked: false } }),
    )
    act(() => buttonNamed(renderer!.root, 'Choose columns').props.onClick())
    act(() => buttonNamed(renderer!.root, 'Filter stations').props.onClick())
    act(() =>
      renderer!.root
        .findAllByType(NumberField)
        .find((field) => field.props['aria-label'] === 'Station table range start')!
        .props.onValueChange(100),
    )
    act(() =>
      renderer!.root
        .findAllByType(NumberField)
        .find((field) => field.props['aria-label'] === 'Station table range end')!
        .props.onValueChange(300),
    )
    act(() => renderer!.root.findByType(RoadSelect).props.onValueChange('100'))
    act(() =>
      renderer!.root
        .find((node) => node.type === 'input' && node.props.type === 'checkbox')
        .props.onChange({ target: { checked: true } }),
    )
    act(() => buttonNamed(renderer!.root, 'Download table as CSV').props.onClick())
    act(() => buttonNamed(renderer!.root, 'Shown rows and columns').props.onClick())

    const [shownCsv, shownName] = vi.mocked(downloadText).mock.calls[0]
    const shownLines = shownCsv.trimEnd().split('\r\n')
    expect(shownName).toBe('West-Spur-7-volumes-100m-shown.csv')
    expect(shownLines[0]).toBe('station_m,design_elevation_m,cut_volume_bank_m3,unknown_earthwork_m,flags')
    expect(shownLines).toHaveLength(3)
    expect(shownLines[1].split(',')[0]).toBe('200')
    expect(shownLines[1]).toContain('Review this station')
    expect(shownLines[2].split(',')[2]).toBe(shownLines[1].split(',')[2])

    act(() => buttonNamed(renderer!.root, 'Download table as CSV').props.onClick())
    act(() => buttonNamed(renderer!.root, 'All rows and columns').props.onClick())
    const [fullCsv, fullName] = vi.mocked(downloadText).mock.calls[1]
    const reported = reportingRows(
      flagged,
      flagged.stations.filter((s) => s.chainage >= 100 && s.chainage <= 300),
      100,
    )
    expect(fullName).toBe('West-Spur-7-volumes-100m.csv')
    expect(fullCsv).toBe(stationReportCsv(flagged, reported))
    expect(fullCsv.trimEnd().split('\r\n')).toHaveLength(5)
    expect(fullCsv.split('\r\n')[0]).toContain('ground_elevation_m,design_elevation_m,design_grade_pct')
  })

  it('disables both CSV choices while results leave invalid input out', () => {
    act(() => {
      renderer = create(
        createElement(StationTable, {
          analysis: { ...analysis, invalidInput: { message: 'Invalid section input' } },
          station: 0,
          onStation: () => {},
        }),
      )
    })
    act(() => buttonNamed(renderer!.root, 'Download table as CSV').props.onClick())
    expect(buttonNamed(renderer!.root, 'Shown rows and columns').props.disabled).toBe(true)
    expect(buttonNamed(renderer!.root, 'All rows and columns').props.disabled).toBe(true)
    expect(downloadText).not.toHaveBeenCalled()
  })
})
afterEach(() => {
  act(() => renderer?.unmount())
  renderer = undefined
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
