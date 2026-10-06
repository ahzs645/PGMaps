import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { parseScene, storeScene, type ForestryScene } from './scene'
import { loadCurrentScene, saveCurrentScene } from './toolsStorage'

/** Large local rasters use IndexedDB; localStorage remains a migration/fallback. */
export function usePersistentScene(initial: () => ForestryScene) {
  const [scene, setState] = useState(initial),
    [ready, setReady] = useState(false),
    [warning, setWarning] = useState<string | null>(null)
  const changed = useRef(false),
    queue = useRef(Promise.resolve())
  const setScene = useCallback((action: SetStateAction<ForestryScene>) => {
    changed.current = true
    setState(action)
  }, [])
  useEffect(() => {
    let active = true
    loadCurrentScene()
      .then((saved) => {
        if (active && saved && !changed.current) {
          const parsed = parseScene(saved)
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
    storeScene(scene)
    queue.current = queue.current
      .catch(() => {})
      .then(() => saveCurrentScene(scene))
      .catch((e) =>
        setWarning(`Scene storage failed: ${String(e)}. Export the scene or workspace to preserve your changes.`),
      )
  }, [ready, scene])
  return { scene, setScene, warning }
}
