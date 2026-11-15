/**
 * What the web and OGC formats (SLD, MapLibre, GeoLibre) share: when two rules can never match the
 * same feature, so a writer can leave out the "and not the rules above" clause that turns
 * first-match rules into draw-every-match ones; field kinds read back from literals; layer ids
 * made safe from another application's names; and diagnostics. No DOM or network access.
 */
import type {
  ExchangeDiagnostic,
  ExchangeFormat,
  FieldValue,
  GeometryKind,
  RuleFilter,
  StyleRule,
  StyledLayer,
} from '../model'

export type Diagnose = (severity: ExchangeDiagnostic['severity'], message: string, subject?: string) => void

/** A diagnostics list and the function that adds to it, for one format. */
export function diagnostics(format: ExchangeFormat): { list: ExchangeDiagnostic[]; add: Diagnose } {
  const list: ExchangeDiagnostic[] = []
  return {
    list,
    add: (severity, message, subject) => list.push({ severity, format, ...(subject ? { subject } : {}), message }),
  }
}

/** The values a filter matches, when it is a list of exact values. */
const exactValues = (filter: RuleFilter): FieldValue[] | null =>
  filter.op === 'eq' ? [filter.value] : filter.op === 'in' ? filter.values : null

const inRange = (value: FieldValue, filter: Extract<RuleFilter, { op: 'range' }>) =>
  typeof value === 'number' &&
  (filter.min === undefined || value >= filter.min) &&
  (filter.max === undefined || value < filter.max)

/**
 * Whether no feature can match both filters. Only provable cases answer true: two filters on one
 * field with no value in common. Filters on different fields may overlap.
 */
export function filtersDisjoint(a: RuleFilter, b: RuleFilter): boolean {
  if (a.field !== b.field) return false
  const av = exactValues(a),
    bv = exactValues(b)
  if (av && bv) return !av.some((x) => bv.some((y) => x === y))
  if (av && b.op === 'range') return !av.some((x) => inRange(x, b))
  if (bv && a.op === 'range') return !bv.some((x) => inRange(x, a))
  if (a.op === 'range' && b.op === 'range') {
    const lowA = a.min ?? -Infinity,
      highA = a.max ?? Infinity
    const lowB = b.min ?? -Infinity,
      highB = b.max ?? Infinity
    return highA <= lowB || highB <= lowA
  }
  return false
}

/**
 * For each rule, the earlier rules' filters it must exclude to keep first-match meaning in a
 * format that draws every matching rule: those it is not provably disjoint from. The else rule
 * (null filter) excludes every earlier filter.
 */
export function exclusions(rules: readonly StyleRule[]): RuleFilter[][] {
  return rules.map((rule, index) => {
    const earlier = rules.slice(0, index).flatMap((r) => (r.filter ? [r.filter] : []))
    return rule.filter ? earlier.filter((f) => !filtersDisjoint(f, rule.filter!)) : earlier
  })
}

export const sameFilter = (a: RuleFilter | null, b: RuleFilter | null) => JSON.stringify(a) === JSON.stringify(b)

/** A layer id the model accepts, from another application's name. */
export function safeLayerId(name: string, taken: Set<string>): string {
  let base =
    name
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 56) || 'layer'
  if (!/^[A-Za-z]/.test(base)) base = `l_${base}`
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  taken.add(id)
  return id
}

/** The kind of a literal as JSON or a typed reader gave it. */
export const valueKind = (value: FieldValue): 'string' | 'number' | 'boolean' =>
  typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string'

/** Fields a layer's rules and label use, typed from the literals, with known types winning. */
export function fieldsFromRules(
  rules: readonly StyleRule[],
  labelField?: string,
  known: Record<string, 'string' | 'number' | 'boolean'> = {},
): StyledLayer['fields'] {
  const fields = new Map<string, 'string' | 'number' | 'boolean'>()
  for (const rule of rules) {
    const filter = rule.filter
    if (!filter) continue
    const kind =
      known[filter.field] ??
      (filter.op === 'range' ? 'number' : valueKind(filter.op === 'eq' ? filter.value : (filter.values[0] ?? '')))
    if (!fields.has(filter.field)) fields.set(filter.field, kind)
  }
  if (labelField && !fields.has(labelField)) fields.set(labelField, known[labelField] ?? 'string')
  return [...fields].map(([name, type]) => ({ name, type }))
}

/** Field kinds from GeoJSON properties: a field holding more than one kind is a string. */
export function fieldKindsFromData(
  data: GeoJSON.FeatureCollection | undefined,
): Record<string, 'string' | 'number' | 'boolean'> {
  const kinds: Record<string, 'string' | 'number' | 'boolean'> = {}
  for (const feature of data?.features ?? [])
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      if (value === null || value === undefined) continue
      const kind = typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string'
      kinds[key] = kinds[key] && kinds[key] !== kind ? 'string' : kind
    }
  return kinds
}

/** The layer's geometry from a GeoJSON collection's first feature, or null when it has none. */
export function geometryOfData(data: GeoJSON.FeatureCollection | undefined): GeometryKind | null {
  const type = data?.features.find((f) => f.geometry)?.geometry?.type
  if (!type) return null
  if (type.endsWith('Point')) return 'point'
  if (type.endsWith('LineString')) return 'line'
  if (type.endsWith('Polygon')) return 'polygon'
  return null
}

/** Rounds to `digits` decimals, for values read back through unit conversions. */
export const round = (value: number, digits = 3) => {
  const r = Number(value.toFixed(digits))
  return Object.is(r, -0) ? 0 : r
}

/** Whether a layer's rules match by the model's rules: an else rule only last, filters on fields. */
export function sortedRules(rules: StyleRule[], add: Diagnose, subject: string): StyleRule[] {
  const others = rules.filter((r) => r.filter)
  const elses = rules.filter((r) => !r.filter)
  if (elses.length > 1)
    add(
      'warning',
      `${elses.length} rules draw every feature; the first is kept as the "everything else" rule and the others are dropped.`,
      subject,
    )
  if (elses.length && rules.indexOf(elses[0]) !== rules.length - 1)
    add(
      'warning',
      `"${elses[0].label}" draws every feature but is not the last rule; it is moved last, so it now draws only what the other rules do not.`,
      subject,
    )
  return [...others, ...elses.slice(0, 1)]
}

/** Overlap warnings for rules read from a format that draws every matching rule. */
export function warnOverlaps(rules: readonly StyleRule[], add: Diagnose, subject: string) {
  for (let j = 1; j < rules.length; j++) {
    const b = rules[j].filter
    if (!b) continue
    for (let i = 0; i < j; i++) {
      const a = rules[i].filter
      if (a && !filtersDisjoint(a, b)) {
        add(
          'warning',
          `"${rules[i].label}" and "${rules[j].label}" can match the same feature: the source draws both, PGMaps draws only "${rules[i].label}".`,
          subject,
        )
        break
      }
    }
  }
}

type Raw = Record<string, unknown>
const isObject = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value)
const isFieldValue = (value: unknown): value is FieldValue =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

function checkedFilter(value: unknown): RuleFilter | null {
  if (value === null) return null
  if (!isObject(value) || typeof value.field !== 'string' || !value.field) throw Error('A rule filter is malformed.')
  const field = value.field
  if (value.op === 'eq' && isFieldValue(value.value)) return { field, op: 'eq', value: value.value }
  if (value.op === 'in' && Array.isArray(value.values) && value.values.every(isFieldValue))
    return { field, op: 'in', values: value.values }
  const bound = (b: unknown) => b === undefined || (typeof b === 'number' && Number.isFinite(b))
  if (value.op === 'range' && bound(value.min) && bound(value.max))
    return {
      field,
      op: 'range',
      ...(value.min !== undefined ? { min: value.min as number } : {}),
      ...(value.max !== undefined ? { max: value.max as number } : {}),
    }
  throw Error(`The filter on ${field} is malformed.`)
}

/**
 * A styled layer carried inside another format by PGMaps itself (SLD comment, MapLibre layer
 * metadata), checked field by field. Throws an Error naming the first problem.
 */
export function checkedLayer(value: unknown, checkSymbol: (value: unknown) => StyleRule['symbol']): StyledLayer {
  if (!isObject(value)) throw Error('The layer is not an object.')
  const { id, name, geometry, fields, rules, label, hidden } = value
  if (typeof id !== 'string' || typeof name !== 'string') throw Error('The layer has no id or name.')
  if (geometry !== 'point' && geometry !== 'line' && geometry !== 'polygon')
    throw Error('The layer geometry is unknown.')
  if (!Array.isArray(fields) || !Array.isArray(rules) || !rules.length) throw Error('The layer has no fields or rules.')
  const layer: StyledLayer = {
    id,
    name,
    geometry,
    fields: fields.map((f) => {
      if (!isObject(f) || typeof f.name !== 'string' || !['string', 'number', 'boolean'].includes(String(f.type)))
        throw Error('A field is malformed.')
      return { name: f.name, type: f.type as 'string' | 'number' | 'boolean' }
    }),
    rules: rules.map((r) => {
      if (!isObject(r) || typeof r.label !== 'string') throw Error('A rule is malformed.')
      return { label: r.label, filter: checkedFilter(r.filter ?? null), symbol: checkSymbol(r.symbol) }
    }),
  }
  if (label !== undefined) {
    if (
      !isObject(label) ||
      typeof label.field !== 'string' ||
      typeof label.size !== 'number' ||
      typeof label.color !== 'string' ||
      (label.placement !== 'point' && label.placement !== 'line')
    )
      throw Error('The label is malformed.')
    const halo = label.halo
    if (halo !== undefined && (!isObject(halo) || typeof halo.color !== 'string' || typeof halo.width !== 'number'))
      throw Error('The label halo is malformed.')
    layer.label = {
      field: label.field,
      size: label.size,
      color: label.color,
      placement: label.placement,
      ...(halo ? { halo: { color: halo.color as string, width: halo.width as number } } : {}),
      ...(label.bold === true ? { bold: true } : {}),
    }
  }
  if (hidden === true) layer.hidden = true
  return layer
}
