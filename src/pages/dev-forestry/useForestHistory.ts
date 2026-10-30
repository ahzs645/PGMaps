import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchForestHistory, type ForestHistoryData } from './bcForestHistory'
import { forestHistoryBounds } from './regrowth'
import type { PolygonGeometry } from './visibility'
import type { Bounds } from './terrain'

export function useForestHistory(active: boolean, road: number[][], polygons: PolygonGeometry[], freeze = false) {
  const bounds = useMemo(() => forestHistoryBounds(road, polygons), [road, polygons])
  const key = bounds?.map((n) => n.toFixed(6)).join(',') ?? ''
  const [attempt, setAttempt] = useState(0)
  const request = useMemo(() => (active && key ? { key, attempt } : null), [active, key, attempt])
  const [state, setState] = useState<{
    key: string
    request: typeof request
    data: ForestHistoryData | null
    loading: boolean
  }>({
    key: '',
    request: null,
    data: null,
    loading: false,
  })
  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  useEffect(() => {
    if (!request) return
    const { key, attempt } = request
    const abort = new AbortController()
    void fetchForestHistory(key.split(',').map(Number) as Bounds, abort.signal, {
      retryFailed: attempt > 0,
      onUpdate: (data) => {
        if (!abort.signal.aborted) setState({ key, request, data, loading: !!data.pendingSources?.length })
      },
    }).catch(() => {
      /* Cancellation is the only rejection; source errors are reported in data. */
    })
    return () => abort.abort()
  }, [request])
  // A response arriving during playback is held until pause. Never carry a
  // snapshot across a different query footprint, even if playback is active.
  const [displayed, setDisplayed] = useState(state)
  if (displayed !== state && (!freeze || displayed.key !== key)) setDisplayed(state)
  return {
    data: active && displayed.key === key ? displayed.data : null,
    loading: request !== null && (state.request !== request || state.loading || !state.data),
    pendingUpdate: active && displayed.data !== state.data,
    retry,
  }
}
