import { useEffect, useState } from 'react'

export function useSourceResource<T>(load: ((signal: AbortSignal) => Promise<T>) | null) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<{
    load: typeof load
    attempt: number
    data?: T
    error?: string
  } | null>(null)
  useEffect(() => {
    if (!load) return
    const controller = new AbortController()
    void load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ load, attempt, data })
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({ load, attempt, error: error instanceof Error ? error.message : 'Source unavailable.' })
      },
    )
    return () => controller.abort()
  }, [load, attempt])

  const current = load && result?.load === load && result.attempt === attempt ? result : null
  return {
    data: current?.data,
    error: current?.error,
    loading: Boolean(load && !current),
    retry: () => setAttempt((number) => number + 1),
  }
}
