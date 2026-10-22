import type { FeatureCollection } from 'geojson'
import {
  checkedStyleComparison,
  checkedStyleColor,
  checkedStyleSymbol,
  checkedVectorStyle,
  DEFAULT_STYLE_SYMBOL,
  matchesStyleComparison,
  type StyleComparison,
  type StyleGeometry,
  type StyleRule,
  type StyleSymbol,
  type VectorStyle,
} from './vectorRules'

export type StyleDiagnostic = { severity: 'warning' | 'error'; message: string }
export type ImportedSld = { name: string; originalSld: string; style?: VectorStyle; diagnostics: StyleDiagnostic[] }
const SLD = 'http://www.opengis.net/sld',
  SE = 'http://www.opengis.net/se',
  OGC = 'http://www.opengis.net/ogc'
export const MAX_SLD_BYTES = 2 * 1024 * 1024
export function xmlText(value: string): string {
  if (
    Array.from(value).some((character) => {
      const code = character.codePointAt(0)!
      return (
        (code < 32 && ![9, 10, 13].includes(code)) ||
        (code >= 0xd800 && code <= 0xdfff) ||
        code === 0xfffe ||
        code === 0xffff
      )
    })
  )
    throw new Error('XML text contains unsupported control characters.')
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    .replace(/\r/g, '&#13;')
}
function directSldProperty(property: string): string {
  if (!/^[\p{L}_][\p{L}\p{N}\p{M}_.-]*$/u.test(property))
    throw new Error(
      'SLD supports direct XML property names here. XPath, namespace prefixes and field names containing spaces require a different SLD implementation; style JSON preserves these local fields.',
    )
  return property
}
function encoded(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
}
function decoded(value: string): unknown {
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(value), (char) => char.charCodeAt(0))),
  )
}
function filterXml(condition: StyleComparison): string {
  const property = '<ogc:PropertyName>' + xmlText(directSldProperty(condition.property)) + '</ogc:PropertyName>'
  if (condition.value === null) {
    const test = '<ogc:PropertyIsNull>' + property + '</ogc:PropertyIsNull>'
    return condition.operator === 'eq' ? test : '<ogc:Not>' + test + '</ogc:Not>'
  }
  const literal = (value: string | number | boolean) => '<ogc:Literal>' + xmlText(String(value)) + '</ogc:Literal>'
  if (condition.operator === 'between')
    return (
      '<ogc:PropertyIsBetween>' +
      property +
      '<ogc:LowerBoundary>' +
      literal(condition.value) +
      '</ogc:LowerBoundary><ogc:UpperBoundary>' +
      literal(condition.upper) +
      '</ogc:UpperBoundary></ogc:PropertyIsBetween>'
    )
  const tags = {
    eq: 'PropertyIsEqualTo',
    ne: 'PropertyIsNotEqualTo',
    lt: 'PropertyIsLessThan',
    lte: 'PropertyIsLessThanOrEqualTo',
    gt: 'PropertyIsGreaterThan',
    gte: 'PropertyIsGreaterThanOrEqualTo',
  }
  return (
    '<ogc:' +
    tags[condition.operator] +
    '>' +
    property +
    literal(condition.value) +
    '</ogc:' +
    tags[condition.operator] +
    '>'
  )
}
function symbolXml(
  symbol: StyleSymbol,
  geometry: Exclude<StyleGeometry, 'any'>,
  prefix: string,
  gradient?: Extract<VectorStyle, { mode: 'gradient' }>,
): string {
  const parameter = prefix === 'se' ? 'SvgParameter' : 'CssParameter'
  const tag = (name: string, value: string) =>
    '<' + prefix + ':' + name + '>' + value + '</' + prefix + ':' + name + '>'
  const interpolation = (fallback: string) =>
    '<se:Interpolate fallbackValue="' +
    fallback +
    '" mode="linear" method="color">' +
    '<se:LookupValue><ogc:PropertyName>' +
    xmlText(directSldProperty(gradient!.property)) +
    '</ogc:PropertyName></se:LookupValue>' +
    gradient!.stops
      .map(
        (stop) =>
          '<se:InterpolationPoint><se:Data>' +
          stop.value +
          '</se:Data><se:Value>' +
          stop.color +
          '</se:Value></se:InterpolationPoint>',
      )
      .join('') +
    '</se:Interpolate>'
  const param = (name: string, value: string | number, dynamic = false) =>
    '<' +
    prefix +
    ':' +
    parameter +
    ' name="' +
    name +
    '">' +
    (dynamic ? interpolation(String(value)) : xmlText(String(value))) +
    '</' +
    prefix +
    ':' +
    parameter +
    '>'
  const fill = tag(
    'Fill',
    param('fill', symbol.fillColor, !!gradient && gradient.channel !== 'stroke') +
      param('fill-opacity', geometry === 'point' ? symbol.pointOpacity : symbol.fillOpacity),
  )
  const stroke = tag(
    'Stroke',
    param('stroke', symbol.strokeColor, !!gradient && gradient.channel !== 'fill') +
      param('stroke-opacity', symbol.strokeOpacity) +
      param('stroke-width', geometry === 'point' ? symbol.pointStrokeWidth : symbol.strokeWidth),
  )
  if (geometry === 'point')
    return tag(
      'PointSymbolizer',
      tag(
        'Graphic',
        tag('Mark', tag('WellKnownName', 'circle') + fill + stroke) + tag('Size', String(symbol.pointRadius * 2)),
      ),
    )
  if (geometry === 'line') return tag('LineSymbolizer', stroke)
  return tag('PolygonSymbolizer', fill + stroke)
}
/** SLD 1.0 for simple/rule styles; SE 1.1 color interpolation for continuous gradients. */
export function exportStyleSld(input: VectorStyle, name: string, geometry: Exclude<StyleGeometry, 'any'>): string {
  const style = checkedVectorStyle({ ...input, geometry })
  if (!name.trim() || name.length > 200) throw new Error('A style name must contain 1–200 characters.')
  const prefix = style.mode === 'gradient' ? 'se' : 'sld'
  const tag = (key: string, content: string) =>
    '<' + prefix + ':' + key + '>' + content + '</' + prefix + ':' + key + '>'
  const rule = (
    name: string,
    condition: string,
    symbol: StyleSymbol,
    gradient?: Extract<VectorStyle, { mode: 'gradient' }>,
  ) => tag('Rule', tag('Name', xmlText(name)) + condition + symbolXml(symbol, geometry, prefix, gradient))
  let rules: string
  if (style.mode === 'rules') {
    const enabled = style.rules.filter((item) => item.enabled)
    const preceding: string[] = []
    rules =
      enabled
        .map((item) => {
          const condition = filterXml(item.condition)
          // SLD normally paints every matching rule. Exclude earlier matches to preserve first-match precedence.
          const previous = preceding.length === 1 ? preceding[0] : '<ogc:Or>' + preceding.join('') + '</ogc:Or>'
          const exclusive = preceding.length
            ? '<ogc:And>' + condition + '<ogc:Not>' + previous + '</ogc:Not></ogc:And>'
            : condition
          preceding.push(condition)
          return rule(item.name, '<ogc:Filter>' + exclusive + '</ogc:Filter>', item.symbol)
        })
        .join('') + rule('Other values', enabled.length ? tag('ElseFilter', '') : '', style.base)
  } else rules = rule(name, '', style.base, style.mode === 'gradient' ? style : undefined)
  const version = style.mode === 'gradient' ? '1.1.0' : '1.0.0'
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<sld:StyledLayerDescriptor xmlns:sld="' +
    SLD +
    '" xmlns:se="' +
    SE +
    '" xmlns:ogc="' +
    OGC +
    '" version="' +
    version +
    '">\n' +
    '<!--PGMapsStyleV1:' +
    encoded({ name, style }) +
    '-->\n' +
    '<sld:NamedLayer>' +
    tag('Name', xmlText(name)) +
    '<sld:UserStyle>' +
    tag('Name', xmlText(name)) +
    tag('FeatureTypeStyle', rules) +
    '</sld:UserStyle></sld:NamedLayer>\n</sld:StyledLayerDescriptor>\n'
  )
}
function descendants(parent: Element, name: string): Element[] {
  return Array.from(parent.getElementsByTagNameNS('*', name))
}
function children(parent: Element, name?: string): Element[] {
  return Array.from(parent.children).filter((item) => !name || item.localName === name)
}
function one(parent: Element, name: string, required = true): Element | undefined {
  const found = children(parent, name)
  if (found.length > 1 || (required && !found.length))
    throw new Error('Expected ' + (required ? 'one ' : 'at most one ') + name + '.')
  return found[0]
}
function plain(element: Element | undefined): string {
  if (!element) return ''
  if (element.children.length) throw new Error('Dynamic ' + element.localName + ' expressions are unsupported.')
  return element.textContent ?? ''
}
function ensureChildren(element: Element, allowed: string[]) {
  const unknown = children(element)
    .filter((child) => !allowed.includes(child.localName))
    .map((item) => item.localName)
  if (unknown.length)
    throw new Error('Unsupported ' + element.localName + ' content: ' + [...new Set(unknown)].join(', ') + '.')
}
function parseDocument(xml: string): XMLDocument {
  if (new TextEncoder().encode(xml).length > MAX_SLD_BYTES) throw new Error('SLD files are limited to 2 MiB.')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('SLD documents containing DTDs or entities are not accepted.')
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The SLD is not valid XML.')
  return doc
}
/** Compare semantic XML structure before trusting our optional roundtrip metadata. */
function signature(element: Element): string {
  const attributes = Array.from(element.attributes)
    .filter((a) => a.namespaceURI !== 'http://www.w3.org/2000/xmlns/' && a.localName !== 'schemaLocation')
    .map((a) => [a.namespaceURI, a.localName, a.value])
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  const content = Array.from(element.childNodes).flatMap((node) => {
    if (node.nodeType === 1) return [signature(node as Element)]
    if (node.nodeType === 3) {
      const text = node.textContent ?? ''
      if (element.localName === 'Literal') return [text]
      if (text.trim()) return [text.trim()]
    }
    return []
  })
  return JSON.stringify([element.namespaceURI, element.localName, attributes, content])
}
type FieldTypes = Record<string, 'string' | 'number' | 'boolean' | 'mixed'>
function simpleProperty(element: Element): string {
  const property = plain(one(element, 'PropertyName')).trim()
  return directSldProperty(property)
}
export function styleFieldTypes(data: FeatureCollection): FieldTypes {
  const types: FieldTypes = Object.create(null)
  for (const feature of data.features)
    for (const [key, value] of Object.entries(feature.properties ?? {})) {
      if (value === null) continue
      const type = typeof value
      const next = type === 'number' || type === 'string' || type === 'boolean' ? type : 'mixed'
      if (types[key] && types[key] !== next) types[key] = 'mixed'
      else types[key] = next
    }
  return types
}
function readFilter(element: Element, types: FieldTypes, diagnostics: StyleDiagnostic[]): StyleComparison {
  const parts = children(element)
  if (parts.length !== 1) throw new Error('A rule must contain one supported comparison filter.')
  let comparison = parts[0],
    nullOperator: 'eq' | 'ne' = 'eq'
  if (
    comparison.localName === 'Not' &&
    children(comparison).length === 1 &&
    children(comparison)[0].localName === 'PropertyIsNull'
  ) {
    comparison = children(comparison)[0]
    nullOperator = 'ne'
  }
  const property = simpleProperty(comparison)
  if (comparison.localName === 'PropertyIsNull') {
    ensureChildren(comparison, ['PropertyName'])
    return checkedStyleComparison({ property, operator: nullOperator, value: null })
  }
  const operators = {
    PropertyIsEqualTo: 'eq',
    PropertyIsNotEqualTo: 'ne',
    PropertyIsLessThan: 'lt',
    PropertyIsLessThanOrEqualTo: 'lte',
    PropertyIsGreaterThan: 'gt',
    PropertyIsGreaterThanOrEqualTo: 'gte',
    PropertyIsBetween: 'between',
  } as const
  const operator = operators[comparison.localName as keyof typeof operators]
  if (!operator) throw new Error('Unsupported SLD filter: ' + comparison.localName + '.')
  if (comparison.hasAttribute('matchCase') && comparison.getAttribute('matchCase') !== 'true')
    throw new Error('Case-insensitive SLD comparisons are unsupported.')
  const literal = (node: Element | undefined): string | number | boolean => {
    const value = plain(node)
    if (types[property] === 'mixed')
      throw new Error('Field "' + property + '" contains mixed types; its SLD literal type is ambiguous.')
    if (types[property] === 'number') {
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()) || !Number.isFinite(Number(value)))
        throw new Error('SLD literal for numeric field "' + property + '" is not a finite number.')
      return Number(value)
    }
    if (types[property] === 'boolean') {
      if (!['true', 'false', '1', '0'].includes(value.trim())) throw new Error('Invalid boolean SLD literal.')
      return value.trim() === 'true' || value.trim() === '1'
    }
    if (!types[property] && !diagnostics.some((item) => item.message.includes('"' + property + '"')))
      diagnostics.push({
        severity: 'warning',
        message:
          'SLD field "' +
          property +
          '" has no supplied data type; literals remain text. Import against the intended layer to resolve numeric or boolean types.',
      })
    return value
  }
  if (operator === 'between') {
    ensureChildren(comparison, ['PropertyName', 'LowerBoundary', 'UpperBoundary'])
    const lower = one(comparison, 'LowerBoundary')!,
      upper = one(comparison, 'UpperBoundary')!
    ensureChildren(lower, ['Literal'])
    ensureChildren(upper, ['Literal'])
    return checkedStyleComparison({
      property,
      operator,
      value: literal(one(lower, 'Literal')),
      upper: literal(one(upper, 'Literal')),
    })
  }
  ensureChildren(comparison, ['PropertyName', 'Literal'])
  return checkedStyleComparison({ property, operator, value: literal(one(comparison, 'Literal')) })
}
type ReadSymbol = {
  geometry: Exclude<StyleGeometry, 'any'>
  symbol: StyleSymbol
  gradient?: { property: string; stops: { value: number; color: string }[]; channel: 'fill' | 'stroke' | 'both' }
}
function readSymbol(element: Element): ReadSymbol {
  const geometry = ({ PointSymbolizer: 'point', LineSymbolizer: 'line', PolygonSymbolizer: 'polygon' } as const)[
    element.localName as 'PointSymbolizer'
  ]
  if (!geometry) throw new Error('Unsupported SLD symbolizer: ' + element.localName + '.')
  ensureChildren(element, geometry === 'point' ? ['Graphic'] : ['Fill', 'Stroke'])
  const symbol = {
    ...DEFAULT_STYLE_SYMBOL,
    fillColor: '#808080',
    strokeColor: '#000000',
    fillOpacity: 0,
    pointOpacity: 0,
    strokeOpacity: 0,
    strokeWidth: 1,
    pointStrokeWidth: 1,
  }
  let container = element
  if (geometry === 'point') {
    const graphic = one(element, 'Graphic')!
    ensureChildren(graphic, ['Mark', 'Size'])
    const mark = one(graphic, 'Mark')!
    ensureChildren(mark, ['WellKnownName', 'Fill', 'Stroke'])
    if (plain(one(mark, 'WellKnownName')).trim() !== 'circle')
      throw new Error('Only circular SLD point marks are supported; other marks are retained in the original.')
    const size = plain(one(graphic, 'Size', false)).trim()
    symbol.pointRadius = size ? Number(size) / 2 : 3
    container = mark
  }
  let gradient: ReadSymbol['gradient']
  for (const kind of ['Fill', 'Stroke'] as const) {
    const node = one(container, kind, false)
    if (!node) continue
    ensureChildren(node, ['CssParameter', 'SvgParameter'])
    if (kind === 'Fill') {
      symbol.fillOpacity = 1
      symbol.pointOpacity = 1
    } else symbol.strokeOpacity = 1
    const seen = new Set<string>()
    for (const parameter of children(node)) {
      const key = parameter.getAttribute('name') ?? ''
      if (seen.has(key)) throw new Error('Duplicate SLD parameter "' + key + '".')
      seen.add(key)
      const allowed = kind === 'Fill' ? ['fill', 'fill-opacity'] : ['stroke', 'stroke-opacity', 'stroke-width']
      if (!allowed.includes(key)) throw new Error('Unsupported SLD parameter "' + key + '".')
      const dynamic = children(parameter)
      if (dynamic.length) {
        if (!['fill', 'stroke'].includes(key) || dynamic.length !== 1 || dynamic[0].localName !== 'Interpolate')
          throw new Error('Unsupported dynamic SLD parameter "' + key + '".')
        const interpolate = dynamic[0]
        ensureChildren(interpolate, ['LookupValue', 'InterpolationPoint'])
        if (
          (interpolate.getAttribute('mode') ?? 'linear') !== 'linear' ||
          interpolate.getAttribute('method') !== 'color'
        )
          throw new Error('Only linear color interpolation is supported.')
        const lookup = one(interpolate, 'LookupValue')!
        ensureChildren(lookup, ['PropertyName'])
        const property = simpleProperty(lookup)
        const stops = children(interpolate, 'InterpolationPoint').map((point) => {
          ensureChildren(point, ['Data', 'Value'])
          const numeric = plain(one(point, 'Data')).trim()
          if (!numeric || !Number.isFinite(Number(numeric))) throw new Error('Invalid numeric gradient stop.')
          return {
            value: Number(numeric),
            color: checkedStyleColor(plain(one(point, 'Value')).trim()),
          }
        })
        const next = { property, stops, channel: key as 'fill' | 'stroke' }
        if (gradient) {
          if (JSON.stringify([gradient.property, gradient.stops]) !== JSON.stringify([property, stops]))
            throw new Error('Different fill and stroke gradient functions require separate styles.')
          gradient = { ...gradient, channel: 'both' }
        } else gradient = next
        const fallback = checkedStyleColor(interpolate.getAttribute('fallbackValue'))
        if (key === 'fill') symbol.fillColor = fallback
        else symbol.strokeColor = fallback
      } else {
        const value = plain(parameter).trim()
        if (key === 'fill') symbol.fillColor = checkedStyleColor(value)
        else if (key === 'stroke') symbol.strokeColor = checkedStyleColor(value)
        else if (!value || !Number.isFinite(Number(value)))
          throw new Error('Invalid numeric SLD parameter "' + key + '".')
        else if (key === 'fill-opacity') {
          symbol.fillOpacity = Number(value)
          symbol.pointOpacity = Number(value)
        } else if (key === 'stroke-opacity') symbol.strokeOpacity = Number(value)
        else if (key === 'stroke-width') {
          symbol.strokeWidth = Number(value)
          symbol.pointStrokeWidth = Number(value)
        }
      }
    }
  }
  return { geometry, symbol: checkedStyleSymbol(symbol), ...(gradient && { gradient }) }
}
function mayOverlap(a: StyleComparison, b: StyleComparison): boolean {
  if (a.property !== b.property) return true
  if (a.operator === 'eq') return matchesStyleComparison(b, { [a.property]: a.value })
  if (b.operator === 'eq') return matchesStyleComparison(a, { [b.property]: b.value })
  if (a.value === null || b.value === null) return true
  if (typeof a.value !== typeof b.value) return false
  if (a.operator === 'ne' || b.operator === 'ne') return true
  const bounds = (c: StyleComparison) => ({
    lower:
      c.operator === 'gt' || c.operator === 'gte' || c.operator === 'between'
        ? (c.value as string | number)
        : undefined,
    upper:
      c.operator === 'lt' || c.operator === 'lte'
        ? (c.value as string | number)
        : c.operator === 'between'
          ? c.upper
          : undefined,
    lowerInclusive: c.operator !== 'gt',
    upperInclusive: c.operator !== 'lt',
  })
  const x = bounds(a),
    y = bounds(b)
  if (
    x.upper !== undefined &&
    y.lower !== undefined &&
    (x.upper < y.lower || (x.upper === y.lower && (!x.upperInclusive || !y.lowerInclusive)))
  )
    return false
  if (
    y.upper !== undefined &&
    x.lower !== undefined &&
    (y.upper < x.lower || (y.upper === x.lower && (!y.upperInclusive || !x.lowerInclusive)))
  )
    return false
  return true
}
/** Unsupported documents remain downloadable originals; they never become silently partial map styles. */
export function importStyleSld(xml: string, data?: FeatureCollection): ImportedSld {
  const result: ImportedSld = { name: 'Imported SLD', originalSld: xml, diagnostics: [] }
  try {
    const doc = parseDocument(xml),
      root = doc.documentElement
    if (
      root.localName !== 'StyledLayerDescriptor' ||
      root.namespaceURI !== SLD ||
      !['1.0.0', '1.1.0'].includes(root.getAttribute('version') ?? '')
    )
      throw new Error('Only OGC SLD 1.0.0 and SLD/SE 1.1.0 documents are supported.')
    const all = [root, ...Array.from(root.getElementsByTagName('*'))]
    if (all.length > 15000) throw new Error('The SLD has too many elements.')
    if (all.some((node) => ![SLD, SE, OGC].includes(node.namespaceURI ?? '')))
      throw new Error('The SLD contains unsupported element namespaces.')
    for (const node of all) {
      const allowed =
        node === root
          ? ['version']
          : ['CssParameter', 'SvgParameter'].includes(node.localName)
            ? ['name']
            : node.localName === 'Interpolate'
              ? ['fallbackValue', 'mode', 'method']
              : node.localName.startsWith('PropertyIs')
                ? ['matchCase']
                : []
      for (const attribute of Array.from(node.attributes)) {
        if (
          attribute.namespaceURI === 'http://www.w3.org/2000/xmlns/' ||
          (attribute.namespaceURI === 'http://www.w3.org/2001/XMLSchema-instance' &&
            attribute.localName === 'schemaLocation')
        )
          continue
        if (attribute.namespaceURI || !allowed.includes(attribute.name))
          throw new Error('Unsupported ' + node.localName + ' attribute "' + attribute.name + '".')
      }
    }
    const metadata = xml.match(/<!--PGMapsStyleV1:([A-Za-z0-9+/=]+)-->/)
    if (metadata) {
      try {
        const value = decoded(metadata[1]) as { name: string; style: unknown }
        const style = checkedVectorStyle(value.style)
        if (style.geometry === 'any') throw new Error('SLD needs an explicit geometry.')
        const expected = parseDocument(exportStyleSld(style, value.name, style.geometry))
        if (signature(root) !== signature(expected.documentElement))
          throw new Error('SLD content was changed after export.')
        return {
          ...result,
          name: value.name,
          style,
          diagnostics: [
            {
              severity: 'warning',
              message:
                'PGMaps typed style metadata matched the exported XML. External SLD renderers interpret literal types using their dataset schema.',
            },
          ],
        }
      } catch {
        result.diagnostics.push({
          severity: 'warning',
          message:
            'Embedded PGMaps style metadata did not match the XML; only the actual supported XML will be considered.',
        })
      }
    }
    ensureChildren(root, ['Name', 'Title', 'Abstract', 'NamedLayer'])
    const layer = one(root, 'NamedLayer')!
    ensureChildren(layer, ['Name', 'UserStyle'])
    const userStyle = one(layer, 'UserStyle')!
    ensureChildren(userStyle, ['Name', 'Title', 'Abstract', 'Description', 'IsDefault', 'FeatureTypeStyle'])
    result.name = (
      plain(one(userStyle, 'Name', false)).trim() ||
      plain(one(layer, 'Name', false)).trim() ||
      'Imported SLD'
    ).slice(0, 200)
    const featureStyle = one(userStyle, 'FeatureTypeStyle')!
    ensureChildren(featureStyle, ['Name', 'Title', 'Abstract', 'Description', 'Rule'])
    const rules = children(featureStyle, 'Rule')
    if (!rules.length || rules.length > 65) throw new Error('SLD needs 1–65 supported rules.')
    const parsed = rules.map((rule, index) => {
      ensureChildren(rule, [
        'Name',
        'Title',
        'Abstract',
        'Description',
        'Filter',
        'ElseFilter',
        'PointSymbolizer',
        'LineSymbolizer',
        'PolygonSymbolizer',
      ])
      const symbolizers = children(rule).filter((node) => node.localName.endsWith('Symbolizer'))
      if (symbolizers.length !== 1) throw new Error('Each SLD rule must contain one supported symbolizer.')
      const symbol = readSymbol(symbolizers[0])
      const filter = one(rule, 'Filter', false),
        otherwise = one(rule, 'ElseFilter', false)
      if (filter && otherwise) throw new Error('A rule cannot contain both Filter and ElseFilter.')
      if (otherwise) ensureChildren(otherwise, [])
      return {
        ...symbol,
        name:
          plain(one(rule, 'Name', false)).trim() || plain(one(rule, 'Title', false)).trim() || 'Rule ' + (index + 1),
        condition: filter ? readFilter(filter, data ? styleFieldTypes(data) : {}, result.diagnostics) : undefined,
        otherwise: !!otherwise,
      }
    })
    const geometry = parsed[0].geometry
    if (parsed.some((rule) => rule.geometry !== geometry))
      throw new Error('Mixed symbolizer geometries require separate imported styles.')
    const common = { schema: 'nechako-vector-style-v1' as const, geometry }
    if (parsed.length === 1 && !parsed[0].condition && !parsed[0].otherwise) {
      const item = parsed[0]
      result.style = checkedVectorStyle(
        item.gradient
          ? { ...common, base: item.symbol, mode: 'gradient', ...item.gradient }
          : { ...common, base: item.symbol, mode: 'single' },
      )
    } else {
      if (parsed.some((rule) => rule.gradient)) throw new Error('Gradients nested in comparison rules are unsupported.')
      const fallback = parsed.filter((rule) => rule.otherwise)
      if (fallback.length > 1 || parsed.some((rule) => !rule.condition && !rule.otherwise))
        throw new Error(
          'Multiple/all-feature SLD rules can paint overlapping symbols; this cannot be imported as a first-match style.',
        )
      const conditional = parsed.filter((rule) => rule.condition)
      for (let i = 0; i < conditional.length; i++)
        for (let j = i + 1; j < conditional.length; j++)
          if (mayOverlap(conditional[i].condition!, conditional[j].condition!))
            throw new Error(
              'SLD rules "' +
                conditional[i].name +
                '" and "' +
                conditional[j].name +
                '" may overlap. OGC draws all matches; automatic first-match conversion would change the result.',
            )
      const invisible = { ...DEFAULT_STYLE_SYMBOL, fillOpacity: 0, strokeOpacity: 0, pointOpacity: 0 }
      const rules: StyleRule[] = conditional.map((item, index) => ({
        id: 'sld-' + index,
        name: item.name,
        enabled: true,
        condition: item.condition!,
        symbol: item.symbol,
      }))
      result.style = checkedVectorStyle({ ...common, mode: 'rules', base: fallback[0]?.symbol ?? invisible, rules })
    }
    if (descendants(root, 'Description').length)
      result.diagnostics.push({
        severity: 'warning',
        message: 'Descriptive XML remains in the original; it is not a rendered label.',
      })
  } catch (reason) {
    delete result.style
    result.diagnostics.push({ severity: 'error', message: reason instanceof Error ? reason.message : String(reason) })
  }
  return result
}
