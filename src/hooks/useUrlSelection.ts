import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSetUrlParams } from './useUrlState'

export interface UseUrlSelectionOptions<T> {
  /** Search param holding the selected item's id, e.g. 'park'. */
  param: string
  items: readonly T[]
  getId: (item: T) => string
  /** Other params to drop alongside this one when the selection is cleared. */
  clearParams?: readonly string[]
  /** Skip resolving from the URL while false, e.g. another selection takes precedence. */
  enabled?: boolean
}

export interface UrlSelection<T> {
  /** Local selection if the user has made one, else the item named by the URL. */
  selected: T | null
  /** True while the URL names an item whose dataset has not loaded yet. */
  pending: boolean
  select: (item: T | null) => void
  /** Clear the selection and drop the param, without a stale deep link resurrecting it. */
  clear: () => void
}

/**
 * A selection that can arrive either from a click or from a deep link.
 *
 * The subtlety both parks and bcassessment had solved separately: after the
 * user clears a URL-provided selection, the param is gone but a re-render can
 * still see it mid-navigation, so the cleared id is remembered and ignored.
 * Pasting a *fresh* link with that same id still works, because a new id (or a
 * new click) resets the marker.
 *
 * `clear()` writes through useSetUrlParams, so calling it on several selections
 * in one handler does not clobber — consecutive per-key writes would each start
 * from the same stale render params.
 */
export function useUrlSelection<T>({
  param,
  items,
  getId,
  clearParams,
  enabled = true,
}: UseUrlSelectionOptions<T>): UrlSelection<T> {
  const [searchParams] = useSearchParams()
  const setParams = useSetUrlParams()
  const [localSelection, setLocalSelection] = useState<T | null>(null)
  const [ignoredId, setIgnoredId] = useState<string | null>(null)

  const urlId = searchParams.get(param)
  const urlIdActive = enabled && Boolean(urlId) && urlId !== ignoredId

  const selected = useMemo(() => {
    if (localSelection) return localSelection
    if (!urlIdActive) return null
    return items.find((item) => getId(item) === urlId) ?? null
  }, [localSelection, urlIdActive, items, getId, urlId])

  const pending = urlIdActive && items.length === 0

  const select = useCallback((item: T | null) => {
    // A fresh click supersedes the ignored marker, so the same id can be
    // selected again after being cleared.
    setIgnoredId(null)
    setLocalSelection(item)
  }, [])

  const clear = useCallback(() => {
    setIgnoredId(searchParams.get(param))
    setLocalSelection(null)
    const updates: Record<string, string | null> = { [param]: null }
    for (const key of clearParams ?? []) updates[key] = null
    setParams(updates)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clearParams is keyed by value below
  }, [param, searchParams, setParams, (clearParams ?? []).join('|')])

  return { selected, pending, select, clear }
}
