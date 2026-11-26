/**
 * The look a person gives a layer of their own: a colour, an area pattern, a line style, a width
 * and an opacity, each optional, laid over that layer's default symbol. The result is an ordinary
 * `SheetSymbol`, so the map, its legend and a printed sheet draw what the picker showed. A stored
 * style keeps only what the person set; the catalogue stays the one definition of every symbol
 * that is not theirs to change. No DOM or network access.
 */
import type { StrokeStyle } from './drawOps'
import type { IconId } from './icons'
import { ORGANIC_HATCH_LIMITS } from '@pgmaps/geo-toolkit/patterns'
import type { AreaSymbol, Hatch, LineMarker, LineSymbol, MarkerFill, OrganicHatchFill, PointSymbol } from './symbols'

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
  'organic',
  'patch',
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
  organic: 'Organic hatch',
  patch: 'Patch hatch (page 8)',
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
  organic: [],
  patch: [],
}

/** The settings of an organic hatch a person can change; the rest come from `ORGANIC_HATCH_SHEET`. */
export type OrganicHatchSettings = Partial<
  Pick<OrganicHatchFill, 'seed' | 'spacing' | 'bandHeight' | 'strokeWidth' | 'curvature'>
>
export const ORGANIC_HATCH_SETTINGS = ['seed', 'spacing', 'bandHeight', 'strokeWidth', 'curvature'] as const
export const ORGANIC_HATCH_SETTING_LABELS: Record<(typeof ORGANIC_HATCH_SETTINGS)[number], string> = {
  seed: 'Seed',
  spacing: 'Spacing',
  bandHeight: 'Band height',
  strokeWidth: 'Stroke width',
  curvature: 'Curvature',
}
/**
 * A patch hatch on a sheet, in points: the page 8 field at about 0.8 of its artboard size, so its
 * strokes read on a printed sheet as the reference's do on its page.
 */
export const PATCH_HATCH_SHEET: Required<OrganicHatchSettings> = {
  seed: 8,
  spacing: 2.4,
  bandHeight: 8.8,
  strokeWidth: 1.15,
  curvature: 12.8,
}
export const PATCH_HATCH_SHEET_PATCHES = { patchSize: 240, lean: 30, leanBias: 5, seam: 0 } as const
/** The sheet defaults of an organic or patch pattern. */
export const organicHatchSheetDefaults = (pattern: AreaPattern) =>
  pattern === 'patch' ? PATCH_HATCH_SHEET : ORGANIC_HATCH_SHEET
/** An organic hatch on a sheet, in points: finer than the illustrated map's artboard field. */
export const ORGANIC_HATCH_SHEET: Required<OrganicHatchSettings> = {
  seed: 8,
  spacing: 2.5,
  bandHeight: 11,
  strokeWidth: 0.9,
  curvature: 8,
}

/** `custom` draws the style's own `dashPattern`. */
export const LINE_DASHES = ['solid', 'dashed', 'long-dash', 'dotted', 'dash-dot', 'custom'] as const
/** The line styles with a fixed pattern, as a picker draws them. */
export const LINE_DASH_PRESETS = LINE_DASHES.filter((dash) => dash !== 'custom')
export type LineDash = (typeof LINE_DASHES)[number]
export const LINE_DASH_LABELS: Record<LineDash, string> = {
  solid: 'Solid',
  dashed: 'Dashed',
  'long-dash': 'Long dash',
  dotted: 'Dotted',
  'dash-dot': 'Dash-dot',
  custom: 'Custom',
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
  custom: null,
}

/** Line widths a person may set, in points. */
export const SYMBOL_WIDTH_LIMITS = { min: 0.5, max: 6, step: 0.25 } as const
/** Line widths on the ground, in metres: the line is then drawn to the map's scale. */
export const SYMBOL_GROUND_WIDTH_LIMITS = { min: 0.5, max: 200, step: 0.5 } as const
/** Point sizes, in points. */
export const SYMBOL_SIZE_LIMITS = { min: 4, max: 24, step: 1 } as const
/** A custom dash: 2 to 8 lengths, each 0.25 to 40 line widths, alternating dash and gap. */
export const DASH_PATTERN_LIMITS = { minParts: 2, maxParts: 8, min: 0.25, max: 40 } as const

/** A mark repeated along a line. */
export const LINE_MARKERS = ['arrow', 'tick', 'dot'] as const
export type LineMarkerKind = (typeof LINE_MARKERS)[number]
export const LINE_MARKER_LABELS: Record<LineMarkerKind, string> = {
  arrow: 'Arrows, the way the line was drawn',
  tick: 'Ticks across the line',
  dot: 'Dots',
}
/** Points between marks along a line. */
export const LINE_MARKER_SPACING = 30

/** The shapes a point layer can take; the plain ringed dot is the layer's own default. */
export const POINT_ICONS = [
  'dot',
  'diamond',
  'cross',
  'plot-circle',
  'spot-height',
  'tower',
  'tree',
  'warning',
  'gate',
  'bridge',
  'culvert',
  'pit',
] as const satisfies readonly IconId[]
export type PointIcon = (typeof POINT_ICONS)[number]

export interface SymbolStyle {
  /** Lower-case `#rrggbb`. */
  color?: string
  pattern?: AreaPattern
  dash?: LineDash
  /** Line or outline width, points. */
  width?: number
  /** Fill opacity of an area, 0–1. */
  opacity?: number
  /** The lengths of a `custom` dash, in line widths: dash, gap, dash, gap… */
  dashPattern?: number[]
  /** Line or outline width on the ground, metres. When set, the map draws the line to scale. */
  widthM?: number
  /** A mark repeated along a line. */
  marker?: LineMarkerKind
  /** An area drawn as its outline (and pattern) only. */
  noFill?: true
  /** The hatch or dot colour, when it differs from the layer's colour. */
  patternColor?: string
  /** A point's shape. */
  icon?: PointIcon
  /** A point's size, points. */
  size?: number
  /** The settings of an `organic` or `patch` pattern that differ from its sheet defaults. */
  organic?: OrganicHatchSettings
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

/** Whether a list of lengths is a dash a line can draw. */
export function isDashPattern(value: unknown): value is number[] {
  const { minParts, maxParts, min, max } = DASH_PATTERN_LIMITS
  return (
    Array.isArray(value) &&
    value.length >= minParts &&
    value.length <= maxParts &&
    value.every((part) => typeof part === 'number' && part >= min && part <= max)
  )
}

/** A dash typed as lengths ("6 2 1 2", "6, 2"), or `null` when it is not one a line can draw. */
export function parseDashPattern(text: string): number[] | null {
  const parts = text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number)
  return isDashPattern(parts) ? parts : null
}

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
  if (raw.dashPattern !== undefined) {
    if (!isDashPattern(raw.dashPattern)) throw Error(`${label} has a dash it cannot draw.`)
    style.dashPattern = [...raw.dashPattern]
  }
  if (style.dash === 'custom' && !style.dashPattern) throw Error(`${label} has a custom line style with no dash.`)
  if (raw.widthM !== undefined) {
    const { min, max } = SYMBOL_GROUND_WIDTH_LIMITS
    if (typeof raw.widthM !== 'number' || !(raw.widthM >= min && raw.widthM <= max))
      throw Error(`${label} ground width must be ${min} to ${max} m.`)
    style.widthM = raw.widthM
  }
  if (raw.marker !== undefined) {
    if (!LINE_MARKERS.includes(raw.marker as LineMarkerKind)) throw Error(`${label} has an unknown line mark.`)
    style.marker = raw.marker as LineMarkerKind
  }
  if (raw.noFill !== undefined) {
    if (raw.noFill !== true) throw Error(`${label} no-fill must be true or absent.`)
    style.noFill = true
  }
  if (raw.patternColor !== undefined) {
    if (typeof raw.patternColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(raw.patternColor))
      throw Error(`${label} pattern colour must use #RRGGBB.`)
    style.patternColor = raw.patternColor.toLowerCase()
  }
  if (raw.icon !== undefined) {
    if (!POINT_ICONS.includes(raw.icon as PointIcon)) throw Error(`${label} has an unknown point shape.`)
    style.icon = raw.icon as PointIcon
  }
  if (raw.size !== undefined) {
    const { min, max } = SYMBOL_SIZE_LIMITS
    if (typeof raw.size !== 'number' || !(raw.size >= min && raw.size <= max))
      throw Error(`${label} point size must be ${min} to ${max} points.`)
    style.size = raw.size
  }
  if (raw.organic !== undefined) style.organic = parseOrganicHatchSettings(raw.organic, label)
  return style
}

/** Organic hatch settings read from a file: each present value checked against the toolkit's limits. */
export function parseOrganicHatchSettings(value: unknown, label = 'Layer look'): OrganicHatchSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error(`${label} organic hatch must be an object.`)
  const raw = value as Record<string, unknown>
  const settings: OrganicHatchSettings = {}
  for (const key of ORGANIC_HATCH_SETTINGS) {
    const entry = raw[key]
    if (entry === undefined) continue
    const { min, max } = ORGANIC_HATCH_LIMITS[key]
    if (typeof entry !== 'number' || !(entry >= min && entry <= max))
      throw Error(`${label} organic hatch ${ORGANIC_HATCH_SETTING_LABELS[key].toLowerCase()} must be ${min} to ${max}.`)
    if (key === 'seed' && !Number.isInteger(entry)) throw Error(`${label} organic hatch seed must be a whole number.`)
    settings[key] = entry
  }
  for (const key of Object.keys(raw))
    if (!(ORGANIC_HATCH_SETTINGS as readonly string[]).includes(key))
      throw Error(`${label} organic hatch has an unknown setting "${key}".`)
  return settings
}

const SHAPE_KEYS: Record<'point' | 'line' | 'area', readonly (keyof SymbolStyle)[]> = {
  point: ['color', 'icon', 'size'],
  line: ['color', 'dash', 'dashPattern', 'width', 'widthM', 'marker'],
  area: ['color', 'dash', 'dashPattern', 'width', 'widthM', 'pattern', 'patternColor', 'opacity', 'noFill', 'organic'],
}

/**
 * The part of a look a shape can show: pasting an area's look onto a line keeps its colour and
 * line style and leaves the pattern behind, rather than storing values the layer never draws.
 */
export function symbolStyleForShape(style: SymbolStyle, shape: 'point' | 'line' | 'area'): SymbolStyle {
  const kept: SymbolStyle = {}
  for (const key of SHAPE_KEYS[shape]) if (style[key] !== undefined) Object.assign(kept, { [key]: style[key] })
  if (kept.dash === 'custom' && !kept.dashPattern) delete kept.dash
  return kept
}

let copied: SymbolStyle | null = null
const copyListeners = new Set<() => void>()
/** The look last copied on this page, for pasting onto another layer. Kept in memory only. */
export const copiedSymbolStyle = () => copied
export function copySymbolStyle(style: SymbolStyle | null): void {
  copied = style && !symbolStyleIsEmpty(style) ? { ...style } : null
  for (const listener of copyListeners) listener()
}
export function onCopiedSymbolStyle(listener: () => void): () => void {
  copyListeners.add(listener)
  return () => copyListeners.delete(listener)
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
export function dashForWidth(dash: LineDash, width: number, pattern?: readonly number[]): number[] | undefined {
  return (dash === 'custom' ? pattern : LINE_DASH_UNITS[dash])?.map((units) => units * width)
}

/** The dash a style draws, in line widths, or `null` for a solid line. */
export function styleDashUnits(defaults: SymbolStyleDefaults, style?: SymbolStyle): readonly number[] | null {
  const dash = style?.dash ?? defaults.dash
  return dash === 'custom' ? (style?.dashPattern ?? null) : LINE_DASH_UNITS[dash]
}

/** The marks a style repeats along its line. */
export function styleLineMarkers(defaults: SymbolStyleDefaults, style?: SymbolStyle): LineMarker[] {
  if (!style?.marker) return []
  const width = style.width ?? defaults.width
  return [
    {
      icon: style.marker,
      spacing: LINE_MARKER_SPACING,
      size: Math.max(style.marker === 'arrow' ? 8 : 6, width * (style.marker === 'dot' ? 2.6 : 4)),
      color: style.color ?? defaults.color,
    },
  ]
}

/** The point a style draws: the chosen shape, or the default ringed dot. */
export function styledPointSymbol(defaults: SymbolStyleDefaults, style?: SymbolStyle): PointSymbol {
  const icon = style?.icon ?? 'dot'
  return {
    kind: 'point',
    label: defaults.label,
    icon,
    size: style?.size ?? 9,
    color: style?.color ?? defaults.color,
    secondary: '#ffffff',
    halo: icon === 'dot' ? { color: '#0f172a', width: 1.5 } : { color: '#ffffff', width: 1.5 },
  }
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

/** The curved hatch of a pattern: `organic` draws the banded field, `patch` the page 8 patches. */
export function patternOrganicHatch(
  pattern: AreaPattern,
  color: string,
  opacity: number,
  settings?: OrganicHatchSettings,
): OrganicHatchFill | undefined {
  if (pattern === 'organic') return { ...ORGANIC_HATCH_SHEET, ...settings, color, opacity }
  if (pattern === 'patch')
    return {
      ...PATCH_HATCH_SHEET,
      ...settings,
      color,
      opacity,
      style: 'patch',
      patch: { ...PATCH_HATCH_SHEET_PATCHES },
    }
  return undefined
}

/** The line a style draws, casing first. */
export function styledLineSymbol(defaults: SymbolStyleDefaults, style?: SymbolStyle): LineSymbol {
  const color = style?.color ?? defaults.color
  const width = style?.width ?? defaults.width
  const dash = dashForWidth(style?.dash ?? defaults.dash, width, style?.dashPattern)
  const markers = styleLineMarkers(defaults, style)
  return {
    kind: 'line',
    label: defaults.label,
    layers: [
      ...(defaults.casing ? [{ ...defaults.casing, width: width + defaults.casing.width }] : []),
      { color, width, ...(dash ? { dash } : {}), join: 'round' },
    ],
    ...(markers.length ? { markers } : {}),
  }
}

/** The area a style draws: a tint, a pattern over it, and the outline in the style's line. */
export function styledAreaSymbol(defaults: SymbolStyleDefaults, style?: SymbolStyle): AreaSymbol {
  const color = style?.color ?? defaults.color
  const width = style?.width ?? defaults.width
  const pattern = style?.pattern ?? defaults.pattern
  const dash = dashForWidth(style?.dash ?? defaults.dash, width, style?.dashPattern)
  const spacing = defaults.hatchSpacing ?? 7
  const patternColor = style?.patternColor ?? color
  const hatches = patternHatches(
    pattern,
    { color: patternColor, width: defaults.hatchStroke?.width ?? 0.65, opacity: defaults.hatchStroke?.opacity ?? 0.6 },
    spacing,
  )
  const markerFill = patternMarkerFill(pattern, patternColor, spacing)
  const organicHatch = patternOrganicHatch(pattern, patternColor, defaults.hatchStroke?.opacity ?? 0.85, style?.organic)
  return {
    kind: 'area',
    label: defaults.label,
    fill: color,
    fillOpacity: style?.noFill ? 0 : (style?.opacity ?? defaults.opacity),
    ...(hatches.length ? { hatches } : {}),
    ...(organicHatch ? { organicHatch } : {}),
    ...(markerFill ? { markerFill } : {}),
    outline: [{ color, width, ...(dash ? { dash } : {}) }],
  }
}
