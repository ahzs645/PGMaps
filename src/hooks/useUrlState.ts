import { useCallback, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'

export interface UrlCodec<T> {
  /** Return null to remove the param from the URL (i.e. the value is the default). */
  encode: (value: T) => string | null
  /** Must tolerate null (param absent) and malformed input, returning a fallback. */
  decode: (raw: string | null) => T
}

/**
 * Sync a piece of state to a URL search param so filtered map views are
 * shareable. Codecs must be defined at module level (referentially stable),
 * otherwise the decoded value is re-derived every render.
 */
export function useUrlState<T>(key: string, codec: UrlCodec<T>): [T, (value: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(key)
  const value = useMemo(() => codec.decode(raw), [codec, raw])

  const setValue = useCallback(
    (next: T) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          const encoded = codec.encode(next)
          if (encoded === null || encoded === '') params.delete(key)
          else params.set(key, encoded)
          return params
        },
        { replace: true },
      )
    },
    [key, codec, setSearchParams],
  )

  return [value, setValue]
}

/**
 * Write several already-encoded params in a single history replace.
 *
 * Updates that span multiple keys (e.g. a level change that also clears the
 * selected unit) must go through one write: consecutive per-key `setValue`
 * calls inside one handler each start from the stale render params, so the
 * last one clobbers the rest. Pass `null` to drop a key.
 */
export function useSetUrlParams(): (updates: Record<string, string | null>) => void {
  const [, setSearchParams] = useSearchParams()

  return useCallback(
    (updates: Record<string, string | null>) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current)
          for (const [key, encoded] of Object.entries(updates)) {
            if (encoded === null || encoded === '') params.delete(key)
            else params.set(key, encoded)
          }
          return params
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )
}

/**
 * Keep a set of derived params in sync with local state, from an effect.
 *
 * For modules whose state lives in `useState` rather than in the URL: describe
 * the params the current state should produce and this writes them, skipping
 * the write when nothing changed (an unguarded write would re-render and loop).
 * Params not listed are preserved, so unrelated keys on the same page survive.
 * Pass `null` to skip a pass entirely — useful while a deep-linked selection is
 * still resolving and would otherwise be written away.
 */
export function useUrlParamSync(updates: Record<string, string | null> | null): void {
  const [searchParams, setSearchParams] = useSearchParams()
  // Serialized so the effect keys off the params' value, not the object identity
  // a caller rebuilds every render.
  const serialized = updates === null ? null : JSON.stringify(updates)

  useEffect(() => {
    if (serialized === null) return
    const pending = JSON.parse(serialized) as Record<string, string | null>
    const params = new URLSearchParams(searchParams)
    for (const [key, encoded] of Object.entries(pending)) {
      if (encoded === null || encoded === '') params.delete(key)
      else params.set(key, encoded)
    }
    if (params.toString() !== searchParams.toString()) {
      setSearchParams(params, { replace: true })
    }
  }, [serialized, searchParams, setSearchParams])
}

export function stringCodec(fallback: string): UrlCodec<string> {
  return {
    encode: (value) => (value === fallback ? null : value),
    decode: (raw) => raw ?? fallback,
  }
}

export function stringUnionCodec<T extends string>(allowed: readonly T[], fallback: T): UrlCodec<T> {
  return {
    encode: (value) => (value === fallback ? null : value),
    decode: (raw) => (raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback),
  }
}

export function numberCodec(fallback: number): UrlCodec<number> {
  return {
    encode: (value) => (value === fallback ? null : String(value)),
    decode: (raw) => {
      if (raw === null || raw.trim() === '') return fallback
      const numeric = Number(raw)
      return Number.isFinite(numeric) ? numeric : fallback
    },
  }
}

export function booleanCodec(fallback: boolean): UrlCodec<boolean> {
  return {
    encode: (value) => (value === fallback ? null : value ? '1' : '0'),
    decode: (raw) => (raw === null ? fallback : raw !== '0' && raw !== 'false'),
  }
}

/**
 * Sentinel for "the user deselected everything". Without it an empty selection
 * serializes to '', which the URL cannot hold, so a reload would silently
 * restore the defaults instead of the empty state the user chose.
 */
const EMPTY_SELECTION = 'none'
/** Used only when 'none' is itself a selectable value. */
const EMPTY_SELECTION_FALLBACK = '~none'

function emptySelectionToken(allowed: readonly string[] | undefined): string {
  return allowed?.includes(EMPTY_SELECTION) ? EMPTY_SELECTION_FALLBACK : EMPTY_SELECTION
}

function splitAllowed<T extends string>(raw: string, allowed: readonly T[] | undefined): T[] {
  const items = raw.split(',').filter(Boolean)
  if (!allowed) return items as T[]
  return items.filter((item): item is T => (allowed as readonly string[]).includes(item))
}

/** Comma-separated values restricted to an allowed set; defaults applied when the param is absent. */
export function stringArrayCodec<T extends string>(allowed: readonly T[], defaults: readonly T[]): UrlCodec<T[]> {
  const defaultKey = [...defaults].sort().join(',')
  const emptyToken = emptySelectionToken(allowed)
  return {
    encode: (value) => {
      const serialized = [...value].sort().join(',')
      if (serialized === defaultKey) return null
      return value.length === 0 ? emptyToken : serialized
    },
    decode: (raw) => {
      if (raw === null) return [...defaults]
      if (raw === emptyToken) return []
      return splitAllowed(raw, allowed)
    },
  }
}

/**
 * Like {@link stringArrayCodec} but with no defaults: the param being absent
 * decodes to `null` ("unset"), which callers distinguish from `[]` ("explicitly
 * nothing"). Pass `allowed` to drop unrecognised values, or omit it to accept
 * any non-empty token.
 */
export function nullableStringArrayCodec<T extends string>(
  allowed?: readonly T[],
): UrlCodec<T[] | null> {
  const emptyToken = emptySelectionToken(allowed)
  return {
    encode: (value) => {
      if (value === null) return null
      return value.length === 0 ? emptyToken : [...value].sort().join(',')
    },
    decode: (raw) => {
      if (raw === null) return null
      if (raw === emptyToken) return []
      return splitAllowed(raw, allowed)
    },
  }
}
