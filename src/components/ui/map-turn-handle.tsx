import * as maplibregl from 'maplibre-gl'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { useMap } from '@/components/ui/map'
import { viewerArcPoint, viewerBearingTo } from '@/lib/geo/viewerCone'

/** On a map's container while one of its handles is dragged: `src/index.css` hides hover cards under it. */
export const MAP_HANDLE_DRAGGING_CLASS = 'map-handle-dragging'

/**
 * The handle that turns a viewer on a plan map: it sits `lengthMeters` out from `origin` along
 * `bearing`, on the far edge of the viewer's wedge (`MapViewerCone`, `viewerConeFeatures`), and a drag
 * carries it round that arc, never off it. The pointer only gives the direction: wherever it is, the
 * handle is the point of the arc on the line from the origin through it.
 *
 * `onTurning` is called with each bearing on the way round, so the caller can turn what it draws with
 * the handle, and with null when the handle is let go; `onTurn` is called once, with the bearing it
 * was let go at. Bearings are compass degrees, 0–360, not rounded.
 *
 * While it is dragged the map's container carries `MAP_HANDLE_DRAGGING_CLASS`, which hides the layers'
 * hover cards and holds the grabbing cursor: the pointer is off the handle and over other features.
 */
export function MapTurnHandle({
  origin,
  bearing,
  lengthMeters,
  onTurnStart,
  onTurning,
  onTurn,
  children,
}: {
  origin: { lng: number; lat: number }
  bearing: number
  lengthMeters: number
  onTurnStart?: () => void
  onTurning?: (bearing: number | null) => void
  onTurn: (bearing: number) => void
  /** What the handle looks like. */
  children: ReactNode
}) {
  const { map } = useMap()
  const latest = useRef({ origin, lengthMeters, onTurnStart, onTurning, onTurn })
  useEffect(() => {
    latest.current = { origin, lengthMeters, onTurnStart, onTurning, onTurn }
  })
  const dragging = useRef(false)
  // Counts drags that ended, so the handle goes back to where its props put it even when the caller
  // kept the bearing it had.
  const [settled, setSettled] = useState(0)

  const [marker] = useState(() =>
    new maplibregl.Marker({ element: document.createElement('div'), draggable: true }).setLngLat(
      viewerArcPoint(origin, bearing, lengthMeters),
    ),
  )

  useEffect(() => {
    const bearingNow = () => viewerBearingTo(latest.current.origin, marker.getLngLat())
    const quiet = () =>
      document
        .querySelectorAll(`.${MAP_HANDLE_DRAGGING_CLASS}`)
        .forEach((container) => container.classList.remove(MAP_HANDLE_DRAGGING_CLASS))
    const start = () => {
      dragging.current = true
      // The pointer crosses whatever lies under the arc: its hover cards stand aside until it lets go.
      marker.getElement().closest('.maplibregl-map')?.classList.add(MAP_HANDLE_DRAGGING_CLASS)
      latest.current.onTurnStart?.()
    }
    const turn = () => {
      const turned = bearingNow()
      // MapLibre places the marker from the pointer on every move, so putting it back on the arc
      // here holds only until the next one and never drifts.
      marker.setLngLat(viewerArcPoint(latest.current.origin, turned, latest.current.lengthMeters))
      latest.current.onTurning?.(turned)
    }
    const end = () => {
      dragging.current = false
      quiet()
      const turned = bearingNow()
      latest.current.onTurning?.(null)
      latest.current.onTurn(turned)
      setSettled((count) => count + 1)
    }
    marker.on('dragstart', start)
    marker.on('drag', turn)
    marker.on('dragend', end)
    return () => {
      if (dragging.current) quiet()
      marker.off('dragstart', start)
      marker.off('drag', turn)
      marker.off('dragend', end)
    }
  }, [marker])

  useEffect(() => {
    if (dragging.current) return
    marker.setLngLat(viewerArcPoint({ lng: origin.lng, lat: origin.lat }, bearing, lengthMeters))
  }, [marker, origin.lng, origin.lat, bearing, lengthMeters, settled])

  useEffect(() => {
    if (!map) return
    marker.addTo(map)
    return () => {
      dragging.current = false
      marker.remove()
    }
  }, [map, marker])

  return createPortal(children, marker.getElement())
}
