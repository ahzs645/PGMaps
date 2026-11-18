import { createKeptFetch, type KeptCopy, type KeptReadStore } from './keptReads'

/**
 * **Keep inventory copies**, bound to the browser (docs/app-updates-and-caching.md, **Inventory
 * copies**). Off unless a person turns it on in *Offline and storage*; off, `inventoryFetch` is
 * the plain `fetch` and nothing is kept.
 *
 * Everything here works in a worker as well as a page: the analysis reads the vegetation inventory
 * from its worker. So the switch lives in Cache Storage, which a worker can read (it cannot read
 * `localStorage`), and a copy in use is announced on a `BroadcastChannel`.
 */

/** The copies. Listed in `STORE_CATALOGUE`, so the storage panel sizes and clears it. */
export const INVENTORY_COPIES_CACHE = 'pgmaps-inventory-copies-v1'
/** The switch, apart from the copies so clearing them leaves it as the person set it. */
export const INVENTORY_OPTION_CACHE = 'pgmaps-inventory-option-v1'
/** Newest reads kept. A scene's reads are a few dozen requests; this is several scenes. */
export const MAX_INVENTORY_COPIES = 400
const OPTION_KEY = 'https://pgmaps.invalid/inventory-copies-enabled'
const READ_AT_HEADER = 'x-pgmaps-read-at'
const CHANNEL = 'pgmaps-inventory-copies'
/** How long a worker or page trusts its last look at the switch. */
const SWITCH_TTL_MS = 3000

const hasCaches = () => typeof caches !== 'undefined'

let switchSeen: { on: boolean; at: number } | null = null

/** The switch as last seen, when that was recent enough to trust; else undefined. */
function switchNow(): boolean | undefined {
  if (!hasCaches()) return false
  return switchSeen && Date.now() - switchSeen.at < SWITCH_TTL_MS ? switchSeen.on : undefined
}

let looking: Promise<boolean> | null = null

export function inventoryCopiesEnabled(): Promise<boolean> {
  const known = switchNow()
  if (known !== undefined) return Promise.resolve(known)
  // A scene's reads start together: they share one look at the switch.
  looking ??= (async () => {
    let on = false
    try {
      // `has` first: opening a cache creates it, and the option cache must not exist while off.
      on =
        (await caches.has(INVENTORY_OPTION_CACHE)) &&
        !!(await (await caches.open(INVENTORY_OPTION_CACHE)).match(OPTION_KEY))
    } catch {
      on = false
    }
    switchSeen = { on, at: Date.now() }
    looking = null
    return on
  })()
  return looking
}

/**
 * Turn copies on or off. Turning them off deletes every copy: off means nothing is kept, not
 * that what was kept is merely unused.
 */
export async function setInventoryCopies(on: boolean): Promise<void> {
  if (!hasCaches()) throw new Error('This browser cannot keep copies.')
  if (on) {
    const cache = await caches.open(INVENTORY_OPTION_CACHE)
    await cache.put(OPTION_KEY, new Response(new Date().toISOString()))
  } else {
    await caches.delete(INVENTORY_OPTION_CACHE)
    await caches.delete(INVENTORY_COPIES_CACHE)
  }
  switchSeen = { on, at: Date.now() }
}

const store: KeptReadStore = {
  async read(url) {
    if (!hasCaches() || !(await caches.has(INVENTORY_COPIES_CACHE))) return null
    const kept = await (await caches.open(INVENTORY_COPIES_CACHE)).match(url)
    const readAt = kept?.headers.get(READ_AT_HEADER)
    if (!kept || !readAt) return null
    return {
      body: await kept.arrayBuffer(),
      contentType: kept.headers.get('content-type') ?? 'application/json',
      readAt,
    }
  },
  async write(url, copy: KeptCopy) {
    if (!hasCaches()) return
    const cache = await caches.open(INVENTORY_COPIES_CACHE)
    // Delete first, so a read made again moves to the newest end of the list.
    await cache.delete(url)
    await cache.put(
      url,
      new Response(copy.body, { headers: { 'content-type': copy.contentType, [READ_AT_HEADER]: copy.readAt } }),
    )
    const keys = await cache.keys()
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_INVENTORY_COPIES))) await cache.delete(key)
  },
}

export interface InventoryCopyUse {
  url: string
  readAt: string
}

const channel = () => (typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CHANNEL))
const listeners = new Set<(use: InventoryCopyUse) => void>()
let announcer: BroadcastChannel | null | undefined

function announce(use: InventoryCopyUse) {
  if (announcer === undefined) announcer = channel()
  // Every other channel object hears a post, this context's listeners included; without
  // BroadcastChannel only this context can be told.
  if (announcer) announcer.postMessage(use)
  else for (const listener of listeners) listener(use)
}

/** Hear of every read answered from a copy, in this page or in any of its workers. */
export function onInventoryCopyUsed(listener: (use: InventoryCopyUse) => void): () => void {
  listeners.add(listener)
  const heard = channel()
  if (heard) heard.onmessage = (event: MessageEvent<InventoryCopyUse>) => listener(event.data)
  return () => {
    listeners.delete(listener)
    heard?.close()
  }
}

/**
 * The fetch every visual quality inventory read goes through. Hand it to a reader that takes its
 * fetch as an argument; a reader that calls `fetch` itself calls this instead.
 */
export const inventoryFetch: typeof fetch = createKeptFetch({
  fetch: (input, init) => fetch(input, init),
  store,
  // Answered at once when known, so a read with copies off is not delayed by a tick.
  enabled: () => switchNow() ?? inventoryCopiesEnabled(),
  now: () => new Date(),
  onCopyUsed: announce,
})
