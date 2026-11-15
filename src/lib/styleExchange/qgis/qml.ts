/**
 * QGIS layer styles (`.qml`): one file per layer, named after the layer's data file, so QGIS loads
 * `road_centrelines.qml` by itself when `road_centrelines.shp` is opened. A single filterless rule
 * becomes a `singleSymbol` renderer, equality tests on one field a `categorizedSymbol` renderer, and
 * anything else a `RuleRenderer` whose filters are mutually exclusive (QGIS draws every rule a
 * feature matches; PGMaps draws the first). Labels become QGIS simple labeling. The XML is the
 * `<Option type="Map">` form QGIS 3.28 and later, 4.x included, read. No DOM or network access.
 */
import type { LabelStyle, StyledLayer, StyleDocument, WriteResult, ExchangeDiagnostic } from '../model'
import { el, textEl, writeXml, type XmlNodeSpec } from '../xml'
import { exclusiveExpressions } from './expression'
import { QGIS_WRITER_VERSION, qgisColor } from './qgisXml'
import { qgisSymbolXml } from './symbolXml'

export { qgisSymbolXml } from './symbolXml'

export const QML_DOCTYPE = "<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>"

const GEOMETRY_TYPE = { point: 0, line: 1, polygon: 2 } as const

/** Which renderer a layer's rules need. */
export function rendererKind(layer: StyledLayer): 'singleSymbol' | 'categorizedSymbol' | 'RuleRenderer' {
  const filtered = layer.rules.filter((rule) => rule.filter)
  if (!filtered.length) return 'singleSymbol'
  const field = filtered[0].filter!.field
  const values = filtered.map((rule) => (rule.filter!.op === 'eq' ? rule.filter!.value : undefined))
  const categorized =
    filtered.every((rule) => rule.filter!.op === 'eq' && rule.filter!.field === field) &&
    new Set(values.map((value) => `${typeof value}:${String(value)}`)).size === values.length &&
    // An empty string would read as QGIS's "all other values" category.
    !values.some((value) => value === '')
  return categorized ? 'categorizedSymbol' : 'RuleRenderer'
}

const categoryType = (value: unknown) =>
  typeof value === 'number'
    ? Number.isInteger(value)
      ? 'int'
      : 'double'
    : typeof value === 'boolean'
      ? 'bool'
      : 'string'

/** The layer's `<renderer-v2>` element. */
export function rendererXml(layer: StyledLayer): XmlNodeSpec {
  const kind = rendererKind(layer)
  const symbols = el('symbols', undefined, ...layer.rules.map((rule, i) => qgisSymbolXml(rule.symbol, String(i))))
  const common = { symbollevels: 0, enableorderby: 0, forceraster: 0, referencescale: -1 }
  if (kind === 'singleSymbol')
    return el('renderer-v2', { type: 'singleSymbol', ...common }, symbols, el('rotation'), el('sizescale'))
  if (kind === 'categorizedSymbol') {
    const field = layer.rules.find((rule) => rule.filter)!.filter!.field
    const categories = layer.rules.map((rule, i) => {
      const filter = rule.filter
      // QGIS 3.28+ and 4.x read an empty untyped value as "all other values".
      if (!filter) return el('category', { value: '', symbol: i, label: rule.label, render: 'true' })
      const value = filter.op === 'eq' ? filter.value : ''
      return el('category', {
        value: typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value),
        type: categoryType(value),
        symbol: i,
        label: rule.label,
        render: 'true',
      })
    })
    return el(
      'renderer-v2',
      { type: 'categorizedSymbol', attr: field, ...common },
      el('categories', undefined, ...categories),
      symbols,
      el('rotation'),
      el('sizescale'),
    )
  }
  const expressions = exclusiveExpressions(layer.rules)
  const rules = layer.rules.map((rule, i) =>
    el('rule', { key: `{pgmaps-rule-${i}}`, filter: expressions[i], symbol: i, label: rule.label }),
  )
  return el(
    'renderer-v2',
    { type: 'RuleRenderer', ...common },
    el('rules', { key: '{pgmaps-root}' }, ...rules),
    symbols,
  )
}

/** QGIS label placements: 3 is curved along the line, 6 the cartographic positions round a point. */
export const LINE_LABEL_PLACEMENT = 3
export const POINT_LABEL_PLACEMENT = 6

/** The layer's `<labeling type="simple">` element. */
export function labelingXml(label: LabelStyle): XmlNodeSpec {
  const line = label.placement === 'line'
  return el(
    'labeling',
    { type: 'simple' },
    el(
      'settings',
      { calloutType: 'simple' },
      el(
        'text-style',
        {
          fieldName: label.field,
          isExpression: 0,
          fontFamily: 'Arial',
          fontSize: label.size,
          fontSizeUnit: 'Point',
          fontWeight: label.bold ? 700 : 400,
          fontItalic: 0,
          textColor: qgisColor(label.color),
          textOpacity: 1,
          multilineHeight: 1,
          blendMode: 0,
          capitalization: 0,
          allowHtml: 0,
        },
        el('text-buffer', {
          bufferDraw: label.halo ? 1 : 0,
          bufferSize: label.halo?.width ?? 0.75,
          bufferSizeUnits: 'Point',
          bufferColor: qgisColor(label.halo?.color ?? '#ffffff'),
          bufferOpacity: 1,
          bufferNoFill: 1,
          bufferJoinStyle: 128,
          bufferBlendMode: 0,
        }),
      ),
      el('text-format', {
        wrapChar: '',
        multilineAlign: 3,
        autoWrapLength: 0,
        formatNumbers: 0,
        decimals: 3,
        plussign: 0,
      }),
      el('placement', {
        placement: line ? LINE_LABEL_PLACEMENT : POINT_LABEL_PLACEMENT,
        // On the line, oriented to the map; points sit 1.5 pt off their symbol.
        placementFlags: line ? 9 : 10,
        dist: line ? 0 : 1.5,
        distUnits: 'Point',
        offsetType: 0,
        priority: 5,
        repeatDistance: 0,
        maxCurvedCharAngleIn: 25,
        maxCurvedCharAngleOut: -25,
        overlapHandling: 'PreventOverlap',
      }),
      el('rendering', {
        drawLabels: 1,
        obstacle: 1,
        obstacleFactor: 1,
        scaleVisibility: 0,
        upsidedownLabels: 0,
        mergeLines: 0,
        limitNumLabels: 0,
        fontLimitPixelSize: 0,
      }),
    ),
  )
}

/** The style parts a layer element carries, shared by `.qml` files and `.qgs` map layers. */
export function layerStyleNodes(layer: StyledLayer): XmlNodeSpec[] {
  return [
    rendererXml(layer),
    ...(layer.label ? [labelingXml(layer.label)] : []),
    textEl('blendMode', 0),
    textEl('layerOpacity', 1),
  ]
}

/** One layer's style as a `.qml` document. */
export function qmlForLayer(layer: StyledLayer): { qml: string; diagnostics: ExchangeDiagnostic[] } {
  const diagnostics: ExchangeDiagnostic[] = []
  if (layer.hidden)
    diagnostics.push({
      severity: 'info',
      format: 'qml',
      subject: layer.name,
      message: 'A layer style cannot hide its layer; the project file opens it switched off.',
    })
  const root = el(
    'qgis',
    {
      version: QGIS_WRITER_VERSION,
      styleCategories: 'Symbology|Labeling',
      labelsEnabled: layer.label ? 1 : 0,
      hasScaleBasedVisibilityFlag: 0,
      minScale: 100000000,
      maxScale: 0,
    },
    ...layerStyleNodes(layer),
    textEl('layerGeometryType', GEOMETRY_TYPE[layer.geometry]),
  )
  return { qml: `${QML_DOCTYPE}\n${writeXml(root)}\n`, diagnostics }
}

/** A `.qml` for every layer, named `<layer id>.qml` to sit beside `<layer id>.shp`. */
export function qgisLayerStyles(doc: StyleDocument): WriteResult {
  const diagnostics: ExchangeDiagnostic[] = []
  const files = doc.layers.map((layer) => {
    const written = qmlForLayer(layer)
    diagnostics.push(...written.diagnostics)
    return { path: `${layer.id}.qml`, content: written.qml, mime: 'application/xml' }
  })
  return { files, diagnostics }
}
