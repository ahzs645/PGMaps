/**
 * An attribute schema for GeoJSON layers whose columns are not known up front:
 * each column's type, display name and number format, and summary statistics.
 *
 * Felt keeps the same thing in a layer's style (`attributes.<column>.displayName`
 * and `format`) and reuses it for the table, popups, tooltips and widgets, so a
 * column reads the same everywhere. Keep this module free of DOM access.
 */
import { DEFAULT_LOCALE, formatArea, formatLength } from '@/lib/format'

export type AttributeType = 'text' | 'numeric' | 'datetime'

export type AttributeFormat =
  | { kind: 'number'; digits?: number; prefix?: string; suffix?: string; grouping?: boolean }
  /** Square metres, shown as m² or hectares. */
  | { kind: 'area' }
  /** Metres, shown as m or km. */
  | { kind: 'length' }
  /** Epoch milliseconds or an ISO string, shown as a calendar date. */
  | { kind: 'date' }
  | { kind: 'text' }

export interface AttributeSchema {
  key: string
  label: string
  type: AttributeType
  format?: AttributeFormat
  /** Bookkeeping columns (OBJECTID, GlobalID…): kept last in the table, left out of popups. */
  system?: boolean
}

export type AttributeOverride = Partial<Omit<AttributeSchema, 'key'>> & { key: string }

export interface ColumnStats {
  key: string
  type: AttributeType
  /** Rows with a value. */
  count: number
  missing: number
  distinct: number
  min?: number
  max?: number
  median?: number
  mean?: number
  sum?: number
  /** Most frequent values, most common first. */
  topValues: Array<{ value: string; count: number }>
}

const SYSTEM_KEYS = new Set([
  'objectid',
  'fid',
  'globalid',
  'created_user',
  'created_date',
  'last_edited_user',
  'last_edited_date',
  'shape__area',
  'shape__length',
  'shape_area',
  'shape_length',
])

/** Plausible epoch-millisecond window for a date column: 1900–2100. */
const EPOCH_MIN = Date.UTC(1900, 0, 1)
const EPOCH_MAX = Date.UTC(2100, 0, 1)

/** "InstallDate" → "Install date", "SubType_TEXT" → "Sub type", "Height_m" → "Height m". */
export function humanizeKey(key: string): string {
  const special: Record<string, string> = {
    shape__area: 'Area (source)',
    shape__length: 'Length (source)',
    objectid: 'Object ID',
    globalid: 'Global ID',
  }
  const known = special[key.toLowerCase()]
  if (known) return known
  const words = key
    .replace(/_TEXT$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .split(/\s+/)
  return words
    .map((word, index) => {
      if (/^[A-Z\d]{2,}$/.test(word)) return word
      const lower = word.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(' ')
}

function isEmpty(value: unknown): boolean {
  return value == null || (typeof value === 'string' && value.trim() === '')
}

function looksLikeDateKey(key: string): boolean {
  return /date|time|_dt$|installed|built/i.test(key)
}

/**
 * Infers each property's type from the values present, then applies overrides.
 * Columns starting with `__` are internal (feature ids) and never listed.
 */
export function inferAttributes(
  features: ReadonlyArray<{ properties: Record<string, unknown> | null }>,
  overrides: readonly AttributeOverride[] = [],
): AttributeSchema[] {
  const seen = new Map<string, { numeric: number; text: number; epoch: number; isoDate: number }>()
  for (const feature of features) {
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      if (key.startsWith('__')) continue
      let entry = seen.get(key)
      if (!entry) {
        entry = { numeric: 0, text: 0, epoch: 0, isoDate: 0 }
        seen.set(key, entry)
      }
      if (isEmpty(value)) continue
      if (typeof value === 'number' && Number.isFinite(value)) {
        entry.numeric += 1
        if (value >= EPOCH_MIN && value <= EPOCH_MAX && Math.abs(value) > 1e10) entry.epoch += 1
      } else if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(value.trim())) {
        entry.isoDate += 1
      } else {
        entry.text += 1
      }
    }
  }

  const inferred: AttributeSchema[] = []
  for (const [key, counts] of seen) {
    const lower = key.toLowerCase()
    let type: AttributeType = 'text'
    let format: AttributeFormat | undefined
    if (counts.text === 0 && counts.isoDate === 0 && counts.numeric > 0) {
      const mostlyEpoch = counts.epoch > 0 && counts.epoch >= counts.numeric * 0.9
      if (mostlyEpoch && looksLikeDateKey(key)) {
        type = 'datetime'
        format = { kind: 'date' }
      } else {
        type = 'numeric'
        if (lower === 'shape__area' || lower === 'shape_area') format = { kind: 'area' }
        else if (lower === 'shape__length' || lower === 'shape_length') format = { kind: 'length' }
      }
    } else if (counts.text === 0 && counts.isoDate > 0) {
      type = 'datetime'
      format = { kind: 'date' }
    }
    // Identifiers are numbers, but adding them up or classing them means nothing.
    const identifier = type === 'numeric' && /(^|_)(objectid|fid|id)$/i.test(key)
    if (identifier) format = { kind: 'number', digits: 0, grouping: false }
    inferred.push({
      key,
      label: humanizeKey(key),
      type,
      ...(format ? { format } : {}),
      ...(SYSTEM_KEYS.has(lower) || /^globalid$/i.test(key) ? { system: true } : {}),
    })
  }

  const overrideByKey = new Map(overrides.map((override) => [override.key, override]))
  const merged = inferred.map((attribute) => ({ ...attribute, ...overrideByKey.get(attribute.key) }))
  // Overrides list the curated columns in their preferred order; the rest follow,
  // with bookkeeping columns last.
  const rank = (attribute: AttributeSchema) => {
    const index = overrides.findIndex((override) => override.key === attribute.key)
    if (index >= 0) return index
    return overrides.length + (attribute.system ? 10_000 : 0)
  }
  return merged
    .map((attribute, index) => ({ attribute, index }))
    .sort((a, b) => rank(a.attribute) - rank(b.attribute) || a.index - b.index)
    .map(({ attribute }) => attribute)
}

function toEpoch(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

/** Numeric value for sorting, classing and aggregation; null when the cell is empty. */
export function attributeNumber(value: unknown, attribute: Pick<AttributeSchema, 'type'>): number | null {
  if (isEmpty(value)) return null
  if (attribute.type === 'datetime') {
    const epoch = toEpoch(value)
    return epoch != null && epoch >= EPOCH_MIN && epoch <= EPOCH_MAX ? epoch : null
  }
  if (attribute.type === 'numeric') {
    const numeric = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numeric) ? numeric : null
  }
  return null
}

/** Comparable value for sorting a column; empty cells sort as null (last). */
export function attributeSortValue(value: unknown, attribute: Pick<AttributeSchema, 'type'>): number | string | null {
  if (attribute.type === 'text') return isEmpty(value) ? null : String(value).trim().toLowerCase()
  return attributeNumber(value, attribute)
}

/** Stable text key for grouping a value into a category. */
export function attributeCategory(value: unknown): string | null {
  if (isEmpty(value)) return null
  return String(value).trim()
}

/** A number formatted with the attribute's own format, ignoring the column type. */
export function formatAttributeNumber(value: number, format?: AttributeFormat): string {
  if (format?.kind === 'area') return formatArea(value) || '0 m²'
  if (format?.kind === 'length') return formatLength(value) || '0 m'
  const digits = format?.kind === 'number' ? format.digits : undefined
  const text = value.toLocaleString(DEFAULT_LOCALE, {
    maximumFractionDigits: digits ?? (Math.abs(value) >= 100 ? 0 : 2),
    minimumFractionDigits: digits != null ? Math.min(digits, 2) : 0,
    useGrouping: !(format?.kind === 'number' && format.grouping === false),
  })
  if (format?.kind === 'number') return `${format.prefix ?? ''}${text}${format.suffix ?? ''}`
  return text
}

/** A cell as text: dates as calendar dates, numbers in the attribute's format, '' when empty. */
export function formatAttribute(value: unknown, attribute: Pick<AttributeSchema, 'type' | 'format'>): string {
  if (isEmpty(value)) return ''
  if (attribute.type === 'datetime' || attribute.format?.kind === 'date') {
    const epoch = attributeNumber(value, { type: 'datetime' })
    if (epoch == null) return ''
    const date = new Date(epoch)
    const pad = (part: number) => String(part).padStart(2, '0')
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
  }
  if (attribute.type === 'numeric') {
    const numeric = attributeNumber(value, attribute)
    return numeric == null ? String(value) : formatAttributeNumber(numeric, attribute.format)
  }
  return String(value).trim()
}

/** Count, distinct values, numeric summary and the most common values for one column. */
export function columnStats(
  features: ReadonlyArray<{ properties: Record<string, unknown> | null }>,
  attribute: Pick<AttributeSchema, 'key' | 'type'>,
  topCount = 8,
): ColumnStats {
  const counts = new Map<string, number>()
  const numbers: number[] = []
  let missing = 0
  for (const feature of features) {
    const value = feature.properties?.[attribute.key]
    const category = attributeCategory(value)
    if (category == null) {
      missing += 1
      continue
    }
    counts.set(category, (counts.get(category) ?? 0) + 1)
    const numeric = attributeNumber(value, attribute)
    if (numeric != null) numbers.push(numeric)
  }

  const topValues = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, topCount)
    .map(([value, count]) => ({ value, count }))
  const stats: ColumnStats = {
    key: attribute.key,
    type: attribute.type,
    count: features.length - missing,
    missing,
    distinct: counts.size,
    topValues,
  }
  if (numbers.length > 0) {
    numbers.sort((a, b) => a - b)
    const middle = Math.floor(numbers.length / 2)
    const sum = numbers.reduce((total, value) => total + value, 0)
    stats.min = numbers[0]
    stats.max = numbers[numbers.length - 1]
    stats.median = numbers.length % 2 ? numbers[middle] : (numbers[middle - 1] + numbers[middle]) / 2
    stats.sum = sum
    stats.mean = sum / numbers.length
  }
  return stats
}

/** Numeric values of a column, empty cells dropped. */
export function columnNumbers(
  features: ReadonlyArray<{ properties: Record<string, unknown> | null }>,
  attribute: Pick<AttributeSchema, 'key' | 'type'>,
): number[] {
  const values: number[] = []
  for (const feature of features) {
    const numeric = attributeNumber(feature.properties?.[attribute.key], attribute)
    if (numeric != null) values.push(numeric)
  }
  return values
}

/** Columns worth offering for "style by category" or a category filter. */
export function isCategoryCandidate(attribute: AttributeSchema, stats?: ColumnStats): boolean {
  if (attribute.system || attribute.type === 'datetime') return false
  if (!stats) return attribute.type === 'text'
  return stats.distinct >= 2 && stats.distinct <= 40 && stats.distinct < Math.max(3, stats.count * 0.8)
}

/** Columns worth classing by value: numeric, not an identifier. */
export function isMeasureCandidate(attribute: AttributeSchema): boolean {
  if (attribute.system && attribute.format?.kind !== 'area' && attribute.format?.kind !== 'length') return false
  if (attribute.type !== 'numeric') return false
  return !(attribute.format?.kind === 'number' && attribute.format.grouping === false)
}
