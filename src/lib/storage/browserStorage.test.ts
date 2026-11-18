import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearEntry, deleteOtherCache, measureEntry, otherStores, presentStores } from './browserStorage'
import { cataloguedNames, STORE_CATALOGUE, type StoreEntry } from './siteStorage'

/** Cache Storage, enough of it: named caches of responses. */
function stubCaches(initial: Record<string, Record<string, Response>>) {
  const stores = new Map(Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]))
  vi.stubGlobal('caches', {
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    open: async (name: string) => {
      const store = stores.get(name) ?? stores.set(name, new Map()).get(name)!
      return {
        keys: async () => [...store.keys()].map((url) => ({ url })),
        match: async (request: { url: string }) => store.get(request.url)?.clone(),
      }
    },
  })
  return stores
}

function put(name: string, stores: Record<string, unknown[]>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      for (const store of Object.keys(stores)) request.result.createObjectStore(store, { autoIncrement: true })
    }
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction(Object.keys(stores), 'readwrite')
      for (const [store, values] of Object.entries(stores)) {
        for (const value of values) transaction.objectStore(store).add(value)
      }
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
    }
  })
}

const databaseNames = async () => (await indexedDB.databases()).map((info) => info.name).sort()
const VISUALS = 'pgmaps.forestry-assessment-tools.v1'
const entry = (id: string) => STORE_CATALOGUE.find((item) => item.id === id)!

beforeEach(async () => {
  for (const info of await indexedDB.databases()) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(info.name!)
      request.onsuccess = request.onerror = () => resolve()
    })
  }
})
afterEach(() => vi.unstubAllGlobals())

describe('measureEntry', () => {
  it('adds up a cache by stated length, and by its bytes when none is stated', async () => {
    stubCaches({
      'pgmaps-tiles-v1': {
        'https://t/1.png': new Response('12345', { headers: { 'content-length': '5000' } }),
        'https://t/2.png': new Response('1234567'),
      },
      'pgmaps-terrarium-png-v1': { 'https://t/3.png': new Response('123') },
    })
    const present = await presentStores()
    expect(await measureEntry(entry('map-tiles'), present)).toEqual({ bytes: 5000 + 7 + 3, items: 3 })
    // A listed cache that is not there counts nothing and is not created by being measured.
    expect(await measureEntry(entry('depth-models'), present)).toEqual({ bytes: 0, items: 0 })
    expect((await presentStores()).caches.sort()).toEqual(['pgmaps-terrarium-png-v1', 'pgmaps-tiles-v1'])
  })

  it('measures only the object stores an entry names', async () => {
    stubCaches({})
    await put(VISUALS, {
      photoDepth: [{ key: 'a', depth: new Float32Array(1000) }],
      ownPhotos: [{ id: 'p', name: 'IMG_1', state: null }],
      attachments: [{ key: 'p', blob: new Blob([new Uint8Array(3000)]) }],
      documents: [],
      scenes: [],
    })
    const present = await presentStores()
    const depth = await measureEntry(entry('depth-estimates'), present)
    expect(depth.items).toBe(1)
    expect(depth.bytes).toBeGreaterThanOrEqual(4000)
    expect(depth.bytes).toBeLessThan(4100)
    const work = await measureEntry(entry('visual-quality'), present)
    expect(work.items).toBe(2)
    expect(work.bytes).toBeGreaterThanOrEqual(3000)
  })

  it('does not create a database by measuring one that is not there', async () => {
    stubCaches({})
    expect(await measureEntry(entry('road-projects'), await presentStores())).toEqual({ bytes: 0, items: 0 })
    expect(await databaseNames()).toEqual([])
  })

  it('reports an unknown size where the browser cannot list databases', async () => {
    stubCaches({})
    expect(await measureEntry(entry('road-projects'), { caches: [], databases: null })).toEqual({
      bytes: null,
      items: 0,
    })
    expect(await databaseNames()).toEqual([])
  })
})

describe('clearEntry', () => {
  it('clears the named stores and leaves the work beside them', async () => {
    stubCaches({})
    await put(VISUALS, {
      photoDepth: [{ key: 'a', depth: new Float32Array(1000) }],
      ownPhotos: [{ id: 'p', name: 'IMG_1' }],
      attachments: [{ key: 'p', blob: new Blob([new Uint8Array(3000)]) }],
      documents: [{ id: 'workspace' }],
      scenes: [{ id: 'current' }],
    })
    const present = await presentStores()
    await clearEntry(entry('depth-estimates'), present)
    expect(await measureEntry(entry('depth-estimates'), present)).toEqual({ bytes: 0, items: 0 })
    expect((await measureEntry(entry('visual-quality'), present)).items).toBe(4)
  })

  it('deletes a download entry’s caches and no other', async () => {
    const stores = stubCaches({
      'pgmaps-tiles-v1': { 'https://t/1.png': new Response('1') },
      'pgmaps-photo-depth-v1': { 'https://m/model.onnx': new Response('model') },
    })
    await clearEntry(entry('map-tiles'), await presentStores())
    expect([...stores.keys()]).toEqual(['pgmaps-photo-depth-v1'])
  })

  it('refuses every entry that is a person’s work', async () => {
    stubCaches({})
    await put('pgmaps-forestry-roads-v1', { projects: [{ name: 'Road A' }] })
    const present = await presentStores()
    for (const work of STORE_CATALOGUE.filter((item) => item.role === 'work')) {
      await expect(clearEntry(work, present), work.id).rejects.toThrow(/kept work/)
    }
    expect((await measureEntry(entry('road-projects'), present)).items).toBe(1)
  })

  it('refuses a download entry that names a whole database', async () => {
    stubCaches({})
    await put('some-derived-db', { rows: [{ a: 1 }] })
    const whole: StoreEntry = {
      id: 'whole',
      label: 'Whole database',
      detail: '',
      role: 'download',
      note: '',
      databases: [{ name: 'some-derived-db' }],
    }
    await expect(clearEntry(whole, await presentStores())).rejects.toThrow(/names no stores/)
  })
})

describe('what the catalogue does not list', () => {
  it('shows an unlisted cache with its size and an unlisted database by name', async () => {
    stubCaches({
      'pgmaps-shell-v3': { '/assets/a.js': new Response('a') },
      'transformers-cache': { 'https://hf/model.bin': new Response('123456') },
    })
    await put('keyval-store', { keyval: [1] })
    expect(await otherStores(await presentStores())).toEqual({
      caches: [{ name: 'transformers-cache', bytes: 6, items: 1 }],
      databases: ['keyval-store'],
    })
  })

  it('deletes an unlisted cache, never a listed one', async () => {
    const stores = stubCaches({ 'pgmaps-shell-v3': {}, 'transformers-cache': {} })
    const listed = cataloguedNames().caches
    await deleteOtherCache('transformers-cache', listed)
    expect([...stores.keys()]).toEqual(['pgmaps-shell-v3'])
    await expect(deleteOtherCache('pgmaps-shell-v3', listed)).rejects.toThrow(/listed cache/)
  })
})
