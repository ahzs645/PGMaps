import { describe, expect, it, vi } from 'vitest'
import {
  forgetOfflineTool,
  isHeldOffline,
  keepToolOffline,
  OFFLINE_TOOLS,
  offlineToolStatus,
  offlineToolSummary,
  refreshOfflineFiles,
  type OfflineEnv,
  type OfflineStatus,
} from './offlineTools'
import { PERSIST_ASK_AGAIN_MS, requestPersistence, type PersistenceEnv } from './persistentStorage'

const HELD: OfflineStatus = {
  build: 'b1',
  deployed: true,
  shell: { files: 2, held: 2 },
  groups: { 'road-design': { kept: true, files: 3, held: 3, bytes: 30, deferred: [] } },
}

/** A service worker that answers on the port it is handed, as `public/sw.js` does. */
function envWith(answer: (message: unknown) => unknown, extra: Partial<OfflineEnv> = {}) {
  const posted: unknown[] = []
  const env: OfflineEnv = {
    serviceWorker: {
      ready: Promise.resolve({
        active: {
          postMessage(message: unknown, transfer: Transferable[]) {
            posted.push(message)
            const reply = answer(message)
            if (reply !== undefined) (transfer[0] as MessagePort).postMessage(reply)
          },
        },
      }),
    },
    newChannel: () => new MessageChannel(),
    ...extra,
  }
  return { env, posted }
}

describe('keepToolOffline', () => {
  it('asks the service worker for the tool and returns what it holds', async () => {
    const { env, posted } = envWith(() => HELD)
    expect(await keepToolOffline('road-design', env)).toEqual(HELD)
    expect(posted).toEqual([{ type: 'pgmaps-offline', groups: ['road-design'], statusOnly: false }])
  })

  it('does nothing where there is no service worker', async () => {
    expect(await keepToolOffline('road-design', { newChannel: () => new MessageChannel() })).toBeNull()
    const noActive: OfflineEnv = {
      serviceWorker: { ready: Promise.resolve({ active: null }) },
      newChannel: () => new MessageChannel(),
    }
    expect(await keepToolOffline('road-design', noActive)).toBeNull()
  })

  it('fetches nothing when the person asked their browser to save data', async () => {
    const { env, posted } = envWith(() => HELD, { saveData: true })
    expect(await keepToolOffline('visual-quality', env)).toBeNull()
    expect(posted).toEqual([])
  })

  it('gives up on a worker that never answers or that reports an error', async () => {
    expect(await keepToolOffline('road-design', envWith(() => undefined).env, 20)).toBeNull()
    expect(await keepToolOffline('road-design', envWith(() => ({ error: 'QuotaExceededError' })).env)).toBeNull()
  })
})

describe('refreshOfflineFiles', () => {
  it('asks for the deployed build without naming a tool', async () => {
    const { env, posted } = envWith(() => HELD)
    expect(await refreshOfflineFiles(env)).toEqual(HELD)
    expect(posted).toEqual([{ type: 'pgmaps-offline', groups: [], statusOnly: false }])
  })

  it('fetches nothing when the person asked their browser to save data', async () => {
    const { env, posted } = envWith(() => HELD, { saveData: true })
    expect(await refreshOfflineFiles(env)).toBeNull()
    expect(posted).toEqual([])
  })
})

describe('offlineToolStatus', () => {
  it('asks for the status only, even when the browser is saving data', async () => {
    const { env, posted } = envWith(() => HELD, { saveData: true })
    expect(await offlineToolStatus('road-design', env)).toEqual(HELD)
    expect(posted).toEqual([{ type: 'pgmaps-offline', groups: ['road-design'], statusOnly: true }])
  })
})

describe('forgetOfflineTool', () => {
  it('names the tool to forget and asks for none', async () => {
    const { env, posted } = envWith(() => HELD)
    expect(await forgetOfflineTool('visual-quality', env)).toEqual(HELD)
    expect(posted).toEqual([{ type: 'pgmaps-offline', groups: [], statusOnly: false, forget: ['visual-quality'] }])
  })
})

describe('offlineToolSummary', () => {
  const group = HELD.groups['road-design']
  const withGroup = (changes: Partial<typeof group>): OfflineStatus => ({
    ...HELD,
    groups: { 'road-design': { ...group, ...changes } },
  })

  it('says ready only when the shell and every file are held', () => {
    expect(offlineToolSummary(HELD, 'road-design')).toBe('Ready to open offline')
    expect(offlineToolSummary({ ...HELD, shell: { files: 2, held: 1 } }, 'road-design')).toBe('Fetching the app files')
  })

  it('reports progress for a kept tool, and not kept for one that only visits have part-filled', () => {
    expect(offlineToolSummary(withGroup({ held: 1 }), 'road-design')).toBe('Fetching: 1 of 3 files')
    expect(offlineToolSummary(withGroup({ kept: false, held: 2 }), 'road-design')).toBe('Not kept')
  })

  it('says not kept where there is no worker, no list, or no such tool', () => {
    expect(offlineToolSummary(null, 'road-design')).toBe('Not kept')
    expect(offlineToolSummary({ build: null, deployed: false, shell: null, groups: {} }, 'road-design')).toBe(
      'Not kept',
    )
    expect(offlineToolSummary(HELD, 'visual-quality')).toBe('Not kept')
  })

  it('has a row for every tool a page can ask for', () => {
    expect(OFFLINE_TOOLS.map((tool) => tool.id).sort()).toEqual(['block-planning', 'road-design', 'visual-quality'])
  })
})

describe('isHeldOffline', () => {
  it('needs every file of the shell and of the tool', () => {
    expect(isHeldOffline(HELD, 'road-design')).toBe(true)
    expect(isHeldOffline(HELD, 'visual-quality')).toBe(false)
    expect(isHeldOffline({ ...HELD, shell: { files: 2, held: 1 } }, 'road-design')).toBe(false)
    expect(
      isHeldOffline({ ...HELD, groups: { 'road-design': { ...HELD.groups['road-design'], held: 2 } } }, 'road-design'),
    ).toBe(false)
    expect(isHeldOffline(null, 'road-design')).toBe(false)
  })
})

describe('requestPersistence', () => {
  function env(overrides: Partial<PersistenceEnv> & { persisted?: boolean; grants?: boolean } = {}) {
    const persist = vi.fn(async () => overrides.grants ?? true)
    let askedAt: number | null = null
    const made: PersistenceEnv = {
      storage: { persist, persisted: async () => overrides.persisted ?? false },
      userActive: true,
      readAskedAt: () => askedAt,
      writeAskedAt: (time) => {
        askedAt = time
      },
      now: () => 1_000_000,
      ...overrides,
    }
    return { made, persist }
  }

  it('asks once work is being saved and reports the answer', async () => {
    const granted = env()
    expect(await requestPersistence(granted.made)).toBe('granted')
    expect(granted.persist).toHaveBeenCalledOnce()
    expect(await requestPersistence(env({ grants: false }).made)).toBe('refused')
  })

  it('does not ask when storage is already persistent', async () => {
    const { made, persist } = env({ persisted: true })
    expect(await requestPersistence(made)).toBe('persistent')
    expect(persist).not.toHaveBeenCalled()
  })

  it('waits until the person has used the page', async () => {
    const { made, persist } = env({ userActive: false })
    expect(await requestPersistence(made)).toBeNull()
    expect(persist).not.toHaveBeenCalled()
  })

  it('does not ask again within a month of a refusal, then asks again', async () => {
    const { made, persist } = env({ grants: false })
    expect(await requestPersistence(made)).toBe('refused')
    expect(await requestPersistence(made)).toBe('refused')
    expect(persist).toHaveBeenCalledOnce()
    expect(await requestPersistence({ ...made, now: () => 1_000_000 + PERSIST_ASK_AGAIN_MS + 1 })).toBe('refused')
    expect(persist).toHaveBeenCalledTimes(2)
  })

  it('reports a browser without the API, and one that throws, as unavailable', async () => {
    expect(await requestPersistence(env({ storage: undefined }).made)).toBe('unavailable')
    const throws = env({
      storage: {
        persist: async () => true,
        persisted: async () => {
          throw new Error('SecurityError')
        },
      },
    })
    expect(await requestPersistence(throws.made)).toBe('unavailable')
  })
})
