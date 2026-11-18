/**
 * Which browser-tab icon each page shows (`src/config/page-icons.json`; `docs/page-icons.md`).
 * Read by the app shell (`usePageIcon`) and by `scripts/write-spa-fallback.mjs`, which writes the
 * same icon into each route's entry page so the tab is right before any script runs.
 * Keep this file free of DOM and network access.
 */

export type PageIconRoute = { path: string; icon: string }
export type PageIconConfig = { default: string; routes: PageIconRoute[] }

/** A file under `public/`, named without a leading slash. */
const ICON_FILE = /^[a-z0-9][a-z0-9._/-]*\.(svg|png|ico)$/i

export function parsePageIcons(value: unknown): PageIconConfig {
  if (!value || typeof value !== 'object') throw new Error('page-icons.json: expected an object')
  const { default: fallback, routes } = value as Record<string, unknown>
  const file = (icon: unknown, where: string): string => {
    if (typeof icon !== 'string' || !ICON_FILE.test(icon) || icon.includes('..'))
      throw new Error(`page-icons.json: ${where} must name an .svg, .png or .ico file under public/`)
    return icon
  }
  if (!Array.isArray(routes)) throw new Error('page-icons.json: routes must be a list')
  return {
    default: file(fallback, 'default'),
    routes: routes.map((route, index) => {
      const { path, icon } = (route ?? {}) as Record<string, unknown>
      if (typeof path !== 'string' || !path.startsWith('/') || (path.length > 1 && path.endsWith('/')))
        throw new Error(`page-icons.json: routes[${index}].path must start with / and not end with one`)
      return { path, icon: file(icon, `routes[${index}].icon`) }
    }),
  }
}

/**
 * The icon for a router path: the longest listed path that is the page itself or a folder above it
 * (`/help` covers `/help/first-road`, never `/helpers`), else the default.
 */
export function pageIconFor(config: PageIconConfig, pathname: string): string {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  let best: PageIconRoute | undefined
  for (const route of config.routes) {
    const covers = path === route.path || path.startsWith(`${route.path}/`)
    if (covers && (!best || route.path.length > best.path.length)) best = route
  }
  return best?.icon ?? config.default
}

export function iconType(icon: string): string {
  if (icon.endsWith('.svg')) return 'image/svg+xml'
  if (icon.endsWith('.png')) return 'image/png'
  return 'image/x-icon'
}
