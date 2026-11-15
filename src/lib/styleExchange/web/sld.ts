/**
 * OGC Styled Layer Descriptor 1.1.0 with Symbology Encoding 1.1 (`se:`) and Filter 1.1 (`ogc:`),
 * the style GeoServer, QGIS, MapServer and GeoStyler read. One SLD per layer, named after the
 * layer id (the data file's stem). Every file validates against the OGC SLD 1.1.0 schema.
 *
 * Units: every symbolizer says `uom` pixel, and points become SE "standardized rendering pixels"
 * of 0.28 mm, so 1 pt = 25.4 / 72 / 0.28 ≈ 1.26 px (SE 1.1 §10.3). SLD draws every rule a
 * feature matches, so each rule also excludes the rules above it (`ogc:And` / `ogc:Not` /
 * `ogc:Or`) unless their values cannot overlap, and the "everything else" rule is
 * `se:ElseFilter`.
 *
 * Where SE leaves room or QGIS reads it differently from GeoServer, the file follows QGIS, checked
 * by loading it into QGIS: line offsets (PerpendicularOffset) are positive to the right of travel
 * and a polygon outline's positive offset is inward; markers along a line are a GraphicStroke whose
 * Gap is the distance from one marker to the next, with a well-known Mark after the SVG (QGIS
 * reads no marker line without one); hatches are `horline` marks turned counter-clockwise by
 * Rotation, as QGIS writes line pattern fills; SVGs are a `data:` URL (QGIS ignores
 * InlineContent) followed by the same SVG as InlineContent. Marker fills are a GraphicFill of one
 * SVG tile that carries the grid spacing; outlines are their own PolygonSymbolizer; labels are a
 * TextSymbolizer in a second FeatureTypeStyle so they draw on top.
 *
 * Each SLD also carries the layer as a PGMaps comment. `readSld` trusts it only when the XML still
 * reads exactly as PGMaps wrote it, which is how literal types (`"12"` the text versus 12 the
 * number) and icon details survive; any other SLD is read from its XML, conservatively, with a
 * diagnostic for everything it cannot carry. No DOM or network access.
 */
import { checkedSheetSymbol } from '../checkedSymbol'
import { parseColor, rgba, toHex, withOpacity, type Rgba } from '../color'
import { base64Utf8, iconFromSvg, iconSvg, utf8FromBase64 } from '../iconGeometry'
import {
  geometryOfSymbol,
  type FieldValue,
  type LabelStyle,
  type ReadResult,
  type RuleFilter,
  type StyleDocument,
  type StyledLayer,
  type StyleRule,
  type WriteResult,
} from '../model'
import {
  attr,
  child,
  childElements,
  el,
  localName,
  num,
  parseXml,
  textEl,
  textOf,
  writeXml,
  XML_DECLARATION,
  type XmlElement,
  type XmlNodeSpec,
} from '../xml'
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import { ICONS, type IconId } from '@/lib/mapSheet/icons'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { iconOps, type AreaSymbol, type Hatch, type LineSymbol, type SheetSymbol } from '@/lib/mapSheet/symbols'
import {
  checkedLayer,
  diagnostics,
  exclusions,
  fieldsFromRules,
  round,
  safeLayerId,
  sameFilter,
  sortedRules,
  warnOverlaps,
  type Diagnose,
} from './common'

/** SE standardized rendering pixels per point: a pixel is 0.28 mm. */
export const SE_PX_PER_PT = 25.4 / 72 / 0.28
export const SE_PIXEL_UOM = 'http://www.opengeospatial.org/se/units/pixel'
const NS = {
  sld: 'http://www.opengis.net/sld',
  se: 'http://www.opengis.net/se',
  ogc: 'http://www.opengis.net/ogc',
  xlink: 'http://www.w3.org/1999/xlink',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
}
const SCHEMA_LOCATION = 'http://www.opengis.net/sld http://schemas.opengis.net/sld/1.1.0/StyledLayerDescriptor.xsd'
const METADATA_PREFIX = 'pgmaps-style-exchange-v1:'

const px = (pt: number) => num(pt * SE_PX_PER_PT, 3)
const fromPx = (value: number) => round(value / SE_PX_PER_PT, 3)
const svgParam = (name: string, value: string | number) => textEl('se:SvgParameter', value, { name })

/* ------------------------------------------------------------------------------------------ */
/* Writing                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const literal = (value: FieldValue) => textEl('ogc:Literal', typeof value === 'number' ? String(value) : String(value))
const property = (field: string) => textEl('ogc:PropertyName', field)
const compare = (op: string, field: string, value: FieldValue) =>
  el(`ogc:${op}`, op === 'PropertyIsEqualTo' ? { matchCase: 'true' } : undefined, property(field), literal(value))

function filterXml(filter: RuleFilter): XmlNodeSpec {
  if (filter.op === 'eq') return compare('PropertyIsEqualTo', filter.field, filter.value)
  if (filter.op === 'in')
    return filter.values.length === 1
      ? compare('PropertyIsEqualTo', filter.field, filter.values[0])
      : el('ogc:Or', undefined, ...filter.values.map((v) => compare('PropertyIsEqualTo', filter.field, v)))
  const parts = [
    filter.min !== undefined && compare('PropertyIsGreaterThanOrEqualTo', filter.field, filter.min),
    filter.max !== undefined && compare('PropertyIsLessThan', filter.field, filter.max),
  ].filter((p): p is XmlNodeSpec => !!p)
  // A range with neither bound matches every number; SLD has no type test, so "not null" stands in.
  if (!parts.length) return el('ogc:Not', undefined, el('ogc:PropertyIsNull', undefined, property(filter.field)))
  return parts.length === 1 ? parts[0] : el('ogc:And', undefined, ...parts)
}

const anyOf = (filters: RuleFilter[]) =>
  filters.length === 1 ? filterXml(filters[0]) : el('ogc:Or', undefined, ...filters.map(filterXml))

/** The rule's filter, excluding the earlier rules it could overlap so the first match still wins. */
function exclusiveFilterXml(filter: RuleFilter, excluded: RuleFilter[]): XmlNodeSpec {
  const own = filterXml(filter)
  if (!excluded.length) return el('ogc:Filter', undefined, own)
  return el('ogc:Filter', undefined, el('ogc:And', undefined, own, el('ogc:Not', undefined, anyOf(excluded))))
}

/** SVG colour and opacity parameters for a CSS colour times an opacity. */
function colorParams(prefix: 'fill' | 'stroke', color: string, opacity = 1): XmlNodeSpec[] {
  const c = withOpacity(color, opacity)
  return [svgParam(prefix, toHex(c)), ...(c.a < 1 ? [svgParam(`${prefix}-opacity`, num(c.a, 3))] : [])]
}

const JOINS = { miter: 'mitre', round: 'round', bevel: 'bevel' } as const
function strokeParams(stroke: StrokeStyle): XmlNodeSpec[] {
  return [
    ...colorParams('stroke', stroke.color, stroke.opacity),
    svgParam('stroke-width', px(stroke.width)),
    ...(stroke.join ? [svgParam('stroke-linejoin', JOINS[stroke.join])] : []),
    ...(stroke.cap ? [svgParam('stroke-linecap', stroke.cap)] : []),
    ...(stroke.dash?.length ? [svgParam('stroke-dasharray', stroke.dash.map(px).join(' '))] : []),
  ]
}

/**
 * An SVG as two ExternalGraphics: a `data:` URL, which QGIS reads (it ignores InlineContent), then
 * SE's own InlineContent for readers that take that. A reader uses the first graphic it can draw.
 */
const svgGraphics = (svg: string): XmlNodeSpec[] => {
  const base64 = base64Utf8(svg)
  return [
    el(
      'se:ExternalGraphic',
      undefined,
      el('se:OnlineResource', { 'xlink:type': 'simple', 'xlink:href': `data:image/svg+xml;base64,${base64}` }),
      textEl('se:Format', 'image/svg+xml'),
    ),
    el(
      'se:ExternalGraphic',
      undefined,
      textEl('se:InlineContent', base64, { encoding: 'base64' }),
      textEl('se:Format', 'image/svg+xml'),
    ),
  ]
}

/** The SE well-known mark nearest an icon, drawn when a reader cannot draw the SVG. QGIS needs one to read markers along a line. */
const fallbackMark = (icon: IconId, color: string) =>
  el(
    'se:Mark',
    undefined,
    textEl('se:WellKnownName', icon === 'cross' ? 'x' : icon === 'diamond' || icon === 'tower' ? 'square' : 'circle'),
    el('se:Fill', undefined, ...colorParams('fill', color)),
  )

/** A Graphic drawing one of our icons, `sizePt` its box: a circle mark for a plain dot, else inline SVG. */
function iconGraphic(
  icon: IconId,
  sizePt: number,
  colors: { primary: string; secondary?: string },
  halo?: { color: string; width: number },
): XmlNodeSpec {
  if (icon === 'dot' && !halo)
    return el(
      'se:Graphic',
      undefined,
      el(
        'se:Mark',
        undefined,
        textEl('se:WellKnownName', 'circle'),
        el('se:Fill', undefined, ...colorParams('fill', colors.primary)),
      ),
      textEl('se:Size', px(sizePt * 0.9)),
    )
  const { svg, side } = iconSvg(icon, sizePt, colors, halo)
  return el(
    'se:Graphic',
    undefined,
    ...svgGraphics(svg),
    fallbackMark(icon, colors.primary),
    textEl('se:Size', px(side)),
  )
}

/**
 * A hatch as QGIS writes a line pattern fill: a `horline` mark tile as wide as the spacing, turned
 * by `Rotation` counter-clockwise. QGIS reads that back exactly; it reads `slash` and the other
 * diagonal marks as a grid of points. SE itself defines Rotation as clockwise, so GeoServer draws
 * a diagonal hatch mirrored and breaks it at the tile edges.
 */
export function hatchMark(hatch: Hatch): { mark: string; size: number; rotation: number } {
  const angle = round(((hatch.angleDeg % 180) + 180) % 180, 3)
  return { mark: 'horline', size: hatch.spacing, rotation: angle }
}

function hatchSymbolizer(hatch: Hatch, add: Diagnose, subject: string): XmlNodeSpec {
  const { mark, size, rotation } = hatchMark(hatch)
  if (rotation % 90 !== 0)
    add(
      'warning',
      `A ${hatch.angleDeg}° hatch is written as QGIS writes it (horizontal lines turned counter-clockwise); GeoServer turns the tile clockwise, so it draws the lines mirrored and broken at tile edges.`,
      subject,
    )
  if (hatch.phase)
    add('warning', 'A hatch phase (offset between line families) has no SLD equivalent and is dropped.', subject)
  return el(
    'se:PolygonSymbolizer',
    { uom: SE_PIXEL_UOM },
    el(
      'se:Fill',
      undefined,
      el(
        'se:GraphicFill',
        undefined,
        el(
          'se:Graphic',
          undefined,
          el(
            'se:Mark',
            undefined,
            textEl('se:WellKnownName', mark),
            el('se:Stroke', undefined, ...strokeParams({ ...hatch.stroke, dash: undefined })),
          ),
          textEl('se:Size', px(size)),
          rotation ? textEl('se:Rotation', num(rotation, 3)) : null,
        ),
      ),
    ),
  )
}

/** An SVG tile repeating a marker fill's icon on its grid, staggered rows two rows tall. */
export function markerFillTile(fill: NonNullable<AreaSymbol['markerFill']>): {
  svg: string
  width: number
  height: number
} {
  const width = fill.spacingX
  const height = fill.spacingY * (fill.stagger ? 2 : 1)
  const colors = { primary: fill.color, secondary: fill.secondary }
  const at = (x: number, y: number) => iconOps(fill.icon, x, y, fill.size, 0, colors)
  const ops = [
    ...at(width / 2, fill.spacingY / 2),
    ...(fill.stagger ? [...at(0, fill.spacingY * 1.5), ...at(width, fill.spacingY * 1.5)] : []),
  ]
  const tag = `data-pgmaps-icon="${fill.icon}" data-pgmaps-fill="${[fill.size, fill.spacingX, fill.spacingY, fill.stagger ? 1 : 0].join(' ')}"`
  const svg = sheetSvg(ops, width, height, undefined, null).replace('<svg ', `<svg ${tag} `)
  return { svg, width, height }
}

/** Whether every offset stroke or marker has a mirror twin, so the side offsets go to does not matter. */
const offsetsSymmetric = (symbol: LineSymbol) => {
  const offsets = [...symbol.layers, ...(symbol.markers ?? [])].map((part) => part.offset ?? 0).filter(Boolean)
  return offsets.every((o) => offsets.filter((x) => x === o).length === offsets.filter((x) => x === -o).length)
}

function lineSymbolizers(symbol: LineSymbol, add: Diagnose, subject: string): XmlNodeSpec[] {
  if (!offsetsSymmetric(symbol))
    add(
      'warning',
      'Offsets are written as QGIS reads them (positive to the right of travel); GeoServer reads SE offsets as positive to the left, so it draws them on the other side.',
      subject,
    )
  const out: XmlNodeSpec[] = symbol.layers.map((layer) =>
    el(
      'se:LineSymbolizer',
      { uom: SE_PIXEL_UOM },
      el('se:Stroke', undefined, ...strokeParams(layer)),
      layer.offset ? textEl('se:PerpendicularOffset', px(layer.offset)) : null,
    ),
  )
  for (const marker of symbol.markers ?? []) {
    const graphic = iconGraphic(marker.icon, marker.size, { primary: marker.color, secondary: marker.secondary })
    if (marker.start !== undefined)
      add(
        'info',
        'QGIS does not read where the first marker along a line falls (InitialGap); it may start elsewhere.',
        subject,
      )
    const start = marker.start ?? marker.spacing / 2
    out.push(
      el(
        'se:LineSymbolizer',
        { uom: SE_PIXEL_UOM },
        el(
          'se:Stroke',
          undefined,
          el(
            'se:GraphicStroke',
            undefined,
            graphic,
            // QGIS reads a gap only as an ogc:Literal.
            el('se:InitialGap', undefined, textEl('ogc:Literal', px(start))),
            el('se:Gap', undefined, textEl('ogc:Literal', px(marker.spacing))),
          ),
        ),
        marker.offset ? textEl('se:PerpendicularOffset', px(marker.offset)) : null,
      ),
    )
  }
  return out
}

function areaSymbolizers(symbol: AreaSymbol, add: Diagnose, subject: string): XmlNodeSpec[] {
  const out: XmlNodeSpec[] = []
  if (symbol.fill)
    out.push(
      el(
        'se:PolygonSymbolizer',
        { uom: SE_PIXEL_UOM },
        el('se:Fill', undefined, ...colorParams('fill', symbol.fill, symbol.fillOpacity)),
      ),
    )
  for (const hatch of symbol.hatches ?? []) out.push(hatchSymbolizer(hatch, add, subject))
  if (symbol.markerFill) {
    const tile = markerFillTile(symbol.markerFill)
    out.push(
      el(
        'se:PolygonSymbolizer',
        { uom: SE_PIXEL_UOM },
        el(
          'se:Fill',
          undefined,
          el(
            'se:GraphicFill',
            undefined,
            el('se:Graphic', undefined, ...svgGraphics(tile.svg), textEl('se:Size', px(tile.height))),
          ),
        ),
      ),
    )
  }
  for (const layer of symbol.outline) {
    if (layer.inside)
      add(
        'info',
        'An inside casing is written as an outline moved inward by half its width, as QGIS reads PerpendicularOffset (positive inward); GeoServer reads a positive offset as outward, and a reader that ignores it centres the casing on the edge.',
        subject,
      )
    out.push(
      el(
        'se:PolygonSymbolizer',
        { uom: SE_PIXEL_UOM },
        el('se:Stroke', undefined, ...strokeParams(layer)),
        layer.inside ? textEl('se:PerpendicularOffset', px(layer.width / 2)) : null,
      ),
    )
  }
  return out
}

function symbolizers(layer: StyledLayer, symbol: SheetSymbol, add: Diagnose, subject: string): XmlNodeSpec[] {
  if (symbol.kind === 'line') return lineSymbolizers(symbol, add, subject)
  if (symbol.kind === 'area') return areaSymbolizers(symbol, add, subject)
  if (symbol.kind === 'point')
    return [
      el(
        'se:PointSymbolizer',
        { uom: SE_PIXEL_UOM },
        iconGraphic(symbol.icon, symbol.size, { primary: symbol.color, secondary: symbol.secondary }, symbol.halo),
      ),
    ]
  // A class colour: a solid fill on polygons, a 1 pt line or a dot otherwise.
  if (layer.geometry === 'polygon')
    return [
      el(
        'se:PolygonSymbolizer',
        { uom: SE_PIXEL_UOM },
        el('se:Fill', undefined, ...colorParams('fill', symbol.color, symbol.opacity)),
      ),
    ]
  add(
    'warning',
    `A class colour on a ${layer.geometry} layer is written as a plain ${layer.geometry === 'line' ? '1 pt line' : 'dot'}.`,
    subject,
  )
  if (layer.geometry === 'line')
    return lineSymbolizers(
      { kind: 'line', label: symbol.label, layers: [{ color: symbol.color, width: 1, opacity: symbol.opacity }] },
      add,
      subject,
    )
  return [el('se:PointSymbolizer', { uom: SE_PIXEL_UOM }, iconGraphic('dot', 4, { primary: symbol.color }))]
}

function labelRule(label: LabelStyle): XmlNodeSpec {
  return el(
    'se:Rule',
    undefined,
    textEl('se:Name', 'Labels'),
    el(
      'se:TextSymbolizer',
      { uom: SE_PIXEL_UOM },
      el('se:Label', undefined, property(label.field)),
      el(
        'se:Font',
        undefined,
        svgParam('font-family', 'sans-serif'),
        svgParam('font-size', px(label.size)),
        ...(label.bold ? [svgParam('font-weight', 'bold')] : []),
      ),
      el(
        'se:LabelPlacement',
        undefined,
        label.placement === 'line'
          ? el('se:LinePlacement', undefined, textEl('se:IsAligned', 'true'))
          : // To the right of the point, clear of its icon.
            el(
              'se:PointPlacement',
              undefined,
              el('se:AnchorPoint', undefined, textEl('se:AnchorPointX', '0'), textEl('se:AnchorPointY', '0.5')),
              el(
                'se:Displacement',
                undefined,
                textEl('se:DisplacementX', px(label.size)),
                textEl('se:DisplacementY', '0'),
              ),
            ),
      ),
      label.halo
        ? el(
            'se:Halo',
            undefined,
            textEl('se:Radius', px(label.halo.width)),
            el('se:Fill', undefined, ...colorParams('fill', label.halo.color)),
          )
        : null,
      el('se:Fill', undefined, ...colorParams('fill', label.color)),
    ),
  )
}

const description = (title: string) => el('se:Description', undefined, textEl('se:Title', title))

/** The SLD document for one layer, without the PGMaps comment. */
function sldBody(layer: StyledLayer, add: Diagnose): string {
  const excluded = exclusions(layer.rules)
  const filtered = layer.rules.some((r) => r.filter)
  const rules = layer.rules.map((rule, index) => {
    const subject = `${layer.name}: ${rule.label}`
    if (geometryOfSymbol(rule.symbol) !== layer.geometry && rule.symbol.kind !== 'class')
      add(
        'error',
        `A ${rule.symbol.kind} symbol on a ${layer.geometry} layer is written as it is; SLD readers may skip it.`,
        subject,
      )
    return el(
      'se:Rule',
      undefined,
      textEl('se:Name', rule.label),
      description(rule.label),
      rule.filter ? exclusiveFilterXml(rule.filter, excluded[index]) : filtered ? el('se:ElseFilter') : null,
      ...symbolizers(layer, rule.symbol, add, subject),
    )
  })
  const featureStyles = [
    el('se:FeatureTypeStyle', undefined, ...rules),
    layer.label ? el('se:FeatureTypeStyle', undefined, labelRule(layer.label)) : null,
  ]
  const root = el(
    'StyledLayerDescriptor',
    {
      version: '1.1.0',
      xmlns: NS.sld,
      'xmlns:se': NS.se,
      'xmlns:ogc': NS.ogc,
      'xmlns:xlink': NS.xlink,
      'xmlns:xsi': NS.xsi,
      'xsi:schemaLocation': SCHEMA_LOCATION,
    },
    el(
      'NamedLayer',
      undefined,
      textEl('se:Name', layer.id),
      el('UserStyle', undefined, textEl('se:Name', layer.id), description(layer.name), ...featureStyles),
    ),
  )
  return writeXml(root)
}

/** One layer as SLD 1.1, with the layer carried in a comment for an exact read back. */
export function sldForLayer(layer: StyledLayer): { sld: string; diagnostics: WriteResult['diagnostics'] } {
  const { list, add } = diagnostics('sld')
  if (!/^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(layer.label?.field ?? 'x'))
    add(
      'warning',
      `The label field "${layer.label?.field}" is not a plain XML name; some readers will not resolve it.`,
      layer.name,
    )
  for (const rule of layer.rules)
    if (rule.filter && !/^[\p{L}_][\p{L}\p{N}_.-]*$/u.test(rule.filter.field))
      add(
        'warning',
        `The field "${rule.filter.field}" is not a plain XML name; some readers will not resolve it.`,
        layer.name,
      )
  const body = sldBody(layer, add)
  const comment = `<!--${METADATA_PREFIX}${base64Utf8(JSON.stringify(layer))}-->`
  // The comment goes inside the root so it survives tools that keep the root's content.
  const sld = `${XML_DECLARATION}\n${body.replace(/^(<StyledLayerDescriptor[^>]*>)/, `$1\n  ${comment}`)}\n`
  return { sld, diagnostics: list }
}

/** One `.sld` per layer, named by layer id. */
export function sldLayerStyles(doc: StyleDocument): WriteResult {
  const files: WriteResult['files'] = []
  const all: WriteResult['diagnostics'] = []
  for (const layer of doc.layers) {
    const { sld, diagnostics: found } = sldForLayer(layer)
    files.push({ path: `${layer.id}.sld`, content: sld, mime: 'application/vnd.ogc.sld+xml' })
    all.push(...found)
  }
  return { files, diagnostics: all }
}

/* ------------------------------------------------------------------------------------------ */
/* Reading                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** Largest number of elements read from one SLD. */
export const MAX_SLD_ELEMENTS = 20000

/** Element structure for comparing a file with what PGMaps would write: names, attributes, text. */
function signature(element: XmlElement): string {
  const attributes = Array.from({ length: element.attributes.length }, (_, i) => element.attributes.item(i)!)
    .filter((a) => !/^xmlns(:|$)/.test(a.name) && a.localName !== 'schemaLocation')
    .map((a) => `${a.localName}=${a.value}`)
    .sort()
  const kids = childElements(element)
  const text = kids.length ? '' : textOf(element)
  return `<${element.namespaceURI ?? ''}|${localName(element)} ${attributes.join(' ')}>${text}${kids.map(signature).join('')}</>`
}

/** The PGMaps layer a comment carries, when the XML around it is still exactly what PGMaps wrote. */
function trustedMetadata(xml: string, root: XmlElement, add: Diagnose): StyledLayer | null {
  const match = new RegExp(`<!--${METADATA_PREFIX}([A-Za-z0-9+/=]+)-->`).exec(xml)
  if (!match) return null
  try {
    const layer = checkedLayer(JSON.parse(utf8FromBase64(match[1])), checkedSheetSymbol)
    const expected = parseXml(sldForLayer(layer).sld)
    if (signature(expected) === signature(root)) return layer
  } catch {
    // Fall through to the XML.
  }
  add(
    'info',
    'The SLD carries PGMaps style details that no longer match its XML (it was edited); it is read from the XML.',
  )
  return null
}

/** A filter read from XML, before it is typed. */
type Cond =
  | { kind: 'cmp'; op: 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'; field: string; literal: string }
  | { kind: 'between'; field: string; lo: string; hi: string }
  | { kind: 'and' | 'or'; parts: Cond[] }
  | { kind: 'not'; part: Cond }

const COMPARISONS: Record<string, Extract<Cond, { kind: 'cmp' }>['op']> = {
  PropertyIsEqualTo: 'eq',
  PropertyIsNotEqualTo: 'ne',
  PropertyIsLessThan: 'lt',
  PropertyIsLessThanOrEqualTo: 'le',
  PropertyIsGreaterThan: 'gt',
  PropertyIsGreaterThanOrEqualTo: 'ge',
}

/** Reads a filter element; throws an Error naming what it cannot read. */
function readCond(element: XmlElement): Cond {
  const name = localName(element)
  const kids = childElements(element)
  if (name === 'And' || name === 'Or') {
    if (kids.length < 2) throw Error(`ogc:${name} needs two or more parts.`)
    return { kind: name === 'And' ? 'and' : 'or', parts: kids.map(readCond) }
  }
  if (name === 'Not') {
    if (kids.length !== 1) throw Error('ogc:Not needs one part.')
    return { kind: 'not', part: readCond(kids[0]) }
  }
  const op = COMPARISONS[name]
  if (op) {
    if (attr(element, 'matchCase') === 'false') throw Error('Case-insensitive comparisons are not read.')
    const field = kids.find((k) => localName(k) === 'PropertyName')
    const value = kids.find((k) => localName(k) === 'Literal')
    if (!field || !value || kids.length !== 2 || childElements(value).length)
      throw Error(`ogc:${name} must compare a property with a literal.`)
    return { kind: 'cmp', op, field: textOf(field), literal: value.textContent ?? '' }
  }
  if (name === 'PropertyIsBetween') {
    const field = child(element, 'PropertyName')
    const lo = textOf(child(child(element, 'LowerBoundary') ?? element, 'Literal'))
    const hi = textOf(child(child(element, 'UpperBoundary') ?? element, 'Literal'))
    if (!field || !lo || !hi) throw Error('ogc:PropertyIsBetween must compare a property with two literals.')
    return { kind: 'between', field: textOf(field), lo, hi }
  }
  throw Error(`ogc:${name} filters are not read.`)
}

type Untyped =
  | { field: string; op: 'eq'; value: string }
  | { field: string; op: 'in'; values: string[] }
  | { field: string; op: 'range'; min?: string; max?: string }

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i

/** The model filter a condition is, or an Error. Bounds other than ≥ min and < max are approximated. */
function untypedFilter(cond: Cond, add: Diagnose, subject: string): Untyped {
  if (cond.kind === 'cmp' && cond.op === 'eq') return { field: cond.field, op: 'eq', value: cond.literal }
  if (cond.kind === 'cmp' && cond.op !== 'ne') {
    if (cond.op === 'gt' || cond.op === 'le')
      add(
        'warning',
        `"${cond.op === 'gt' ? '>' : '≤'} ${cond.literal}" is read as "${cond.op === 'gt' ? '≥' : '<'} ${cond.literal}": PGMaps ranges include their minimum and exclude their maximum.`,
        subject,
      )
    return cond.op === 'gt' || cond.op === 'ge'
      ? { field: cond.field, op: 'range', min: cond.literal }
      : { field: cond.field, op: 'range', max: cond.literal }
  }
  if (cond.kind === 'between') {
    add(
      'warning',
      `A between filter on ${cond.field} includes its upper bound; it is read as a range that excludes it.`,
      subject,
    )
    return { field: cond.field, op: 'range', min: cond.lo, max: cond.hi }
  }
  if (cond.kind === 'or') {
    const parts = cond.parts.map((p) => untypedFilter(p, add, subject))
    if (parts.every((p) => p.op === 'eq' && p.field === parts[0].field))
      return { field: parts[0].field, op: 'in', values: parts.map((p) => (p as { value: string }).value) }
  }
  if (cond.kind === 'and' && cond.parts.length === 2) {
    const [a, b] = cond.parts.map((p) => untypedFilter(p, add, subject))
    if (a.op === 'range' && b.op === 'range' && a.field === b.field) {
      const min = a.min ?? b.min,
        max = a.max ?? b.max
      if ((a.min === undefined || b.min === undefined) && (a.max === undefined || b.max === undefined))
        return {
          field: a.field,
          op: 'range',
          ...(min !== undefined ? { min } : {}),
          ...(max !== undefined ? { max } : {}),
        }
    }
  }
  throw Error('This combination of conditions has no PGMaps rule equivalent.')
}

/**
 * The rule's own condition, once the "and not the rules above" clause a draw-every-match format
 * needs is taken off, when that clause names only rules above it.
 */
function ownCondition(cond: Cond, earlier: Cond[]): Cond {
  if (cond.kind !== 'and' || cond.parts.length !== 2) return cond
  const [own, not] = cond.parts
  if (not.kind !== 'not') return cond
  const excluded = not.part.kind === 'or' ? not.part.parts : [not.part]
  const known = new Set(earlier.map((c) => JSON.stringify(c)))
  return excluded.every((c) => known.has(JSON.stringify(c))) ? own : cond
}

/** Typed literals: a field compared as a range is a number, every other is text. */
function typedFilter(filter: Untyped, numeric: Set<string>, add: Diagnose, subject: string): RuleFilter {
  const typed = (text: string): FieldValue => {
    if (!numeric.has(filter.field)) return text
    if (!NUMBER.test(text.trim())) throw Error(`"${text}" is compared as a number on ${filter.field} but is not one.`)
    return Number(text)
  }
  if (
    !numeric.has(filter.field) &&
    filter.op !== 'range' &&
    (filter.op === 'eq' ? [filter.value] : filter.values).some((v) => NUMBER.test(v.trim()))
  )
    add(
      'info',
      `Values of ${filter.field} are compared as text ("${filter.op === 'eq' ? filter.value : filter.values[0]}"); SLD does not say whether the field is a number.`,
      subject,
    )
  if (filter.op === 'eq') return { field: filter.field, op: 'eq', value: typed(filter.value) }
  if (filter.op === 'in') return { field: filter.field, op: 'in', values: filter.values.map(typed) }
  const bound = (text: string | undefined) => {
    if (text === undefined) return undefined
    if (!NUMBER.test(text.trim())) throw Error(`The range bound "${text}" on ${filter.field} is not a number.`)
    return Number(text)
  }
  const min = bound(filter.min),
    max = bound(filter.max)
  return {
    field: filter.field,
    op: 'range',
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  }
}

/** SVG and CSS parameters by name, read as plain text; dynamic expressions are reported. */
function params(element: XmlElement | undefined, add: Diagnose, subject: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of element ? childElements(element) : []) {
    if (!['SvgParameter', 'CssParameter'].includes(localName(p))) continue
    const name = attr(p, 'name') ?? ''
    if (childElements(p).length) {
      add('warning', `The ${name} value is an expression; it is not read.`, subject)
      continue
    }
    out[name] = textOf(p)
  }
  return out
}

/** A unit reader for one symbolizer: pixels to points, or ground units read as pixels with a warning. */
function unitReader(symbolizer: XmlElement, add: Diagnose, subject: string) {
  const uom = attr(symbolizer, 'uom')
  if (uom && !/pixel$/.test(uom))
    add('warning', `Sizes in ${uom.replace(/^.*\//, '')} change with the map scale; they are read as pixels.`, subject)
  return (value: string | undefined, fallback: number) => {
    const n = value === undefined || value === '' ? NaN : Number(value)
    return Number.isFinite(n) ? fromPx(n) : fallback
  }
}

function readColor(value: string | undefined, opacity: string | undefined, fallback: string): string {
  const color: Rgba = (value && parseColor(value)) || rgba(fallback)
  const alpha = opacity === undefined ? 1 : Math.min(1, Math.max(0, Number(opacity) || 0))
  const a = color.a * alpha
  return a >= 1
    ? toHex(color)
    : `${toHex(color)}${Math.round(a * 255)
        .toString(16)
        .padStart(2, '0')}`
}

function readStroke(
  stroke: XmlElement,
  pt: ReturnType<typeof unitReader>,
  add: Diagnose,
  subject: string,
): StrokeStyle {
  const p = params(stroke, add, subject)
  const join = p['stroke-linejoin']
  const cap = p['stroke-linecap']
  const dash = p['stroke-dasharray']
    ?.split(/[\s,]+/)
    .filter(Boolean)
    .map((d) => pt(d, 0))
  return {
    color: readColor(p.stroke, p['stroke-opacity'], '#000000'),
    width: pt(p['stroke-width'], 1 / SE_PX_PER_PT),
    ...(join === 'mitre' || join === 'miter'
      ? { join: 'miter' }
      : join === 'round' || join === 'bevel'
        ? { join }
        : {}),
    ...(cap === 'round' || cap === 'square' || cap === 'butt' ? { cap } : {}),
    ...(dash?.length && dash.some((d) => d > 0) ? { dash } : {}),
  }
}

const decodeBase64 = (value: string) => {
  try {
    return utf8FromBase64(value)
  } catch {
    return null
  }
}

/** The SVG an ExternalGraphic carries in the file itself (InlineContent, a `data:` URL or QGIS's `base64:`), or null. */
function externalSvg(external: XmlElement): string | null {
  const inline = child(external, 'InlineContent')
  if (inline) return attr(inline, 'encoding') === 'base64' ? decodeBase64(textOf(inline)) : null
  const href = attr(child(external, 'OnlineResource'), 'xlink:href') ?? ''
  const data = /^data:image\/svg\+xml(;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(href)
  if (data) {
    if (data[2]) return decodeBase64(data[3])
    try {
      return decodeURIComponent(data[3])
    } catch {
      return null
    }
  }
  return href.startsWith('base64:') ? decodeBase64(href.slice(7)) : null
}

/**
 * The SVG a Graphic draws from its own file, trying each ExternalGraphic in order as SE readers
 * do, or null with a diagnostic when it names only outside images. Null without one when the
 * Graphic has no ExternalGraphic.
 */
function graphicSvg(graphic: XmlElement, add: Diagnose, subject: string): string | null {
  const externals = childElements(graphic, 'ExternalGraphic')
  for (const external of externals) {
    const svg = externalSvg(external)
    if (svg) return svg
  }
  if (externals.length && !child(graphic, 'Mark'))
    add('error', 'The symbol is an image outside the file (or not SVG); it is not read. Choose a PGMaps icon.', subject)
  return null
}

/** Colours, halo and icon size from an SVG PGMaps wrote with `iconSvg`, scaled to its drawn side; null for other SVGs. */
export function iconFromOurSvg(svg: string, sidePt: number, add: Diagnose, subject: string) {
  const icon = iconFromSvg(svg)
  if (!icon) return null
  try {
    const root = parseXml(svg)
    const shapes = childElements(root).filter((e) => ['circle', 'path'].includes(localName(e)))
    const parts = ICONS[icon].parts
    const view = Number((attr(root, 'viewBox') ?? '').split(/\s+/)[2])
    const scale = Number.isFinite(view) && view > 0 ? sidePt / view : 1
    const haloed = shapes.length === parts.length * 2
    const body = haloed ? shapes.slice(parts.length) : shapes
    const paint = (role: 'primary' | 'secondary') => {
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]
        const value = part.fill === role ? attr(body[i], 'fill') : part.stroke === role ? attr(body[i], 'stroke') : null
        if (value && value !== 'none') return value
      }
      return undefined
    }
    let halo: { color: string; width: number } | undefined
    if (haloed) {
      const width = Number(attr(shapes[0], 'stroke-width') ?? 0) - Number(attr(body[0], 'stroke-width') ?? 0)
      halo = { color: attr(shapes[0], 'stroke') ?? '#ffffff', width: round((width / 2) * scale) }
    }
    const widest = Math.max(0, ...parts.map((part) => part.width ?? 0))
    const size = round((((view || sidePt / scale) - (halo ? (halo.width / scale) * 2 : 0)) / (1 + widest)) * scale)
    return { icon, color: paint('primary') ?? '#000000', secondary: paint('secondary'), halo, size }
  } catch {
    add('warning', 'The PGMaps icon SVG could not be parsed; its colours are not read.', subject)
    return { icon, color: '#000000', secondary: undefined, halo: undefined, size: sidePt }
  }
}

type IconRead = {
  icon: IconId
  size: number
  color: string
  secondary?: string
  halo?: { color: string; width: number }
}

/** An icon from a Graphic: a PGMaps SVG first, then a well-known mark. Other images are errors with a dot substituted. */
function readGraphic(graphic: XmlElement, pt: ReturnType<typeof unitReader>, add: Diagnose, subject: string): IconRead {
  const side = pt(textOf(child(graphic, 'Size')), 6)
  if (child(graphic, 'Rotation')) add('warning', 'A graphic rotation is not read.', subject)
  const svg = graphicSvg(graphic, add, subject)
  const ours = svg ? iconFromOurSvg(svg, side, add, subject) : null
  if (ours) return ours
  const mark = child(graphic, 'Mark')
  if (mark) {
    const name = textOf(child(mark, 'WellKnownName')) || 'square'
    const fill = params(child(mark, 'Fill'), add, subject)
    const stroke = params(child(mark, 'Stroke'), add, subject)
    const icon = iconForMark(name)
    const color = readColor(fill.fill ?? stroke.stroke, fill['fill-opacity'], '#808080')
    if (svg)
      add('warning', `The symbol's SVG image was not drawn by PGMaps; its "${name}" mark is read instead.`, subject)
    if (!icon) {
      add('error', `The "${name}" mark has no PGMaps icon; a dot stands in for it. Choose a PGMaps icon.`, subject)
      return { icon: 'dot', size: side, color }
    }
    if (child(mark, 'Stroke') && child(mark, 'Fill'))
      add('warning', `The ${name} mark's outline is not read; PGMaps icons draw in one colour.`, subject)
    return { icon, size: icon === 'dot' ? round(side / 0.9) : side, color }
  }
  if (svg)
    add(
      'error',
      'The symbol is an SVG image PGMaps did not draw; a dot stands in for it. Choose a PGMaps icon.',
      subject,
    )
  return { icon: 'dot', size: side, color: '#808080' }
}

const iconForMark = (name: string): IconId | null => {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^(shape|ttf):\/\//, '')
  if (key === 'circle') return 'dot'
  if (key === 'cross' || key === 'cross2' || key === 'x' || key === 'times') return 'cross'
  if (key === 'diamond') return 'diamond'
  if (key === 'line' || key === 'vertline') return 'tick'
  return null
}

/** Hatches a hatch mark draws, from the tile side and rotation, as `hatchMark` writes them. */
function hatchesFromMark(name: string, side: number, rotation: number, stroke: StrokeStyle): Hatch[] | null {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^shape:\/\//, '')
  // QGIS turns the mark counter-clockwise, as `hatchMark` writes it.
  const line = (angle: number, spacing: number): Hatch => ({
    angleDeg: round((((angle + rotation) % 180) + 180) % 180, 3),
    spacing: round(spacing),
    stroke,
  })
  const diagonal = side / Math.SQRT2
  switch (key) {
    case 'horline':
      return [line(0, side)]
    case 'vertline':
      return [line(90, side)]
    case 'slash':
      return [line(45, diagonal)]
    case 'backslash':
      return [line(135, diagonal)]
    case 'plus':
      return [line(0, side), line(90, side)]
    case 'times':
      return [line(45, diagonal), line(135, diagonal)]
    default:
      return null
  }
}

/** The parts of an area symbol a PolygonSymbolizer adds. */
function readPolygonSymbolizer(element: XmlElement, area: AreaSymbol, add: Diagnose, subject: string) {
  const pt = unitReader(element, add, subject)
  const fill = child(element, 'Fill')
  if (fill) {
    const graphicFill = child(fill, 'GraphicFill')
    const graphic = graphicFill && child(graphicFill, 'Graphic')
    if (graphic) {
      const mark = child(graphic, 'Mark')
      const side = pt(textOf(child(graphic, 'Size')), 8)
      const rotation = Number(textOf(child(graphic, 'Rotation')) || 0)
      const markStroke = mark && child(mark, 'Stroke')
      const hatches =
        mark && markStroke
          ? hatchesFromMark(
              textOf(child(mark, 'WellKnownName')),
              side,
              rotation,
              readStroke(markStroke, pt, add, subject),
            )
          : null
      if (hatches) area.hatches = [...(area.hatches ?? []), ...hatches]
      else {
        const svg = mark ? null : graphicSvg(graphic, add, subject)
        const tag = svg && /data-pgmaps-fill="([\d. ]+)"/.exec(svg)
        const icon = svg && iconFromSvg(svg)
        const colors = svg && iconFromOurSvg(svg.replace(/data-pgmaps-fill="[^"]*"/, ''), side, add, subject)
        if (tag && icon && colors) {
          const [size, spacingX, spacingY, stagger] = tag[1].split(' ').map(Number)
          const scale = side / (spacingY * (stagger ? 2 : 1))
          area.markerFill = {
            icon,
            size: round(size * scale),
            color: colors.color,
            ...(colors.secondary ? { secondary: colors.secondary } : {}),
            spacingX: round(spacingX * scale),
            spacingY: round(spacingY * scale),
            ...(stagger ? { stagger: true } : {}),
          }
        } else
          add(
            'error',
            mark
              ? `The "${textOf(child(mark, 'WellKnownName'))}" pattern fill has no PGMaps equivalent; it is not read.`
              : 'The pattern fill is an image PGMaps did not draw; it is not read.',
            subject,
          )
      }
    } else {
      const p = params(fill, add, subject)
      if (area.fill) add('warning', 'A second solid fill is not read; the first is kept.', subject)
      else {
        const color = readColor(p.fill, undefined, '#808080')
        const opacity = p['fill-opacity'] === undefined ? 1 : Number(p['fill-opacity'])
        area.fill = color
        if (Number.isFinite(opacity) && opacity < 1) area.fillOpacity = round(opacity, 3)
      }
    }
  }
  const stroke = child(element, 'Stroke')
  if (stroke) {
    if (child(stroke, 'GraphicFill') || child(stroke, 'GraphicStroke'))
      add('warning', 'A patterned or marker outline is read as a plain stroke.', subject)
    const layer = readStroke(stroke, pt, add, subject)
    const offset = pt(textOf(child(element, 'PerpendicularOffset')), 0)
    // QGIS moves a polygon outline inward for a positive offset, as `areaSymbolizers` writes it.
    const inside = offset > 0 && Math.abs(offset - layer.width / 2) < 0.02
    if (offset && !inside) add('warning', 'An outline offset other than an inside casing is not read.', subject)
    area.outline.push({ ...layer, ...(inside ? { inside: true } : {}) })
  }
  if (child(element, 'Displacement')) add('warning', 'A polygon displacement is not read.', subject)
}

function readLineSymbolizer(element: XmlElement, line: LineSymbol, add: Diagnose, subject: string) {
  const pt = unitReader(element, add, subject)
  const stroke = child(element, 'Stroke')
  if (!stroke) return
  // Positive to the right of travel, as QGIS reads and writes it.
  const offset = pt(textOf(child(element, 'PerpendicularOffset')), 0)
  const graphicStroke = child(stroke, 'GraphicStroke')
  if (graphicStroke) {
    const graphic = child(graphicStroke, 'Graphic')
    if (!graphic) return
    const icon = readGraphic(graphic, pt, add, subject)
    if (icon.halo) add('warning', 'A halo round markers along a line is not read.', subject)
    // Gap is the distance from one marker to the next, as QGIS writes and reads it.
    const gap = pt(textOf(child(graphicStroke, 'Gap')), NaN)
    const initial = pt(textOf(child(graphicStroke, 'InitialGap')), NaN)
    const dash = params(stroke, add, subject)['stroke-dasharray']
    let spacing = Number.isFinite(gap) && gap > 0 ? round(gap) : NaN
    if (!Number.isFinite(spacing) && dash) {
      // GeoServer's older convention: a dash array of graphic and gap lengths.
      spacing = round(dash.split(/[\s,]+/).reduce((a, d) => a + pt(d, 0), 0))
      add('warning', 'Marker spacing is read from the dash array (graphic plus gap).', subject)
    }
    if (!Number.isFinite(spacing) || spacing <= 0) {
      add('warning', 'Markers along the line have no gap; they are read as touching.', subject)
      spacing =
        icon.icon === 'dot' ? round(icon.size * 0.9) : iconSvg(icon.icon, icon.size, { primary: icon.color }).side
    }
    line.markers = [
      ...(line.markers ?? []),
      {
        icon: icon.icon,
        size: icon.size,
        color: icon.color,
        ...(icon.secondary ? { secondary: icon.secondary } : {}),
        spacing,
        ...(Number.isFinite(initial) && Math.abs(initial - spacing / 2) > 0.01 ? { start: round(initial) } : {}),
        ...(offset ? { offset: round(offset) } : {}),
      },
    ]
    return
  }
  if (child(stroke, 'GraphicFill')) add('warning', 'A patterned line is read as a plain stroke.', subject)
  line.layers.push({ ...readStroke(stroke, pt, add, subject), ...(offset ? { offset: round(offset) } : {}) })
}

function readLabel(element: XmlElement, add: Diagnose, subject: string): LabelStyle | null {
  const pt = unitReader(element, add, subject)
  const label = child(element, 'Label')
  const field = label && childElements(label).length === 1 && localName(childElements(label)[0]) === 'PropertyName'
  if (!label || !field) {
    add('warning', 'A label made of an expression or fixed text is not read; PGMaps labels show one field.', subject)
    return null
  }
  const font = params(child(element, 'Font'), add, subject)
  const halo = child(element, 'Halo')
  const haloFill = halo && params(child(halo, 'Fill'), add, subject)
  const placement = child(element, 'LabelPlacement')
  return {
    field: textOf(childElements(label)[0]),
    size: pt(font['font-size'], 8),
    color: readColor(params(child(element, 'Fill'), add, subject).fill, undefined, '#000000'),
    ...(halo
      ? {
          halo: { color: readColor(haloFill?.fill, undefined, '#ffffff'), width: pt(textOf(child(halo, 'Radius')), 1) },
        }
      : {}),
    placement: placement && child(placement, 'LinePlacement') ? 'line' : 'point',
    ...(font['font-weight'] === 'bold' ? { bold: true } : {}),
  }
}

/** The rule's symbol from its symbolizers, by the kind of the first one. */
function readSymbol(symbolizers: XmlElement[], label: string, add: Diagnose, subject: string): SheetSymbol | null {
  const kinds = symbolizers.map(localName)
  const first = kinds.find((k) => k !== 'TextSymbolizer')
  if (!first) return null
  if (first === 'PolygonSymbolizer') {
    const area: AreaSymbol = { kind: 'area', label, outline: [] }
    symbolizers.forEach((s, i) => {
      if (kinds[i] === 'PolygonSymbolizer') readPolygonSymbolizer(s, area, add, subject)
      else if (kinds[i] === 'LineSymbolizer') {
        const line: LineSymbol = { kind: 'line', label, layers: [] }
        readLineSymbolizer(s, line, add, subject)
        area.outline.push(...line.layers)
        if (line.markers?.length) add('warning', 'Markers along a polygon outline are not read.', subject)
      } else if (kinds[i] !== 'TextSymbolizer') add('warning', `A ${kinds[i]} on a polygon rule is not read.`, subject)
    })
    if (!area.fill && !area.hatches?.length && !area.markerFill && !area.outline.length) return null
    return area
  }
  if (first === 'LineSymbolizer') {
    const line: LineSymbol = { kind: 'line', label, layers: [] }
    symbolizers.forEach((s, i) => {
      if (kinds[i] === 'LineSymbolizer') readLineSymbolizer(s, line, add, subject)
      else if (kinds[i] !== 'TextSymbolizer') add('warning', `A ${kinds[i]} on a line rule is not read.`, subject)
    })
    return line.layers.length || line.markers?.length ? line : null
  }
  if (first === 'PointSymbolizer') {
    const s = symbolizers[kinds.indexOf('PointSymbolizer')]
    const graphic = child(s, 'Graphic')
    if (!graphic) return null
    if (kinds.filter((k) => k === 'PointSymbolizer').length > 1)
      add('warning', 'Only the first PointSymbolizer of a rule is read.', subject)
    kinds.forEach((k) => {
      if (k !== 'PointSymbolizer' && k !== 'TextSymbolizer')
        add('warning', `A ${k} on a point rule is not read.`, subject)
    })
    const icon = readGraphic(graphic, unitReader(s, add, subject), add, subject)
    return {
      kind: 'point',
      label,
      icon: icon.icon,
      size: icon.size,
      color: icon.color,
      ...(icon.secondary ? { secondary: icon.secondary } : {}),
      ...(icon.halo ? { halo: icon.halo } : {}),
    }
  }
  add('error', `A ${first} is not read.`, subject)
  return null
}

const KNOWN_RULE_CHILDREN = new Set([
  'Name',
  'Title',
  'Abstract',
  'Description',
  'LegendGraphic',
  'Filter',
  'ElseFilter',
  'MinScaleDenominator',
  'MaxScaleDenominator',
  'PointSymbolizer',
  'LineSymbolizer',
  'PolygonSymbolizer',
  'TextSymbolizer',
  'RasterSymbolizer',
])

/** One NamedLayer or UserLayer as a styled layer. */
function readLayer(element: XmlElement, ids: Set<string>, add: Diagnose): StyledLayer | null {
  const layerName = textOf(child(element, 'Name')) || 'layer'
  const styles = childElements(element, 'UserStyle')
  if (!styles.length) {
    add('error', `${layerName} has no UserStyle (a NamedStyle lives on its server); it is not read.`, layerName)
    return null
  }
  if (styles.length > 1) add('warning', `${layerName} has ${styles.length} styles; only the first is read.`, layerName)
  const style = styles[0]
  const title = textOf(child(child(style, 'Description') ?? style, 'Title')) || textOf(child(style, 'Title'))
  const name = title || textOf(child(style, 'Name')) || layerName
  const read: { rule: StyleRule; cond: Cond | null }[] = []
  let label: LabelStyle | undefined
  const featureStyles = [...childElements(style, 'FeatureTypeStyle'), ...childElements(style, 'CoverageStyle')]
  for (const featureStyle of featureStyles) {
    if (localName(featureStyle) === 'CoverageStyle') {
      add('error', 'A coverage (raster) style is not read.', name)
      continue
    }
    const earlier: Cond[] = []
    for (const [index, rule] of childElements(featureStyle, 'Rule').entries()) {
      const ruleName =
        textOf(child(child(rule, 'Description') ?? rule, 'Title')) ||
        textOf(child(rule, 'Title')) ||
        textOf(child(rule, 'Name')) ||
        `Rule ${index + 1}`
      const subject = `${name}: ${ruleName}`
      for (const k of childElements(rule))
        if (!KNOWN_RULE_CHILDREN.has(localName(k))) add('warning', `Rule content ${localName(k)} is not read.`, subject)
      if (child(rule, 'MinScaleDenominator') || child(rule, 'MaxScaleDenominator'))
        add('warning', 'The rule draws only at some scales; PGMaps draws it at every scale.', subject)
      const symbolizers = childElements(rule).filter((k) => localName(k).endsWith('Symbolizer'))
      const texts = symbolizers.filter((s) => localName(s) === 'TextSymbolizer')
      const filterElement = child(rule, 'Filter')
      let cond: Cond | null = null
      try {
        const kids = filterElement ? childElements(filterElement) : []
        if (filterElement && kids.length !== 1) throw Error('The filter must hold one condition.')
        cond = kids.length ? readCond(kids[0]) : null
      } catch (error) {
        add(
          'error',
          `${error instanceof Error ? error.message : 'The filter is not read.'} The rule is not read.`,
          subject,
        )
        continue
      }
      const own = cond ? ownCondition(cond, earlier) : null
      if (cond) earlier.push(own!)
      if (texts.length) {
        if (label) add('warning', 'Only the first label of the layer is read.', subject)
        else {
          const found = readLabel(texts[0], add, subject)
          if (found) label = found
          if (cond || child(rule, 'ElseFilter'))
            add('warning', 'The label shows only on some features in the source; PGMaps labels every feature.', subject)
        }
      }
      const symbol = readSymbol(
        symbolizers.filter((s) => localName(s) !== 'TextSymbolizer'),
        ruleName,
        add,
        subject,
      )
      if (!symbol) {
        if (!texts.length) add('warning', 'The rule draws nothing PGMaps reads; it is not read.', subject)
        continue
      }
      if (cond && child(rule, 'ElseFilter'))
        add('warning', 'The rule has both a filter and an else filter; the filter is used.', subject)
      read.push({ rule: { label: ruleName, filter: null, symbol }, cond: own })
    }
  }
  // Fields compared as ranges are numbers; type the literals, then put the else rule last.
  const untyped: (Untyped | null)[] = []
  const kept: StyleRule[] = []
  for (const { rule, cond } of read) {
    const subject = `${name}: ${rule.label}`
    try {
      untyped.push(cond ? untypedFilter(cond, add, subject) : null)
      kept.push(rule)
    } catch (error) {
      add(
        'error',
        `${error instanceof Error ? error.message : 'The filter is not read.'} The rule is not read.`,
        subject,
      )
    }
  }
  const numeric = new Set(untyped.flatMap((f) => (f?.op === 'range' ? [f.field] : [])))
  const rules: StyleRule[] = []
  kept.forEach((rule, i) => {
    const subject = `${name}: ${rule.label}`
    try {
      const f = untyped[i]
      rules.push({ ...rule, filter: f ? typedFilter(f, numeric, add, subject) : null })
    } catch (error) {
      add(
        'error',
        `${error instanceof Error ? error.message : 'The filter is not read.'} The rule is not read.`,
        subject,
      )
    }
  })
  if (!rules.length) {
    if (!label) add('error', `${name} has no rule PGMaps can read.`, name)
    if (!label) return null
  }
  const geometry = rules.length ? geometryOfSymbol(rules[0].symbol) : label?.placement === 'line' ? 'line' : 'point'
  const matching = rules.filter((rule) => {
    if (geometryOfSymbol(rule.symbol) === geometry) return true
    add('error', `A ${rule.symbol.kind} symbol on a ${geometry} layer is not read.`, `${name}: ${rule.label}`)
    return false
  })
  const ordered = sortedRules(matching, add, name)
  // A filter equal to an earlier one never draws under first-match.
  for (let i = 1; i < ordered.length; i++)
    if (ordered[i].filter && ordered.slice(0, i).some((r) => sameFilter(r.filter, ordered[i].filter)))
      add(
        'warning',
        `"${ordered[i].label}" has the same filter as a rule above it; the source draws both, PGMaps only the first.`,
        name,
      )
  warnOverlaps(ordered, add, name)
  if (!ordered.length) {
    add('error', `${name} has a label but no symbol PGMaps can read.`, name)
    return null
  }
  return {
    id: safeLayerId(layerName, ids),
    name,
    geometry,
    fields: fieldsFromRules(ordered, label?.field),
    rules: ordered,
    ...(label ? { label } : {}),
  }
}

/** Reads an SLD 1.0 or 1.1 document, conservatively; every loss is a diagnostic. */
export function readSld(xml: string): ReadResult {
  const { list, add } = diagnostics('sld')
  const result: ReadResult = { format: 'sld', layers: [], symbols: [], layouts: [], diagnostics: list }
  let root: XmlElement
  try {
    root = parseXml(xml)
  } catch (error) {
    add('error', error instanceof Error ? error.message : 'The SLD is not well-formed XML.')
    return result
  }
  if (localName(root) !== 'StyledLayerDescriptor') {
    add('error', `The root element is ${localName(root)}, not StyledLayerDescriptor.`)
    return result
  }
  const version = attr(root, 'version')
  if (version !== '1.0.0' && version !== '1.1.0') add('warning', `SLD version ${version ?? '(none)'} is read as 1.1.0.`)
  if (root.getElementsByTagName('*').length > MAX_SLD_ELEMENTS) {
    add('error', `The SLD has more than ${MAX_SLD_ELEMENTS} elements.`)
    return result
  }
  const trusted = trustedMetadata(xml, root, add)
  if (trusted) {
    result.layers.push(trusted)
    return result
  }
  const ids = new Set<string>()
  for (const layer of childElements(root).filter((e) => ['NamedLayer', 'UserLayer'].includes(localName(e)))) {
    const read = readLayer(layer, ids, add)
    if (read) result.layers.push(read)
  }
  if (!result.layers.length && !list.some((d) => d.severity === 'error')) add('error', 'The SLD has no layer style.')
  return result
}
