import { createElement, useEffect, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BRIDGE_RESET, useBackgroundRenders, type RenderJob, type RenderRunner } from './BackgroundRenders'
import { DEFAULT_ENGINE_ENVIRONMENT } from './externalRenderers'
import type { ScenePackage } from './scenePackage'

// The hook runs on `window` (message listener, timers, storage) and an iframe's `contentWindow`: both stubbed here,
// the engine page's messages dispatched by hand.
type Listener = (event: { source: unknown; origin: string; data: unknown }) => void
let listeners: Set<Listener>
const engineWindow = { postMessage: vi.fn() }
const send = (origin: string, data: unknown) =>
  listeners.forEach((listener) => listener({ source: engineWindow, origin, data }))

beforeEach(() => {
  listeners = new Set()
  engineWindow.postMessage.mockReset()
  vi.stubGlobal('window', {
    location: { href: 'http://127.0.0.1:5173/dev/forestry/visual-quality' },
    addEventListener: (type: string, listener: Listener) => type === 'message' && listeners.add(listener),
    removeEventListener: (type: string, listener: Listener) => type === 'message' && listeners.delete(listener),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    setInterval: globalThis.setInterval.bind(globalThis),
    clearInterval: globalThis.clearInterval.bind(globalThis),
  })
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterEach(() => vi.unstubAllGlobals())

const scene = {
  origin: { lng: -122.7, lat: 53.9 },
  camera: { position: [0, 0, 700], bearingDegrees: 30 },
} as unknown as ScenePackage

const job: RenderJob = {
  key: 'view-1|worldgen|scene',
  viewId: 'view-1',
  viewName: 'View 1',
  engine: 'worldgen',
  work: { frames: 1, width: 800, height: 400, samples: 8 },
}

describe('background renders', () => {
  it('puts a job back when the engine bridge is torn down mid-capture, rather than leaving it waiting', async () => {
    const seen: { current: ReturnType<typeof useBackgroundRenders> | null } = { current: null }
    function Host(props: { url: string; run: RenderRunner }): ReactNode {
      const renders = useBackgroundRenders({
        urlFor: () => props.url,
        environment: DEFAULT_ENGINE_ENVIRONMENT,
        run: props.run,
      })
      useEffect(() => {
        seen.current = renders
      })
      return renders.tray
    }
    let calls = 0
    // The first run asks for a capture the engine never gets to answer; the second finishes.
    const run: RenderRunner = async (_job, engine) => {
      calls++
      if (calls === 1) await engine.capture(scene, () => ({ type: 'pgmaps-capture', id: 'c1' }) as never)
    }
    const options = { createNodeMock: () => ({ contentWindow: engineWindow }) }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Host, { url: 'http://127.0.0.1:8460/', run }), options)
    })
    await act(async () => seen.current!.enqueue([job]))
    // The engine page (on the other loopback name, `separateSiteUrl`) says hello; the scene is posted to it.
    await act(async () => send('http://localhost:8460', { type: 'pgmaps-engine-hello' }))
    expect(
      engineWindow.postMessage.mock.calls.some(([data]) => (data as { type?: string }).type === 'pgmaps-scene'),
    ).toBe(true)
    expect(seen.current!.jobs[0].status).toBe('running')
    // The bridge re-subscribes (a hot reload re-runs its effect; here the engine page's address changes): the capture
    // in flight is rejected and the job drawn again, instead of waiting out the 15 min capture timeout.
    await act(async () => renderer.update(createElement(Host, { url: 'http://127.0.0.1:8461/', run })))
    await act(async () => {})
    expect(calls).toBe(2)
    expect(seen.current!.jobs[0]).toMatchObject({ status: 'done', error: null })
    expect(BRIDGE_RESET).toMatch(/reset/)
    await act(async () => renderer.unmount())
  })
})
