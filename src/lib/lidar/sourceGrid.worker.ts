/// <reference lib="webworker" />
import { fetchSourceGrid } from './sourceGridRead'

/** Reads one source grid off the page's thread and hands its values back without a copy. */
self.onmessage = async (event: MessageEvent<{ url?: string; name?: string; hash?: string }>) => {
  const { url, name, hash } = event.data ?? {}
  if (!url || !name || !hash) return
  try {
    const grid = await fetchSourceGrid(url, name, hash)
    self.postMessage({ grid }, [grid.values.buffer])
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) })
  }
}
