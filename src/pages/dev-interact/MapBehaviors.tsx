import bbox from '@turf/bbox'
import { useEffect } from 'react'
import { useMap } from '@/components/ui/map'
import { measurementCanClose } from './geo'
import type { InteractFeature, MeasurementMapAction, MeasurementMode } from './types'

export function MapClickCapture({
  measurementMode,
  measurementShape,
  measurementPoints,
  onMeasurementAction,
  onMeasurementCursor,
}: {
  measurementMode: MeasurementMode
  measurementShape: 'polygon' | 'circle'
  measurementPoints: [number, number][]
  onMeasurementAction: (action: MeasurementMapAction) => void
  onMeasurementCursor: (point: [number, number] | null) => void
}) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded || measurementMode !== 'drawing') return
    const previousCursor = map.getCanvas().style.cursor
    map.getCanvas().style.cursor = 'crosshair'
    const handleClick = (event: { lngLat: { lng: number; lat: number }; originalEvent: MouseEvent }) => {
      event.originalEvent.preventDefault()
      if (event.originalEvent.detail > 1) return
      if (measurementShape === 'circle') {
        onMeasurementAction({ type: 'add', point: [event.lngLat.lng, event.lngLat.lat] })
        return
      }
      if (measurementCanClose(measurementPoints)) {
        const firstPoint = measurementPoints[0]
        const firstScreenPoint = map.project(firstPoint)
        const clickScreenPoint = map.project([event.lngLat.lng, event.lngLat.lat])
        const distance = Math.hypot(firstScreenPoint.x - clickScreenPoint.x, firstScreenPoint.y - clickScreenPoint.y)
        if (distance <= 18) {
          onMeasurementAction({ type: 'close' })
          return
        }
      }

      onMeasurementAction({ type: 'add', point: [event.lngLat.lng, event.lngLat.lat] })
    }
    const handleDoubleClick = (event: { originalEvent: MouseEvent }) => {
      if (!measurementCanClose(measurementPoints)) return
      event.originalEvent.preventDefault()
      onMeasurementAction({ type: 'close' })
    }
    const handleMouseMove = (event: { lngLat: { lng: number; lat: number } }) => {
      onMeasurementCursor([event.lngLat.lng, event.lngLat.lat])
      if (measurementShape === 'circle' || !measurementCanClose(measurementPoints)) {
        map.getCanvas().style.cursor = 'crosshair'
        return
      }

      const firstPoint = measurementPoints[0]
      const firstScreenPoint = map.project(firstPoint)
      const cursorScreenPoint = map.project([event.lngLat.lng, event.lngLat.lat])
      const distance = Math.hypot(firstScreenPoint.x - cursorScreenPoint.x, firstScreenPoint.y - cursorScreenPoint.y)
      map.getCanvas().style.cursor = distance <= 18 ? 'pointer' : 'crosshair'
    }
    const handleMouseLeave = () => {
      onMeasurementCursor(null)
    }
    map.on('click', handleClick as never)
    map.on('dblclick', handleDoubleClick as never)
    map.on('mousemove', handleMouseMove as never)
    map.on('mouseout', handleMouseLeave)
    map.doubleClickZoom.disable()
    return () => {
      map.off('click', handleClick as never)
      map.off('dblclick', handleDoubleClick as never)
      map.off('mousemove', handleMouseMove as never)
      map.off('mouseout', handleMouseLeave)
      map.doubleClickZoom.enable()
      map.getCanvas().style.cursor = previousCursor
      onMeasurementCursor(null)
    }
  }, [isLoaded, map, measurementMode, measurementPoints, measurementShape, onMeasurementAction, onMeasurementCursor])

  return null
}

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
        const isFeatureLayer = (
          layerId.startsWith('fill-layer-')
          || layerId.startsWith('fill-line-')
          || layerId.startsWith('fill-sel-')
          || layerId.startsWith('line-layer-')
          || layerId.startsWith('line-sel-')
        )
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
      const point = event.point ?? (() => {
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

export function CollapseInspectorOnMapDrag({
  enabled,
  onCollapse,
}: {
  enabled: boolean
  onCollapse: () => void
}) {
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
