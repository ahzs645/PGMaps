import { useEffect, useRef, useState } from 'react'
import type {
  WinterRangeCollection,
  WinterRangeCoverage,
  WinterRangeLegendEntry,
  WinterRangeOverlap,
  WinterRangePoint,
} from './warsWinterRangeCore'
import type { WinterRangeWorkerRequest, WinterRangeWorkerResponse } from './warsWinterRange.worker'

export {
  buildFootprint,
  computeWinterRangeOverlap,
  getWinterRangeBounds,
  isInsideFootprint,
  isUsableWinterRangeGeometry,
  isWithinFootprintExtent,
} from './warsWinterRangeCore'
export type {
  WinterRangeCollection,
  WinterRangeCoverage,
  WinterRangeLegendEntry,
  WinterRangeOverlap,
  WinterRangePoint,
} from './warsWinterRangeCore'

/**
 * Legal Ungulate Winter Range (UWR) polygons, synced from bcdatamapper's BC
 * boundaries output — every designated range in the province. Anything derived
 * from the layer is still reported against the polygons' own footprint, since
 * the scraper can be pointed back at a clip window (see `REGION_BBOX`) and the
 * emitted metadata is what says which of the two you are looking at.
 */
export const WARS_WINTER_RANGE_PATH = '/data/boundaries/BCUWR/ungulate_winter_range.geojson.gz'

const EMPTY_COLLECTION: WinterRangeCollection = { type: 'FeatureCollection', features: [] }
const EMPTY_COVERAGE: WinterRangeCoverage = { clippedTo: null, window: null, isProvinceWide: false }

interface WinterRangeState {
  source: {
    data: WinterRangeCollection | null
    loading: boolean
    error: string | null
  }
  data: WinterRangeCollection
  legend: WinterRangeLegendEntry[]
  coverage: WinterRangeCoverage
  overlap: WinterRangeOverlap | null
  overlapLoading: boolean
  overlapError: string | null
}

function emptyState(loading: boolean): WinterRangeState {
  return {
    source: { data: null, loading, error: null },
    data: EMPTY_COLLECTION,
    legend: [],
    coverage: EMPTY_COVERAGE,
    overlap: null,
    overlapLoading: loading,
    overlapError: null,
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}

export function formatWinterRangeHectares(hectares: number): string {
  return Number.isFinite(hectares) && hectares > 0 ? `${Math.round(hectares).toLocaleString()} ha` : ''
}

/**
 * `.mapcn-tooltip` strips the MapLibre popup's own chrome, so the tooltip has to
 * bring its own popover card the way the boundary and network layers do —
 * returning bare markup renders as unstyled text floating on the basemap.
 */
export function winterRangeTooltipHtml(properties: Record<string, unknown>): string {
  const species = String(properties.speciesLabel ?? 'Ungulate')
  const label = String(properties.label ?? 'Ungulate winter range')
  const harvestCode = String(properties.harvestCode ?? '').trim()
  const size = formatWinterRangeHectares(Number(properties.hectares))
  return `
    <div class="min-w-44 max-w-72 rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg">
      <div class="font-semibold leading-5">${escapeHtml(species)} winter range</div>
      <div class="mt-1 text-muted-foreground">${escapeHtml(label)}</div>
      ${harvestCode ? `<div class="mt-1 text-muted-foreground">${escapeHtml(harvestCode.toLowerCase())}</div>` : ''}
      ${size ? `<div class="mt-2 font-semibold">${escapeHtml(size)}</div>` : ''}
    </div>
  `
}

export function useWarsWinterRange(enabled: boolean, points: WinterRangePoint[]) {
  const workerRef = useRef<Worker | null>(null)
  const latestOverlapRequestRef = useRef(0)
  const [state, setState] = useState<WinterRangeState>(() => emptyState(enabled))
  const [stateInputs, setStateInputs] = useState({ enabled, points })
  if (stateInputs.enabled !== enabled || stateInputs.points !== points) {
    const enabledChanged = stateInputs.enabled !== enabled
    setStateInputs({ enabled, points })
    setState((current) => (
      enabledChanged
        ? emptyState(enabled)
        : { ...current, overlap: null, overlapLoading: enabled, overlapError: null }
    ))
  }

  useEffect(() => {
    if (!enabled) return

    const worker = new Worker(new URL('./warsWinterRange.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (event: MessageEvent<WinterRangeWorkerResponse>) => {
      const message = event.data
      if (message.type === 'loaded') {
        setState((current) => ({
          ...current,
          source: { data: message.data, loading: false, error: null },
          data: message.data,
          legend: message.legend,
          coverage: message.coverage,
        }))
        return
      }
      if (message.type === 'overlap') {
        if (message.requestId !== latestOverlapRequestRef.current) return
        setState((current) => ({
          ...current,
          overlap: message.overlap,
          overlapLoading: false,
          overlapError: null,
        }))
        return
      }
      if (message.stage === 'overlap') {
        if (message.requestId !== latestOverlapRequestRef.current) return
        setState((current) => ({
          ...current,
          overlap: null,
          overlapLoading: false,
          overlapError: message.error,
        }))
        return
      }
      setState((current) => ({
        ...current,
        source: { data: null, loading: false, error: message.error },
        overlap: null,
        overlapLoading: false,
      }))
    }
    worker.onerror = (event) => {
      setState((current) => ({
        ...current,
        source: { data: null, loading: false, error: event.message || 'Winter range worker failed' },
        overlap: null,
        overlapLoading: false,
      }))
    }

    worker.postMessage({
      type: 'load',
      url: WARS_WINTER_RANGE_PATH,
    } satisfies WinterRangeWorkerRequest)

    return () => {
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
  }, [enabled])

  useEffect(() => {
    if (!enabled || !workerRef.current) return
    const requestId = latestOverlapRequestRef.current + 1
    latestOverlapRequestRef.current = requestId
    workerRef.current.postMessage({
      type: 'overlap',
      requestId,
      points,
    } satisfies WinterRangeWorkerRequest)
  }, [enabled, points])

  return {
    ...state,
    loading: state.source.loading || state.overlapLoading,
    error: state.source.error ?? state.overlapError,
  }
}

export type WarsWinterRangeState = ReturnType<typeof useWarsWinterRange>
