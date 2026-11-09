import { feasibilityClass } from './raster'

export type Rgba = [number, number, number, number]

const hex = ([red, green, blue]: Rgba) =>
  `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`

/** Numeric feasibility codes as CCISS Spatial draws them; the map layers and the map legend both read this. */
const FEASIBILITY_RGBA: Record<number, Rgba> = {
  10: [0, 100, 0, 255],
  20: [30, 144, 255, 255],
  30: [238, 201, 0, 255],
}
/** Traced tiles keep the image's near-white unsuitable class and mark unresolved colours. */
const TRACE_UNSUITABLE_RGBA: Rgba = [247, 247, 247, 255]
const TRACE_UNCERTAIN_RGBA: Rgba = [190, 40, 180, 255]
const TRANSPARENT: Rgba = [0, 0, 0, 0]

export function suitabilityColor(code: number): Rgba {
  return FEASIBILITY_RGBA[code] ?? TRANSPARENT
}

export function traceColor(code: number): Rgba {
  return code === 99 ? TRACE_UNCERTAIN_RGBA : code === 40 ? TRACE_UNSUITABLE_RGBA : suitabilityColor(code)
}

export function traceLabel(code: number): string {
  return code === 99 ? 'Uncertain colour' : code === 40 ? 'EX · Unsuitable' : feasibilityClass(code)
}

export const SUITABILITY_LEGEND = [
  { label: 'E1 · High', color: hex(FEASIBILITY_RGBA[10]) },
  { label: 'E2 · Moderate', color: hex(FEASIBILITY_RGBA[20]) },
  { label: 'E3 · Low', color: hex(FEASIBILITY_RGBA[30]) },
  { label: 'EX · Unsuitable', color: hex(TRACE_UNSUITABLE_RGBA) },
] as const
export const TRACE_UNCERTAIN_LEGEND = { label: 'Unresolved colour (trace only)', color: hex(TRACE_UNCERTAIN_RGBA) }

/**
 * Rating swatches in the analysis dialogs, indexed by rating 1–4. Unsuitable is a mid grey there,
 * because the map's near-white class disappears on a white table.
 */
export const RATING_COLORS: Record<number, string> = {
  1: hex(FEASIBILITY_RGBA[10]),
  2: hex(FEASIBILITY_RGBA[20]),
  3: hex(FEASIBILITY_RGBA[30]),
  4: '#d4d4d4',
}
export const NOVEL_CLIMATE_COLOR = '#a855f7'
