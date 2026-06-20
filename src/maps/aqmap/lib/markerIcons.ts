import type { AirMonitor } from '@/maps/airquality'
import { getMarkerText, getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import { getAqhiPlusColor } from './aqhiScale'
import { getAqmapMarkerGroup } from './monitorPresentation'

export interface AqMarkerIcon {
  id: string
  src: string
  size: number
}

function getReadableMarkerTextColor(fill: string): string {
  const normalized = fill.startsWith('#') ? fill.slice(1) : fill
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255
  return luminance > 0.58 ? '#111827' : '#ffffff'
}

function makeMarkerIconSvg(group: ReturnType<typeof getAqmapMarkerGroup>, value: number | null | undefined, size: number): string {
  const markerValue = getMarkerText(value)
  const fill = getAqhiPlusColor(value)
  const textColor = getReadableMarkerTextColor(fill)
  const stroke = group === 'agency' ? '#111827' : '#ffffff'
  const fontSize = markerValue.length > 2 ? 9.5 : markerValue.length > 1 ? 11.5 : 13.5
  const shape = group === 'agency'
    ? `<path d="M${size / 2} 2.5 L${size - 2.5} ${size / 2} L${size / 2} ${size - 2.5} L2.5 ${size / 2} Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5" />`
    : group === 'aqegg'
      ? `<rect x="2.5" y="2.5" width="${size - 5}" height="${size - 5}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="2.5" />`
      : `<circle cx="${size / 2}" cy="${size / 2}" r="${(size - 5) / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2.5" />`

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.35"/></filter>',
    `<g filter="url(#shadow)">${shape}</g>`,
    `<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${textColor}">${markerValue}</text>`,
    '</svg>',
  ].join('')

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function getAqmapMarkerIcon(monitor: AirMonitor): AqMarkerIcon {
  const pm25 = getMonitorAqhiPm25(monitor)
  const group = getAqmapMarkerGroup(monitor)
  const markerText = getMarkerText(pm25)
  const size = pm25 === null ? 21 : 30

  return {
    id: `aqmap-marker-${group}-${markerText}-${size}`,
    src: makeMarkerIconSvg(group, pm25, size),
    size,
  }
}

export function getAqmapMarkerSortKey(monitor: AirMonitor): number {
  const pm25 = getMonitorAqhiPm25(monitor)
  const groupBonus = getAqmapMarkerGroup(monitor) === 'agency' ? 100000 : 0
  return pm25 === null ? -1 : groupBonus + Math.round(pm25 * 100)
}
