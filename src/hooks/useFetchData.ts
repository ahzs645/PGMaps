import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FetchError, fetchJson } from '@/lib/fetchJson'

export interface FetchDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
  /** Re-run the request, bypassing the cache. */
  retry: () => void
}

export interface UseFetchDataOptions<T> {
  /** Skip fetching while false; state resets to idle. Defaults to true. */
  enabled?: boolean
  /** Keep parsed responses in a module-level cache for the page lifetime. Defaults to true — static files under public/data never change within a session. */
  cache?: boolean
  /** Map the parsed JSON to the hook's return shape. Does not need to be referentially stable. */
  transform?: (json: unknown) => T
  /**
   * Additional URLs to try, in order, if the primary one fails. For datasets
   * that ship as `.json.gz` with a plain `.json` fallback, or that moved.
   */
  fallbackUrls?: readonly string[]
  /** Resolve to `data: null` instead of an error when the file is missing (404). */
  optional?: boolean
}

const valueCache = new Map<string, unknown>()
/**
 * In-flight requests, keyed by URL. Without this, N components mounting in the
 * same tick each fire their own request for the same file — the value cache
 * only helps once the first has already resolved.
 */
const promiseCache = new Map<string, Promise<unknown>>()

function loadJson(url: string, cache: boolean, signal: AbortSignal): Promise<unknown> {
  if (!cache) return fetchJson(url, signal)
  if (valueCache.has(url)) return Promise.resolve(valueCache.get(url))

  const inFlight = promiseCache.get(url)
  if (inFlight) return inFlight

  // Deliberately unsignalled: the promise is shared, so one unmounting consumer
  // must not abort the request the others are still waiting on.
  const promise = fetchJson(url)
    .then((json) => {
      valueCache.set(url, json)
      promiseCache.delete(url)
      return json as unknown
    })
    .catch((error: unknown) => {
      promiseCache.delete(url)
      throw error
    })
  promiseCache.set(url, promise)
  return promise
}

/** Try each URL in order, returning the first success. Rethrows the last error if all fail. */
async function loadFirst(urls: readonly string[], cache: boolean, signal: AbortSignal): Promise<unknown> {
  let lastError: unknown
  for (const url of urls) {
    try {
      return await loadJson(url, cache, signal)
    } catch (error) {
      if (signal.aborted) throw error
      lastError = error
    }
  }
  throw lastError
}

function errorMessage(error: unknown, url: string): string {
  return error instanceof Error ? error.message : `Unable to load ${url}`
}

function isMissing(error: unknown): boolean {
  return error instanceof FetchError && error.status === 404
}

function clearCache(urls: readonly string[]): void {
  for (const url of urls) {
    valueCache.delete(url)
    promiseCache.delete(url)
  }
}

function resolveSyncState<T>(
  urls: readonly string[],
  enabled: boolean,
  cache: boolean,
  transform: ((json: unknown) => T) | undefined,
): { data: T | null; loading: boolean; error: string | null } {
  if (!urls.length || !enabled) return { data: null, loading: false, error: null }
  if (cache) {
    const hit = urls.find((url) => valueCache.has(url))
    if (hit !== undefined) {
      const cached = valueCache.get(hit)
      return { data: transform ? transform(cached) : (cached as T), loading: false, error: null }
    }
  }
  return { data: null, loading: true, error: null }
}

/**
 * Fetch-and-parse JSON with loading/error state, abort on unmount or URL
 * change, and an in-memory cache shared across mounts. Cache hits resolve
 * synchronously (no loading flash).
 */
export function useFetchData<T>(url: string | null, options: UseFetchDataOptions<T> = {}): FetchDataState<T> {
  const { enabled = true, cache = true, transform, fallbackUrls, optional = false } = options

  const fallbackKey = (fallbackUrls ?? []).join('|')
  const urls = useMemo(
    () => (url ? [url, ...(fallbackKey ? fallbackKey.split('|') : [])] : []),
    [url, fallbackKey],
  )

  const [attempt, setAttempt] = useState(0)
  const useCacheThisRun = cache && attempt === 0
  const requestKey = `${enabled ? 1 : 0}|${cache ? 1 : 0}|${optional ? 1 : 0}|${attempt}|${urls.join('|')}`

  const [state, setState] = useState(() => resolveSyncState(urls, enabled, cache, transform))
  const [lastKey, setLastKey] = useState(requestKey)
  if (lastKey !== requestKey) {
    setLastKey(requestKey)
    setState(resolveSyncState(urls, enabled, useCacheThisRun, transform))
  }

  const transformRef = useRef(transform)
  useEffect(() => {
    transformRef.current = transform
  })

  const retry = useCallback(() => {
    clearCache(urls)
    setAttempt((current) => current + 1)
  }, [urls])

  useEffect(() => {
    if (!urls.length || !enabled) return
    if (useCacheThisRun && urls.some((entry) => valueCache.has(entry))) return

    const controller = new AbortController()
    loadFirst(urls, useCacheThisRun, controller.signal)
      .then((json) => {
        if (controller.signal.aborted) return
        setState({
          data: transformRef.current ? transformRef.current(json) : (json as T),
          loading: false,
          error: null,
        })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (optional && isMissing(error)) {
          setState({ data: null, loading: false, error: null })
          return
        }
        setState({ data: null, loading: false, error: errorMessage(error, urls[0]) })
      })
    return () => controller.abort()
  }, [urls, enabled, useCacheThisRun, optional])

  return { ...state, retry }
}

export interface UseFetchAllOptions<T> {
  enabled?: boolean
  cache?: boolean
  transform?: (json: unknown, index: number) => T
  /** Leave `null` in a slot whose file is missing (404) instead of failing the batch. */
  optional?: boolean
}

/**
 * Fetch several URLs in parallel, resolving once all have settled. The result
 * array is index-aligned with `urls`. Replaces the hand-rolled
 * `Promise.all([...])` blocks that every multi-file module wrote around its own
 * loading/error/abort bookkeeping.
 */
export function useFetchAll<T>(
  urls: readonly string[] | null,
  options: UseFetchAllOptions<T> = {},
): FetchDataState<(T | null)[]> {
  const { enabled = true, cache = true, transform, optional = false } = options

  const key = (urls ?? []).join('|')
  const list = useMemo(() => (key ? key.split('|') : []), [key])

  const [attempt, setAttempt] = useState(0)
  const useCacheThisRun = cache && attempt === 0
  const requestKey = `${enabled ? 1 : 0}|${cache ? 1 : 0}|${optional ? 1 : 0}|${attempt}|${key}`

  const idleState = () => ({
    data: null,
    loading: Boolean(list.length) && enabled,
    error: null,
  })
  const [state, setState] = useState<{ data: (T | null)[] | null; loading: boolean; error: string | null }>(idleState)
  // Reset during render rather than from an effect, so a URL change never
  // renders one frame of the previous batch's data.
  const [lastKey, setLastKey] = useState(requestKey)
  if (lastKey !== requestKey) {
    setLastKey(requestKey)
    setState(idleState())
  }

  const transformRef = useRef(transform)
  useEffect(() => {
    transformRef.current = transform
  })

  const retry = useCallback(() => {
    clearCache(list)
    setAttempt((current) => current + 1)
  }, [list])

  useEffect(() => {
    if (!list.length || !enabled) return

    const controller = new AbortController()

    Promise.all(
      list.map(async (entry, index) => {
        try {
          const json = await loadJson(entry, useCacheThisRun, controller.signal)
          return transformRef.current ? transformRef.current(json, index) : (json as T)
        } catch (error) {
          if (optional && isMissing(error)) return null
          throw error
        }
      }),
    )
      .then((results) => {
        if (controller.signal.aborted) return
        setState({ data: results, loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({ data: null, loading: false, error: errorMessage(error, list[0]) })
      })

    return () => controller.abort()
  }, [list, enabled, useCacheThisRun, optional])

  return { ...state, retry }
}
