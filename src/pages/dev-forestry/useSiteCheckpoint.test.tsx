import 'fake-indexeddb/auto'
import { useEffect } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { emptyProjectMedia, writeProjectArchive } from './projectArchive'
import type { ProjectState } from './projectFile'
import { createEmptyScene } from './scene'
import { SITE_ID_STORAGE_KEY } from './siteCheckpoint'
import { clearSiteCheckpoint, loadSiteCheckpoint, saveSiteCheckpoint } from './toolsStorage'
import { useSiteCheckpoint, type SiteCheckpointOptions } from './useSiteCheckpoint'

vi.mock('./siteCheckpoint', async (original) => ({
  ...(await original<typeof import('./siteCheckpoint')>()),
  CHECKPOINT_DELAY_MS: 5,
}))

const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='
const stateFor = (caption: string): ProjectState => ({
  scene: createEmptyScene(),
  views: [
    {
      id: 'view-1',
      name: 'Made-up view',
      positionMeters: 0,
      lookAtTargetId: null,
      yaw: 0,
      tilt: 0,
      treeHeightMeters: 20,
      roadClearWidthMeters: 15,
      harvestPhase: 'after',
    },
  ],
  shelved: [],
  images: { 'view-1': { dataUrl: PIXEL, width: 1, height: 1, caption } },
  capturedBefore: {},
  engineFigures: {},
  workspace: null,
  pkg: { renderer: null, recipeId: null },
})

let hook: ReturnType<typeof useSiteCheckpoint> | null = null
function Probe(props: SiteCheckpointOptions) {
  const value = useSiteCheckpoint(props)
  useEffect(() => void (hook = value))
  return null
}
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 60)))
/** Waits, a little at a time, until `check` holds: a write is a gzip and a database put after the delay. */
async function until(check: () => Promise<boolean> | boolean) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return
    await settle()
  }
  throw new Error('timed out')
}

describe('the site checkpoint across a reload', () => {
  const local = new Map<string, string>()
  let renderer: ReactTestRenderer | null = null
  beforeEach(async () => {
    local.clear()
    vi.stubGlobal('window', globalThis)
    vi.stubGlobal('localStorage', {
      getItem: (name: string) => local.get(name) ?? null,
      setItem: (name: string, value: string) => void local.set(name, value),
      removeItem: (name: string) => void local.delete(name),
    })
    await clearSiteCheckpoint()
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = null
    hook = null
    vi.unstubAllGlobals()
  })

  const mount = async (options: Partial<SiteCheckpointOptions> & Pick<SiteCheckpointOptions, 'build'>) => {
    const props: SiteCheckpointOptions = {
      ready: true,
      watch: ['first'],
      sceneRevision: () => 3,
      restore: () => undefined,
      ...options,
    }
    await act(async () => {
      renderer = create(<Probe {...props} />)
    })
    return (next: Partial<SiteCheckpointOptions>) => act(async () => renderer!.update(<Probe {...props} {...next} />))
  }

  it('opens the kept site before writing anything over it', async () => {
    local.set(SITE_ID_STORAGE_KEY, 'site-kept')
    const blob = await writeProjectArchive(stateFor('Before the reload.'), emptyProjectMedia())
    await saveSiteCheckpoint({
      siteId: 'site-kept',
      sceneRevision: 3,
      savedAt: '2026-11-22T14:02:00.000Z',
      name: 'Kept',
      blob,
    })
    // The page holds what it restored, as the page's state does: the write after the restore keeps the pictures.
    let held: ProjectState = { ...stateFor(''), images: {} }
    const restore = vi.fn((kept: { state: ProjectState }) => void (held = kept.state))
    const build = vi.fn(() => ({ state: held, title: null, name: 'Kept' }))
    const update = await mount({ build, restore, watch: ['opened'] })
    await until(() => restore.mock.calls.length > 0)
    const [[{ state }]] = restore.mock.calls
    expect((state.images['view-1'] as { caption: string }).caption).toBe('Before the reload.')
    // Taking it in is not a change: nothing is built or written back, and the line says where it came from.
    await settle()
    expect(build).not.toHaveBeenCalled()
    expect(hook?.status).toMatchObject({ kind: 'kept', restored: true })
    // The reviewer's next change writes, with what came back.
    await update({ watch: ['a change'] })
    await until(() => build.mock.calls.length > 0 && hook?.status.kind === 'kept' && !('restored' in hook.status))
    const { openProjectArchive } = await import('./projectArchive')
    const row = await loadSiteCheckpoint()
    const reread = await openProjectArchive(row!.blob)
    expect((reread.state.images['view-1'] as { caption: string }).caption).toBe('Before the reload.')
  })

  it('never opens another site’s checkpoint, and drops it', async () => {
    local.set(SITE_ID_STORAGE_KEY, 'site-open')
    await saveSiteCheckpoint({
      siteId: 'site-left',
      sceneRevision: 9,
      savedAt: '2026-11-22T14:02:00.000Z',
      name: 'Left',
      blob: await writeProjectArchive(stateFor('Another site.'), emptyProjectMedia()),
    })
    const restore = vi.fn()
    await mount({ build: () => ({ state: stateFor('Open site.'), title: null, name: 'Open' }), restore })
    await until(async () => (await loadSiteCheckpoint())?.siteId === 'site-open')
    expect(restore).not.toHaveBeenCalled()
    const row = await loadSiteCheckpoint()
    expect(row?.siteId).toBe('site-open')
    expect(row?.name).toBe('Open')
  })

  it('writes a switched site under its own name only, never the last site’s state', async () => {
    let caption = 'Site A.'
    const update = await mount({ build: () => ({ state: stateFor(caption), title: null, name: caption }) })
    await until(async () => (await loadSiteCheckpoint())?.name === 'Site A.')
    const first = await loadSiteCheckpoint()
    expect(first?.name).toBe('Site A.')
    // A change on site A, then a switch before it is written: the pending write is dropped with the last site's copy.
    await update({ watch: ['changed on A'] })
    await act(async () => hook!.newSite())
    await settle()
    expect(await loadSiteCheckpoint()).toBeNull()
    // The next site's own change writes it, under its own id.
    caption = 'Site B.'
    await update({ watch: ['site B'] })
    await until(async () => (await loadSiteCheckpoint())?.name === 'Site B.')
    const second = await loadSiteCheckpoint()
    expect(second?.name).toBe('Site B.')
    expect(second?.siteId).not.toBe(first?.siteId)
    expect(local.get(SITE_ID_STORAGE_KEY)).toBe(second?.siteId)
  })
})
