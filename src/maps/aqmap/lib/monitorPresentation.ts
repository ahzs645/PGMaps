import type { AirMonitor } from '@/maps/airquality'
import {
  formatObservedDate,
  getAqhiCategory,
  getAqhiPlus,
  getMonitorAqhiPm25,
  getMonitorTypeLabel,
  isFemMonitor,
} from '@/maps/airquality/lib/monitorPopup'

export type AqMonitorGroup = 'agency' | 'lcm' | 'other'
export type AqBasemap = 'light' | 'dark'

export interface AqObservationRow {
  key: string
  label: string
  title: string
  value: number | null
}

export function monitorKey(monitor: AirMonitor): string {
  return `${monitor.network}:${monitor.id}:${monitor.longitude}:${monitor.latitude}`
}

export function getMonitorGroup(network: string): AqMonitorGroup {
  if (network === 'FEM' || network === 'BC ENV') return 'agency'
  if (network === 'PA' || network === 'EGG') return 'lcm'
  return 'other'
}

export function getGroupLabel(group: AqMonitorGroup): string {
  if (group === 'agency') return 'Regulatory'
  if (group === 'lcm') return 'Low-cost'
  return 'Other networks'
}

export function getAqmapNetworkSlug(monitor: AirMonitor): 'agency' | 'purpleair' | 'aqegg' | 'other' {
  if (isFemMonitor(monitor)) return 'agency'
  if (monitor.network === 'PA') return 'purpleair'
  if (monitor.network === 'EGG') return 'aqegg'
  return 'other'
}

export function getAqmapMonitorType(monitor: AirMonitor): string {
  return getMonitorTypeLabel(monitor.network).replace(/ Monitors$/, '')
}

export function getAqmapMarkerGroup(monitor: AirMonitor): 'agency' | 'purpleair' | 'aqegg' | 'lcm' {
  if (isFemMonitor(monitor)) return 'agency'
  if (monitor.network === 'PA') return 'purpleair'
  if (monitor.network === 'EGG') return 'aqegg'
  return 'lcm'
}

export function getAqmapSiteId(monitor: AirMonitor): string {
  return monitor.id
}

export function getAqmapObservedLabel(monitor: AirMonitor): string {
  return `Observed PM2.5 as of: ${formatObservedDate(monitor.dateObserved)}`
}

export function getAqmapObservationRows(monitor: AirMonitor): AqObservationRow[] {
  const rows: AqObservationRow[] = [
    {
      key: 'pm25_10min',
      label: '10-min average',
      title: 'Mean average PM2.5 concentration for the past 10 minutes.',
      value: monitor.pm25Recent ?? null,
    },
    {
      key: 'pm25_1hr',
      label: '1-hour average',
      title: 'Mean average PM2.5 concentration for the past hour.',
      value: monitor.pm25OneHour ?? null,
    },
    {
      key: 'pm25_3hr',
      label: '3-hour average',
      title: 'Mean average PM2.5 concentration for the past 3 hours.',
      value: monitor.pm25ThreeHour ?? null,
    },
    {
      key: 'pm25_24hr',
      label: '24-hour average',
      title: 'Mean average PM2.5 concentration for the past 24 hours.',
      value: monitor.pm25TwentyFourHour ?? null,
    },
  ]

  return isFemMonitor(monitor) ? rows.filter((row) => row.key !== 'pm25_10min') : rows
}

export function getAqmapHealthMessage(monitor: AirMonitor) {
  const pm25 = getMonitorAqhiPm25(monitor)
  const category = getAqhiCategory(pm25)
  const summary = getAqhiPlus(pm25)

  if (category === 'No Data') {
    return {
      heading: summary.heading,
      lines: [
        'Data for the past hour from this monitor is missing.',
      ],
    }
  }

  return {
    heading: summary.heading.replace('ug/m3', 'ug m-3'),
    lines: [
      summary.generalPopulation,
      summary.atRisk,
    ],
  }
}

export function formatAqmapPm25(value: number | null): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '-'
  if (value < 0) return '-'
  return value.toFixed(1)
}
