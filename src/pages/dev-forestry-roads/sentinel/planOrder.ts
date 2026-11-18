/** Where the Sentinel-2 image sits in the plan's layer stack. DOM-free. */

export const SENTINEL_LAYER_ID = 'road-sentinel2'
/** The plan's lowest engineering layer: the imagery stays under it and everything the plan draws above it. */
export const SENTINEL_ANCHOR_LAYER_ID = 'road-contours'
/**
 * Part-transparent overlays (the canopy height map) that sit right under the anchor, above the
 * imagery. The imagery's rule passes over them, so the two never move each other back and forth.
 */
export const PLAN_OVERLAY_LAYER_IDS: ReadonlySet<string> = new Set(['road-canopy-height'])

/**
 * The layer to move the imagery before, or null when it already sits right: above every other
 * raster (the plan's hillshade, imported backgrounds) and below the first engineering layer. A
 * hillshade picked after the imagery was added goes on top of the stack, which would cover it.
 */
export function imageryBeforeId(layers: ReadonlyArray<{ id: string; type: string }>, id: string): string | null {
  const index = layers.findIndex((layer) => layer.id === id)
  const anchor = layers.findIndex((layer) => layer.id === SENTINEL_ANCHOR_LAYER_ID)
  if (index < 0 || anchor < 0) return null
  if (index > anchor) return SENTINEL_ANCHOR_LAYER_ID
  for (let i = index + 1; i < anchor; i++)
    if (!PLAN_OVERLAY_LAYER_IDS.has(layers[i].id) && (layers[i].type === 'raster' || layers[i].type === 'hillshade'))
      return SENTINEL_ANCHOR_LAYER_ID
  return null
}

/** An overlay goes directly under the anchor: over the imagery, under every engineering layer. */
export function overlayBeforeId(layers: ReadonlyArray<{ id: string; type: string }>, id: string): string | null {
  const index = layers.findIndex((layer) => layer.id === id)
  const anchor = layers.findIndex((layer) => layer.id === SENTINEL_ANCHOR_LAYER_ID)
  if (index < 0 || anchor < 0) return null
  for (let i = index + 1; i < anchor; i++)
    if (!PLAN_OVERLAY_LAYER_IDS.has(layers[i].id)) return SENTINEL_ANCHOR_LAYER_ID
  return index > anchor ? SENTINEL_ANCHOR_LAYER_ID : null
}
