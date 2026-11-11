import {
  buildInventoryWfsUrl,
  parseSensitivityUnits,
  VLI_WFS_LAYER,
  VLI_WFS_MAX_FEATURES,
  type Bounds,
  type InventoryQueryResult,
} from './bcVisualInventory'

/** What a download of these units names as its source. */
export const VISUAL_INVENTORY_SOURCE = `DataBC WFS · ${VLI_WFS_LAYER}`

export type VisualInventoryResult = InventoryQueryResult & {
  /** When the units were read, as an ISO timestamp. */
  retrievedAt: string
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
 */
export async function queryVisualInventory(bounds: Bounds, signal?: AbortSignal): Promise<VisualInventoryResult> {
  let response: Response
  try {
    response = await fetch(buildInventoryWfsUrl(bounds), { signal })
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
    retrievedAt: new Date().toISOString(),
  }
}
