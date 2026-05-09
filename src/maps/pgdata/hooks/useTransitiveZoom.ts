import { useEffect, useState } from 'react'
import { useMap } from '@/components/ui/map'
import {
  DEFAULT_TRANSITIVE_ZOOM_FACTORS,
  selectZoomFactor,
  type TransitiveZoomFactor,
} from '../lib/transitiveBundling'

// Mirrors the scale-change loop in transitive.js (lib/display/display.js
// `scaleChanged` / `updateActiveZoomFactors`): only re-emit when the zoom
// crosses into a different ZoomFactor partition, so consumers can rebuild
// the bundled GeoJSON without thrashing on every wheel tick.
export function useTransitiveZoom(
  factors: TransitiveZoomFactor[] = DEFAULT_TRANSITIVE_ZOOM_FACTORS,
): { zoom: number; factor: TransitiveZoomFactor } {
  const { map, isLoaded } = useMap()
  const initialZoom = map?.getZoom() ?? 11
  const [zoom, setZoom] = useState<number>(initialZoom)
  const [factor, setFactor] = useState<TransitiveZoomFactor>(() =>
    selectZoomFactor(initialZoom, factors),
  )

  useEffect(() => {
    if (!map || !isLoaded) return

    const sync = () => {
      const next = map.getZoom()
      setZoom(next)
      setFactor((current) => {
        const candidate = selectZoomFactor(next, factors)
        return candidate.minZoom === current.minZoom ? current : candidate
      })
    }

    sync()
    map.on('zoom', sync)
    return () => {
      map.off('zoom', sync)
    }
  }, [map, isLoaded, factors])

  return { zoom, factor }
}
