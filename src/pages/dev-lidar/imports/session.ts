import { useSyncExternalStore } from 'react'
import { checkSession } from './files'
import { emptySession, type ImportSession } from './types'
let current = emptySession()
const listeners = new Set<() => void>()
export function setImportSession(next: ImportSession) {
  checkSession(next)
  current = next
  listeners.forEach((fn) => fn())
}
export const getImportSession = () => current
export const resetImportSession = () => setImportSession(emptySession())
export function useImportSession() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    getImportSession,
    getImportSession,
  )
}
