import { fetchJson } from './fetchJson'
import { polygonTransferables, preparePolygons, type ClassCollection } from './categoricalPolygonGeometry'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<{ url: string }>) => void) | null
  postMessage: (message: unknown, transfer?: Transferable[]) => void
}

scope.onmessage = async ({ data: { url } }) => {
  try {
    // Fetch, gzip inflation, JSON decoding and earcut triangulation stay off the UI thread.
    const data = preparePolygons(await fetchJson<ClassCollection>(url))
    scope.postMessage({ data }, polygonTransferables(data))
  } catch (cause) {
    scope.postMessage({ error: cause instanceof Error ? cause.message : String(cause) })
  }
}
