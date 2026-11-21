/**
 * Where a map's relief shading goes in its basemap, shared by the road designer's regional and
 * HRDEM relief and the outdoors planner's terrain relief (`src/components/ui/map-regional-relief.tsx`
 * draws it). No DOM or network access; the map is passed in.
 */
import type { Map as MaplibreMap } from 'maplibre-gl'

/**
 * Where relief goes in the basemap: under its water, so rivers, lakes and roads draw over the
 * shading rather than through a veil of it. Over imagery, which sits under the labels, and in a
 * style with no water layer, it goes under the labels.
 */
export function basemapReliefBeforeId(map: Pick<MaplibreMap, 'getStyle'>, imagery: boolean): string | undefined {
  const layers = map.getStyle().layers ?? []
  const water = imagery
    ? undefined
    : layers.find(
        (layer) =>
          'source-layer' in layer && (layer['source-layer'] === 'water' || layer['source-layer'] === 'waterway'),
      )
  return (water ?? layers.find((layer) => layer.type === 'symbol'))?.id
}

/**
 * Over imagery the relief must sit above it, under the labels, but the imagery layer is added
 * whenever Satellite is chosen, after the relief, and lands on top. `reliefLayerIds` are the map's
 * relief layers, lowest first. Each style change puts the
 * relief back directly under the labels, in its own order, when anything has moved it.
 */
export function keepReliefOverImagery(
  map: {
    getStyle: MaplibreMap['getStyle']
    moveLayer: (id: string, beforeId?: string) => unknown
  },
  reliefLayerIds: readonly string[],
) {
  const layers = map.getStyle().layers ?? []
  const labels = layers.findIndex((layer) => layer.type === 'symbol')
  if (labels < 0) return
  const present = reliefLayerIds.filter((id) => layers.some((layer) => layer.id === id))
  if (!present.length) return
  const placed = layers.slice(labels - present.length, labels).map((layer) => layer.id)
  if (placed.every((id, i) => id === present[i])) return
  for (const id of present) map.moveLayer(id, layers[labels].id)
}

/**
 * Where to move a relief layer when its place has changed, or null when it already sits under
 * `beforeId`. Only a layer above its place moves, so the two relief layers sharing one place keep
 * their own order and never move each other back and forth.
 */
export function reliefMoveBefore(
  layers: ReadonlyArray<{ id: string }>,
  layerId: string,
  beforeId: string | undefined,
): string | null {
  if (!beforeId) return null
  const at = layers.findIndex((layer) => layer.id === layerId)
  const before = layers.findIndex((layer) => layer.id === beforeId)
  return at >= 0 && before >= 0 && at > before ? beforeId : null
}
