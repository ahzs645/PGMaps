/**
 * Reads ArcGIS Pro files into the style model: layer files (`.lyrx`), maps (`.mapx`), layouts
 * (`.pagx`), styles (`.stylx`) and bare CIM JSON. Feature layers' simple, unique-value (one field,
 * a class of several values reads as `in`) and class-breaks renderers become ordered rules, and the
 * Arcade `When()` renderer PGMaps writes reads back to its rules; label classes with a plain field
 * expression become labels; a layout becomes a sheet template with its panels as page fractions.
 * Everything not carried is a diagnostic, and nothing is classified by the data's geometry: a
 * layer's kind comes from its renderer's symbols. Names follow the CIM specification
 * (github.com/Esri/cim-spec, v3). No DOM or network access.
 */
import type { SqlJsStatic } from 'sql.js'
import { PAPER_SIZES, type FractionRect, type PanelId, type PaperId, type SheetTemplate } from '@/lib/mapSheet/layout'
import type {
  ExchangeDiagnostic,
  ExchangeFormat,
  FieldValue,
  GeometryKind,
  LabelStyle,
  LayoutDocument,
  ReadResult,
  RuleFilter,
  StyledLayer,
  StyleRule,
} from '../model'
import { geometryOfSymbol } from '../model'
import { toHex, toHexAlpha } from '../color'
import { sheetSymbolFromCim } from './cim'
import { colorFromCim, diagnostic, finite, isRecord, nextAfter, records, text, trim, type Json } from './cimCommon'
import { RULE_EXPRESSION_TITLE } from './lyrx'
import { unprojectBox, wkidOf } from './projection'
import { readStylx } from './stylx'

/** Largest JSON file read. */
export const MAX_CIM_BYTES = 50 * 1024 * 1024

interface Context {
  format: ExchangeFormat
  diagnostics: ExchangeDiagnostic[]
}
const say = (ctx: Context, severity: ExchangeDiagnostic['severity'], message: string, subject?: string) =>
  ctx.diagnostics.push(diagnostic(ctx.format, severity, message, subject))

// ---------------------------------------------------------------------------------------------
// Arcade: the rule expression PGMaps writes, and nothing else

type Token = { kind: 'string' | 'number' | 'word' | 'punct'; value: string }

function tokens(source: string): Token[] | null {
  const out: Token[] = []
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (/\s/.test(c)) {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      let value = ''
      i++
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') {
          const next = source[i + 1]
          value += next === 'n' ? '\n' : next === 'r' ? '\r' : next
          i += 2
        } else value += source[i++]
      }
      if (source[i] !== c) return null
      i++
      out.push({ kind: 'string', value })
      continue
    }
    const number = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(source.slice(i))
    if (number) {
      out.push({ kind: 'number', value: number[0] })
      i += number[0].length
      continue
    }
    const word = /^\$?[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i))
    if (word) {
      out.push({ kind: 'word', value: word[0] })
      i += word[0].length
      continue
    }
    const punct = /^(==|>=|<=|&&|[()[\],.<>])/.exec(source.slice(i))
    if (!punct) return null
    out.push({ kind: 'punct', value: punct[0] })
    i += punct[0].length
  }
  return out
}

/** The filters of `When(test, "0", …, null)` as `rulesExpression` writes it, or null. */
export function parseRulesExpression(source: string): { filters: RuleFilter[]; keys: string[] } | null {
  const list = tokens(source)
  if (!list) return null
  let at = 0
  const peek = () => list[at]
  const take = (kind?: Token['kind'], value?: string) => {
    const token = list[at]
    if (!token || (kind && token.kind !== kind) || (value !== undefined && token.value !== value)) throw Error('syntax')
    at++
    return token
  }
  const ref = () => {
    take('word', '$feature')
    if (peek()?.value === '.') {
      take('punct', '.')
      return take('word').value
    }
    take('punct', '[')
    const name = take('string').value
    take('punct', ']')
    return name
  }
  const literal = (): FieldValue => {
    const token = take()
    if (token.kind === 'string') return token.value
    if (token.kind === 'number') return Number(token.value)
    if (token.kind === 'word' && (token.value === 'true' || token.value === 'false')) return token.value === 'true'
    throw Error('syntax')
  }
  const condition = (): RuleFilter => {
    let field: string | undefined
    let range: { min?: number; max?: number; number?: boolean } | undefined
    let single: RuleFilter | undefined
    const one = (name: string) => {
      if (field !== undefined && field !== name) throw Error('two fields')
      field = name
    }
    for (;;) {
      const token = peek()
      if (token?.value === 'Includes') {
        take()
        take('punct', '(')
        take('punct', '[')
        const values = [literal()]
        while (peek()?.value === ',') {
          take()
          values.push(literal())
        }
        take('punct', ']')
        take('punct', ',')
        const name = ref()
        take('punct', ')')
        one(name)
        if (single || range) throw Error('mixed')
        single = { field: name, op: 'in', values }
      } else if (token?.value === 'TypeOf') {
        take()
        take('punct', '(')
        const name = ref()
        take('punct', ')')
        take('punct', '==')
        if (take('string').value !== 'Number') throw Error('type')
        one(name)
        range = { ...range, number: true }
      } else {
        const name = ref()
        const op = take('punct').value
        one(name)
        if (op === '==') {
          if (single || range) throw Error('mixed')
          single = { field: name, op: 'eq', value: literal() }
        } else if (op === '>=' || op === '<') {
          const bound = Number(take('number').value)
          range = { ...range, ...(op === '>=' ? { min: bound } : { max: bound }) }
        } else throw Error('operator')
      }
      if (peek()?.value !== '&&') break
      take()
    }
    if (single) {
      if (range) throw Error('mixed')
      return single
    }
    if (!range || field === undefined) throw Error('empty')
    return {
      field,
      op: 'range',
      ...(range.min !== undefined ? { min: range.min } : {}),
      ...(range.max !== undefined ? { max: range.max } : {}),
    }
  }
  try {
    take('word', 'When')
    take('punct', '(')
    const filters: RuleFilter[] = []
    const keys: string[] = []
    for (;;) {
      if (peek()?.kind === 'word' && peek()?.value === 'null') {
        take()
        break
      }
      filters.push(condition())
      take('punct', ',')
      keys.push(take('string').value)
      take('punct', ',')
    }
    take('punct', ')')
    if (at !== list.length || !filters.length) return null
    return { filters, keys }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Layers

const RESERVED_FIELDS = /^(fid|objectid|shape|shape_length|shape_area|shape\.stlength\(\)|shape\.starea\(\))$/i

function layerId(raw: string, used: Set<string>): string {
  let base = raw
    .replace(/\.[A-Za-z]+$/, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!/^[A-Za-z]/.test(base)) base = `layer_${base}`
  base = base.slice(0, 56) || 'layer'
  let id = base
  for (let n = 2; used.has(id.toLowerCase()); n++) id = `${base}_${n}`
  used.add(id.toLowerCase())
  return id
}

const geometryOfCim = (symbol: unknown): GeometryKind | null => {
  const inner = isRecord(symbol) && symbol.type === 'CIMSymbolReference' ? symbol.symbol : symbol
  const type = isRecord(inner) ? inner.type : undefined
  return type === 'CIMPointSymbol'
    ? 'point'
    : type === 'CIMLineSymbol'
      ? 'line'
      : type === 'CIMPolygonSymbol'
        ? 'polygon'
        : null
}

interface LayerReader {
  ctx: Context
  name: string
  fields: StyledLayer['fields']
  geometry?: GeometryKind
}

function addField(reader: LayerReader, name: string, type: 'string' | 'number' | 'boolean') {
  if (!reader.fields.some((field) => field.name === name)) reader.fields.push({ name, type })
}
const fieldType = (reader: LayerReader, name: string) => reader.fields.find((field) => field.name === name)?.type

function ruleOf(reader: LayerReader, label: string, filter: RuleFilter | null, cim: unknown): StyleRule | null {
  const subject = `${reader.name}: ${label}`
  reader.geometry ??= geometryOfCim(cim) ?? undefined
  const read = sheetSymbolFromCim(cim, { label, substitute: true, format: reader.ctx.format, subject })
  reader.ctx.diagnostics.push(...read.diagnostics)
  if (!read.symbol) return null
  if (reader.geometry && read.symbol.kind !== 'class' && geometryOfSymbol(read.symbol) !== reader.geometry) {
    say(reader.ctx, 'error', `A ${read.symbol.kind} symbol on a ${reader.geometry} layer was left out.`, subject)
    return null
  }
  return { label, filter, symbol: read.symbol }
}

function defaultRule(reader: LayerReader, renderer: Json): StyleRule | null {
  if (renderer.useDefaultSymbol === false || !isRecord(renderer.defaultSymbol)) return null
  return ruleOf(reader, text(renderer.defaultLabel)?.trim() || 'Other', null, renderer.defaultSymbol)
}

function classValue(reader: LayerReader, field: string, raw: string, subject: string): FieldValue | null {
  if (raw === '<Null>') {
    say(reader.ctx, 'warning', 'A class for empty values cannot be tested by a PGMaps rule and was left out.', subject)
    return null
  }
  const type = fieldType(reader, field)
  if (type === 'number') {
    const value = Number(raw)
    if (raw.trim() === '' || !Number.isFinite(value)) {
      say(reader.ctx, 'warning', `"${raw}" is not a number on the number field ${field}; it was left out.`, subject)
      return null
    }
    return value
  }
  if (type === 'boolean' && (raw === 'true' || raw === 'false')) return raw === 'true'
  return raw
}

function uniqueValueRules(reader: LayerReader, renderer: Json): StyleRule[] {
  const ctx = reader.ctx
  const classes = records(renderer.groups).flatMap((group) => records(group.classes))
  const rules: StyleRule[] = []
  const fallback = () => {
    const rule = defaultRule(reader, renderer)
    if (rule) return [rule]
    const first = classes[0]
    const kept = first && ruleOf(reader, text(first.label)?.trim() || reader.name, null, first.symbol)
    return kept ? [kept] : []
  }
  const expression = isRecord(renderer.valueExpressionInfo) ? text(renderer.valueExpressionInfo.expression) : undefined
  if (expression !== undefined) {
    const parsed = parseRulesExpression(expression)
    if (!parsed) {
      say(
        ctx,
        'error',
        `The classes are chosen by an Arcade expression PGMaps cannot read${renderer.valueExpressionInfo && text((renderer.valueExpressionInfo as Json).title) ? ` ("${text((renderer.valueExpressionInfo as Json).title)}")` : ''}; only the default symbol was kept, for every feature.`,
        reader.name,
      )
      return fallback()
    }
    if (text((renderer.valueExpressionInfo as Json).title) !== RULE_EXPRESSION_TITLE)
      say(ctx, 'info', 'The Arcade expression was read as PGMaps rules.', reader.name)
    parsed.filters.forEach((filter, i) => {
      const cls = classes.find((c) =>
        records(c.values).some((v) => Array.isArray(v.fieldValues) && v.fieldValues[0] === parsed.keys[i]),
      )
      if (!cls) return
      if (filter.op === 'range') addField(reader, filter.field, 'number')
      else
        addField(
          reader,
          filter.field,
          typeof (filter.op === 'eq' ? filter.value : filter.values[0]) === 'number' ? 'number' : 'string',
        )
      const rule = ruleOf(reader, text(cls.label)?.trim() || `Rule ${i + 1}`, filter, cls.symbol)
      if (rule) rules.push(rule)
    })
    const rule = defaultRule(reader, renderer)
    return rule ? [...rules, rule] : rules
  }
  const fields = Array.isArray(renderer.fields) ? renderer.fields.filter((f): f is string => typeof f === 'string') : []
  if (fields.length !== 1) {
    say(
      ctx,
      'error',
      fields.length
        ? `The classes match ${fields.length} fields together (${fields.join(', ')}); PGMaps rules test one field, so only the default symbol was kept.`
        : 'The renderer names no field; only the default symbol was kept.',
      reader.name,
    )
    return fallback()
  }
  const field = fields[0]
  addField(reader, field, 'string')
  for (const cls of classes) {
    const label = text(cls.label)?.trim() || ''
    const subject = `${reader.name}: ${label || 'class'}`
    if (cls.visible === false) say(ctx, 'warning', 'The class is hidden in Pro; PGMaps draws it.', subject)
    const values: FieldValue[] = []
    for (const value of records(cls.values)) {
      const raw = Array.isArray(value.fieldValues) ? value.fieldValues : []
      if (raw.length !== 1) {
        say(ctx, 'error', 'A value matching several fields at once was left out.', subject)
        continue
      }
      const read = classValue(reader, field, String(raw[0]), subject)
      if (read !== null) values.push(read)
    }
    if (!values.length) continue
    const filter: RuleFilter = values.length === 1 ? { field, op: 'eq', value: values[0] } : { field, op: 'in', values }
    const rule = ruleOf(reader, label || values.join(', '), filter, cls.symbol)
    if (rule) rules.push(rule)
  }
  const rule = defaultRule(reader, renderer)
  return rule ? [...rules, rule] : rules
}

const openBound = (value: number | undefined) => (value === undefined || Math.abs(value) >= 1e300 ? undefined : value)

function classBreakRules(reader: LayerReader, renderer: Json): StyleRule[] {
  const ctx = reader.ctx
  const field = text(renderer.field)
  if (!field || isRecord(renderer.valueExpressionInfo)) {
    say(
      ctx,
      'error',
      'The class breaks are computed by an Arcade expression PGMaps cannot read; only the default symbol was kept.',
      reader.name,
    )
    const rule = defaultRule(reader, renderer)
    return rule ? [rule] : []
  }
  if (text(renderer.normalizationType) && renderer.normalizationType !== 'Nothing')
    say(
      ctx,
      'warning',
      `The values are normalised (${text(renderer.normalizationType)}) in Pro; PGMaps tests the raw field.`,
      reader.name,
    )
  if (renderer.classBreakType === 'UnclassedColor')
    say(ctx, 'warning', 'An unclassed colour ramp is read as its classes.', reader.name)
  addField(reader, field, 'number')
  // Pro's first class includes the minimum break and every class its upper break: (lower, upper].
  // The next float above a break is the exclusive end of a PGMaps range, which is exact.
  let lower = openBound(finite(renderer.minimumBreak))
  const rules: StyleRule[] = []
  for (const item of records(renderer.breaks)) {
    const upper = openBound(finite(item.upperBound))
    const max = upper === undefined ? undefined : nextAfter(upper, true)
    const filter: RuleFilter = {
      field,
      op: 'range',
      ...(lower !== undefined ? { min: lower } : {}),
      ...(max !== undefined ? { max } : {}),
    }
    const rule = ruleOf(reader, text(item.label)?.trim() || `${lower ?? ''} to ${upper ?? ''}`, filter, item.symbol)
    if (rule) rules.push(rule)
    lower = max
  }
  const rule = defaultRule(reader, renderer)
  return rule ? [...rules, rule] : rules
}

function rendererRules(reader: LayerReader, renderer: unknown): StyleRule[] {
  const ctx = reader.ctx
  if (!isRecord(renderer)) {
    say(ctx, 'error', 'The layer has no renderer.', reader.name)
    return []
  }
  if (records(renderer.visualVariables).length)
    say(ctx, 'warning', 'Visual variables (colour, size or rotation by value) are not carried.', reader.name)
  switch (renderer.type) {
    case 'CIMSimpleRenderer': {
      const rule = ruleOf(reader, text(renderer.label)?.trim() || reader.name, null, renderer.symbol)
      return rule ? [rule] : []
    }
    case 'CIMUniqueValueRenderer':
      return uniqueValueRules(reader, renderer)
    case 'CIMClassBreaksRenderer':
      return classBreakRules(reader, renderer)
    default:
      say(ctx, 'error', `A ${text(renderer.type) ?? 'renderer of unknown type'} is not carried.`, reader.name)
      return []
  }
}

function labelFieldOf(expression: string, engine: string): string | null {
  if (engine === 'Arcade') {
    const dot = /^\s*(?:return\s+)?\$feature\.([A-Za-z_][A-Za-z0-9_]*)\s*;?\s*$/.exec(expression)
    if (dot) return dot[1]
    const bracket = /^\s*(?:return\s+)?\$feature\[\s*(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*\]\s*;?\s*$/.exec(expression)
    return bracket ? bracket[2].replace(/\\(.)/g, '$1') : null
  }
  const plain = /^\s*\[([^\]]+)\]\s*$/.exec(expression)
  return plain ? plain[1] : null
}

function readLabel(reader: LayerReader, definition: Json): LabelStyle | undefined {
  const ctx = reader.ctx
  const classes = records(definition.labelClasses).filter((c) => c.visibility !== false)
  if (!classes.length) return undefined
  if (definition.labelVisibility === false) {
    say(ctx, 'info', 'Labels are switched off in Pro and were not read.', reader.name)
    return undefined
  }
  if (classes.length > 1) say(ctx, 'warning', 'Only the first label class is carried.', reader.name)
  const cls = classes[0]
  const expression = text(cls.expression) ?? ''
  const field = labelFieldOf(expression, text(cls.expressionEngine) ?? 'Arcade')
  if (!field) {
    say(
      ctx,
      'warning',
      `The label expression ${JSON.stringify(expression.slice(0, 80))} is not a plain field, so labels were not read.`,
      reader.name,
    )
    return undefined
  }
  if (text(cls.whereClause))
    say(ctx, 'warning', 'Labels are drawn for every feature; the label class SQL query is not carried.', reader.name)
  const reference = isRecord(cls.textSymbol) ? cls.textSymbol : {}
  const symbol = isRecord(reference.symbol) ? reference.symbol : reference
  const fillOf = (polygon: unknown) => {
    const fill = isRecord(polygon)
      ? records(polygon.symbolLayers).find((layer) => layer.type === 'CIMSolidFill')
      : undefined
    return fill ? colorFromCim(fill.color)?.color : undefined
  }
  const color = fillOf(symbol.symbol)
  const label: LabelStyle = {
    field,
    size: trim(finite(symbol.height) ?? 8),
    color: color ? toHexAlpha(color) : '#000000',
    placement: 'point',
  }
  if (/bold/i.test(text(symbol.fontStyleName) ?? '')) label.bold = true
  const haloColor = fillOf(symbol.haloSymbol)
  if (haloColor && (finite(symbol.haloSize) ?? 0) > 0)
    label.halo = { color: toHex(haloColor), width: trim(finite(symbol.haloSize) ?? 1) }
  const maplex = isRecord(cls.maplexLabelPlacementProperties) ? cls.maplexLabelPlacementProperties : {}
  const standard = isRecord(cls.standardLabelPlacementProperties) ? cls.standardLabelPlacementProperties : {}
  if (reader.geometry === 'line') {
    const method = text(maplex.linePlacementMethod)
    const position = isRecord(standard.lineLabelPosition) ? standard.lineLabelPosition : {}
    const along = method ? !/Horizontal|Perpendicular/.test(method) : position.parallel === true
    if (along) label.placement = 'line'
  }
  addField(reader, field, 'string')
  return label
}

function readFeatureLayer(ctx: Context, definition: Json, used: Set<string>): StyledLayer | null {
  const name = text(definition.name)?.trim() || 'Layer'
  const table = isRecord(definition.featureTable) ? definition.featureTable : {}
  const connection = isRecord(table.dataConnection) ? table.dataConnection : {}
  const reader: LayerReader = { ctx, name, fields: [] }
  for (const description of records(table.fieldDescriptions)) {
    const field = text(description.fieldName)
    if (!field || RESERVED_FIELDS.test(field)) continue
    addField(reader, field, isRecord(description.numberFormat) ? 'number' : 'string')
  }
  const rules = rendererRules(reader, definition.renderer)
  if (!rules.length || !reader.geometry) {
    say(ctx, 'error', 'No rule of the layer could be read, so the layer was left out.', name)
    return null
  }
  // A filterless rule must come last; anything after it never draws.
  const elseAt = rules.findIndex((rule) => !rule.filter)
  if (elseAt >= 0 && elseAt < rules.length - 1) rules.splice(elseAt + 1)
  const layer: StyledLayer = {
    id: layerId(text(connection.dataset) ?? name, used),
    name,
    geometry: reader.geometry,
    fields: reader.fields,
    rules,
  }
  const label = readLabel(reader, definition)
  if (label) layer.label = label
  if (definition.visibility === false) layer.hidden = true
  if (text(connection.workspaceFactory) && connection.workspaceFactory !== 'Shapefile')
    say(ctx, 'info', `The layer reads ${text(connection.workspaceFactory)} data; PGMaps keeps only its style.`, name)
  if (text(definition.definitionExpression)) say(ctx, 'warning', 'The definition query is not carried.', name)
  return layer
}

/** Layers bottom first, from definitions and a top-first list of paths (Pro's order). */
function readLayers(ctx: Context, definitions: Json[], order?: unknown): StyledLayer[] {
  const byUri = new Map(definitions.map((definition) => [text(definition.uRI) ?? '', definition]))
  const flat: Json[] = []
  const seen = new Set<Json>()
  const visit = (uris: unknown) => {
    for (const uri of Array.isArray(uris) ? uris : []) {
      const definition = byUri.get(String(uri))
      if (!definition || seen.has(definition)) continue
      seen.add(definition)
      if (definition.type === 'CIMGroupLayer') {
        say(ctx, 'info', 'The group layer was flattened into its layers.', text(definition.name))
        visit(definition.layers)
      } else flat.push(definition)
    }
  }
  visit(order)
  for (const definition of definitions)
    if (!seen.has(definition) && definition.type !== 'CIMGroupLayer') flat.push(definition)
  const used = new Set<string>()
  const layers: StyledLayer[] = []
  for (const definition of flat.reverse()) {
    if (definition.type !== 'CIMFeatureLayer') {
      say(
        ctx,
        'warning',
        `A ${text(definition.type) ?? 'layer of unknown type'} is not carried.`,
        text(definition.name),
      )
      continue
    }
    const layer = readFeatureLayer(ctx, definition, used)
    if (layer) layers.push(layer)
  }
  return layers
}

// ---------------------------------------------------------------------------------------------
// Layouts

const UNIT_POINTS: Record<number, number> = { 109008: 72, 1025: 72 / 25.4, 1033: 72 / 2.54, 9001: 72 / 0.0254 }
const PANEL_IDS: PanelId[] = ['blockInfo', 'source', 'legend', 'roadTable', 'footer', 'comments', 'notes']

const customOf = (element: Json) =>
  new Map(records(element.customProperties).map((entry) => [String(entry.key), String(entry.value)]))

function ringBox(geometry: unknown): number[] | null {
  if (!isRecord(geometry) || !Array.isArray(geometry.rings)) return null
  const points = (geometry.rings as unknown[])
    .flatMap((r) => (Array.isArray(r) ? r : []))
    .filter(Array.isArray) as number[][]
  if (!points.length) return null
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
const elementBox = (element: Json) =>
  ringBox(element.frame) ?? (isRecord(element.graphic) ? ringBox(element.graphic.polygon) : null)

const elementText = (element: Json) => (isRecord(element.graphic) ? text(element.graphic.text) : undefined)

function flatElements(list: unknown): Json[] {
  return records(list).flatMap((element) =>
    element.type === 'CIMGroupElement' ? flatElements(element.elements) : [element],
  )
}

function readLayout(ctx: Context, cimDocument: Json): LayoutDocument | null {
  const layout = isRecord(cimDocument.layoutDefinition) ? cimDocument.layoutDefinition : null
  const page = layout && isRecord(layout.page) ? layout.page : null
  const name = text(layout?.name)?.trim() || 'Layout'
  if (!layout || !page) {
    say(ctx, 'error', 'The layout has no page.', name)
    return null
  }
  const uwkid = isRecord(page.units) ? finite(page.units.uwkid) : undefined
  const unit = uwkid === undefined ? undefined : UNIT_POINTS[uwkid]
  const width = finite(page.width),
    height = finite(page.height)
  if (!unit || !width || !height) {
    say(ctx, 'error', `The page size or its units (${uwkid ?? 'none'}) are not read.`, name)
    return null
  }
  const W = width * unit,
    H = height * unit
  const orientation = W >= H ? 'landscape' : 'portrait'
  const short = Math.min(W, H),
    long = Math.max(W, H)
  const papers = Object.entries(PAPER_SIZES) as [PaperId, (typeof PAPER_SIZES)[PaperId]][]
  const [paper, size] = papers.reduce((best, entry) =>
    Math.hypot(entry[1].short - short, entry[1].long - long) < Math.hypot(best[1].short - short, best[1].long - long)
      ? entry
      : best,
  )
  if (Math.abs(size.short - short) > 2 || Math.abs(size.long - long) > 2)
    say(
      ctx,
      'warning',
      `The ${trim(width, 2)} × ${trim(height, 2)} page is laid out on ${size.label}, the nearest paper PGMaps prints.`,
      name,
    )
  const fraction = (box: number[]): FractionRect => [
    trim((box[0] * unit) / W, 4),
    trim(1 - (box[3] * unit) / H, 4),
    trim((box[2] * unit) / W, 4),
    trim(1 - (box[1] * unit) / H, 4),
  ]
  const elements = flatElements(layout.elements)
  const role = (value: string) => elements.find((element) => customOf(element).get('pgmaps:role') === value)
  const frameElement = role('frame') ?? elements.find((element) => element.type === 'CIMMapFrame')
  const frameBox = frameElement && elementBox(frameElement)
  if (!frameElement || !frameBox) {
    say(ctx, 'error', 'The layout has no map frame.', name)
    return null
  }
  const frame = fraction(frameBox)
  const neatBox = role('neatline') && elementBox(role('neatline')!)
  if (!neatBox) say(ctx, 'info', 'The layout has no PGMaps neatline; the page edge is used.', name)
  const neatline: FractionRect = neatBox ? fraction(neatBox) : [0, 0, 1, 1]
  const titleBox = role('title-bar') && elementBox(role('title-bar')!)
  if (!titleBox) say(ctx, 'info', 'The layout has no PGMaps title bar; the space above the map frame is used.', name)
  const titleRect: FractionRect = titleBox ? fraction(titleBox) : [frame[0], neatline[1], frame[2], frame[1]]

  const panels: SheetTemplate['panels'][number][] = []
  const byPanel = new Map<string, Json[]>()
  for (const element of elements) {
    const id = customOf(element).get('pgmaps:panel')
    if (id) byPanel.set(id, [...(byPanel.get(id) ?? []), element])
  }
  for (const [id, parts] of byPanel) {
    if (!(PANEL_IDS as string[]).includes(id)) {
      say(ctx, 'warning', `The panel "${id}" is not one PGMaps lays out.`, name)
      continue
    }
    const part = (value: string) => parts.find((element) => customOf(element).get('pgmaps:part') === value)
    const boxElement = part('box')
    const box = boxElement && elementBox(boxElement)
    if (!box) continue
    const titleText = part('title') && elementText(part('title')!)
    const header = part('header')
    panels.push({
      id: id as PanelId,
      rect: fraction(box),
      ...(header && titleText ? { title: titleText } : {}),
      ...(header ? {} : { bare: true }),
    })
  }
  if (!byPanel.size)
    for (const legend of elements.filter((element) => element.type === 'CIMLegend')) {
      const box = elementBox(legend)
      if (!box || panels.some((panel) => panel.id === 'legend')) continue
      panels.push({ id: 'legend', rect: fraction(box), title: 'Legend' })
      say(ctx, 'info', "Pro's legend was read as the legend panel; other layout elements are not carried.", name)
    }

  const texts = elements.filter((element) => isRecord(element.graphic) && element.graphic.type === 'CIMTextGraphic')
  const textHeight = (element: Json) => {
    const reference = isRecord(element.graphic) && isRecord(element.graphic.symbol) ? element.graphic.symbol : {}
    return finite(isRecord(reference.symbol) ? reference.symbol.height : undefined) ?? 0
  }
  const largest = texts.reduce<Json | undefined>(
    (best, element) => (!best || textHeight(element) > textHeight(best) ? element : best),
    undefined,
  )
  const titleText = (role('title') && elementText(role('title')!)) ?? (largest && elementText(largest))
  const subtitle = role('subtitle') && elementText(role('subtitle')!)
  const custom = customOf(frameElement)
  const template: SheetTemplate = {
    id: custom.get('pgmaps:template') ?? `arcgis-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    orientation,
    neatline,
    title: titleRect,
    frame,
    panels,
  }
  const result: LayoutDocument = { name, paper, template, title: titleText?.trim() || name }
  if (subtitle) result.subtitle = subtitle

  const view = isRecord(frameElement.view) ? frameElement.view : {}
  const camera = isRecord(view.camera) ? view.camera : {}
  const scale = finite(camera.scale)
  if (scale && scale > 0) {
    result.scale = trim(scale, 3)
    const maps = records(cimDocument.mapDefinitions)
    const map = maps.find((m) => m.uRI === frameElement.uRI) ?? maps[0]
    const wkid = map && wkidOf(map.spatialReference)
    const cx = finite(camera.x),
      cy = finite(camera.y)
    if (wkid && cx !== undefined && cy !== undefined) {
      const metres = (value: number) => value * (unit / 72) * 0.0254 * scale
      const halfW = metres(frameBox[2] - frameBox[0]) / 2,
        halfH = metres(frameBox[3] - frameBox[1]) / 2
      const box = unprojectBox(wkid, [cx - halfW, cy - halfH, cx + halfW, cy + halfH])
      result.extent = box.map((v) => trim(v, 6)) as [number, number, number, number]
    } else say(ctx, 'info', "The map frame's extent is not read: its map is not in BC Albers or Web Mercator.", name)
  }
  return result
}

// ---------------------------------------------------------------------------------------------

const extensionOf = (fileName: string) => /\.[^./\\]+$/.exec(fileName.toLowerCase())?.[0] ?? ''

function decode(content: string | Uint8Array): string {
  const textContent = typeof content === 'string' ? content : new TextDecoder('utf-8').decode(content)
  return textContent.replace(/^\uFEFF/, '')
}

const SYMBOL_TYPES = new Set(['CIMSymbolReference', 'CIMPointSymbol', 'CIMLineSymbol', 'CIMPolygonSymbol'])

/** Reads an ArcGIS Pro file. Throws an Error naming the problem when it is not one. */
export function readArcgisFile(
  fileName: string,
  content: string | Uint8Array,
  options: { SQL?: SqlJsStatic } = {},
): ReadResult {
  const ext = extensionOf(fileName)
  if (ext === '.stylx') {
    if (!options.SQL) throw Error('Reading an ArcGIS Pro style needs sql.js.')
    if (typeof content === 'string') throw Error('An ArcGIS Pro style is a binary file; pass its bytes.')
    return readStylx(content, options.SQL)
  }
  if ((typeof content === 'string' ? content.length : content.byteLength) > MAX_CIM_BYTES)
    throw Error(`${fileName} is larger than ${MAX_CIM_BYTES / 1048576} MB.`)
  let cimDocument: unknown
  try {
    cimDocument = JSON.parse(decode(content))
  } catch {
    throw Error(`${fileName} is not JSON, so not an ArcGIS Pro ${ext.slice(1) || 'CIM'} file.`)
  }
  if (!isRecord(cimDocument)) throw Error(`${fileName} is not a CIM document.`)
  const empty = (format: ExchangeFormat): ReadResult => ({
    format,
    layers: [],
    symbols: [],
    layouts: [],
    diagnostics: [],
  })
  switch (cimDocument.type) {
    case 'CIMLayerDocument': {
      const result = empty('lyrx')
      const ctx: Context = { format: 'lyrx', diagnostics: result.diagnostics }
      result.layers = readLayers(ctx, records(cimDocument.layerDefinitions), cimDocument.layers)
      return result
    }
    case 'CIMMapDocument': {
      const result = empty('mapx')
      const ctx: Context = { format: 'mapx', diagnostics: result.diagnostics }
      const map = isRecord(cimDocument.mapDefinition) ? cimDocument.mapDefinition : {}
      result.layers = readLayers(ctx, records(cimDocument.layerDefinitions), map.layers)
      return result
    }
    case 'CIMLayoutDocument': {
      const result = empty('pagx')
      const ctx: Context = { format: 'pagx', diagnostics: result.diagnostics }
      const layout = readLayout(ctx, cimDocument)
      if (layout) result.layouts.push(layout)
      const maps = records(cimDocument.mapDefinitions)
      result.layers = readLayers(
        ctx,
        records(cimDocument.layerDefinitions),
        maps.flatMap((map) => (Array.isArray(map.layers) ? map.layers : [])),
      )
      return result
    }
    default: {
      if (typeof cimDocument.type === 'string' && SYMBOL_TYPES.has(cimDocument.type)) {
        const result = empty(ext === '.stylx' ? 'stylx' : 'lyrx')
        const label = fileName.replace(/\.[^.]+$/, '') || 'Symbol'
        const read = sheetSymbolFromCim(cimDocument, { label, format: result.format, subject: label })
        result.diagnostics.push(...read.diagnostics)
        if (read.symbol)
          result.symbols.push({ id: 'symbol', name: label, category: 'ArcGIS Pro', tags: [], symbol: read.symbol })
        return result
      }
      throw Error(
        `${fileName} is a ${text(cimDocument.type) ?? 'JSON file'}, not an ArcGIS Pro layer, map, layout or symbol.`,
      )
    }
  }
}
