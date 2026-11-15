/**
 * GeoLibre (geolibre.app, MIT) files: a `.geolibre` project with the layers' GeoJSON inline and a
 * rule-based style per layer, a `<layer id>.geolibre.style.json` per layer (GeoLibre's "URL style":
 * a compact MapLibre style with no data whose render layers' `source` is the data file's stem, as
 * GeoLibre's own Export GeoLibre URL style writes it), a Style Manager bundle
 * (`geolibre-style-library`) for a symbol library, and a reader for all of these and GeoLibre's
 * layer styles file.
 *
 * GeoLibre styles a layer with one flat symbol: rules (first match wins, the else rule last) set
 * only a colour, an outline colour and width, a fill opacity and a circle radius each, and the
 * dash, the fill pattern, the point marker and the line decoration belong to the whole layer. So
 * a line keeps its main stroke (the widest that is not white) and loses casings, centre dashes and
 * offsets; a hatch or marker fill becomes an SVG fill pattern (an exact tile, with the fill baked
 * in) only when every rule of the layer draws the same one; icons become a custom SVG marker only
 * when every rule draws the same icon, else coloured circles. Every loss is a diagnostic.
 * Widths are CSS pixels (96 dpi, 4/3 px per point), as MapLibre draws them. No DOM or network
 * access.
 */
import { parseColor, toHex, toHexAlpha } from '../color'
import { base64Utf8, iconFromSvg, iconSvg, utf8FromBase64 } from '../iconGeometry'
import {
  safeFileStem,
  STYLE_EXCHANGE_SCHEMA,
  type LayoutDocument,
  type LibrarySymbol,
  type ReadResult,
  type StyleDocument,
  type StyledLayer,
  type StyleRule,
  type SymbolLibrary,
  type WriteResult,
  type GeometryKind,
} from '../model'
import { paperSize, PAPER_SIZES } from '@/lib/mapSheet/layout'
import { sheetSvg } from '@/lib/mapSheet/renderSvg'
import { PX_PER_PT, tileSide } from '@/lib/mapSheet/symbolRaster'
import {
  symbolKeyColor,
  type AreaSymbol,
  type LineSymbol,
  type PointSymbol,
  type SheetSymbol,
} from '@/lib/mapSheet/symbols'
import type { DrawOp } from '@/lib/mapSheet/drawOps'
import { checkedSheetSymbol } from '../checkedSymbol'
import {
  diagnostics,
  fieldKindsFromData,
  fieldsFromRules,
  geometryOfData,
  round,
  safeLayerId,
  type Diagnose,
} from './common'
import { filterExpression, readFilter, readMaplibreStyle } from './maplibre'
import { iconFromOurSvg, markerFillTile } from './sld'

/** The project format version GeoLibre writes. */
export const GEOLIBRE_PROJECT_VERSION = '0.2.0'
const GEOLIBRE_BASEMAP = 'https://tiles.openfreemap.org/styles/liberty'
const GEOLIBRE_GLYPHS = 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf'
/** GeoLibre's own label font stack, as its URL style export writes it. */
const GEOLIBRE_TEXT_FONT = ['Open Sans Regular', 'Arial Unicode MS Regular']
const FILL_PATTERN_METADATA = 'geolibre:fill-pattern'
/** Where PGMaps keeps its own copy of a pattern inside the SVG tile it writes. */
const PATTERN_ATTRIBUTE = 'data-pgmaps-pattern'

type Json = Record<string, unknown>
/** The subset of GeoLibre's `LayerStyle` PGMaps writes; GeoLibre fills every other key with its default. */
export type GeolibreStyle = Json
export interface GeolibreRule {
  id: string
  label: string
  filter: string
  color: string
  isElse: boolean
  enabled?: boolean
  strokeColor?: string
  strokeWidth?: number
  fillOpacity?: number
  circleRadius?: number
}

const px = (pt: number) => round(pt * PX_PER_PT, 3)
const pt = (pixels: number) => round(pixels / PX_PER_PT, 3)
/** GeoLibre colours are 6-digit hex; alpha goes to an opacity. */
const hex6 = (color: string) => toHex(parseColor(color) ?? { r: 0, g: 0, b: 0, a: 1 })
const alphaOf = (color: string) => parseColor(color)?.a ?? 1

/* ------------------------------------------------------------------------------------------ */
/* Pattern tiles                                                                               */
/* ------------------------------------------------------------------------------------------ */

/** The SVG drawn in points but sized in CSS pixels, so GeoLibre rasterizes it at the map's scale. */
const inPixels = (svg: string, width: number, height: number) =>
  svg.replace(/(<svg[^>]*?) width="[^"]*" height="[^"]*"/, `$1 width="${px(width)}" height="${px(height)}"`)

/** An area's fill, hatches and marker fill as one repeating SVG tile, carrying its own description. */
export function patternTileSvg(symbol: AreaSymbol): string | null {
  if (!symbol.hatches?.length && !symbol.markerFill) return null
  const description = base64Utf8(
    JSON.stringify({
      fill: symbol.fill,
      fillOpacity: symbol.fillOpacity,
      hatches: symbol.hatches,
      markerFill: symbol.markerFill,
    }),
  )
  if (!symbol.hatches?.length && symbol.markerFill) {
    const tile = markerFillTile(symbol.markerFill)
    const body = symbol.fill
      ? tile.svg.replace(
          /(<svg[^>]*>)/,
          `$1<rect width="${tile.width}" height="${tile.height}" fill="${symbol.fill}" fill-opacity="${symbol.fillOpacity ?? 1}"/>`,
        )
      : tile.svg
    return inPixels(body.replace('<svg ', `<svg ${PATTERN_ATTRIBUTE}="${description}" `), tile.width, tile.height)
  }
  // Hatch lines repeat every spacing / |sin θ| across and spacing / |cos θ| down; the tile holds a
  // whole number of each, found at 0.1 pt as the map's raster tiles are found at a pixel.
  const STEP = 10
  const periods = (trig: (a: number) => number) =>
    (symbol.hatches ?? []).flatMap((h) => {
      const t = Math.abs(trig((h.angleDeg * Math.PI) / 180))
      return t > 1e-6 ? [(h.spacing * STEP) / t] : []
    })
  const fallback = Math.max(...(symbol.hatches ?? []).map((h) => h.spacing * STEP))
  const width = tileSide(periods(Math.sin), fallback) / STEP
  const height = tileSide(periods(Math.cos), fallback) / STEP
  const ops: DrawOp[] = []
  if (symbol.fill)
    ops.push({ op: 'rect', x: 0, y: 0, w: width, h: height, fill: symbol.fill, fillOpacity: symbol.fillOpacity })
  for (const hatch of symbol.hatches ?? []) {
    const theta = (hatch.angleDeg * Math.PI) / 180
    const a = Math.round((width * Math.sin(theta)) / hatch.spacing)
    const b = Math.round((height * Math.cos(theta)) / hatch.spacing)
    if (!a && !b) continue
    // Lines x·a/w + y·b/h = k + phase share, drawn across a 3 × 3 tile block and clipped by the viewport.
    const shift = ((hatch.phase ?? 0) / hatch.spacing) % 1
    const parts: [number, number][][] = []
    for (let k = -Math.abs(a) - Math.abs(b) - 2; k <= 2 * (Math.abs(a) + Math.abs(b)) + 2; k++) {
      const c = k + shift
      if (b !== 0)
        parts.push([
          [-width, ((c - (a * -width) / width) * height) / b],
          [2 * width, ((c - (a * 2 * width) / width) * height) / b],
        ])
      else
        parts.push([
          [(c * width) / a, -height],
          [(c * width) / a, 2 * height],
        ])
    }
    ops.push({ op: 'path', parts, closed: false, stroke: { ...hatch.stroke, dash: undefined } })
  }
  return inPixels(
    sheetSvg(ops, width, height, undefined, null).replace('<svg ', `<svg ${PATTERN_ATTRIBUTE}="${description}" `),
    width,
    height,
  )
}

/** The fill, hatches and marker fill a pattern tile PGMaps wrote describes, or null for any other SVG. */
export function patternFromSvg(
  svg: string,
): Pick<AreaSymbol, 'fill' | 'fillOpacity' | 'hatches' | 'markerFill'> | null {
  const match = new RegExp(`${PATTERN_ATTRIBUTE}="([A-Za-z0-9+/=]+)"`).exec(svg)
  if (!match) return null
  try {
    const raw = JSON.parse(utf8FromBase64(match[1])) as Json
    const probe = checkedSheetSymbol({ kind: 'area', label: 'pattern', outline: [], ...raw }) as AreaSymbol
    return {
      ...(probe.fill ? { fill: probe.fill } : {}),
      ...(probe.fillOpacity !== undefined ? { fillOpacity: probe.fillOpacity } : {}),
      ...(probe.hatches ? { hatches: probe.hatches } : {}),
      ...(probe.markerFill ? { markerFill: probe.markerFill } : {}),
    }
  } catch {
    return null
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Symbols to GeoLibre's flat style                                                            */
/* ------------------------------------------------------------------------------------------ */

/** The stroke that stands for a line: the widest that is not white (casings and centre dashes go). */
function mainStroke(symbol: LineSymbol) {
  const key = symbolKeyColor(symbol)
  return (
    symbol.layers.find(
      (l) =>
        l.color === key && l.width === Math.max(...symbol.layers.filter((x) => x.color === key).map((x) => x.width)),
    ) ?? symbol.layers[0]
  )
}

/** What one symbol sets in GeoLibre: per-rule values and the layer-wide values it would need. */
interface Flat {
  rule: Omit<GeolibreRule, 'id' | 'label' | 'filter' | 'isElse'>
  layer: Json
  losses: string[]
}

const DECORATIONS: Partial<Record<string, string>> = { dot: 'circle', tower: 'square', diamond: 'square' }
/** GeoLibre marker shapes with a PGMaps icon close enough to stand for them. */
const SHAPE_ICONS: Partial<Record<string, PointSymbol['icon']>> = { circle: 'dot', cross: 'cross', diamond: 'diamond' }

function flatSymbol(symbol: SheetSymbol, geometry: GeometryKind): Flat {
  const losses: string[] = []
  if (symbol.kind === 'class') {
    const opacity = symbol.opacity * alphaOf(symbol.color)
    return geometry === 'polygon'
      ? { rule: { color: hex6(symbol.color), fillOpacity: opacity, strokeWidth: 0 }, layer: {}, losses }
      : {
          rule: { color: hex6(symbol.color), strokeWidth: 1.333, fillOpacity: opacity, circleRadius: 3 },
          layer: {},
          losses,
        }
  }
  if (symbol.kind === 'line') {
    const main = mainStroke(symbol)
    const others = symbol.layers.length - (main ? 1 : 0)
    if (others > 0)
      losses.push(
        `${others} more stroke${others > 1 ? 's' : ''} (casing or centre line) not carried; GeoLibre draws one stroke.`,
      )
    if (symbol.layers.some((l) => l.offset)) losses.push('Line offsets are not carried.')
    if (main?.cap && main.cap !== 'butt') losses.push('Round or square line ends are not carried.')
    const marker = symbol.markers?.[0]
    const decoration = marker ? DECORATIONS[marker.icon] : undefined
    if (marker && !decoration)
      losses.push(`Markers along the line (${marker.icon}) have no GeoLibre line decoration; they are left out.`)
    if ((symbol.markers?.length ?? 0) > 1) losses.push('Only the first row of markers along the line is considered.')
    if (!main && !marker) losses.push('The line draws nothing GeoLibre carries.')
    const color = main?.color ?? marker?.color ?? '#000000'
    return {
      rule: { color: hex6(color), strokeWidth: main ? px(main.width) : 0 },
      layer: {
        strokeDash: main?.dash ? main.dash.map((d) => round(d / main.width, 3)) : [],
        strokeOpacity: round((main?.opacity ?? 1) * alphaOf(color), 3),
        lineDecoration: decoration ?? 'none',
        ...(decoration && marker
          ? {
              lineDecorationColor: hex6(marker.color),
              lineDecorationSize: px(marker.size),
              lineDecorationSpacing: px(marker.spacing),
            }
          : {}),
      },
      losses,
    }
  }
  if (symbol.kind === 'area') {
    const outline = [...symbol.outline].reverse().find((o) => !o.inside) ?? symbol.outline.at(-1)
    if (symbol.outline.length > 1)
      losses.push(`${symbol.outline.length - 1} more outline stroke(s) not carried; GeoLibre draws one.`)
    if (symbol.outline.some((o) => o.inside)) losses.push('An inside casing is not carried.')
    if (outline?.dash)
      losses.push('A dashed outline is drawn solid (the dash belongs to the whole layer and to its lines).')
    const pattern = patternTileSvg(symbol)
    const color = symbol.fill ?? symbolKeyColor(symbol)
    return {
      rule: {
        color: hex6(color),
        fillOpacity: pattern ? 1 : symbol.fill ? round((symbol.fillOpacity ?? 1) * alphaOf(symbol.fill), 3) : 0,
        strokeColor: hex6(outline?.color ?? color),
        strokeWidth: outline ? px(outline.width) : 0,
      },
      layer: pattern
        ? { fillPattern: 'svg', fillPatternSvg: pattern, fillPatternColor: hex6(symbolKeyColor(symbol)) }
        : { fillPattern: 'none' },
      losses,
    }
  }
  const point = symbol as PointSymbol
  const { svg, side } = iconSvg(
    point.icon,
    point.size,
    { primary: point.color, secondary: point.secondary },
    point.halo,
  )
  return {
    rule: { color: hex6(point.color), circleRadius: px((point.size * 0.9) / 2), strokeWidth: 0 },
    layer: {
      markerEnabled: true,
      markerShape: 'custom',
      markerSvg: svg,
      markerColor: hex6(point.color),
      markerSize: px(side),
    },
    losses,
  }
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** GeoLibre's label settings (its `LabelStyle`) that PGMaps does not set, at GeoLibre's defaults. */
const LABEL_DEFAULTS = {
  expression: '',
  minZoom: 0,
  maxZoom: 24,
  allowOverlap: false,
  anchor: 'center',
  offsetX: 0,
  offsetY: 0,
  rotation: 0,
  maxWidth: 10,
  transform: 'none',
  numberFormatEnabled: false,
  numberDecimals: 0,
  numberLocale: '',
  dedupe: 'off',
  sizeExpression: '',
  colorExpression: '',
  opacityExpression: '',
  visibilityExpression: '',
  priorityExpression: '',
}

/** A layer's GeoLibre style subset and rules, with every loss reported. */
export function geolibreStyle(layer: StyledLayer, add: Diagnose): GeolibreStyle {
  const flats = layer.rules.map((rule) => flatSymbol(rule.symbol, layer.geometry))
  layer.rules.forEach((rule, i) =>
    flats[i].losses.forEach((loss) => add('warning', loss, `${layer.name}: ${rule.label}`)),
  )
  // Layer-wide values: kept when every rule asks for the same, else the plain default and a warning.
  const layerKeys = [...new Set(flats.flatMap((f) => Object.keys(f.layer)))]
  const shared: Json = {}
  const groups: Record<string, string[]> = {
    pattern: ['fillPattern', 'fillPatternSvg', 'fillPatternColor'],
    marker: ['markerEnabled', 'markerShape', 'markerSvg', 'markerColor', 'markerSize'],
    decoration: ['lineDecoration', 'lineDecorationColor', 'lineDecorationSize', 'lineDecorationSpacing'],
    dash: ['strokeDash'],
    opacity: ['strokeOpacity'],
  }
  const what: Record<string, string> = {
    pattern: 'fill pattern',
    marker: 'point icon',
    decoration: 'markers along the line',
    dash: 'dash pattern',
    opacity: 'stroke opacity',
  }
  for (const [group, keys] of Object.entries(groups)) {
    if (!keys.some((k) => layerKeys.includes(k))) continue
    const values = flats.map((f) => keys.map((k) => f.layer[k]))
    if (values.every((v) => sameJson(v, values[0]))) {
      keys.forEach((k, i) => values[0][i] !== undefined && (shared[k] = values[0][i]))
      continue
    }
    add(
      'warning',
      `The rules draw different ${what[group]}s; GeoLibre has one per layer, so ${group === 'marker' ? 'points are drawn as coloured circles' : group === 'pattern' ? 'it is left out and hatched or marker-filled rules draw their key colour at half opacity' : `the ${what[group]} is left out`}.`,
      layer.name,
    )
    if (group === 'marker') shared.markerEnabled = false
    if (group === 'pattern') shared.fillPattern = 'none'
    if (group === 'decoration') shared.lineDecoration = 'none'
  }
  // Without the shared pattern, rules that relied on it draw their key colour flat.
  const patterned = shared.fillPattern === 'svg'
  const rules: GeolibreRule[] = layer.rules.map((rule, i) => {
    const flat = flats[i].rule
    return {
      id: `${layer.id}-${i + 1}`,
      label: rule.label,
      filter: rule.filter ? JSON.stringify(filterExpression(rule.filter)) : '',
      isElse: !rule.filter,
      ...flat,
      ...(!patterned && rule.symbol.kind === 'area' && !rule.symbol.fill && patternTileSvg(rule.symbol)
        ? { fillOpacity: 0.5 }
        : {}),
    }
  })
  if (!rules.some((r) => r.isElse))
    // Features no rule matches are not drawn in PGMaps: a switched-off else rule hides them in GeoLibre.
    rules.push({ id: `${layer.id}-else`, label: 'Other', filter: '', color: '#000000', isElse: true, enabled: false })
  const single = layer.rules.length === 1 && !layer.rules[0].filter
  const first = rules[0]
  const label = layer.label
  return {
    vectorStyleMode: single ? 'single' : 'rule-based',
    vectorRules: single ? [] : rules,
    fillColor: first.color,
    strokeColor: first.strokeColor ?? first.color,
    strokeWidth: first.strokeWidth ?? 1,
    strokeWidthUnit: 'pixels',
    fillOpacity: first.fillOpacity ?? (layer.geometry === 'point' ? 1 : 0),
    circleRadius: first.circleRadius ?? 4,
    ...(layer.geometry === 'point' ? { markerEnabled: false } : {}),
    ...shared,
    ...(label
      ? {
          // Complete: GeoLibre does not fill a partial label block, and its renderer reads every key.
          labels: {
            ...LABEL_DEFAULTS,
            enabled: true,
            field: label.field,
            placement: label.placement,
            size: px(label.size),
            color: hex6(label.color),
            haloColor: hex6(label.halo?.color ?? '#ffffff'),
            haloWidth: label.halo ? px(label.halo.width) : 0,
            ...(label.placement === 'point' ? { anchor: 'left', offsetX: 1 } : {}),
          },
        }
      : {}),
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Writing                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const GEOLIBRE_PAPER: Record<string, string> = { tabloid: 'tabloid', letter: 'letter', a3: 'a3', a4: 'a4' }

/** GeoLibre's print layout from ours: page, title, extent and the map furniture; panels do not carry. */
function printLayout(layout: LayoutDocument, add: Diagnose): Json {
  const orientation = layout.template.orientation
  const custom = !GEOLIBRE_PAPER[layout.paper]
  if (custom) add('info', `${PAPER_SIZES[layout.paper].label} is written as a custom page size.`, layout.name)
  const size = paperSize(layout.paper, orientation)
  add(
    'warning',
    "GeoLibre lays out its own title, legend, scale bar and north arrow; the sheet template's panels are not carried.",
    layout.name,
  )
  return {
    title: layout.title,
    subtitle: layout.subtitle ?? '',
    showSubtitle: !!layout.subtitle,
    paperSize: custom ? 'custom' : GEOLIBRE_PAPER[layout.paper],
    orientation,
    ...(custom
      ? {
          customWidth: round((size.width / 72) * 25.4, 1),
          customHeight: round((size.height / 72) * 25.4, 1),
          customUnit: 'mm',
        }
      : {}),
    showLegend: true,
    showScaleBar: true,
    showNorthArrow: true,
    ...(layout.extent ? { captureMode: 'extent', extentBbox: layout.extent } : {}),
  }
}

function mapView(extent: [number, number, number, number] | undefined) {
  if (!extent) return { center: [-122.75, 53.92], zoom: 10, bearing: 0, pitch: 0 }
  const [west, south, east, north] = extent
  const lat = (south + north) / 2
  const span = Math.max(east - west, (north - south) / Math.cos((lat * Math.PI) / 180), 1e-9)
  return {
    center: [round((west + east) / 2, 6), round(lat, 6)],
    zoom: round(Math.log2((360 * 600) / 512 / span), 2),
    bearing: 0,
    pitch: 0,
    bbox: extent,
  }
}

/** A `.geolibre` project: the layers with their GeoJSON inline, rule-based styles and the print layout. */
export function geolibreProject(
  doc: StyleDocument,
  data: Record<string, GeoJSON.FeatureCollection>,
  options: { layout?: LayoutDocument } = {},
): WriteResult {
  const { list, add } = diagnostics('geolibre')
  const layers = doc.layers.map((layer) => {
    const geojson = data[layer.id]
    if (!geojson) add('warning', `No data was given for ${layer.name}; the layer is empty.`, layer.name)
    return {
      id: layer.id,
      name: layer.name,
      type: 'geojson',
      source: { type: 'geojson' },
      visible: !layer.hidden,
      opacity: 1,
      style: geolibreStyle(layer, add),
      metadata: {},
      geojson: geojson ?? { type: 'FeatureCollection', features: [] },
    }
  })
  const project = {
    version: GEOLIBRE_PROJECT_VERSION,
    name: doc.name,
    mapView: mapView(doc.extent),
    basemapStyleUrl: GEOLIBRE_BASEMAP,
    basemapVisible: true,
    basemapOpacity: 1,
    layers,
    styles: {},
    preferences: {},
    ...(options.layout ? { printLayout: printLayout(options.layout, add) } : {}),
    metadata: { [STYLE_EXCHANGE_SCHEMA]: { document: doc.name } },
  }
  return {
    files: [
      {
        path: `${safeFileStem(doc.name)}.geolibre`,
        content: `${JSON.stringify(project, null, 2)}\n`,
        mime: 'application/json',
      },
    ],
    diagnostics: list,
  }
}

/** GeoLibre's style-layer id base: the layer name in lower case with dashes. */
const idBase = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'layer'

const POLYGON_TEST = ['match', ['geometry-type'], ['Polygon', 'MultiPolygon'], true, false]
const LINE_TEST = [
  'match',
  ['geometry-type'],
  ['LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'],
  true,
  false,
]
const POINT_TEST = ['match', ['geometry-type'], ['Point', 'MultiPoint'], true, false]

/** `["case", filter, value, …, else]` over the rules, or the plain value without rules, as GeoLibre builds it. */
function caseOf(rules: GeolibreRule[], pick: (rule: GeolibreRule) => unknown, fallback: unknown): unknown {
  const conditional = rules.filter((r) => !r.isElse)
  const otherwise = rules.find((r) => r.isElse)
  const elseValue = otherwise && otherwise.enabled !== false ? (pick(otherwise) ?? fallback) : fallback
  const values = conditional.map((r) => pick(r) ?? fallback)
  // GeoLibre builds a case only for a value some rule overrides.
  if (!conditional.length || rules.every((r) => pick(r) === undefined)) return elseValue
  return ['case', ...conditional.flatMap((r, i) => [JSON.parse(r.filter), values[i]]), elseValue]
}

/**
 * The GeoLibre URL style for one layer, as GeoLibre's own export builds it from the same style:
 * a fill, line or circle layer with `case` colours by rule and a label layer, sourced from the
 * data file stem with no features.
 */
export function geolibreUrlStyle(layer: StyledLayer, add: Diagnose): Json {
  const style = geolibreStyle(layer, add)
  const rules = (style.vectorRules as GeolibreRule[]).length
    ? (style.vectorRules as GeolibreRule[])
    : [
        {
          id: 'single',
          label: '',
          filter: '',
          isElse: true,
          color: style.fillColor as string,
          strokeColor: style.strokeColor as string,
          strokeWidth: style.strokeWidth as number,
          fillOpacity: style.fillOpacity as number,
          circleRadius: style.circleRadius as number,
        },
      ]
  const base = idBase(layer.name)
  const visibility = layer.hidden ? 'none' : 'visible'
  const hiddenElse = rules.some((r) => r.isElse && r.enabled === false)
  const shown = hiddenElse ? ['any', ...rules.filter((r) => !r.isElse).map((r) => JSON.parse(r.filter))] : null
  const filter = (test: unknown[]) => (shown ? ['all', test, shown] : test)
  const color = caseOf(rules, (r) => r.color, style.fillColor)
  const strokeColor = caseOf(rules, (r) => r.strokeColor, style.strokeColor)
  const strokeWidth = caseOf(rules, (r) => r.strokeWidth, style.strokeWidth)
  const fillOpacity = caseOf(rules, (r) => r.fillOpacity, style.fillOpacity)
  const dash = style.strokeDash as number[] | undefined
  const lineColor = ['case', ['==', ['geometry-type'], 'Polygon'], strokeColor, color]
  const layers: Json[] = []
  if (layer.geometry === 'polygon')
    layers.push({
      id: `${base}-fill`,
      type: 'fill',
      source: layer.id,
      filter: filter(POLYGON_TEST),
      // Times the layer opacity, and the polygon edge in the outline colour, as GeoLibre writes them.
      paint: { 'fill-color': color, 'fill-opacity': ['*', fillOpacity, 1], 'fill-outline-color': lineColor },
      layout: { visibility },
      metadata: {
        [FILL_PATTERN_METADATA]: {
          version: 1,
          fillPattern: style.fillPattern ?? 'none',
          fillPatternColor: style.fillPatternColor ?? '#1e40af',
          fillPatternSvg: style.fillPatternSvg ?? '',
        },
      },
    })
  if (layer.geometry !== 'point')
    layers.push({
      id: `${base}-line`,
      type: 'line',
      source: layer.id,
      filter: filter(LINE_TEST),
      paint: {
        'line-color': lineColor,
        'line-width': strokeWidth,
        'line-opacity': style.strokeOpacity ?? 1,
        ...(dash?.length ? { 'line-dasharray': dash } : {}),
      },
      layout: { visibility },
    })
  if (layer.geometry === 'point') {
    add(
      'warning',
      'A GeoLibre URL style draws points as circles; the icons are in the .geolibre project only.',
      layer.name,
    )
    layers.push({
      id: `${base}-circle`,
      type: 'circle',
      source: layer.id,
      filter: filter(POINT_TEST),
      paint: {
        'circle-color': color,
        'circle-radius': caseOf(rules, (r) => r.circleRadius, style.circleRadius),
        'circle-opacity': fillOpacity,
        'circle-stroke-color': strokeColor,
        'circle-stroke-width': strokeWidth,
        'circle-stroke-opacity': style.strokeOpacity ?? 1,
      },
      layout: { visibility },
    })
  }
  if (layer.geometry === 'line' && style.lineDecoration && style.lineDecoration !== 'none')
    add(
      'warning',
      'A GeoLibre URL style leaves out line decorations; they are in the .geolibre project only.',
      layer.name,
    )
  const labels = style.labels as Json | undefined
  if (labels)
    layers.push({
      id: `${base}-label`,
      type: 'symbol',
      source: layer.id,
      ...(shown ? { filter: shown } : {}),
      layout: {
        'text-field': ['to-string', ['coalesce', ['get', labels.field], '']],
        'text-font': GEOLIBRE_TEXT_FONT,
        'text-size': labels.size,
        'symbol-placement': labels.placement,
        'text-allow-overlap': false,
        'text-ignore-placement': false,
        'text-anchor': labels.anchor,
        'text-offset': [labels.offsetX, labels.offsetY],
        'text-rotate': 0,
        'text-max-width': 10,
        'text-transform': 'none',
        visibility,
      },
      paint: {
        'text-color': labels.color,
        'text-halo-color': labels.haloColor,
        'text-halo-width': labels.haloWidth,
        'text-opacity': 1,
      },
    })
  return {
    version: 8,
    name: `${layer.name} — GeoLibre URL style`,
    sources: { [layer.id]: { type: 'geojson', data: { type: 'FeatureCollection', features: [] } } },
    layers,
    ...(labels ? { glyphs: GEOLIBRE_GLYPHS } : {}),
  }
}

/** One `<layer id>.geolibre.style.json` per layer, for GeoLibre's `?data=…&style=…` and Styles > Import. */
export function geolibreLayerStyles(doc: StyleDocument): WriteResult {
  const { list, add } = diagnostics('geolibre')
  const files = doc.layers.map((layer) => ({
    path: `${layer.id}.geolibre.style.json`,
    content: `${JSON.stringify(geolibreUrlStyle(layer, add), null, 2)}\n`,
    mime: 'application/json',
  }))
  return { files, diagnostics: list }
}

/** GeoLibre's "symbol" Style Manager keys; everything else in a style is dropped on import. */
const SYMBOL_KEYS = [
  'fillColor',
  'strokeColor',
  'strokeWidth',
  'strokeWidthUnit',
  'strokeOpacity',
  'strokeDash',
  'strokeBlur',
  'fillOpacity',
  'circleRadius',
  'fillPattern',
  'fillPatternColor',
  'fillPatternSvg',
  'markerEnabled',
  'markerShape',
  'markerColor',
  'markerSize',
  'markerSvg',
]

const geometryOfSymbol = (symbol: SheetSymbol): GeometryKind =>
  symbol.kind === 'line' ? 'line' : symbol.kind === 'point' ? 'point' : 'polygon'

/** A Style Manager bundle (`geolibre-style-library`), one "symbol" entry per library symbol. */
export function geolibreStyleLibrary(library: SymbolLibrary): WriteResult {
  const { list, add } = diagnostics('geolibre')
  const entries = library.symbols.map((entry) => {
    const geometry = geometryOfSymbol(entry.symbol)
    const style = geolibreStyle(
      {
        id: 'symbol',
        name: entry.name,
        geometry,
        fields: [],
        rules: [{ label: entry.name, filter: null, symbol: entry.symbol }],
      },
      add,
    )
    if (style.lineDecoration && style.lineDecoration !== 'none')
      add(
        'warning',
        'A Style Manager symbol does not keep line decorations; the markers along the line are left out.',
        entry.name,
      )
    return {
      id: entry.id,
      name: entry.name,
      kind: 'symbol',
      tags: [...new Set([...entry.tags, entry.category, `geometry:${geometry}`].filter(Boolean))],
      style: Object.fromEntries(SYMBOL_KEYS.filter((k) => style[k] !== undefined).map((k) => [k, style[k]])),
      updatedAt: '',
    }
  })
  const bundle = { type: 'geolibre-style-library', version: 1, entries }
  return {
    files: [
      {
        path: `${safeFileStem(library.name)}.geolibre-styles.json`,
        content: `${JSON.stringify(bundle, null, 2)}\n`,
        mime: 'application/json',
      },
    ],
    diagnostics: list,
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Reading                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value)
const str = (value: unknown, fallback: string) => (typeof value === 'string' ? value : fallback)
const numOr = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const colorOr = (value: unknown, fallback: string) => {
  const parsed = typeof value === 'string' ? parseColor(value) : null
  return parsed ? toHexAlpha(parsed) : fallback
}

/** GeoLibre's defaults for the keys PGMaps reads, for styles that leave them out. */
const DEFAULTS = {
  fillColor: '#3b82f6',
  strokeColor: '#1e40af',
  strokeWidth: 2,
  strokeOpacity: 1,
  fillOpacity: 0.6,
  circleRadius: 6,
  markerSize: 18,
}

/** A symbol from GeoLibre's flat style with one rule's overrides. */
function symbolFrom(
  style: Json,
  rule: Partial<GeolibreRule> | null,
  geometry: GeometryKind,
  label: string,
  add: Diagnose,
  subject: string,
): SheetSymbol {
  const color = colorOr(rule?.color ?? style.fillColor, DEFAULTS.fillColor)
  const strokeColor = colorOr(rule?.strokeColor ?? style.strokeColor, DEFAULTS.strokeColor)
  const strokeWidth = numOr(rule?.strokeWidth ?? style.strokeWidth, DEFAULTS.strokeWidth)
  const strokeOpacity = numOr(style.strokeOpacity, DEFAULTS.strokeOpacity)
  const fillOpacity = numOr(rule?.fillOpacity ?? style.fillOpacity, DEFAULTS.fillOpacity)
  if (style.strokeWidthUnit === 'meters') add('warning', 'Stroke widths in metres are read as pixels.', subject)
  const dash = Array.isArray(style.strokeDash)
    ? (style.strokeDash as unknown[]).filter((d): d is number => typeof d === 'number')
    : []
  if (geometry === 'line') {
    const width = pt(strokeWidth)
    const decoration = str(style.lineDecoration, 'none')
    const marker =
      decoration === 'circle' || decoration === 'square'
        ? {
            icon: decoration === 'circle' ? ('dot' as const) : ('tower' as const),
            size: pt(numOr(style.lineDecorationSize, 12)),
            spacing: pt(numOr(style.lineDecorationSpacing, 80)),
            color: colorOr(style.lineDecorationColor || rule?.color || style.strokeColor, '#000000'),
          }
        : null
    if (decoration !== 'none' && !marker)
      add('warning', `The "${decoration}" line decoration has no PGMaps marker; it is left out.`, subject)
    return {
      kind: 'line',
      label,
      layers:
        strokeWidth > 0
          ? [
              {
                color,
                width,
                ...(dash.length ? { dash: dash.map((d) => round(d * width)) } : {}),
                ...(strokeOpacity < 1 ? { opacity: strokeOpacity } : {}),
              },
            ]
          : [],
      ...(marker ? { markers: [marker] } : {}),
    }
  }
  if (geometry === 'polygon') {
    const area: AreaSymbol = { kind: 'area', label, outline: [] }
    const svg = style.fillPattern === 'svg' ? str(style.fillPatternSvg, '') : ''
    const ours = svg ? patternFromSvg(svg) : null
    if (ours) Object.assign(area, ours)
    else {
      if (style.fillPattern && style.fillPattern !== 'none')
        add(
          'warning',
          `GeoLibre's "${String(style.fillPattern)}" fill pattern has no exact PGMaps equivalent; it is read as a flat fill.`,
          subject,
        )
      if (fillOpacity > 0) {
        area.fill = color
        if (fillOpacity < 1) area.fillOpacity = round(fillOpacity)
      }
    }
    if (strokeWidth > 0)
      area.outline.push({
        color: strokeColor,
        width: pt(strokeWidth),
        ...(dash.length ? { dash: dash.map((d) => round(d * pt(strokeWidth))) } : {}),
        ...(strokeOpacity < 1 ? { opacity: strokeOpacity } : {}),
      })
    if (!area.fill && !area.hatches && !area.markerFill && !area.outline.length) area.outline.push({ color, width: 1 })
    return area
  }
  if (style.markerEnabled === true) {
    const svg = str(style.markerSvg, '')
    const icon = style.markerShape === 'custom' ? iconFromSvg(svg) : null
    const size = pt(numOr(style.markerSize, DEFAULTS.markerSize))
    const ours = icon ? iconFromOurSvg(svg, size, add, subject) : null
    if (ours)
      return {
        kind: 'point',
        label,
        icon: ours.icon,
        size: ours.size,
        color: ours.color,
        ...(ours.secondary ? { secondary: ours.secondary } : {}),
        ...(ours.halo ? { halo: ours.halo } : {}),
      }
    const shape = str(style.markerShape, 'circle')
    const mapped = SHAPE_ICONS[shape] ?? null
    add(
      mapped ? 'warning' : 'error',
      mapped
        ? `GeoLibre's ${shape} marker is read as the nearest PGMaps icon.`
        : `GeoLibre's ${shape === 'custom' ? 'custom image' : shape} marker has no PGMaps icon; a dot stands in for it. Choose a PGMaps icon.`,
      subject,
    )
    return { kind: 'point', label, icon: mapped ?? 'dot', size, color }
  }
  const radius = numOr(rule?.circleRadius ?? style.circleRadius, DEFAULTS.circleRadius)
  if (fillOpacity < 1)
    add(
      'warning',
      `The circle's ${Math.round(fillOpacity * 100)} % opacity is not carried; PGMaps icons draw opaque.`,
      subject,
    )
  if (strokeWidth > 0) add('warning', 'The circle outline is read as a halo round the dot.', subject)
  return {
    kind: 'point',
    label,
    icon: 'dot',
    size: round((2 * pt(radius)) / 0.9),
    color,
    ...(strokeWidth > 0 ? { halo: { color: strokeColor, width: pt(strokeWidth) } } : {}),
  }
}

function labelFrom(style: Json): StyledLayer['label'] {
  const labels = style.labels
  if (!isObject(labels) || labels.enabled !== true || typeof labels.field !== 'string' || !labels.field)
    return undefined
  const halo = numOr(labels.haloWidth, 1.5)
  return {
    field: labels.field,
    size: pt(numOr(labels.size, 13)),
    color: colorOr(labels.color, '#111827'),
    ...(halo > 0 ? { halo: { color: colorOr(labels.haloColor, '#ffffff'), width: pt(halo) } } : {}),
    placement: labels.placement === 'line' ? 'line' : 'point',
  }
}

/** A GeoLibre layer style as a PGMaps layer; geometry from the data, else from the style, said so. */
function layerFromStyle(
  name: string,
  style: Json,
  geometryHint: GeometryKind | null,
  data: GeoJSON.FeatureCollection | undefined,
  ids: Set<string>,
  add: Diagnose,
): StyledLayer | null {
  let geometry = geometryHint
  if (!geometry) {
    geometry =
      style.markerEnabled === true ? 'point' : style.fillPattern && style.fillPattern !== 'none' ? 'polygon' : 'polygon'
    add(
      'warning',
      `${name} does not record its geometry; it is read as ${geometry === 'point' ? 'points (it has a marker)' : 'polygons'}.`,
      name,
    )
  }
  const mode = str(style.vectorStyleMode, 'single')
  const rules: StyleRule[] = []
  const subject = (label: string) => `${name}: ${label}`
  if (mode === 'rule-based' && Array.isArray(style.vectorRules)) {
    const raw = (style.vectorRules as unknown[]).filter(isObject)
    if (raw.some((r) => typeof r.parentId === 'string' && r.parentId))
      add('warning', "Nested rule groups are read as a flat list; a child does not inherit its parent's filter.", name)
    const items = [...raw.filter((r) => r.isElse !== true), ...raw.filter((r) => r.isElse === true).slice(0, 1)]
    items.forEach((r, i) => {
      const label = str(r.label, '') || (r.isElse ? 'Other' : `Rule ${i + 1}`)
      if (r.enabled === false) {
        if (!r.isElse) add('info', `"${label}" is switched off in GeoLibre; it is not read.`, name)
        return
      }
      if (r.minZoom !== undefined || r.maxZoom !== undefined)
        add('warning', 'The rule draws only at some zooms; PGMaps draws it at every scale.', subject(label))
      let filter = null
      if (!r.isElse) {
        let expr: unknown
        try {
          expr = JSON.parse(str(r.filter, 'null'))
        } catch {
          add('error', 'The rule filter is not valid JSON; the rule is not read.', subject(label))
          return
        }
        const read = readFilter(expr, [], add, subject(label))
        if ('error' in read) {
          add('error', `${read.error} The rule is not read.`, subject(label))
          return
        }
        filter = read.filter
        if (!filter)
          add('warning', 'The rule has no condition PGMaps reads; it is read as drawing every feature.', subject(label))
      }
      rules.push({
        label,
        filter,
        symbol: symbolFrom(style, r as Partial<GeolibreRule>, geometry!, label, add, subject(label)),
      })
    })
    const elseOff = raw.find((r) => r.isElse === true && r.enabled === false)
    if (!elseOff && !raw.some((r) => r.isElse === true))
      rules.push({
        label: 'Other',
        filter: null,
        symbol: symbolFrom(style, null, geometry, 'Other', add, subject('Other')),
      })
  } else if ((mode === 'categorized' || mode === 'graduated') && Array.isArray(style.vectorStyleStops)) {
    const field = str(style.vectorStyleProperty, '')
    const stops = (style.vectorStyleStops as unknown[]).filter(isObject)
    stops.forEach((stop, i) => {
      const value = stop.value
      const label = str(stop.label, String(value))
      let filter: RuleFilter | null = null
      if (mode === 'categorized' && (typeof value === 'string' || typeof value === 'number'))
        filter = { field, op: 'eq', value }
      else if (mode === 'graduated' && typeof value === 'number') {
        const next = stops[i + 1]?.value
        filter = { field, op: 'range', min: value, ...(typeof next === 'number' ? { max: next } : {}) }
      }
      if (!field || !filter) return add('error', 'A class of the renderer is not read.', subject(label))
      rules.push({
        label,
        filter,
        symbol: symbolFrom(style, { color: str(stop.color, '#808080') }, geometry!, label, add, subject(label)),
      })
    })
    if (mode === 'graduated') add('info', 'Graduated classes are read as ranges from each stop to the next.', name)
    rules.push({
      label: 'Other',
      filter: null,
      symbol: symbolFrom(style, null, geometry, 'Other', add, subject('Other')),
    })
  } else {
    if (mode !== 'single') add('warning', `The "${mode}" renderer is read as one symbol.`, name)
    rules.push({ label: name, filter: null, symbol: symbolFrom(style, null, geometry, name, add, name) })
  }
  if (!rules.length) {
    add('error', `${name} has no rule PGMaps can read.`, name)
    return null
  }
  const label = labelFrom(style)
  return {
    id: safeLayerId(name, ids),
    name,
    geometry,
    fields: fieldsFromRules(rules, label?.field, fieldKindsFromData(data)),
    rules,
    ...(label ? { label } : {}),
  }
}

type RuleFilter = NonNullable<StyleRule['filter']>

/** Reads a GeoLibre URL style through the MapLibre reader, with GeoLibre's own shapes undone first. */
function readUrlStyle(text: string, add: Diagnose): ReadResult {
  let style: Json
  try {
    style = JSON.parse(text) as Json
  } catch {
    add('error', 'The file is not JSON.')
    return { format: 'geolibre', layers: [], symbols: [], layouts: [], diagnostics: [] }
  }
  const layers = Array.isArray(style.layers) ? (style.layers as Json[]) : []
  const patterns = new Map<string, Json>()
  for (const layer of layers) {
    const paint = isObject(layer.paint) ? layer.paint : {}
    // GeoLibre colours a polygon's outline and a line differently through one line layer.
    const hasFill = layers.some((l) => l.source === layer.source && l.type === 'fill')
    for (const key of ['line-color', 'line-width']) {
      const value = paint[key]
      if (
        Array.isArray(value) &&
        value[0] === 'case' &&
        value.length === 4 &&
        JSON.stringify(value[1]) === '["==",["geometry-type"],"Polygon"]'
      )
        paint[key] = hasFill ? value[2] : value[3]
    }
    const meta = isObject(layer.metadata) ? layer.metadata[FILL_PATTERN_METADATA] : undefined
    if (isObject(meta) && typeof layer.source === 'string') patterns.set(layer.source, meta)
    // Our own "hide features no rule matches" filter is not a rule.
    if (Array.isArray(layer.filter) && layer.filter[0] === 'all' && layer.filter.length === 3)
      layer.filter = layer.filter[1]
    else if (Array.isArray(layer.filter) && layer.filter[0] === 'any' && layer.type === 'symbol') delete layer.filter
  }
  const read = readMaplibreStyle(JSON.stringify(style))
  for (const layer of read.layers) {
    const pattern = patterns.get(layer.name) ?? patterns.get(layer.id)
    if (!pattern || pattern.fillPattern === 'none') continue
    const ours = pattern.fillPattern === 'svg' ? patternFromSvg(str(pattern.fillPatternSvg, '')) : null
    if (!ours) {
      add(
        'warning',
        `GeoLibre's "${String(pattern.fillPattern)}" fill pattern has no exact PGMaps equivalent; the layer is read with flat fills.`,
        layer.name,
      )
      continue
    }
    for (const rule of layer.rules)
      if (rule.symbol.kind === 'area') {
        const { fill: _fill, fillOpacity: _opacity, ...rest } = rule.symbol
        void _fill
        void _opacity
        rule.symbol = { ...rest, ...ours }
      }
  }
  return {
    ...read,
    format: 'geolibre',
    diagnostics: read.diagnostics.map((d) => ({ ...d, format: 'geolibre' as const })),
  }
}

/** Library symbols from Style Manager entries; geometry from PGMaps' `geometry:` tag, else the style. */
function readLibrary(entries: unknown[], add: Diagnose): LibrarySymbol[] {
  const symbols: LibrarySymbol[] = []
  const ids = new Set<string>()
  for (const raw of entries) {
    if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !isObject(raw.style)) {
      add('warning', 'A Style Manager entry without an id, name or style is skipped.')
      continue
    }
    if (raw.kind === 'labels' || raw.kind === 'ramp') {
      add('info', `"${raw.name}" is a ${raw.kind} entry, not a symbol; it is skipped.`, raw.name)
      continue
    }
    const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string') : []
    const tagged = tags.find((t) => t.startsWith('geometry:'))?.slice(9)
    const geometry: GeometryKind | null =
      tagged === 'point' || tagged === 'line' || tagged === 'polygon' ? tagged : null
    const layer = layerFromStyle(raw.name, raw.style, geometry, undefined, ids, add)
    if (!layer) continue
    symbols.push({
      id: raw.id,
      name: raw.name,
      category: tags.find((t) => !t.startsWith('geometry:') && !['fixture'].includes(t)) ?? 'GeoLibre',
      tags: tags.filter((t) => !t.startsWith('geometry:')),
      symbol: layer.rules[0].symbol,
    })
  }
  return symbols
}

/**
 * Reads a GeoLibre file: a project (`.geolibre`, or the older `.geolibre.json`), a URL style
 * (`.geolibre.style.json`), a Style Manager bundle or a layer styles file.
 */
export function readGeolibreFile(fileName: string, text: string): ReadResult {
  const { list, add } = diagnostics('geolibre')
  const result: ReadResult = { format: 'geolibre', layers: [], symbols: [], layouts: [], diagnostics: list }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    add('error', `${fileName} is not JSON.`)
    return result
  }
  if (isObject(value) && value.version === 8 && Array.isArray(value.layers)) {
    const read = readUrlStyle(text, add)
    return { ...read, diagnostics: [...list, ...read.diagnostics] }
  }
  if (Array.isArray(value) || (isObject(value) && value.type === 'geolibre-style-library')) {
    const entries = Array.isArray(value) ? value : Array.isArray(value.entries) ? value.entries : []
    result.symbols.push(...readLibrary(entries, add))
    if (!result.symbols.length) add('error', `${fileName} has no Style Manager symbol PGMaps can read.`)
    return result
  }
  if (isObject(value) && value.type === 'geolibre-layer-styles' && Array.isArray(value.styles)) {
    const ids = new Set<string>()
    for (const entry of value.styles.filter(isObject)) {
      if (entry.kind !== 'vector' || !isObject(entry.style)) {
        add('info', `The ${String(entry.kind)} style for "${String(entry.layerName)}" is not read.`)
        continue
      }
      const layer = layerFromStyle(str(entry.layerName, 'layer'), entry.style, null, undefined, ids, add)
      if (layer) result.layers.push(layer)
    }
    return result
  }
  if (!isObject(value) || !Array.isArray(value.layers)) {
    add('error', `${fileName} is not a GeoLibre project, URL style or style library.`)
    return result
  }
  const ids = new Set<string>()
  for (const raw of value.layers.filter(isObject)) {
    const name = str(raw.name, str(raw.id, 'layer'))
    if (raw.type !== 'geojson' || !isObject(raw.style)) {
      add('info', `${name} is a ${String(raw.type)} layer; only GeoJSON vector layers are read.`, name)
      continue
    }
    const data = isObject(raw.geojson) ? (raw.geojson as unknown as GeoJSON.FeatureCollection) : undefined
    const layer = layerFromStyle(name, raw.style, geometryOfData(data), data, ids, add)
    if (!layer) continue
    if (raw.visible === false) layer.hidden = true
    result.layers.push(layer)
  }
  if (Array.isArray(value.styleLibrary)) result.symbols.push(...readLibrary(value.styleLibrary, add))
  if (value.printLayout) add('info', 'The print layout is not read; PGMaps sheets use their own templates.')
  if (!result.layers.length && !result.symbols.length) add('error', `${fileName} has no layer PGMaps can read.`)
  return result
}
