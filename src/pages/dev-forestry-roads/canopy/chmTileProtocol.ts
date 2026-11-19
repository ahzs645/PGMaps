/**
 * The canopy height map as MapLibre raster tiles: a `pgmaps-chm://{z}/{x}/{y}` protocol that reads
 * one block of one Source Cooperative COG per tile (`readChmTile`), colours it in the block sheet's
 * classes and hands MapLibre an ImageBitmap, which it uses without decoding. MapLibre requests tiles
 * as the map moves, keeps parents and children drawn while they load, aborts a tile that leaves the
 * view (the abort reaches the block read) and caches the rest. Browser only.
 *
 * A small store says how many tiles are being read and which failed, for the layer's card.
 */
import * as maplibregl from 'maplibre-gl'
import { CHM_TILE_SIZE, chmTileRgba, readChmTile } from '@/lib/forestry/canopy/chmTiles'
import { chmTileDeps } from './chmFiles'

export const CHM_TILE_PROTOCOL = 'pgmaps-chm'
export const CHM_TILE_URL = `${CHM_TILE_PROTOCOL}://{z}/{x}/{y}`

export interface ChmTileStatus {
  /** Tiles being read now. */
  reading: number
  /** Tiles whose read failed, by `z/x/y`, with the reason; a later read of the same tile clears it. */
  failed: ReadonlyMap<string, string>
}

let status: ChmTileStatus = { reading: 0, failed: new Map() }
const listeners = new Set<() => void>()
function update(next: Partial<ChmTileStatus>) {
  status = { ...status, ...next }
  for (const listener of listeners) listener()
}

export const chmTileStatus = {
  subscribe(listener: () => void) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  get: () => status,
  /** Forgets failures, when the layer is taken off (its tiles are read again when it comes back). */
  reset() {
    if (status.failed.size) update({ failed: new Map() })
  },
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'The canopy height map could not be read from Source Cooperative.'

const TILE_PATH = /^pgmaps-chm:\/\/(\d+)\/(\d+)\/(\d+)$/

async function loadTile(params: { url: string }, abort: AbortController): Promise<{ data: ImageBitmap | null }> {
  const match = TILE_PATH.exec(params.url)
  if (!match) throw Error(`Not a canopy tile: ${params.url}`)
  const [z, x, y] = match.slice(1).map(Number)
  const key = `${z}/${x}/${y}`
  update({ reading: status.reading + 1 })
  try {
    const values = await readChmTile(z, x, y, chmTileDeps(abort.signal))
    const start = performance.now()
    const rgba = values && chmTileRgba(values)
    // Measured, so a trace or a test can see each tile's main-thread cost.
    performance.measure('pgmaps-chm-colour', { start, end: performance.now() })
    const bitmap = rgba
      ? await createImageBitmap(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, CHM_TILE_SIZE, CHM_TILE_SIZE))
      : null
    if (status.failed.has(key)) {
      const failed = new Map(status.failed)
      failed.delete(key)
      update({ failed })
    }
    // A tile with no canopy (or no file) is a tile that exists and is clear, never a missing one.
    return { data: bitmap }
  } catch (error) {
    if (!abort.signal.aborted) update({ failed: new Map(status.failed).set(key, message(error)) })
    throw error
  } finally {
    update({ reading: status.reading - 1 })
  }
}

let registered = false
/** Registers the protocol once per page; safe to call on every render. */
export function registerChmTiles() {
  if (registered) return
  registered = true
  maplibregl.addProtocol(CHM_TILE_PROTOCOL, loadTile as unknown as Parameters<typeof maplibregl.addProtocol>[1])
}
