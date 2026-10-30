import { useCallback, useEffect, useRef, useState } from 'react'
import { clusterBoxes } from './geometry'
import { readLayer, type DetectedDataset } from './gdal'
import { densityFeaturesFromGeoJson } from './inputs'
import type { RunPieces } from './outputs'
import type { InputEntry } from './useAvastInputs'
import type { AvastWorkerRequest, AvastWorkerResponse } from './workerProtocol'
import type { Candidate, CandidateRaw, DensityFeature, GeometrySettings, VolumeLayerSummary } from './types'

export type RunStatus = 'idle' | 'reading' | 'running' | 'done' | 'cancelled' | 'error'

export type RunState = {
  status: RunStatus
  message: string
  done: number
  total: number
  error: string | null
  /** Settings and inputs the current results were computed from, to flag stale results. */
  signature: string | null
  currentKey: string | null
  layers: VolumeLayerSummary[]
  densityField: string
  lidarDensityField: string | null
  slopeAssessed: boolean
}

export type RunResults = {
  raws: Map<string, CandidateRaw>
  pieces: RunPieces
  avastFeatures: DensityFeature[]
  lidarFeatures: DensityFeature[]
}

const emptyPieces = (): RunPieces => ({
  avastPieces: [],
  avastSlopePieces: [],
  lidarPieces: [],
  lidarSlopePieces: [],
  commonPieces: [],
  slopeClasses: new Map(),
})

const INITIAL: RunState = {
  status: 'idle',
  message: '',
  done: 0,
  total: 0,
  error: null,
  signature: null,
  currentKey: null,
  layers: [],
  densityField: '',
  lidarDensityField: null,
  slopeAssessed: false,
}

/** Spatial filters around the candidates: one per cluster of nearby blocks, 250 m of margin. */
const READ_PADDING_METRES = 250

export function runSignature(candidates: Candidate[], entries: InputEntry[], settings: GeometrySettings) {
  return JSON.stringify({
    candidates: candidates.map((candidate) => candidate.key),
    inputs: entries
      .filter((entry) => entry.role !== 'candidates')
      .map((entry) => [entry.dataset.id, entry.layer, entry.densityFields]),
    settings,
  })
}

export function useAvastRun() {
  const [state, setState] = useState<RunState>(INITIAL)
  const results = useRef<RunResults>({ raws: new Map(), pieces: emptyPieces(), avastFeatures: [], lidarFeatures: [] })
  const [version, setVersion] = useState(0)
  const workerRef = useRef<Worker | null>(null)
  const runIdRef = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A timer rather than requestAnimationFrame: the browser pauses animation
  // frames in a background tab, and the run should keep reporting there.
  const bump = useCallback(() => {
    if (timer.current !== null) return
    timer.current = setTimeout(() => {
      timer.current = null
      setVersion((value) => value + 1)
    }, 120)
  }, [])
  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    setVersion((value) => value + 1)
  }, [])

  useEffect(
    () => () => {
      workerRef.current?.terminate()
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )

  const cancel = useCallback(() => {
    runIdRef.current += 1
    workerRef.current?.postMessage({ type: 'cancel' } satisfies AvastWorkerRequest)
    setState((current) =>
      current.status === 'reading' || current.status === 'running'
        ? { ...current, status: 'cancelled', message: 'Run cancelled.', currentKey: null }
        : current,
    )
  }, [])

  const run = useCallback(
    async (options: {
      candidates: Candidate[]
      entries: InputEntry[]
      datasets: DetectedDataset[]
      settings: GeometrySettings
    }) => {
      const { candidates, entries, datasets, settings } = options
      const runId = ++runIdRef.current
      results.current = { raws: new Map(), pieces: emptyPieces(), avastFeatures: [], lidarFeatures: [] }
      const avastEntries = entries.filter((entry) => entry.role === 'avast' && entry.status === 'ready' && entry.layer)
      const lidarEntries = entries.filter((entry) => entry.role === 'lidar' && entry.status === 'ready' && entry.layer)
      const signature = runSignature(candidates, entries, settings)
      setState({
        ...INITIAL,
        status: 'reading',
        message: 'Reading AVAST around the candidates…',
        total: candidates.length,
        signature,
        densityField: avastEntries[0]?.densityFields.densityField ?? '',
        lidarDensityField: lidarEntries[0]?.densityFields.densityField ?? null,
        slopeAssessed: settings.slopeSource !== 'none',
      })
      setVersion((value) => value + 1)
      try {
        const boxes = clusterBoxes(
          candidates.map((candidate) => candidate.bbox),
          READ_PADDING_METRES,
        )
        const layers: VolumeLayerSummary[] = []
        const read = async (entry: InputEntry, layerIndex: number, kind: 'avast' | 'lidar') => {
          const fields = entry.densityFields
          if (!fields.densityField) throw new Error(`Choose the m³/ha field for ${entry.dataset.label}.`)
          setState((current) => ({
            ...current,
            message: `Reading ${entry.dataset.label} · ${entry.layer} (${boxes.length} area${boxes.length === 1 ? '' : 's'})…`,
          }))
          const wanted = [fields.densityField, fields.slopeField, fields.operatingAreaField].filter(
            (field): field is string => !!field,
          )
          const collection = await readLayer(datasets, entry.dataset, entry.layer, {
            fields: [...new Set(wanted)],
            boxes,
          })
          const { features, nullDensityCount } = densityFeaturesFromGeoJson(collection, fields, layerIndex)
          layers.push({
            name: entry.dataset.label.replace(/\.gdb$/i, ''),
            kind,
            featureCount: features.length,
            nullDensityCount,
          })
          return features
        }
        const avast: DensityFeature[] = []
        for (const [index, entry] of avastEntries.entries()) avast.push(...(await read(entry, index, 'avast')))
        const lidar: DensityFeature[] = []
        for (const [index, entry] of lidarEntries.entries()) lidar.push(...(await read(entry, index, 'lidar')))
        if (runId !== runIdRef.current) return
        results.current.avastFeatures = avast
        results.current.lidarFeatures = lidar
        setState((current) => ({
          ...current,
          status: 'running',
          layers,
          message: `Intersecting ${candidates.length} candidates…`,
        }))
        bump()

        workerRef.current ??= new Worker(new URL('./avast.worker.ts', import.meta.url), { type: 'module' })
        const worker = workerRef.current
        await new Promise<void>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<AvastWorkerResponse>) => {
            const message = event.data
            if (message.runId !== runId) return
            if (message.type === 'candidate') {
              const { overlay } = message
              const store = results.current
              store.raws.set(message.key, overlay.raw)
              store.pieces.avastPieces.push(...overlay.avastPieces)
              store.pieces.avastSlopePieces.push(...overlay.avastSlopePieces)
              store.pieces.lidarPieces.push(...overlay.lidarPieces)
              store.pieces.lidarSlopePieces.push(...overlay.lidarSlopePieces)
              store.pieces.commonPieces.push(...overlay.commonPieces)
              if (overlay.slopeClasses) store.pieces.slopeClasses.set(message.key, overlay.slopeClasses)
              const next = candidates[message.index + 1]
              setState((current) => ({ ...current, done: message.index + 1, currentKey: next?.key ?? null }))
              bump()
            } else if (message.type === 'done') resolve()
            else if (message.type === 'cancelled') reject(new DOMException('Run cancelled', 'AbortError'))
            else if (message.type === 'error') reject(new Error(message.message))
          }
          worker.onerror = (event) => reject(new Error(event.message || 'The analysis worker failed.'))
          setState((current) => ({ ...current, currentKey: candidates[0]?.key ?? null }))
          worker.postMessage({ type: 'run', runId, candidates, avast, lidar, settings } satisfies AvastWorkerRequest)
        })
        if (runId !== runIdRef.current) return
        setState((current) => ({
          ...current,
          status: 'done',
          currentKey: null,
          message: `Processed ${candidates.length} candidates.`,
        }))
        flush()
      } catch (error) {
        if (runId !== runIdRef.current && !(error instanceof DOMException)) return
        if (error instanceof DOMException && error.name === 'AbortError') {
          setState((current) => ({ ...current, status: 'cancelled', currentKey: null, message: 'Run cancelled.' }))
        } else {
          setState((current) => ({
            ...current,
            status: 'error',
            currentKey: null,
            error: error instanceof Error ? error.message : String(error),
          }))
        }
        flush()
      }
    },
    [bump, flush],
  )

  return { state, results: results.current, version, run, cancel }
}
