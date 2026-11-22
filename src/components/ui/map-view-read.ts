import { useEffect, useRef, useState } from 'react'
import type { Map as MapLibreMap } from 'maplibre-gl'
import { useViewWindow, type LonLatBounds, type ViewWindow } from '@/components/ui/map-view-window'

/**
 * Features read by bounding box from a live service (a WFS, an ArcGIS layer), following the map
 * through `useViewWindow` (`docs/map-layer-loading.md`, the pattern table's last read row): the
 * window is 1.5 × the view, the next is asked for while the map still moves, the read a newer window
 * supersedes is aborted, and what was drawn stays drawn until the next answer arrives. A failed read
 * keeps the last answer and says so; only switching off, or the view going below `minZoom`, takes
 * the data away, and both are states the caller states.
 */
export type ViewReadState<T> = {
  /** The last answer, kept while the next is read. Null before the first, and while off. */
  data: T | null
  /** The window `data` was read for. */
  window: ViewWindow | null
  /** A read is under way. */
  loading: boolean
  /** The last read failed; `data` is the answer before it. */
  error: string | null
  /** The view is below `minZoom`: the layer is not drawn and nothing is read. */
  belowMinZoom: boolean
}

export type UseViewReadOptions<T> = {
  enabled: boolean
  /** Below this zoom nothing is read and `belowMinZoom` is set. */
  minZoom?: number
  /** The window's size over the view's (default 1.5). */
  overscan?: number
  /** The view's resolution level; a window is reused only at the same level. Defaults to the whole zoom. */
  level?: (view: LonLatBounds, zoom: number) => number | string
  /** Anything else the read depends on (a species, a year): a change reads the window again. */
  readKey?: string
  read: (window: ViewWindow, signal: AbortSignal) => Promise<T>
}

type Answer<T> = {
  data: T | null
  window: ViewWindow | null
  error: string | null
  /** The request (window and read key) this answer finished, read or failed. */
  answered: string | null
}

const OFF = { data: null, window: null, error: null, answered: null } as const

export function useViewWindowRead<T>(map: MapLibreMap | null, options: UseViewReadOptions<T>): ViewReadState<T> {
  const { enabled, minZoom, overscan, level, readKey = '' } = options
  const view = useViewWindow(map, { enabled, minZoom, overscan, level })
  const readRef = useRef(options.read)
  useEffect(() => {
    readRef.current = options.read
  })
  const [answer, setAnswer] = useState<Answer<T>>(OFF)
  const [owner, setOwner] = useState({ enabled, readKey })
  // Switching off, or a new read key, drops the old answer in the same render: it no longer answers
  // the question being asked.
  if (owner.enabled !== enabled || owner.readKey !== readKey) {
    setOwner({ enabled, readKey })
    setAnswer(OFF)
  }

  const window = view.window
  const request = enabled && window && !view.paused ? `${window.key}\n${readKey}` : null
  useEffect(() => {
    if (!request || !window) return
    const controller = new AbortController()
    readRef
      .current(window, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setAnswer({ data, window, error: null, answered: request })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setAnswer((current) => ({
          ...current,
          error: error instanceof Error ? error.message : 'The layer could not be read',
          answered: request,
        }))
      })
    return () => controller.abort()
    // The request names the window and the read key; the window object is the one it names.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request])

  return {
    data: answer.data,
    window: answer.window,
    error: answer.error,
    loading: request !== null && answer.answered !== request,
    belowMinZoom: enabled && view.paused,
  }
}
