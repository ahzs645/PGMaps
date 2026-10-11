import { useMemo, useState } from 'react'
import { useViewshed } from '@/features/terrain-viewshed'
import { roadPath, roadPlacement } from './driveMath'

/** Use the actual drawn/snapped centreline, never the pitched map's centre. */
export function useRouteViewshed(
  coordinates: [number, number][],
  positionMeters: number,
  moving: boolean,
  eyeHeight: number,
) {
  const [enabled, setEnabled] = useState(false)
  const [radius, setRadius] = useState(1000)
  const [retry, setRetry] = useState(0)
  const path = useMemo(() => roadPath(coordinates), [coordinates])
  const length = path.at(-1)?.distanceAlongMeters ?? 0
  const distance = moving ? Math.round(positionMeters / 25) * 25 : positionMeters
  const point = useMemo(() => roadPlacement(path, distance), [path, distance])
  const observer = useMemo(() => (point ? { lng: point.lng, lat: point.lat } : { lng: 0, lat: 0 }), [point])
  const settings = useMemo(
    () => ({ observer, radiusMeters: radius, heightA: eyeHeight, heightB: eyeHeight }),
    [observer, radius, eyeHeight],
  )
  const analysis = useViewshed(settings, retry, moving, {
    enabled: enabled && path.length >= 2 && length >= 1,
    horizon: false,
    detailSize: 128,
    demZoom: 14,
  })
  return {
    enabled,
    setEnabled,
    radius,
    setRadius,
    observer,
    length,
    valid: path.length >= 2 && length >= 1,
    analysis,
    retry: () => setRetry((value) => value + 1),
  }
}
export type RouteViewshed = ReturnType<typeof useRouteViewshed>
