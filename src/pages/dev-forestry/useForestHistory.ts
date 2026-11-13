import { useCallback, useEffect, useMemo, useState } from 'react'
import { fetchForestHistory, type ForestHistoryData } from './bcForestHistory'
import { forestHistoryAreas } from './regrowth'
import type { PolygonGeometry } from './visibility'
import type { Bounds } from './terrain'

export function useForestHistory(active: boolean, road: number[][], polygons: PolygonGeometry[], freeze = false) {
  const areas = useMemo(() => forestHistoryAreas(road, polygons), [road, polygons])
  // The cells themselves are the footprint: a nudged scene on the same cells keeps its records.
  const key = areas?.cells.length
    ? `${areas.cells.map((cell) => cell.map((n) => n.toFixed(6)).join(',')).join(';')}${areas.truncated ? '|truncated' : ''}`
    : ''
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
    const [cells, truncated] = key.split('|')
    void fetchForestHistory(
      cells.split(';').map((cell) => cell.split(',').map(Number) as Bounds),
      abort.signal,
      {
        retryFailed: attempt > 0,
        truncated: truncated === 'truncated',
        onUpdate: (data) => {
          if (!abort.signal.aborted) setState({ key, request, data, loading: !!data.pendingSources?.length })
        },
      },
    ).catch(() => {
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
