import { useEffect } from 'react'
import { useMap } from './map'

export interface FlyToTarget {
  longitude: number
  latitude: number
}

export interface UseFlyToSelectionOptions {
  /** Zoom to settle at. Omit to keep the current zoom. */
  zoom?: number
  /** Animation length in ms. Defaults to 800. */
  duration?: number
  /**
   * Change to re-fly to the same target — for "show me this again" affordances
   * where the selection itself has not changed.
   */
  focusKey?: unknown
}

/**
 * Recentre the map whenever a selected feature changes. Pass null to leave the
 * camera alone.
 *
 * Only covers the fly-to-a-point case. Selections that frame an extent
 * (parks, trails) call fitBounds with their own padding and maxZoom, which
 * varies enough per section that sharing it would just move the arguments.
 */
export function useFlyToSelection(
  target: FlyToTarget | null | undefined,
  { zoom, duration = 800, focusKey }: UseFlyToSelectionOptions = {},
): void {
  const { map } = useMap()
  const longitude = target?.longitude
  const latitude = target?.latitude

  useEffect(() => {
    if (!map || longitude == null || latitude == null) return
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return
    map.flyTo({
      center: [longitude, latitude],
      ...(zoom === undefined ? {} : { zoom }),
      duration,
    })
  }, [map, longitude, latitude, zoom, duration, focusKey])
}
