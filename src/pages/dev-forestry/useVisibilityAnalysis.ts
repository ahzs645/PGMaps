import { useCallback, useEffect, useRef, useState } from 'react'

import type { AnalysisInput, AnalysisProgress, AnalysisResult, AnalysisWorkerResponse } from './types'

export type AnalysisState = {
  status: 'idle' | 'running' | 'ready' | 'error'
  progress: AnalysisProgress | null
  result: AnalysisResult | null
  error: string | null
}

const IDLE_STATE: AnalysisState = { status: 'idle', progress: null, result: null, error: null }

/**
 * Owns the analysis worker and the state of the run in flight.
 *
 * Results are tagged with a request id so a slow run that the user has already
 * replaced cannot overwrite a newer one, and cancelling terminates the worker
 * outright — there is no safe point to interrupt a sightline loop from inside.
 */
export function useVisibilityAnalysis() {
  const [state, setState] = useState<AnalysisState>(IDLE_STATE)
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)

  const disposeWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  useEffect(() => disposeWorker, [disposeWorker])

  const run = useCallback(
    (input: AnalysisInput) => {
      disposeWorker()
      requestIdRef.current += 1
      const requestId = requestIdRef.current

      let worker: Worker
      try {
        worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
      } catch (error) {
        setState({
          status: 'error',
          progress: null,
          result: null,
          error: `Could not start the analysis worker: ${error instanceof Error ? error.message : String(error)}`,
        })
        return
      }
      workerRef.current = worker

      worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
        const message = event.data
        if (message.requestId !== requestIdRef.current) return

        if (message.type === 'progress') {
          setState((current) => ({ ...current, status: 'running', progress: message.progress }))
          return
        }
        if (message.type === 'result') {
          setState({ status: 'ready', progress: null, result: message.result, error: null })
          return
        }
        setState({ status: 'error', progress: null, result: null, error: message.message })
      }

      worker.onerror = (event) => {
        if (requestId !== requestIdRef.current) return
        setState({
          status: 'error',
          progress: null,
          result: null,
          error: event.message || 'The analysis worker stopped unexpectedly',
        })
      }

      setState({ status: 'running', progress: null, result: null, error: null })
      worker.postMessage({ type: 'analyze', requestId, input })
    },
    [disposeWorker],
  )

  const cancel = useCallback(() => {
    requestIdRef.current += 1
    disposeWorker()
    setState(IDLE_STATE)
  }, [disposeWorker])

  const reset = useCallback(() => {
    requestIdRef.current += 1
    disposeWorker()
    setState(IDLE_STATE)
  }, [disposeWorker])

  return { state, run, cancel, reset } as const
}

export type AnalysisController = ReturnType<typeof useVisibilityAnalysis>
export type { AnalysisResult }
