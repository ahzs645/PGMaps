/**
 * A QGIS layer's renderer and labeling back to a `StyledLayer`: single symbol, categorized (lists of
 * values included), graduated (as ranges) and rule-based renderers, plus simple labeling. Rule
 * filters go through `expression.ts`; a rule whose filter or symbol cannot be read is left out with
 * an error. Used for `.qml` files and for the map layers of `.qgs`/`.qgz` projects.
 * No DOM or network access.
 */
import type { FieldValue, GeometryKind, LabelStyle, RuleFilter, StyledLayer, StyleRule } from '../model'
import { attr, child, childElements, type XmlElement } from '../xml'
import { filtersDisjoint, filterFromExpression, parseQgisExpression } from './expression'
import { Diagnostics, parseQgisColor, roundPt, splitColor, toPoints } from './qgisXml'
import { readQgisSymbol } from './symbolRead'
import { geometryOfSymbol } from '../model'

/** Renderers that wrap another renderer, which is what draws the features. */
const WRAPPERS = new Set(['pointDisplacement', 'pointCluster', 'invertedPolygonRenderer', 'mergedFeatureRenderer'])

const GEOMETRY_BY_TYPE: Record<string, GeometryKind> = { '0': 'point', '1': 'line', '2': 'polygon' }
const GEOMETRY_BY_NAME: Record<string, GeometryKind> = { Point: 'point', Line: 'line', Polygon: 'polygon' }

/** A field name from a renderer's `attr`, which may be a bare or quoted name or an expression. */
function fieldOf(expression: string | null): string | null {
  if (!expression) return null
  const text = expression.trim()
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(text)) return text
  try {
    const parsed = parseQgisExpression(text)
    return parsed.type === 'field' ? parsed.name : null
  } catch {
    return null
  }
}

function symbolsByName(renderer: XmlElement): Map<string, XmlElement> {
  const out = new Map<string, XmlElement>()
  const symbols = child(renderer, 'symbols')
  if (symbols) for (const symbol of childElements(symbols, 'symbol')) out.set(attr(symbol, 'name') ?? '', symbol)
  return out
}

function typedValue(value: string, type: string | null): FieldValue {
  if (type && /^(int|double|qlonglong|longlong|uint|qulonglong|float)$/i.test(type) && Number.isFinite(Number(value)))
    return Number(value)
  if (type && /^bool$/i.test(type)) return value === 'true' || value === '1'
  return value
}

interface Context {
  diagnostics: Diagnostics
  layerName: string
}

function ruleSymbol(context: Context, symbols: Map<string, XmlElement>, name: string | null, label: string) {
  const element = name !== null ? symbols.get(name) : undefined
  const subject = `${context.layerName}: ${label}`
  if (!element) {
    context.diagnostics.error(subject, 'The rule names a symbol the file does not have.')
    return null
  }
  return readQgisSymbol(element, label, context.diagnostics, subject)
}

function readCategorized(renderer: XmlElement, context: Context): StyleRule[] {
  const field = fieldOf(attr(renderer, 'attr'))
  if (!field) {
    context.diagnostics.error(context.layerName, `Categories by the expression ${attr(renderer, 'attr')} are not read.`)
    return []
  }
  const symbols = symbolsByName(renderer)
  const rules: StyleRule[] = []
  let otherwise: StyleRule | null = null
  for (const category of childElements(child(renderer, 'categories') ?? renderer, 'category')) {
    const label = attr(category, 'label') || attr(category, 'value') || 'Category'
    if (attr(category, 'render') === 'false') {
      context.diagnostics.warning(`${context.layerName}: ${label}`, 'A switched-off category was left out.')
      continue
    }
    const symbol = ruleSymbol(context, symbols, attr(category, 'symbol'), label)
    if (!symbol) continue
    const listed = childElements(category, 'val')
    const type = attr(category, 'type')
    const value = attr(category, 'value') ?? ''
    if (listed.length) {
      rules.push({
        label,
        filter: {
          field,
          op: 'in',
          values: listed.map((val) => typedValue(attr(val, 'value') ?? '', attr(val, 'type'))),
        },
        symbol,
      })
    } else if (type === 'NULL' || value === '') {
      // QGIS draws a category with an empty value as "all other values", whatever its type.
      if (otherwise)
        context.diagnostics.warning(context.layerName, 'Only the first "all other values" category was read.')
      else otherwise = { label, filter: null, symbol }
    } else rules.push({ label, filter: { field, op: 'eq', value: typedValue(value, type) }, symbol })
  }
  return otherwise ? [...rules, otherwise] : rules
}

function readGraduated(renderer: XmlElement, context: Context): StyleRule[] {
  const field = fieldOf(attr(renderer, 'attr'))
  if (!field) {
    context.diagnostics.error(context.layerName, `Classes by the expression ${attr(renderer, 'attr')} are not read.`)
    return []
  }
  const symbols = symbolsByName(renderer)
  const rules: StyleRule[] = []
  for (const range of childElements(child(renderer, 'ranges') ?? renderer, 'range')) {
    const label = attr(range, 'label') || `${attr(range, 'lower')} – ${attr(range, 'upper')}`
    if (attr(range, 'render') === 'false') {
      context.diagnostics.warning(`${context.layerName}: ${label}`, 'A switched-off class was left out.')
      continue
    }
    const symbol = ruleSymbol(context, symbols, attr(range, 'symbol'), label)
    const min = Number(attr(range, 'lower')),
      max = Number(attr(range, 'upper'))
    if (!symbol || !Number.isFinite(min) || !Number.isFinite(max)) continue
    rules.push({ label, filter: { field, op: 'range', min, max }, symbol })
  }
  if (rules.length)
    context.diagnostics.warning(
      context.layerName,
      'QGIS classes include their upper bound; PGMaps classes include the lower one, so a value on a break moves up a class.',
    )
  return rules
}

interface ReadRule {
  rule: StyleRule
  excludes: RuleFilter[]
}

function readRuleBased(renderer: XmlElement, context: Context): StyleRule[] {
  const symbols = symbolsByName(renderer)
  const read: ReadRule[] = []
  let otherwise: StyleRule | null = null
  const visit = (element: XmlElement) => {
    for (const ruleElement of childElements(element, 'rule')) {
      const label =
        attr(ruleElement, 'label') || attr(ruleElement, 'description') || attr(ruleElement, 'filter') || 'Rule'
      const subject = `${context.layerName}: ${label}`
      if (attr(ruleElement, 'active') === '0') {
        context.diagnostics.warning(subject, 'A switched-off rule was left out.')
        continue
      }
      if (attr(ruleElement, 'scalemindenom') || attr(ruleElement, 'scalemaxdenom'))
        context.diagnostics.warning(subject, 'The rule’s scale range is not kept: it draws at every scale.')
      const filterText = attr(ruleElement, 'filter')?.trim() ?? ''
      const children = childElements(ruleElement, 'rule')
      if (children.length) {
        if (filterText || attr(ruleElement, 'symbol') !== null) {
          context.diagnostics.error(subject, 'Rules nested under a filtered or drawn rule are not read.')
          continue
        }
        visit(ruleElement)
        continue
      }
      const symbol = ruleSymbol(context, symbols, attr(ruleElement, 'symbol'), label)
      if (!symbol) continue
      if (filterText.toUpperCase() === 'ELSE' || !filterText) {
        if (otherwise) {
          context.diagnostics.error(subject, 'A second "everything else" rule was left out.')
          continue
        }
        if (!filterText)
          context.diagnostics.warning(
            subject,
            'A rule without a filter draws every feature in QGIS; here it draws the features no other rule draws.',
          )
        otherwise = { label, filter: null, symbol }
        continue
      }
      const reading = filterFromExpression(
        filterText,
        read.map((item) => item.rule.filter!),
      )
      if (!reading.filter) {
        context.diagnostics.error(subject, `The filter ${filterText} was not read: ${reading.error}`)
        continue
      }
      for (const warning of reading.warnings) context.diagnostics.warning(subject, warning)
      read.push({ rule: { label, filter: reading.filter, symbol }, excludes: reading.excludes })
    }
  }
  visit(child(renderer, 'rules') ?? renderer)
  const overlapping = read.some((later, j) =>
    read
      .slice(0, j)
      .some(
        (earlier) =>
          !later.excludes.includes(earlier.rule.filter!) && !filtersDisjoint(earlier.rule.filter!, later.rule.filter!),
      ),
  )
  if (overlapping)
    context.diagnostics.warning(
      context.layerName,
      'QGIS draws every rule a feature matches; PGMaps draws only the first, so a feature that several rules match shows the first rule’s symbol.',
    )
  const rules = read.map((item) => item.rule)
  return otherwise ? [...rules, otherwise] : rules
}

function readRenderer(renderer: XmlElement, context: Context): StyleRule[] {
  const type = attr(renderer, 'type') ?? ''
  if (WRAPPERS.has(type)) {
    const inner = child(renderer, 'renderer-v2')
    context.diagnostics.warning(context.layerName, `The ${type} renderer was read as the renderer inside it.`)
    return inner ? readRenderer(inner, context) : []
  }
  if (type === 'singleSymbol') {
    const symbol = ruleSymbol(context, symbolsByName(renderer), '0', context.layerName)
    return symbol ? [{ label: context.layerName, filter: null, symbol }] : []
  }
  if (type === 'categorizedSymbol') return readCategorized(renderer, context)
  if (type === 'graduatedSymbol') return readGraduated(renderer, context)
  if (type === 'RuleRenderer') return readRuleBased(renderer, context)
  context.diagnostics.error(context.layerName, `The ${type || 'unnamed'} renderer is not read.`)
  return []
}

function readLabel(element: XmlElement, context: Context): LabelStyle | undefined {
  const labeling = child(element, 'labeling')
  if (!labeling) return undefined
  const subject = `${context.layerName} labels`
  if (attr(labeling, 'type') !== 'simple') {
    context.diagnostics.error(
      subject,
      `${attr(labeling, 'type') ?? 'These'} labels are not read; only simple labeling is.`,
    )
    return undefined
  }
  if (attr(element, 'labelsEnabled') === '0') {
    context.diagnostics.info(subject, 'Labels switched off in QGIS were left out.')
    return undefined
  }
  const settings = child(labeling, 'settings')
  const text = settings && child(settings, 'text-style')
  if (!text) return undefined
  let field = attr(text, 'fieldName') ?? ''
  if (attr(text, 'isExpression') === '1') {
    const name = fieldOf(field)
    if (!name) {
      context.diagnostics.error(subject, `Labels from the expression ${field} are not read.`)
      return undefined
    }
    field = name
  }
  if (!field) return undefined
  const color = parseQgisColor(attr(text, 'textColor')) ?? { r: 0, g: 0, b: 0, a: 1 }
  const textOpacity = Number(attr(text, 'textOpacity') ?? 1)
  if (color.a * textOpacity < 1) context.diagnostics.warning(subject, 'Label transparency is not kept.')
  const size = roundPt(
    toPoints(Number(attr(text, 'fontSize') ?? 10), attr(text, 'fontSizeUnit') ?? 'Point', context.diagnostics, subject),
  )
  const buffer = child(text, 'text-buffer')
  const halo =
    buffer && attr(buffer, 'bufferDraw') === '1'
      ? {
          color: splitColor(parseQgisColor(attr(buffer, 'bufferColor')) ?? { r: 255, g: 255, b: 255, a: 1 }).color,
          width: roundPt(
            toPoints(
              Number(attr(buffer, 'bufferSize') ?? 1),
              attr(buffer, 'bufferSizeUnits') ?? 'MM',
              context.diagnostics,
              subject,
            ),
          ),
        }
      : undefined
  const placement = Number(attr(settings && child(settings, 'placement'), 'placement') ?? 0)
  const weight = Number(attr(text, 'fontWeight') ?? 400)
  const bold = weight >= 600 || attr(text, 'fontBold') === '1'
  return {
    field,
    size,
    color: splitColor(color).color,
    ...(halo ? { halo } : {}),
    placement: [2, 3, 7].includes(placement) ? 'line' : 'point',
    ...(bold ? { bold: true } : {}),
  }
}

/** Field names and kinds the rules and label use, kinds from the filter values. */
function usedFields(rules: StyleRule[], label: LabelStyle | undefined): StyledLayer['fields'] {
  const fields = new Map<string, 'string' | 'number' | 'boolean'>()
  for (const rule of rules) {
    const filter = rule.filter
    if (!filter) continue
    const sample = filter.op === 'eq' ? filter.value : filter.op === 'in' ? filter.values[0] : 0
    const kind = typeof sample === 'number' ? 'number' : typeof sample === 'boolean' ? 'boolean' : 'string'
    if (!fields.has(filter.field)) fields.set(filter.field, kind)
  }
  if (label && !fields.has(label.field)) fields.set(label.field, 'string')
  return [...fields].map(([name, type]) => ({ name, type }))
}

/**
 * A styled layer from an element holding `<renderer-v2>` (a `.qml` root or a project's
 * `<maplayer>`). `id` and `name` come from the caller, which knows the file or data source.
 */
export function readQgisLayer(
  element: XmlElement,
  identity: { id: string; name: string; hidden?: boolean },
  diagnostics: Diagnostics,
): StyledLayer | null {
  const context: Context = { diagnostics, layerName: identity.name }
  const renderer = child(element, 'renderer-v2')
  if (!renderer) {
    diagnostics.error(identity.name, 'The layer has no symbology to read.')
    return null
  }
  const rules = readRenderer(renderer, context)
  if (!rules.length) {
    diagnostics.error(identity.name, 'No rule of the layer could be read.')
    return null
  }
  const declared =
    GEOMETRY_BY_TYPE[(child(element, 'layerGeometryType')?.textContent ?? '').trim()] ??
    GEOMETRY_BY_NAME[attr(element, 'geometry') ?? '']
  const geometry = declared ?? geometryOfSymbol(rules[0].symbol)
  const fitting = rules.filter((rule) => {
    if (rule.symbol.kind === 'class' || geometryOfSymbol(rule.symbol) === geometry) return true
    diagnostics.error(
      `${identity.name}: ${rule.label}`,
      `A ${rule.symbol.kind} symbol on a ${geometry} layer was left out.`,
    )
    return false
  })
  if (!fitting.length) return null
  const label = readLabel(element, context)
  return {
    id: identity.id,
    name: identity.name,
    geometry,
    fields: usedFields(fitting, label),
    rules: fitting,
    ...(label ? { label } : {}),
    ...(identity.hidden ? { hidden: true } : {}),
  }
}
