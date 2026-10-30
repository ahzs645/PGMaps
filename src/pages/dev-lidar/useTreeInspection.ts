import { useCallback, useEffect, useMemo, useSyncExternalStore, type SetStateAction } from 'react'
import type { TreeCrop, TreeIsolation } from './treeIsolation'
import { isolateTreeReturns } from './useTreeIsolation'
import { useKeyedState } from './useKeyedState'
import { emptyInspection, readInspection, type InspectionState } from './treeInspection'

type EditState = Pick<InspectionState, 'reviews' | 'assignments'>

/** Immutable snapshots let async point restoration publish without reading refs during render. */
function createCropCache() {
  let snapshot: ReadonlyMap<string, TreeCrop> = new Map()
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    update: (change: (next: Map<string, TreeCrop>) => void) => {
      const next = new Map(snapshot)
      change(next)
      snapshot = next
      for (const listener of listeners) listener()
    },
  }
}

export function useTreeInspection(data: TreeIsolation | null, crop: TreeCrop | null, base: string, cloudUrl: string) {
  const key = data ? `pgmaps-tree-inspection-${data.source_sha256}-${data.label_grid_sha256}` : ''
  const sourceKey = useMemo(() => [key, data], [key, data])
  const [session, setSession] = useKeyedState(sourceKey, () => {
    if (!data || !key) return { state: emptyInspection(), loadedKey: '', message: '' }
    try {
      const saved = localStorage.getItem(key)
      return {
        state: saved ? readInspection(saved, data) : emptyInspection(data),
        loadedKey: key,
        message: 'Review and comparison IDs save in this browser.',
      }
    } catch (error) {
      return {
        state: emptyInspection(data),
        loadedKey: key,
        message: `Saved review unavailable: ${String(error)}. Import a backup or export new changes.`,
      }
    }
  })
  const { state, loadedKey, message } = session
  const setState = useCallback(
    (action: SetStateAction<InspectionState>) => {
      setSession((current) => ({ ...current, state: typeof action === 'function' ? action(current.state) : action }))
    },
    [setSession],
  )
  const setMessage = useCallback((message: string) => setSession((current) => ({ ...current, message })), [setSession])
  const [past, setPast] = useKeyedState<EditState[]>(sourceKey, () => [])
  const [future, setFuture] = useKeyedState<EditState[]>(sourceKey, () => [])
  const [cache] = useKeyedState(sourceKey, createCropCache)
  const cachedCrops = useSyncExternalStore(cache.subscribe, cache.getSnapshot, cache.getSnapshot)
  useEffect(() => {
    if (!key || loadedKey !== key) return
    try {
      localStorage.setItem(key, JSON.stringify(state))
    } catch {
      // Browser storage can fail synchronously; report the failed external write immediately.
      setMessage('Browser storage unavailable or full. Export the review manifest before leaving.')
    }
  }, [state, key, loadedKey, setMessage])
  useEffect(() => {
    if (!crop || crop.source_sha256 !== state.source_sha256) return
    cache.update((next) => {
      next.set(crop.id, crop)
      for (const id of next.keys()) if (id !== crop.id && !state.pins.includes(id)) next.delete(id)
    })
  }, [crop, state.pins, state.source_sha256, cache])
  useEffect(() => {
    if (!data || loadedKey !== key || !state.pins.length) return
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 120000)
    ;(async () => {
      let count = 0
      for (const id of state.pins) {
        let next = cache.getSnapshot().get(id)
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
        const restored = next
        cache.update((current) => {
          current.set(id, restored)
        })
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
  }, [data, key, loadedKey, state.pins, base, cloudUrl, cache, setMessage])
  const pinned = useMemo(
    () => state.pins.map((id) => cachedCrops.get(id)).filter((c): c is TreeCrop => !!c),
    [state.pins, cachedCrops],
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
