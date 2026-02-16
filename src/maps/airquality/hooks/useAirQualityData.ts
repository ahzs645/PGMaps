import { useEffect, useState } from 'react'
import type { AirMonitor } from '../types'

interface RawMonitor {
  id?: string | number
  sensor_index?: string | number
  name?: string
  monitor?: string
  network?: string
  latitude?: number | string
  longitude?: number | string
  lat?: number | string
  lon?: number | string
  city?: string
  province?: string
  state?: string
  status?: string
  parameters?: string[] | string
  source?: string
  dateObserved?: string
  date?: string
}

function normalizeParameters(value: RawMonitor['parameters']): string[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean)
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ['PM2.5']

    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        const parsedParams = parsed
          .map((item) => String(item).trim())
          .filter(Boolean)
        if (parsedParams.length > 0) return parsedParams
      }
    } catch {
      // Non-JSON string values are handled by delimiter split below.
    }

    const splitParams = trimmed
      .split(/[|,]/)
      .map((item) => item.trim().replace(/^["[\]]+|["[\]]+$/g, ''))
      .filter(Boolean)
    if (splitParams.length > 0) return splitParams
  }
  return ['PM2.5']
}

function normalizeMonitor(row: RawMonitor): AirMonitor | null {
  const id = String(row.id ?? row.sensor_index ?? '')
  const name = row.name?.trim() || row.monitor?.trim() || id
  const network = row.network?.trim() || 'Unknown'

  const latitude = typeof row.latitude === 'number'
    ? row.latitude
    : parseFloat(String(row.latitude ?? row.lat ?? ''))

  const longitude = typeof row.longitude === 'number'
    ? row.longitude
    : parseFloat(String(row.longitude ?? row.lon ?? ''))

  if (!id || !name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null
  }

  return {
    id,
    name,
    network,
    latitude,
    longitude,
    city: row.city || null,
    province: row.province || row.state || null,
    status: row.status || null,
    parameters: normalizeParameters(row.parameters),
    source: row.source || null,
    dateObserved: row.dateObserved || row.date || null
  }
}

export function useAirQualityData() {
  const [monitors, setMonitors] = useState<AirMonitor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch('/data/monitors/all.json', {
          signal: controller.signal
        })
        if (!response.ok) {
          throw new Error(`Failed to load monitors: ${response.status}`)
        }

        const json = await response.json()
        if (!Array.isArray(json)) {
          throw new Error('Invalid monitor dataset format')
        }

        const normalized = json
          .map((row) => normalizeMonitor(row as RawMonitor))
          .filter((row): row is AirMonitor => row !== null)

        normalized.sort((a, b) => a.name.localeCompare(b.name))
        setMonitors(normalized)
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        setError((err as Error).message || 'Unable to load monitor data')
      } finally {
        setLoading(false)
      }
    }

    loadData()

    return () => controller.abort()
  }, [])

  return { monitors, loading, error }
}
