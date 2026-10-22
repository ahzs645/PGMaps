import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const workerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

function worker(fetchResponse: () => Promise<Response>, openCache: () => Promise<object>) {
  const listeners = new Map<string, (event: object) => void>()
  const match = vi.fn().mockResolvedValue(new Response('offline shell'))
  runInNewContext(workerSource, {
    self: {
      registration: { scope: 'https://example.com/' },
      location: { origin: 'https://example.com' },
      addEventListener: (type: string, listener: (event: object) => void) => listeners.set(type, listener),
    },
    URL,
    Request,
    caches: { open: openCache, match },
    fetch: fetchResponse,
  })
  const background: Promise<unknown>[] = []
  let response!: Promise<Response>
  listeners.get('fetch')!({
    request: { method: 'GET', url: 'https://example.com/pgdata?tab=crime', mode: 'navigate' },
    respondWith: (value: Promise<Response>) => {
      response = value
    },
    waitUntil: (value: Promise<unknown>) => {
      background.push(value)
      void value.catch(() => undefined)
    },
  })
  return { response, background, match }
}

describe('service worker navigation caching', () => {
  it('caches an independent response even when the browser consumes the body before the cache opens', async () => {
    let finishOpening!: (cache: object) => void
    const cacheReady = new Promise<object>((resolve) => {
      finishOpening = resolve
    })
    const networkResponse = new Response('app shell', { headers: { 'content-type': 'text/html' } })
    const put = vi.fn(async (_request, response: Response) => {
      expect(response.headers.get('content-type')).toBe('text/html')
      expect(await response.text()).toBe('app shell')
    })
    const { response, background } = worker(
      async () => networkResponse,
      () => cacheReady,
    )

    expect(await (await response).text()).toBe('app shell')
    expect(networkResponse.bodyUsed).toBe(true)
    finishOpening({ put })
    await Promise.all(background)
    expect(put).toHaveBeenCalledOnce()
  })

  it('returns unsuccessful network responses without caching them', async () => {
    const open = vi.fn()
    const { response, background } = worker(async () => new Response('unavailable', { status: 503 }), open)
    expect((await response).status).toBe(503)
    expect(background).toEqual([])
    expect(open).not.toHaveBeenCalled()
  })

  it('retains the offline shell fallback for failed navigation requests', async () => {
    const { response, match } = worker(async () => {
      throw new TypeError('offline')
    }, vi.fn())
    expect(await (await response).text()).toBe('offline shell')
    expect(match).toHaveBeenCalledWith('/index.html')
  })
})
