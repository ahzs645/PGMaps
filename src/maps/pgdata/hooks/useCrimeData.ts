import { useEffect, useState } from 'react'
import type { CrimeIncident } from '../types'

const API_BASE =
  'https://services2.arcgis.com/CnkB6jCzAsyli34z/arcgis/rest/services/PGCrime/FeatureServer/0/query'
const PAGE_SIZE = 2000

interface ArcGISFeature {
  properties: {
    OBJECTID: number
    File_Number: string | null
    Date: number | null
    CrimeType: string | null
    Time: string | null
    Address: string | null
    CommunityName: string | null
  }
  geometry: {
    coordinates: [number, number]
  }
}

function parseFeature(feature: ArcGISFeature): CrimeIncident | null {
  const props = feature.properties
  const coords = feature.geometry?.coordinates
  if (!coords || coords.length < 2) return null

  const dateMs = props.Date
  if (!dateMs) return null

  return {
    id: props.OBJECTID,
    fileNumber: props.File_Number ?? '',
    date: new Date(dateMs),
    crimeType: props.CrimeType ?? 'Unknown',
    time: props.Time ?? '',
    address: props.Address ?? '',
    community: props.CommunityName ?? 'Unknown',
    longitude: coords[0],
    latitude: coords[1],
  }
}

async function fetchPage(offset: number, signal: AbortSignal): Promise<ArcGISFeature[]> {
  const params = new URLSearchParams({
    where: '1=1',
    outFields: '*',
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
    outSR: '4326',
    f: 'geojson',
  })
  const response = await fetch(`${API_BASE}?${params}`, { signal })
  if (!response.ok) throw new Error(`Failed to fetch crime data: ${response.status}`)
  const json = await response.json()
  return json.features ?? []
}

async function fetchTotalCount(signal: AbortSignal): Promise<number> {
  const params = new URLSearchParams({
    where: '1=1',
    returnCountOnly: 'true',
    f: 'json',
  })
  const response = await fetch(`${API_BASE}?${params}`, { signal })
  if (!response.ok) throw new Error(`Failed to fetch crime count: ${response.status}`)
  const json = await response.json()
  return json.count ?? 0
}

export function useCrimeData(enabled = true) {
  const [incidents, setIncidents] = useState<CrimeIncident[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) {
      setLoading(false)
      setError(null)
      return
    }

    const controller = new AbortController()

    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const total = await fetchTotalCount(controller.signal)
        const pageCount = Math.ceil(total / PAGE_SIZE)

        const pages = await Promise.all(
          Array.from({ length: pageCount }, (_, i) =>
            fetchPage(i * PAGE_SIZE, controller.signal)
          )
        )

        const allFeatures = pages.flat()
        const parsed = allFeatures
          .map((feature) => parseFeature(feature as ArcGISFeature))
          .filter((incident): incident is CrimeIncident => incident !== null)

        parsed.sort((a, b) => b.date.getTime() - a.date.getTime())
        setIncidents(parsed)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load crime data')
      } finally {
        setLoading(false)
      }
    }

    loadData()
    return () => controller.abort()
  }, [enabled])

  return { incidents, loading, error }
}
