import { useMap } from '@/components/ui/map'
import { MapImageLayer } from '@/components/ui/map-layers'
import { SENTINEL_ANCHOR_LAYER_ID } from '../sentinel/planOrder'
import { useImageUrl, useSourceCredit } from '../sentinel/Sentinel2Layer'
import { usePlanImageryOrder } from '../usePlanImageryOrder'
import type { CanopyImage } from './useCanopyHeight'

export const CANOPY_LAYER_ID = 'road-canopy-height'
/** Part-transparent, so the ground and imagery under it still read. */
export const CANOPY_LAYER_OPACITY = 0.6

/** Meta CHM v2 on the plan, in the block sheet's canopy classes, over the imagery and under the road. */
export function CanopyHeightLayer({ image, credit }: { image: CanopyImage | null; credit: string }) {
  const { map, isLoaded } = useMap()
  const url = useImageUrl(image)
  const ready = !!map && isLoaded && !!image && !!url
  useSourceCredit(ready ? map : null, CANOPY_LAYER_ID, credit)
  usePlanImageryOrder(map, ready, CANOPY_LAYER_ID, 'overlay')
  if (!ready) return null
  return (
    <MapImageLayer
      id={CANOPY_LAYER_ID}
      url={url.url}
      coordinates={image.quad}
      opacity={CANOPY_LAYER_OPACITY}
      resampling="nearest"
      beforeId={(m) => (m.getLayer(SENTINEL_ANCHOR_LAYER_ID) ? SENTINEL_ANCHOR_LAYER_ID : undefined)}
    />
  )
}
