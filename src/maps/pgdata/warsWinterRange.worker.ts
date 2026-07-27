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
  | { type: 'load'; url: string }
  | { type: 'overlap'; requestId: number; points: WinterRangePoint[] }

export type WinterRangeWorkerResponse =
  | {
      type: 'loaded'
      data: WinterRangeCollection
      legend: WinterRangeLegendEntry[]
      coverage: WinterRangeCoverage
    }
  | { type: 'overlap'; requestId: number; overlap: WinterRangeOverlap | null }
  | { type: 'error'; stage: 'load' | 'overlap'; requestId?: number; error: string }

type DecompressionStreamConstructor = new (format: 'gzip') => TransformStream<Uint8Array, Uint8Array>

const workerScope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<WinterRangeWorkerRequest>) => void) | null
  postMessage: (message: WinterRangeWorkerResponse) => void
}

let processedPromise: Promise<ProcessedWinterRange> | null = null

function isWinterRangeSource(value: unknown): value is WinterRangeSource {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; features?: unknown }
  return candidate.type === 'FeatureCollection' && Array.isArray(candidate.features)
}

async function fetchWinterRange(url: string): Promise<WinterRangeSource> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`)
  const contentType = response.headers.get('content-type') ?? ''
  const bytes = new Uint8Array(await response.arrayBuffer())
  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
  let text: string
  if (isGzip) {
    const DecompressionStreamCtor = (
      globalThis as typeof globalThis & { DecompressionStream?: DecompressionStreamConstructor }
    ).DecompressionStream
    if (!DecompressionStreamCtor) throw new Error('This browser cannot decompress gzip map data')
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStreamCtor('gzip'))
    text = await new Response(stream).text()
  } else {
    // Some hosts, including Vite's dev server, transparently decompress `.gz`.
    text = new TextDecoder().decode(bytes)
  }
  if (!contentType.includes('json') && text.trimStart().startsWith('<')) {
    throw new Error('Dataset is not included in this build')
  }
  const parsed = JSON.parse(text) as unknown
  if (!isWinterRangeSource(parsed)) throw new Error('Winter range dataset is not valid GeoJSON')
  return parsed
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Winter range worker failed'
}

workerScope.onmessage = (event) => {
  const message = event.data
  if (message.type === 'load') {
    processedPromise = fetchWinterRange(message.url).then(processWinterRangeSource)
    processedPromise
      .then(({ data, legend, coverage }) => {
        workerScope.postMessage({ type: 'loaded', data, legend, coverage })
      })
      .catch((error: unknown) => {
        workerScope.postMessage({ type: 'error', stage: 'load', error: errorMessage(error) })
      })
    return
  }

  const currentPromise = processedPromise
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
    .then(({ mooseFootprint }) => {
      const overlap = computeWinterRangeOverlap(message.points, mooseFootprint)
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
