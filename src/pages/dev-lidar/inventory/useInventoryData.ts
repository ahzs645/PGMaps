import { useEffect, useState } from 'react'
import url from './inventory.generated.json?url'
import type { InventoryData } from './types'
import { checkInventoryData } from './summary'
export function useInventoryData(source?: string) {
  const [data, setData] = useState<InventoryData | null>(null),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 45000)
    fetch(url, { signal: abort.signal })
      .then(async (r) => {
        if (!r.ok) throw Error(`Inventory unavailable (${r.status})`)
        return r.json()
      })
      .then((next) => {
        checkInventoryData(next, source)
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
  }, [source, attempt])
  return {
    data: data && (!source || data.source_sha256 === source) ? data : null,
    error,
    retry: () => {
      setError('')
      setAttempt((n) => n + 1)
    },
  }
}
