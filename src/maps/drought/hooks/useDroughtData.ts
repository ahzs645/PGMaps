import { useEffect, useState } from 'react'
import type { DroughtFeatureCollection, DroughtManifest, DroughtTimeSeries, DroughtTimeSeriesRecord, DroughtTimeSeriesYearInfo } from '../types'

const BASE_PATH = '/data/drought'

interface DroughtDataState {
  manifest: DroughtManifest | null
  collection: DroughtFeatureCollection | null
  records: DroughtTimeSeriesRecord[]
  yearInfo: DroughtTimeSeriesYearInfo | null
  timeseries: DroughtTimeSeries | null
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
    records: [],
    yearInfo: null,
    timeseries: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false

    async function load() {
      setState((current) => ({ ...current, loading: true, error: null }))
      try {
        const manifest = state.manifest ?? await fetchJson<DroughtManifest>(`${BASE_PATH}/manifest.json`)
        const basinFile = manifest.canonical?.basinFile ?? 'basins.geojson'
        const timeseriesFile = manifest.canonical?.timeseriesFile ?? 'timeseries.json'
        const collection = state.collection ?? await fetchJson<DroughtFeatureCollection>(`${BASE_PATH}/${basinFile}`)
        const timeseries = state.timeseries ?? await fetchJson<DroughtTimeSeries>(`${BASE_PATH}/${timeseriesFile}`)
        const yearInfo = timeseries.years.find((item) => item.year === year)
        if (!yearInfo) {
          throw new Error(`No drought records are listed for ${year}`)
        }
        const records = timeseries.records.filter((record) => record.year === year)
        if (!cancelled) {
          setState({ manifest, collection, timeseries, records, yearInfo, loading: false, error: null })
        }
      } catch (error) {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            records: [],
            yearInfo: null,
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
