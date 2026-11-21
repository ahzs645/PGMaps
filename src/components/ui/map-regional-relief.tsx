import { useEffect } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { MapTerrain, type MapTerrainProps } from '@/components/ui/map-layers'
import { TERRAIN_ATTRIBUTION, TERRARIUM_TILE_URL } from '@/lib/forestry/terrain/terrain'
import { basemapReliefBeforeId, keepReliefOverImagery, reliefMoveBefore } from '@/lib/mapReliefPlace'

/** Context relief streams only the visible tiles, at no finer than the regional analysis source. */
export const REGIONAL_RELIEF_MAX_ZOOM = 12

const DEM: MapTerrainProps['dem'] = {
  tiles: [TERRARIUM_TILE_URL],
  encoding: 'terrarium',
  maxZoom: REGIONAL_RELIEF_MAX_ZOOM,
  attribution: TERRAIN_ATTRIBUTION,
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

/** How strong the shading is on the plain basemap and over imagery, where it only has to hint at the slope. */
export type ReliefIntensity = { plain: number; imagery: number }

function Relief({ id, beforeId, intensity }: { id: string; beforeId: string | undefined; intensity: number }) {
  const { map } = useMap()
  useReliefPlace(map, `${id}-hillshade`, beforeId)
  return <MapTerrain id={id} dem={DEM} reliefOnly beforeId={beforeId} hillshadeIntensity={intensity} />
}

/**
 * Regional hill shading from the open Terrarium tiles, in the basemap's own place for relief: under
 * its water on the plain map, over imagery and under the labels when Satellite is on
 * (`src/lib/mapReliefPlace.ts`). `MapTerrain` moves it when its place changes; `useReliefPlace`
 * puts it back whenever something else in the style has moved it since. Its layer is `${id}-hillshade`.
 */
export function RegionalReliefLayer({
  id,
  visible,
  imagery,
  intensity,
  reliefLayerIds,
}: {
  id: string
  visible: boolean
  /** Satellite imagery is on, so the relief goes over it. */
  imagery: boolean
  intensity: ReliefIntensity
  /** Every relief layer on the map, lowest first, kept over imagery together; defaults to this one. */
  reliefLayerIds?: readonly string[]
}) {
  const { map, isLoaded } = useMap()
  const layerId = `${id}-hillshade`
  const ids = reliefLayerIds ?? [layerId]
  const idsKey = ids.join('\n')
  useEffect(() => {
    if (!map || !isLoaded || !imagery) return
    const reliefIds = idsKey.split('\n')
    const keep = () => keepReliefOverImagery(map, reliefIds)
    keep()
    map.on('styledata', keep)
    return () => {
      map.off('styledata', keep)
    }
  }, [map, isLoaded, imagery, idsKey])
  if (!visible || !map || !isLoaded) return null
  return (
    <Relief
      id={id}
      beforeId={basemapReliefBeforeId(map, imagery)}
      intensity={imagery ? intensity.imagery : intensity.plain}
    />
  )
}
