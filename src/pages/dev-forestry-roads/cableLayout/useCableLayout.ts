/**
 * Shares a D-line's support search between the sidebar section that runs it and the profile chart
 * that draws it. A result is shown only while the D-line, its rigging, its support settings and
 * the terrain are the ones it was found with (`layoutKey`).
 */
import { useMemo, useSyncExternalStore } from 'react'
import type { CableLine, TerrainSource } from '../types'
import type { CableLayoutResult, LayoutToAnalyse } from './cableLayout'
import { analyzeCableLayout, searchCableLayout } from './cableLayoutClient'
import { layoutOverlay, type CableLayoutOverlay } from './overlay'
import { DEFAULT_SUPPORT_LAYOUT, lineFrame, type LayoutRun } from './settings'

export interface CableLayoutEntry {
  key: string
  kind: 'search' | 'check'
  status: 'running' | 'done' | 'error'
  /** Share of spans checked. */
  progress: number
  spans: number
  result?: CableLayoutResult
  error?: string
  abort?: AbortController
}

const entries = new Map<string, CableLayoutEntry>()
const listeners = new Set<() => void>()
let version = 0
const emit = () => {
  version++
  for (const l of listeners) l()
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

const terrainIds = new WeakMap<object, number>()
let nextTerrain = 1
/** Everything a result depends on, as one string. */
export function layoutKey(line: CableLine, terrain: TerrainSource): string {
  let id = terrainIds.get(terrain)
  if (id === undefined) terrainIds.set(terrain, (id = nextTerrain++))
  // The name and the assumed sag do not change a layout; a saved layout is its result, not input.
  // A line still on the default settings has no `supportLayout` until its result is saved, so
  // both read as the defaults: otherwise saving the first result would change the key and hide it.
  const settings = { ...(line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT), saved: undefined }
  return JSON.stringify([id, { ...line, name: undefined, deflectionPercent: undefined, supportLayout: settings }])
}

export function useCableLayoutEntry(cableId: string | undefined): CableLayoutEntry | undefined {
  useSyncExternalStore(subscribe, () => version)
  return cableId ? entries.get(cableId) : undefined
}

function start(
  cableId: string,
  key: string,
  kind: CableLayoutEntry['kind'],
  call: (signal: AbortSignal, onProgress: (done: number, spans: number) => void) => Promise<CableLayoutResult>,
  onDone?: (result: CableLayoutResult) => void,
) {
  entries.get(cableId)?.abort?.abort()
  const abort = new AbortController()
  const entry: CableLayoutEntry = { key, kind, status: 'running', progress: 0, spans: 0, abort }
  entries.set(cableId, entry)
  emit()
  const mine = () => entries.get(cableId) === entry
  call(abort.signal, (done, spans) => {
    if (!mine()) return
    entries.set(cableId, { ...entry, progress: done, spans })
    emit()
  })
    .then((result) => {
      if (entries.get(cableId)?.abort !== abort) return
      entries.set(cableId, { key, kind, status: 'done', progress: 1, spans: result.spansTotal, result })
      emit()
      onDone?.(result)
    })
    .catch((error: unknown) => {
      if (entries.get(cableId)?.abort !== abort) return
      if (error instanceof DOMException && error.name === 'AbortError') entries.delete(cableId)
      else
        entries.set(cableId, {
          key,
          kind,
          status: 'error',
          progress: 0,
          spans: 0,
          error: error instanceof Error ? error.message : 'The support search failed.',
        })
      emit()
    })
}

/** Finds supports for the D-line; `onDone` gets the result so the caller can save the layout. */
export function startLayoutSearch(
  cableId: string,
  key: string,
  run: LayoutRun,
  onDone: (r: CableLayoutResult) => void,
) {
  start(cableId, key, 'search', (signal, onProgress) => searchCableLayout(run.input, { signal, onProgress }), onDone)
}

/** Re-checks a saved layout against the D-line as it is now. */
export function startLayoutCheck(cableId: string, key: string, run: LayoutRun, layout: LayoutToAnalyse) {
  start(cableId, key, 'check', (signal) => analyzeCableLayout(run.input, layout, { signal }))
}

export function cancelLayout(cableId: string) {
  const entry = entries.get(cableId)
  if (entry?.status !== 'running') return
  entry.abort?.abort()
  entries.delete(cableId)
  emit()
}

/** The overlay the D-line profile draws, or undefined for a line with neither support settings nor a result. */
export function useCableLayoutOverlay(
  line: CableLine | undefined,
  terrain: TerrainSource,
): CableLayoutOverlay | undefined {
  const entry = useCableLayoutEntry(line?.id)
  const key = line ? layoutKey(line, terrain) : ''
  return useMemo(() => {
    if (!line || line.sagModel !== 'mechanics') return undefined
    const frame = lineFrame(line)
    if (!frame) return undefined
    const current = entry && entry.status === 'done' && entry.key === key ? entry.result! : null
    if (!line.supportLayout && !current) return undefined
    return layoutOverlay(frame, line.supportLayout ?? DEFAULT_SUPPORT_LAYOUT, current)
  }, [line, entry, key])
}
