import { useEffect } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { imageryBeforeId } from './sentinel/planOrder'

/** Keeps the imagery above the plan's hillshade and imported backgrounds and under every engineering layer. */
export function usePlanImageryOrder(map: MapLibreMap | null, active: boolean, id: string) {
  useEffect(() => {
    if (!map || !active) return
    const place = () => {
      const layers = map.getStyle()?.layers
      const before = layers && imageryBeforeId(layers, id)
      if (before) map.moveLayer(id, before)
    }
    place()
    map.on('styledata', place)
    return () => {
      map.off('styledata', place)
    }
  }, [map, active, id])
}
