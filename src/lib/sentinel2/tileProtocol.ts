/**
 * Sentinel-2 scenes as MapLibre raster tiles: the `pgmaps-s2://{epsg}/{z}/{x}/{y}?cog=…` protocol
 * hands each tile to a worker (`sentinelTiles.worker.ts`), which reads the part of the scene's
 * true-colour COG the tile needs, decodes it and warps it onto the tile (`tiles.ts`); the page only
 * turns the pixels into an ImageBitmap. MapLibre asks for tiles as the map moves, keeps loaded
 * parents and children drawn while new ones load, aborts a tile that leaves the view (the abort
 * reaches the worker's read) and caches the rest. Browser only; the canopy layer's
 * `chmTileProtocol.ts` is the same pattern on the page's thread.
 */
import * as maplibregl from 'maplibre-gl'
import { parseSentinelTileUrl, SENTINEL_TILE_PROTOCOL, SENTINEL_TILE_SIZE } from './tiles'
import type { SentinelTileAnswer, SentinelTileRequest } from './sentinelTiles.worker'

type Waiting = { resolve: (rgba: Uint8ClampedArray | null) => void; reject: (error: Error) => void }
let worker: Worker | null = null
const waiting = new Map<number, Waiting>()
let nextId = 1

// The worker, and geotiff in it, start with the first tile, never with a page that draws none.
function tileWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./sentinelTiles.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = ({ data }: MessageEvent<SentinelTileAnswer>) => {
    const entry = waiting.get(data.id)
    if (!entry) return
    waiting.delete(data.id)
    if ('error' in data) entry.reject(new Error(data.error))
    else entry.resolve(data.rgba)
  }
  return worker
}

function readTile(tile: NonNullable<ReturnType<typeof parseSentinelTileUrl>>, signal: AbortSignal) {
  const id = nextId++
  const post = (message: SentinelTileRequest) => tileWorker().postMessage(message)
  return new Promise<Uint8ClampedArray | null>((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    signal.addEventListener(
      'abort',
      () => {
        if (!waiting.delete(id)) return
        post({ type: 'abort', id })
        reject(signal.reason ?? new DOMException('The tile left the view.', 'AbortError'))
      },
      { once: true },
    )
    post({ type: 'tile', id, ...tile })
  })
}

async function loadTile(params: { url: string }, abort: AbortController): Promise<{ data: ImageBitmap | null }> {
  const tile = parseSentinelTileUrl(params.url)
  if (!tile) throw Error(`Not a Sentinel-2 tile: ${params.url}`)
  const rgba = await readTile(tile, abort.signal)
  // A tile outside the drawn zooms, or with no scene under it, exists and is clear.
  if (!rgba) return { data: null }
  return {
    data: await createImageBitmap(
      new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, SENTINEL_TILE_SIZE, SENTINEL_TILE_SIZE),
    ),
  }
}

let registered = false
/** Registers the protocol once per page; safe to call on every render. */
export function registerSentinelTiles() {
  if (registered) return
  registered = true
  maplibregl.addProtocol(SENTINEL_TILE_PROTOCOL, loadTile as unknown as Parameters<typeof maplibregl.addProtocol>[1])
}
