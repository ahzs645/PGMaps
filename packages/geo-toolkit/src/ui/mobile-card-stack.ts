import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { createMobileCardStack } from '../workspace/mobile-card-store.js'
import { useWorkspace } from '../workspace/workspace-context.js'
export type { MobileCardStackEntry } from '../workspace/mobile-card-store.js'
export const MOBILE_CARD_STACK_PEEK = 5
export interface MobileCardStackState {
  depth: number
  isFront: boolean
  hasCardsBehind: boolean
  frontVisibleHeight: number | null
  bringToFront: () => void
  reportVisibleHeight: (height: number) => void
}
export function useMobileCardStack(id: string, active = true): MobileCardStackState {
  const workspace = useWorkspace()
  const [fallback] = useState(createMobileCardStack)
  const store = workspace?.cards ?? fallback
  const entries = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot)
  useEffect(() => {
    if (!active) return
    store.push(id)
    return () => store.remove(id)
  }, [active, id, store])
  const index = entries.findIndex((entry) => entry.id === id)
  const depth = index < 0 ? 0 : entries.length - 1 - index
  const isFront = depth === 0
  const front = entries[entries.length - 1]
  const bringToFront = useCallback(() => store.push(id), [id, store])
  const reportVisibleHeight = useCallback((height: number) => store.setHeight(id, height), [id, store])
  return {
    depth,
    isFront,
    hasCardsBehind: index >= 0 && entries.length > 1,
    frontVisibleHeight: !isFront && front ? front.visibleHeight : null,
    bringToFront,
    reportVisibleHeight,
  }
}
