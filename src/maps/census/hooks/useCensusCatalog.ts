import { useEffect, useState } from 'react'
import type { CensusCatalog } from '../types'

const CATALOG_URL = '/data/census/variables/catalog.json'

let cachedCatalog: CensusCatalog | null = null

export function useCensusCatalog() {
  const [catalog, setCatalog] = useState<CensusCatalog | null>(cachedCatalog)
  const [loading, setLoading] = useState(!cachedCatalog)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cachedCatalog) return

    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch(CATALOG_URL, { signal: controller.signal })
        if (!response.ok) throw new Error(`Failed to load census catalog (${response.status})`)
        const data = await response.json() as CensusCatalog
        cachedCatalog = data
        setCatalog(data)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load census catalog')
      } finally {
        setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [])

  return { catalog, loading, error }
}
