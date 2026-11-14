/**
 * The look a person gives a layer of their own: a colour, an area pattern, a line style, a width
 * and an opacity, each optional, laid over that layer's default symbol. The result is an ordinary
 * `SheetSymbol`, so the map, its legend and a printed sheet draw what the picker showed. A stored
 * style keeps only what the person set; the catalogue stays the one definition of every symbol
 * that is not theirs to change. No DOM or network access.
 */
import type { StrokeStyle } from './drawOps'
import type { AreaSymbol, Hatch, LineSymbol, MarkerFill } from './symbols'

/** Stored values: saved projects carry them, so rename a label, never an id. */
export const AREA_PATTERNS = [
  'solid',
  'diagonal',
  'backslash',
  'crosshatch',
  'horizontal',
  'vertical',
  'grid',
  'dots',
] as const
export type AreaPattern = (typeof AREA_PATTERNS)[number]
export const AREA_PATTERN_LABELS: Record<AreaPattern, string> = {
  solid: 'Solid tint',
  diagonal: 'Diagonal hatch',
  backslash: 'Reverse diagonal',
  crosshatch: 'Crosshatch',
  horizontal: 'Horizontal lines',
  vertical: 'Vertical lines',
  grid: 'Grid',
  dots: 'Dots',
}
/** Hatch directions, counter-clockwise from east; `dots` is a marker fill instead. */
const PATTERN_ANGLES: Record<AreaPattern, readonly number[]> = {
  solid: [],
  diagonal: [45],
  backslash: [135],
  crosshatch: [45, 135],
  horizontal: [0],
  vertical: [90],
  grid: [0, 90],
  dots: [],
}

export const LINE_DASHES = ['solid', 'dashed', 'long-dash', 'dotted', 'dash-dot'] as const
export type LineDash = (typeof LINE_DASHES)[number]
export const LINE_DASH_LABELS: Record<LineDash, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  'long-dash': 'Long dash',
  dotted: 'Dotted',
  'dash-dot': 'Dash-dot',
}
/**
 * On and off lengths in line widths, which is MapLibre's `line-dasharray` unit: a wider line keeps
 * its rhythm. `solid` has none.
 */
export const LINE_DASH_UNITS: Record<LineDash, readonly number[] | null> = {
  solid: null,
  dashed: [4, 2.5],
  'long-dash': [8, 3],
  dotted: [1, 1.5],
  'dash-dot': [5, 2, 1, 2],
}

/** Line widths a person may set, in points. */
export const SYMBOL_WIDTH_LIMITS = { min: 0.5, max: 6, step: 0.25 } as const

export interface SymbolStyle {
  /** Lower-case `#rrggbb`. */
  color?: string
  pattern?: AreaPattern
  dash?: LineDash
  /** Line or outline width, points. */
  width?: number
  /** Fill opacity of an area, 0–1. */
  opacity?: number
}

/** What a layer looks like until the person changes it. */
export interface SymbolStyleDefaults {
  label: string
  color: string
  pattern: AreaPattern
  dash: LineDash
  /** Points. */
  width: number
  /** Fill opacity of an area. */
  opacity: number
  /** Distance between hatch lines, points. */
  hatchSpacing?: number
  /** Hatch line width, points, and opacity. */
  hatchStroke?: { width: number; opacity?: number }
  /** A stroke drawn under the line, e.g. a white casing so it reads on any basemap. */
  casing?: StrokeStyle
}

export const isAreaPattern = (value: unknown): value is AreaPattern => AREA_PATTERNS.includes(value as AreaPattern)
export const isLineDash = (value: unknown): value is LineDash => LINE_DASHES.includes(value as LineDash)

/** True when the style changes nothing. */
export const symbolStyleIsEmpty = (style: SymbolStyle | undefined) =>
  !style || Object.values(style).every((value) => value === undefined)

/**
 * A style read from a file, checked by hand: an unknown pattern or an out-of-range width is an
 * error with a message, never a silent default, so a saved look cannot come back as something else.
 */
export function parseSymbolStyle(value: unknown, label = 'Layer look'): SymbolStyle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${label} must be an object.`)
  const raw = value as Record<string, unknown>
  const style: SymbolStyle = {}
  if (raw.color !== undefined) {
    if (typeof raw.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.color))
      throw Error(`${label} colour must use #RRGGBB.`)
    style.color = raw.color.toLowerCase()
  }
  if (raw.pattern !== undefined) {
    if (!isAreaPattern(raw.pattern)) throw Error(`${label} has an unknown pattern.`)
    style.pattern = raw.pattern
  }
  if (raw.dash !== undefined) {
    if (!isLineDash(raw.dash)) throw Error(`${label} has an unknown line style.`)
    style.dash = raw.dash
  }
  if (raw.width !== undefined) {
    const { min, max } = SYMBOL_WIDTH_LIMITS
    if (typeof raw.width !== 'number' || !(raw.width >= min && raw.width <= max))
      throw Error(`${label} width must be ${min} to ${max} points.`)
    style.width = raw.width
  }
  if (raw.opacity !== undefined) {
    if (typeof raw.opacity !== 'number' || !(raw.opacity >= 0 && raw.opacity <= 1))
      throw Error(`${label} opacity must be 0 to 1.`)
    style.opacity = raw.opacity
  }
  return style
}

/** A style with one value changed; `undefined` returns that value to the layer's default. */
export function withSymbolStyle<K extends keyof SymbolStyle>(
  style: SymbolStyle | undefined,
  key: K,
  value: SymbolStyle[K],
): SymbolStyle {
  const next = { ...style }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

/** A dash in points for a stroke of `width` points, or none for a solid line. */
export function dashForWidth(dash: LineDash, width: number): number[] | undefined {
  return LINE_DASH_UNITS[dash]?.map((units) => units * width)
}

/** The hatch lines of a pattern. `solid` and `dots` have none. */
export function patternHatches(pattern: AreaPattern, stroke: StrokeStyle, spacing: number): Hatch[] {
  return PATTERN_ANGLES[pattern].map((angleDeg) => ({ angleDeg, spacing, stroke }))
}

/** The marker fill of a pattern: only `dots` has one. */
export function patternMarkerFill(pattern: AreaPattern, color: string, spacing: number): MarkerFill | undefined {
  return pattern === 'dots'
    ? { icon: 'dot', size: spacing * 0.32, color, spacingX: spacing, spacingY: spacing, stagger: true }
    : undefined
}

/** The line a style draws, casing first. */
export function styledLineSymbol(defaults: SymbolStyleDefaults, style?: SymbolStyle): LineSymbol {
  const color = style?.color ?? defaults.color
  const width = style?.width ?? defaults.width
  const dash = dashForWidth(style?.dash ?? defaults.dash, width)
  return {
    kind: 'line',
    label: defaults.label,
    layers: [
      ...(defaults.casing ? [{ ...defaults.casing, width: width + defaults.casing.width }] : []),
      { color, width, ...(dash ? { dash } : {}), join: 'round' },
    ],
  }
}

/** The area a style draws: a tint, a pattern over it, and the outline in the style's line. */
export function styledAreaSymbol(defaults: SymbolStyleDefaults, style?: SymbolStyle): AreaSymbol {
  const color = style?.color ?? defaults.color
  const width = style?.width ?? defaults.width
  const pattern = style?.pattern ?? defaults.pattern
  const dash = dashForWidth(style?.dash ?? defaults.dash, width)
  const spacing = defaults.hatchSpacing ?? 7
  const hatches = patternHatches(
    pattern,
    { color, width: defaults.hatchStroke?.width ?? 0.65, opacity: defaults.hatchStroke?.opacity ?? 0.6 },
    spacing,
  )
  const markerFill = patternMarkerFill(pattern, color, spacing)
  return {
    kind: 'area',
    label: defaults.label,
    fill: color,
    fillOpacity: style?.opacity ?? defaults.opacity,
    ...(hatches.length ? { hatches } : {}),
    ...(markerFill ? { markerFill } : {}),
    outline: [{ color, width, ...(dash ? { dash } : {}) }],
  }
}
