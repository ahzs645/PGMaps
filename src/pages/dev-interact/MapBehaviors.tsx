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
  onDismiss,
}: {
  enabled: boolean
  shouldSkip: () => boolean
  onDismiss: () => void
}) {
  const { map, isLoaded } = useMap()

  useEffect(() => {
    if (!map || !isLoaded || !enabled) return
    const canvas = map.getCanvas()
    let pointerStart: { x: number; y: number; id: number } | null = null
    const isFeatureTap = (point: { x: number; y: number }) => {
      const features = map.queryRenderedFeatures(point as never)
      return features.some((feature) => {
        const layerId = feature.layer?.id ?? ''
        return (layerId.startsWith('fill-layer-') || layerId.startsWith('line-layer-')) && feature.properties?.id != null
      })
    }
    const dismiss = (point?: { x: number; y: number }) => {
      if (point && isFeatureTap(point)) return
      if (shouldSkip()) return
      onDismiss()
    }
    const handleClick = (event: { point?: { x: number; y: number } }) => {
      dismiss(event.point)
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }
    }
    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerStart || pointerStart.id !== event.pointerId) return
      const distance = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y)
      pointerStart = null
      if (distance > 8) return
      const rect = canvas.getBoundingClientRect()
      dismiss({ x: event.clientX - rect.left, y: event.clientY - rect.top })
    }
    const handlePointerCancel = () => {
      pointerStart = null
    }
    canvas.addEventListener('pointerdown', handlePointerDown, { capture: true })
    canvas.addEventListener('pointerup', handlePointerUp, { capture: true })
    canvas.addEventListener('pointercancel', handlePointerCancel, { capture: true })
    map.on('click', handleClick)
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      canvas.removeEventListener('pointerup', handlePointerUp, { capture: true })
      canvas.removeEventListener('pointercancel', handlePointerCancel, { capture: true })
      map.off('click', handleClick)
    }
  }, [enabled, isLoaded, map, onDismiss, shouldSkip])

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
