/**
 * A small least-recently-used cache, keyed by string and held to a count and a byte budget: the own-photo tools keep
 * terrain, imagery, horizons, pixels and results in these, so the frames of a burst share what they can and a long
 * flight cannot grow the page without bound.
 *
 * Free of DOM and network access.
 */

export type PhotoCacheOptions<T> = {
  /** The most entries kept. */
  maxEntries: number
  /** The most bytes kept, as `sizeOf` counts them; default unbounded. */
  maxBytes?: number
  /** Bytes an entry holds; default `typedArrayBytes`. */
  sizeOf?: (value: T) => number
  /** Called for each entry pushed out or replaced (not for `delete` or `clear`'s own callers), e.g. to revoke a URL. */
  onEvict?: (key: string, value: T) => void
}

/**
 * Bytes held in typed arrays and array buffers, found through plain objects and arrays a few levels deep. Numbers,
 * strings and small objects count nothing: what fills memory here is pixels and terrain.
 */
export function typedArrayBytes(value: unknown, depth = 4): number {
  if (value === null || typeof value !== 'object') return 0
  if (ArrayBuffer.isView(value)) return value.byteLength
  if (value instanceof ArrayBuffer) return value.byteLength
  if (depth <= 0) return 0
  let bytes = 0
  if (Array.isArray(value)) {
    for (const item of value) bytes += typedArrayBytes(item, depth - 1)
    return bytes
  }
  for (const key of Object.keys(value)) bytes += typedArrayBytes((value as Record<string, unknown>)[key], depth - 1)
  return bytes
}

export class PhotoCache<T> {
  private readonly entries = new Map<string, { value: T; bytes: number }>()
  private readonly pending = new Map<string, { promise: Promise<T>; controller: AbortController; waiters: number }>()
  private total = 0
  private readonly options: Required<Omit<PhotoCacheOptions<T>, 'onEvict'>> & Pick<PhotoCacheOptions<T>, 'onEvict'>

  constructor({ maxEntries, maxBytes = Infinity, sizeOf = typedArrayBytes, onEvict }: PhotoCacheOptions<T>) {
    this.options = { maxEntries: Math.max(1, Math.floor(maxEntries)), maxBytes, sizeOf, onEvict }
  }

  get size(): number {
    return this.entries.size
  }

  /** Bytes held, as `sizeOf` counted them when each entry was set. */
  get bytes(): number {
    return this.total
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  /** The value, marked as just used; undefined when absent. */
  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (!entry) return undefined
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry.value
  }

  /** The value without marking it used. */
  peek(key: string): T | undefined {
    return this.entries.get(key)?.value
  }

  /**
   * Keeps a value, pushing out the least recently used until the cache fits. A value larger than the whole byte
   * budget is not kept (it would push out everything else and then itself); returns whether it was kept.
   */
  set(key: string, value: T, bytes = this.options.sizeOf(value)): boolean {
    const previous = this.entries.get(key)
    if (previous) {
      this.entries.delete(key)
      this.total -= previous.bytes
      if (previous.value !== value) this.options.onEvict?.(key, previous.value)
    }
    if (bytes > this.options.maxBytes) return false
    this.entries.set(key, { value, bytes })
    this.total += bytes
    for (const [oldest, entry] of this.entries) {
      if (this.entries.size <= this.options.maxEntries && this.total <= this.options.maxBytes) break
      if (oldest === key) continue
      this.entries.delete(oldest)
      this.total -= entry.bytes
      this.options.onEvict?.(oldest, entry.value)
    }
    return true
  }

  delete(key: string): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.entries.delete(key)
    this.total -= entry.bytes
    return true
  }

  clear(): void {
    this.entries.clear()
    this.pending.clear()
    this.total = 0
  }

  /** Keys from least to most recently used. */
  keys(): string[] {
    return [...this.entries.keys()]
  }

  /**
   * The cached value, or `create`'s, kept once it resolves. Callers asking for the same key while it is being made
   * share one load; a failure is not kept, so the next call tries again.
   *
   * A shared load is not any one caller's to stop: `create` is handed the cache's own signal, aborted only once every
   * caller waiting on it has given up. A caller's own `signal` ends its wait alone (rejecting with the signal's
   * reason) and leaves the load running for the rest. Without this the first caller's abort (a camera moved on, the
   * queue cancelled) failed every other caller sharing the load, and they had no reason to ask again.
   */
  getOrCreate(key: string, create: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.entries.has(key)) return Promise.resolve(this.get(key) as T)
    if (signal?.aborted) return Promise.reject(abortReason(signal))
    let load = this.pending.get(key)
    if (!load) {
      const controller = new AbortController()
      const made: Promise<T> = create(controller.signal).then(
        (value) => {
          if (this.pending.get(key)?.promise === made) {
            this.pending.delete(key)
            this.set(key, value)
          }
          return value
        },
        (error: unknown) => {
          if (this.pending.get(key)?.promise === made) this.pending.delete(key)
          throw error
        },
      )
      load = { promise: made, controller, waiters: 0 }
      this.pending.set(key, load)
    }
    const shared = load
    shared.waiters++
    // A caller with no signal waits to the end, so the load is never stopped under it.
    if (!signal) return shared.promise
    return new Promise<T>((resolve, reject) => {
      const leave = () => {
        signal.removeEventListener('abort', leave)
        reject(abortReason(signal))
        if (--shared.waiters <= 0 && this.pending.get(key) === shared) {
          this.pending.delete(key)
          shared.controller.abort(abortReason(signal))
        }
      }
      signal.addEventListener('abort', leave, { once: true })
      shared.promise.then(
        (value) => {
          signal.removeEventListener('abort', leave)
          resolve(value)
        },
        (error: unknown) => {
          signal.removeEventListener('abort', leave)
          reject(error)
        },
      )
    })
  }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('The operation was aborted.', 'AbortError')
}
