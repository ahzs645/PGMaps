import { useEffect } from 'react'
import { useMap } from '@/components/ui/map'
import { MapRasterLayer } from '@/components/ui/map-layers'
import { basemapReliefBeforeId } from './RegionalDemLayer'
import { HRDEM_RELIEF_CREDIT, HRDEM_RELIEF_TILES, HRDEM_RELIEF_MIN_ZOOM, HRDEM_RELIEF_MAX_ZOOM } from './hrdem'

const LAYER_ID = 'road-hrdem-relief'
/**
 * NRCan draws flat ground mid-grey (about 176 of 255) and covers BC in project-sized patches, so
 * drawn as sent each patch shows as a grey box. Contrast then a raised floor bring flat ground to
 * about the basemap's tone and keep the shadows, as the plan draws loaded terrain (`reliefShade`).
 */
const PAINT = {
  light: { opacity: 0.55, contrast: 0.6, min: 0.35, max: 1 },
  dark: { opacity: 0.55, contrast: 0.6, min: 0, max: 0.2 },
  imagery: { opacity: 0.35, contrast: 0.6, min: 0.35, max: 1 },
} as const
/** NRCan's small-scale rendering is far stronger than its large-scale one, so it fades out below z12. */
const FULL_OPACITY_ZOOM = 12
const LOWEST_OPACITY_SHARE = 0.5

/** NRCan's display service draws the mosaic at map scale; no elevation arrays are downloaded. */
export function HrdemReliefLayer({ visible, dark, imagery }: { visible: boolean; dark: boolean; imagery: boolean }) {
  const { map, isLoaded } = useMap()
  const paint = PAINT[imagery ? 'imagery' : dark ? 'dark' : 'light']
  const shown = visible && !!map && isLoaded
  // MapRasterLayer adds the layer in its own effects and adds it again after a reload, so the look
  // is applied whenever the style changes. Setting an unchanged value is a no-op in MapLibre.
  useEffect(() => {
    if (!shown || !map) return
    const apply = () => {
      if (!map.getLayer(LAYER_ID)) return
      map.setPaintProperty(LAYER_ID, 'raster-opacity', [
        'interpolate',
        ['linear'],
        ['zoom'],
        HRDEM_RELIEF_MIN_ZOOM,
        paint.opacity * LOWEST_OPACITY_SHARE,
        FULL_OPACITY_ZOOM,
        paint.opacity,
      ])
      map.setPaintProperty(LAYER_ID, 'raster-contrast', paint.contrast)
      map.setPaintProperty(LAYER_ID, 'raster-brightness-min', paint.min)
      map.setPaintProperty(LAYER_ID, 'raster-brightness-max', paint.max)
    }
    apply()
    map.on('styledata', apply)
    return () => {
      map.off('styledata', apply)
    }
  }, [shown, map, paint])
  if (!shown) return null
  // Under the basemap's water and roads, and so under any loaded terrain too. The layer is placed
  // only when added, so a new place is a new layer.
  const beforeId = basemapReliefBeforeId(map, imagery)
  return (
    <MapRasterLayer
      key={beforeId}
      id={LAYER_ID}
      tiles={HRDEM_RELIEF_TILES}
      tileSize={512}
      minZoom={HRDEM_RELIEF_MIN_ZOOM}
      maxZoom={HRDEM_RELIEF_MAX_ZOOM}
      bounds={[-139.1, 48, -114, 60.1]}
      opacity={paint.opacity}
      attribution={HRDEM_RELIEF_CREDIT}
      beforeId={beforeId}
    />
  )
}
