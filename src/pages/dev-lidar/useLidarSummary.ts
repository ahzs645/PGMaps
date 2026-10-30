import { useEffect, useState } from 'react'
import { useKeyedState } from './useKeyedState'
import { checkAnalysisSummary } from './data'
import type { AnalysisSummary } from './types'
export function useLidarSummary(analysisBase: string) {
  const [summary, setSummary] = useState<AnalysisSummary | null>(null)
  const [attempt, setAttempt] = useState(0)
  const requestKey = JSON.stringify([analysisBase, attempt])
  const [error, setError] = useKeyedState(requestKey, () => '')
  useEffect(() => {
    const controller = new AbortController()
    let timedOut = false
    let active = true
    const timeout = window.setTimeout(() => {
      timedOut = true
      controller.abort()
    }, 20_000)
    fetch(new URL('summary.json', analysisBase), { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw Error('The processed analysis is not available in this deployment.')
        const data = await r.json()
        checkAnalysisSummary(data)
        if (active) setSummary(data)
      })
      .catch((e) => {
        if (!active) return
        if (timedOut) setError('The analysis request timed out.')
        else if (!controller.signal.aborted) setError(String(e))
      })
      .finally(() => window.clearTimeout(timeout))
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timeout)
    }
  }, [analysisBase, attempt, setError])

  return { summary, error, retrySummary: () => setAttempt((n) => n + 1) }
}
