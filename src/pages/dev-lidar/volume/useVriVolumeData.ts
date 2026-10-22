import { useEffect, useState } from 'react'
import { checkVriVolumeData, type VriVolumeData } from './vri'
import dataUrl from './vri.generated.json?url'

export function useVriVolumeData(source?: string) {
  const [data, setData] = useState<VriVolumeData | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 30000)
    setData(null)
    setError('')
    fetch(dataUrl, { signal: abort.signal })
      .then((r) => {
        if (!r.ok) throw Error('VRI volume snapshot unavailable')
        return r.json()
      })
      .then((next: VriVolumeData) => {
        if (active) setData(checkVriVolumeData(next, source))
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
  }, [source, attempt])
  return { data, error, retry: () => setAttempt((n) => n + 1) }
}
