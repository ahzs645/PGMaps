import { useEffect, useMemo, useState } from 'react'

export interface PGMonitor {
  id: string
  name: string
  network: string
  latitude: number
  longitude: number
  parameters: string[]
}

// PG bounding box
const PG_BOUNDS = {
  minLat: 53.7,
  maxLat: 54.1,
  minLon: -123.1,
  maxLon: -122.4,
}

interface RawMonitor {
  id?: string | number
  sensor_index?: string | number
  name?: string
  network?: string
  latitude?: number | string
  longitude?: number | string
  lat?: number | string
  lon?: number | string
  parameters?: string[] | string
}

export function useAirMonitorOverlay() {
  const [allMonitors, setAllMonitors] = useState<PGMonitor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const res = await fetch('/data/monitors/all.json', { signal: controller.signal })
        if (!res.ok) throw new Error(`Failed to load monitors: ${res.status}`)
        const json = await res.json()
        if (!Array.isArray(json)) throw new Error('Invalid monitor data')

        const monitors: PGMonitor[] = []
        for (const row of json as RawMonitor[]) {
          const lat = typeof row.latitude === 'number' ? row.latitude : parseFloat(String(row.latitude ?? row.lat ?? ''))
          const lon = typeof row.longitude === 'number' ? row.longitude : parseFloat(String(row.longitude ?? row.lon ?? ''))
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
          if (lat < PG_BOUNDS.minLat || lat > PG_BOUNDS.maxLat) continue
          if (lon < PG_BOUNDS.minLon || lon > PG_BOUNDS.maxLon) continue

          const id = String(row.id ?? row.sensor_index ?? '')
          const name = (row.name ?? id).toString().trim()
          if (!id || !name) continue

          let params: string[] = []
          if (Array.isArray(row.parameters)) params = row.parameters.filter(Boolean)
          else if (typeof row.parameters === 'string') params = row.parameters.split(/[|,]/).map((s) => s.trim()).filter(Boolean)

          monitors.push({ id, name, network: row.network?.trim() ?? 'Unknown', latitude: lat, longitude: lon, parameters: params })
        }

        monitors.sort((a, b) => a.name.localeCompare(b.name))
        setAllMonitors(monitors)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [])

  const geojson = useMemo<GeoJSON.FeatureCollection<GeoJSON.Point>>(() => ({
    type: 'FeatureCollection',
    features: allMonitors.map((m) => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [m.longitude, m.latitude] },
      properties: { id: m.id, name: m.name, network: m.network },
    })),
  }), [allMonitors])

  return { monitors: allMonitors, geojson, loading, error }
}
