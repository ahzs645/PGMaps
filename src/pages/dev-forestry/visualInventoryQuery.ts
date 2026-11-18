import {
  buildInventoryWfsUrl,
  parseSensitivityUnits,
  VLI_WFS_LAYER,
  VLI_WFS_MAX_FEATURES,
  type Bounds,
  type InventoryQueryResult,
} from './bcVisualInventory'
import { inventoryFetch } from '@/lib/offline/inventoryCopies'
import { copyReadAt, readAtOf } from '@/lib/offline/keptReads'

/** What a download of these units names as its source. */
export const VISUAL_INVENTORY_SOURCE = `DataBC WFS · ${VLI_WFS_LAYER}`

export type VisualInventoryResult = InventoryQueryResult & {
  /** When the units were read, as an ISO timestamp: a kept copy's own time, never the time it was used. */
  retrievedAt: string
  /** True when DataBC could not be reached and these are the kept copy of the same read. */
  fromCopy?: boolean
}

/**
 * The visual landscape inventory's units in a bbox, live from DataBC's WFS:
 * the one source that holds all 60,499 polygons at their recorded coordinates.
 *
 * There is no stored fallback. The bcdatamapper snapshot was built from the
 * ArcGIS layer, which stops at 10,000 polygons, so falling back to it turned
 * an outage into a confident "no objective here" for most of BC; a complete
 * full-resolution copy is 200–270 MB gzipped, more than the data site holds.
 * A failed read is an error the page shows, never an empty inventory.
 *
 * The one exception is a person's own choice: with *Keep inventory copies* on, a read DataBC
 * cannot answer is answered from the copy of that same read, stamped with the day it was read
 * (`src/lib/offline/keptReads.ts`). That is the complete answer DataBC gave, not a snapshot.
 */
export async function queryVisualInventory(bounds: Bounds, signal?: AbortSignal): Promise<VisualInventoryResult> {
  let response: Response
  try {
    response = await inventoryFetch(buildInventoryWfsUrl(bounds), { signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error('The BC visual landscape inventory could not be reached at DataBC. Check the connection and retry.')
  }
  if (!response.ok)
    throw new Error(`DataBC answered ${response.status} for the visual landscape inventory. Retry in a moment.`)
  const payload = (await response.json()) as { features?: unknown[]; numberMatched?: number }
  const returned = payload.features?.length ?? 0
  return {
    units: parseSensitivityUnits(payload),
    truncated:
      typeof payload.numberMatched === 'number' ? payload.numberMatched > returned : returned >= VLI_WFS_MAX_FEATURES,
    retrievedAt: readAtOf(response),
    fromCopy: copyReadAt(response) !== null,
  }
}
