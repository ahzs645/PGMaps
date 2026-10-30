import { forwardRef, type ReactNode } from 'react'
import { act, create } from 'react-test-renderer'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchJson } from '@/lib/fetchJson'
import DevTransit from '../DevTransit'
import type { HeatGridSpec, TransitData, TravelResult } from './types'

vi.mock('@/lib/fetchJson', () => ({ fetchJson: vi.fn() }))
vi.mock('next-themes', () => ({ useTheme: () => ({ resolvedTheme: 'light' }) }))
vi.mock('@/components/layout/MapSectionLayout', () => ({
  MAP_SIDEBAR_CLASS: '',
  MapSectionLayout: ({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) => (
    <div>
      {sidebar}
      {children}
    </div>
  ),
}))
vi.mock('@/components/ui/map', () => ({
  Map: forwardRef(function Map({ children }: { children: ReactNode }, _ref) {
    return <div>{children}</div>
  }),
  MapControls: () => null,
  MapMarker: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MarkerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MapScaleBar: () => null,
}))
vi.mock('@/components/ui/map-panels', () => ({
  MapSidebarShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarSection: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  InlineAlert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  MapLegendPanel: () => null,
  MapSteppedLegend: () => null,
}))
vi.mock('./PlaceSearch', () => ({ PlaceSearch: () => null }))
vi.mock('./TravelLayers', () => ({
  TravelLayers: () => null,
  MapPicking: () => null,
  MapHeatViewport: ({ onChange }: { onChange: (grid: HeatGridSpec) => void }) => (
    <button data-grid-control onClick={() => onChange({ bbox: [-123, 53, -122, 54], cols: 2, rows: 2 })}>
      Publish viewport
    </button>
  ),
}))

class TestWorker {
  static instances: TestWorker[] = []
  postMessage = vi.fn()
  terminate = vi.fn()
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  constructor() {
    TestWorker.instances.push(this)
  }
  reply(id: number, result: TravelResult) {
    this.onmessage?.({ data: { id, result } } as MessageEvent)
  }
}
const snapshot: TransitData = {
  schema: 'pg-travel-time-v1',
  meta: {
    referenceDate: '2026-01-01',
    feedStart: '2026-01-01',
    feedEnd: '2026-12-31',
    sourceUrl: '',
    walkMetersPerSecond: 1.25,
    bbox: [-123, 53, -122, 54],
  },
  routes: [],
  stops: [],
  patterns: [],
  trips: [],
  connections: [],
  walkNodes: [],
  walkEdges: [],
  transfers: [],
  grid: { rows: 1, cols: 1, cells: [null] },
}
const result: TravelResult = {
  grid: [],
  stopMinutes: [],
  reachableStops: 0,
  journey: null,
  originOnNetwork: true,
  destinationOnNetwork: true,
}
let view: ReturnType<typeof create> | undefined
afterEach(() => {
  if (view) act(() => view?.unmount())
  view = undefined
  vi.unstubAllGlobals()
})

describe('transit calculation completion state', () => {
  it('keeps the latest request busy through stale replies and sends only the newest pending calculation', async () => {
    TestWorker.instances.length = 0
    vi.stubGlobal('Worker', TestWorker)
    vi.mocked(fetchJson).mockResolvedValue(snapshot)
    await act(async () => {
      view = create(
        <MemoryRouter>
          <DevTransit />
        </MemoryRouter>,
      )
    })
    const worker = TestWorker.instances[0]
    const busy = () =>
      view!.root.findAllByType('div').find((node) => node.props['aria-busy'] !== undefined)!.props['aria-busy']
    const departure = () => view!.root.findByProps({ 'aria-label': 'Departure time' })
    expect(busy()).toBe(true)
    act(() => view!.root.findByProps({ 'data-grid-control': true }).props.onClick())
    const first = worker.postMessage.mock.calls[1][0]
    act(() => departure().props.onChange({ target: { value: '09:00' } }))
    act(() => departure().props.onChange({ target: { value: '10:00' } }))
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
    act(() => worker.reply(first.id, result))
    expect(busy()).toBe(true)
    expect(worker.postMessage).toHaveBeenCalledTimes(3)
    const newest = worker.postMessage.mock.calls[2][0]
    expect(newest.options.departure).toBe(10 * 3600)
    expect(newest).not.toHaveProperty('input')
    expect(newest).not.toHaveProperty('data')
    act(() => worker.reply(first.id, result))
    expect(busy()).toBe(true)
    act(() => worker.reply(newest.id, result))
    expect(busy()).toBe(false)
    act(() => departure().props.onChange({ target: { value: '11:00' } }))
    expect(busy()).toBe(true)
    act(() => worker.onerror?.())
    expect(busy()).toBe(false)
  })
})
