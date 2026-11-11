import { useEffect, useState } from 'react'
import type { Map as MapLibreMap, MapSourceDataEvent } from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import { MapImageLayer } from '@/components/ui/map-layers'
import { SENTINEL_ANCHOR_LAYER_ID, SENTINEL_LAYER_ID, sentinelBeforeId } from './planOrder'
import type { SentinelImage } from './useSentinel2'

/** The picked pixels as an object URL, revoked a little after the image changes. */
function useImageUrl(image: SentinelImage | null) {
  const [url, setUrl] = useState<{ key: string; url: string } | null>(null)
  useEffect(() => {
    if (!image) return
    let cancelled = false,
      made: string | null = null
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    const context = canvas.getContext('2d')
    if (!context) return
    context.putImageData(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height), 0, 0)
    canvas.toBlob((blob) => {
      if (cancelled || !blob) return
      made = URL.createObjectURL(blob)
      setUrl({ key: image.key, url: made })
    }, 'image/png')
    return () => {
      cancelled = true
      // The map may still be drawing the previous URL; let it finish loading the next one first.
      if (made) setTimeout(() => URL.revokeObjectURL(made!), 5_000)
    }
  }, [image])
  // The previous picture stays up while the next one is encoded, so a new scene does not flash.
  return image ? url : null
}

/**
 * Puts the Copernicus credit in the map's attribution. An image source carries no attribution of its
 * own in MapLibre's style spec, but the attribution control reads `source.attribution` from every
 * source in use. The credit is set on the source while its image is still loading (the effect runs
 * right after the layer adds it, and again as each new image starts), so the load's metadata event
 * makes the control show it; removing the source takes it away.
 */
function useSourceCredit(map: MapLibreMap | null, sourceId: string, credit: string | null) {
  useEffect(() => {
    if (!map || !credit) return
    const apply = () => {
      const source = map.getSource(sourceId) as { attribution?: string } | undefined
      if (source && source.attribution !== credit) source.attribution = credit
    }
    const onLoading = (event: MapSourceDataEvent) => {
      if (event.sourceId === sourceId) apply()
    }
    apply()
    map.on('sourcedataloading', onLoading)
    return () => {
      map.off('sourcedataloading', onLoading)
    }
  }, [map, sourceId, credit])
}

/** Keeps the imagery above the plan's hillshade and imported backgrounds and under every engineering layer. */
function useImageryOrder(map: MapLibreMap | null, active: boolean) {
  useEffect(() => {
    if (!map || !active) return
    const place = () => {
      const layers = map.getStyle()?.layers
      const before = layers && sentinelBeforeId(layers)
      if (before) map.moveLayer(SENTINEL_LAYER_ID, before)
    }
    place()
    map.on('styledata', place)
    return () => {
      map.off('styledata', place)
    }
  }, [map, active])
}

/** The Sentinel-2 image on the plan: a georeferenced quad in its UTM window, under the engineering layers. */
export function Sentinel2Layer({ image, credit }: { image: SentinelImage | null; credit: string | null }) {
  const { map, isLoaded } = useMap()
  const url = useImageUrl(image)
  const ready = !!map && isLoaded && !!image && !!url
  useSourceCredit(ready ? map : null, SENTINEL_LAYER_ID, credit)
  useImageryOrder(ready ? map : null, ready)
  if (!ready) return null
  return (
    <MapImageLayer
      id={SENTINEL_LAYER_ID}
      url={url.url}
      coordinates={image.quad}
      opacity={1}
      resampling="nearest"
      beforeId={(m) => (m.getLayer(SENTINEL_ANCHOR_LAYER_ID) ? SENTINEL_ANCHOR_LAYER_ID : undefined)}
    />
  )
}
