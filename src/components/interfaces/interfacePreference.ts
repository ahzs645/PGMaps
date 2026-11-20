/**
 * Which workspace interface a tool opens in. No DOM access in the rule itself: the caller passes
 * the URL search string and the stored choice, so it is unit-testable.
 *
 * A tool never stops at a chooser. It opens, in order of precedence, the interface named by
 * `?interface=` (a shared link), the one this browser last used for this tool, the tool's default,
 * or the first served layout.
 */
const INTERFACE_PARAM = 'interface'

/** The help's address for an interface (`/help?interface=<id>`): its lessons then open in it. */
export function workspaceHelpSearch(layout: { id: string }) {
  return new URLSearchParams({ interface: layout.id }).toString()
}

export function initialInterfaceId(
  layouts: readonly { id: string }[],
  search: string,
  stored: string | null,
  fallback?: string,
): string | undefined {
  const known = (id: string | null | undefined) => (id && layouts.some((layout) => layout.id === id) ? id : undefined)
  return known(new URLSearchParams(search).get(INTERFACE_PARAM)) ?? known(stored) ?? known(fallback) ?? layouts[0]?.id
}

/**
 * One tool's remembered interface, under `pgmaps-<storage>-interface`. `defaultId` is what the tool
 * opens with nothing chosen.
 */
export function interfacePreferences(storage: string, defaultId: string) {
  const key = `pgmaps-${storage}-interface`
  return {
    initialInterfaceId: (layouts: readonly { id: string }[], search: string, stored: string | null) =>
      initialInterfaceId(layouts, search, stored, defaultId),
    readStoredInterface(): string | null {
      try {
        return localStorage.getItem(key)
      } catch {
        return null
      }
    },
    /**
     * Remember a chosen interface. A link that named another one is rewritten to this choice, so a
     * reload opens what the user switched to rather than what the link said. It builds on the
     * address bar as it is now (AGENTS.md: router params can lag it).
     */
    storeInterface(id: string) {
      try {
        localStorage.setItem(key, id)
      } catch {
        /* The chosen interface still applies to this session. */
      }
      const url = new URL(window.location.href)
      if (url.searchParams.has(INTERFACE_PARAM) && url.searchParams.get(INTERFACE_PARAM) !== id) {
        url.searchParams.set(INTERFACE_PARAM, id)
        window.history.replaceState(window.history.state, '', url)
      }
    },
  }
}
export type InterfacePreferences = ReturnType<typeof interfacePreferences>
