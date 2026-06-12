import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSavedIndexId, loadSavedIndexes, persistSavedIndexes, type SavedIndexEntry } from './savedIndexes'
import type { ScoreBuilderShareState } from './shareState'

function createFakeLocalStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value)
    },
    removeItem: (key: string) => {
      store.delete(key)
    },
  }
}

function createEntry(label: string): SavedIndexEntry {
  return {
    id: createSavedIndexId(),
    label,
    savedAt: new Date().toISOString(),
    state: {
      version: 1,
      boundarySource: 'census',
      healthBoundaryLevel: 'lha',
      censusBoundaryLevel: 'da',
      enabledDataSources: ['airQuality'],
      selectedNetworks: [],
      weights: { monitorCount: 35 },
    } as ScoreBuilderShareState,
  }
}

describe('savedIndexes storage', () => {
  beforeEach(() => {
    ;(globalThis as { window?: unknown }).window = { localStorage: createFakeLocalStorage() }
  })
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window
  })

  it('round-trips entries through localStorage', () => {
    const entry = createEntry('My downtown index')
    persistSavedIndexes([entry])
    const loaded = loadSavedIndexes()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].label).toBe('My downtown index')
    expect(loaded[0].state.weights.monitorCount).toBe(35)
  })

  it('returns an empty list when storage is empty or corrupt', () => {
    expect(loadSavedIndexes()).toEqual([])
    ;(globalThis as unknown as { window: { localStorage: ReturnType<typeof createFakeLocalStorage> } }).window
      .localStorage.setItem('pgmaps.indexLab.savedIndexes', 'not-json{{{')
    expect(loadSavedIndexes()).toEqual([])
  })

  it('filters malformed entries on load', () => {
    const good = createEntry('Valid')
    ;(globalThis as unknown as { window: { localStorage: ReturnType<typeof createFakeLocalStorage> } }).window
      .localStorage.setItem(
        'pgmaps.indexLab.savedIndexes',
        JSON.stringify([good, { id: 42 }, 'junk', null, { label: 'no id', state: {} }]),
      )
    const loaded = loadSavedIndexes()
    expect(loaded).toHaveLength(1)
    expect(loaded[0].id).toBe(good.id)
  })

  it('caps the saved list at 30 entries, newest first', () => {
    const entries = Array.from({ length: 40 }, (_, index) => createEntry(`Index ${index}`))
    const persisted = persistSavedIndexes(entries)
    expect(persisted).toHaveLength(30)
    expect(loadSavedIndexes()).toHaveLength(30)
    expect(persisted[0].label).toBe('Index 0')
  })

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => createSavedIndexId()))
    expect(ids.size).toBe(100)
  })
})
