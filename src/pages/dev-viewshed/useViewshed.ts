import { useEffect, useRef, useState } from 'react'
import type { ViewshedResult, ViewshedSettings } from './model'

type Job = { key: string; settings: ViewshedSettings; preview: boolean }

export function useViewshed(settings: ViewshedSettings, retry: number, dragging = false) {
  const desired = useRef<Job | null>(null)
  const pump = useRef<() => void>(() => {})
  const key = JSON.stringify({ settings, retry, preview: dragging })
  const [state, setState] = useState<{ key: string; result: ViewshedResult | null; message: string; error: boolean }>({
    key: '',
    result: null,
    message: 'Loading terrain…',
    error: false,
  })

  useEffect(() => {
    const instance = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' })
    let active: Job | null = null
    let completedKey = ''
    let requestId = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    // Coalesce movement while a calculation is running, then calculate the newest position.
    // Publishing completed previews avoids starving the overlay during a continuous drag.
    pump.current = () => {
      const job = desired.current
      if (active || !job || job.key === completedKey) return
      active = job
      instance.postMessage({ requestId: ++requestId, settings: job.settings, preview: job.preview })
    }
    instance.onmessage = (event) => {
      const data = event.data
      if (!active || data.requestId !== requestId) return
      if (data.type === 'progress') {
        setState((old) => ({ ...old, message: `Loading terrain ${data.completed}/${data.total}…`, error: false }))
        return
      }
      const job = active
      completedKey = job.key
      active = null
      if (data.type === 'result')
        setState({
          key: job.key,
          result: data.result,
          message: job.preview ? 'Updating visibility…' : 'Viewshed ready',
          error: false,
        })
      else setState((old) => ({ ...old, key: job.key, message: data.message, error: true }))
      timer = setTimeout(() => pump.current(), 60)
    }
    instance.onerror = () => {
      active = null
      setState((old) => ({
        ...old,
        message: 'The terrain worker could not start. Reload the page to try again.',
        error: true,
      }))
    }
    return () => {
      clearTimeout(timer)
      instance.terminate()
      pump.current = () => {}
    }
  }, [])

  useEffect(() => {
    desired.current = { key, settings: JSON.parse(key).settings, preview: dragging }
    pump.current()
  }, [key, dragging])

  const current = state.key === key && !dragging && !state.error
  return {
    ...state,
    message: state.error
      ? state.message
      : current
        ? state.message
        : state.message.startsWith('Loading terrain ')
          ? state.message
          : 'Updating visibility…',
    // Keep the footprint displayed during updates; only current detailed results feed statistics and sun planning.
    overlayResult: state.result,
    result: current ? state.result : null,
  }
}
