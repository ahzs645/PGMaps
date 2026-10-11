import { useEffect, useRef, useState } from 'react'
import type { ViewshedInput, ViewshedResult, WorkerResponse } from './analysis'

type RunState = { input: ViewshedInput; result?: ViewshedResult; error?: string; progress?: string }
export function useViewshed(input: ViewshedInput, revision: number) {
  const worker = useRef<Worker | null>(null)
  const sequence = useRef(0)
  const [state, setState] = useState<RunState | null>(null)
  useEffect(() => {
    try { worker.current = new Worker(new URL('./viewshed.worker.ts', import.meta.url), { type: 'module' }) }
    catch (error) { setState({ input, error: error instanceof Error ? error.message : 'Terrain worker could not start.' }) }
    return () => { worker.current?.terminate(); worker.current = null }
    // The worker lives for the page lifetime; requests are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const instance = worker.current
    if (!instance) return
    const id = ++sequence.current
    instance.postMessage({ type: 'cancel' })
    setState({ input, progress: 'Updating viewshed…' })
    const onMessage = ({ data }: MessageEvent<WorkerResponse>) => {
      if (data.id !== id) return
      if (data.type === 'result') setState({ input, result: data.result })
      else if (data.type === 'error') setState({ input, error: data.message })
      else setState({ input, progress: data.message })
    }
    const onError = () => setState({ input, error: 'Terrain worker failed. Reload the page to retry.' })
    instance.addEventListener('message', onMessage)
    instance.addEventListener('error', onError)
    // Coalesce fast slider/drag events. An existing run is cancelled immediately.
    const timer = setTimeout(() => instance.postMessage({ type: 'run', id, input }), 120)
    return () => {
      clearTimeout(timer)
      instance.removeEventListener('message', onMessage)
      instance.removeEventListener('error', onError)
      instance.postMessage({ type: 'cancel' })
    }
  }, [input, revision])
  // Hide old coverage as soon as its observer or settings change.
  const current = state?.input === input ? state : null
  return { result: current?.result ?? null, error: current?.error ?? null, progress: current?.progress ?? 'Updating viewshed…', loading: !current?.result && !current?.error }
}
