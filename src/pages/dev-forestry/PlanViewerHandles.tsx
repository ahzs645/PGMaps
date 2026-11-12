import type MapLibreGL from 'maplibre-gl'
import { useEffect, useRef } from 'react'

import { MapMarker, MarkerContent, useMap } from '@/components/ui/map'

import { bearingBetween, pointAlongBearing } from './driveMath'

/** How far out the turn handle sits: the plan's view cone is 2 km long, and the handle is its tip. */
const LOOK_HANDLE_METERS = 2000
/** A drag along the road seeks at most this often, so the road view is not re-seeked every pointer move. */
const MOVE_THROTTLE_MS = 120

/**
 * The road view's viewer on the plan, made draggable: drag the eye along the
 * road to move the road view there, drag the tip of the view cone to turn it.
 * Every other click on the plan keeps its own job (selecting a polygon,
 * seeking by clicking the road line).
 *
 * The eye snaps to the road on release, because the view is always taken from
 * the road; the page decides where on the road a point lands.
 */
export function PlanViewerHandles({
  eye,
  bearing,
  onMove,
  onLook,
}: {
  /** The viewing station (the pose's ground position), not the eye map's centre. */
  eye: { lng: number; lat: number }
  bearing: number
  /** A point on the plan to move the viewer to; the page snaps it to the road. */
  onMove: ((point: { lng: number; lat: number }) => void) | null
  /** A compass bearing to face. */
  onLook: (bearing: number) => void
}) {
  const lastMove = useRef(0)
  const tip = pointAlongBearing(eye, bearing, LOOK_HANDLE_METERS)
  return (
    <>
      {onMove && (
        <MapMarker
          longitude={eye.lng}
          latitude={eye.lat}
          draggable
          onDrag={(point) => {
            const now = performance.now()
            if (now - lastMove.current < MOVE_THROTTLE_MS) return
            lastMove.current = now
            onMove(point)
          }}
          onDragEnd={(point) => onMove(point)}
        >
          <MarkerContent>
            <span
              role="img"
              aria-label="Road view position: drag along the road to move"
              title="Drag along the road to move the road view"
              data-testid="plan-viewer-move"
              className="block h-4 w-4 cursor-grab rounded-full border-2 border-white bg-rose-600 shadow active:cursor-grabbing"
            />
          </MarkerContent>
        </MapMarker>
      )}
      <MapMarker
        longitude={tip.lng}
        latitude={tip.lat}
        draggable
        onDragEnd={(point) => onLook(bearingBetween(eye, point))}
      >
        <MarkerContent>
          <span
            role="img"
            aria-label="Road view direction: drag to turn"
            title="Drag to turn the road view"
            data-testid="plan-viewer-look"
            className="block h-3.5 w-3.5 cursor-grab rounded-full border-2 border-rose-600 bg-white shadow active:cursor-grabbing"
          />
        </MarkerContent>
      </MapMarker>
    </>
  )
}

/**
 * While the road view is open, a plain click on the plan moves it there: the
 * page snaps the point to the road. A click on an inventory viewpoint or rec
 * site is left to that point's own handler (standing there), and nothing
 * happens while a drawing tool or a point pick owns the map's clicks.
 */
export function PlanClickToMove({ onMove }: { onMove: ((point: { lng: number; lat: number }) => void) | null }) {
  const { map, isLoaded } = useMap()
  const onMoveRef = useRef(onMove)
  useEffect(() => {
    onMoveRef.current = onMove
  })
  const enabled = !!onMove
  useEffect(() => {
    if (!map || !isLoaded || !enabled) return
    const click = (event: MapLibreGL.MapMouseEvent) => {
      const onPoint = onMoveRef.current
      if (!onPoint) return
      const hitViewpoint = map
        .queryRenderedFeatures(event.point)
        .some((feature) => feature.properties?.kind === 'vli' || feature.properties?.kind === 'rec-site')
      if (hitViewpoint) return
      onPoint({ lng: event.lngLat.lng, lat: event.lngLat.lat })
    }
    map.on('click', click)
    return () => {
      map.off('click', click)
    }
  }, [map, isLoaded, enabled])
  return null
}
