/**
 * The line to another engine drawing the road view (`externalRenderers.ts`), whichever way it runs: a page in a
 * frame, or a worker PGMaps starts itself. Both speak the same `pgmaps-engine` messages; the bridges
 * (`ExternalRoadRenderer.tsx`, `BackgroundRenders.tsx`) post and listen through an `EngineChannel` and never touch
 * the frame or the worker. Browser-only.
 */

export type EngineChannel = {
  /** A message to the engine, its buffers handed over. */
  post: (data: unknown, transfer?: Transferable[]) => void
  /**
   * Every message from the engine; returns the unsubscribe. Messages that came before anything listened (an engine's
   * hello can beat the bridge's first render) are handed to the first listener.
   */
  listen: (handler: (data: unknown) => void) => () => void
}

/** A running engine: its channel, and what stops it and lets go of its frame or worker. */
export type EngineConnection = { channel: EngineChannel; dispose: () => void }

/** Listeners, and what arrived before the first. */
function listeners() {
  const handlers = new Set<(data: unknown) => void>()
  let early: unknown[] | null = []
  return {
    emit: (data: unknown) => {
      if (early) early.push(data)
      else handlers.forEach((handler) => handler(data))
    },
    listen: (handler: (data: unknown) => void) => {
      handlers.add(handler)
      const held = early ?? []
      early = null
      held.forEach((data) => handler(data))
      return () => {
        handlers.delete(handler)
      }
    },
    clear: () => {
      handlers.clear()
      early = []
    },
  }
}

/** An engine page in `frame`: messages only from that frame's window and its origin. */
export function connectFrame(frame: HTMLIFrameElement, origin: string): EngineConnection {
  const out = listeners()
  const onMessage = (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== origin) return
    out.emit(event.data)
  }
  window.addEventListener('message', onMessage)
  return {
    channel: {
      post: (data, transfer = []) => frame.contentWindow?.postMessage(data, { targetOrigin: origin, transfer }),
      listen: out.listen,
    },
    dispose: () => {
      window.removeEventListener('message', onMessage)
      out.clear()
    },
  }
}

/**
 * Starts an engine's worker drawing into a canvas laid over `box`: the canvas is handed over as an OffscreenCanvas
 * (`pgmaps-worker-init`), the box's size follows it (`pgmaps-worker-viewport`), and the canvas is placed where the
 * engine says its drawing sits (`pgmaps-engine-viewport`, a letterboxed lens). A script that fails to load or a
 * worker that throws reaches the listeners as `pgmaps-engine-error`, like an engine's own.
 */
export function startEngineWorker(url: string, box: HTMLElement, label: string): EngineConnection {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('aria-hidden', 'true')
  Object.assign(canvas.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%' })
  box.appendChild(canvas)
  const viewport = () => ({
    width: Math.max(1, Math.round(box.clientWidth)),
    height: Math.max(1, Math.round(box.clientHeight)),
    pixelRatio: window.devicePixelRatio || 1,
  })
  const worker = new Worker(url, { type: 'module', name: label })
  const offscreen = canvas.transferControlToOffscreen()
  worker.postMessage({ type: 'pgmaps-worker-init', canvas: offscreen, viewport: viewport() }, [offscreen])

  const out = listeners()
  const emit = out.emit
  worker.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; left?: unknown; top?: unknown; width?: unknown; height?: unknown }
    if (data?.type === 'pgmaps-engine-viewport') {
      const px = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? `${value}px` : null)
      const [left, top, width, height] = [px(data.left), px(data.top), px(data.width), px(data.height)]
      if (left && top && width && height) Object.assign(canvas.style, { left, top, width, height })
      return
    }
    emit(event.data)
  })
  worker.addEventListener('error', (event: ErrorEvent) => {
    // A module that never loaded carries no message: most likely it was never built here.
    const message = event.message || `its script did not load (${url.split('?')[0]}). Run npm run engines:build.`
    emit({ type: 'pgmaps-engine-error', message })
  })
  worker.addEventListener('messageerror', () =>
    emit({ type: 'pgmaps-engine-error', message: 'a message could not be read.' }),
  )

  // The box's size, posted as it changes (not kept in React state: the worker is the only reader).
  let last = ''
  const observer = new ResizeObserver(() => {
    const next = viewport()
    const key = `${next.width}x${next.height}@${next.pixelRatio}`
    if (key === last) return
    last = key
    worker.postMessage({ type: 'pgmaps-worker-viewport', viewport: next })
  })
  observer.observe(box)

  return {
    channel: {
      post: (data, transfer = []) => worker.postMessage(data, transfer),
      listen: out.listen,
    },
    dispose: () => {
      observer.disconnect()
      out.clear()
      worker.terminate()
      canvas.remove()
    },
  }
}
