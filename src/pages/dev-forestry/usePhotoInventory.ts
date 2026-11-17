/**
 * An own photo's own reads of the visual landscape inventory and VRI, for the ground its camera sees, when that ground
 * lies outside what the page read for the scene (`photoPageFeatures.ts`). Made only while a layer that needs one is
 * switched on (`wanted`), kept in a small cache shared by the window and the docked pane, and never put in place of a
 * read that failed: a failure is the layer's *Not read* note, with its reason.
 */
import { useEffect, useState } from 'react'

import { fetchVegetationStands, MAX_VEGETATION_QUERY_DEGREES, sceneCoverTiles } from './bcVegetationInventory'
import { VLI_WFS_MAX_FEATURES } from './bcVisualInventory'
import { PhotoCache } from './photoCache'
import type { Box } from './photoFeatures'
import {
  boxWithin,
  photoReadBox,
  photoReadKey,
  visualInventoryFeatures,
  vriFeatures,
  type PhotoInventoryKind,
  type PhotoInventoryRead,
} from './photoPageFeatures'
import { queryVisualInventory } from './visualInventoryQuery'

type ReadyRead = Extract<PhotoInventoryRead, { status: 'ready' }>

/** VRI tiles read at most for one photo: the nearest to the middle of its ground when it sees more. */
const MAX_VRI_TILES = 4
const READ_TIMEOUT_MS = 30_000

// Shared by every mount: the window and the docked pane draw the same photo. A read is not tied to one mount's
// lifetime, so a pane closing never aborts the window's read; a slow one gives up at READ_TIMEOUT_MS.
const reads = new PhotoCache<ReadyRead>({ maxEntries: 6, sizeOf: () => 0 })

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, what: string): Promise<T> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), READ_TIMEOUT_MS)
  try {
    return await run(abort.signal)
  } catch (error) {
    if (abort.signal.aborted) throw new Error(`DataBC did not answer for ${what} within 30 s.`)
    throw error
  } finally {
    clearTimeout(timer)
  }
}

async function readVisual(box: Box): Promise<ReadyRead> {
  const result = await withTimeout((signal) => queryVisualInventory(box, signal), 'the visual landscape inventory')
  const features = visualInventoryFeatures(result.units)
  return {
    status: 'ready',
    box,
    features,
    partial: result.truncated
      ? `Cut short at ${VLI_WFS_MAX_FEATURES.toLocaleString()} units: more lie in the ground this photo sees`
      : null,
  }
}

async function readVri(box: Box): Promise<ReadyRead> {
  const tiles = sceneCoverTiles(box, MAX_VEGETATION_QUERY_DEGREES)
  const read = tiles.slice(0, MAX_VRI_TILES)
  const results = await withTimeout(
    (signal) => Promise.all(read.map((tile) => fetchVegetationStands(tile, { signal }))),
    'the vegetation inventory',
  )
  const features = vriFeatures(results.flatMap((result) => result.stands))
  const partial =
    tiles.length > read.length
      ? `Read for the middle of the ground this photo sees (${read.length} of ${tiles.length} tiles)`
      : results.some((result) => result.truncated)
        ? 'Cut short at the feature cap: more stands lie in the ground this photo sees'
        : null
  return { status: 'ready', box, features, partial }
}

/**
 * The photo's own reads, by kind, for the ground `seen`. A kind is read when `wanted` and no read of it already takes
 * the ground in; the last read that does stays in use while the camera moves within it.
 */
export function usePhotoInventory(
  wanted: Record<PhotoInventoryKind, boolean>,
  seen: Box | null,
): Partial<Record<PhotoInventoryKind, PhotoInventoryRead>> {
  const [state, setState] = useState<Partial<Record<PhotoInventoryKind, PhotoInventoryRead>>>({})
  const box = seen ? photoReadBox(seen) : null
  const boxKey = box?.join(',') ?? null

  useEffect(() => {
    if (!box) return
    let live = true
    for (const kind of ['visual', 'vri'] as const) {
      if (!wanted[kind]) continue
      const current = state[kind]
      const ground = seen ?? box
      if (current?.status === 'ready' && boxWithin(ground, current.box)) continue
      // A read still under way that takes the ground in is waited for again (the cache shares its promise).
      const target = current?.status === 'loading' && boxWithin(ground, current.box) ? current.box : box
      const key = photoReadKey(kind, target)
      const kept = reads.get(key)
      if (kept) {
        setState((old) => ({ ...old, [kind]: kept }))
        continue
      }
      setState((old) => ({ ...old, [kind]: { status: 'loading', box: target } }))
      reads
        .getOrCreate(key, () => (kind === 'visual' ? readVisual(target) : readVri(target)))
        .then((read) => {
          if (live) setState((old) => ({ ...old, [kind]: read }))
        })
        .catch((error: unknown) => {
          if (live) setState((old) => ({ ...old, [kind]: { status: 'failed', box: target, message: message(error) } }))
        })
    }
    return () => {
      live = false
    }
    // The box's key stands for the box; `state` is read only to skip a read already made. A failed read is tried
    // again when the camera's ground changes or its layer is switched off and on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxKey, wanted.visual, wanted.vri])

  return state
}
