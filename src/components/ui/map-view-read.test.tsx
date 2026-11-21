import { useEffect } from 'react'
import { act, create } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'

import { useViewWindowRead, type ViewReadState } from './map-view-read'
import type { ViewWindow } from './map-view-window'

/** A map whose view the test sets and moves. */
function fakeMap(view: { bounds: [number, number, number, number]; zoom: number }) {
  const handlers = new Map<string, Set<() => void>>()
  const map = {
    getBounds: () => ({
      getWest: () => view.bounds[0],
      getSouth: () => view.bounds[1],
      getEast: () => view.bounds[2],
      getNorth: () => view.bounds[3],
    }),
    getZoom: () => view.zoom,
    isMoving: () => false,
    on: (type: string, handler: () => void) => {
      if (!handlers.has(type)) handlers.set(type, new Set())
      handlers.get(type)!.add(handler)
    },
    off: (type: string, handler: () => void) => handlers.get(type)?.delete(handler),
  }
  const fire = (type: string) => {
    for (const handler of [...(handlers.get(type) ?? [])]) handler()
  }
  return { map: map as unknown as MapLibreMap, fire, view }
}

type Deferred = {
  window: ViewWindow
  signal: AbortSignal
  resolve: (value: string) => void
  reject: (error: Error) => void
}

function harness(map: MapLibreMap, minZoom = 8) {
  const reads: Deferred[] = []
  const read = (window: ViewWindow, signal: AbortSignal) =>
    new Promise<string>((resolve, reject) => reads.push({ window, signal, resolve, reject }))
  const latest: { current: ViewReadState<string> | null } = { current: null }
  function Harness({ enabled, readKey }: { enabled: boolean; readKey?: string }) {
    const state = useViewWindowRead(map, { enabled, minZoom, readKey, read })
    useEffect(() => {
      latest.current = state
    })
    return null
  }
  return { reads, Harness, state: () => latest.current! }
}

describe('useViewWindowRead', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reads the window, and keeps the answer drawn while the next window is read', async () => {
    const fake = fakeMap({ bounds: [-125, 54, -124, 55], zoom: 10 })
    const { reads, Harness, state } = harness(fake.map)
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<Harness enabled />)
    })
    expect(reads).toHaveLength(1)
    expect(state().loading).toBe(true)
    await act(async () => reads[0].resolve('first'))
    expect(state()).toMatchObject({ data: 'first', loading: false, error: null })

    // Moving well outside the window asks for the next one while the first answer stays.
    fake.view.bounds = [-122, 54, -121, 55]
    await act(async () => {
      fake.fire('move')
      vi.advanceTimersByTime(300)
    })
    expect(reads).toHaveLength(2)
    expect(state()).toMatchObject({ data: 'first', loading: true })

    // A third window supersedes the second: its read is aborted and never lands.
    fake.view.bounds = [-119, 54, -118, 55]
    await act(async () => {
      fake.fire('move')
      vi.advanceTimersByTime(300)
    })
    expect(reads[1].signal.aborted).toBe(true)
    await act(async () => reads[1].resolve('stale'))
    expect(state().data).toBe('first')
    await act(async () => reads[2].resolve('third'))
    expect(state()).toMatchObject({ data: 'third', loading: false })
    renderer.unmount()
  })

  it('keeps the last answer when a read fails, and says so', async () => {
    const fake = fakeMap({ bounds: [-125, 54, -124, 55], zoom: 10 })
    const { reads, Harness, state } = harness(fake.map)
    await act(async () => {
      create(<Harness enabled readKey="moose" />)
    })
    await act(async () => reads[0].resolve('zones'))
    fake.view.bounds = [-122, 54, -121, 55]
    await act(async () => {
      fake.fire('move')
      vi.advanceTimersByTime(300)
    })
    await act(async () => reads[1].reject(new Error('DataBC answered 503')))
    expect(state()).toMatchObject({ data: 'zones', loading: false, error: 'DataBC answered 503' })
  })

  it('reads again for a new read key, dropping the old answer', async () => {
    const fake = fakeMap({ bounds: [-125, 54, -124, 55], zoom: 10 })
    const { reads, Harness, state } = harness(fake.map)
    let renderer!: ReturnType<typeof create>
    await act(async () => {
      renderer = create(<Harness enabled readKey="moose" />)
    })
    await act(async () => reads[0].resolve('moose zones'))
    await act(async () => renderer.update(<Harness enabled readKey="elk" />))
    expect(state().data).toBeNull()
    expect(reads).toHaveLength(2)
    await act(async () => reads[1].resolve('elk zones'))
    expect(state().data).toBe('elk zones')
  })

  it('reads nothing below its least zoom and says so', async () => {
    const fake = fakeMap({ bounds: [-130, 50, -115, 60], zoom: 6 })
    const { reads, Harness, state } = harness(fake.map)
    await act(async () => {
      create(<Harness enabled />)
    })
    expect(reads).toHaveLength(0)
    expect(state()).toMatchObject({ belowMinZoom: true, loading: false })
  })
})

describe('useViewWindowRead pacing', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('reads 1.5 × the view, and at most one window a throttle while the map moves', async () => {
    const fake = fakeMap({ bounds: [-125, 54, -124, 55], zoom: 10 })
    const { reads, Harness } = harness(fake.map)
    await act(async () => {
      create(<Harness enabled />)
    })
    const [west, , east] = reads[0].window.bounds
    expect(east - west).toBeCloseTo(1.5)
    // Twenty frames of a drag, 16 ms apart, each leaving the last window.
    for (let frame = 1; frame <= 20; frame++) {
      fake.view.bounds = [-125 + frame, 54, -124 + frame, 55]
      await act(async () => {
        fake.fire('move')
        vi.advanceTimersByTime(16)
      })
    }
    expect(reads.length).toBeLessThanOrEqual(3)
  })
})
