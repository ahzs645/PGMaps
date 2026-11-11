/** Where the Sentinel-2 image sits in the plan's layer stack. DOM-free. */

export const SENTINEL_LAYER_ID = 'road-sentinel2'
/** The plan's lowest engineering layer: the imagery stays under it and everything the plan draws above it. */
export const SENTINEL_ANCHOR_LAYER_ID = 'road-contours'

/**
 * The layer to move the imagery before, or null when it already sits right: above every other
 * raster (the plan's hillshade, imported backgrounds) and below the first engineering layer. A
 * hillshade picked after the imagery was added goes on top of the stack, which would cover it.
 */
export function sentinelBeforeId(layers: ReadonlyArray<{ id: string; type: string }>): string | null {
  const index = layers.findIndex((layer) => layer.id === SENTINEL_LAYER_ID)
  const anchor = layers.findIndex((layer) => layer.id === SENTINEL_ANCHOR_LAYER_ID)
  if (index < 0 || anchor < 0) return null
  if (index > anchor) return SENTINEL_ANCHOR_LAYER_ID
  for (let i = index + 1; i < anchor; i++)
    if (layers[i].type === 'raster' || layers[i].type === 'hillshade') return SENTINEL_ANCHOR_LAYER_ID
  return null
}
