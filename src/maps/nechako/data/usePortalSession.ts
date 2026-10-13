import { useEffect, useState } from 'react'
import { getPortalConnectionStatus, getPortalConnectionMode, PORTAL_CONNECTION_EVENT } from '@/lib/nechakoPortal'
export function usePortalSession(onSessionChange?: () => void) {
  const [state, setState] = useState({ canWrite: false, isAdmin: false, revision: 0 })
  useEffect(() => {
    let request: AbortController | undefined
    let generation = 0
    const refresh = (event?: Event) => {
      if (event) {
        // Drop private panels and write capabilities before waiting for the
        // gateway: a slow status request must not retain the previous identity.
        setState((current) => ({ canWrite: false, isAdmin: false, revision: current.revision + 1 }))
        onSessionChange?.()
      }
      request?.abort()
      const currentGeneration = ++generation
      const detail = (event as CustomEvent<{ reason?: string; sourceReason?: string }> | undefined)?.detail
      // A transition's status may still describe the previous upstream identity.
      if (detail?.reason === 'session-changing' || detail?.sourceReason === 'session-changing') return
      const controller = new AbortController()
      request = controller
      void getPortalConnectionStatus(controller.signal)
        .then((status) => {
          if (!controller.signal.aborted && currentGeneration === generation)
            setState((current) => ({
              canWrite: getPortalConnectionMode() === 'gateway' && !!status.canWrite,
              isAdmin: !!status.isAdmin,
              // First discovery has no previous identity/cache to discard.
              // Remounting here can erase a query or submission ID already typed.
              revision: current.revision + (event ? 1 : 0),
            }))
        })
        .catch(() => {
          if (!controller.signal.aborted && currentGeneration === generation)
            setState((current) => ({
              ...current,
              canWrite: false,
              isAdmin: false,
              revision: current.revision + (event ? 1 : 0),
            }))
        })
    }
    refresh()
    window.addEventListener(PORTAL_CONNECTION_EVENT, refresh)
    return () => {
      generation += 1
      request?.abort()
      window.removeEventListener(PORTAL_CONNECTION_EVENT, refresh)
    }
  }, [onSessionChange])
  return state
}
