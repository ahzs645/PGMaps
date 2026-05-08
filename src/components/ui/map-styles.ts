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

/**
 * Heatmap color ramps as [density, color] stops, density in [0, 1].
 * The first stop must be transparent so low-density tiles fade into the basemap.
 */
export const HEATMAP_COLOR_RAMPS = {
  /** Cool→warm spectrum: blue → green → orange → red. Good default for sparse density. */
  air: [
    [0, 'rgba(15, 23, 42, 0)'],
    [0.2, '#0ea5e9'],
    [0.45, '#22c55e'],
    [0.65, '#f59e0b'],
    [1, '#ef4444'],
  ],
  /** Wider 7-stop ramp tuned for dense city-scale point clouds (e.g. crime). */
  crime: [
    [0, 'rgba(0,0,0,0)'],
    [0.08, 'rgba(59,130,246,0.28)'],
    [0.22, 'rgba(59,130,246,0.7)'],
    [0.42, '#22c55e'],
    [0.62, '#eab308'],
    [0.82, '#f97316'],
    [1, '#ef4444'],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [number, string]>>

export type HeatmapRampName = keyof typeof HEATMAP_COLOR_RAMPS

/**
 * Build a 4-stop heatmap ramp from a tuple of colors (low→high density). Used
 * by Explorer's per-dataset mashup heatmaps where each dataset gets its own
 * colorway.
 */
export function buildHeatmapRamp(
  colors: readonly [string, string, string, string],
): ReadonlyArray<readonly [number, string]> {
  return [
    [0, 'rgba(0,0,0,0)'],
    [0.25, colors[0]],
    [0.5, colors[1]],
    [0.75, colors[2]],
    [1, colors[3]],
  ]
}

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
