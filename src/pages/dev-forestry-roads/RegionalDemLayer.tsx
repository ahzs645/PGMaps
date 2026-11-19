import { useEffect } from 'react'
import { MapTerrain, type MapTerrainProps } from '@/components/ui/map-layers'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from '@/lib/forestry/terrain/terrain'

/** Context relief streams only the visible tiles, at no finer than the regional analysis source. */
const DEM: MapTerrainProps['dem'] = {
  tiles: [TERRARIUM_TILE_URL],
  encoding: 'terrarium',
  maxZoom: 12,
  attribution: TERRAIN_ATTRIBUTION,
}

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

/** The plan's relief layers, lowest first. */
export const RELIEF_LAYER_IDS = ['road-regional-hillshade', 'road-hrdem-relief'] as const

/**
 * Over imagery the relief must sit above it, under the labels, but the imagery layer is added
 * whenever Satellite is chosen, after the relief, and lands on top. Each style change puts the
 * relief back directly under the labels, in its own order, when anything has moved it.
 */
export function keepReliefOverImagery(map: {
  getStyle: MaplibreMap['getStyle']
  moveLayer: (id: string, beforeId?: string) => unknown
}) {
  const layers = map.getStyle().layers ?? []
  const labels = layers.findIndex((layer) => layer.type === 'symbol')
  if (labels < 0) return
  const present = RELIEF_LAYER_IDS.filter((id) => layers.some((layer) => layer.id === id))
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

/**
 * Keeps a relief layer under its place as the style changes around it, by moving it. The toolkit's
 * layers already move, rather than add themselves again, when their `beforeId` changes (adding
 * again drops every loaded tile and blanks the relief until they return); this also catches a
 * layer added later that lands under the relief's place.
 */
export function useReliefPlace(
  map: Pick<MaplibreMap, 'getStyle' | 'moveLayer' | 'on' | 'off'> | null,
  layerId: string,
  beforeId: string | undefined,
) {
  useEffect(() => {
    if (!map || !beforeId) return
    const place = () => {
      const before = reliefMoveBefore(map.getStyle()?.layers ?? [], layerId, beforeId)
      if (before) map.moveLayer(layerId, before)
    }
    place()
    map.on('styledata', place)
    return () => {
      map.off('styledata', place)
    }
  }, [map, layerId, beforeId])
}

/**
 * The regional hillshade. `MapTerrain` moves it when `beforeId` changes; `useReliefPlace` puts it
 * back whenever something else in the style has moved it since.
 */
function RegionalRelief({ beforeId, imagery }: { beforeId: string | undefined; imagery: boolean }) {
  const { map } = useMap()
  useReliefPlace(map, RELIEF_LAYER_IDS[0], beforeId)
  return (
    <MapTerrain id="road-regional" dem={DEM} reliefOnly beforeId={beforeId} hillshadeIntensity={imagery ? 0.2 : 0.35} />
  )
}

export function RegionalDemLayer({ visible, imagery }: { visible: boolean; imagery: boolean }) {
  const { map, isLoaded } = useMap()
  useEffect(() => {
    if (!map || !isLoaded || !imagery) return
    const keep = () => keepReliefOverImagery(map)
    keep()
    map.on('styledata', keep)
    return () => {
      map.off('styledata', keep)
    }
  }, [map, isLoaded, imagery])
  if (!visible || !map || !isLoaded) return null
  return <RegionalRelief beforeId={basemapReliefBeforeId(map, imagery)} imagery={imagery} />
}
