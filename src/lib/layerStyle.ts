/**
 * A layer's style as data, Felt-fashion: the same object yields the MapLibre paint
 * expressions and the legend, so the two cannot drift apart.
 *
 * - `simple`: one colour.
 * - `categories`: a colour per value of a column, everything else in `otherColor`.
 * - `range`: a numeric column classed into colour steps.
 * - `size`: a numeric column classed into point radii or line widths.
 *
 * Keep this module free of DOM access; it carries the unit tests.
 */
import { resolvePaletteScale, samplePalette } from '@/lib/paletteScale'
import type { ColumnStats } from '@/lib/featureAttributes'

export type LayerGeometry = 'fill' | 'line' | 'point'
export type StyleClassification = 'quantile' | 'equal-interval'

export type LayerStyle =
  | { type: 'simple'; color: string }
  | {
      type: 'categories'
      column: string
      categories: Array<{ value: string; color: string }>
      /** Colour for values not listed; null hides them. */
      otherColor: string | null
    }
  | {
      type: 'range'
      column: string
      classification: StyleClassification
      ramp: RampId
      /** Interior class boundaries; a value equal to a break falls in the upper class. */
      breaks: number[]
      colors: string[]
      min: number
      max: number
    }
  | {
      type: 'size'
      column: string
      color: string
      classification: StyleClassification
      breaks: number[]
      sizes: number[]
      min: number
      max: number
    }

export type LayerStyleType = LayerStyle['type']

/** Felt-like categorical palette, readable on the light and dark basemaps. */
export const CATEGORY_PALETTE = [
  '#4c78a8',
  '#f58518',
  '#54a24b',
  '#e45756',
  '#72b7b2',
  '#b279a2',
  '#eeca3b',
  '#9d755d',
  '#ff9da6',
  '#79706e',
] as const

/** Swatches offered for a single-colour layer. */
export const SIMPLE_COLORS = [
  '#e25245',
  '#f58518',
  '#eeca3b',
  '#54a24b',
  '#0891b2',
  '#4c78a8',
  '#6366f1',
  '#b279a2',
  '#64748b',
] as const

export const OTHER_COLOR = '#a1a1aa'
export const MISSING_COLOR = '#d4d4d8'

export const RAMPS = {
  blues: { label: 'Blues', colors: ['#deebf7', '#6baed6', '#08306b'] },
  greens: { label: 'Greens', colors: ['#e5f5e0', '#74c476', '#00441b'] },
  heat: { label: 'Yellow–red', colors: ['#ffffb2', '#fd8d3c', '#bd0026'] },
  viridis: { label: 'Viridis', colors: ['#fde725', '#21918c', '#440154'] },
  purples: { label: 'Purples', colors: ['#efedf5', '#9e9ac8', '#3f007d'] },
} as const satisfies Record<string, { label: string; colors: readonly string[] }>

export type RampId = keyof typeof RAMPS

export const DEFAULT_RAMP: RampId = 'heat'

/** Radius (points) or width (lines) range for size classes, in px. */
const SIZE_RANGE: Record<'point' | 'line', [number, number]> = {
  point: [3, 14],
  line: [1, 8],
}

export function simpleStyle(color: string): LayerStyle {
  return { type: 'simple', color }
}

/** One colour per most-common value, up to `limit`; the rest fall into "Other". */
export function buildCategoriesStyle(
  column: string,
  stats: Pick<ColumnStats, 'topValues' | 'distinct'>,
  limit = 8,
): LayerStyle {
  const shown = stats.topValues.slice(0, limit)
  return {
    type: 'categories',
    column,
    categories: shown.map(({ value }, index) => ({ value, color: CATEGORY_PALETTE[index % CATEGORY_PALETTE.length] })),
    otherColor: stats.distinct > shown.length ? OTHER_COLOR : null,
  }
}

function classify(values: readonly number[], classes: number, classification: StyleClassification) {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return null
  let min = Infinity
  let max = -Infinity
  for (const value of finite) {
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max, values: finite, classes, classification }
}

/** Classes a numeric column into colour steps sampled from a ramp. Null when there are no numbers. */
export function buildRangeStyle(
  column: string,
  values: readonly number[],
  {
    classes = 5,
    classification = 'quantile',
    ramp = DEFAULT_RAMP,
  }: { classes?: number; classification?: StyleClassification; ramp?: RampId } = {},
): LayerStyle | null {
  const input = classify(values, classes, classification)
  if (!input) return null
  const scale = resolvePaletteScale({
    colors: RAMPS[ramp].colors,
    interpolation: 'lab',
    domain: [input.min, input.max],
    classes,
    classification,
    values: input.values,
    missingColor: MISSING_COLOR,
  })
  return {
    type: 'range',
    column,
    classification,
    ramp,
    breaks: scale.breaks,
    colors: scale.colors.map(toHex),
    min: input.min,
    max: input.max,
  }
}

/** Classes a numeric column into point radii or line widths. Null when there are no numbers. */
export function buildSizeStyle(
  column: string,
  values: readonly number[],
  geometry: 'point' | 'line',
  {
    classes = 4,
    classification = 'quantile',
    color,
  }: { classes?: number; classification?: StyleClassification; color: string },
): LayerStyle | null {
  const input = classify(values, classes, classification)
  if (!input) return null
  // The palette scale does the classing; its colours are discarded.
  const scale = resolvePaletteScale({
    colors: ['#000000', '#ffffff'],
    domain: [input.min, input.max],
    classes,
    classification,
    values: input.values,
    missingColor: MISSING_COLOR,
  })
  const [smallest, largest] = SIZE_RANGE[geometry]
  const steps = scale.breaks.length + 1
  const sizes = Array.from({ length: steps }, (_, index) =>
    steps === 1 ? (smallest + largest) / 2 : round(smallest + ((largest - smallest) * index) / (steps - 1)),
  )
  return {
    type: 'size',
    column,
    color,
    classification,
    breaks: scale.breaks,
    sizes,
    min: input.min,
    max: input.max,
  }
}

function round(value: number) {
  return Math.round(value * 10) / 10
}

/** samplePalette returns `rgb(…)`; legends and colour inputs want hex. */
function toHex(color: string): string {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color)
  if (!match) return color
  return `#${match
    .slice(1, 4)
    .map((part) => Number(part).toString(16).padStart(2, '0'))
    .join('')}`
}

/** A colour ramp's preview stops, for a ramp picker. */
export function rampPreview(ramp: RampId, steps = 5): string[] {
  return samplePalette({ colors: RAMPS[ramp].colors, interpolation: 'lab' }, steps).map(toHex)
}

type Expression = readonly unknown[]

function numberOf(column: string): Expression {
  return ['to-number', ['get', column]]
}

/** Whether the feature has a number in `column`; empty cells take the missing colour. */
function isNumber(column: string): Expression {
  return ['==', ['typeof', ['get', column]], 'number']
}

function stepExpression(column: string, outputs: readonly (string | number)[], breaks: readonly number[]): Expression {
  const stops: unknown[] = []
  breaks.forEach((value, index) => stops.push(value, outputs[index + 1]))
  return breaks.length === 0 ? [outputs[0]] : ['step', numberOf(column), outputs[0], ...stops]
}

/** Colour of each feature: a literal for simple and size styles, an expression otherwise. */
export function colorExpression(style: LayerStyle): string | Expression {
  switch (style.type) {
    case 'simple':
      return style.color
    case 'size':
      return style.color
    case 'categories': {
      if (style.categories.length === 0) return style.otherColor ?? OTHER_COLOR
      const pairs = style.categories.flatMap((category) => [category.value, category.color])
      return ['match', ['to-string', ['get', style.column]], ...pairs, style.otherColor ?? OTHER_COLOR]
    }
    case 'range': {
      const step = stepExpression(style.column, style.colors, style.breaks)
      return ['case', isNumber(style.column), step.length === 1 ? step[0] : step, MISSING_COLOR]
    }
  }
}

/** Point radius or line width for each feature; `base` when the style does not size by value. */
export function sizeExpression(style: LayerStyle, base: number): number | Expression {
  if (style.type !== 'size') return base
  const step = stepExpression(style.column, style.sizes, style.breaks)
  return ['case', isNumber(style.column), step.length === 1 ? step[0] : step, style.sizes[0]]
}

/**
 * MapLibre filter that hides "other" values when a categories style has no
 * `otherColor`. Null when every feature is drawn.
 */
export function styleFilter(style: LayerStyle): Expression | null {
  if (style.type !== 'categories' || style.otherColor !== null) return null
  return ['in', ['to-string', ['get', style.column]], ['literal', style.categories.map((category) => category.value)]]
}

export interface LegendEntry {
  key: string
  label: string
  color: string
  /** Radius or width in px, for size styles. */
  size?: number
  /** The category value this entry stands for, so a legend row can filter it. */
  value?: string
}

/**
 * Legend rows for a style. `formatValue` formats class boundaries with the
 * column's own format, so the legend reads like the table.
 */
export function legendEntries(style: LayerStyle, formatValue: (value: number) => string = String): LegendEntry[] {
  switch (style.type) {
    case 'simple':
      return []
    case 'categories': {
      const entries: LegendEntry[] = style.categories.map((category) => ({
        key: `category:${category.value}`,
        label: category.value,
        color: category.color,
        value: category.value,
      }))
      if (style.otherColor) entries.push({ key: 'other', label: 'Other', color: style.otherColor })
      return entries
    }
    case 'range':
      return classLabels(style.breaks, style.min, style.max, formatValue).map((label, index) => ({
        key: `class:${index}`,
        label,
        color: style.colors[index],
      }))
    case 'size':
      return classLabels(style.breaks, style.min, style.max, formatValue).map((label, index) => ({
        key: `class:${index}`,
        label,
        color: style.color,
        size: style.sizes[index],
      }))
  }
}

/** "< 10", "10 to 50", "≥ 50" — the wording Felt uses for classed legends. */
export function classLabels(
  breaks: readonly number[],
  min: number,
  max: number,
  formatValue: (value: number) => string,
): string[] {
  if (breaks.length === 0) return [min === max ? formatValue(min) : `${formatValue(min)} to ${formatValue(max)}`]
  return Array.from({ length: breaks.length + 1 }, (_, index) => {
    if (index === 0) return `< ${formatValue(breaks[0])}`
    if (index === breaks.length) return `≥ ${formatValue(breaks[index - 1])}`
    return `${formatValue(breaks[index - 1])} to ${formatValue(breaks[index])}`
  })
}

/** The colour a layer is listed with: its simple colour, or its first class colour. */
export function primaryColor(style: LayerStyle): string {
  switch (style.type) {
    case 'simple':
    case 'size':
      return style.color
    case 'categories':
      return style.categories[0]?.color ?? style.otherColor ?? OTHER_COLOR
    case 'range':
      return style.colors[Math.floor(style.colors.length / 2)] ?? MISSING_COLOR
  }
}
