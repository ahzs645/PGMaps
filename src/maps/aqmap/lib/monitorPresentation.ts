import type { AirMonitor } from '@/maps/airquality'
import { isFemMonitor } from '@/maps/airquality/lib/monitorPopup'

export type AqMonitorGroup = 'agency' | 'lcm' | 'other'
export type AqBasemap = 'light' | 'dark'

export function monitorKey(monitor: AirMonitor): string {
  return `${monitor.network}:${monitor.id}:${monitor.longitude}:${monitor.latitude}`
}

export function getMonitorGroup(network: string): AqMonitorGroup {
  if (network === 'FEM' || network === 'BC ENV') return 'agency'
  if (network === 'PA' || network === 'EGG') return 'lcm'
  return 'other'
}

export function getAqmapNetworkSlug(monitor: AirMonitor): 'agency' | 'purpleair' | 'aqegg' | 'other' {
  if (isFemMonitor(monitor)) return 'agency'
  if (monitor.network === 'PA') return 'purpleair'
  if (monitor.network === 'EGG') return 'aqegg'
  return 'other'
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
