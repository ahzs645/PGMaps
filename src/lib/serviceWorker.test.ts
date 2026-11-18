import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'

const workerSource = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

function worker(
  fetchResponse: () => Promise<Response>,
  openCache: () => Promise<object>,
  {
    request = { method: 'GET', url: 'https://example.com/pgdata?tab=crime', mode: 'navigate' },
    search = '',
  }: { request?: object; search?: string } = {},
) {
  const listeners = new Map<string, (event: object) => void>()
  const match = vi.fn().mockResolvedValue(new Response('offline shell'))
  runInNewContext(workerSource, {
    self: {
      registration: { scope: 'https://example.com/' },
      location: { origin: 'https://example.com', search },
      addEventListener: (type: string, listener: (event: object) => void) => listeners.set(type, listener),
    },
    URL,
    URLSearchParams,
    Request,
    caches: { open: openCache, match },
    fetch: fetchResponse,
  })
  const background: Promise<unknown>[] = []
  let response!: Promise<Response>
  listeners.get('fetch')!({
    request,
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

describe('service worker data hosts', () => {
  const remoteRequest = { method: 'GET', url: 'https://data.example.org/data/census/a.geojson', mode: 'cors' }

  it('applies the data cache rules to a host passed in the registration URL', async () => {
    const network = vi.fn(async () => new Response('{}'))
    const { response, background } = worker(network, vi.fn(), {
      request: remoteRequest,
      search: '?dataOrigins=https%3A%2F%2Fdata.example.org',
    })
    // The harness's cache always has a copy: stale-while-revalidate serves it
    // and refreshes from the data host in the background.
    expect(await (await response).text()).toBe('offline shell')
    expect(network).toHaveBeenCalledWith(remoteRequest)
    expect(background).toHaveLength(1)
  })

  it('leaves other origins to the browser', () => {
    const { response } = worker(async () => new Response('{}'), vi.fn(), { request: remoteRequest })
    expect(response).toBeUndefined()
  })
})

describe('service worker configuration files', () => {
  it('serves the road workspace layouts from the network even when a cached copy exists', async () => {
    const request = { method: 'GET', url: 'https://example.com/workspace-layouts.json', mode: 'cors' }
    const put = vi.fn()
    const network = vi.fn(async () => new Response('[{"id":"fresh"}]'))
    const { response } = worker(network, async () => ({ put }), { request })
    // The harness's cache always holds 'offline shell'; a changed layout file must win over it.
    expect(await (await response).text()).toBe('[{"id":"fresh"}]')
    expect(network).toHaveBeenCalledWith(request, { cache: 'no-cache' })
    expect(put).toHaveBeenCalledOnce()
  })
})

// ---------------------------------------------------------------------------------------------
// Offline rules, run against a working stand-in for Cache Storage and the network.
// ---------------------------------------------------------------------------------------------

const ORIGIN = 'https://example.com'
const DAY = 24 * 60 * 60 * 1000
type Stored = { body: ArrayBuffer; status: number; headers: [string, string][] }

class FakeCache {
  entries = new Map<string, Stored>()
  private key(request: string | { url: string }) {
    return new URL(typeof request === 'string' ? request : request.url, ORIGIN).href
  }
  async match(request: string | { url: string }) {
    const stored = this.entries.get(this.key(request))
    return stored ? new Response(stored.body.slice(0), { status: stored.status, headers: stored.headers }) : undefined
  }
  async put(request: string | { url: string }, response: Response) {
    this.entries.set(this.key(request), {
      body: await response.arrayBuffer(),
      status: response.status,
      headers: [...response.headers],
    })
  }
  async delete(request: string | { url: string }) {
    return this.entries.delete(this.key(request))
  }
  async keys() {
    return [...this.entries.keys()].map((url) => ({ url }))
  }
}

function offlineWorker({ search = '' }: { search?: string } = {}) {
  const stores = new Map<string, FakeCache>()
  const cacheOf = (name: string) => stores.get(name) ?? stores.set(name, new FakeCache()).get(name)!
  const clock = { now: Date.UTC(2026, 10, 18) }
  const network = new Map<string, () => Response>()
  const state = {
    online: true,
    requests: [] as string[],
    matchOptions: [] as Array<object | undefined>,
    /** What `navigator.storage.estimate()` answers; absent as in a browser without it. */
    estimate: undefined as { usage: number; quota: number } | undefined,
    /** Cache names whose next write is refused for lack of room. */
    full: new Set<string>(),
  }
  const listeners = new Map<string, (event: object) => void>()

  const fetchStub = async (input: string | { url: string }) => {
    const url = new URL(typeof input === 'string' ? input : input.url, ORIGIN).href
    state.requests.push(url)
    if (!state.online) throw new TypeError('Failed to fetch')
    return network.get(url)?.() ?? new Response('not found', { status: 404 })
  }
  const caches = {
    open: async (name: string) => {
      const cache = cacheOf(name)
      if (!state.full.has(name)) return cache
      return Object.assign(Object.create(cache) as FakeCache, {
        put: async () => {
          state.full.delete(name)
          throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' })
        },
      })
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (request: string | { url: string }, options?: object) => {
      state.matchOptions.push(options)
      for (const store of stores.values()) {
        const hit = await store.match(request)
        if (hit) return hit
      }
      return undefined
    },
  }
  runInNewContext(workerSource, {
    self: {
      registration: { scope: `${ORIGIN}/` },
      location: { origin: ORIGIN, search },
      addEventListener: (type: string, listener: (event: object) => void) => listeners.set(type, listener),
      clients: { claim: () => undefined },
      skipWaiting: () => undefined,
    },
    URL,
    URLSearchParams,
    Request,
    Response,
    Headers,
    Date: { now: () => clock.now, parse: Date.parse },
    navigator: { storage: { estimate: async () => state.estimate ?? {} } },
    caches,
    fetch: fetchStub,
  })

  /** Dispatch an event and wait for everything it started. */
  async function dispatch(type: string, init: object = {}) {
    const background: Promise<unknown>[] = []
    let response: Promise<Response> | undefined
    listeners.get(type)!({
      ...init,
      respondWith: (value: Promise<Response>) => {
        response = value
      },
      waitUntil: (value: Promise<unknown>) => {
        background.push(Promise.resolve(value).catch(() => undefined))
      },
    })
    const settled = response
      ? await response.then(
          (value) => ({ value }),
          (error) => ({ error }),
        )
      : undefined
    // waitUntil may be called while the response is being produced: drain until none are added.
    for (let done = 0; done < background.length; done = background.length) await Promise.all(background)
    return settled
  }

  return {
    stores,
    cacheOf,
    clock,
    network,
    state,
    serve: (path: string, body = path, headers: Record<string, string> = {}) =>
      network.set(new URL(path, ORIGIN).href, () => new Response(body, { headers })),
    async get(url: string, headers: Record<string, string> = {}, mode = 'cors') {
      const settled = await dispatch('fetch', {
        request: { method: 'GET', url: new URL(url, ORIGIN).href, mode, headers: new Headers(headers) },
      })
      if (!settled) return undefined
      if ('error' in settled) throw settled.error
      return settled.value
    },
    activate: () => dispatch('activate'),
    async message(data: object) {
      let reply: unknown
      await dispatch('message', { data, ports: [{ postMessage: (value: unknown) => (reply = value) }] })
      return reply as {
        build: string | null
        deployed: boolean
        shell: { files: number; held: number } | null
        groups: Record<string, { kept: boolean; files: number; held: number; bytes: number }>
      }
    },
  }
}

const MANIFEST = {
  version: 1,
  build: 'build-one',
  shell: ['assets/app-aaaa.js', 'assets/app-cccc.css'],
  shellExtras: ['favicon.svg'],
  shellBytes: 2,
  groups: {
    'road-design': {
      files: ['assets/Roads-dddd.js', 'assets/map-worker-jjjj.mjs', 'assets/cable-llll.wasm'],
      extras: ['workspace-layouts.json'],
      bytes: 3,
      deferred: [{ file: 'assets/big-kkkk.wasm', bytes: 9 }],
    },
    'visual-quality': { files: ['assets/Visuals-eeee.js'], extras: [] as string[], bytes: 1, deferred: [] },
  },
}

function deployed(worker: ReturnType<typeof offlineWorker>, manifest: typeof MANIFEST = MANIFEST) {
  worker.network.set(`${ORIGIN}/offline-precache.json`, () => Response.json(manifest))
  const groups = Object.values(manifest.groups)
  for (const file of [
    ...manifest.shell,
    ...manifest.shellExtras,
    ...groups.flatMap((group) => [...group.files, ...group.extras]),
  ]) {
    if (!worker.network.has(`${ORIGIN}/${file}`)) worker.serve(`/${file}`)
  }
}

describe('service worker hashed assets', () => {
  it.each(['/assets/maplibre-gl-worker-Boc9pDRP.mjs', '/assets/whitebox-CYg2P.wasm', '/assets/Inter-8H_GOyWV.ttf'])(
    'keeps %s so it loads with no network',
    async (path) => {
      const worker = offlineWorker()
      worker.serve(path, 'built file')
      expect(await (await worker.get(path))!.text()).toBe('built file')
      worker.state.online = false
      expect(await (await worker.get(path))!.text()).toBe('built file')
    },
  )

  it('serves a hashed data file from the cache without asking the network again', async () => {
    const worker = offlineWorker()
    worker.serve('/assets/inventory.generated-Cn7HGTCw.json', '{}')
    await worker.get('/assets/inventory.generated-Cn7HGTCw.json')
    await worker.get('/assets/inventory.generated-Cn7HGTCw.json')
    expect(worker.state.requests).toHaveLength(1)
  })

  it('leaves a range request to the browser', async () => {
    const worker = offlineWorker()
    worker.serve('/assets/model.onnx')
    expect(await worker.get('/assets/model.onnx', { range: 'bytes=0-99' })).toBeUndefined()
  })
})

describe('service worker data files', () => {
  it('keeps a GeoTIFF read whole, and leaves one read in ranges alone', async () => {
    const worker = offlineWorker()
    worker.serve('/data/lidar-analysis/bc-093g086/dtm-1m.tif', 'terrain')
    await worker.get('/data/lidar-analysis/bc-093g086/dtm-1m.tif')
    worker.state.online = false
    expect(await (await worker.get('/data/lidar-analysis/bc-093g086/dtm-1m.tif'))!.text()).toBe('terrain')
    expect(await worker.get('/data/lidar-analysis/bc-093g086/dtm-1m.tif', { range: 'bytes=0-1023' })).toBeUndefined()
  })
})

describe('service worker activation', () => {
  it('deletes only its own superseded caches', async () => {
    const worker = offlineWorker()
    for (const name of [
      'pgmaps-shell-v2',
      'pgmaps-data-v0',
      'pgmaps-shell-v3',
      'pgmaps-terrarium-png-v1',
      'pgmaps-photo-depth-v1',
      'geo-toolkit-terrarium-png-v1',
    ]) {
      await worker.cacheOf(name).put('/kept', new Response('x'))
    }
    await worker.activate()
    expect([...worker.stores.keys()].sort()).toEqual(
      expect.arrayContaining([
        'geo-toolkit-terrarium-png-v1',
        'pgmaps-photo-depth-v1',
        'pgmaps-shell-v3',
        'pgmaps-terrarium-png-v1',
      ]),
    )
    expect(worker.stores.has('pgmaps-shell-v2')).toBe(false)
    expect(worker.stores.has('pgmaps-data-v0')).toBe(false)
  })

  it('holds the shell after one visit, though the page loaded it before the worker existed', async () => {
    const worker = offlineWorker()
    deployed(worker)
    await worker.activate()
    worker.state.online = false
    expect(await (await worker.get('/assets/app-aaaa.js'))!.text()).toBe('/assets/app-aaaa.js')
    // No tool was asked for, so none was fetched.
    expect(worker.state.requests).not.toContain(`${ORIGIN}/assets/Roads-dddd.js`)
  })

  it('keeps the newest tiles when the tile cache is over its limit', async () => {
    const worker = offlineWorker()
    const tiles = worker.cacheOf('pgmaps-tiles-v1')
    for (let i = 0; i < 4003; i++) await tiles.put(`https://tiles.example/${i}.png`, new Response('t'))
    await worker.activate()
    expect(tiles.entries.size).toBe(4000)
    expect(tiles.entries.has('https://tiles.example/2.png')).toBe(false)
    expect(tiles.entries.has('https://tiles.example/3.png')).toBe(true)
  })
})

describe('service worker offline tools', () => {
  it('holds every file of a tool that a page asks for, and reports it', async () => {
    const worker = offlineWorker()
    deployed(worker)
    const status = await worker.message({ type: 'pgmaps-offline', groups: ['road-design'] })
    expect(status).toMatchObject({
      build: 'build-one',
      deployed: true,
      shell: { files: 3, held: 3 },
      groups: { 'road-design': { kept: true, files: 4, held: 4 } },
    })
    worker.state.online = false
    for (const file of MANIFEST.groups['road-design'].files) {
      expect(await (await worker.get(`/${file}`))!.text()).toBe(`/${file}`)
    }
    // The other tool was not asked for and is not held.
    await expect(worker.get('/assets/Visuals-eeee.js')).rejects.toThrow('Failed to fetch')
  })

  it('reports without fetching when only the status is asked for', async () => {
    const worker = offlineWorker()
    deployed(worker)
    const status = await worker.message({ type: 'pgmaps-offline', groups: ['road-design'], statusOnly: true })
    expect(status.groups['road-design']).toMatchObject({ kept: false, files: 4, held: 0 })
    expect(worker.state.requests).toEqual([`${ORIGIN}/offline-precache.json`])
  })

  it('fetches a new build for a tool asked for earlier, without the tool being opened', async () => {
    const worker = offlineWorker()
    deployed(worker)
    await worker.message({ type: 'pgmaps-offline', groups: ['road-design'] })

    const next = structuredClone(MANIFEST)
    next.build = 'build-two'
    next.groups['road-design'].files = ['assets/Roads-ffff.js', 'assets/map-worker-jjjj.mjs', 'assets/cable-llll.wasm']
    deployed(worker, next)
    worker.state.requests.length = 0
    await worker.activate()
    // Only the changed file is fetched; the two unchanged ones are already held.
    expect(worker.state.requests.filter((url) => url.includes('/assets/'))).toEqual([`${ORIGIN}/assets/Roads-ffff.js`])
    worker.state.online = false
    expect(await (await worker.get('/assets/Roads-ffff.js'))!.text()).toBe('/assets/Roads-ffff.js')
    // The earlier build's file stays for a tab still running it.
    expect(await (await worker.get('/assets/Roads-dddd.js'))!.text()).toBe('/assets/Roads-dddd.js')
  })

  it('tops a kept tool up on any page load, and holds the page that names the new files', async () => {
    const worker = offlineWorker()
    deployed(worker)
    worker.serve('/index.html', 'page for build one')
    await worker.message({ type: 'pgmaps-offline', groups: ['road-design'] })

    const next = structuredClone(MANIFEST)
    next.build = 'build-two'
    next.shell = ['assets/app-bbbb.js', 'assets/app-cccc.css']
    deployed(worker, next)
    worker.serve('/index.html', 'page for build two')
    // What `main.tsx` sends on every load: no tool named.
    const status = await worker.message({ type: 'pgmaps-offline', groups: [] })
    expect(status).toMatchObject({ build: 'build-two', shell: { files: 3, held: 3 } })
    expect(status.groups['road-design']).toMatchObject({ kept: true, held: 4 })

    worker.state.online = false
    const page = await worker.get('/dev/forestry/road-design', {}, 'navigate')
    expect(await page!.text()).toBe('page for build two')
    expect(await (await worker.get('/assets/app-bbbb.js'))!.text()).toBe('/assets/app-bbbb.js')
  })

  it('keeps the files a tool reads from public/, and fetches them again only for a new build', async () => {
    const worker = offlineWorker()
    worker.serve('/workspace-layouts.json', 'layouts one')
    deployed(worker)
    await worker.message({ type: 'pgmaps-offline', groups: ['road-design'] })
    // Where the file's own fetch rule keeps it, so a page reading it later overwrites this entry.
    expect(worker.cacheOf('pgmaps-data-v1').entries.has(`${ORIGIN}/workspace-layouts.json`)).toBe(true)
    expect(worker.cacheOf('pgmaps-shell-v3').entries.has(`${ORIGIN}/workspace-layouts.json`)).toBe(false)

    // The same build again: the name has no hash, but nothing says the file changed.
    worker.state.requests.length = 0
    await worker.message({ type: 'pgmaps-offline', groups: [] })
    expect(worker.state.requests).not.toContain(`${ORIGIN}/workspace-layouts.json`)

    const next = structuredClone(MANIFEST)
    next.build = 'build-two'
    worker.serve('/workspace-layouts.json', 'layouts two')
    deployed(worker, next)
    await worker.message({ type: 'pgmaps-offline', groups: [] })
    worker.state.online = false
    expect(await (await worker.get('/workspace-layouts.json'))!.text()).toBe('layouts two')
    expect(await (await worker.get('/favicon.svg'))!.text()).toBe('/favicon.svg')
  })

  it('keeps the copy it has of such a file when a new build cannot be read', async () => {
    const worker = offlineWorker()
    worker.serve('/workspace-layouts.json', 'layouts one')
    deployed(worker)
    await worker.message({ type: 'pgmaps-offline', groups: ['road-design'] })
    const next = structuredClone(MANIFEST)
    next.build = 'build-two'
    deployed(worker, next)
    worker.network.set(`${ORIGIN}/workspace-layouts.json`, () => new Response('down', { status: 503 }))
    const status = await worker.message({ type: 'pgmaps-offline', groups: [] })
    expect(status.groups['road-design']).toMatchObject({ files: 4, held: 4 })
    // The build is not marked done, so the next load reads the file again.
    worker.serve('/workspace-layouts.json', 'layouts two')
    await worker.message({ type: 'pgmaps-offline', groups: [] })
    worker.state.online = false
    expect(await (await worker.get('/workspace-layouts.json'))!.text()).toBe('layouts two')
  })

  it('finds a stored file for a request whose headers the stored one did not have', async () => {
    const worker = offlineWorker()
    deployed(worker)
    await worker.message({ type: 'pgmaps-offline', groups: [] })
    worker.state.online = false
    await worker.get('/assets/app-aaaa.js', { origin: ORIGIN })
    // The lookup must not depend on the response's Vary header: a `crossorigin` script sends Origin.
    expect(worker.state.matchOptions.at(-1)).toEqual({ ignoreVary: true })
  })

  it('reports from the last list it read when the network is gone', async () => {
    const worker = offlineWorker()
    deployed(worker)
    await worker.message({ type: 'pgmaps-offline', groups: ['visual-quality'] })
    worker.state.online = false
    const status = await worker.message({ type: 'pgmaps-offline', groups: ['visual-quality'], statusOnly: true })
    expect(status).toMatchObject({ deployed: false, groups: { 'visual-quality': { kept: true, files: 1, held: 1 } } })
  })

  it('ignores a tool the build does not list, and a build with no list', async () => {
    const worker = offlineWorker()
    expect(await worker.message({ type: 'pgmaps-offline', groups: ['road-design'] })).toEqual({
      build: null,
      deployed: false,
      shell: null,
      groups: {},
    })
    deployed(worker)
    const status = await worker.message({ type: 'pgmaps-offline', groups: ['unknown-tool'] })
    expect(status.groups).toEqual({})
  })

  it('drops a built file no list names once it is a month old, and keeps one whose age is unknown', async () => {
    const worker = offlineWorker()
    deployed(worker)
    const shell = worker.cacheOf('pgmaps-shell-v3')
    const dated = (days: number) => ({ headers: { date: new Date(worker.clock.now - days * DAY).toUTCString() } })
    await shell.put('/assets/Old-0000.js', new Response('old', dated(40)))
    await shell.put('/assets/Recent-1111.js', new Response('recent', dated(5)))
    await shell.put('/assets/Undated-2222.js', new Response('undated'))
    await shell.put('/assets/app-aaaa.js', new Response('listed', dated(400)))
    await shell.put('/index.html', new Response('page', dated(400)))
    await worker.message({ type: 'pgmaps-offline', groups: [] })
    const left = [...shell.entries.keys()].map((url) => url.slice(ORIGIN.length))
    expect(left).not.toContain('/assets/Old-0000.js')
    expect(left).toEqual(
      expect.arrayContaining([
        '/assets/Recent-1111.js',
        '/assets/Undated-2222.js',
        '/assets/app-aaaa.js',
        '/index.html',
      ]),
    )
  })
})

describe('service worker storage management', () => {
  it('forgets a tool: its own files go, files the shell and another kept tool need stay', async () => {
    const worker = offlineWorker()
    const both = structuredClone(MANIFEST)
    // A file both tools need.
    both.groups['visual-quality'].files.push('assets/map-worker-jjjj.mjs')
    deployed(worker, both)
    await worker.message({ type: 'pgmaps-offline', groups: ['road-design', 'visual-quality'] })
    const status = await worker.message({ type: 'pgmaps-offline', groups: [], forget: ['road-design'] })
    expect(status.groups['road-design']).toBeUndefined()
    expect(status.groups['visual-quality']).toMatchObject({ kept: true, held: 2 })

    const shell = [...worker.cacheOf('pgmaps-shell-v3').entries.keys()].map((url) => url.slice(ORIGIN.length))
    expect(shell).not.toContain('/assets/Roads-dddd.js')
    expect(shell).not.toContain('/assets/cable-llll.wasm')
    expect(shell).toEqual(
      expect.arrayContaining(['/assets/map-worker-jjjj.mjs', '/assets/app-aaaa.js', '/assets/Visuals-eeee.js']),
    )
    expect(worker.cacheOf('pgmaps-data-v1').entries.has(`${ORIGIN}/workspace-layouts.json`)).toBe(false)
    expect(worker.cacheOf('pgmaps-data-v1').entries.has(`${ORIGIN}/favicon.svg`)).toBe(true)

    // It stays forgotten on the next page load, until a page asks for it again.
    const later = await worker.message({ type: 'pgmaps-offline', groups: [] })
    expect(later.groups['road-design']).toBeUndefined()
    const again = await worker.message({ type: 'pgmaps-offline', groups: ['road-design'] })
    expect(again.groups['road-design']).toMatchObject({ kept: true, files: 4, held: 4 })
  })

  async function fill(worker: ReturnType<typeof offlineWorker>) {
    const tiles = worker.cacheOf('pgmaps-tiles-v1')
    const data = worker.cacheOf('pgmaps-data-v1')
    for (let i = 0; i < 1200; i++) await tiles.put(`https://tiles.example/${i}.png`, new Response('t'))
    for (let i = 0; i < 500; i++) await data.put(`/data/file-${i}.json`, new Response('{}'))
    return { tiles, data }
  }

  it('gives up most tiles and data files when the site nears the browser’s allowance', async () => {
    const worker = offlineWorker()
    const { tiles, data } = await fill(worker)
    worker.state.estimate = { usage: 79, quota: 100 }
    await worker.message({ type: 'pgmaps-offline', groups: [] })
    expect(tiles.entries.size).toBe(1200)

    worker.state.estimate = { usage: 81, quota: 100 }
    await worker.message({ type: 'pgmaps-offline', groups: [] })
    expect(tiles.entries.size).toBe(1000)
    expect(data.entries.size).toBe(375)
    // The newest are the ones kept.
    expect(tiles.entries.has('https://tiles.example/1199.png')).toBe(true)
    expect(tiles.entries.has('https://tiles.example/0.png')).toBe(false)
  })

  it('leaves the caches alone when only the status is asked for, or the browser gives no figure', async () => {
    const worker = offlineWorker()
    const { tiles } = await fill(worker)
    worker.state.estimate = { usage: 99, quota: 100 }
    await worker.message({ type: 'pgmaps-offline', groups: [], statusOnly: true })
    expect(tiles.entries.size).toBe(1200)
    worker.state.estimate = undefined
    await worker.message({ type: 'pgmaps-offline', groups: [] })
    expect(tiles.entries.size).toBe(1200)
  })

  it('makes room at once when a write is refused for lack of it, without asking for a figure', async () => {
    const worker = offlineWorker()
    const { tiles, data } = await fill(worker)
    worker.state.full.add('pgmaps-data-v1')
    worker.serve('/data/new.geojson', '{}')
    expect(await (await worker.get('/data/new.geojson'))!.text()).toBe('{}')
    expect(tiles.entries.size).toBe(1000)
    expect(data.entries.size).toBe(375)
  })

  it('never touches a cache it does not own when making room', async () => {
    const worker = offlineWorker()
    await fill(worker)
    const terrain = worker.cacheOf('pgmaps-terrarium-png-v1')
    const shell = worker.cacheOf('pgmaps-shell-v3')
    for (let i = 0; i < 50; i++) await terrain.put(`https://terrain.example/${i}.png`, new Response('t'))
    for (let i = 0; i < 50; i++) await shell.put(`/assets/chunk-${i}.js`, new Response('c'))
    worker.state.estimate = { usage: 95, quota: 100 }
    await worker.message({ type: 'pgmaps-offline', groups: [] })
    expect(terrain.entries.size).toBe(50)
    expect(shell.entries.size).toBe(50)
  })
})

describe('service worker map tiles', () => {
  const TERRAIN = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/163/330.png'
  const BASEMAP = 'https://tiles.basemaps.cartocdn.com/vectortiles/carto.streets/v1/10/163/330.mvt'

  it('keeps a terrain tile and answers the next request without the network', async () => {
    const worker = offlineWorker()
    worker.network.set(TERRAIN, () => new Response('tile'))
    expect(await (await worker.get(TERRAIN))!.text()).toBe('tile')
    worker.state.online = false
    expect(await (await worker.get(TERRAIN))!.text()).toBe('tile')
    expect(worker.state.requests).toEqual([TERRAIN])
  })

  it('refreshes a basemap tile after a week and still serves the old one offline', async () => {
    const worker = offlineWorker()
    worker.network.set(BASEMAP, () => new Response('first'))
    await worker.get(BASEMAP)
    worker.clock.now += 8 * DAY
    worker.network.set(BASEMAP, () => new Response('second'))
    expect(await (await worker.get(BASEMAP))!.text()).toBe('second')
    worker.clock.now += 8 * DAY
    worker.state.online = false
    expect(await (await worker.get(BASEMAP))!.text()).toBe('second')
  })

  it('serves the terrain loader’s own stored tile when it holds none itself and the network is gone', async () => {
    const worker = offlineWorker()
    await worker.cacheOf('pgmaps-terrarium-png-v1').put(TERRAIN, new Response('validated tile'))
    worker.state.online = false
    expect(await (await worker.get(TERRAIN))!.text()).toBe('validated tile')
  })

  it('does not keep an unsuccessful or partial tile', async () => {
    const worker = offlineWorker()
    worker.network.set(TERRAIN, () => new Response('gone', { status: 404 }))
    expect((await worker.get(TERRAIN))!.status).toBe(404)
    worker.network.set(BASEMAP, () => new Response('part', { status: 206 }))
    expect((await worker.get(BASEMAP))!.status).toBe(206)
    expect(worker.cacheOf('pgmaps-tiles-v1').entries.size).toBe(0)
  })

  it.each([
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/10/330/163',
    'https://openmaps.gov.bc.ca/geo/pub/ows?service=WFS',
    'https://s3.amazonaws.com/another-bucket/10/163/330.png',
  ])('leaves %s to the browser', async (url) => {
    const worker = offlineWorker()
    expect(await worker.get(url)).toBeUndefined()
  })
})
