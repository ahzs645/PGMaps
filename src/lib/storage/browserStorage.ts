import { approximateBytes, type StoreEntry, uncatalogued, usageShare } from './siteStorage'

/**
 * Measuring and clearing what `siteStorage.ts` lists, in a browser.
 *
 * Nothing here opens a database that does not exist: opening one creates it, and a storage panel
 * that leaves empty databases behind would be making what it reports.
 */

export interface StoreSize {
  /** About how many bytes; null when it could not be read. */
  bytes: number | null
  /** Cached responses or stored records. */
  items: number
}

export interface StorageOverview {
  usage: number | null
  quota: number | null
  /** 0 to 1; null when the browser gives no figures. */
  share: number | null
  /** True when the browser has agreed not to clear the site on its own; null when it cannot say. */
  persisted: boolean | null
  /** Whether the browser can be asked to. */
  canPersist: boolean
}

const hasCaches = () => typeof caches !== 'undefined'
const hasDatabases = () => typeof indexedDB !== 'undefined'

export async function storageOverview(): Promise<StorageOverview> {
  const storage = typeof navigator === 'undefined' ? undefined : navigator.storage
  let usage: number | null = null
  let quota: number | null = null
  let persisted: boolean | null = null
  try {
    const estimate = await storage?.estimate?.()
    usage = estimate?.usage ?? null
    quota = estimate?.quota ?? null
  } catch {
    // Some private windows refuse: the panel shows sizes without a total.
  }
  try {
    persisted = (await storage?.persisted?.()) ?? null
  } catch {
    persisted = null
  }
  return {
    usage,
    quota,
    share: usageShare(usage ?? undefined, quota ?? undefined),
    persisted,
    canPersist: typeof storage?.persist === 'function',
  }
}

/** Ask the browser to keep this site's storage. A person asked for it, so there is no waiting. */
export async function protectStorage(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false
  } catch {
    return false
  }
}

/** The caches and databases present now. `databases` is null where the browser cannot list them. */
export async function presentStores(): Promise<{ caches: string[]; databases: string[] | null }> {
  let cacheNames: string[] = []
  let databaseNames: string[] | null = null
  try {
    if (hasCaches()) cacheNames = await caches.keys()
  } catch {
    cacheNames = []
  }
  try {
    if (hasDatabases() && typeof indexedDB.databases === 'function') {
      databaseNames = (await indexedDB.databases()).map((info) => info.name).filter((name): name is string => !!name)
    }
  } catch {
    databaseNames = null
  }
  return { caches: cacheNames, databases: databaseNames }
}

const MEASURE_LANES = 8

async function cacheSize(name: string): Promise<StoreSize> {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  let bytes = 0
  const pending = [...keys]
  const lane = async () => {
    while (pending.length) {
      const response = await cache.match(pending.pop()!)
      if (!response) continue
      // The header is free to read; the body is megabytes for a model or a terrain file.
      const stated = Number(response.headers.get('content-length'))
      // Read into a local first: `bytes += await …` takes the total before the wait and loses
      // what the other lanes added meanwhile.
      const size = Number.isFinite(stated) && stated > 0 ? stated : (await response.blob()).size
      bytes += size
    }
  }
  await Promise.all(Array.from({ length: MEASURE_LANES }, lane))
  return { bytes, items: keys.length }
}

function openExisting(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    // It was listed a moment ago, so this fires only if it was deleted since: do not create it.
    request.onupgradeneeded = () => request.transaction?.abort()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`${name} is in use`))
    request.onsuccess = () => resolve(request.result)
  })
}

async function databaseSize(name: string, stores?: readonly string[]): Promise<StoreSize> {
  const database = await openExisting(name)
  try {
    const names = [...database.objectStoreNames].filter((store) => !stores || stores.includes(store))
    if (!names.length) return { bytes: 0, items: 0 }
    return await new Promise<StoreSize>((resolve, reject) => {
      const transaction = database.transaction(names, 'readonly')
      let bytes = 0
      let items = 0
      for (const store of names) {
        const request = transaction.objectStore(store).openCursor()
        request.onsuccess = () => {
          const cursor = request.result
          if (!cursor) return
          bytes += approximateBytes(cursor.value)
          items++
          cursor.continue()
        }
      }
      transaction.oncomplete = () => resolve({ bytes, items })
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    database.close()
  }
}

/** The size of one catalogue entry: what is present of it, added up. */
export async function measureEntry(
  entry: Pick<StoreEntry, 'caches' | 'databases'>,
  present: { caches: readonly string[]; databases: readonly string[] | null },
): Promise<StoreSize> {
  let bytes: number | null = 0
  let items = 0
  const add = (size: StoreSize) => {
    bytes = bytes === null || size.bytes === null ? null : bytes + size.bytes
    items += size.items
  }
  for (const name of entry.caches ?? []) {
    if (!present.caches.includes(name)) continue
    add(await cacheSize(name).catch(() => ({ bytes: null, items: 0 })))
  }
  for (const database of entry.databases ?? []) {
    // Without a listing there is no telling whether it exists, and opening it would create it.
    if (present.databases === null) add({ bytes: null, items: 0 })
    else if (present.databases.includes(database.name)) {
      add(await databaseSize(database.name, database.stores).catch(() => ({ bytes: null, items: 0 })))
    }
  }
  return { bytes, items }
}

/**
 * Empty a `download` entry: its caches are deleted and its object stores cleared. Refuses a `work`
 * entry, and a database entry that names no stores, so this can never take a person's work.
 */
export async function clearEntry(
  entry: StoreEntry,
  present: { caches: readonly string[]; databases: readonly string[] | null },
): Promise<void> {
  if (entry.role !== 'download') throw new Error(`${entry.label} is kept work and is not cleared from here.`)
  for (const name of entry.caches ?? []) if (present.caches.includes(name)) await caches.delete(name)
  for (const target of entry.databases ?? []) {
    if (!target.stores) throw new Error(`${entry.label} names no stores to clear.`)
    if (!present.databases?.includes(target.name)) continue
    const database = await openExisting(target.name)
    try {
      const names = [...database.objectStoreNames].filter((store) => target.stores!.includes(store))
      if (!names.length) continue
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(names, 'readwrite')
        for (const store of names) transaction.objectStore(store).clear()
        transaction.oncomplete = () => resolve()
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
    } finally {
      database.close()
    }
  }
}

/** What the browser holds that the catalogue does not list, with sizes for the caches. */
export async function otherStores(present: { caches: readonly string[]; databases: readonly string[] | null }) {
  const extra = uncatalogued({ caches: present.caches, databases: present.databases ?? [] })
  const cachesWithSize = await Promise.all(
    extra.caches.map(async (name) => ({ name, ...(await cacheSize(name).catch(() => ({ bytes: null, items: 0 }))) })),
  )
  return { caches: cachesWithSize, databases: extra.databases }
}

/** Delete a cache the catalogue does not list. A database is never deleted from here. */
export async function deleteOtherCache(name: string, catalogued: ReadonlySet<string>): Promise<void> {
  if (catalogued.has(name)) throw new Error(`${name} is a listed cache; clear it by its row.`)
  await caches.delete(name)
}
