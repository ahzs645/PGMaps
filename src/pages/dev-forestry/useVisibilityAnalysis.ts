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
 * and running them at once only makes each slower. A run that is replaced
 * before it answers is settled as cancelled (`idle`) by `supersede`: its worker
 * is terminated and its id is no longer current, so nothing else ever would,
 * and a forward run left `running` held the road view and the batch tools.
 */
export function useVisibilityAnalysis() {
  const [state, setState] = useState<AnalysisState>(IDLE_STATE)
  const [reverseState, setReverseState] = useState<ReverseState>(IDLE_REVERSE)
  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  /** Settles the run in flight as cancelled; cleared once that run settles on its own. */
  const settleRef = useRef<(() => void) | null>(null)

  const disposeWorker = useCallback(() => {
    workerRef.current?.terminate()
    workerRef.current = null
  }, [])

  useEffect(() => disposeWorker, [disposeWorker])

  /** Settles whichever run is still in flight before another replaces it. */
  const supersede = useCallback(() => {
    const settle = settleRef.current
    settleRef.current = null
    settle?.()
  }, [])

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
        settleRef.current = null
        onFailure(`Could not start the analysis worker: ${error instanceof Error ? error.message : String(error)}`)
        return
      }
      workerRef.current = worker

      worker.onmessage = (event: MessageEvent<AnalysisWorkerResponse>) => {
        if (event.data.requestId !== requestIdRef.current) return
        if (event.data.type !== 'progress') settleRef.current = null
        onMessage(event.data)
      }

      worker.onerror = (event) => {
        if (requestId !== requestIdRef.current) return
        settleRef.current = null
        onFailure(event.message || 'The analysis worker stopped unexpectedly')
      }

      worker.postMessage({ type: request.type, requestId, input: request.input })
    },
    [disposeWorker],
  )

  const run = useCallback(
    (input: AnalysisInput) => {
      supersede()
      setReverseState(IDLE_REVERSE)
      setState({ status: 'running', progress: null, result: null, error: null })
      settleRef.current = () => setState((current) => (current.status === 'running' ? IDLE_STATE : current))
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
    [startWorker, supersede],
  )

  const runReverse = useCallback(
    (input: ReverseInput) => {
      supersede()
      setReverseState({ status: 'running', progress: null, result: null, error: null })
      settleRef.current = () => setReverseState((current) => (current.status === 'running' ? IDLE_REVERSE : current))
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
    [startWorker, supersede],
  )

  const cancel = useCallback(() => {
    settleRef.current = null
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
