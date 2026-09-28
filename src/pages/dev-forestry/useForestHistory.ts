import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchForestHistory, type ForestHistoryData } from './bcForestHistory'
import { forestHistoryBounds } from './regrowth'
import type { PolygonGeometry } from './visibility'
import type { Bounds } from './terrain'

export function useForestHistory(active: boolean, road: number[][], polygons: PolygonGeometry[], freeze = false) {
  const bounds = useMemo(() => forestHistoryBounds(road, polygons), [road, polygons])
  const key = bounds?.map((n) => n.toFixed(6)).join(',') ?? ''
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data: ForestHistoryData | null; loading: boolean }>({ key: '', data: null, loading: false })
  const retry = useCallback(() => setAttempt(n => n + 1), [])
  useEffect(() => {
    if (!active || !key) return
    const abort = new AbortController()
    setState(current => ({ key, data: current.key === key ? current.data : null, loading: true }))
    void fetchForestHistory(key.split(',').map(Number) as Bounds, abort.signal, {
      retryFailed: attempt > 0,
      onUpdate: data => {
        if (!abort.signal.aborted) setState({ key, data, loading: !!data.pendingSources?.length })
      },
    }).catch(() => { /* Cancellation is the only rejection; source errors are reported in data. */ })
    return () => abort.abort()
  }, [active, key, attempt])
  // A response arriving during playback is held until pause. Never carry a
  // snapshot across a different query footprint, even if playback is active.
  const [displayed, setDisplayed] = useState(state)
  if (displayed !== state && (!freeze || displayed.key !== key)) setDisplayed(state)
  return {
    data: active && displayed.key === key ? displayed.data : null,
    loading: active && !!key && (state.key !== key || state.loading || !state.data),
    pendingUpdate: active && displayed.data !== state.data,
    retry,
  }
}
