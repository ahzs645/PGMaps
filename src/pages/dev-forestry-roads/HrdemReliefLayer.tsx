import { useMap } from '@/components/ui/map'
import { MapRasterLayer } from '@/components/ui/map-layers'
import { HRDEM_RELIEF_CREDIT, HRDEM_RELIEF_TILES, HRDEM_RELIEF_MIN_ZOOM, HRDEM_RELIEF_MAX_ZOOM } from './hrdem'

/** NRCan's display service draws the mosaic at map scale; no elevation arrays are downloaded. */
export function HrdemReliefLayer({ visible }: { visible: boolean }) {
  const { map, isLoaded } = useMap()
  if (!visible || !map || !isLoaded) return null
  const beforeId = map.getLayer('road-terrain')
    ? 'road-terrain'
    : map.getStyle().layers?.find((l) => l.type === 'symbol')?.id
  return (
    <MapRasterLayer
      id="road-hrdem-relief"
      tiles={HRDEM_RELIEF_TILES}
      tileSize={512}
      minZoom={HRDEM_RELIEF_MIN_ZOOM}
      maxZoom={HRDEM_RELIEF_MAX_ZOOM}
      bounds={[-139.1, 48, -114, 60.1]}
      opacity={0.65}
      attribution={HRDEM_RELIEF_CREDIT}
      beforeId={beforeId}
    />
  )
}
