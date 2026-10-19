import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeCrop, TreeIsolation } from './treeIsolation'
import { isolateTreeReturns } from './useTreeIsolation'
import { emptyInspection, readInspection, type InspectionState } from './treeInspection'

type EditState = Pick<InspectionState, 'reviews' | 'assignments'>
export function useTreeInspection(data: TreeIsolation | null, crop: TreeCrop | null, base: string, cloudUrl: string) {
  const [state, setState] = useState<InspectionState>(() => emptyInspection())
  const [loadedKey, setLoadedKey] = useState('')
  const [message, setMessage] = useState('')
  const [past, setPast] = useState<EditState[]>([]),
    [future, setFuture] = useState<EditState[]>([])
  const key = data ? `pgmaps-tree-inspection-${data.source_sha256}-${data.label_grid_sha256}` : ''
  const cache = useRef(new Map<string, TreeCrop>())
  const [cacheVersion, setCacheVersion] = useState(0)
  useEffect(() => {
    if (!data || !key) return
    try {
      const saved = localStorage.getItem(key)
      setState(saved ? readInspection(saved, data) : emptyInspection(data))
      setMessage('Review and comparison IDs save in this browser.')
    } catch (e) {
      setState(emptyInspection(data))
      setMessage(`Saved review unavailable: ${String(e)}. Import a backup or export new changes.`)
    }
    setPast([])
    setFuture([])
    setLoadedKey(key)
    cache.current.clear()
    setCacheVersion((n) => n + 1)
  }, [key, data])
  useEffect(() => {
    if (!key || loadedKey !== key) return
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      setMessage('Browser storage unavailable or full. Export the review manifest before leaving.')
    }
  }, [state, key, loadedKey])
  useEffect(() => {
    if (!crop || crop.source_sha256 !== state.source_sha256) return
    cache.current.set(crop.id, crop)
    for (const id of cache.current.keys()) if (id !== crop.id && !state.pins.includes(id)) cache.current.delete(id)
    setCacheVersion((n) => n + 1)
  }, [crop, state.pins, state.source_sha256])
  useEffect(() => {
    if (!data || loadedKey !== key || !state.pins.length) return
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 120000)
    ;(async () => {
      let count = 0
      for (const id of state.pins) {
        let next = cache.current.get(id)
        if (!next) {
          const crown = data.crowns.features.find((f) => f.properties.id === id)
          if (!crown) continue
          setMessage(`Restoring comparison ${id}…`)
          next = await isolateTreeReturns(data, crown, base, cloudUrl, abort.signal, () => {})
        }
        if (!active) return
        if (count + next.points.length > 150000) {
          setMessage('Comparison return budget reached. Remove a pin to restore another.')
          return
        }
        count += next.points.length
        cache.current.set(id, next)
        setCacheVersion((n) => n + 1)
      }
      if (active) setMessage('Review and comparison IDs saved. Source points fetched only when needed.')
    })()
      .catch((e) => {
        if (active) setMessage(`Comparison restore failed: ${String(e)}. Remove/re-pin to retry.`)
      })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      abort.abort()
      clearTimeout(timer)
    }
  }, [data, key, loadedKey, state.pins, base, cloudUrl])
  const pinned = useMemo(
    () => state.pins.map((id) => cache.current.get(id)).filter((c): c is TreeCrop => !!c),
    [state.pins, cacheVersion],
  )
  const commit = (next: InspectionState) => {
    if (JSON.stringify(next).length > 3000000) {
      setMessage(
        'Review manifest reached its 3 MB limit. Export a backup before reducing old notes or edits. The last change was not saved.',
      )
      return false
    }
    setPast((p) => [...p, { reviews: state.reviews, assignments: state.assignments }].slice(-20))
    setFuture([])
    setState(next)
    return true
  }
  const undo = () => {
    const last = past.at(-1)
    if (!last) return
    setFuture((f) => [{ reviews: state.reviews, assignments: state.assignments }, ...f])
    setPast((p) => p.slice(0, -1))
    setState((s) => ({ ...s, ...last }))
  }
  const redo = () => {
    const next = future[0]
    if (!next) return
    setPast((p) => [...p, { reviews: state.reviews, assignments: state.assignments }].slice(-20))
    setFuture((f) => f.slice(1))
    setState((s) => ({ ...s, ...next }))
  }
  const importReview = (text: string) => {
    if (!data) throw Error('Crown source is not loaded')
    const next = readInspection(text, data)
    commit(next)
    setMessage('Source-checked review imported.')
  }
  return {
    state,
    setState,
    commit,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    pinned,
    message,
    setMessage,
    importReview,
    ready: !!key && loadedKey === key,
  }
}
export type TreeInspectionController = ReturnType<typeof useTreeInspection>
