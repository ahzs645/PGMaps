import { useEffect, useMemo, useRef, useState } from 'react'
import {
  createLingerState,
  dropLingering,
  foldLingerState,
  setLingerPhase,
  toLingerList,
  type LingerEntry,
} from '../lingering'
import type { RestaurantWithStats } from '../types'

/**
 * How long a dropped marker stays fully painted before it starts to fade. Needs to
 * comfortably outlast one timeline step so a scrub that filters a restaurant out
 * for a single month and back the next never shows a gap at all.
 */
export const MARKER_HOLD_MS = 450

/** Fade-out duration once a marker has stayed gone past the hold window. */
export const MARKER_FADE_MS = 300

const markerKey = (restaurant: RestaurantWithStats) => restaurant.details_url

/**
 * Renders the union of the previous and current restaurant sets: everything in the
 * current set plus anything that just left, held at full opacity for
 * `MARKER_HOLD_MS` and then faded over `MARKER_FADE_MS`. A restaurant that comes
 * back inside the hold window never changes appearance, so scrubbing the timeline
 * reads as markers changing rather than blinking out and back.
 */
export function useLingeringMarkers(
  restaurants: RestaurantWithStats[],
): LingerEntry<RestaurantWithStats>[] {
  const [state, setState] = useState(() => createLingerState(restaurants))
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>[]>())

  // Folded during render rather than in an effect on purpose: held markers have to
  // be in the very first paint after the set changes, or there is still a frame
  // with a hole in it — which is the thing being fixed.
  if (state.source !== restaurants) {
    setState((prev) => foldLingerState(prev, restaurants, markerKey))
  }

  useEffect(() => {
    const timers = timersRef.current

    // A marker that came back cancels its pending fade.
    timers.forEach((handles, key) => {
      if (state.held.has(key)) return
      handles.forEach(clearTimeout)
      timers.delete(key)
    })

    state.held.forEach((entry, key) => {
      if (entry.phase !== 'held' || timers.has(key)) return
      timers.set(key, [
        setTimeout(() => setState((prev) => setLingerPhase(prev, key, 'leaving')), MARKER_HOLD_MS),
        setTimeout(() => {
          setState((prev) => dropLingering(prev, key))
          timers.delete(key)
        }, MARKER_HOLD_MS + MARKER_FADE_MS),
      ])
    })
  }, [state])

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((handles) => handles.forEach(clearTimeout))
      timers.clear()
    }
  }, [])

  return useMemo(() => toLingerList(state, markerKey), [state])
}
