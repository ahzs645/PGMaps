import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { loadStoredSceneRevision, parseScene, storeScene, type ForestryScene } from './scene'
import { loadCurrentScene, saveCurrentScene } from './toolsStorage'

/**
 * Large local rasters use IndexedDB; localStorage remains a migration/fallback. Each write carries a revision to both:
 * localStorage is written at once and IndexedDB's put commits later, so on load the IndexedDB copy is taken only when
 * it is at least as new as localStorage's, and a reload in between keeps the last edit.
 */
export function usePersistentScene(initial: () => ForestryScene) {
  const [scene, setState] = useState(initial),
    [ready, setReady] = useState(false),
    [warning, setWarning] = useState<string | null>(null)
  const changed = useRef(false),
    queue = useRef(Promise.resolve()),
    revision = useRef(0)
  const setScene = useCallback((action: SetStateAction<ForestryScene>) => {
    changed.current = true
    setState(action)
  }, [])
  useEffect(() => {
    let active = true
    const localRevision = loadStoredSceneRevision()
    revision.current = Math.max(revision.current, localRevision)
    loadCurrentScene()
      .then((saved) => {
        if (!active || !saved) return
        revision.current = Math.max(revision.current, saved.revision)
        if (!changed.current && saved.revision >= localRevision) {
          const parsed = parseScene(saved.scene)
          if (parsed) setState(parsed)
        }
      })
      .catch((e) => {
        if (active) setWarning(`Stored scene could not be loaded: ${String(e)}. Import your scene backup.`)
      })
      .finally(() => {
        if (active) setReady(true)
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    if (!ready) return
    const next = ++revision.current
    storeScene(scene, next)
    queue.current = queue.current
      .catch(() => {})
      .then(() => saveCurrentScene(scene, next))
      .catch((e) =>
        setWarning(`Scene storage failed: ${String(e)}. Export the scene or workspace to preserve your changes.`),
      )
  }, [ready, scene])
  return { scene, setScene, warning }
}
