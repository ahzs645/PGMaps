import { useSyncExternalStore } from 'react'

const active = new Set<symbol>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
const snapshot = () => active.size > 0

/** All application maps share the resize phase, including nested pane boundaries. */
export function setPaneResizing(token: symbol, resizing: boolean) {
  const before = snapshot()
  if (resizing) active.add(token)
  else active.delete(token)
  if (before !== snapshot()) for (const listener of listeners) listener()
}

export const usePaneResizing = () => useSyncExternalStore(subscribe, snapshot, () => false)
