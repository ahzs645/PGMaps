/** Incremental native-block loading. Visible data is pinned; only idle blocks use the LRU budget. */
export class ViewportBlockLoader<T> {
  private wanted: string[] = []
  private visible = new Set<string>()
  private cache = new Map<string, T>()
  private pending = new Map<string, AbortController>()
  private errors = new Map<string, string>()
  private disposed = false
  private paused = false

  constructor(
    private fetchBlock: (id: string, signal: AbortSignal) => Promise<T>,
    private changed: () => void,
    private concurrency = 6,
    private idleLimit = 32,
  ) {}

  update(visible: string[], prefetched: string[] = [], retry = false, loadNew = true) {
    if (this.disposed) return
    this.paused = !loadNew
    this.visible = new Set(visible)
    this.wanted = [...new Set([...visible, ...prefetched])]
    const wanted = new Set(this.wanted)
    for (const [id, controller] of this.pending) {
      if (!wanted.has(id)) {
        this.pending.delete(id)
        controller.abort()
      }
    }
    for (const id of this.errors.keys()) if (retry || !wanted.has(id)) this.errors.delete(id)
    // Touch retained blocks without changing their identity (deck.gl reuses their GPU buffers).
    for (const id of this.wanted) {
      if (this.cache.has(id)) {
        const data = this.cache.get(id)!
        this.cache.delete(id)
        this.cache.set(id, data)
      }
    }
    this.trim()
    this.changed()
    this.pump()
  }

  snapshot() {
    const blocks = this.wanted.filter((id) => this.cache.has(id)).map((id) => ({ id, data: this.cache.get(id)! }))
    const loaded = [...this.visible].filter((id) => this.cache.has(id)).length
    const errors = [...this.visible].flatMap((id) => (this.errors.has(id) ? [this.errors.get(id)!] : []))
    const visibleBlocks = blocks.filter((block) => this.visible.has(block.id))
    return { blocks, visibleBlocks, loaded, total: this.visible.size, errors }
  }

  dispose() {
    this.disposed = true
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
    this.cache.clear()
  }

  private trim() {
    const wanted = new Set(this.wanted)
    const idle = [...this.cache.keys()].filter((id) => !wanted.has(id))
    for (const id of idle.slice(0, Math.max(0, idle.length - this.idleLimit))) this.cache.delete(id)
  }

  private pump() {
    if (this.disposed || this.paused) return
    for (const id of this.wanted) {
      if (this.pending.size >= this.concurrency) break
      if (this.cache.has(id) || this.pending.has(id) || this.errors.has(id)) continue
      const controller = new AbortController()
      this.pending.set(id, controller)
      void this.fetchBlock(id, controller.signal)
        .then((data) => {
          if (this.disposed || controller.signal.aborted) return
          this.cache.set(id, data)
          this.trim()
        })
        .catch((cause: unknown) => {
          if (this.disposed || controller.signal.aborted) return
          this.errors.set(id, cause instanceof Error ? cause.message : String(cause))
        })
        .finally(() => {
          if (this.pending.get(id) !== controller) return
          this.pending.delete(id)
          if (this.disposed) return
          this.changed()
          this.pump()
        })
    }
  }
}
