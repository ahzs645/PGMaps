import { useCallback, useEffect, useRef, useState } from 'react'

import type { ReverseViewshedResult } from './reverseViewshed'
import type { AnalysisInput, AnalysisProgress, AnalysisResult, AnalysisWorkerResponse, ReverseInput } from './types'

export type AnalysisState = {
  status: 'idle' | 'running' | 'ready' | 'error'
  progress: AnalysisProgress | null
  result: AnalysisResult | null
  error: string | null
}

export type ReverseState = {
  status: 'idle' | 'running' | 'ready' | 'error'
  progress: AnalysisProgress | null
  result: ReverseViewshedResult | null
  error: string | null
}

const IDLE_STATE: AnalysisState = { status: 'idle', progress: null, result: null, error: null }
const IDLE_REVERSE: ReverseState = { status: 'idle', progress: null, result: null, error: null }

/**
 * Owns the analysis worker and the state of the run in flight.
 *
 * Results are tagged with a request id so a slow run that the user has already
 * replaced cannot overwrite a newer one, and cancelling terminates the worker
 * outright — there is no safe point to interrupt a sightline loop from inside.
 *
 * Forward and reverse runs share the worker and the id counter, so starting one
 * cancels the other: both are the same terrain fetch and the same arithmetic,
 * and running them at once only makes each slower.
 */
export function useVisibilityAnalysis() {
  const [state, setState] = useState<AnalysisState>(IDLE_STATE)
  const [reverseState, setReverseState] = useState<ReverseState>(IDLE_REVERSE)
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)

  const disposeWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  useEffect(() => disposeWorker, [disposeWorker])

  /**
   * Starts a worker for one request. `onMessage` sees only messages from the
   * newest request, so a stale run cannot write over a newer one's state.
   */
  const startWorker = useCallback(
    (
      request: { type: 'analyze'; input: AnalysisInput } | { type: 'reverse'; input: ReverseInput },
      onMessage: (message: AnalysisWorkerResponse) => void,
      onFailure: (message: string) => void,
    ) => {
      disposeWorker()
      requestIdRef.current += 1
      const requestId = requestIdRef.current

      let worker: Worker
      try {
        worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
      } catch (error) {
        onFailure(`Could not start the analysis worker: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      workerRef.current = worker

      worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
        if (event.data.requestId !== requestIdRef.current) return
        onMessage(event.data)
      }

      worker.onerror = (event) => {
        if (requestId !== requestIdRef.current) return
        onFailure(event.message || 'The analysis worker stopped unexpectedly')
      }

      worker.postMessage({ type: request.type, requestId, input: request.input })
    },
    [disposeWorker],
  )

  const run = useCallback(
    (input: AnalysisInput) => {
      setReverseState(IDLE_REVERSE)
      setState({ status: 'running', progress: null, result: null, error: null })
      startWorker(
        { type: 'analyze', input },
        (message) => {
          if (message.type === 'progress') {
            setState((current) => ({ ...current, status: 'running', progress: message.progress }))
          } else if (message.type === 'result') {
            setState({ status: 'ready', progress: null, result: message.result, error: null })
          } else if (message.type === 'error') {
            setState({ status: 'error', progress: null, result: null, error: message.message })
          }
        },
        (error) => setState({ status: 'error', progress: null, result: null, error }),
      )
    },
    [startWorker],
  )

  const runReverse = useCallback(
    (input: ReverseInput) => {
      setReverseState({ status: 'running', progress: null, result: null, error: null })
      startWorker(
        { type: 'reverse', input },
        (message) => {
          if (message.type === 'progress') {
            setReverseState((current) => ({ ...current, status: 'running', progress: message.progress }))
          } else if (message.type === 'reverse-result') {
            setReverseState({ status: 'ready', progress: null, result: message.result, error: null })
          } else if (message.type === 'error') {
            setReverseState({ status: 'error', progress: null, result: null, error: message.message })
          }
        },
        (error) => setReverseState({ status: 'error', progress: null, result: null, error }),
      )
    },
    [startWorker],
  )

  const cancel = useCallback(() => {
    requestIdRef.current += 1
    disposeWorker()
    setState(IDLE_STATE)
    setReverseState(IDLE_REVERSE)
  }, [disposeWorker])

  const reset = cancel

  return { state, reverseState, run, runReverse, cancel, reset } as const
}

export type AnalysisController = ReturnType<typeof useVisibilityAnalysis>
export type { AnalysisResult }
