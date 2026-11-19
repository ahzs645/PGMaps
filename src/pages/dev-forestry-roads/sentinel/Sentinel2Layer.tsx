import { useEffect, useRef, useState } from 'react'
import { useMap } from '@/components/ui/map'
import { MapImageLayer } from '@/components/ui/map-layers'
import { SENTINEL_ANCHOR_LAYER_ID, SENTINEL_LAYER_ID } from './planOrder'
import { usePlanImageryOrder } from '../usePlanImageryOrder'
import type { SentinelImage } from './useSentinel2'

/** A picture ready to draw and the corners it belongs to: always handed to the map together. */
export type PreparedImage = { key: string; image: ImageBitmap; quad: SentinelImage['quad'] }

/** How long a replaced picture is kept, so the map can finish with it. */
const RELEASE_AFTER_MS = 5_000

/**
 * The picture as an `ImageBitmap` with its own corners, which the map uploads as it is: no PNG is
 * encoded, requested or decoded. While the next picture is prepared (off the page's thread) the
 * previous pair is returned unchanged, so the map keeps drawing it where it belongs and swaps only
 * when the new one exists. A newer picture supersedes one still being prepared. Null only while
 * there is no image.
 */
export function usePreparedImage(image: Pick<SentinelImage, 'key' | 'width' | 'height' | 'rgba' | 'quad'> | null) {
  const [prepared, setPrepared] = useState<PreparedImage | null>(null)
  const current = useRef<PreparedImage | null>(null)
  useEffect(() => {
    if (!image || current.current?.key === image.key) return
    let cancelled = false
    void createImageBitmap(new ImageData(new Uint8ClampedArray(image.rgba), image.width, image.height)).then(
      (bitmap) => {
        if (cancelled) return bitmap.close()
        const next = { key: image.key, image: bitmap, quad: image.quad }
        const replaced = current.current
        current.current = next
        setPrepared(next)
        if (replaced) setTimeout(() => replaced.image.close(), RELEASE_AFTER_MS)
      },
      // A picture the browser cannot hold leaves the previous one up.
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [image])
  useEffect(
    () => () => {
      const last = current.current
      if (last) setTimeout(() => last.image.close(), RELEASE_AFTER_MS)
    },
    [],
  )
  return image ? prepared : null
}

/**
 * The Sentinel-2 image on the plan: a georeferenced quad in its UTM window, under the engineering
 * layers, with the Copernicus credit in the map's attribution. A new window or scene swaps the
 * picture in place; the camera moving never removes it.
 */
export function Sentinel2Layer({ image, credit }: { image: SentinelImage | null; credit: string | null }) {
  const { map, isLoaded } = useMap()
  const prepared = usePreparedImage(image)
  const ready = !!map && isLoaded && !!prepared
  usePlanImageryOrder(map, ready, SENTINEL_LAYER_ID)
  if (!ready) return null
  return (
    <MapImageLayer
      id={SENTINEL_LAYER_ID}
      image={prepared.image}
      coordinates={prepared.quad}
      attribution={credit ?? undefined}
      opacity={1}
      resampling="nearest"
      beforeId={(m) => (m.getLayer(SENTINEL_ANCHOR_LAYER_ID) ? SENTINEL_ANCHOR_LAYER_ID : undefined)}
    />
  )
}
