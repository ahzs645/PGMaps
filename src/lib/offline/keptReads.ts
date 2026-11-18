/**
 * Reads that may fall back to a dated copy (docs/app-updates-and-caching.md, **Inventory copies**).
 *
 * Visual quality reads the BC inventories live, and by default a failed read is an error: nothing
 * is kept. A person may turn on **Keep inventory copies**. Then each successful read is kept with
 * the time it was read, and when the source cannot be reached the last copy of the *same request*
 * answers instead, carrying that time so nothing downstream can mistake it for a fresh read.
 *
 * This file is the rule, free of DOM and network access: the fetch, the store, the switch and the
 * clock are passed in. `inventoryCopies.ts` binds it to the browser.
 */

/** On a response that came from a kept copy: when the copy was read, as an ISO timestamp. */
export const COPY_READ_AT_HEADER = 'x-pgmaps-copy-read-at'

export interface KeptCopy {
  body: ArrayBuffer
  contentType: string
  /** ISO timestamp of the live read this is a copy of. */
  readAt: string
}

export interface KeptReadStore {
  read(url: string): Promise<KeptCopy | null>
  write(url: string, copy: KeptCopy): Promise<void>
}

export interface KeptReadEnv {
  fetch: typeof fetch
  store: KeptReadStore
  /**
   * Whether the person has turned copies on. Asked on every read, so a change applies at once.
   * An answer given at once (not a promise) costs the read nothing: off, the source's fetch is
   * called in the same tick as the plain `fetch` would be.
   */
  enabled: () => Promise<boolean> | boolean
  now: () => Date
  /** A read was answered from a copy. */
  onCopyUsed?: (use: { url: string; readAt: string }) => void
}

const urlOf = (input: RequestInfo | URL): string =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : input.url

const methodOf = (input: RequestInfo | URL, init?: RequestInit): string =>
  (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()

function copyResponse(copy: KeptCopy): Response {
  return new Response(copy.body.slice(0), {
    status: 200,
    headers: { 'content-type': copy.contentType, [COPY_READ_AT_HEADER]: copy.readAt },
  })
}

/**
 * A `fetch` that keeps what it reads and falls back to it.
 *
 * - Switched off, it is the plain fetch: nothing is kept and nothing is read from a copy.
 * - A successful GET is kept. A read that was cancelled is never answered from a copy.
 * - A failed connection, or a server error (5xx), is answered from the copy of that exact URL
 *   when there is one. A 4xx is the source refusing the question and is passed through.
 * - Keeping is best effort: a full disk never fails the read it was copying.
 */
export function createKeptFetch(env: KeptReadEnv): typeof fetch {
  const fallBack = async (url: string): Promise<Response | null> => {
    const copy = await env.store.read(url).catch(() => null)
    if (!copy) return null
    env.onCopyUsed?.({ url, readAt: copy.readAt })
    return copyResponse(copy)
  }

  return async (input, init) => {
    if (methodOf(input, init) !== 'GET') return env.fetch(input, init)
    const answer = env.enabled()
    if (answer === false) return env.fetch(input, init)
    if (answer !== true) {
      if (!(await answer)) {
        // The switch took a moment to read. A read cancelled meanwhile ends as `fetch` ends it.
        init?.signal?.throwIfAborted()
        return env.fetch(input, init)
      }
      init?.signal?.throwIfAborted()
    }
    const url = urlOf(input)
    let response: Response
    try {
      response = await env.fetch(input, init)
    } catch (error) {
      if (init?.signal?.aborted) throw error
      const copy = await fallBack(url)
      if (copy) return copy
      throw error
    }
    if (response.ok) {
      const contentType = response.headers.get('content-type') ?? 'application/json'
      const readAt = env.now().toISOString()
      void response
        .clone()
        .arrayBuffer()
        .then((body) => env.store.write(url, { body, contentType, readAt }))
        .catch(() => undefined)
      return response
    }
    if (response.status >= 500) return (await fallBack(url)) ?? response
    return response
  }
}

/** When a kept copy was read, or null for a live response. */
export function copyReadAt(response: Pick<Response, 'headers'>): string | null {
  return response.headers.get(COPY_READ_AT_HEADER)
}

/** The time a response's data was read: the copy's own time, or now for a live read. */
export function readAtOf(response: Pick<Response, 'headers'>, now: Date = new Date()): string {
  return copyReadAt(response) ?? now.toISOString()
}

/** The oldest of several copy times, for a result assembled from more than one read. */
export function oldestCopy(times: ReadonlyArray<string | null | undefined>): string | undefined {
  let oldest: string | undefined
  for (const time of times) if (time && (!oldest || time < oldest)) oldest = time
  return oldest
}

/** How a source is named when its data came from a kept copy. */
export const keptCopySource = (source: string) => `${source} · kept copy`
