import { SENTINEL_SEARCH_CACHE_ENTRIES, SENTINEL_SEARCH_CACHE_MS, SENTINEL_SEARCH_INTERVAL_MS } from './limits'
import { searchSentinelScenes, type FetchLike, type SentinelScene } from './stac'

function waitUntil(time: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      reject(new DOMException('Scene search cancelled', 'AbortError'))
    }
    const timer = setTimeout(
      () => {
        signal?.removeEventListener('abort', cancel)
        resolve()
      },
      Math.max(0, time - Date.now()),
    )
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) cancel()
  })
}

/** A session-local catalogue LRU and request pacing; no polling or automatic failure retries. */
export function createSentinelSearch(fetch: FetchLike) {
  const cache = new Map<string, { scenes: SentinelScene[]; at: number }>()
  let nextRequestAt = 0
  const pacedFetch: FetchLike = async (input, init) => {
    const response = await fetch(input, init)
    if (response.status === 429 || response.status === 503) {
      const retry = response.headers?.get('Retry-After')
      const until = retry && (/^\d+$/.test(retry) ? Date.now() + Number(retry) * 1000 : Date.parse(retry))
      nextRequestAt = Math.max(
        nextRequestAt,
        until || Date.now() + (response.status === 429 ? 60_000 : SENTINEL_SEARCH_INTERVAL_MS),
      )
    }
    return response
  }
  return async (options: Omit<Parameters<typeof searchSentinelScenes>[0], 'fetch'>) => {
    // Recent searches use a date (not the current millisecond) so toggling the layer can reuse them.
    const key = JSON.stringify([options.window, options.range.from.slice(0, 10), options.range.to.slice(0, 10)])
    const hit = cache.get(key)
    if (hit && Date.now() - hit.at < SENTINEL_SEARCH_CACHE_MS) {
      cache.delete(key)
      cache.set(key, hit)
      return hit.scenes
    }
    // Backoff is outside the network timeout: a Retry-After longer than 30 s is still honoured.
    while (Date.now() < nextRequestAt) await waitUntil(nextRequestAt, options.signal)
    options.signal?.throwIfAborted()
    nextRequestAt = Date.now() + SENTINEL_SEARCH_INTERVAL_MS
    const scenes = await searchSentinelScenes({ ...options, fetch: pacedFetch })
    if (!options.signal?.aborted && scenes.length) {
      cache.set(key, { scenes, at: Date.now() })
      while (cache.size > SENTINEL_SEARCH_CACHE_ENTRIES) cache.delete(cache.keys().next().value!)
    }
    return scenes
  }
}
