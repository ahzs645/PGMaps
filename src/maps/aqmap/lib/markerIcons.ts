import type { AirMonitor } from '@/maps/airquality'
import { getMarkerText, getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import { getAqmapMarkerGroup } from './monitorPresentation'

export interface AqMarkerIcon {
  id: string
  src: string
  size: number
}

function iconPath(group: ReturnType<typeof getAqmapMarkerGroup>, value: string | number | null | undefined, size: number): string {
  const markerValue = getMarkerText(value)
  return `/icons/${group}_icon_${encodeURIComponent(markerValue)}_size${size}.svg`
}

export function getAqmapMarkerIcon(monitor: AirMonitor): AqMarkerIcon {
  const pm25 = getMonitorAqhiPm25(monitor)
  const group = getAqmapMarkerGroup(monitor)
  const markerText = getMarkerText(pm25)
  const size = pm25 === null ? 20 : 29

  return {
    id: `aqmap-marker-${group}-${markerText}-${size}`,
    src: iconPath(group, pm25, size),
    size,
  }
}

export function getAqmapMarkerSortKey(monitor: AirMonitor): number {
  const pm25 = getMonitorAqhiPm25(monitor)
  const groupBonus = getAqmapMarkerGroup(monitor) === 'agency' ? 100000 : 0
  return pm25 === null ? -1 : groupBonus + Math.round(pm25 * 100)
}

