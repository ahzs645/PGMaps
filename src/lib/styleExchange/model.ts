/**
 * The one model every style format reads into and writes from: layers styled by ordered rules whose
 * symbols are the sheets' own `SheetSymbol`s, a symbol library, and a printed-sheet layout. Each
 * writer turns this into a format (QGIS, ArcGIS Pro, SLD, MapLibre, GeoLibre) and each reader turns
 * a format back into it, reporting what it could not carry as `ExchangeDiagnostic`s rather than
 * dropping it silently. No DOM or network access.
 *
 * Rules are evaluated in order and the first match draws the feature, as in the Nechako style
 * editor (`vectorRules.ts`); a rule without a filter is the "everything else" rule and must come
 * last. Formats that draw every matching rule (QGIS rule-based, SLD) get mutually exclusive filters.
 */
import type { PaperId, SheetTemplate } from '@/lib/mapSheet/layout'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'

export const STYLE_EXCHANGE_SCHEMA = 'pgmaps-style-exchange-v1'

export type GeometryKind = 'point' | 'line' | 'polygon'
export type FieldValue = string | number | boolean

/** A test on one attribute. Ranges include `min` and exclude `max`, as graduated classes do. */
export type RuleFilter =
  | { field: string; op: 'eq'; value: FieldValue }
  | { field: string; op: 'in'; values: FieldValue[] }
  | { field: string; op: 'range'; min?: number; max?: number }

export interface StyleRule {
  /** Legend text. */
  label: string
  /** Null draws every feature the rules above did not. */
  filter: RuleFilter | null
  symbol: SheetSymbol
}

export interface LabelStyle {
  field: string
  /** Text size, points. */
  size: number
  color: string
  halo?: { color: string; width: number }
  placement: 'point' | 'line'
  bold?: boolean
}

export interface StyledLayer {
  /** File-safe id, also the data file's stem: `road_centrelines` reads `road_centrelines.shp`. */
  id: string
  /** Name shown in the other application's layer list. */
  name: string
  geometry: GeometryKind
  /** Attribute names and kinds, so writers can quote literals the way each format reads them. */
  fields: { name: string; type: 'string' | 'number' | 'boolean' }[]
  rules: StyleRule[]
  label?: LabelStyle
  /** Hidden when the project opens. */
  hidden?: boolean
}

export interface StyleDocument {
  schema: typeof STYLE_EXCHANGE_SCHEMA
  name: string
  /** Drawn bottom first. */
  layers: StyledLayer[]
  /** Longitude/latitude bounds of the data, for a project's opening view. */
  extent?: [number, number, number, number]
}

export interface LibrarySymbol {
  id: string
  name: string
  /** Catalogue group title. */
  category: string
  tags: string[]
  symbol: SheetSymbol
}

export interface SymbolLibrary {
  name: string
  symbols: LibrarySymbol[]
}

/** A printed sheet to carry into another application's layout: the page, its panels and its text. */
export interface LayoutDocument {
  name: string
  paper: PaperId
  template: SheetTemplate
  title: string
  subtitle?: string
  /** Map scale denominator for the main frame. */
  scale?: number
  /** Longitude/latitude bounds shown in the main frame. */
  extent?: [number, number, number, number]
}

export type ExchangeFormat =
  | 'qml'
  | 'qgis-style'
  | 'qgs'
  | 'qpt'
  | 'sld'
  | 'maplibre'
  | 'geolibre'
  | 'lyrx'
  | 'mapx'
  | 'pagx'
  | 'stylx'

export interface ExchangeDiagnostic {
  severity: 'info' | 'warning' | 'error'
  format: ExchangeFormat
  /** Layer, rule or symbol the message is about. */
  subject?: string
  message: string
}

/** A written file: its path inside the export and its bytes or text. */
export interface ExchangeFile {
  path: string
  content: string | Uint8Array
  mime: string
}

export interface WriteResult {
  files: ExchangeFile[]
  diagnostics: ExchangeDiagnostic[]
}

/** What a reader found: styled layers when the file had them, symbols always, and every loss. */
export interface ReadResult {
  format: ExchangeFormat
  layers: StyledLayer[]
  symbols: LibrarySymbol[]
  layouts: LayoutDocument[]
  diagnostics: ExchangeDiagnostic[]
}

export const geometryOfSymbol = (symbol: SheetSymbol): GeometryKind =>
  symbol.kind === 'line' ? 'line' : symbol.kind === 'point' ? 'point' : 'polygon'

/** Whether `filter` matches a feature's properties, by the same typed rules the writers encode. */
export function filterMatches(filter: RuleFilter | null, properties: Record<string, unknown>): boolean {
  if (!filter) return true
  const value = properties[filter.field]
  if (filter.op === 'eq') return value === filter.value
  if (filter.op === 'in') return filter.values.some((candidate) => candidate === value)
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  return (filter.min === undefined || value >= filter.min) && (filter.max === undefined || value < filter.max)
}

/** The rule that draws a feature: the first whose filter matches. */
export function ruleFor(layer: StyledLayer, properties: Record<string, unknown>): StyleRule | undefined {
  return layer.rules.find((rule) => filterMatches(rule.filter, properties))
}

/** Problems that make a document unsafe to write, as messages; empty when it is sound. */
export function documentProblems(document: StyleDocument): string[] {
  const problems: string[] = []
  const ids = new Set<string>()
  for (const layer of document.layers) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,62}$/.test(layer.id))
      problems.push(`Layer id "${layer.id}" must be a letter followed by letters, digits or underscores.`)
    if (ids.has(layer.id)) problems.push(`Layer id "${layer.id}" is used twice.`)
    ids.add(layer.id)
    if (!layer.rules.length) problems.push(`${layer.name} has no rules.`)
    layer.rules.forEach((rule, index) => {
      if (!rule.filter && index !== layer.rules.length - 1)
        problems.push(`${layer.name}: "${rule.label}" has no filter, so it must be the last rule.`)
      if (geometryOfSymbol(rule.symbol) !== layer.geometry && rule.symbol.kind !== 'class')
        problems.push(`${layer.name}: "${rule.label}" is a ${rule.symbol.kind} symbol on a ${layer.geometry} layer.`)
      const field = rule.filter?.field
      if (field && !layer.fields.some((f) => f.name === field))
        problems.push(`${layer.name}: "${rule.label}" filters on ${field}, which the layer does not have.`)
    })
    if (layer.label && !layer.fields.some((f) => f.name === layer.label!.field))
      problems.push(`${layer.name} labels with ${layer.label.field}, which the layer does not have.`)
  }
  return problems
}

/** File-safe stem for a name. */
export const safeFileStem = (name: string) =>
  name
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'style'
