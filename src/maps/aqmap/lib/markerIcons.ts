import type { AirMonitor } from '@/maps/airquality'
import { getAqhiColor, getMarkerText, getMonitorAqhiPm25 } from '@/maps/airquality/lib/monitorPopup'
import { getAqmapMarkerGroup } from './monitorPresentation'

export interface AqMarkerIcon {
  id: string
  src: string
  size: number
}

function contrastText(fill: string): string {
  const normalized = fill.replace('#', '')
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.58 ? '#010101' : '#ffffff'
}

function fontSizeFor(text: string): number {
  if (text.length <= 1) return 121
  if (text.length === 2) return 103
  return 90
}

function svgShape(group: ReturnType<typeof getAqmapMarkerGroup>, fill: string): string {
  if (group === 'agency') {
    return `<polygon points="130,18 242,130 130,242 18,130" fill="${fill}" stroke="#010101" stroke-width="13" />`
  }
  if (group === 'aqegg') {
    return `<rect x="41.35" y="41.35" width="177.3" height="177.3" fill="${fill}" stroke="#010101" stroke-width="13" />`
  }
  return `<circle cx="130" cy="130" r="100" fill="${fill}" stroke="#010101" stroke-width="13" />`
}

export function getAqmapMarkerIcon(monitor: AirMonitor): AqMarkerIcon {
  const pm25 = getMonitorAqhiPm25(monitor)
  const group = getAqmapMarkerGroup(monitor)
  const markerText = getMarkerText(pm25)
  const fill = getAqhiColor(pm25)
  const size = pm25 === null ? 20 : 29
  const textColor = contrastText(fill)
  const fontSize = fontSizeFor(markerText)
  const baseline = markerText === '+' ? 'middle' : 'central'
  const id = `aqmap-marker-${group}-${fill.replace('#', '')}-${markerText.replace(/\W/g, 'x')}-${size}`
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 260 260">`,
    svgShape(group, fill),
    `<text x="130" y="130" text-anchor="middle" dominant-baseline="${baseline}" alignment-baseline="${baseline}" font-size="${fontSize}" fill="${textColor}" font-family="Inter, sans-serif">${markerText}</text>`,
    '</svg>',
  ].join('')

  return {
    id,
    size,
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
  }
}

export function getAqmapMarkerSortKey(monitor: AirMonitor): number {
  const pm25 = getMonitorAqhiPm25(monitor)
  const groupBonus = getAqmapMarkerGroup(monitor) === 'agency' ? 100000 : 0
  return pm25 === null ? -1 : groupBonus + Math.round(pm25 * 100)
}
