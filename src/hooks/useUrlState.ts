import { useCallback, useMemo } from 'react'
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

/** Comma-separated values restricted to an allowed set; defaults applied when the param is absent. */
export function stringArrayCodec<T extends string>(allowed: readonly T[], defaults: readonly T[]): UrlCodec<T[]> {
  const defaultKey = [...defaults].sort().join(',')
  return {
    encode: (value) => {
      const serialized = [...value].sort().join(',')
      return serialized === defaultKey ? null : serialized
    },
    decode: (raw) => {
      if (raw === null) return [...defaults]
      return raw.split(',').filter((item): item is T => (allowed as readonly string[]).includes(item))
    },
  }
}
