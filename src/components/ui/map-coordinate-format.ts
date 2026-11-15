import { useSyncExternalStore } from 'react'

import { isCoordinateFormat, type CoordinateFormat } from '@/lib/geo/coordinateFormat'

/**
 * The coordinate format every map's status bar and right-click menu print, remembered in this
 * browser. Clicking the status bar's coordinate moves it to the next format on all maps at once.
 */

const STORAGE_KEY = 'pgmaps.coordinateFormat'
const listeners = new Set<() => void>()
let current: CoordinateFormat = readStored()

function readStored(): CoordinateFormat {
  try {
    const value = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return isCoordinateFormat(value) ? value : 'dd'
  } catch {
    return 'dd'
  }
}

export function setMapCoordinateFormat(format: CoordinateFormat) {
  if (format === current) return
  current = format
  try {
    localStorage.setItem(STORAGE_KEY, format)
  } catch {
    // Storage unavailable: the choice lasts for this page.
  }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useMapCoordinateFormat(): CoordinateFormat {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => 'dd' as const,
  )
}
