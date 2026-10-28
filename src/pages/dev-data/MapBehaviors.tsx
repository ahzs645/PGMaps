import { useEffect } from 'react'
import type * as MapLibreGL from 'maplibre-gl'
import { useMap } from '@/components/ui/map'
import type { ViewportBounds } from './layerData'

/** Reports the map viewport so the table's "Visible" mode and "In view" insights can filter. */
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
    return () => {
      map.off('moveend', report)
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

/** Fits the map to a layer's extent ("Zoom to layer"). */
export function FitToBounds({ bounds, nonce }: { bounds: ViewportBounds | null; nonce: number }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded || !bounds) return
    const [west, south, east, north] = bounds
    map.fitBounds(
      [
        [west, south],
        [east, north],
      ],
      { padding: 48, maxZoom: 16, duration: 700 },
    )
  }, [bounds, isLoaded, map, nonce])

  return null
}

/**
 * Records where the pointer went down, so a feature's popup can point at the
 * spot that was clicked. Feature click handlers only receive the feature id.
 */
export function PointerTracker({ onPointer }: { onPointer: (lngLat: [number, number]) => void }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded) return
    const record = (event: MapLibreGL.MapMouseEvent | MapLibreGL.MapTouchEvent) =>
      onPointer([event.lngLat.lng, event.lngLat.lat])
    map.on('mousedown', record)
    map.on('touchstart', record)
    return () => {
      map.off('mousedown', record)
      map.off('touchstart', record)
    }
  }, [isLoaded, map, onPointer])

  return null
}

/** Hands the MapLibre instance to the page once it has loaded, for camera mirroring. */
export function MapInstance({ onReady }: { onReady: (map: MapLibreGL.Map | null) => void }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded) return
    onReady(map)
    return () => onReady(null)
  }, [isLoaded, map, onReady])

  return null
}

/** Keeps a passive map on the same camera as `source` (the right side of a swipe). */
export function MirrorCamera({ source }: { source: MapLibreGL.Map | null }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded || !source) return
    const mirror = () =>
      map.jumpTo({
        center: source.getCenter(),
        zoom: source.getZoom(),
        bearing: source.getBearing(),
        pitch: source.getPitch(),
        roll: 0,
      })
    mirror()
    source.on('move', mirror)
    source.on('resize', mirror)
    return () => {
      source.off('move', mirror)
      source.off('resize', mirror)
    }
  }, [isLoaded, map, source])

  return null
}
