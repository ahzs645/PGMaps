import bbox from '@turf/bbox'
import { useEffect } from 'react'
import { useMap } from '@/components/ui/map'
import type { InteractFeature } from './types'

export function DismissSelectionOnMapClick({
  enabled,
  shouldSkip,
  onMapTap,
  onFeatureTap,
  onDismiss,
}: {
  enabled: boolean
  shouldSkip: () => boolean
  onMapTap?: (point: [number, number]) => boolean
  onFeatureTap?: (featureIds: string[]) => boolean
  onDismiss: () => void
}) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded || !enabled) return
    let dismissTimeout: number | null = null
    const featureIdsAtPoint = (point: { x: number; y: number }) => {
      const hitRadius = 28
      const features = map.queryRenderedFeatures([
        [point.x - hitRadius, point.y - hitRadius],
        [point.x + hitRadius, point.y + hitRadius],
      ] as never)
      const ids = features.flatMap((feature) => {
        const layerId = feature.layer?.id ?? ''
        const isFeatureLayer =
          layerId.startsWith('fill-layer-') ||
          layerId.startsWith('fill-line-') ||
          layerId.startsWith('fill-sel-') ||
          layerId.startsWith('line-layer-') ||
          layerId.startsWith('line-sel-')
        const id = feature.properties?.id
        return isFeatureLayer && id != null ? [String(id)] : []
      })
      return [...new Set(ids)]
    }
    const isFeatureTap = (point: { x: number; y: number }) => {
      const ids = featureIdsAtPoint(point)
      if (ids.length > 0 && onFeatureTap?.(ids)) return true
      return ids.length > 0
    }
    const dismiss = (point?: { x: number; y: number }) => {
      if (point && isFeatureTap(point)) return
      if (shouldSkip()) return
      onDismiss()
    }
    const handleClick = (event: {
      lngLat?: { lng: number; lat: number }
      point?: { x: number; y: number }
      originalEvent?: { clientX?: number; clientY?: number; defaultPrevented?: boolean }
    }) => {
      if (event.originalEvent?.defaultPrevented) return
      if (event.lngLat && onMapTap?.([event.lngLat.lng, event.lngLat.lat])) return
      const point =
        event.point ??
        (() => {
          const { clientX, clientY } = event.originalEvent ?? {}
          if (clientX == null || clientY == null) return undefined
          const rect = map.getCanvas().getBoundingClientRect()
          return { x: clientX - rect.left, y: clientY - rect.top }
        })()
      if (!point) return
      dismissTimeout = window.setTimeout(() => {
        dismiss(point)
        dismissTimeout = null
      }, 0)
    }
    map.on('click', handleClick)
    return () => {
      if (dismissTimeout != null) {
        window.clearTimeout(dismissTimeout)
      }
      map.off('click', handleClick)
    }
  }, [enabled, isLoaded, map, onDismiss, onFeatureTap, onMapTap, shouldSkip])

  return null
}

export function ZoomToFeature({ feature, nonce }: { feature: InteractFeature; nonce: number }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded) return
    const bounds = bbox(feature) as [number, number, number, number]
    map.fitBounds(bounds, {
      padding: { top: 96, right: 48, bottom: 220, left: 48 },
      duration: 650,
      maxZoom: 14.5,
    })
  }, [feature, isLoaded, map, nonce])

  return null
}

export function CollapseInspectorOnMapDrag({ enabled, onCollapse }: { enabled: boolean; onCollapse: () => void }) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded || !enabled) return
    const handleDragStart = () => {
      onCollapse()
    }
    map.on('dragstart', handleDragStart)
    map.on('rotatestart', handleDragStart)
    map.on('pitchstart', handleDragStart)
    return () => {
      map.off('dragstart', handleDragStart)
      map.off('rotatestart', handleDragStart)
      map.off('pitchstart', handleDragStart)
    }
  }, [enabled, isLoaded, map, onCollapse])

  return null
}
