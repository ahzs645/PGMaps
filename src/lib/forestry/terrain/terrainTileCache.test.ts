import { describe, expect, it, vi } from 'vitest'
import { createTerrainTileCache } from './terrainTileCache'

describe('decoded terrain tile cache', () => {
  it('reuses overlapping tiles and evicts the least recently used tile', async () => {
    const cache = createTerrainTileCache(2)
    const load = vi.fn(async () => new Float32Array([800]))
    await cache.get('a', load)
    await cache.get('b', load)
    await cache.get('a', load)
    await cache.get('c', load)
    await cache.get('a', load)
    await cache.get('b', load)
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('deduplicates in-flight loads without cancelling another consumer', async () => {
    const cache = createTerrainTileCache()
    let complete!: (data: Float32Array) => void
    let active!: AbortSignal
    const load = vi.fn((signal: AbortSignal) => {
      active = signal
      return new Promise<Float32Array>((resolve) => {
        complete = resolve
      })
    })
    const abort = new AbortController()
    const first = cache.get('a', load, abort.signal)
    const second = cache.get('a', load)
    abort.abort()
    await expect(first).rejects.toMatchObject({ name: 'AbortError' })
    expect(active.aborted).toBe(false)
    complete(new Float32Array([123]))
    expect((await second)[0]).toBe(123)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('aborts when every consumer leaves and retries failures instead of caching them', async () => {
    const cache = createTerrainTileCache()
    const abort = new AbortController()
    let active!: AbortSignal
    const pending = cache.get(
      'a',
      (signal) => {
        active = signal
        return new Promise<Float32Array>(() => {})
      },
      abort.signal,
    )
    abort.abort()
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(active.aborted).toBe(true)
    const load = vi.fn(async () => new Float32Array([700]))
    await cache.get('a', load)
    await expect(
      cache.get('bad', async () => {
        throw new Error('503')
      }),
    ).rejects.toThrow('503')
    expect((await cache.get('bad', load))[0]).toBe(700)
    expect(load).toHaveBeenCalledTimes(2)
    cache.clear()
    await cache.get('a', load)
    expect(load).toHaveBeenCalledTimes(3)
  })
})

it('shares stored PNGs across consumers, expires old bytes, and tolerates unavailable storage', async () => {
  const { storedTerrainTile, storeTerrainTile } = await import('./terrainTileCache')
  const entries = new Map<string, Response>()
  const storage = {
    match: vi.fn(async (key: string) => entries.get(key)?.clone()),
    put: vi.fn(async (key: string, value: Response) => {
      entries.set(key, value.clone())
    }),
    keys: vi.fn(async () => [...entries.keys()]),
    delete: vi.fn(async (key: string) => entries.delete(key)),
  }
  vi.stubGlobal('caches', { open: vi.fn(async () => storage) })
  try {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    await storeTerrainTile('https://example.com/tile', bytes)
    expect(new Uint8Array((await storedTerrainTile('https://example.com/tile'))!)).toEqual(new Uint8Array([1, 2, 3]))
    entries.set('https://example.com/old', new Response(bytes, { headers: { 'x-pgmaps-cached-at': '1' } }))
    expect(await storedTerrainTile('https://example.com/old')).toBeNull()
    expect(storage.delete).toHaveBeenCalledWith('https://example.com/old')
    vi.stubGlobal('caches', {
      open: async () => {
        throw new Error('quota')
      },
    })
    expect(await storedTerrainTile('https://example.com/tile')).toBeNull()
    await expect(storeTerrainTile('https://example.com/tile', bytes)).resolves.toBeUndefined()
  } finally {
    vi.unstubAllGlobals()
  }
})
