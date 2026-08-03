const ABSOLUTE = /^[a-z][a-z0-9+.-]*:|^\/\//i

/**
 * Resolve a root-relative path against the deploy base.
 *
 * The app is served from `/` by default but from `VITE_BASE_PATH` when
 * deployed under a sub-path, and most data URLs in this repo are written as
 * bare '/data/...' literals. Routing them through here (which `fetchBytes`
 * does for every request) keeps those literals correct under either deploy
 * without each call site having to remember the prefix.
 *
 * Absolute URLs and already-relative paths are returned untouched.
 */
export function withBase(path: string): string {
  if (!path.startsWith('/') || ABSOLUTE.test(path)) return path
  const base = import.meta.env.BASE_URL || '/'
  if (base === '/') return path
  return `${base.replace(/\/$/, '')}${path}`
}

/** Build a URL under the deploy base's `data/` directory. */
export function dataUrl(...segments: string[]): string {
  const path = segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
  return withBase(`/data/${path}`)
}
