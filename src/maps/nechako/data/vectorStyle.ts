import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification } from 'maplibre-gl'

export type CategoryValue = string | number | boolean | null
export type CategoryStyle = { property: string; rules: { value: CategoryValue; color: string }[]; fallback: string }
const palette = ['#2563eb', '#d97706', '#16a34a', '#9333ea', '#dc2626', '#0891b2', '#be185d', '#64748b']
export const categoryKey = (value: CategoryValue) => `${typeof value}:${JSON.stringify(value)}`
export const categoryLabel = (value: CategoryValue) =>
  value === null ? 'Missing / null' : `${String(value)} (${typeof value})`
export function checkedCategoryStyle(value: unknown): CategoryStyle {
  const style = value as CategoryStyle
  const color = (value: unknown) => typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value)
  if (
    !style ||
    typeof style.property !== 'string' ||
    !style.property ||
    !color(style.fallback) ||
    !Array.isArray(style.rules) ||
    style.rules.length > 40
  )
    throw new Error('Invalid category style (maximum 40 categories).')
  const keys = new Set<string>()
  for (const rule of style.rules) {
    if (
      !rule ||
      !color(rule.color) ||
      !(
        rule.value === null ||
        typeof rule.value === 'string' ||
        typeof rule.value === 'boolean' ||
        (typeof rule.value === 'number' && Number.isFinite(rule.value))
      )
    )
      throw new Error('Category values must be finite scalar values and colors must be hexadecimal.')
    const key = categoryKey(rule.value)
    if (keys.has(key)) throw new Error('Duplicate typed category value.')
    keys.add(key)
  }
  return style
}
export function makeCategoryStyle(data: FeatureCollection, property: string, fallback: string): CategoryStyle {
  const values = new Map<string, CategoryValue>()
  for (const feature of data.features) {
    const value = feature.properties?.[property] ?? null
    if (!(value === null || ['string', 'number', 'boolean'].includes(typeof value)))
      throw new Error('This field contains objects or arrays; choose a scalar field.')
    values.set(categoryKey(value), value)
    if (values.size > 40) throw new Error('This field has more than 40 categories. Choose a field with fewer values.')
  }
  return checkedCategoryStyle({
    property,
    fallback,
    rules: [...values.values()].map((value, index) => ({ value, color: palette[index % palette.length] })),
  })
}
export function categoryColor(style: CategoryStyle | undefined, fallback: string): string | ExpressionSpecification {
  if (!style?.rules.length) return fallback
  return [
    'case',
    ...style.rules.flatMap((rule) => [['==', ['get', style.property], ['literal', rule.value]], rule.color]),
    style.fallback,
  ] as ExpressionSpecification
}
/** URL SLDs are references only; inline SLD expressions/filters cannot safely be translated into category rules. */
export function checkedSldUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.username || url.password)
    throw new Error('SLD references must use HTTPS without embedded credentials.')
  return url.href
}
