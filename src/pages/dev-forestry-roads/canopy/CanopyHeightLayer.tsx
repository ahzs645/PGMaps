import { useEffect } from 'react'
import { useMap } from '@/components/ui/map'
import { MapRasterLayer } from '@/components/ui/map-layers'
import { CHM_TILE_MAX_ZOOM, CHM_TILE_SIZE } from '@/lib/forestry/canopy/chmTiles'
import { CHM_MIN_ZOOM } from '@/lib/forestry/canopy/chmView'
import { SENTINEL_ANCHOR_LAYER_ID } from '../sentinel/planOrder'
import { usePlanImageryOrder } from '../usePlanImageryOrder'
import { CHM_TILE_URL, chmTileStatus, registerChmTiles } from './chmTileProtocol'

export const CANOPY_LAYER_ID = 'road-canopy-height'
/** Part-transparent, so the ground and imagery under it still read. */
export const CANOPY_LAYER_OPACITY = 0.6
/**
 * How long a tile takes to fade in over the coarser one it replaces, ms. Short: classes are drawn
 * nearest, and a long blend shows two class colours mixed; zero pops each tile in.
 */
export const CANOPY_FADE_MS = 150

/**
 * Meta CHM v2 on the plan, in the block sheet's canopy classes, over the imagery and under the road:
 * MapLibre raster tiles read straight from the COGs (`chmTileProtocol.ts`), so it loads as the map
 * moves and keeps coarser tiles drawn while finer ones arrive.
 */
export function CanopyHeightLayer({ credit }: { credit: string }) {
  const { map, isLoaded } = useMap()
  const ready = !!map && isLoaded
  registerChmTiles()
  usePlanImageryOrder(map, ready, CANOPY_LAYER_ID, 'overlay')
  useEffect(() => chmTileStatus.reset, [])
  // The source serves zoom 12 tiles from map zoom 11.5 (MapLibre rounds raster zooms); the layer's own
  // range hides them below 12 itself, where the card says the layer is paused.
  useEffect(() => {
    if (!map || !ready) return
    const range = () => {
      const layer = map.getLayer(CANOPY_LAYER_ID)
      if (layer && layer.minzoom !== CHM_MIN_ZOOM) map.setLayerZoomRange(CANOPY_LAYER_ID, CHM_MIN_ZOOM, 24)
    }
    range()
    map.on('styledata', range)
    return () => {
      map.off('styledata', range)
    }
  }, [map, ready])
  if (!ready) return null
  return (
    <MapRasterLayer
      id={CANOPY_LAYER_ID}
      tiles={[CHM_TILE_URL]}
      tileSize={CHM_TILE_SIZE}
      minZoom={CHM_MIN_ZOOM}
      maxZoom={CHM_TILE_MAX_ZOOM}
      opacity={CANOPY_LAYER_OPACITY}
      resampling="nearest"
      fadeDuration={CANOPY_FADE_MS}
      attribution={credit}
      beforeId={map.getLayer(SENTINEL_ANCHOR_LAYER_ID) ? SENTINEL_ANCHOR_LAYER_ID : undefined}
    />
  )
}
