import { useCallback, useEffect, useRef, useState } from 'react'
import type { CastorConfig, CastorProgress, CastorProject, CastorResult } from '@/features/forestry-castor/types'
import type { CastorRequest, CastorResponse } from './protocol'

export type CastorSimulationState =
  | { status: 'idle'; message?: string }
  | { status: 'running'; progress: CastorProgress }
  | { status: 'complete'; result: CastorResult; elapsedMs: number }
  | { status: 'error'; message: string }

export function useCastorSimulation() {
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const [state, setState] = useState<CastorSimulationState>({ status: 'idle' })

  const stop = useCallback(() => {
    generation.current += 1
    worker.current?.terminate()
    worker.current = null
  }, [])
  useEffect(() => () => stop(), [stop])

  const invalidate = useCallback(() => {
    stop()
    setState((previous) => ({
      status: 'idle',
      message: previous.status === 'idle' ? previous.message : 'Inputs changed. Run again to refresh the results.',
    }))
  }, [stop])
  const cancel = useCallback(() => {
    stop()
    setState({ status: 'idle', message: 'Scenario cancelled. Your inputs are ready to edit or run again.' })
  }, [stop])
  const restore = useCallback(
    (result: CastorResult) => {
      stop()
      setState({ status: 'complete', result, elapsedMs: 0 })
    },
    [stop],
  )
  const run = useCallback(
    (project: CastorProject, config: CastorConfig) => {
      stop()
      const id = generation.current
      setState({
        status: 'running',
        progress: { phase: 'simulation', completed: 0, total: config.periods, message: 'Preparing forest scenario…' },
      })
      try {
        const instance = new Worker(new URL('./castor.worker.ts', import.meta.url), { type: 'module' })
        worker.current = instance
        instance.onmessage = (event: MessageEvent<CastorResponse>) => {
          const response = event.data
          if (response.id !== generation.current || worker.current !== instance) return
          if (response.type === 'progress') {
            setState({ status: 'running', progress: response.progress })
            return
          }
          instance.terminate()
          worker.current = null
          setState(
            response.type === 'complete'
              ? { status: 'complete', result: response.result, elapsedMs: response.elapsedMs }
              : { status: 'error', message: response.message },
          )
        }
        instance.onerror = () => {
          if (worker.current !== instance || generation.current !== id) return
          instance.terminate()
          worker.current = null
          setState({
            status: 'error',
            message: 'The forest calculation worker could not complete. Check the scenario size, then try again.',
          })
        }
        instance.postMessage({ id, project, config } satisfies CastorRequest)
      } catch (cause: unknown) {
        stop()
        setState({ status: 'error', message: cause instanceof Error ? cause.message : 'The worker could not start.' })
      }
    },
    [stop],
  )
  return { state, run, cancel, invalidate, restore }
}
