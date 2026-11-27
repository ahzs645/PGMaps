import { createElement, useEffect, type ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BRIDGE_RESET, useBackgroundRenders, type RenderJob, type RenderRunner } from './BackgroundRenders'
import { DEFAULT_ENGINE_ENVIRONMENT } from './externalRenderers'
import type { ScenePackage } from './scenePackage'
import { DEFAULT_ENGINE_RENDER_OPTIONS } from './engineRenderOptions'
import type { EngineCaptureRequest } from './engineCapture'

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
  trees: {
    fields: ['x', 'y', 'z', 'species', 'height', 'crownWidth', 'tone'],
    species: ['spruce'],
    count: 0,
    data: [],
  },
  species: {},
  terrain: {},
} as unknown as ScenePackage

const job: RenderJob = {
  key: 'view-1|worldgen|scene',
  viewId: 'view-1',
  viewName: 'View 1',
  engine: 'worldgen',
  work: { frames: 1, width: 800, height: 400, samples: 8 },
}

describe('background renders', () => {
  it('does not post a late-built request after a GPU error rejects its job', async () => {
    const seen: { current: ReturnType<typeof useBackgroundRenders> | null } = { current: null }
    let complete!: (request: EngineCaptureRequest) => void
    const making = new Promise<EngineCaptureRequest>((resolve) => {
      complete = resolve
    })
    function Host(): ReactNode {
      const renders = useBackgroundRenders({
        urlFor: () => 'http://127.0.0.1:8460/',
        environment: DEFAULT_ENGINE_ENVIRONMENT,
        run: async (_job, engine) => {
          await engine.capture(scene, () => making)
        },
      })
      useEffect(() => {
        seen.current = renders
      })
      return renders.tray
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Host), {
        createNodeMock: (element) => (element.type === 'iframe' ? { contentWindow: engineWindow } : null),
      })
    })
    await act(async () => seen.current!.enqueue([job]))
    await act(async () => send('http://localhost:8460', { type: 'pgmaps-engine-hello' }))
    await act(async () => send('http://localhost:8460', { type: 'pgmaps-engine-ready' }))
    await act(async () => send('http://localhost:8460', { type: 'pgmaps-engine-error', message: 'device lost' }))
    expect(seen.current!.jobs[0]).toMatchObject({ status: 'error', error: expect.stringContaining('device lost') })
    await act(async () =>
      complete({
        type: 'pgmaps-capture',
        id: 'too-late',
        position: [0, 0, 700],
        frames: [],
        classes: { terrain: [0, 0, 0], vegetation: [1, 1, 1], water: [2, 2, 2], layers: [] },
      }),
    )
    expect(engineWindow.postMessage.mock.calls.some(([data]) => data.type === 'pgmaps-capture')).toBe(false)
    await act(async () => renderer.unmount())
  })
  it('posts the queued quality snapshot through the progress wrapper after the scene is ready', async () => {
    const seen: { current: ReturnType<typeof useBackgroundRenders> | null } = { current: null }
    function Host(): ReactNode {
      const renders = useBackgroundRenders({
        urlFor: () => 'http://127.0.0.1:8460/',
        environment: DEFAULT_ENGINE_ENVIRONMENT,
        run: async (_job, engine) => {
          await engine.capture(scene, (_pkg, options) => ({
            type: 'pgmaps-capture',
            id: 'frozen',
            quality: 'final',
            canopyCutoffPx: options?.dissolvePixels,
            position: [0, 0, 700],
            frames: [],
            classes: { terrain: [0, 0, 0], vegetation: [1, 1, 1], water: [2, 2, 2], layers: [] },
          }))
        },
      })
      useEffect(() => {
        seen.current = renders
      })
      return renders.tray
    }
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Host), {
        createNodeMock: (element) => (element.type === 'iframe' ? { contentWindow: engineWindow } : null),
      })
    })
    const queued = { ...job, renderOptions: { ...DEFAULT_ENGINE_RENDER_OPTIONS, dissolvePixels: 8 } }
    await act(async () => seen.current!.enqueue([queued]))
    queued.renderOptions.dissolvePixels = 1
    await act(async () =>
      send('http://localhost:8460', { type: 'pgmaps-engine-hello', accepts: ['render-options-v1'] }),
    )
    await act(async () => send('http://localhost:8460', { type: 'pgmaps-engine-ready' }))
    const posted = engineWindow.postMessage.mock.calls
      .map(([data]) => data)
      .find((data) => data.type === 'pgmaps-capture')
    expect(posted.renderOptions).toMatchObject({ dissolvePixels: 8, dissolveMode: 'relative' })
    expect(posted.canopyCutoffPx).toBe(8)
    expect(posted.renderOptions).not.toBe(queued.renderOptions)
    await act(async () => send('http://localhost:8460', { type: 'pgmaps-engine-capture', id: 'frozen' }))
    expect(seen.current!.jobs[0].status).toBe('done')
    await act(async () => renderer.unmount())
  })
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
  it('restarts the engine between places without losing a queued job, each job after it waiting for a new hello', async () => {
    const seen: { current: ReturnType<typeof useBackgroundRenders> | null } = { current: null }
    const ran: string[] = []
    let release!: () => void
    const held = new Promise<void>((resolve) => (release = resolve))
    const run: RenderRunner = async (entry) => {
      ran.push(entry.key)
      if (entry.key === 'held') await held
    }
    function Host(): ReactNode {
      const renders = useBackgroundRenders({
        urlFor: () => 'http://127.0.0.1:8460/',
        environment: DEFAULT_ENGINE_ENVIRONMENT,
        run,
      })
      useEffect(() => {
        seen.current = renders
      })
      return renders.tray
    }
    let frames = 0
    const options = {
      createNodeMock: (element: { type: unknown }) => {
        if (element.type !== 'iframe') return null
        frames++
        return { contentWindow: engineWindow }
      },
    }
    const hello = () => act(async () => send('http://localhost:8460', { type: 'pgmaps-engine-hello' }))
    const status = () => Object.fromEntries(seen.current!.jobs.map((entry) => [entry.job.key, entry.status]))
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(Host), options)
    })
    // The first place: drawn once the engine says hello.
    await act(async () => seen.current!.enqueue([{ ...job, key: 'first' }]))
    await hello()
    expect(status()).toEqual({ first: 'done' })
    const framesBefore = frames
    // Between places, with nothing running: the engine is started again at once.
    await act(async () => seen.current!.restartEngine())
    expect(frames).toBeGreaterThan(framesBefore)
    // The next place's job waits for the new engine's hello rather than posting to the one that went.
    await act(async () => seen.current!.enqueue([{ ...job, key: 'held' }]))
    expect(ran).toEqual(['first'])
    expect(status().held).toBe('running')
    await hello()
    expect(ran).toEqual(['first', 'held'])
    // A restart asked while a job runs waits for it, and the job queued behind it is kept, then drawn after a hello.
    await act(async () => seen.current!.enqueue([{ ...job, key: 'queued' }]))
    const framesRunning = frames
    await act(async () => seen.current!.restartEngine())
    expect(frames).toBe(framesRunning)
    expect(status()).toMatchObject({ held: 'running', queued: 'waiting' })
    await act(async () => release())
    expect(frames).toBeGreaterThan(framesRunning)
    expect(status()).toMatchObject({ held: 'done', queued: 'running' })
    expect(ran).toEqual(['first', 'held'])
    await hello()
    expect(ran).toEqual(['first', 'held', 'queued'])
    expect(status()).toEqual({ first: 'done', held: 'done', queued: 'done' })
    // The engine's box stays in the tray throughout.
    expect(renderer.root.findAllByType('iframe')).toHaveLength(1)
    await act(async () => renderer.unmount())
  })
})
