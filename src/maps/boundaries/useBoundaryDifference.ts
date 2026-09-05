import { useEffect, useState } from 'react'
import type { DifferenceLayer, DifferenceResult } from './boundaryDifference'

type Request = [DifferenceLayer, DifferenceLayer] | null

/** Clipping never runs on the UI thread. Cancel obsolete work and discard stale results. */
export function useBoundaryDifference(input: Request) {
  // Labels and immutable feature identities define a job; opacity and map movement do not.
  const [previous, setPrevious] = useState(input)
  const unchanged =
    input === previous ||
    (!!input &&
      !!previous &&
      input.every(
        (layer, index) =>
          layer.id === previous[index].id &&
          layer.name === previous[index].name &&
          layer.features.length === previous[index].features.length &&
          layer.features.every((feature, featureIndex) => feature === previous[index].features[featureIndex]),
      ))
  const request = unchanged ? previous : input
  if (!unchanged) setPrevious(input)
  const [attempt, setAttempt] = useState(0)
  const [completed, setCompleted] = useState<{
    request: Request
    attempt: number
    result?: DifferenceResult
    error?: string
  } | null>(null)

  useEffect(() => {
    if (!request) {
      let cancelled = false
      queueMicrotask(() => {
        if (!cancelled) setCompleted(null)
      })
      return () => {
        cancelled = true
      }
    }
    let worker: Worker | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    const finish = (response: { result?: DifferenceResult; error?: string }) => {
      if (cancelled) return
      setCompleted({ request, attempt, ...response })
      worker?.terminate()
      clearTimeout(timeout)
    }
    try {
      worker = new Worker(new URL('./boundaryDifference.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<{ result?: DifferenceResult; error?: string }>) => finish(event.data)
      worker.onerror = () =>
        finish({ error: 'Unable to calculate this comparison. Try again or select simpler boundaries.' })
      timeout = setTimeout(
        () => finish({ error: 'Comparison took too long. Filter the layers to fewer or simpler boundaries.' }),
        30_000,
      )
      worker.postMessage(request)
    } catch {
      finish({ error: 'Unable to start the comparison. Try again.' })
    }
    return () => {
      cancelled = true
      worker?.terminate()
      clearTimeout(timeout)
    }
  }, [request, attempt])

  const current = completed?.request === request && completed?.attempt === attempt ? completed : null
  return {
    loading: !!request && !current,
    result: current?.result,
    error: current?.error,
    retry: () => setAttempt((value) => value + 1),
  }
}
