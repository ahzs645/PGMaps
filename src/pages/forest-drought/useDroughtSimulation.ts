import { useCallback, useEffect, useRef, useState } from 'react'
import type { SimulationRequest, SimulationResponse } from './protocol'

type Complete = Extract<SimulationResponse, { type: 'complete' }>
export type SimulationState =
  | { status: 'idle'; message?: string }
  | { status: 'running'; fraction: number }
  | { status: 'complete'; data: Complete }
  | { status: 'error'; message: string }

export function useDroughtSimulation() {
  const worker = useRef<Worker | null>(null)
  const generation = useRef(0)
  const [state, setState] = useState<SimulationState>({ status: 'idle' })

  const stopWorker = useCallback(() => {
    generation.current += 1
    worker.current?.terminate()
    worker.current = null
  }, [])
  useEffect(() => () => stopWorker(), [stopWorker])

  const invalidate = useCallback(() => {
    stopWorker()
    setState((previous) => ({
      status: 'idle',
      message:
        previous.status === 'idle'
          ? previous.message
          : 'Inputs changed. Run the calculation again to refresh the results.',
    }))
  }, [stopWorker])
  const cancel = useCallback(() => {
    stopWorker()
    setState({ status: 'idle', message: 'Calculation cancelled. You can change the inputs or run it again.' })
  }, [stopWorker])
  const run = useCallback(
    (input: Omit<SimulationRequest, 'id'>) => {
      stopWorker()
      const id = generation.current
      setState({ status: 'running', fraction: 0 })
      try {
        const instance = new Worker(new URL('./drought.worker.ts', import.meta.url), { type: 'module' })
        worker.current = instance
        instance.onmessage = (event: MessageEvent<SimulationResponse>) => {
          const response = event.data
          if (response.id !== generation.current || worker.current !== instance) return
          if (response.type === 'progress') setState({ status: 'running', fraction: response.fraction })
          else {
            instance.terminate()
            worker.current = null
            setState(
              response.type === 'complete'
                ? { status: 'complete', data: response }
                : { status: 'error', message: response.message },
            )
          }
        }
        instance.onerror = () => {
          if (worker.current !== instance || generation.current !== id) return
          instance.terminate()
          worker.current = null
          setState({
            status: 'error',
            message: 'The browser could not start or complete the calculation worker. Reload this page and try again.',
          })
        }
        instance.postMessage({ ...input, id } satisfies SimulationRequest)
      } catch (cause: unknown) {
        stopWorker()
        setState({
          status: 'error',
          message: cause instanceof Error ? cause.message : 'The calculation worker could not start.',
        })
      }
    },
    [stopWorker],
  )

  return { state, run, cancel, invalidate }
}
