import type { AirMonitor } from '@/maps/airquality'
import { getMarkerText, getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import { getAqmapMarkerGroup } from './monitorPresentation'
import { getMonitorMarkerColors, isLightMarkerFill } from './markerColorSchemes'
import type { AqMarkerColorScheme } from './aqMapTypes'

export interface AqMarkerIcon {
  id: string
  src: string
  size: number
}

function makeMarkerIconSvg(group: ReturnType<typeof getAqmapMarkerGroup>, value: number | null | undefined, size: number, scheme: AqMarkerColorScheme): string {
  const markerValue = getMarkerText(value)
  const { fill, text } = getMonitorMarkerColors(value, scheme)
  // Keep the agency outline visible whether the fill is bright or dark.
  const stroke = group === 'agency' ? (isLightMarkerFill(fill) ? '#111827' : '#cbd5e1') : '#ffffff'
  const fontSize = markerValue.length > 2 ? 9 : 10
  const shape = group === 'agency'
    ? `<path d="M${size / 2} 2 L${size - 2} ${size / 2} L${size / 2} ${size - 2} L2 ${size / 2} Z" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
    : group === 'aqegg'
      ? `<rect x="2" y="2" width="${size - 4}" height="${size - 4}" rx="4" fill="${fill}" stroke="${stroke}" stroke-width="2" />`
      : `<circle cx="${size / 2}" cy="${size / 2}" r="${(size - 4) / 2}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
    '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity="0.35"/></filter>',
    `<g filter="url(#shadow)">${shape}</g>`,
    `<text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" font-weight="700" fill="${text}">${markerValue}</text>`,
    '</svg>',
  ].join('')

  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

export function getAqmapMarkerIcon(monitor: AirMonitor, scheme: AqMarkerColorScheme = 'aqhi'): AqMarkerIcon {
  const pm25 = getMonitorAqhiPm25(monitor)
  const group = getAqmapMarkerGroup(monitor)
  const markerText = getMarkerText(pm25)
  const size = pm25 === null ? 20 : 29

  return {
    id: `aqmap-marker-${scheme}-${group}-${markerText}-${size}`,
    src: makeMarkerIconSvg(group, pm25, size, scheme),
    size,
  }
}

export function getAqmapMarkerSortKey(monitor: AirMonitor): number {
  const pm25 = getMonitorAqhiPm25(monitor)
  const groupBonus = getAqmapMarkerGroup(monitor) === 'agency' ? 100000 : 0
  return pm25 === null ? -1 : groupBonus + Math.round(pm25 * 100)
}
