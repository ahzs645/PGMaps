import { useEffect } from 'react'
import { useMap } from '@/components/ui/map'
import type { ViewportBounds } from './useDataLayers'

/** Reports the map viewport so the table's "Visible" mode can filter rows. */
export function ViewportTracker({ onChange }: { onChange: (bounds: ViewportBounds) => void }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded) return

    const report = () => {
      const bounds = map.getBounds()
      onChange([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()])
    }

    report()
    map.on('moveend', report)
    map.on('zoomend', report)
    return () => {
      map.off('moveend', report)
      map.off('zoomend', report)
    }
  }, [isLoaded, map, onChange])

  return null
}

/** Eases the map to a row's centre when it is picked in the table. */
export function FlyToCenter({ center, nonce }: { center: [number, number] | null; nonce: number }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded || !center) return
    map.easeTo({ center, zoom: Math.max(map.getZoom(), 13.5), duration: 600 })
    // `nonce` re-runs the ease when the same row is picked twice.
  }, [center, isLoaded, map, nonce])

  return null
}
