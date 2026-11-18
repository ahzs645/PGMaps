import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { COPY_READ_AT_HEADER } from './keptReads'

const URL_A = 'https://openmaps.gov.bc.ca/geo/pub/wfs?typeName=INVENTORY&CQL_FILTER=BBOX(1,2,3,4)'

/** Cache Storage with the methods the binding uses, and a record of what exists. */
function stubCaches() {
  const stores = new Map<string, Map<string, Response>>()
  vi.stubGlobal('caches', {
    has: async (name: string) => stores.has(name),
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      const store = stores.get(name) ?? stores.set(name, new Map()).get(name)!
      return {
        match: async (url: string) => store.get(url)?.clone(),
        put: async (url: string, response: Response) => void store.set(url, response),
        delete: async (url: string | { url: string }) => store.delete(typeof url === 'string' ? url : url.url),
        keys: async () => [...store.keys()].map((url) => ({ url })),
      }
    },
  })
  return stores
}

/** A fresh copy of the module: it remembers the switch for a few seconds. */
async function load() {
  vi.resetModules()
  return import('./inventoryCopies')
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
let network: () => Promise<Response>

beforeEach(() => {
  network = async () => new Response('{"live":1}', { headers: { 'content-type': 'application/json' } })
  vi.stubGlobal('fetch', (...args: unknown[]) => (void args, network()))
})
afterEach(() => vi.unstubAllGlobals())

describe('the inventory copies switch', () => {
  it('is off until turned on, and keeps nothing while off', async () => {
    const stores = stubCaches()
    const copies = await load()
    expect(await copies.inventoryCopiesEnabled()).toBe(false)
    await copies.inventoryFetch(URL_A)
    await settle()
    // Asking must not create the caches: off means none exist.
    expect([...stores.keys()]).toEqual([])
  })

  it('keeps each read once on, and answers from it when the source is gone', async () => {
    const stores = stubCaches()
    const copies = await load()
    await copies.setInventoryCopies(true)
    expect(await copies.inventoryCopiesEnabled()).toBe(true)
    await copies.inventoryFetch(URL_A)
    await settle()
    expect(stores.get(copies.INVENTORY_COPIES_CACHE)?.has(URL_A)).toBe(true)

    network = async () => {
      throw new TypeError('Failed to fetch')
    }
    const used: string[] = []
    const stop = copies.onInventoryCopyUsed((use) => used.push(use.readAt))
    const response = await copies.inventoryFetch(URL_A)
    expect(await response.json()).toEqual({ live: 1 })
    const readAt = response.headers.get(COPY_READ_AT_HEADER)
    expect(readAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    await settle()
    // Told once, not once directly and once over the channel.
    expect(used).toEqual([readAt])
    stop()
  })

  it('deletes every copy when turned off, and stops answering from them', async () => {
    const stores = stubCaches()
    const copies = await load()
    await copies.setInventoryCopies(true)
    await copies.inventoryFetch(URL_A)
    await settle()
    await copies.setInventoryCopies(false)
    expect([...stores.keys()]).toEqual([])
    network = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(copies.inventoryFetch(URL_A)).rejects.toThrow('Failed to fetch')
  })

  it('stays on when the copies alone are cleared, as the storage panel clears them', async () => {
    const stores = stubCaches()
    const copies = await load()
    await copies.setInventoryCopies(true)
    await copies.inventoryFetch(URL_A)
    await settle()
    stores.delete(copies.INVENTORY_COPIES_CACHE)
    const again = await load()
    expect(await again.inventoryCopiesEnabled()).toBe(true)
    network = async () => {
      throw new TypeError('Failed to fetch')
    }
    await expect(again.inventoryFetch(URL_A)).rejects.toThrow('Failed to fetch')
  })

  it('keeps only the newest reads', async () => {
    const stores = stubCaches()
    const copies = await load()
    await copies.setInventoryCopies(true)
    const total = copies.MAX_INVENTORY_COPIES + 3
    for (let i = 0; i < total; i++) {
      await copies.inventoryFetch(`${URL_A}&tile=${i}`)
      await settle()
    }
    const kept = stores.get(copies.INVENTORY_COPIES_CACHE)!
    expect(kept.size).toBe(copies.MAX_INVENTORY_COPIES)
    expect(kept.has(`${URL_A}&tile=0`)).toBe(false)
    expect(kept.has(`${URL_A}&tile=${total - 1}`)).toBe(true)
  })

  it('is the plain fetch where the browser has no Cache Storage', async () => {
    vi.stubGlobal('caches', undefined)
    const copies = await load()
    expect(await copies.inventoryCopiesEnabled()).toBe(false)
    expect(await (await copies.inventoryFetch(URL_A)).json()).toEqual({ live: 1 })
    await expect(copies.setInventoryCopies(true)).rejects.toThrow(/cannot keep copies/)
  })
})
