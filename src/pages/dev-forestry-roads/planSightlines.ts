/**
 * The sightlines the plan draws, handed from the Sight distance section to the plan. The section
 * computes them only while it is open, so it publishes them here and clears them when it closes;
 * the plan reads them without the page threading a prop through the sidebar.
 */
import { useSyncExternalStore } from 'react'

let current: GeoJSON.FeatureCollection | null = null
const listeners = new Set<() => void>()

export function setPlanSightlines(next: GeoJSON.FeatureCollection | null) {
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = () => current

/** The sightlines to draw on the plan, or null when the Sight distance section is closed or hides them. */
export function usePlanSightlines() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
