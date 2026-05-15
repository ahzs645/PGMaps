import type { AirMonitor } from '../types'

export const MONITOR_ZOOM = 15
export const PM25_UNIT = 'ug/m3'

const AQHI_MESSAGES: Record<string, { generalPopulation: string; atRisk: string }> = {
  'No Data': {
    generalPopulation: 'General Population - Data for the past hour from this monitor is missing.',
    atRisk: 'At Risk - Data for the past hour from this monitor is missing.'
  },
  Low: {
    generalPopulation: 'General Population - Ideal air for outdoor activities.',
    atRisk: 'At Risk - Enjoy usual outdoor activities.'
  },
  Moderate: {
    generalPopulation: 'General Population - No need to modify usual outdoor activities unless symptoms occur.',
    atRisk: 'At Risk - Consider reducing or rescheduling strenuous activities outdoors if symptoms occur.'
  },
  High: {
    generalPopulation: 'General Population - Consider reducing or rescheduling strenuous outdoor activities if symptoms occur.',
    atRisk: 'At Risk - Reduce or reschedule strenuous outdoor activities. Children and the elderly should also take it easy.'
  },
  'Very High': {
    generalPopulation: 'General Population - Reduce or reschedule strenuous outdoor activities.',
    atRisk: 'At Risk - Avoid strenuous outdoor activities. Children and the elderly should also avoid outdoor physical exertion.'
  }
}

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

export function getAqhiPlus(pm25: number | null) {
  const category = getAqhiCategory(pm25)
  const message = AQHI_MESSAGES[category]
  const range = category === 'No Data'
    ? 'No recent 1 hour average'
    : category === 'Low'
      ? '1 Hour Average Between 0 - 29.9'
      : category === 'Moderate'
        ? '1 Hour Average Between 30 - 59.9'
        : category === 'High'
          ? '1 Hour Average Between 60 - 99.9'
          : '1 Hour Average 100+'

  return {
    heading: `${range} ${PM25_UNIT} (${category} AQHI+):`,
    ...message
  }
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

export function formatPopupPm25(value: number | null): string {
  if (value === null) return '-'
  return `${value.toFixed(1)} ${PM25_UNIT}`
}

export function getMonitorAqhiPm25(monitor: AirMonitor): number | null {
  return monitor.pm25OneHour ?? monitor.pm25Recent ?? null
}

export function getMonitorPlotPm25(monitor: AirMonitor): number | null {
  return monitor.pm25OneHour ?? monitor.pm25Recent ?? null
}

export function getObservationRows(monitor: AirMonitor) {
  const values = {
    tenMinute: monitor.pm25Recent ?? null,
    oneHour: monitor.pm25OneHour ?? null,
    threeHour: monitor.pm25ThreeHour ?? null,
    twentyFourHour: monitor.pm25TwentyFourHour ?? null
  }

  return [
    [
      {
        isLabel: true,
        label: 'Past 10-min:',
        title: 'Mean average PM2.5 concentration for the past 10 minutes.'
      },
      { isLabel: false, label: 'Past 10-min value', value: formatPopupPm25(values.tenMinute) },
      {
        isLabel: true,
        label: 'Past 1-hr:',
        title: 'Mean average PM2.5 concentration for the past hour.'
      },
      { isLabel: false, label: 'Past 1-hr value', value: formatPopupPm25(values.oneHour) }
    ],
    [
      {
        isLabel: true,
        label: 'Past 3-hr:',
        title: 'Mean average PM2.5 concentration for the past 3 hours.'
      },
      { isLabel: false, label: 'Past 3-hr value', value: formatPopupPm25(values.threeHour) },
      {
        isLabel: true,
        label: 'Past 24-hr:',
        title: 'Mean average PM2.5 concentration for the past 24 hours.'
      },
      { isLabel: false, label: 'Past 24-hr value', value: formatPopupPm25(values.twentyFourHour) }
    ]
  ]
}

export function getAqhiColor(pm25: number | null | undefined): string {
  if (pm25 === null || pm25 === undefined || !Number.isFinite(pm25)) return '#94a3b8'
  if (pm25 < 30) return '#3bb54a'
  if (pm25 < 60) return '#f7d13d'
  if (pm25 < 100) return '#f59e0b'
  return '#c81e1e'
}

export function getAqhiLabel(pm25: number | null | undefined): string {
  if (pm25 === null || pm25 === undefined || !Number.isFinite(pm25)) return 'No recent PM2.5'
  return getAqhiCategory(pm25)
}

export function getMarkerText(pm25: number | null | undefined): string {
  if (pm25 === null || pm25 === undefined || !Number.isFinite(pm25)) return '-'
  const rounded = Math.round(pm25)
  if (rounded < 0) return '-'
  return rounded > 999 ? '+' : String(rounded)
}

export function distanceKm(a: AirMonitor, b: AirMonitor): number {
  const earthRadiusKm = 6371
  const toRadians = (degrees: number) => degrees * Math.PI / 180
  const dLat = toRadians(b.latitude - a.latitude)
  const dLon = toRadians(b.longitude - a.longitude)
  const lat1 = toRadians(a.latitude)
  const lat2 = toRadians(b.latitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(h))
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
