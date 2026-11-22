import { useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createEmptyScene, loadStoredScene, type ForestryScene } from './scene'
import { usePersistentScene } from './usePersistentScene'

/** The browser's two stores, faked: localStorage written at once, IndexedDB whose writes commit only when told. */
const stores = vi.hoisted(() => ({
  local: new Map<string, string>(),
  idb: null as { scene: unknown; revision?: number } | null,
  pending: [] as Array<() => void>,
}))
vi.mock('./toolsStorage', () => ({
  loadCurrentScene: async () => (stores.idb ? { revision: 0, ...stores.idb } : null),
  saveCurrentScene: (scene: unknown, revision?: number) =>
    new Promise<void>((resolve) =>
      stores.pending.push(() => {
        stores.idb = { scene: JSON.parse(JSON.stringify(scene)), revision }
        resolve()
      }),
    ),
}))

const named = (name: string): ForestryScene => {
  const scene = createEmptyScene()
  return { ...scene, viewpoint: { ...scene.viewpoint, name } }
}

let hook: ReturnType<typeof usePersistentScene> | null = null
const reportHook = (value: ReturnType<typeof usePersistentScene>) => (hook = value)
function Probe({ initial }: { initial: () => ForestryScene }) {
  const value = usePersistentScene(initial)
  useEffect(() => void reportHook(value))
  return null
}
const flush = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)))

describe('the scene kept across a reload', () => {
  beforeEach(() => {
    stores.local.clear()
    stores.idb = null
    stores.pending = []
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => stores.local.get(key) ?? null,
        setItem: (key: string, value: string) => void stores.local.set(key, value),
        removeItem: (key: string) => void stores.local.delete(key),
      },
    })
    vi.stubGlobal('localStorage', (globalThis.window as unknown as { localStorage: Storage }).localStorage)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    hook = null
  })

  it('keeps an edit made just before a reload whose IndexedDB copy had not yet committed', async () => {
    let page!: ReactTestRenderer
    await act(async () => {
      page = create(<Probe initial={() => loadStoredScene() ?? named('first')} />)
    })
    await flush()
    // The first copy reaches both stores.
    stores.pending.splice(0).forEach((commit) => commit())
    await flush()
    expect(hook!.scene.viewpoint.name).toBe('first')
    // An edit: localStorage has it at once, IndexedDB's put is still queued when the page reloads.
    await act(async () => hook!.setScene(named('edited')))
    await flush()
    expect(stores.pending.length).toBeGreaterThan(0)
    act(() => page.unmount())
    stores.pending = []

    await act(async () => {
      page = create(<Probe initial={() => loadStoredScene() ?? named('fallback')} />)
    })
    await flush()
    expect(hook!.scene.viewpoint.name).toBe('edited')
    act(() => page.unmount())
  })

  it('still takes the IndexedDB copy when it is the newer one, as a scene too large for localStorage is', async () => {
    // localStorage holds an older scene; the IndexedDB copy was written later.
    stores.local.set('pgmaps.forestry-visual-quality.v1', JSON.stringify(named('older')))
    stores.local.set('pgmaps.forestry-visual-quality.revision.v1', '3')
    stores.idb = { scene: named('newer'), revision: 4 }
    let page!: ReactTestRenderer
    await act(async () => {
      page = create(<Probe initial={() => loadStoredScene() ?? named('fallback')} />)
    })
    await flush()
    expect(hook!.scene.viewpoint.name).toBe('newer')
    act(() => page.unmount())
  })

  it('takes the IndexedDB copy kept before revisions were stored', async () => {
    stores.local.set('pgmaps.forestry-visual-quality.v1', JSON.stringify(named('local')))
    stores.idb = { scene: named('stored') }
    let page!: ReactTestRenderer
    await act(async () => {
      page = create(<Probe initial={() => loadStoredScene() ?? named('fallback')} />)
    })
    await flush()
    expect(hook!.scene.viewpoint.name).toBe('stored')
    act(() => page.unmount())
  })
})
