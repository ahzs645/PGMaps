import { useCallback, useEffect, useRef, useState } from 'react'
import { demoMission } from './demo'
import { readMissionJson, readMissionLink, STORAGE_KEY } from './missionCodec'
import type { Mission } from './model'

export function useMission() {
  const [initial] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return { mission: saved ? readMissionJson(saved) : demoMission(), error: '' }
    } catch {
      return {
        mission: demoMission(),
        error: 'The saved workspace could not be read. The example mission is open; you can import a mission file.',
      }
    }
  })
  const [snapshot, setSnapshot] = useState<{ mission: Mission; past: Mission[]; future: Mission[] }>({
    mission: initial.mission,
    past: [],
    future: [],
  })
  const mission = snapshot.mission
  const [error, setError] = useState(initial.error)
  const [status, setStatus] = useState('Saved on this device')
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
