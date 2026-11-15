import { useSyncExternalStore } from 'react'
import { EMPTY_PREFERENCES, parseCostPreferences, type CostPreferences } from './costPreferences'

/**
 * The person's cost preferences in this browser. Every reader shares one store, so the cost dialog
 * and the references dialog see an edit at once. Storage can be missing or refuse (a private
 * window): the preferences then live for the session only and the page still works.
 */
const KEY = 'pgmaps.roadCost.preferences.v1'
const listeners = new Set<() => void>()
let current: CostPreferences | null = null

function load(): CostPreferences {
  if (current) return current
  try {
    const raw = window.localStorage.getItem(KEY)
    current = raw ? parseCostPreferences(JSON.parse(raw)) : EMPTY_PREFERENCES
  } catch {
    current = EMPTY_PREFERENCES
  }
  return current
}

export function setCostPreferences(next: CostPreferences) {
  current = next
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Kept for this session only.
  }
  for (const listener of listeners) listener()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useCostPreferences(): [CostPreferences, (next: CostPreferences) => void] {
  const preferences = useSyncExternalStore(subscribe, load, () => EMPTY_PREFERENCES)
  return [preferences, setCostPreferences]
}
