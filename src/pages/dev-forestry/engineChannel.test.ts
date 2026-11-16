import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectFrame } from './engineChannel'

// The frame's window and the page's `message` listeners, stubbed: messages are dispatched by hand.
type Listener = (event: { source: unknown; origin: string; data: unknown }) => void
let listeners: Set<Listener>
const engineWindow = { postMessage: vi.fn() }
const frame = { contentWindow: engineWindow } as unknown as HTMLIFrameElement
const send = (data: unknown, source: unknown = engineWindow, origin = 'http://127.0.0.1:8461') =>
  listeners.forEach((listener) => listener({ source, origin, data }))

beforeEach(() => {
  listeners = new Set()
  engineWindow.postMessage.mockReset()
  vi.stubGlobal('window', {
    addEventListener: (type: string, listener: Listener) => type === 'message' && listeners.add(listener),
    removeEventListener: (type: string, listener: Listener) => type === 'message' && listeners.delete(listener),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('engine channel', () => {
  it('hands an engine’s early messages to the first listener, then passes them through', () => {
    const { channel, dispose } = connectFrame(frame, 'http://127.0.0.1:8461')
    send({ type: 'pgmaps-engine-hello' })
    const seen: unknown[] = []
    const stop = channel.listen((data) => seen.push(data))
    expect(seen).toEqual([{ type: 'pgmaps-engine-hello' }])
    send({ type: 'pgmaps-engine-ready' })
    expect(seen).toHaveLength(2)
    stop()
    send({ type: 'pgmaps-engine-stats' })
    expect(seen).toHaveLength(2)
    dispose()
    expect(listeners.size).toBe(0)
  })

  it('listens only to its own frame at its own origin, and posts there', () => {
    const { channel, dispose } = connectFrame(frame, 'http://127.0.0.1:8461')
    const seen: unknown[] = []
    channel.listen((data) => seen.push(data))
    send({ type: 'pgmaps-engine-hello' }, {}, 'http://127.0.0.1:8461')
    send({ type: 'pgmaps-engine-hello' }, engineWindow, 'http://evil.example')
    expect(seen).toEqual([])
    const buffer = new ArrayBuffer(8)
    channel.post({ type: 'pgmaps-scene' }, [buffer])
    expect(engineWindow.postMessage).toHaveBeenCalledWith(
      { type: 'pgmaps-scene' },
      { targetOrigin: 'http://127.0.0.1:8461', transfer: [buffer] },
    )
    dispose()
  })
})
