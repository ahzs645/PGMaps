/**
 * Ask the browser not to clear this site's storage on its own
 * (docs/app-updates-and-caching.md, **Work kept in this browser**).
 *
 * Road projects, visual quality scenes and field photos live in IndexedDB. Without this the
 * browser treats them as a cache it may discard when the disk fills, together with every tile and
 * data file the service worker holds for the same site. Chrome and Safari decide silently; Firefox
 * asks the person, so the request is made once work has been saved, after they have used the page,
 * and not again for a month after a refusal.
 */
export type PersistenceResult = 'persistent' | 'granted' | 'refused' | 'unavailable'

export interface PersistenceEnv {
  storage?: { persist?: () => Promise<boolean>; persisted?: () => Promise<boolean> }
  /** False until the person has clicked, typed or tapped in the page. Absent in older browsers. */
  userActive?: boolean
  readAskedAt: () => number | null
  writeAskedAt: (time: number) => void
  now: () => number
}

export const PERSIST_ASKED_KEY = 'pgmaps.storage.persistAskedAt'
export const PERSIST_ASK_AGAIN_MS = 30 * 24 * 60 * 60 * 1000

function browserEnv(): PersistenceEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return {
    storage: nav?.storage,
    userActive: (nav as { userActivation?: { hasBeenActive?: boolean } } | undefined)?.userActivation?.hasBeenActive,
    readAskedAt: () => {
      try {
        const value = Number(localStorage.getItem(PERSIST_ASKED_KEY))
        return Number.isFinite(value) && value > 0 ? value : null
      } catch {
        return null
      }
    },
    writeAskedAt: (time) => {
      try {
        localStorage.setItem(PERSIST_ASKED_KEY, String(time))
      } catch {
        // Storage is shut: the request is simply made again next visit.
      }
    },
    now: () => Date.now(),
  }
}

/** One request; `null` means it is too early to ask and a later call should try again. */
export async function requestPersistence(env: PersistenceEnv): Promise<PersistenceResult | null> {
  const storage = env.storage
  if (!storage?.persist || !storage.persisted) return 'unavailable'
  try {
    if (await storage.persisted()) return 'persistent'
    if (env.userActive === false) return null
    const askedAt = env.readAskedAt()
    if (askedAt !== null && env.now() - askedAt < PERSIST_ASK_AGAIN_MS) return 'refused'
    env.writeAskedAt(env.now())
    return (await storage.persist()) ? 'granted' : 'refused'
  } catch {
    return 'unavailable'
  }
}

let settled: Promise<PersistenceResult | null> | null = null

/**
 * Call wherever a tool writes a person's work to this browser. The first call that can ask does;
 * every later one is free. It never throws and never blocks the write it follows.
 */
export function keepStoragePersistent(): void {
  if (settled) return
  const attempt = requestPersistence(browserEnv())
  settled = attempt
  void attempt.then((result) => {
    // Too early to ask (nobody has touched the page yet): let the next save try.
    if (result === null && settled === attempt) settled = null
  })
}
