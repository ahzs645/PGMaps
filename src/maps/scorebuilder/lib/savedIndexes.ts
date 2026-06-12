import type { ScoreBuilderShareState } from './shareState'

/** A named index recipe persisted on the user's device. */
export interface SavedIndexEntry {
  id: string
  label: string
  savedAt: string
  state: ScoreBuilderShareState
}

const STORAGE_KEY = 'pgmaps.indexLab.savedIndexes'
const MAX_SAVED_INDEXES = 30

export function loadSavedIndexes(): SavedIndexEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (entry): entry is SavedIndexEntry =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as SavedIndexEntry).id === 'string' &&
        typeof (entry as SavedIndexEntry).label === 'string' &&
        typeof (entry as SavedIndexEntry).state === 'object' &&
        (entry as SavedIndexEntry).state !== null,
    )
  } catch {
    return []
  }
}

export function persistSavedIndexes(entries: SavedIndexEntry[]): SavedIndexEntry[] {
  const trimmed = entries.slice(0, MAX_SAVED_INDEXES)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // Private browsing or full storage — saving silently degrades to session-only.
  }
  return trimmed
}

export function createSavedIndexId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `saved_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
