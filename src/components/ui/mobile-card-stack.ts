import { useCallback, useEffect, useSyncExternalStore } from 'react'

/**
 * Ordered stack of the mobile map cards that are currently open.
 *
 * Cards mount from unrelated places — the feature card inside each map section,
 * the data table inside MapFeatureTablePanel — so this is a module-level store
 * rather than a context, matching the window-event style the cards already use
 * and avoiding a provider every map page would have to opt into.
 *
 * The array runs back-to-front, so the last entry is the front-most card. A card
 * that opens goes straight to the front; tapping a peeking card promotes it.
 */
export interface MobileCardStackEntry {
  id: string
  /** Height the card currently occupies, so cards behind can match and peek above it. */
  visibleHeight: number
}

/**
 * How far each card behind the front one pokes out above it, in px.
 *
 * Deliberately smaller than the card's 8px top padding so only the rounded corner
 * shows — a larger value exposes the card's own drag pill and you end up looking
 * at two stacked handles instead of one.
 */
export const MOBILE_CARD_STACK_PEEK = 5

let stack: MobileCardStackEntry[] = []
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return stack
}

/** Server render has no open cards. */
function getServerSnapshot(): MobileCardStackEntry[] {
  return []
}

function pushCard(id: string) {
  const existing = stack.find((entry) => entry.id === id)
  stack = [...stack.filter((entry) => entry.id !== id), existing ?? { id, visibleHeight: 0 }]
  emit()
}

function removeCard(id: string) {
  if (!stack.some((entry) => entry.id === id)) return
  stack = stack.filter((entry) => entry.id !== id)
  emit()
}

function setCardHeight(id: string, visibleHeight: number) {
  const index = stack.findIndex((entry) => entry.id === id)
  if (index === -1 || stack[index].visibleHeight === visibleHeight) return
  const next = [...stack]
  next[index] = { ...next[index], visibleHeight }
  stack = next
  emit()
}

export interface MobileCardStackState {
  /** 0 is front-most; higher numbers sit further back. */
  depth: number
  isFront: boolean
  /** True when at least one other card is open, so the front card sits flush. */
  hasCardsBehind: boolean
  /** Visible height of the front-most card, or null when this card is the front one. */
  frontVisibleHeight: number | null
  bringToFront: () => void
  reportVisibleHeight: (height: number) => void
}

/**
 * Registers a card in the stack for as long as `active` is true, and reports where
 * it sits. Unregisters on unmount so closing a card promotes whatever was behind.
 */
export function useMobileCardStack(id: string, active = true): MobileCardStackState {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)

  useEffect(() => {
    if (!active) return
    pushCard(id)
    return () => removeCard(id)
  }, [active, id])

  const index = entries.findIndex((entry) => entry.id === id)
  const depth = index === -1 ? 0 : entries.length - 1 - index
  const isFront = depth === 0
  const hasCardsBehind = index !== -1 && entries.length > 1
  const front = entries[entries.length - 1]
  const frontVisibleHeight = !isFront && front ? front.visibleHeight : null

  const bringToFrontCallback = useCallback(() => pushCard(id), [id])
  const reportVisibleHeight = useCallback((height: number) => setCardHeight(id, height), [id])

  return { depth, isFront, hasCardsBehind, frontVisibleHeight, bringToFront: bringToFrontCallback, reportVisibleHeight }
}

/** Test-only reset, so stack state cannot leak between cases. */
export function resetMobileCardStack() {
  stack = []
  emit()
}
