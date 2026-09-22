import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchForestHistory, type ForestHistoryData } from './bcForestHistory'
import { forestHistoryBounds } from './regrowth'
import type { PolygonGeometry } from './visibility'
import type { Bounds } from './terrain'

const cache = new Map<string, { data: ForestHistoryData; time: number }>()
export function useForestHistory(active: boolean, road: number[][], polygons: PolygonGeometry[]) {
  const bounds = useMemo(() => forestHistoryBounds(road, polygons), [road, polygons])
  const key = bounds?.map((n) => n.toFixed(6)).join(',') ?? ''
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data: ForestHistoryData | null; loading: boolean }>({
    key: '',
    data: null,
    loading: false,
  })
  const retry = useCallback(() => {
    cache.delete(key)
    setAttempt((n) => n + 1)
  }, [key])
  useEffect(() => {
    if (!active || !key) return
    const cached = cache.get(key)
    if (cached && Date.now() - cached.time < 300000) {
      setState({ key, data: cached.data, loading: false })
      return
    }
    const abort = new AbortController()
    let disposed = false
    const timeout = setTimeout(() => abort.abort(), 20000)
    setState({ key, data: null, loading: true })
    fetchForestHistory(key.split(',').map(Number) as Bounds, abort.signal)
      .then((data) => {
        if (disposed) return
        if (!data.issues.length) {
          cache.set(key, { data, time: Date.now() })
          while (cache.size > 4) cache.delete(cache.keys().next().value!)
        }
        setState({ key, data, loading: false })
      })
      .catch((error: unknown) => {
        if (!disposed)
          setState({
            key,
            loading: false,
            data: {
              records: [],
              issues: [`Forest context unavailable: ${String(error)}`],
              bounds: key.split(',').map(Number) as Bounds,
              retrievedAt: new Date().toISOString(),
            },
          })
      })
      .finally(() => clearTimeout(timeout))
    return () => {
      disposed = true
      abort.abort()
      clearTimeout(timeout)
    }
  }, [active, key, attempt])
  return {
    data: active && state.key === key ? state.data : null,
    loading: active && !!key && (state.key !== key || state.loading || !state.data),
    retry,
  }
}
