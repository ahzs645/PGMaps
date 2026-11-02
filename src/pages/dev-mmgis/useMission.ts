import { useCallback, useEffect, useRef, useState } from 'react'
import { demoMission } from './demo'
import { readMissionJson, readMissionLink, STORAGE_KEY, UNREADABLE_BACKUP_KEY } from './missionCodec'
import type { Mission } from './model'

type MissionStorage = Pick<Storage, 'getItem' | 'setItem'>
/**
 * Open the saved workspace. One this version cannot read is copied to a backup key and left in place: the example
 * opens, and `preserveStored` keeps autosave from overwriting the saved copy until the user changes something.
 */
export function loadStoredMission(storage: MissionStorage): {
  mission: Mission
  error: string
  preserveStored: boolean
} {
  let saved: string | null = null
  try {
    saved = storage.getItem(STORAGE_KEY)
  } catch {
    return { mission: demoMission(), error: '', preserveStored: false }
  }
  if (!saved) return { mission: demoMission(), error: '', preserveStored: false }
  try {
    return { mission: readMissionJson(saved), error: '', preserveStored: false }
  } catch (e) {
    let backedUp = false
    try {
      storage.setItem(UNREADABLE_BACKUP_KEY, saved)
      backedUp = true
    } catch {
      /* The saved copy is still kept in place until the user changes something. */
    }
    return {
      mission: demoMission(),
      preserveStored: true,
      error: `The saved workspace could not be read${e instanceof Error ? ` (${e.message})` : ''}. The example mission is open; your saved workspace is kept on this device until you make a change${
        backedUp ? `, and a copy stays in browser storage under “${UNREADABLE_BACKUP_KEY}”` : ''
      }. You can import a mission file.`,
    }
  }
}

export function useMission() {
  const [initial] = useState(() => {
    try {
      return loadStoredMission(localStorage)
    } catch {
      return { mission: demoMission(), error: '', preserveStored: false } // Storage access itself is blocked.
    }
  })
  /** Until the user edits, autosave must not replace a saved workspace that could not be read. */
  const preserveStored = useRef(initial.preserveStored)
  const [snapshot, setSnapshot] = useState<{ mission: Mission; past: Mission[]; future: Mission[] }>({
    mission: initial.mission,
    past: [],
    future: [],
  })
  const mission = snapshot.mission
  const [error, setError] = useState(initial.error)
  const [status, setStatus] = useState(
    initial.preserveStored
      ? 'Not saved · the unreadable saved workspace is kept until you edit'
      : 'Saved on this device',
  )
  const current = useRef(snapshot)
  const change = useCallback((update: Mission | ((m: Mission) => Mission), record = true) => {
    const previous = current.current.mission
    const next = typeof update === 'function' ? update(previous) : update
    if (previous === next) return
    if (next.layers.length > 100) {
      setError('A mission can contain up to 100 vector layers. Remove a layer before adding another.')
      return
    }
    const latest = current.current
    const value = {
      mission: next,
      past: record ? [...latest.past.slice(-19), previous] : latest.past,
      future: record ? [] : latest.future,
    }
    current.current = value
    preserveStored.current = false
    setSnapshot(value)
    setStatus('Saving on this device…')
  }, [])
  const undo = useCallback(() => {
    const h = current.current,
      previous = h.past.at(-1)
    if (!previous) return
    const value = { mission: previous, past: h.past.slice(0, -1), future: [h.mission, ...h.future] }
    current.current = value
    setSnapshot(value)
  }, [])
  const redo = useCallback(() => {
    const h = current.current,
      next = h.future[0]
    if (!next) return
    const value = { mission: next, past: [...h.past, h.mission], future: h.future.slice(1) }
    current.current = value
    setSnapshot(value)
  }, [])
  useEffect(() => {
    let live = true
    const load = () => {
      const hash = location.hash
      readMissionLink(hash)
        .then((shared) => {
          if (shared && live && hash === location.hash) change(shared)
        })
        .catch((e: unknown) => {
          if (live) setError(`Could not open the shared mission: ${e instanceof Error ? e.message : 'Invalid link'}`)
        })
    }
    load()
    window.addEventListener('hashchange', load)
    return () => {
      live = false
      window.removeEventListener('hashchange', load)
    }
  }, [change])
  useEffect(() => {
    const save = () => {
      if (preserveStored.current) return
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(current.current.mission))
      } catch {
        /* The visible save status reports storage failures. */
      }
    }
    window.addEventListener('pagehide', save)
    return () => window.removeEventListener('pagehide', save)
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (preserveStored.current) return
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(mission))
        setStatus('Saved on this device')
      } catch {
        setStatus('Device storage is full — export a mission file to keep your changes')
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [mission])
  return {
    mission,
    change,
    undo,
    redo,
    canUndo: snapshot.past.length > 0,
    canRedo: snapshot.future.length > 0,
    error,
    setError,
    status,
  }
}
