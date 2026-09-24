import { haversineKm } from '@/lib/geo'
import type { AirMonitor } from '../types'

export const MONITOR_ZOOM = 15

export function uniqueParameters(parameters: string[]): string[] {
  return Array.from(new Set(parameters.map((parameter) => parameter.trim()).filter(Boolean)))
}

export function monitorLocationKey(monitor: AirMonitor): string {
  return `${monitor.longitude.toFixed(6)}:${monitor.latitude.toFixed(6)}`
}

export function monitorEntryKey(monitor: AirMonitor): string {
  return `${monitor.network}:${monitor.id}:${monitor.longitude.toFixed(6)}:${monitor.latitude.toFixed(6)}`
}

export function isSameLocation(a: AirMonitor, b: AirMonitor): boolean {
  return monitorLocationKey(a) === monitorLocationKey(b)
}

export function getAqhiCategory(pm25: number | null): string {
  if (pm25 === null) return 'No Data'
  if (pm25 < 30) return 'Low'
  if (pm25 < 60) return 'Moderate'
  if (pm25 < 100) return 'High'
  return 'Very High'
}

export function getMonitorTypeLabel(network: string): string {
  if (network === 'PA') return 'PurpleAir (PA) Monitors'
  if (network === 'EGG') return 'AQegg (EGG) Monitors'
  if (network === 'FEM' || network === 'BC ENV') return 'Regulatory (FEM) Monitors'
  return `${network} Monitors`
}

export function formatObservedDate(value: string | null | undefined): string {
  const date = parseObservedDate(value)
  if (!date) return 'No data'

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Vancouver',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short'
  }).formatToParts(date)

  const byType = new Map(parts.map((part) => [part.type, part.value]))
  return `${byType.get('year')} ${byType.get('month')} ${byType.get('day')} ${byType.get('hour')}:${byType.get('minute')} ${byType.get('timeZoneName')}`
}

export function getMonitorAqhiPm25(monitor: AirMonitor): number | null {
  return monitor.pm25OneHour ?? monitor.pm25Recent ?? null
}

export function getMonitorPlotPm25(monitor: AirMonitor): number | null {
  return monitor.pm25OneHour ?? monitor.pm25Recent ?? null
}

export function getMarkerText(pm25: number | null | undefined): string {
  if (pm25 === null || pm25 === undefined || !Number.isFinite(pm25)) return '-'
  const rounded = Math.round(pm25)
  if (rounded < 0) return '-'
  return rounded > 999 ? '+' : String(rounded)
}

export function distanceKm(a: AirMonitor, b: AirMonitor): number {
  return haversineKm(a.latitude, a.longitude, b.latitude, b.longitude)
}

export function isFemMonitor(monitor: AirMonitor): boolean {
  return monitor.network === 'FEM' || monitor.network === 'BC ENV'
}

export function buildSparklinePoints(value: number | null): string {
  const safeValue = Math.max(0, value ?? 0)
  const capped = Math.min(safeValue, 100)
  const y = 92 - (capped / 100) * 76
  const points = [
    [36, Math.min(92, y + 8)],
    [110, Math.max(16, y - 4)],
    [184, Math.min(92, y + 3)],
    [258, y],
    [332, Math.max(16, y - 6)],
    [406, Math.min(92, y + 5)],
    [480, y]
  ]
  return points.map(([x, pointY]) => `${x},${pointY}`).join(' ')
}

export function buildWindowSparklinePoints(values: Array<number | null>): string {
  const numericValues = values.map((value) => Math.max(0, value ?? 0))
  const maxValue = Math.max(10, ...numericValues)
  const xPositions = [48, 188, 328, 468]

  return numericValues
    .map((value, index) => {
      const capped = Math.min(value, maxValue)
      const y = 92 - (capped / maxValue) * 76
      return `${xPositions[index]},${Math.max(16, Math.min(92, y))}`
    })
    .join(' ')
}

function parseObservedDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const normalized = /Z$|[+-]\d{2}:?\d{2}$/.test(value)
    ? value
    : `${value.replace(' ', 'T')}Z`
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}
