/**
 * The one road-colouring value for the whole page (`roadColouring.ts`): the plan's map settings,
 * the cost dialog's **Colour road by this** and Save & export's Map PDF options all read and write
 * it, so the plan and the printed map never disagree. Kept in this browser, never in the project.
 */
import { useSyncExternalStore } from 'react'
import {
  DEFAULT_ROAD_COLOURING,
  isRoadColourMode,
  parseRoadColouring,
  type RoadColourMode,
  type RoadColouring,
} from './roadColouring'

const STORAGE_KEY = 'pgmaps-road-colouring'
/** Before the settings: the mode alone, and before that a grade checkbox. Read once, never written. */
const LEGACY_MODE_KEY = 'pgmaps-road-colour-by'
const LEGACY_GRADE_KEY = 'pgmaps-road-grade-colours'

function read(): RoadColouring {
  try {
    const text = localStorage.getItem(STORAGE_KEY)
    if (text) return parseRoadColouring(JSON.parse(text))
    const mode = localStorage.getItem(LEGACY_MODE_KEY)
    if (isRoadColourMode(mode)) return { ...DEFAULT_ROAD_COLOURING, mode }
    return localStorage.getItem(LEGACY_GRADE_KEY) === 'on'
      ? { ...DEFAULT_ROAD_COLOURING, mode: 'grade' }
      : DEFAULT_ROAD_COLOURING
  } catch {
    return DEFAULT_ROAD_COLOURING
  }
}

let current: RoadColouring | null = null
const listeners = new Set<() => void>()
const snapshot = () => (current ??= read())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Replace the settings, or change them from the current ones. */
export function setRoadColouring(next: RoadColouring | ((previous: RoadColouring) => RoadColouring)) {
  const previous = snapshot()
  const value = typeof next === 'function' ? next(previous) : next
  if (value === previous) return
  current = value
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* The settings still hold for this session. */
  }
  for (const listener of listeners) listener()
}

export function setRoadColourMode(mode: RoadColourMode) {
  setRoadColouring((previous) => (previous.mode === mode ? previous : { ...previous, mode }))
}

/** The page's road colouring and its setter. */
export function useRoadColouring(): [RoadColouring, typeof setRoadColouring] {
  return [useSyncExternalStore(subscribe, snapshot, () => DEFAULT_ROAD_COLOURING), setRoadColouring]
}

/** Only what the active road is coloured by. */
export function useRoadColourMode(): [RoadColourMode, (mode: RoadColourMode) => void] {
  return [useRoadColouring()[0].mode, setRoadColourMode]
}
