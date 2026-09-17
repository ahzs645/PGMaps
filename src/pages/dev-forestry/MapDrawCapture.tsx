import type MapLibreGL from 'maplibre-gl'
import { useEffect, useRef } from 'react'

import { useMap } from '@/components/ui/map'

type MapDrawCaptureProps = {
  active: boolean
  onPoint: (position: [number, number]) => void
  /** Called on a double click, to close a road or polygon in one gesture. */
  onFinish?: () => void
}

/**
 * Turns map clicks into drawing input while a draw mode is active.
 *
 * Double-click zoom is suspended for the duration so finishing a shape does not
 * also jump the camera, and the handler holds its callbacks in refs so a
 * re-render between clicks cannot detach the listener mid-draw.
 */
export function MapDrawCapture({ active, onPoint, onFinish }: MapDrawCaptureProps) {
  const { map, isLoaded } = useMap()
  const activeRef = useRef(active)
  const onPointRef = useRef(onPoint)
  const onFinishRef = useRef(onFinish)

  useEffect(() => {
    onPointRef.current = onPoint
    onFinishRef.current = onFinish
  })

  useEffect(() => {
    activeRef.current = active
    if (!map) return
    map.getCanvas().style.cursor = active ? 'crosshair' : ''
    if (active) map.doubleClickZoom.disable()
    else map.doubleClickZoom.enable()
  }, [active, map])

  useEffect(() => {
    if (!isLoaded || !map) return
    let pendingClick: ReturnType<typeof setTimeout> | null = null

    const handleClick = (event: MapLibreGL.MapMouseEvent) => {
      if (!activeRef.current) return
      const position: [number, number] = [event.lngLat.lng, event.lngLat.lat]

      // A double click fires two clicks first. Shapes that can be finished that
      // way hold each click briefly so the closing gesture does not also drop
      // two stray vertices; a single-point mode places immediately.
      if (!onFinishRef.current) {
        onPointRef.current(position)
        return
      }
      if (pendingClick) clearTimeout(pendingClick)
      pendingClick = setTimeout(() => {
        pendingClick = null
        onPointRef.current(position)
      }, 250)
    }

    const handleDoubleClick = (event: MapLibreGL.MapMouseEvent) => {
      if (!activeRef.current) return
      event.preventDefault()
      if (pendingClick) {
        clearTimeout(pendingClick)
        pendingClick = null
      }
      onFinishRef.current?.()
    }

    map.on('click', handleClick)
    map.on('dblclick', handleDoubleClick)
    return () => {
      if (pendingClick) clearTimeout(pendingClick)
      map.off('click', handleClick)
      map.off('dblclick', handleDoubleClick)
      map.getCanvas().style.cursor = ''
      map.doubleClickZoom.enable()
    }
  }, [isLoaded, map])

  return null
}
