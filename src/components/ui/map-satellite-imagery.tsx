import { useCallback, useEffect, useState } from 'react'

import { useMap } from '@/components/ui/map'
import { MapRasterLayer } from '@/components/ui/map-layers'

/** The imagery DevView, DevViewshed and the LiDAR basemaps already use. */
export const SATELLITE_TILES = [
  'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
]
export const SATELLITE_ATTRIBUTION = 'Imagery © Esri — Esri, Vantor, Earthstar Geographics, and the GIS User Community'

/** A basemap a page's Layers control offers: the vector map, or Esri imagery under its labels. */
export type ImageryBasemap = 'map' | 'satellite'

/**
 * The basemap choices for `MapLayersControl` (`basemaps`), shared so every page that offers
 * imagery names it the same. The page applies the choice by rendering `SatelliteImagery`.
 */
export const IMAGERY_BASEMAPS: ReadonlyArray<{ value: ImageryBasemap; label: string; description?: string }> = [
  { value: 'map', label: 'Map' },
  { value: 'satellite', label: 'Satellite', description: 'Esri World Imagery' },
]

/**
 * The basemap choice, kept in this browser under `storageKey` so the page opens on it again.
 * Storage that is unavailable leaves the choice for this session.
 */
export function useStoredImageryBasemap(storageKey: string): [ImageryBasemap, (value: ImageryBasemap) => void] {
  const [basemap, setBasemap] = useState<ImageryBasemap>(() => {
    try {
      return localStorage.getItem(storageKey) === 'satellite' ? 'satellite' : 'map'
    } catch {
      return 'map'
    }
  })
  const choose = useCallback(
    (value: ImageryBasemap) => {
      setBasemap(value)
      try {
        localStorage.setItem(storageKey, value)
      } catch {
        /* The choice still holds for this session. */
      }
    },
    [storageKey],
  )
  return [basemap, choose]
}

/**
 * Satellite imagery under everything the page draws, the way a planner's
 * Google Earth screenshot drapes the photo over the hills. Used by the
 * forestry visual-quality maps and the road-design plan.
 *
 * It goes in as a layer, not as a new `styles` object: a style swap calls
 * `setStyle`, which would drop the 3D timber layer the road view mounts. It
 * sits just below the basemap's first label layer, so labels stay readable and
 * every data layer added after the style (blocks, landforms, samples, roads)
 * stays on top whatever order they mounted in.
 */
export function SatelliteImagery({ visible }: { visible: boolean }) {
  const { map, isLoaded } = useMap()
  const [anchor, setAnchor] = useState<{ id: string | undefined; version: number } | null>(null)
  useEffect(() => {
    if (!map || !isLoaded) return
    let version = 0
    const find = () => {
      const layers = map.getStyle()?.layers ?? []
      version += 1
      setAnchor({ id: layers.find((layer) => layer.type === 'symbol')?.id, version })
    }
    find()
    map.on('style.load', find)
    return () => {
      map.off('style.load', find)
    }
  }, [map, isLoaded])
  if (!anchor || !visible) return null
  return (
    <MapRasterLayer
      key={anchor.version}
      tiles={SATELLITE_TILES}
      tileSize={256}
      // Rural BC has no Esri imagery at z19: the service answers with a grey
      // "Map data not yet available" tile, which the eye-level camera requests
      // right underfoot. z18 has real imagery (checked at Bear Lake), and
      // MapLibre stretches it beyond.
      maxZoom={18}
      attribution={SATELLITE_ATTRIBUTION}
      beforeId={anchor.id}
      addOnStyleLoad
    />
  )
}
