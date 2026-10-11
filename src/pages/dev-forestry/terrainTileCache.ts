/** Bounded decoded-tile LRU and shared in-flight requests. Each JS realm owns its
 * decoded arrays; browser Cache Storage (in demLoader) shares validated PNGs
 * between analysis workers, the road camera, and later visits. */
export function createTerrainTileCache(limit = 128) {
  const completed = new Map<string, Float32Array>()
  const pending = new Map<string, { promise: Promise<Float32Array>; controller: AbortController; users: number }>()
  return {
    clear() {
      completed.clear()
    },
    async get(
      key: string,
      load: (signal: AbortSignal) => Promise<Float32Array>,
      signal?: AbortSignal,
    ): Promise<Float32Array> {
      if (signal?.aborted) throw new DOMException('Terrain loading cancelled', 'AbortError')
      const hit = completed.get(key)
      if (hit) {
        completed.delete(key)
        completed.set(key, hit)
        return hit
      }
      let entry = pending.get(key)
      if (!entry || entry.controller.signal.aborted) {
        const controller = new AbortController()
        const next: { controller: AbortController; users: number; promise: Promise<Float32Array> } = {
          controller,
          users: 0,
          promise: Promise.resolve(new Float32Array()),
        }
        next.promise = load(controller.signal)
          .then((data) => {
            if (!controller.signal.aborted) {
              completed.set(key, data)
              while (completed.size > limit) completed.delete(completed.keys().next().value!)
            }
            return data
          })
          .finally(() => {
            if (pending.get(key) === next) pending.delete(key)
          })
        pending.set(key, next)
        entry = next
      }
      entry.users++
      const active = entry
      return new Promise<Float32Array>((resolve, reject) => {
        let settled = false
        const finish = (data?: Float32Array, error?: unknown) => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', cancel)
          active.users--
          if (!active.users && pending.get(key) === active) active.controller.abort()
          if (error) reject(error)
          else resolve(data!)
        }
        const cancel = () => finish(undefined, new DOMException('Terrain loading cancelled', 'AbortError'))
        signal?.addEventListener('abort', cancel, { once: true })
        active.promise.then(
          (data) => finish(data),
          (error) => finish(undefined, error),
        )
        if (signal?.aborted) cancel()
      })
    },
  }
}
export const terrainTileCache = createTerrainTileCache()

const STORAGE_NAME = 'pgmaps-terrarium-png-v1'
const MAX_STORED_TILES = 128
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
// Storage failures never turn successful terrain into unknown ground.
export async function storedTerrainTile(url: string): Promise<ArrayBuffer | null> {
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(STORAGE_NAME)
    const response = await cache.match(url)
    if (!response) return null
    const age = Date.now() - Number(response.headers.get('x-pgmaps-cached-at') || 0)
    if (age > MAX_AGE_MS) {
      await cache.delete(url)
      return null
    }
    return await response.arrayBuffer()
  } catch {
    return null
  }
}
export async function storeTerrainTile(url: string, bytes: ArrayBuffer) {
  try {
    if (typeof caches === 'undefined') return
    const cache = await caches.open(STORAGE_NAME)
    await cache.put(
      url,
      new Response(bytes, { headers: { 'Content-Type': 'image/png', 'x-pgmaps-cached-at': String(Date.now()) } }),
    )
    const keys = await cache.keys()
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STORED_TILES))) await cache.delete(key)
  } catch {
    /* Quota, private mode, or disabled storage: use memory/HTTP caching. */
  }
}
export async function deleteStoredTerrainTile(url: string) {
  try {
    if (typeof caches !== 'undefined') await (await caches.open(STORAGE_NAME)).delete(url)
  } catch {
    /* Optional cache. */
  }
}
