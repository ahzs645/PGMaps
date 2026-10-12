import { useEffect, useRef, useState } from 'react'
import type { GeoPoint, ViewshedResult, ViewshedSettings } from './model'
import type { Bounds } from '@/pages/dev-forestry/terrain'

export type ViewshedOptions = {
  enabled?: boolean
  horizon?: boolean
  detailSize?: number
  demZoom?: number
  observers?: GeoPoint[]
  bounds?: Bounds
}
type Job = { key: string; settings: ViewshedSettings; preview: boolean; retry: number } & Omit<
  ViewshedOptions,
  'enabled'
>

export function useViewshed(
  settings: ViewshedSettings,
  retry: number,
  dragging = false,
  options: ViewshedOptions = {},
) {
  const desired = useRef<Job | null>(null)
  const pump = useRef<() => void>(() => {})
  const enabled = options.enabled !== false
  const [started, setStarted] = useState(false)
  const key = JSON.stringify({
    settings,
    retry,
    preview: dragging,
    horizon: options.horizon ?? true,
    detailSize: options.detailSize ?? 192,
    demZoom: options.demZoom ?? 13,
    observers: options.observers,
    bounds: options.bounds,
  })
  const [state, setState] = useState<{
    key: string
    result: ViewshedResult | null
    message: string
    error: boolean
    cacheHit?: boolean
  }>({
    key: '',
    result: null,
    message: 'Loading terrain…',
    error: false,
  })

  useEffect(() => {
    if (!started) return
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
      instance.postMessage({ ...job, requestId: ++requestId })
    }
    instance.onmessage = (event) => {
      const data = event.data
      if (!active || data.requestId !== requestId) return
      if (data.type === 'progress') {
        setState((old) => ({
          ...old,
          message: `${data.phase === 'combine' ? 'Combining road views' : 'Loading terrain'} ${data.completed}/${data.total}…`,
          error: false,
        }))
        return
      }
      const job = active
      completedKey = job.key
      active = null
      if (data.type === 'result')
        setState({
          key: job.key,
          result: data.result,
          message: job.observers ? 'Combined viewshed ready' : job.preview ? 'Updating visibility…' : 'Viewshed ready',
          error: false,
          cacheHit: Boolean(data.cacheHit),
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
  }, [started])

  useEffect(() => {
    if (enabled && !started) setStarted(true)
    desired.current = enabled ? { key, ...JSON.parse(key) } : null
    pump.current()
  }, [key, dragging, enabled, started])

  const current = enabled && state.key === key && !dragging && !state.error
  return {
    ...state,
    message: state.error
      ? state.message
      : current
        ? state.message
        : state.message.startsWith('Loading terrain ') || state.message.startsWith('Combining road views ')
          ? state.message
          : 'Updating visibility…',
    // Keep the footprint displayed during updates; only current detailed results feed statistics and sun planning.
    overlayResult: enabled ? state.result : null,
    result: current ? state.result : null,
  }
}
