/**
 * Settled values kept by key, most recently used last, with one request per key shared by every caller.
 *
 * A caller's abort only ends its own wait: the shared request is aborted once no caller is waiting, so a
 * layer that unmounts mid-read does not fail the layer that replaced it, and nothing runs for nobody. Values
 * are evicted oldest first past `maxEntries` or `maxBytes` (when `sizeOf` is given). A failed read is never
 * kept, so the next caller tries again.
 */
export class SharedRequestCache<T> {
  private settled = new Map<string, { value: T; bytes: number }>()
  private pending = new Map<string, { promise: Promise<T>; controller: AbortController; waiters: number }>()
  private bytes = 0

  constructor(
    private options: { maxEntries: number; maxBytes?: number; sizeOf?: (value: T) => number } = { maxEntries: 32 },
  ) {}

  /** The kept value, marked as most recently used. */
  peek(key: string): T | undefined {
    const entry = this.settled.get(key)
    if (!entry) return undefined
    this.settled.delete(key)
    this.settled.set(key, entry)
    return entry.value
  }

  set(key: string, value: T) {
    const old = this.settled.get(key)
    if (old) {
      this.bytes -= old.bytes
      this.settled.delete(key)
    }
    const bytes = this.options.sizeOf?.(value) ?? 0
    // A value bigger than the whole budget is not kept: it would evict everything else and then itself.
    if (this.options.maxBytes !== undefined && bytes > this.options.maxBytes) return
    this.settled.set(key, { value, bytes })
    this.bytes += bytes
    this.evict()
  }

  /** The kept value, or the one request in flight for `key`, or a new one started with `load`. */
  load(key: string, load: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError())
    const kept = this.settled.has(key)
    if (kept) return Promise.resolve(this.peek(key) as T)
    let entry = this.pending.get(key)
    if (!entry) {
      const controller = new AbortController()
      const promise = load(controller.signal).then(
        (value) => {
          if (this.pending.get(key)?.promise === promise) this.pending.delete(key)
          if (!controller.signal.aborted) this.set(key, value)
          return value
        },
        (cause: unknown) => {
          if (this.pending.get(key)?.promise === promise) this.pending.delete(key)
          throw cause
        },
      )
      entry = { promise, controller, waiters: 0 }
      this.pending.set(key, entry)
    }
    const shared = entry
    shared.waiters += 1
    if (!signal) return shared.promise.finally(() => (shared.waiters -= 1))
    return new Promise<T>((resolve, reject) => {
      let done = false
      const leave = () => {
        if (done) return false
        done = true
        signal.removeEventListener('abort', onAbort)
        shared.waiters -= 1
        return true
      }
      const onAbort = () => {
        if (!leave()) return
        if (shared.waiters === 0 && this.pending.get(key) === shared) {
          this.pending.delete(key)
          shared.controller.abort()
        }
        reject(abortError())
      }
      signal.addEventListener('abort', onAbort, { once: true })
      shared.promise.then(
        (value) => leave() && resolve(value),
        (cause: unknown) => leave() && reject(cause),
      )
    })
  }

  clear() {
    this.settled.clear()
    this.bytes = 0
  }

  get size() {
    return this.settled.size
  }

  private evict() {
    const { maxEntries, maxBytes } = this.options
    for (const [key, entry] of this.settled) {
      if (this.settled.size <= maxEntries && (maxBytes === undefined || this.bytes <= maxBytes)) break
      this.settled.delete(key)
      this.bytes -= entry.bytes
    }
  }
}

function abortError() {
  return new DOMException('Aborted', 'AbortError')
}
