import { useEffect, useState } from 'react'
import { formatDate as formatDateShared } from '@/lib/format'

export function formatDate(value: string | undefined): string {
  return formatDateShared(value)
}

// Not migrated to @/lib/format's formatNumber: this intentionally formats with the
// runtime's default locale (`toLocaleString(undefined, ...)`), while the shared
// helper pins 'en-CA'. Outputs differ for non-en-CA runtimes.
export function formatNullableNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return 'No value'
  return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

export function useJsonManifest<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!path) {
      setData(null)
      setError(null)
      return
    }

    const controller = new AbortController()
    const resolvedPath = path

    async function load() {
      try {
        setError(null)
        const response = await fetch(resolvedPath, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to fetch ${resolvedPath}: ${response.status}`)
        const contentType = response.headers.get('content-type') ?? ''
        const text = await response.text()
        if (!contentType.includes('json') && text.trimStart().startsWith('<')) {
          throw new Error(`Expected JSON from ${resolvedPath}, but received ${contentType || 'unknown content type'}`)
        }
        setData(JSON.parse(text) as T)
        setError(null)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setData(null)
        setError((err as Error).message || `Unable to load ${resolvedPath}`)
      }
    }

    void load()
    return () => controller.abort()
  }, [path])

  return { data, error }
}
