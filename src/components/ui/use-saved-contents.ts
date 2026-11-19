/**
 * A contents list's saved presets, kept in this browser (`localStorage`, key
 * `pgmaps.documentContents.<listId>`) for a list that has no presets of its own. The rules are
 * `src/lib/documentContents/savedContents.ts`; this is only the store. Every read and write is
 * guarded: a store that cannot be read reads as empty, and a refused write is reported in
 * `writeError`, never thrown, while the change lasts as long as the page is open. Entries that no
 * longer read are kept as stored and listed in `unreadable`.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react'

import {
  readSavedContents,
  withSavedContents,
  withoutSavedContents,
  type SavedContents,
} from '@/lib/documentContents/savedContents'

export const SAVED_CONTENTS_KEY_PREFIX = 'pgmaps.documentContents.'

export type SavedContentsState = {
  saved: readonly SavedContents[]
  unreadable: ReadonlyArray<{ index: number; error: string }>
  /** Why the last write was refused (private window, quota), or null. */
  writeError: string | null
}

type Store = {
  key: string
  raw: unknown[]
  snapshot: SavedContentsState
  loaded: boolean
  listeners: Set<() => void>
}

const stores = new Map<string, Store>()

function storeFor(listId: string): Store {
  let store = stores.get(listId)
  if (!store) {
    store = {
      key: `${SAVED_CONTENTS_KEY_PREFIX}${listId}`,
      raw: [],
      snapshot: { saved: [], unreadable: [], writeError: null },
      loaded: false,
      listeners: new Set(),
    }
    stores.set(listId, store)
  }
  return store
}

function rebuild(store: Store, writeError: string | null) {
  const read = readSavedContents(store.raw)
  store.snapshot = { saved: read.saved, unreadable: read.unreadable, writeError }
  store.listeners.forEach((listener) => listener())
}

function load(store: Store) {
  if (store.loaded) return
  store.loaded = true
  try {
    const text = window.localStorage.getItem(store.key)
    const parsed: unknown = text ? JSON.parse(text) : []
    store.raw = Array.isArray(parsed) ? parsed : []
  } catch {
    store.raw = []
  }
  rebuild(store, null)
}

function write(store: Store, next: unknown[]) {
  store.raw = next
  let writeError: string | null = null
  try {
    window.localStorage.setItem(store.key, JSON.stringify(next))
  } catch (error) {
    writeError = `This browser did not keep your presets (${error instanceof Error ? error.message : 'storage refused'}): they last while the page is open.`
  }
  rebuild(store, writeError)
}

function newId() {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  } catch {
    // Fall through to a time and random id.
  }
  return `saved-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The raw entries with the readable ones replaced by `saved`, keeping unreadable entries where they were. */
function rawWith(store: Store, saved: readonly SavedContents[]): unknown[] {
  const unreadable = new Set(store.snapshot.unreadable.map((entry) => entry.index))
  return [...store.raw.filter((_, index) => unreadable.has(index)), ...saved]
}

export type SavedContentsStore = SavedContentsState & {
  /** Saves the parts' states (and order) under `name`; a name in use is replaced. Returns the preset, or an error. */
  save: (
    name: string,
    states: Record<string, string>,
    order?: readonly string[],
  ) => { preset: SavedContents } | { error: string }
  remove: (id: string) => void
  /** Deletes an entry that no longer reads. */
  removeUnreadable: (index: number) => void
}

/** The saved presets of the contents list `listId`, kept current across tabs. */
export function useSavedContents(listId: string): SavedContentsStore {
  const store = storeFor(listId)
  const subscribe = useCallback(
    (listener: () => void) => {
      load(store)
      store.listeners.add(listener)
      const onStorage = (event: StorageEvent) => {
        if (event.key !== store.key) return
        store.loaded = false
        load(store)
      }
      window.addEventListener('storage', onStorage)
      return () => {
        store.listeners.delete(listener)
        window.removeEventListener('storage', onStorage)
      }
    },
    [store],
  )
  const getSnapshot = useCallback(() => {
    if (typeof window !== 'undefined') load(store)
    return store.snapshot
  }, [store])
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return useMemo(
    () => ({
      ...state,
      save: (name, states, order) => {
        load(store)
        const result = withSavedContents(store.snapshot.saved, { id: newId(), name, states, order })
        if ('error' in result) return result
        write(store, rawWith(store, result.saved))
        return { preset: result.preset }
      },
      remove: (id) => {
        load(store)
        write(store, rawWith(store, withoutSavedContents(store.snapshot.saved, id)))
      },
      removeUnreadable: (index) => {
        load(store)
        write(
          store,
          store.raw.filter((_, at) => at !== index),
        )
      },
    }),
    [state, store],
  )
}
