import type { AirMonitor } from '@/maps/airquality'
import { getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import { getAqmapNetworkSlug, getAqmapSiteId } from './monitorPresentation'

export interface AqPlotPoint {
  date: string
  pm25: number
  /** PurpleAir/AQegg internal sensor channels and reference columns, when available. */
  a?: number
  b?: number
  raw?: number
  corrected?: number
  fem?: number
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseCsv(text: string): AqPlotPoint[] {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/)
  const headers = headerLine.split(',').map((header) => header.trim())
  const dateIndex = headers.indexOf('date')
  const pm25Index = headers.indexOf('pm25')
  if (dateIndex < 0 || pm25Index < 0) return []
  const aIndex = headers.indexOf('pm25_a')
  const bIndex = headers.indexOf('pm25_b')
  const rawIndex = headers.indexOf('pm25_raw')
  const correctedIndex = headers.indexOf('pm25_corrected')
  const femIndex = headers.indexOf('pm25_fem')

  return lines
    .map((line) => {
      const cells = line.split(',')
      const pm25 = Number(cells[pm25Index])
      if (!Number.isFinite(pm25)) return null
      return {
        date: cells[dateIndex],
        pm25,
        a: aIndex >= 0 ? optionalNumber(cells[aIndex]) : undefined,
        b: bIndex >= 0 ? optionalNumber(cells[bIndex]) : undefined,
        raw: rawIndex >= 0 ? optionalNumber(cells[rawIndex]) : undefined,
        corrected: correctedIndex >= 0 ? optionalNumber(cells[correctedIndex]) : undefined,
        fem: femIndex >= 0 ? optionalNumber(cells[femIndex]) : undefined,
      }
    })
    .filter((point): point is AqPlotPoint => point !== null)
}

export function makeFallbackPlotSeries(monitor: AirMonitor): AqPlotPoint[] {
  const base = getMonitorAqhiPm25(monitor) ?? 0
  const day = monitor.pm25TwentyFourHour ?? base
  const now = Date.now()

  return Array.from({ length: 24 }, (_, index) => {
    const wave = Math.sin(index / 3) * Math.max(1, base * 0.16)
    const drift = (index / 23) * (base - day)
    return {
      date: new Date(now - (23 - index) * 60 * 60 * 1000).toISOString(),
      pm25: Math.max(0, day + drift + wave),
    }
  })
}

export async function fetchAqmapPlotSeries(monitor: AirMonitor, signal?: AbortSignal): Promise<{
  points: AqPlotPoint[]
  source: 'endpoint' | 'fallback'
}> {
  const network = getAqmapNetworkSlug(monitor)
  if (network === 'other') {
    return { points: makeFallbackPlotSeries(monitor), source: 'fallback' }
  }

  const siteId = encodeURIComponent(getAqmapSiteId(monitor))
  const basePath = `/data/plotting/${network}/${siteId}`

  try {
    const jsonResponse = await fetch(`${basePath}/json`, { signal })
    if (jsonResponse.ok) {
      const json = await jsonResponse.json()
      if (Array.isArray(json)) {
        const points = json
          .map((row) => {
            const date = String(row.date ?? '')
            const pm25 = Number(row.pm25)
            return date && Number.isFinite(pm25)
              ? {
                  date,
                  pm25,
                  a: optionalNumber(row.a ?? row.pm25_a),
                  b: optionalNumber(row.b ?? row.pm25_b),
                  raw: optionalNumber(row.raw ?? row.pm25_raw),
                  corrected: optionalNumber(row.corrected ?? row.pm25_corrected),
                  fem: optionalNumber(row.fem ?? row.pm25_fem),
                }
              : null
          })
          .filter((point): point is AqPlotPoint => point !== null)
        if (points.length > 0) return { points, source: 'endpoint' }
      }
    }

    const csvResponse = await fetch(`${basePath}/csv`, { signal })
    if (csvResponse.ok) {
      const points = parseCsv(await csvResponse.text())
      if (points.length > 0) return { points, source: 'endpoint' }
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error
  }

  return { points: makeFallbackPlotSeries(monitor), source: 'fallback' }
}

