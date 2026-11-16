/**
 * What this browser's user chose for the engines: kept in the browser's storage, never in a scene or a project,
 * because it is about this computer (its disk), not the assessment. The rules and the URL are in
 * `externalRenderers.ts`; this is only the stored value and a hook that follows it.
 */
import { useSyncExternalStore } from 'react'

import {
  DEFAULT_ENGINE_BROWSER_OPTIONS,
  parseEngineBrowserOptions,
  type EngineBrowserOptions,
} from './externalRenderers'

const STORAGE_KEY = 'pgmaps.forestryVisuals.engineOptions'

let current: EngineBrowserOptions | null = null
const listeners = new Set<() => void>()

function read(): EngineBrowserOptions {
  if (current) return current
  try {
    current = parseEngineBrowserOptions(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    // Storage blocked or unreadable: the defaults, for this page only.
    current = DEFAULT_ENGINE_BROWSER_OPTIONS
  }
  return current
}

export function setEngineBrowserOptions(patch: Partial<EngineBrowserOptions>) {
  current = { ...read(), ...patch }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Storage blocked: the choice still holds until the page is left.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  // Another tab of this browser changing it is the same choice.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return
    current = null
    listener()
  }
  listeners.add(listener)
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

/** This browser's engine choices, following any change made here or in another tab. */
export function useEngineBrowserOptions(): EngineBrowserOptions {
  return useSyncExternalStore(subscribe, read, () => DEFAULT_ENGINE_BROWSER_OPTIONS)
}
