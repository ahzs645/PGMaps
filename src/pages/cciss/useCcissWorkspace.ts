import { useEffect, useState } from 'react'
import { ccissTileId, type CcissLayerSelection } from './layers'
import { readCcissWorkspace, writeCcissWorkspace, type CcissAnalysisMode, type CcissTraceMethod } from './workspace'
import type { CcissRenderSource } from './mapSources'

/**
 * The page's shareable state: inspection point, layer selection, map source and open analysis.
 * Read once from the address bar; every change is written back with `replaceState`, on top of
 * the live URL so the camera keys `SyncMapUrl` writes survive.
 */
export function useCcissWorkspace() {
  const [initial] = useState(() => readCcissWorkspace(window.location.search))
  const [analysis, setAnalysis] = useState<CcissAnalysisMode>(initial.analysis)
  const [point, setPoint] = useState<[number, number]>(initial.point)
  const [selection, setSelection] = useState<CcissLayerSelection>(initial.selection)
  const [renderSource, setRenderSource] = useState<CcissRenderSource>(initial.renderSource)
  const [traceMethod, setTraceMethod] = useState<CcissTraceMethod>(initial.traceMethod)

  useEffect(() => {
    const url = new URL(window.location.href)
    url.search = writeCcissWorkspace(url.search, { point, selection, renderSource, traceMethod, analysis }).toString()
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url)
  }, [point, selection, renderSource, traceMethod, analysis])

  return {
    initial,
    analysis,
    setAnalysis,
    point,
    setPoint,
    selection,
    setSelection,
    renderSource,
    setRenderSource,
    traceMethod,
    setTraceMethod,
  }
}

/**
 * Whether CCISS's own tile server has this selection, checked only while its tiles are shown.
 * `available` is `null` until the TileJSON answers.
 */
export function usePublishedTiles(selection: CcissLayerSelection, enabled: boolean) {
  const tileId = ccissTileId(selection)
  const [status, setStatus] = useState<{ id: string; available: boolean } | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    fetch(`https://tileserver.thebeczone.ca/data/${tileId}.json`, { signal: controller.signal })
      .then((response) => setStatus({ id: tileId, available: response.ok }))
      .catch(() => {
        if (!controller.signal.aborted) setStatus({ id: tileId, available: false })
      })
    return () => controller.abort()
  }, [tileId, enabled, attempt])

  return {
    tileId,
    available: status?.id === tileId ? status.available : null,
    retry: () => {
      setStatus(null)
      setAttempt((value) => value + 1)
    },
  }
}
