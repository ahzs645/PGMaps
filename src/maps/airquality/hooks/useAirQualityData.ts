import { useEffect, useState } from 'react'
import type { AirMonitor } from '../types'

interface RawMonitor {
  id?: string | number
  site_id?: string | number
  siteId?: string | number
  sensor_index?: string | number
  name?: string
  site_name?: string
  monitor?: string
  network?: string
  network_id?: string
  monitor_type?: string
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
  date_last_obs?: string
  date_last_observed?: string
  date?: string
  pm25Recent?: number | string | null
  pm25_recent?: number | string | null
  pm25_10min?: number | string | null
  pm25_10min_r?: number | string | null
  pm25_recent_r?: number | string | null
  pm25_1hr?: number | string | null
  pm25_1hr_r?: number | string | null
  pm25_3hr?: number | string | null
  pm25_3hr_r?: number | string | null
  pm25_24hr?: number | string | null
  pm25_24hr_r?: number | string | null
  val?: number | string | null
  val_1hr?: number | string | null
  val_24hr?: number | string | null
  temperature?: number | string | null
  rh?: number | string | null
  pressure?: number | string | null
  prov_terr?: string
  metadata?: {
    temperature?: number | string | null
    humidity?: number | string | null
    pressure?: number | string | null
    [key: string]: number | string | null | undefined
  } | null
}

interface GeoJsonMonitorFeature {
  type?: string
  properties?: RawMonitor | null
  geometry?: {
    type?: string
    coordinates?: Array<number | string>
  } | null
}

interface UseAirQualityDataOptions {
  enabled?: boolean
  aqmapCompatible?: boolean
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
  const id = String(row.id ?? row.site_id ?? row.siteId ?? row.sensor_index ?? '')
  const name = row.name?.trim() || row.site_name?.trim() || row.monitor?.trim() || id
  const network = normalizeNetworkSlug(row.network?.trim() || row.network_id?.trim() || row.monitor_type?.trim() || 'Unknown')

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
    province: row.province || row.state || row.prov_terr || null,
    status: row.status || null,
    parameters: normalizeParameters(row.parameters),
    source: row.source || null,
    dateObserved: row.dateObserved || row.date_last_obs || row.date_last_observed || row.date || null,
    pm25Recent: normalizeNumericValue(row.pm25Recent ?? row.pm25_10min ?? row.pm25_recent),
    pm25RecentRaw: normalizeNumericValue(row.pm25_10min_r ?? row.pm25_recent_r),
    pm25OneHour: normalizeNumericValue(row.pm25_1hr),
    pm25OneHourRaw: normalizeNumericValue(row.pm25_1hr_r),
    pm25ThreeHour: normalizeNumericValue(row.pm25_3hr),
    pm25ThreeHourRaw: normalizeNumericValue(row.pm25_3hr_r),
    pm25TwentyFourHour: normalizeNumericValue(row.pm25_24hr),
    pm25TwentyFourHourRaw: normalizeNumericValue(row.pm25_24hr_r),
    aqhiValue: normalizeNumericValue(row.val),
    aqhiOneHourValue: normalizeNumericValue(row.val_1hr),
    aqhiTwentyFourHourValue: normalizeNumericValue(row.val_24hr),
    metadata: row.metadata
      ? {
          ...row.metadata,
          temperature: normalizeNumericValue(row.metadata.temperature),
          humidity: normalizeNumericValue(row.metadata.humidity),
          pressure: normalizeNumericValue(row.metadata.pressure)
        }
      : {
          temperature: normalizeNumericValue(row.temperature),
          humidity: normalizeNumericValue(row.rh),
          pressure: normalizeNumericValue(row.pressure)
        }
  }
}

function normalizeNumericValue(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

function parseCsv(text: string): RawMonitor[] {
  const rows: string[][] = []
  let row: string[] = []
  let value = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && inQuotes && next === '"') {
      value += '"'
      index += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      row.push(value)
      value = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') index += 1
      row.push(value)
      if (row.some((cell) => cell.length > 0)) rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }

  if (value || row.length > 0) {
    row.push(value)
    if (row.some((cell) => cell.length > 0)) rows.push(row)
  }

  const [headers, ...records] = rows
  if (!headers) return []

  return records.map((record) => {
    const entry: Record<string, string> = {}
    headers.forEach((header, index) => {
      entry[header] = record[index] ?? ''
    })
    return entry as unknown as RawMonitor
  })
}

function normalizeNetworkSlug(slug: string): string {
  const value = slug.toLowerCase()
  if (value.includes('purpleair')) return 'PA'
  if (value.includes('aqegg')) return 'EGG'
  if (value.includes('agency') || value.includes('fem') || value.includes('regulatory')) return 'FEM'
  return slug
}

function rowsFromJsonPayload(payload: unknown, fallbackNetwork?: string): RawMonitor[] {
  if (Array.isArray(payload)) return payload as RawMonitor[]

  if (
    payload
    && typeof payload === 'object'
    && 'type' in payload
    && (payload as { type?: unknown }).type === 'FeatureCollection'
    && Array.isArray((payload as { features?: unknown }).features)
  ) {
    const featureCollection = payload as unknown as { features: GeoJsonMonitorFeature[] }
    return (featureCollection.features ?? [])
      .map((feature) => {
        const coordinates = feature.geometry?.coordinates ?? []
        const [longitude, latitude] = coordinates
        return {
          ...(feature.properties ?? {}),
          longitude,
          latitude,
          network: feature.properties?.network ?? (fallbackNetwork ? normalizeNetworkSlug(fallbackNetwork) : undefined),
        }
      })
  }

  if (payload && typeof payload === 'object') {
    const maybeData = (payload as { data?: unknown; monitors?: unknown; rows?: unknown }).data
      ?? (payload as { data?: unknown; monitors?: unknown; rows?: unknown }).monitors
      ?? (payload as { data?: unknown; monitors?: unknown; rows?: unknown }).rows
    return rowsFromJsonPayload(maybeData, fallbackNetwork)
  }

  return []
}

async function fetchJsonRows(url: string, signal: AbortSignal, fallbackNetwork?: string): Promise<RawMonitor[]> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Failed to load monitors: ${response.status}`)
  const json = await response.json()
  return rowsFromJsonPayload(json, fallbackNetwork)
}

async function fetchAqmapCompatibleRows(signal: AbortSignal): Promise<RawMonitor[]> {
  const directEndpoints = [
    '/data/recent/all/json',
    '/data/recent/pm25/json',
    '/data/monitors/all.json',
  ]

  for (const endpoint of directEndpoints) {
    try {
      const rows = await fetchJsonRows(endpoint, signal)
      if (rows.length > 0) return rows
    } catch {
      // Try the next aqmap-compatible shape before falling back to static CSV.
    }
  }

  const networkEndpoints: Array<[string, string]> = [
    ['/data/recent/agency/geojson', 'agency'],
    ['/data/recent/purpleair/geojson', 'purpleair'],
    ['/data/recent/aqegg/geojson', 'aqegg'],
  ]
  const networkRows = await Promise.allSettled(
    networkEndpoints.map(([endpoint, network]) => fetchJsonRows(endpoint, signal, network)),
  )
  const combined = networkRows.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
  if (combined.length > 0) return combined

  const csvResponse = await fetch('/data/monitors.csv', { signal })
  if (!csvResponse.ok) throw new Error(`Failed to load monitors: ${csvResponse.status}`)
  return parseCsv(await csvResponse.text())
}

async function fetchStaticMonitorRows(signal: AbortSignal): Promise<RawMonitor[]> {
  try {
    const response = await fetch('/data/monitors.csv', { signal })
    if (!response.ok) {
      throw new Error(`Failed to load monitors: ${response.status}`)
    }
    return parseCsv(await response.text())
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    const response = await fetch('/data/monitors/all.json', { signal })
    if (!response.ok) throw err
    const json = await response.json()
    if (!Array.isArray(json)) throw err
    return json as RawMonitor[]
  }
}

export function useAirQualityData(options: boolean | UseAirQualityDataOptions = true) {
  const enabled = typeof options === 'boolean' ? options : options.enabled ?? true
  const aqmapCompatible = typeof options === 'object' ? options.aqmapCompatible ?? false : false
  const [monitors, setMonitors] = useState<AirMonitor[]>([])
  const [loading, setLoading] = useState(enabled)
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
        const rows = aqmapCompatible
          ? await fetchAqmapCompatibleRows(controller.signal)
          : await fetchStaticMonitorRows(controller.signal)
        const normalized = rows
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
  }, [enabled, aqmapCompatible])

  return { monitors, loading, error }
}
