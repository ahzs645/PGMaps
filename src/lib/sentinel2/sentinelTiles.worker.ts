/**
 * Reads Sentinel-2 map tiles off the page's thread: the byte-range reads, the GeoTIFF decoding and
 * the warp onto the tile (`readSentinelTile`). The page's protocol (`tileProtocol.ts`) posts a tile
 * and an id, and may post an abort for that id; the answer is the tile's RGBA, transferred.
 */
import { createCogReader } from './cogReader'
import { SENTINEL_TILE_READ_CONCURRENCY } from './limits'
import { readSentinelTile } from './tiles'

export type SentinelTileRequest =
  | { type: 'tile'; id: number; visualHref: string; epsg: number; z: number; x: number; y: number }
  | { type: 'abort'; id: number }
export type SentinelTileAnswer = { id: number; rgba: Uint8ClampedArray | null } | { id: number; error: string }

const reader = createCogReader({ concurrency: SENTINEL_TILE_READ_CONCURRENCY })
const running = new Map<number, AbortController>()
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SentinelTileRequest>) => void) | null
  postMessage(message: SentinelTileAnswer, transfer?: Transferable[]): void
}

scope.onmessage = async ({ data }) => {
  if (data.type === 'abort') {
    running.get(data.id)?.abort()
    return
  }
  const controller = new AbortController()
  running.set(data.id, controller)
  try {
    const rgba = await readSentinelTile(data.visualHref, data.epsg, data.z, data.x, data.y, reader, controller.signal)
    if (!controller.signal.aborted) scope.postMessage({ id: data.id, rgba }, rgba ? [rgba.buffer] : [])
  } catch (error) {
    if (!controller.signal.aborted)
      scope.postMessage({ id: data.id, error: error instanceof Error ? error.message : 'The tile could not be read.' })
  } finally {
    running.delete(data.id)
  }
}
