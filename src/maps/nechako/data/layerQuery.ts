import type { FeatureCollection } from 'geojson'
export type QueryScalar = string | number | boolean | null
export type LayerPredicate = {
  kind: 'rule'
  field: string
  operator: 'eq' | 'ne' | 'lt' | 'lte' | 'gt' | 'gte' | 'between' | 'contains' | 'starts' | 'is-null' | 'is-not-null'
  value?: QueryScalar
  upper?: QueryScalar
}
export type LayerQueryGroup = { kind: 'group'; match: 'all' | 'any'; negate?: boolean; children: LayerQueryNode[] }
export type LayerQueryNode = LayerPredicate | LayerQueryGroup
export type LayerQuery = { schema: 'nechako-layer-query-v1'; expression: LayerQueryNode }
export const LAYER_QUERY_OPERATORS = {
  eq: 'Equals',
  ne: 'Does not equal',
  lt: 'Less than',
  lte: 'Less or equal',
  gt: 'Greater than',
  gte: 'Greater or equal',
  between: 'Between (inclusive)',
  contains: 'Contains text',
  starts: 'Starts with',
  'is-null': 'Missing / null',
  'is-not-null': 'Has a value',
} as const
const scalar = (value: unknown): value is QueryScalar =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))
export function checkedLayerQuery(input: unknown): LayerQuery {
  const query = input as LayerQuery
  if (!query || query.schema !== 'nechako-layer-query-v1') throw new Error('Not a local layer query.')
  let rules = 0
  const node = (value: LayerQueryNode, depth: number) => {
    if (!value || typeof value !== 'object' || depth > 10 || ++rules > 100)
      throw new Error('Queries support at most 100 nodes and 10 nested groups.')
    if (value.kind === 'group') {
      if (
        !['all', 'any'].includes(value.match) ||
        !Array.isArray(value.children) ||
        !value.children.length ||
        (value.negate !== undefined && typeof value.negate !== 'boolean')
      )
        throw new Error('Each query group needs conditions and an All/Any match.')
      value.children.forEach((child) => node(child, depth + 1))
      return
    }
    if (
      value.kind !== 'rule' ||
      typeof value.field !== 'string' ||
      !value.field ||
      value.field.length > 250 ||
      !Object.prototype.hasOwnProperty.call(LAYER_QUERY_OPERATORS, value.operator)
    )
      throw new Error('Choose an actual field and a supported comparison.')
    if (value.operator === 'is-null' || value.operator === 'is-not-null') return
    if (!scalar(value.value)) throw new Error('Comparison values must be finite numbers, strings, booleans or null.')
    if (['contains', 'starts'].includes(value.operator) && typeof value.value !== 'string')
      throw new Error('Text comparisons require a string value.')
    if (['lt', 'lte', 'gt', 'gte', 'between'].includes(value.operator) && typeof value.value !== 'number')
      throw new Error('Ordered comparisons require a numeric value.')
    if (
      value.operator === 'between' &&
      (typeof value.upper !== 'number' || !Number.isFinite(value.upper) || (value.value as number) > value.upper)
    )
      throw new Error('A numeric range needs a finite upper value at least as large as its lower value.')
  }
  node(query.expression, 0)
  return query
}
export function layerQueryMatches(properties: Record<string, unknown> | null, query: LayerQueryNode): boolean {
  if (query.kind === 'group') {
    const result =
      query.match === 'all'
        ? query.children.every((child) => layerQueryMatches(properties, child))
        : query.children.some((child) => layerQueryMatches(properties, child))
    return query.negate ? !result : result
  }
  const value =
    properties && Object.prototype.hasOwnProperty.call(properties, query.field) ? properties[query.field] : undefined
  if (query.operator === 'is-null') return value === undefined || value === null
  if (query.operator === 'is-not-null') return value !== undefined && value !== null
  if (!scalar(value)) return false
  if (query.operator === 'eq') return value === query.value
  if (query.operator === 'ne') return value !== null && typeof value === typeof query.value && value !== query.value
  if (query.operator === 'contains') return typeof value === 'string' && value.includes(query.value as string)
  if (query.operator === 'starts') return typeof value === 'string' && value.startsWith(query.value as string)
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  const target = query.value as number
  if (query.operator === 'lt') return value < target
  if (query.operator === 'lte') return value <= target
  if (query.operator === 'gt') return value > target
  if (query.operator === 'gte') return value >= target
  return value >= target && value <= (query.upper as number)
}
export function queryLayer(data: FeatureCollection, input: LayerQuery): FeatureCollection {
  const query = checkedLayerQuery(input)
  return {
    ...data,
    features: data.features.filter((feature) => layerQueryMatches(feature.properties, query.expression)),
  }
}
export function layerQueryFields(data: FeatureCollection): string[] {
  return [...new Set(data.features.flatMap((feature) => Object.keys(feature.properties ?? {})))].sort((a, b) =>
    a.localeCompare(b),
  )
}
export function displayLayerQuery(node: LayerQueryNode): string {
  if (node.kind === 'group')
    return `${node.negate ? 'NOT ' : ''}(${node.children.map(displayLayerQuery).join(node.match === 'all' ? ' AND ' : ' OR ')})`
  const field = JSON.stringify(node.field)
  if (node.operator === 'is-null') return `${field} IS MISSING OR NULL`
  if (node.operator === 'is-not-null') return `${field} HAS VALUE`
  return `${field} ${LAYER_QUERY_OPERATORS[node.operator]} ${JSON.stringify(node.value)}${node.operator === 'between' ? ` AND ${JSON.stringify(node.upper)}` : ''}`
}
