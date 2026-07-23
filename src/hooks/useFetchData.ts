import { useEffect, useRef, useState } from 'react'

export interface FetchDataState<T> {
  data: T | null
  loading: boolean
  error: string | null
}

export interface UseFetchDataOptions<T> {
  /** Skip fetching while false; state resets to idle. Defaults to true. */
  enabled?: boolean
  /** Keep parsed responses in a module-level cache for the page lifetime. Defaults to true — static files under public/data never change within a session. */
  cache?: boolean
  /** Map the parsed JSON to the hook's return shape. Does not need to be referentially stable. */
  transform?: (json: unknown) => T
}

const responseCache = new Map<string, unknown>()

type DecompressionStreamConstructor = new (format: 'gzip') => TransformStream<Uint8Array, Uint8Array>

async function fetchJson(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  const buffer = await response.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  let text: string
  if (isGzip) {
    const DecompressionStreamCtor = (
      globalThis as typeof globalThis & { DecompressionStream?: DecompressionStreamConstructor }
    ).DecompressionStream
    if (!DecompressionStreamCtor) throw new Error('This browser cannot decompress gzip map data')
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStreamCtor('gzip'))
    text = await new Response(stream).text()
  } else {
    // Some hosts transparently decompress `.gz` responses based on headers.
    text = new TextDecoder().decode(bytes)
  }
  // SPA hosts return index.html with a 200 for missing files under public/
  if (!contentType.includes('json') && text.trimStart().startsWith('<')) {
    console.warn(`Expected JSON from ${url}, but received ${contentType || 'unknown content type'}`)
    throw new Error('Dataset is not included in this build')
  }
  return JSON.parse(text) as unknown
}

function resolveSyncState<T>(
  url: string | null,
  enabled: boolean,
  cache: boolean,
  transform: ((json: unknown) => T) | undefined,
): FetchDataState<T> {
  if (!url || !enabled) return { data: null, loading: false, error: null }
  if (cache && responseCache.has(url)) {
    const cached = responseCache.get(url)
    return { data: transform ? transform(cached) : (cached as T), loading: false, error: null }
  }
  return { data: null, loading: true, error: null }
}

/**
 * Fetch-and-parse JSON with loading/error state, abort on unmount or URL
 * change, and an in-memory cache shared across mounts. Cache hits resolve
 * synchronously (no loading flash).
 */
export function useFetchData<T>(url: string | null, options: UseFetchDataOptions<T> = {}): FetchDataState<T> {
  const { enabled = true, cache = true, transform } = options
  const requestKey = `${enabled ? 1 : 0}|${cache ? 1 : 0}|${url ?? ''}`

  const [state, setState] = useState<FetchDataState<T>>(() => resolveSyncState(url, enabled, cache, transform))
  const [lastKey, setLastKey] = useState(requestKey)
  if (lastKey !== requestKey) {
    setLastKey(requestKey)
    setState(resolveSyncState(url, enabled, cache, transform))
  }

  const transformRef = useRef(transform)
  useEffect(() => {
    transformRef.current = transform
  })

  useEffect(() => {
    if (!url || !enabled) return
    if (cache && responseCache.has(url)) return

    const controller = new AbortController()
    fetchJson(url, controller.signal)
      .then((json) => {
        if (controller.signal.aborted) return
        if (cache) responseCache.set(url, json)
        setState({ data: transformRef.current ? transformRef.current(json) : (json as T), loading: false, error: null })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        const message = error instanceof Error ? error.message : `Unable to load ${url}`
        setState({ data: null, loading: false, error: message })
      })
    return () => controller.abort()
  }, [url, enabled, cache])

  return state
}
