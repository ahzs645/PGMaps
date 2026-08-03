import { fetchGzipText } from '@/lib/fetchJson'
import {
  computeWinterRangeOverlap,
  processWinterRangeSource,
  type ProcessedWinterRange,
  type WinterRangeCollection,
  type WinterRangeCoverage,
  type WinterRangeLegendEntry,
  type WinterRangeOverlap,
  type WinterRangePoint,
  type WinterRangeSource,
} from './warsWinterRangeCore'

export type WinterRangeWorkerRequest =
  | { type: 'load'; url: string; mode: 'inline' | 'blob' }
  | { type: 'overlap'; requestId: number; points: WinterRangePoint[] }

export type WinterRangeWorkerResponse =
  | {
      type: 'loaded'
      data: WinterRangeCollection | string
      legend: WinterRangeLegendEntry[]
      coverage: WinterRangeCoverage
    }
  | { type: 'overlap'; requestId: number; overlap: WinterRangeOverlap | null }
  | { type: 'error'; stage: 'load' | 'overlap'; requestId?: number; error: string }

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WinterRangeWorkerRequest>) => void) | null
  postMessage: (message: WinterRangeWorkerResponse) => void
}

interface LoadedWinterRange {
  decompressedText: string
  processed: ProcessedWinterRange
}

let loadedPromise: Promise<LoadedWinterRange> | null = null
let objectUrl: string | null = null

function isWinterRangeSource(value: unknown): value is WinterRangeSource {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; features?: unknown }
  return candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)
}

async function fetchWinterRange(url: string): Promise<{ decompressedText: string; source: WinterRangeSource }> {
  let text: string
  try {
    text = await fetchGzipText(url)
  } catch (error) {
    // fetchGzipText rejects the HTML SPA fallback; say why in this map's terms.
    if (error instanceof Error && error.message.includes('file missing')) {
      throw new Error('Dataset is not included in this build')
    }
    throw error
  }
  const parsed = JSON.parse(text) as unknown
  if (!isWinterRangeSource(parsed)) throw new Error('Winter range dataset is not valid GeoJSON')
  return { decompressedText: text, source: parsed }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Winter range worker failed'
}

workerScope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'load') {
    loadedPromise = fetchWinterRange(message.url).then(({ decompressedText, source }) => ({
      decompressedText,
      processed: processWinterRangeSource(source),
    }))
    loadedPromise
      .then(({ decompressedText, processed }) => {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = message.mode === 'blob'
          ? URL.createObjectURL(new Blob([decompressedText], { type: 'application/json' }))
          : null
        workerScope.postMessage({
          type: 'loaded',
          data: objectUrl ?? processed.data,
          legend: processed.legend,
          coverage: processed.coverage,
        })
      })
      .catch((error: unknown) => {
        workerScope.postMessage({ type: 'error', stage: 'load', error: errorMessage(error) })
      })
    return
  }

  const currentPromise = loadedPromise
  if (!currentPromise) {
    workerScope.postMessage({
      type: 'error',
      stage: 'overlap',
      requestId: message.requestId,
      error: 'Winter range data has not loaded',
    })
    return
  }
  currentPromise
    .then(({ processed }) => {
      const overlap = computeWinterRangeOverlap(message.points, processed.mooseFootprint)
      workerScope.postMessage({ type: 'overlap', requestId: message.requestId, overlap })
    })
    .catch((error: unknown) => {
      workerScope.postMessage({
        type: 'error',
        stage: 'overlap',
        requestId: message.requestId,
        error: errorMessage(error),
      })
    })
}
