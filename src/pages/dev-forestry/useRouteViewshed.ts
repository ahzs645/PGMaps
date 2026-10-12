import { useMemo, useState } from 'react'
import { combinedViewshedBounds, destination, useViewshed } from '@/features/terrain-viewshed'
import { roadPath, roadPlacement } from './driveMath'
import { roadViewshedSelection } from './roadViewshed'

export type RoadViewshedMode = 'point' | 'stretch' | 'travel'

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
  const [mode, setMode] = useState<RoadViewshedMode>('point')
  const [selection, setSelection] = useState<[number, number]>([0, 1])
  const path = useMemo(() => roadPath(coordinates), [coordinates])
  const length = path.at(-1)?.distanceAlongMeters ?? 0
  const selected = useMemo(
    () => roadViewshedSelection(path, selection[0] * length, selection[1] * length),
    [path, selection, length],
  )
  const travelKey = JSON.stringify([coordinates, selection, radius, eyeHeight])
  const reached = selected.stations.reduce(
    (last, point, index) => (point.distanceAlongMeters <= positionMeters + 1e-6 ? index : last),
    0,
  )
  const [travel, setTravel] = useState({ key: '', furthest: 0, lastPosition: 0 })
  // Update only at sampling boundaries. Remember the furthest station when scrubbing backwards.
  if (enabled && mode === 'travel' && (travel.key !== travelKey || travel.lastPosition !== reached)) {
    setTravel({
      key: travelKey,
      lastPosition: reached,
      furthest: travel.key === travelKey ? Math.max(travel.furthest, reached) : reached,
    })
  }
  const furthest =
    selected.stations[travel.key === travelKey ? travel.furthest : 0]?.distanceAlongMeters ?? selected.from
  const observers = useMemo(
    () =>
      mode === 'point'
        ? undefined
        : selected.stations
            .filter((point, i) => mode === 'stretch' || i === 0 || point.distanceAlongMeters <= furthest)
            .map(({ lng, lat }) => ({ lng, lat })),
    [mode, selected.stations, furthest],
  )
  const distance = moving ? Math.round(positionMeters / 25) * 25 : positionMeters
  const point = useMemo(() => roadPlacement(path, distance), [path, distance])
  const observer = useMemo(() => (point ? { lng: point.lng, lat: point.lat } : { lng: 0, lat: 0 }), [point])
  const settings = useMemo(
    () => ({
      observer:
        mode === 'point' ? observer : { lng: selected.stations[0]?.lng ?? 0, lat: selected.stations[0]?.lat ?? 0 },
      radiusMeters: radius,
      heightA: eyeHeight,
      heightB: eyeHeight,
    }),
    [mode, observer, selected.stations, radius, eyeHeight],
  )
  const bounds = useMemo(() => {
    if (mode === 'point' || !selected.stations.length) return undefined
    try {
      return combinedViewshedBounds(settings, selected.stations)
    } catch {
      return undefined
    } // Let the worker report unsupported locations through the usual status panel.
  }, [mode, settings, selected.stations])
  const analysis = useViewshed(settings, retry, moving && mode === 'point', {
    enabled: enabled && path.length >= 2 && length >= 1,
    horizon: false,
    detailSize: 128,
    demZoom: 14,
    observers,
    bounds,
  })
  return {
    enabled,
    setEnabled,
    radius,
    setRadius,
    mode,
    setMode,
    selection,
    setSelection,
    selected,
    sampleCount: observers?.length ?? 1,
    furthest,
    resetTravel: () => setTravel({ key: travelKey, furthest: 0, lastPosition: reached }),
    selectedRoad: useMemo<GeoJSON.FeatureCollection>(
      () => ({
        type: 'FeatureCollection',
        features:
          selected.coordinates.length >= 2
            ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: selected.coordinates } }]
            : [],
      }),
      [selected.coordinates],
    ),
    currentRadius: useMemo<GeoJSON.FeatureCollection>(
      () => ({
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: Array.from({ length: 65 }, (_, i) => {
                const point = destination(observer, ((i % 64) * 360) / 64, radius)
                return [point.lng, point.lat]
              }),
            },
          },
        ],
      }),
      [observer, radius],
    ),
    observer,
    length,
    valid: path.length >= 2 && length >= 1,
    analysis,
    retry: () => setRetry((value) => value + 1),
  }
}
export type RouteViewshed = ReturnType<typeof useRouteViewshed>
