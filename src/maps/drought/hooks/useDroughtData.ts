import { useEffect, useState } from 'react'
import type { DroughtFeatureCollection, DroughtManifest } from '../types'

const BASE_PATH = '/data/drought'

interface DroughtDataState {
  manifest: DroughtManifest | null
  collection: DroughtFeatureCollection | null
  loading: boolean
  error: string | null
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to load ${url}: ${response.status}`)
  }
  return response.json() as Promise<T>
}

export function useDroughtData(year: number) {
  const [state, setState] = useState<DroughtDataState>({
    manifest: null,
    collection: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      setState((current) => ({ ...current, loading: true, error: null }))
      try {
        const manifest = state.manifest ?? await fetchJson<DroughtManifest>(`${BASE_PATH}/manifest.json`)
        const yearInfo = manifest.years.find((item) => item.year === year)
        if (!yearInfo) {
          throw new Error(`No drought file is listed for ${year}`)
        }
        const collection = await fetchJson<DroughtFeatureCollection>(`${BASE_PATH}/${yearInfo.file}`)
        if (!cancelled) {
          setState({ manifest, collection, loading: false, error: null })
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            collection: null,
            loading: false,
            error: error instanceof Error ? error.message : 'Failed to load drought data',
          }))
        }
      }
    }

    load()

    return () => {
      cancelled = true
    }
    // state.manifest is intentionally reused as a cache between year changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year])

  return state
}
