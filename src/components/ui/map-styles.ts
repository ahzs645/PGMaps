/** Default map tile styles — Carto basemaps used across all map sections */
export const MAP_STYLES = {
  light: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
  dark: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
} as const

/** Prince George center coordinates */
export const PG_CENTER: [number, number] = [-122.764593, 53.909784]

/** Default map zoom level */
export const PG_DEFAULT_ZOOM = 12

/** Standard selection highlight color (sky-400) */
export const SELECTION_COLOR = '#38bdf8'

/** Standard selection highlight line width */
export const SELECTION_WIDTH = 2.8

/** Default color for features with null/missing data */
export const NULL_COLOR = '#475569'

/** Default border color for choropleth regions */
export const BORDER_COLOR = '#0f172a'

/** Predefined sequential color scales for choropleth maps */
export const COLOR_SCALES = {
  amber: ['#fef3c7', '#fde68a', '#fbbf24', '#f59e0b', '#b45309'],
  blue: ['#dbeafe', '#93c5fd', '#3b82f6', '#1d4ed8', '#1e3a8a'],
  green: ['#dcfce7', '#86efac', '#22c55e', '#16a34a', '#166534'],
  red: ['#fee2e2', '#fca5a5', '#ef4444', '#dc2626', '#991b1b'],
  purple: ['#f3e8ff', '#c084fc', '#9333ea', '#7e22ce', '#581c87'],
} as const

export type ColorScaleName = keyof typeof COLOR_SCALES

/** Get a choropleth color based on a value within a min/max range */
export function getChoroplethColor(
  value: number | null,
  min: number,
  max: number,
  scale: ColorScaleName = 'amber',
  fallback = NULL_COLOR
): string {
  if (value == null || !Number.isFinite(value)) return fallback
  if (max <= min) return COLOR_SCALES[scale][2]

  const colors = COLOR_SCALES[scale]
  const t = Math.max(0, Math.min(1, (value - min) / (max - min)))
  const idx = Math.min(Math.floor(t * colors.length), colors.length - 1)
  return colors[idx]
}
