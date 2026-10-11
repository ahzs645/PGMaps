import { terrainTileCache, storedTerrainTile, storeTerrainTile, deleteStoredTerrainTile } from './terrainTileCache'
/**
 * Fetching and decoding DEM tiles into an {@link ElevationGrid}.
 *
 * The decoder is injectable so the same loader runs in a browser worker
 * (`createImageBitmap` + `OffscreenCanvas`) and in a Node harness that brings
 * its own PNG reader.
 */

import {
  DEM_TILE_SIZE,
  ElevationGrid,
  TERRARIUM_TILE_URL,
  decodeTerrariumElevation,
  demTileCoordinates,
  demTileUrl,
  type DemTileRange,
} from './terrain'

/** Turns raw tile bytes into `DEM_TILE_SIZE²` elevations in metres. */
export type TileDecoder = (bytes: ArrayBuffer) => Promise<Float32Array>

export type LoadElevationGridOptions = {
  range: DemTileRange
  /** Explicit retry bypasses decoded and persistent caches. */
  refresh?: boolean
  tileUrlTemplate?: string
  /**
   * Parallel tile requests. The map is fetching its own terrain tiles at the
   * same time, so this stays modest to keep both moving.
   */
  concurrency?: number
  decode?: TileDecoder
  signal?: AbortSignal
  onProgress?: (completed: number, total: number) => void
}

export type LoadElevationGridResult = {
  grid: ElevationGrid
  missingTileCount: number
}

/** Decodes a Terrarium PNG through the worker's canvas. */
export const decodeTerrariumTile: TileDecoder = async (bytes) => {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), {
    // Colour management would rewrite the RGB triples the elevation is packed
    // into, so both conversions are switched off.
    colorSpaceConversion: 'none',
    premultiplyAlpha: 'none',
  })
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('This browser did not provide an OffscreenCanvas 2D context')
    context.drawImage(bitmap, 0, 0)
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height)

    const elevations = new Float32Array(bitmap.width * bitmap.height)
    for (let index = 0; index < elevations.length; index += 1) {
      const offset = index * 4
      elevations[index] = decodeTerrariumElevation(data[offset], data[offset + 1], data[offset + 2])
    }
    return elevations
  } finally {
    bitmap.close()
  }
}

/** Per-attempt ceiling, so one stalled connection cannot hold up a whole run. */
const TILE_TIMEOUT_MS = 30000

function attemptSignal(signal: AbortSignal | undefined): AbortSignal | undefined {
  if (typeof AbortSignal.timeout !== 'function') return signal
  const timeout = AbortSignal.timeout(TILE_TIMEOUT_MS)
  if (!signal) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal
}

async function fetchTile(url: string, signal?: AbortSignal, refresh = false): Promise<ArrayBuffer> {
  let lastError: unknown = null
  // One retry: tile hosts occasionally drop a connection under a burst, and a
  // single missing tile punches a hole through every sightline crossing it.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { signal: attemptSignal(signal), cache: refresh ? 'reload' : 'default' })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      return await response.arrayBuffer()
    } catch (error) {
      // A timeout aborts only this attempt; a cancelled run aborts everything.
      if (signal?.aborted) throw error
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

async function decodedTile(
  url: string,
  decode: TileDecoder,
  signal?: AbortSignal,
  refresh = false,
): Promise<Float32Array> {
  const validate = (data: Float32Array) => {
    if (data.length !== DEM_TILE_SIZE * DEM_TILE_SIZE) throw new Error(`Unexpected DEM tile size: ${data.length}`)
    return data
  }
  // Injectable Node/test decoders use their own transport; production caching
  // only stores Terrarium tiles successfully validated by the browser decoder.
  if (decode !== decodeTerrariumTile) return validate(await decode(await fetchTile(url, signal, refresh)))
  if (refresh) await deleteStoredTerrainTile(url)
  return terrainTileCache.get(
    url,
    async (active) => {
      const stored = refresh ? null : await storedTerrainTile(url)
      if (stored) {
        try {
          return validate(await decode(stored))
        } catch {
          await deleteStoredTerrainTile(url)
        }
      }
      const bytes = await fetchTile(url, active, refresh)
      const data = validate(await decode(bytes))
      if (!active.aborted) await storeTerrainTile(url, bytes)
      return data
    },
    signal,
  )
}

/** Loads every tile in a range, tolerating individual failures. */
export async function loadElevationGrid({
  range,
  tileUrlTemplate = TERRARIUM_TILE_URL,
  concurrency = 4,
  decode = decodeTerrariumTile,
  signal,
  onProgress,
  refresh = false,
}: LoadElevationGridOptions): Promise<LoadElevationGridResult> {
  if (refresh && decode === decodeTerrariumTile) terrainTileCache.clear()
  const grid = new ElevationGrid(range)
  const tiles = demTileCoordinates(range)
  let missingTileCount = 0
  let completed = 0
  let next = 0

  const runWorker = async () => {
    while (next < tiles.length) {
      const tile = tiles[next]
      next += 1
      try {
        const elevations = await decodedTile(
          demTileUrl(tile.x, tile.y, range.zoom, tileUrlTemplate),
          decode,
          signal,
          refresh,
        )
        grid.setTile(tile.x, tile.y, elevations)
      } catch (error) {
        if (signal?.aborted) throw error
        // Terrain the mosaic is missing reads as NaN, which sightlines skip
        // rather than treating as sea level.
        missingTileCount += 1
      }
      completed += 1
      onProgress?.(completed, tiles.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tiles.length) }, runWorker))
  return { grid, missingTileCount }
}
