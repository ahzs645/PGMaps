/**
 * Which workspace interface the road designer opens in. No DOM access: the caller passes the
 * URL search string and the stored choice, so the rule is unit-testable.
 *
 * The designer never stops at a chooser. It opens, in order of precedence, the interface named
 * by `?interface=` (a shared link), the one this browser last used, the engineering workbench
 * (the view the designer had before interfaces were configurable), or the first served layout.
 */
export const INTERFACE_STORAGE_KEY = 'pgmaps-road-interface'
export const INTERFACE_PARAM = 'interface'
const DEFAULT_INTERFACE = 'workbench'

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

export function storeInterface(id: string) {
  try {
    localStorage.setItem(INTERFACE_STORAGE_KEY, id)
  } catch {
    /* The chosen interface still applies to this session. */
  }
}
