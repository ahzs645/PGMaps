/**
 * Which workspace interface the road designer opens in. No DOM access: the caller passes the
 * URL search string and the stored choice, so the rule is unit-testable.
 *
 * The designer never stops at a chooser. It opens, in order of precedence, the interface named
 * by `?interface=` (a shared link), the one this browser last used, Guided mode
 * (the view the designer had before interfaces were configurable), or the first served layout.
 */
const INTERFACE_STORAGE_KEY = 'pgmaps-road-interface'
const INTERFACE_PARAM = 'interface'
const DEFAULT_INTERFACE = 'workbench'
export const DEFAULT_INTERFACE_NAME = 'Guided mode'

/** Keep the launching workspace in help links, including layouts without a Ribbon. */
export function workspaceHelpSearch(layout: { id: string; toolbar?: { dock: 'top' | 'side' } }) {
  const params = new URLSearchParams({ interface: layout.id })
  if (layout.toolbar?.dock === 'top') params.set('layout', 'ribbon')
  else params.set('ribbonInterface', 'ribbon')
  return params.toString()
}

export function initialInterfaceId(
  layouts: readonly { id: string }[],
  search: string,
  stored: string | null,
): string | undefined {
  const known = (id: string | null | undefined) => (id && layouts.some((layout) => layout.id === id) ? id : undefined)
  return (
    known(new URLSearchParams(search).get(INTERFACE_PARAM)) ??
    known(stored) ??
    known(DEFAULT_INTERFACE) ??
    layouts[0]?.id
  )
}

export function readStoredInterface(): string | null {
  try {
    return localStorage.getItem(INTERFACE_STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Remember a chosen interface. A link that named another one is rewritten to this choice, so a
 * reload opens what the user switched to rather than what the link said. It builds on the address
 * bar as it is now (AGENTS.md: router params can lag it).
 */
export function storeInterface(id: string) {
  try {
    localStorage.setItem(INTERFACE_STORAGE_KEY, id)
  } catch {
    /* The chosen interface still applies to this session. */
  }
  const url = new URL(window.location.href)
  if (url.searchParams.has(INTERFACE_PARAM) && url.searchParams.get(INTERFACE_PARAM) !== id) {
    url.searchParams.set(INTERFACE_PARAM, id)
    window.history.replaceState(window.history.state, '', url)
  }
}
