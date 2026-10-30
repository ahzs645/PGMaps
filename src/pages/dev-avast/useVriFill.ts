import { useCallback, useEffect, useRef, useState } from 'react'
import { clusterBoxes } from './geometry'
import { vriFeaturesFromGeoJson, vriQueryUrl, VRI_PAGE_SIZE, type VriFeature, type VriPiece } from './vriFill'
import type { AvastWorkerRequest, AvastWorkerResponse } from './workerProtocol'
import type { BBox, Candidate, Piece } from './types'

export type VriFillState = {
  status: 'idle' | 'fetching' | 'intersecting' | 'done' | 'error'
  message: string
  error: string | null
  done: number
  total: number
  featureCount: number
  projectedDate: string | null
  /** The AVAST run this fill was computed against. */
  runSignature: string | null
}

const INITIAL: VriFillState = {
  status: 'idle',
  message: '',
  error: null,
  done: 0,
  total: 0,
  featureCount: 0,
  projectedDate: null,
  runSignature: null,
}

/** Blocks closer than this share one VRI request. */
const CLUSTER_PADDING_METRES = 30
const CONCURRENCY = 3

async function fetchBox(box: BBox, signal: AbortSignal): Promise<VriFeature[]> {
  const out: VriFeature[] = []
  for (let start = 0; ; start += VRI_PAGE_SIZE) {
    const response = await fetch(vriQueryUrl(box, start), { signal })
    if (!response.ok) throw new Error(`DataBC VRI returned ${response.status}`)
    const page = (await response.json()) as GeoJSON.FeatureCollection & { numberMatched?: number }
    out.push(...vriFeaturesFromGeoJson(page))
    if (page.features.length < VRI_PAGE_SIZE) return out
  }
}

export function useVriFill() {
  const [state, setState] = useState<VriFillState>(INITIAL)
  const [version, setVersion] = useState(0)
  const store = useRef<{ pieces: VriPiece[]; byFid: Map<number, VriFeature> }>({ pieces: [], byFid: new Map() })
  const workerRef = useRef<Worker | null>(null)
  const controllerRef = useRef<AbortController | null>(null)
  const runIdRef = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const bump = useCallback(() => {
    if (timer.current !== null) return
    timer.current = setTimeout(() => {
      timer.current = null
      setVersion((value) => value + 1)
    }, 150)
  }, [])

  useEffect(
    () => () => {
      controllerRef.current?.abort()
      workerRef.current?.terminate()
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    runIdRef.current += 1
    store.current = { pieces: [], byFid: new Map() }
    setState(INITIAL)
    setVersion((value) => value + 1)
  }, [])

  const run = useCallback(
    async (candidates: Candidate[], avastPieces: Piece[], runSignature: string, minPieceHa: number) => {
      controllerRef.current?.abort()
      const controller = new AbortController()
      controllerRef.current = controller
      const runId = ++runIdRef.current
      store.current = { pieces: [], byFid: new Map() }
      const boxes = clusterBoxes(
        candidates.map((candidate) => candidate.bbox),
        CLUSTER_PADDING_METRES,
      )
      setState({
        ...INITIAL,
        status: 'fetching',
        runSignature,
        total: boxes.length,
        message: `Fetching VRI from DataBC for ${boxes.length} area${boxes.length === 1 ? '' : 's'}…`,
      })
      try {
        const byFid = new Map<number, VriFeature>()
        let next = 0
        let fetched = 0
        await Promise.all(
          Array.from({ length: Math.min(CONCURRENCY, boxes.length) }, async () => {
            while (next < boxes.length) {
              const box = boxes[next++]
              for (const feature of await fetchBox(box, controller.signal)) byFid.set(feature.fid, feature)
              fetched += 1
              if (runId === runIdRef.current)
                setState((current) => ({ ...current, done: fetched, featureCount: byFid.size }))
            }
          }),
        )
        if (runId !== runIdRef.current) return
        const features = [...byFid.values()]
        const dates = [...new Set(features.map((feature) => feature.projectedDate).filter(Boolean))].sort()
        store.current.byFid = byFid
        setState((current) => ({
          ...current,
          status: 'intersecting',
          done: 0,
          total: candidates.length,
          featureCount: features.length,
          projectedDate: dates[dates.length - 1] ?? null,
          message: `Intersecting ${features.length.toLocaleString('en-CA')} VRI polygons with the blocks…`,
        }))
        workerRef.current ??= new Worker(new URL('./avast.worker.ts', import.meta.url), { type: 'module' })
        const worker = workerRef.current
        await new Promise<void>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<AvastWorkerResponse>) => {
            const message = event.data
            if (message.runId !== runId) return
            if (message.type === 'vri-candidate') {
              store.current.pieces.push(...message.pieces)
              setState((current) => ({ ...current, done: message.index + 1 }))
              bump()
            } else if (message.type === 'done') resolve()
            else if (message.type === 'cancelled') reject(new DOMException('Cancelled', 'AbortError'))
            else if (message.type === 'error') reject(new Error(message.message))
          }
          worker.onerror = (event) => reject(new Error(event.message || 'The VRI worker failed.'))
          controller.signal.addEventListener('abort', () =>
            worker.postMessage({ type: 'cancel' } satisfies AvastWorkerRequest),
          )
          worker.postMessage({
            type: 'vri',
            runId,
            candidates,
            avastPieces,
            vri: features,
            minPieceHa,
          } satisfies AvastWorkerRequest)
        })
        if (runId !== runIdRef.current) return
        setState((current) => ({ ...current, status: 'done', message: '' }))
        setVersion((value) => value + 1)
      } catch (error) {
        if (runId !== runIdRef.current) return
        const cancelled = error instanceof DOMException && error.name === 'AbortError'
        setState((current) => ({
          ...current,
          status: cancelled ? 'idle' : 'error',
          error: cancelled ? null : error instanceof Error ? error.message : String(error),
        }))
        setVersion((value) => value + 1)
      }
    },
    [bump],
  )

  return { state, version, pieces: store.current.pieces, byFid: store.current.byFid, run, reset }
}
