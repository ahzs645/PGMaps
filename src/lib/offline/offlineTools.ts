import { useEffect } from 'react'

/**
 * Tools that work with no network once they have been opened online
 * (docs/app-updates-and-caching.md, **Offline tools**). Each id is a group in the build's
 * `offline-precache.json` (`vite.config.ts`); the service worker fetches every file of it, lazily
 * loaded ones included, and keeps doing so for later builds.
 */
export type OfflineToolId = 'road-design' | 'visual-quality' | 'block-planning'

/** The offline tools as a person knows them, for the storage dialog. */
export const OFFLINE_TOOLS: ReadonlyArray<{ id: OfflineToolId; label: string; href: string; limits: string }> = [
  {
    id: 'road-design',
    label: 'Road designer',
    href: '/dev/forestry/road-design',
    limits: 'Satellite imagery and the live BC layers still need a connection.',
  },
  {
    id: 'block-planning',
    label: 'Block planning',
    href: '/dev/forestry/block-planning',
    limits: 'The basemap needs a connection. Local shapes, packs and projections work offline.',
  },
  {
    id: 'visual-quality',
    label: 'Visual quality',
    href: '/dev/forestry/visual-quality',
    limits: 'The page opens offline; a run still needs a connection for the inventory.',
  },
]

export interface OfflineGroupStatus {
  /** Asked for on this or an earlier visit, so later builds are fetched for it too. */
  kept: boolean
  files: number
  /** How many of those files are in Cache Storage now. */
  held: number
  bytes: number
  /** Reachable files too large to fetch ahead; each is kept the first time it is used online. */
  deferred: Array<{ file: string; bytes: number }>
}

export interface OfflineStatus {
  /** The build the lists describe; null when the site has no list (the dev server). */
  build: string | null
  /** True when the list came from the network just now, false when it is the last one read. */
  deployed: boolean
  shell: { files: number; held: number } | null
  groups: Record<string, OfflineGroupStatus>
}

/** The parts of the browser this needs, so the rules can be tested without one. */
export interface OfflineEnv {
  /** `navigator.serviceWorker`, absent where service workers are unavailable. */
  serviceWorker?: {
    ready: Promise<{ active: { postMessage(message: unknown, transfer: Transferable[]): void } | null }>
  }
  /** `navigator.connection.saveData`: the person asked the browser to use less data. */
  saveData?: boolean
  newChannel: () => { port1: MessagePort; port2: MessagePort }
}

function browserEnv(): OfflineEnv {
  const nav = typeof navigator === 'undefined' ? undefined : navigator
  return {
    serviceWorker: nav && 'serviceWorker' in nav ? nav.serviceWorker : undefined,
    saveData: (nav as { connection?: { saveData?: boolean } } | undefined)?.connection?.saveData === true,
    newChannel: () => new MessageChannel(),
  }
}

/** Long enough for a first fetch of a tool on a slow connection; the worker carries on regardless. */
const REPLY_TIMEOUT_MS = 5 * 60 * 1000

async function ask(
  env: OfflineEnv,
  groups: readonly OfflineToolId[],
  statusOnly: boolean,
  timeoutMs: number,
  forget: readonly OfflineToolId[] = [],
): Promise<OfflineStatus | null> {
  if (!env.serviceWorker) return null
  const registration = await env.serviceWorker.ready
  const worker = registration.active
  if (!worker) return null
  return new Promise((resolve) => {
    const channel = env.newChannel()
    const timer = setTimeout(() => finish(null), timeoutMs)
    function finish(status: OfflineStatus | null) {
      clearTimeout(timer)
      channel.port1.close()
      resolve(status)
    }
    channel.port1.onmessage = (event: MessageEvent) => {
      const data = event.data as (OfflineStatus & { error?: string }) | null
      finish(data && !data.error ? data : null)
    }
    worker.postMessage({ type: 'pgmaps-offline', groups, statusOnly, ...(forget.length ? { forget } : {}) }, [
      channel.port2,
    ])
  })
}

/**
 * Fetch and keep everything `tool` needs to open with no network. Resolves with what is held, or
 * null when nothing was done: no service worker (the dev server, a restricted browser), no reply,
 * or the person has asked their browser to save data.
 */
export function keepToolOffline(
  tool: OfflineToolId,
  env: OfflineEnv = browserEnv(),
  timeoutMs = REPLY_TIMEOUT_MS,
): Promise<OfflineStatus | null> {
  if (env.saveData) return Promise.resolve(null)
  return ask(env, [tool], false, timeoutMs).catch(() => null)
}

/** After a page has loaded and drawn; the refresh is never worth delaying either. */
export const OFFLINE_REFRESH_DELAY_MS = 8000

/**
 * Fetch whatever the deployed build added for the shell and for tools kept on earlier visits.
 * Called once on every page load; asks for no new tool.
 */
export function refreshOfflineFiles(env: OfflineEnv = browserEnv()): Promise<OfflineStatus | null> {
  if (env.saveData) return Promise.resolve(null)
  return ask(env, [], false, REPLY_TIMEOUT_MS).catch(() => null)
}

/** What is held for `tool` (or each of several) now, fetching nothing. */
export function offlineToolStatus(
  tool: OfflineToolId | readonly OfflineToolId[],
  env: OfflineEnv = browserEnv(),
  timeoutMs = 10_000,
): Promise<OfflineStatus | null> {
  return ask(env, typeof tool === 'string' ? [tool] : tool, true, timeoutMs).catch(() => null)
}

/**
 * Stop keeping `tool`: the files only it needed are removed, and later builds are no longer
 * fetched for it. Opening the tool online keeps it again.
 */
export function forgetOfflineTool(
  tool: OfflineToolId,
  env: OfflineEnv = browserEnv(),
  timeoutMs = 30_000,
): Promise<OfflineStatus | null> {
  return ask(env, [], false, timeoutMs, [tool]).catch(() => null)
}

/** In words: what the worker holds for a tool. */
export function offlineToolSummary(status: OfflineStatus | null, tool: OfflineToolId): string {
  const group = status?.groups[tool]
  if (!status || !status.build || !group) return 'Not kept'
  if (isHeldOffline(status, tool)) return 'Ready to open offline'
  if (group.kept) {
    return group.held < group.files ? `Fetching: ${group.held} of ${group.files} files` : 'Fetching the app files'
  }
  return 'Not kept'
}

/** True when every file of `tool` and of the shell is held. */
export function isHeldOffline(status: OfflineStatus | null, tool: OfflineToolId): boolean {
  const group = status?.groups[tool]
  return !!status?.shell && status.shell.held === status.shell.files && !!group && group.held === group.files
}

/** The tool has started: its own first requests go before the files it may never need. */
const START_DELAY_MS = 4000

/**
 * Keep the tool a page belongs to available offline. Call it once in the page's component. The
 * fetch starts a few seconds after the page mounts and runs in the service worker, so it never
 * holds the page back; an offline or unsupported browser does nothing.
 */
export function useOfflineTool(tool: OfflineToolId): void {
  useEffect(() => {
    const timer = setTimeout(() => void keepToolOffline(tool), START_DELAY_MS)
    return () => clearTimeout(timer)
  }, [tool])
}
