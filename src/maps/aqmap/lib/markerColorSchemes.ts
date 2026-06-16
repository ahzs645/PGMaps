import { getAqhiColor } from '@/maps/airquality/lib/monitorPopup'
import type { AqMarkerColorScheme } from './aqMapTypes'

export const MARKER_COLOR_SCHEMES: AqMarkerColorScheme[] = ['aqhi', 'slate']

// erstat.ca-inspired sequential blue-gray ramp: starts at a light slate and
// darkens as PM2.5 climbs (low → high). Anchored on erstat's accent #4f6479.
const SLATE_FILLS = ['#8fa3b6', '#5f7488', '#3d4d5e', '#1e2730'] as const
const SLATE_NULL_FILL = '#cbd5e1'

// AQHI threshold colors (mirrors getAqhiColor), kept here so the legend can
// render swatches per scheme without re-deriving them.
const AQHI_FILLS = ['#3bb54a', '#f7d13d', '#f59e0b', '#c81e1e'] as const

const TEXT_DARK = '#0f172a'
const TEXT_LIGHT = '#f8fafc'

export interface MarkerColors {
  fill: string
  text: string
}

function pm25Bucket(pm25: number | null | undefined): number | null {
  if (pm25 === null || pm25 === undefined || !Number.isFinite(pm25)) return null
  if (pm25 < 30) return 0
  if (pm25 < 60) return 1
  if (pm25 < 100) return 2
  return 3
}

function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16) / 255
  const g = parseInt(value.slice(2, 4), 16) / 255
  const b = parseInt(value.slice(4, 6), 16) / 255
  const linear = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

// Crossover where black vs. white text contrast is equal (sRGB).
export function isLightMarkerFill(hex: string): boolean {
  return relativeLuminance(hex) > 0.183
}

export function getMonitorMarkerColors(
  pm25: number | null | undefined,
  scheme: AqMarkerColorScheme,
): MarkerColors {
  if (scheme === 'slate') {
    const bucket = pm25Bucket(pm25)
    const fill = bucket === null ? SLATE_NULL_FILL : SLATE_FILLS[bucket]
    return { fill, text: isLightMarkerFill(fill) ? TEXT_DARK : TEXT_LIGHT }
  }
  // AQHI keeps its established look: fixed dark label on the bright ramp.
  return { fill: getAqhiColor(pm25), text: '#111827' }
}

// Swatch colors aligned with AQHI_STOPS order (low, moderate, high, very high).
export function getSchemeLegendColors(scheme: AqMarkerColorScheme): readonly string[] {
  return scheme === 'slate' ? SLATE_FILLS : AQHI_FILLS
}
