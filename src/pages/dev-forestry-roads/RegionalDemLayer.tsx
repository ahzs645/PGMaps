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
  const beforeId = basemapReliefBeforeId(map, imagery)
  return (
    // Keyed by place: a new place is a new layer, since the layer is placed only when added.
    <MapTerrain
      key={beforeId}
      id="road-regional"
      dem={DEM}
      reliefOnly
      beforeId={beforeId}
      hillshadeIntensity={imagery ? 0.2 : 0.35}
    />
  )
}
