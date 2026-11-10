import dataHostsConfig from '@/config/data-hosts.json'
import { parseDataHosts, remoteDataUrl, type DataHost } from './dataHosts'

const ABSOLUTE = /^[a-z][a-z0-9+.-]*:|^\/\//i

/**
 * The hosts serving data folders other than this site, from
 * `src/config/data-hosts.json`. `VITE_DATA_HOSTS_LOCAL=1` ignores the file, so
 * a local build reads a changed bcdatamapper snapshot from public/data before
 * it is published (the sync script then copies every folder too).
 */
export const DATA_HOSTS: readonly DataHost[] =
  import.meta.env.VITE_DATA_HOSTS_LOCAL === '1' ? [] : parseDataHosts(dataHostsConfig)

/**
 * Resolve a root-relative path for this deploy.
 *
 * A `/data/...` path in a folder that `src/config/data-hosts.json` assigns to
 * another host becomes that host's URL. Anything else is resolved against the
 * deploy base: the app is served from `/` by default but from `VITE_BASE_PATH`
 * when deployed under a sub-path, and most data URLs in this repo are written
 * as bare '/data/...' literals. Routing them through here (which `fetchBytes`
 * does for every request) keeps those literals correct under either deploy
 * without each call site having to remember the prefix or the host.
 *
 * A path that already carries the deploy base is not prefixed twice, so
 * resolving a resolved path is harmless. Absolute URLs and already-relative
 * paths are returned untouched.
 */
export function withBase(path: string, hosts: readonly DataHost[] = DATA_HOSTS): string {
  if (!path.startsWith('/') || ABSOLUTE.test(path)) return path
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  const rootPath = base && path.startsWith(`${base}/`) ? path.slice(base.length) : path
  return remoteDataUrl(rootPath, hosts) ?? `${base}${rootPath}`
}

/** Build a URL under the deploy base's `data/` directory. */
export function dataUrl(...segments: string[]): string {
  const path = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
  return withBase(`/data/${path}`)
}
