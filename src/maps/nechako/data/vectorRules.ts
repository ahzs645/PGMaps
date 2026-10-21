import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification } from 'maplibre-gl'
import type { CategoryStyle, CategoryValue } from './vectorStyle'

export type StyleGeometry = 'any' | 'point' | 'line' | 'polygon'
export type StyleSymbol = {
  fillColor: string
  strokeColor: string
  fillOpacity: number
  strokeOpacity: number
  strokeWidth: number
  pointRadius: number
  pointOpacity: number
  pointStrokeWidth: number
}
export type StyleComparison =
  | { property: string; operator: 'eq' | 'ne'; value: CategoryValue }
  | { property: string; operator: 'lt' | 'lte' | 'gt' | 'gte'; value: string | number }
  | { property: string; operator: 'between'; value: string | number; upper: string | number }
export type StyleRule = { id: string; name: string; enabled: boolean; condition: StyleComparison; symbol: StyleSymbol }
export type GradientStop = { value: number; color: string }
type StyleBase = { schema: 'nechako-vector-style-v1'; geometry: StyleGeometry; base: StyleSymbol }
export type VectorStyle = StyleBase &
  (
    | { mode: 'single' }
    | { mode: 'rules'; rules: StyleRule[] }
    | { mode: 'gradient'; property: string; stops: GradientStop[]; channel: 'fill' | 'stroke' | 'both' }
  )
export type LegacyVectorStyle = {
  color: string
  fillOpacity?: number
  lineOpacity?: number
  lineWidth?: number
  pointRadius?: number
  categories?: CategoryStyle
  style?: VectorStyle
}
export const MAX_STYLE_RULES = 64
export const MAX_GRADIENT_STOPS = 24
export const STYLE_OPERATORS = [
  ['eq', 'Equals'],
  ['ne', 'Not equals'],
  ['lt', 'Less than'],
  ['lte', 'Less than or equal'],
  ['gt', 'Greater than'],
  ['gte', 'Greater than or equal'],
  ['between', 'Between (inclusive)'],
] as const
export const DEFAULT_STYLE_SYMBOL: StyleSymbol = {
  fillColor: '#2563eb',
  strokeColor: '#1e3a8a',
  fillOpacity: 0.35,
  strokeOpacity: 1,
  strokeWidth: 2,
  pointRadius: 6,
  pointOpacity: 0.92,
  pointStrokeWidth: 1.25,
}
const symbolKeys = Object.keys(DEFAULT_STYLE_SYMBOL)

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected a style object.')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: readonly string[]) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error('Unsupported style fields: ' + unknown.join(', '))
}
export function checkedStyleColor(value: unknown): string {
  if (typeof value !== 'string' || !/^#[a-f\d]{6}$/i.test(value)) throw new Error('Use a six-digit hexadecimal color.')
  return value.toLowerCase()
}
export function checkedStyleProperty(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    value.length > 200 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('Choose a field with a name of 1–200 characters.')
  return value
}
function scalar(value: unknown): CategoryValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'string' && value.length <= 2000) ||
    (typeof value === 'number' && Number.isFinite(value))
  )
    return value
  throw new Error('Comparison values must be finite numbers, text, booleans or null.')
}
export function checkedStyleSymbol(value: unknown): StyleSymbol {
  const source = object(value)
  keys(source, symbolKeys)
  const result = { ...DEFAULT_STYLE_SYMBOL }
  result.fillColor = checkedStyleColor(source.fillColor)
  result.strokeColor = checkedStyleColor(source.strokeColor)
  for (const [key, maximum] of [
    ['fillOpacity', 1],
    ['strokeOpacity', 1],
    ['strokeWidth', 20],
    ['pointRadius', 30],
    ['pointOpacity', 1],
    ['pointStrokeWidth', 20],
  ] as const) {
    const number = source[key]
    if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > maximum)
      throw new Error(key + ' must be between 0 and ' + maximum + '.')
    result[key] = number
  }
  return result
}
export function checkedStyleComparison(value: unknown): StyleComparison {
  const source = object(value)
  keys(source, ['property', 'operator', 'value', 'upper'])
  const property = checkedStyleProperty(source.property)
  const operand = scalar(source.value)
  if (source.operator === 'eq' || source.operator === 'ne') {
    if (source.upper !== undefined) throw new Error('Only Between accepts an upper bound.')
    return { property, operator: source.operator, value: operand }
  }
  if (
    !['lt', 'lte', 'gt', 'gte', 'between'].includes(String(source.operator)) ||
    (typeof operand !== 'number' && typeof operand !== 'string')
  )
    throw new Error('Ordered comparisons require a number or text value.')
  if (source.operator === 'between') {
    const upper = scalar(source.upper)
    if (typeof upper !== typeof operand || (typeof upper !== 'number' && typeof upper !== 'string'))
      throw new Error('Both range bounds must have the same number or text type.')
    if (operand > upper) throw new Error('The lower range bound must not exceed the upper bound.')
    return { property, operator: 'between', value: operand, upper }
  }
  if (source.upper !== undefined) throw new Error('Only Between accepts an upper bound.')
  return { property, operator: source.operator as 'lt' | 'lte' | 'gt' | 'gte', value: operand }
}
export function checkedVectorStyle(value: unknown): VectorStyle {
  const source = object(value)
  if (
    source.schema !== 'nechako-vector-style-v1' ||
    !['any', 'point', 'line', 'polygon'].includes(String(source.geometry))
  )
    throw new Error('Unsupported vector style version or geometry.')
  const base = checkedStyleSymbol(source.base)
  const common: StyleBase = { schema: 'nechako-vector-style-v1', geometry: source.geometry as StyleGeometry, base }
  if (source.mode === 'single') {
    keys(source, ['schema', 'geometry', 'base', 'mode'])
    return { ...common, mode: 'single' }
  }
  if (source.mode === 'rules') {
    keys(source, ['schema', 'geometry', 'base', 'mode', 'rules'])
    if (!Array.isArray(source.rules) || source.rules.length > MAX_STYLE_RULES)
      throw new Error('Styles support up to ' + MAX_STYLE_RULES + ' ordered rules.')
    const ids = new Set<string>()
    const rules = source.rules.map((value): StyleRule => {
      const rule = object(value)
      keys(rule, ['id', 'name', 'enabled', 'condition', 'symbol'])
      if (typeof rule.id !== 'string' || !rule.id || rule.id.length > 100 || ids.has(rule.id))
        throw new Error('Style rule IDs must be unique, nonempty strings.')
      if (
        typeof rule.name !== 'string' ||
        !rule.name.trim() ||
        rule.name.length > 160 ||
        typeof rule.enabled !== 'boolean'
      )
        throw new Error('Every rule needs a name and explicit enabled state.')
      ids.add(rule.id)
      return {
        id: rule.id,
        name: rule.name.trim(),
        enabled: rule.enabled,
        condition: checkedStyleComparison(rule.condition),
        symbol: checkedStyleSymbol(rule.symbol),
      }
    })
    return { ...common, mode: 'rules', rules }
  }
  if (source.mode === 'gradient') {
    keys(source, ['schema', 'geometry', 'base', 'mode', 'property', 'stops', 'channel'])
    if (
      !Array.isArray(source.stops) ||
      source.stops.length < 2 ||
      source.stops.length > MAX_GRADIENT_STOPS ||
      !['fill', 'stroke', 'both'].includes(String(source.channel))
    )
      throw new Error('A numeric gradient needs 2–24 stops and a fill/stroke channel.')
    const stops = source.stops.map((value): GradientStop => {
      const stop = object(value)
      keys(stop, ['value', 'color'])
      if (typeof stop.value !== 'number' || !Number.isFinite(stop.value))
        throw new Error('Gradient stop values must be finite numbers.')
      return { value: stop.value, color: checkedStyleColor(stop.color) }
    })
    if (stops.some((stop, index) => index > 0 && stop.value <= stops[index - 1].value))
      throw new Error('Gradient stops must be in strictly increasing order with no duplicate values.')
    return {
      ...common,
      mode: 'gradient',
      property: checkedStyleProperty(source.property),
      stops,
      channel: source.channel as 'fill' | 'stroke' | 'both',
    }
  }
  throw new Error('Unsupported vector style mode.')
}
export function vectorStyleFor(vector: LegacyVectorStyle): VectorStyle {
  if (vector.style) return vector.style
  const base: StyleSymbol = {
    ...DEFAULT_STYLE_SYMBOL,
    fillColor: vector.color,
    strokeColor: vector.color,
    fillOpacity: vector.fillOpacity ?? 0.35,
    strokeOpacity: vector.lineOpacity ?? 1,
    strokeWidth: vector.lineWidth ?? 2,
    pointRadius: vector.pointRadius ?? 6,
  }
  const common: StyleBase = { schema: 'nechako-vector-style-v1', geometry: 'any', base }
  if (vector.categories?.rules.length) {
    const categories = vector.categories
    return {
      ...common,
      mode: 'rules',
      base: { ...base, fillColor: categories.fallback, strokeColor: categories.fallback },
      rules: categories.rules.map((rule, index) => ({
        id: 'category-' + index,
        name: (categories.property + ': ' + styleValueLabel(rule.value)).slice(0, 160),
        enabled: true,
        condition: { property: categories.property, operator: 'eq', value: rule.value },
        symbol: { ...base, fillColor: rule.color, strokeColor: rule.color },
      })),
    }
  }
  return { ...common, mode: 'single' }
}
export function styleValueLabel(value: CategoryValue): string {
  return value === null
    ? 'Missing / null'
    : typeof value === 'string'
      ? JSON.stringify(value) + ' (text)'
      : String(value) + ' (' + typeof value + ')'
}
export function styleConditionLabel(condition: StyleComparison): string {
  const operator = STYLE_OPERATORS.find(([id]) => id === condition.operator)![1]
  return (
    condition.property +
    ' ' +
    operator.toLowerCase() +
    ' ' +
    styleValueLabel(condition.value) +
    (condition.operator === 'between' ? ' … ' + styleValueLabel(condition.upper) : '')
  )
}
/** Missing values share the explicit null class; other comparisons never coerce types. */
export function matchesStyleComparison(
  condition: StyleComparison,
  properties: Record<string, unknown> | null,
): boolean {
  const actual = properties?.[condition.property] ?? null
  if (condition.value === null) return condition.operator === 'eq' ? actual === null : actual !== null
  if (typeof actual !== typeof condition.value) return false
  if (condition.operator === 'eq') return actual === condition.value
  if (condition.operator === 'ne') return actual !== condition.value
  if (
    (typeof actual !== 'number' && typeof actual !== 'string') ||
    (typeof actual === 'number' && !Number.isFinite(actual))
  )
    return false
  if (condition.operator === 'between') return actual >= condition.value && actual <= condition.upper
  if (condition.operator === 'lt') return actual < condition.value
  if (condition.operator === 'lte') return actual <= condition.value
  if (condition.operator === 'gt') return actual > condition.value
  return actual >= condition.value
}
export function styleComparisonExpression(condition: StyleComparison): ExpressionSpecification {
  const get: ExpressionSpecification = ['get', condition.property]
  if (condition.value === null) return condition.operator === 'eq' ? ['==', get, null] : ['!=', get, null]
  const type =
    typeof condition.value === 'number' ? 'number' : typeof condition.value === 'boolean' ? 'boolean' : 'string'
  const typed: ExpressionSpecification =
    type === 'number' ? ['number', get] : type === 'boolean' ? ['boolean', get] : ['string', get]
  const operators = { eq: '==', ne: '!=', lt: '<', lte: '<=', gt: '>', gte: '>=' } as const
  const comparison = (
    condition.operator === 'between'
      ? ['all', ['>=', typed, condition.value], ['<=', typed, condition.upper]]
      : [operators[condition.operator], typed, condition.value]
  ) as ExpressionSpecification
  return ['case', ['==', ['typeof', get], type], comparison, false]
}
export function interpolateStyleColor(stops: GradientStop[], value: number): string {
  if (value <= stops[0].value) return stops[0].color
  if (value >= stops[stops.length - 1].value) return stops[stops.length - 1].color
  const high = stops.findIndex((stop) => stop.value >= value)
  const a = stops[high - 1],
    b = stops[high],
    t = (value - a.value) / (b.value - a.value)
  return (
    '#' +
    [1, 3, 5]
      .map((offset) => {
        const start = parseInt(a.color.slice(offset, offset + 2), 16),
          end = parseInt(b.color.slice(offset, offset + 2), 16)
        return Math.round(start + (end - start) * t)
          .toString(16)
          .padStart(2, '0')
      })
      .join('')
  )
}
export function resolveStyleSymbol(style: VectorStyle, properties: Record<string, unknown> | null): StyleSymbol {
  if (style.mode === 'rules')
    return (
      style.rules.find((rule) => rule.enabled && matchesStyleComparison(rule.condition, properties))?.symbol ??
      style.base
    )
  if (style.mode !== 'gradient') return style.base
  const value = properties?.[style.property]
  if (typeof value !== 'number' || !Number.isFinite(value)) return style.base
  const color = interpolateStyleColor(style.stops, value)
  return {
    ...style.base,
    ...(style.channel !== 'stroke' && { fillColor: color }),
    ...(style.channel !== 'fill' && { strokeColor: color }),
  }
}
function alphaColor(color: string, opacity: number): string {
  return (
    'rgba(' + [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16)).join(',') + ',' + opacity + ')'
  )
}
export type StylePaint = {
  fillColor: string | ExpressionSpecification
  fillOpacity: number | ExpressionSpecification
  strokeColor: string | ExpressionSpecification
  strokeWidth: number | ExpressionSpecification
  pointRadius: number | ExpressionSpecification
  pointOpacity: number | ExpressionSpecification
  pointStrokeWidth: number | ExpressionSpecification
}
export function stylePaint(style: VectorStyle): StylePaint {
  const value = (symbol: StyleSymbol, key: keyof StylePaint) =>
    key === 'strokeColor' ? alphaColor(symbol.strokeColor, symbol.strokeOpacity) : symbol[key]
  const paint = (key: keyof StylePaint): string | number | ExpressionSpecification => {
    if (style.mode === 'rules') {
      const rules = style.rules.filter((rule) => rule.enabled)
      if (rules.length)
        return [
          'case',
          ...rules.flatMap((rule) => [styleComparisonExpression(rule.condition), value(rule.symbol, key)]),
          value(style.base, key),
        ] as ExpressionSpecification
    }
    if (
      style.mode === 'gradient' &&
      ((key === 'fillColor' && style.channel !== 'stroke') || (key === 'strokeColor' && style.channel !== 'fill'))
    ) {
      const stops = style.stops.flatMap((stop) => [
        stop.value,
        key === 'strokeColor' ? alphaColor(stop.color, style.base.strokeOpacity) : stop.color,
      ])
      return [
        'case',
        ['==', ['typeof', ['get', style.property]], 'number'],
        ['interpolate', ['linear'], ['number', ['get', style.property]], ...stops],
        value(style.base, key),
      ] as ExpressionSpecification
    }
    return value(style.base, key)
  }
  return Object.fromEntries(
    ['fillColor', 'fillOpacity', 'strokeColor', 'strokeWidth', 'pointRadius', 'pointOpacity', 'pointStrokeWidth'].map(
      (key) => [key, paint(key as keyof StylePaint)],
    ),
  ) as StylePaint
}
export type StyleLegendRow = { label: string; symbol: StyleSymbol; enabled?: boolean }
export function vectorStyleLegend(style: VectorStyle): {
  rows: StyleLegendRow[]
  gradient?: { property: string; stops: GradientStop[]; channel: string }
} {
  if (style.mode === 'rules')
    return {
      rows: [
        ...style.rules
          .filter((rule) => rule.enabled)
          .map((rule, index) => ({
            label: String(index + 1) + '. ' + rule.name + ' · ' + styleConditionLabel(rule.condition),
            symbol: rule.symbol,
          })),
        { label: 'Other values', symbol: style.base },
      ],
    }
  if (style.mode === 'gradient')
    return {
      rows: [{ label: 'Missing / nonnumeric values', symbol: style.base }],
      gradient: { property: style.property, stops: style.stops, channel: style.channel },
    }
  return { rows: [{ label: 'All features', symbol: style.base }] }
}
export function numericFieldRange(data: FeatureCollection, property: string): [number, number] {
  let min = Infinity,
    max = -Infinity
  for (const feature of data.features) {
    const value = feature.properties?.[property]
    if (typeof value === 'number' && Number.isFinite(value)) {
      min = Math.min(min, value)
      max = Math.max(max, value)
    }
  }
  if (!Number.isFinite(min)) throw new Error('This field has no finite numeric values. Numeric text is not converted.')
  if (min === max)
    throw new Error('A gradient needs at least two different numeric values; set custom stop bounds instead.')
  return [min, max]
}
export function vectorGeometryTypes(data: FeatureCollection): Exclude<StyleGeometry, 'any'>[] {
  const types = new Set<Exclude<StyleGeometry, 'any'>>()
  const visit = (geometry: GeoJSON.Geometry | null) => {
    if (!geometry) return
    if (geometry.type === 'GeometryCollection') geometry.geometries.forEach(visit)
    else if (geometry.type.endsWith('Point')) types.add('point')
    else if (geometry.type.endsWith('LineString')) types.add('line')
    else if (geometry.type.endsWith('Polygon')) types.add('polygon')
  }
  data.features.forEach((feature) => visit(feature.geometry))
  return [...types]
}
