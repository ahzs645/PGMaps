import { useEffect, useState } from 'react'
import benchmarkUrl from '../treeBenchmarks.generated.json?url'
import rgbUrl from './rgb.generated.json?url'
import shapesUrl from './shapes.generated.json?url'
import provenanceUrl from './provenance.generated.json?url'
import { validateComparisonData, type ComparisonData } from './data'

export function useComparisonData(sourceSha?: string) {
  const [data, setData] = useState<ComparisonData | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!sourceSha) return
    let active = true
    setData(null)
    setError('')
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 45000)
    Promise.all(
      [benchmarkUrl, rgbUrl, shapesUrl, provenanceUrl].map(async (url) => {
        const response = await fetch(url, { signal: abort.signal })
        if (!response.ok) throw Error(`Comparison asset unavailable (${response.status})`)
        return response.json()
      }),
    )
      .then(([benchmark, rgb, shapes, provenance]) => {
        const next = { benchmark, rgb, shapes, provenance }
        validateComparisonData(next, sourceSha)
        if (active) setData(next)
      })
      .catch((e) => {
        if (active) setError(String(e))
      })
      .finally(() => clearTimeout(timer))
    return () => {
      active = false
      abort.abort()
      clearTimeout(timer)
    }
  }, [sourceSha, attempt])
  return { data, error, retry: () => setAttempt((n) => n + 1) }
}
