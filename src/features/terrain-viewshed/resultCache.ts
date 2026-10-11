import type { ViewshedResult } from './model'

/** Small complete-result LRU. Clone transfers so posting never detaches cached arrays. */
export class ViewshedResultCache {
  private entries = new Map<string, ViewshedResult>()
  constructor(private limit = 32) {}
  clear() {
    this.entries.clear()
  }
  get(key: string) {
    const result = this.entries.get(key)
    if (!result) return null
    this.entries.delete(key)
    this.entries.set(key, result)
    return structuredClone(result)
  }
  put(key: string, result: ViewshedResult) {
    if (result.missingTileCount || result.counts.unknown) return
    this.entries.delete(key)
    this.entries.set(key, structuredClone(result))
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!)
  }
}
