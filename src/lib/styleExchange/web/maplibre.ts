/**
 * MapLibre style v8 (`style.json`) with the layers' GeoJSON inline, one source per layer, and the
 * symbols' icons and pattern tiles packed into a sprite at 1× and 2×. The paints come from
 * `mapSymbols.ts`, the same functions the app's own map uses, so a symbol looks as it does in
 * PGMaps; every part of a symbol (each stroke, the fill or pattern, each outline, each marker row)
 * is its own style layer. MapLibre draws every layer a feature matches, so each rule's filter also
 * excludes the rules above it that could match the same feature; the "everything else" rule
 * excludes them all.
 *
 * The sprite: MapLibre 6 accepts only an absolute sprite URL (`normalizeSpriteURL` throws
 * "Invalid sprite URL … must be absolute") and does not resolve one against the style's own URL,
 * so a relative `sprite` stops icons and patterns from loading. Pass `spriteUrl` (absolute, without
 * extension) when the files' address is known; otherwise the style says `./sprite` and a
 * diagnostic tells the reader to resolve it (MapLibre's `transformStyle`, or edit the file).
 * Labels need a glyph server: without `glyphs` they are left out and a diagnostic says so.
 *
 * Each style layer group carries its PGMaps layer in `metadata`; `readMaplibreStyle` trusts it only
 * when the style layers are still exactly what PGMaps would write for it. Any other style is read
 * from its layers, conservatively: line, fill, circle and symbol layers grouped by source and
 * source-layer, `==` / `in` / `match` / `all` / `case` filters where they map to PGMaps rules, and a
 * diagnostic for everything else. No DOM or network access.
 */
import { checkedSheetSymbol } from '../checkedSymbol'
import { parseColor, toHexAlpha } from '../color'
import type {
  ExchangeFile,
  FieldValue,
  GeometryKind,
  LabelStyle,
  ReadResult,
  RuleFilter,
  StyleDocument,
  StyledLayer,
  WriteResult,
} from '../model'
import type { StrokeStyle } from '@/lib/mapSheet/drawOps'
import {
  areaSymbolPaint,
  lineMarkerLayers,
  lineSymbolLayout,
  lineSymbolPaint,
  pointSymbolLayout,
  PX_PER_PT,
  symbolImages,
  type SymbolImage,
} from '@/lib/mapSheet/mapSymbols'
import type { SheetSymbol } from '@/lib/mapSheet/symbols'
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

/** Key of the PGMaps layer in a style layer's `metadata`. */
export const MAPLIBRE_METADATA_KEY = 'pgmaps:style-exchange'
/** The zoom a zoom-dependent value is read at: about 1:35,000, a block-planning scale. */
export const READ_AT_ZOOM = 14
/** Widest sprite sheet, device pixels. */
const MAX_SPRITE_WIDTH = 2048

export type Expression = unknown[]
type Json = Record<string, unknown>
export interface StyleLayerJson {
  id: string
  type: string
  source?: string
  'source-layer'?: string
  filter?: unknown
  layout?: Json
  paint?: Json
  minzoom?: number
  maxzoom?: number
  metadata?: Json
}

export interface MaplibreStyleOptions {
  encodePng: (rgba: Uint8ClampedArray, width: number, height: number) => Promise<Uint8Array>
  /** Glyph URL template (`…/{fontstack}/{range}.pbf`); labels are written only with one. */
  glyphs?: string
  /** Absolute sprite URL without extension; MapLibre 6 does not accept a relative one. */
  spriteUrl?: string
  /** Font stacks for labels, as the glyph server names them. */
  fonts?: { regular: string[]; bold: string[] }
}

/** Fonts the MapLibre and OpenMapTiles demo glyph servers both carry. */
const DEFAULT_FONTS = { regular: ['Noto Sans Regular'], bold: ['Noto Sans Bold'] }

/* ------------------------------------------------------------------------------------------ */
/* Filters                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const get = (field: string) => ['get', field]

/** A rule filter as a MapLibre expression. Values keep their JSON type, so 12 never matches "12". */
export function filterExpression(filter: RuleFilter): Expression {
  if (filter.op === 'eq') return ['==', get(filter.field), filter.value]
  if (filter.op === 'in') return ['in', get(filter.field), ['literal', filter.values]]
  // `typeof` first: comparing a string or null with a number is an evaluation error, which MapLibre
  // treats as "no match" for the rule but also for its negation in the rules below.
  return [
    'all',
    ['==', ['typeof', get(filter.field)], 'number'],
    ...(filter.min !== undefined ? [['>=', get(filter.field), filter.min]] : []),
    ...(filter.max !== undefined ? [['<', get(filter.field), filter.max]] : []),
  ]
}

const anyOf = (filters: RuleFilter[]): Expression =>
  filters.length === 1 ? filterExpression(filters[0]) : ['any', ...filters.map(filterExpression)]

/** The rule's filter, excluding earlier rules it could overlap; undefined draws every feature. */
export function exclusiveFilter(filter: RuleFilter | null, excluded: RuleFilter[]): Expression | undefined {
  if (!filter) return excluded.length ? ['!', anyOf(excluded)] : undefined
  return excluded.length ? ['all', filterExpression(filter), ['!', anyOf(excluded)]] : filterExpression(filter)
}

/* ------------------------------------------------------------------------------------------ */
/* Writing                                                                                     */
/* ------------------------------------------------------------------------------------------ */

const strokeLayout = (stroke: StrokeStyle) => ({
  'line-cap': stroke.cap ?? 'butt',
  'line-join': stroke.join ?? 'miter',
})

/** The style layers of one rule's symbol, bottom first. */
function symbolLayers(
  layer: StyledLayer,
  symbol: SheetSymbol,
  base: { idPrefix: string; filter?: Expression; visibility: 'visible' | 'none' },
  add: Diagnose,
  subject: string,
): StyleLayerJson[] {
  const common = (id: string, type: string): StyleLayerJson => ({
    id: `${base.idPrefix}-${id}`,
    type,
    source: layer.id,
    ...(base.filter ? { filter: base.filter } : {}),
  })
  const out: StyleLayerJson[] = []
  if (symbol.kind === 'line') {
    const paints = lineSymbolPaint(symbol)
    const layouts = lineSymbolLayout(symbol)
    paints.forEach((paint, j) =>
      out.push({ ...common(`line-${j}`, 'line'), layout: { ...layouts[j], visibility: base.visibility }, paint }),
    )
    lineMarkerLayers(symbol).forEach((marker, k) => {
      if (symbol.markers?.[k].start !== undefined)
        add('info', 'MapLibre places the first marker along a line itself; its start distance is not kept.', subject)
      out.push({ ...common(`marker-${k}`, 'symbol'), layout: { ...marker.layout, visibility: base.visibility } })
    })
    return out
  }
  if (symbol.kind === 'area') {
    const paint = areaSymbolPaint(symbol)
    if (paint.fill) out.push({ ...common('fill', 'fill'), layout: { visibility: base.visibility }, paint: paint.fill })
    if (paint.pattern)
      out.push({ ...common('pattern', 'fill'), layout: { visibility: base.visibility }, paint: paint.pattern })
    if (symbol.outline.some((o) => o.inside))
      add('warning', 'MapLibre cannot keep a casing inside its polygon; it is drawn centred on the edge.', subject)
    paint.outline.forEach((outline, j) =>
      out.push({
        ...common(`outline-${j}`, 'line'),
        layout: { ...strokeLayout(symbol.outline[j]), visibility: base.visibility },
        paint: outline,
      }),
    )
    return out
  }
  if (symbol.kind === 'point')
    return [{ ...common('icon', 'symbol'), layout: { ...pointSymbolLayout(symbol), visibility: base.visibility } }]
  // A class colour: a fill on polygons, a 1 pt line or a dot otherwise.
  if (layer.geometry === 'polygon')
    return [
      {
        ...common('fill', 'fill'),
        layout: { visibility: base.visibility },
        paint: { 'fill-color': symbol.color, 'fill-opacity': symbol.opacity },
      },
    ]
  add(
    'warning',
    `A class colour on a ${layer.geometry} layer is drawn as a plain ${layer.geometry === 'line' ? 'line' : 'dot'}.`,
    subject,
  )
  if (layer.geometry === 'line')
    return [
      {
        ...common('line-0', 'line'),
        layout: { visibility: base.visibility },
        paint: { 'line-color': symbol.color, 'line-opacity': symbol.opacity, 'line-width': PX_PER_PT },
      },
    ]
  return [
    {
      ...common('circle', 'circle'),
      layout: { visibility: base.visibility },
      paint: { 'circle-color': symbol.color, 'circle-opacity': symbol.opacity, 'circle-radius': 2 * PX_PER_PT },
    },
  ]
}

function labelLayer(
  layer: StyledLayer,
  label: LabelStyle,
  fonts: { regular: string[]; bold: string[] },
): StyleLayerJson {
  return {
    id: `${layer.id}-label`,
    type: 'symbol',
    source: layer.id,
    layout: {
      // A plain get: GeoStyler and older clients read no to-string or coalesce; MapLibre shows a missing value as empty.
      'text-field': get(label.field),
      'text-font': label.bold ? fonts.bold : fonts.regular,
      'text-size': round(label.size * PX_PER_PT, 3),
      'symbol-placement': label.placement === 'line' ? 'line' : 'point',
      // Point labels sit to the right of the point, clear of its icon.
      ...(label.placement === 'point' ? { 'text-anchor': 'left', 'text-offset': [1, 0] } : {}),
      visibility: layer.hidden ? 'none' : 'visible',
    },
    paint: {
      'text-color': label.color,
      ...(label.halo
        ? { 'text-halo-color': label.halo.color, 'text-halo-width': round(label.halo.width * PX_PER_PT, 3) }
        : {}),
    },
  }
}

/** Every style layer PGMaps writes for one layer, without metadata. */
export function styleLayersFor(
  layer: StyledLayer,
  add: Diagnose,
  options: { labels: boolean; fonts?: { regular: string[]; bold: string[] } },
): StyleLayerJson[] {
  const excluded = exclusions(layer.rules)
  const visibility = layer.hidden ? 'none' : 'visible'
  const layers = layer.rules.flatMap((rule, i) =>
    symbolLayers(
      layer,
      rule.symbol,
      { idPrefix: `${layer.id}-r${i}`, filter: exclusiveFilter(rule.filter, excluded[i]), visibility },
      add,
      `${layer.name}: ${rule.label}`,
    ),
  )
  if (layer.label && options.labels) layers.push(labelLayer(layer, layer.label, options.fonts ?? DEFAULT_FONTS))
  return layers
}

interface SpriteSheet {
  json: Record<string, { width: number; height: number; x: number; y: number; pixelRatio: number }>
  width: number
  height: number
  data: Uint8ClampedArray
}

/** Packs images into one sheet in rows, tallest first, with a pixel between them. */
export function packSprite(images: readonly SymbolImage[]): SpriteSheet {
  const sorted = [...images].sort((a, b) => b.image.height - a.image.height || a.id.localeCompare(b.id))
  const area = sorted.reduce((sum, i) => sum + (i.image.width + 1) * (i.image.height + 1), 0)
  const widest = Math.max(1, ...sorted.map((i) => i.image.width + 1))
  const rowWidth = Math.min(MAX_SPRITE_WIDTH, Math.max(widest, Math.ceil(Math.sqrt(area) * 1.2)))
  const placed: { image: SymbolImage; x: number; y: number }[] = []
  let x = 0,
    y = 0,
    rowHeight = 0,
    width = 1
  for (const image of sorted) {
    if (x + image.image.width > rowWidth && x > 0) {
      y += rowHeight + 1
      x = 0
      rowHeight = 0
    }
    placed.push({ image, x, y })
    x += image.image.width + 1
    rowHeight = Math.max(rowHeight, image.image.height)
    width = Math.max(width, x)
  }
  const height = Math.max(1, y + rowHeight)
  const data = new Uint8ClampedArray(width * height * 4)
  const json: SpriteSheet['json'] = {}
  for (const { image, x: px, y: py } of placed) {
    const { width: w, height: h, data: pixels } = image.image
    for (let row = 0; row < h; row++)
      data.set(pixels.subarray(row * w * 4, (row + 1) * w * 4), ((py + row) * width + px) * 4)
    json[image.id] = { width: w, height: h, x: px, y: py, pixelRatio: image.pixelRatio }
  }
  return { json, width, height, data }
}

/** The view that frames `extent` in about 600 screen pixels, so it fits most windows. */
function viewOf(extent: [number, number, number, number]) {
  const [west, south, east, north] = extent
  const lat = (south + north) / 2
  const span = Math.max(east - west, (north - south) / Math.cos((lat * Math.PI) / 180), 1e-9)
  return { center: [round((west + east) / 2, 6), round(lat, 6)], zoom: round(Math.log2((360 * 600) / 512 / span), 2) }
}

/**
 * `style.json` and its sprite at 1× and 2× (`sprite.json`/`.png`, `sprite@2x.json`/`.png`). Data is
 * inline; `data[layer.id]` is each layer's GeoJSON.
 */
export async function maplibreStyle(
  doc: StyleDocument,
  data: Record<string, GeoJSON.FeatureCollection>,
  options: MaplibreStyleOptions,
): Promise<WriteResult> {
  const { list, add } = diagnostics('maplibre')
  const sources: Record<string, Json> = {}
  const layers: StyleLayerJson[] = []
  for (const layer of doc.layers) {
    const collection = data[layer.id]
    if (!collection) add('warning', `No data was given for ${layer.name}; its source is empty.`, layer.name)
    sources[layer.id] = { type: 'geojson', data: collection ?? { type: 'FeatureCollection', features: [] } }
    const own = styleLayersFor(layer, add, { labels: !!options.glyphs, fonts: options.fonts })
    if (own.length) own[0] = { ...own[0], metadata: { [MAPLIBRE_METADATA_KEY]: { layer } } }
    layers.push(...own)
    if (layer.label && !options.glyphs)
      add('warning', 'Labels need a glyph server; give a glyphs URL to write them.', layer.name)
  }
  const files: ExchangeFile[] = []
  const images = (ratio: number) => {
    const byId = new Map<string, SymbolImage>()
    for (const layer of doc.layers)
      for (const rule of layer.rules) for (const image of symbolImages(rule.symbol, ratio)) byId.set(image.id, image)
    return [...byId.values()]
  }
  const one = images(1)
  let sprite: string | undefined
  if (one.length) {
    sprite = options.spriteUrl ?? './sprite'
    if (!options.spriteUrl)
      add(
        'warning',
        'The style names its sprite as ./sprite. MapLibre 6 needs an absolute sprite URL: load it with transformStyle (new URL(style.sprite, styleUrl)) or edit the file to where it is served.',
      )
    for (const [ratio, suffix] of [
      [1, ''],
      [2, '@2x'],
    ] as const) {
      const sheet = packSprite(ratio === 1 ? one : images(2))
      files.push({
        path: `sprite${suffix}.json`,
        content: `${JSON.stringify(sheet.json, null, 2)}\n`,
        mime: 'application/json',
      })
      files.push({
        path: `sprite${suffix}.png`,
        content: await options.encodePng(sheet.data, sheet.width, sheet.height),
        mime: 'image/png',
      })
    }
  }
  const style = {
    version: 8,
    name: doc.name,
    metadata: { [MAPLIBRE_METADATA_KEY]: { schema: doc.schema } },
    ...(doc.extent ? viewOf(doc.extent) : {}),
    ...(sprite ? { sprite } : {}),
    ...(options.glyphs ? { glyphs: options.glyphs } : {}),
    sources,
    layers,
  }
  files.unshift({ path: 'style.json', content: `${JSON.stringify(style, null, 2)}\n`, mime: 'application/json' })
  return { files, diagnostics: list }
}

/* ------------------------------------------------------------------------------------------ */
/* Reading filters                                                                             */
/* ------------------------------------------------------------------------------------------ */

const isPrimitive = (value: unknown): value is FieldValue =>
  typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))

/** The field an expression reads: `["get", f]`, or a bare name in the legacy filter syntax. */
function fieldOf(node: unknown, legacy: boolean): string | null {
  if (Array.isArray(node) && node[0] === 'get' && node.length === 2 && typeof node[1] === 'string') return node[1]
  if (legacy && typeof node === 'string' && !node.startsWith('$')) return node
  return null
}

/** The geometry a filter's `$type` / `geometry-type` test names, anywhere in an `all`, or null. */
function geometryTested(node: unknown): GeometryKind | null {
  if (!Array.isArray(node)) return null
  if (node[0] === 'all') {
    for (const part of node.slice(1)) {
      const found = geometryTested(part)
      if (found) return found
    }
    return null
  }
  if (!isGeometryTest(node) || node[0] === '!=' || node[0] === '!in') return null
  const named = JSON.stringify(node.slice(2))
  return /Polygon/.test(named) ? 'polygon' : /LineString/.test(named) ? 'line' : /Point/.test(named) ? 'point' : null
}

/** A test on geometry type (`$type` or `["geometry-type"]`): the style layer's type says it already. */
function isGeometryTest(node: unknown): boolean {
  if (!Array.isArray(node)) return false
  const subject = node[1]
  const geometry = subject === '$type' || JSON.stringify(subject) === '["geometry-type"]'
  return geometry && ['==', '!=', 'in', '!in', 'match'].includes(String(node[0]))
}

const isNumberTypeTest = (node: unknown) =>
  Array.isArray(node) && node[0] === '==' && Array.isArray(node[1]) && node[1][0] === 'typeof' && node[2] === 'number'

type FilterRead = { filter: RuleFilter | null } | { error: string }

/** A single condition as a rule filter, or an Error naming why not. */
function condition(node: unknown, add: Diagnose, subject: string): RuleFilter {
  if (!Array.isArray(node) || typeof node[0] !== 'string') throw Error('The filter is not an expression.')
  const [op, a, b] = node
  // Legacy filters name the field as a bare string: ["==", "class", "park"].
  const legacy = typeof a === 'string' && !Array.isArray(b)
  if (op === '==' && node.length === 3) {
    const field = fieldOf(a, legacy) ?? fieldOf(b, false)
    const value = fieldOf(a, legacy) ? b : a
    if (field && isPrimitive(value)) return { field, op: 'eq', value }
  }
  if (op === 'in') {
    if (node.length === 3 && Array.isArray(b) && b[0] === 'literal' && Array.isArray(b[1])) {
      const field = fieldOf(a, false)
      if (field && b[1].every(isPrimitive)) return { field, op: 'in', values: b[1] as FieldValue[] }
    }
    if (typeof a === 'string' && !(node.length === 3 && Array.isArray(b)) && node.slice(2).every(isPrimitive))
      return { field: a, op: 'in', values: node.slice(2) as FieldValue[] }
  }
  if (op === 'match' && node.length === 5 && node[3] === true && node[4] === false) {
    const field = fieldOf(a, false)
    const labels = Array.isArray(b) ? b : [b]
    if (field && labels.every(isPrimitive))
      return labels.length === 1
        ? { field, op: 'eq', value: labels[0] as FieldValue }
        : { field, op: 'in', values: labels as FieldValue[] }
  }
  if (['>=', '>', '<', '<='].includes(op) && node.length === 3) {
    const field = fieldOf(a, legacy)
    if (field && typeof b === 'number') {
      if (op === '>' || op === '<=')
        add(
          'warning',
          `"${op} ${b}" is read as "${op === '>' ? '≥' : '<'} ${b}": PGMaps ranges include their minimum and exclude their maximum.`,
          subject,
        )
      return op === '>=' || op === '>' ? { field, op: 'range', min: b } : { field, op: 'range', max: b }
    }
  }
  throw Error(`The "${op}" filter has no PGMaps rule equivalent.`)
}

/** Merges two ranges on one field into one, or null. */
function mergeRanges(a: RuleFilter, b: RuleFilter): RuleFilter | null {
  if (a.op !== 'range' || b.op !== 'range' || a.field !== b.field) return null
  if ((a.min !== undefined && b.min !== undefined) || (a.max !== undefined && b.max !== undefined)) return null
  const min = a.min ?? b.min,
    max = a.max ?? b.max
  return { field: a.field, op: 'range', ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }
}

/**
 * A layer filter (expression or legacy) as a rule filter. Geometry-type tests are dropped (the
 * layer's geometry comes from its style layer types) and the "and not the rules above" clause a
 * draw-every-match style needs is taken off when it names only `earlier` rules. Null is no filter.
 */
export function readFilter(node: unknown, earlier: readonly RuleFilter[], add: Diagnose, subject: string): FilterRead {
  if (node === undefined || node === null || node === true) return { filter: null }
  try {
    const known = new Set(earlier.map((f) => JSON.stringify(f)))
    const negationOfEarlier = (n: unknown) => {
      if (!Array.isArray(n) || n[0] !== '!' || n.length !== 2) return false
      const inner = n[1]
      const parts = Array.isArray(inner) && inner[0] === 'any' ? inner.slice(1) : [inner]
      return parts.every((p) => {
        try {
          return known.has(JSON.stringify(readFilterStrict(p, add, subject)))
        } catch {
          return false
        }
      })
    }
    if (negationOfEarlier(node)) return { filter: null }
    return { filter: readFilterStrict(node, add, subject, negationOfEarlier) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'The filter is not read.' }
  }
}

function readFilterStrict(
  node: unknown,
  add: Diagnose,
  subject: string,
  dropNegation: (n: unknown) => boolean = () => false,
): RuleFilter | null {
  if (Array.isArray(node) && node[0] === 'all') {
    const parts = node.slice(1).filter((p) => !isGeometryTest(p) && !isNumberTypeTest(p) && !dropNegation(p))
    if (!parts.length) return null
    const filters = parts.map((p) => readFilterStrict(p, add, subject))
    const real = filters.filter((f): f is RuleFilter => !!f)
    if (real.length === 1) return real[0]
    if (real.length === 2) {
      const merged = mergeRanges(real[0], real[1])
      if (merged) return merged
    }
    if (!real.length) return null
    throw Error('Conditions on more than one field have no PGMaps rule equivalent.')
  }
  if (isGeometryTest(node)) return null
  return condition(node, add, subject)
}

/* ------------------------------------------------------------------------------------------ */
/* Reading values                                                                              */
/* ------------------------------------------------------------------------------------------ */

/** The value at `READ_AT_ZOOM` of a zoom function or expression. */
function atZoom(value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray((value as Json).stops)) {
    const stops = (value as { stops: [number, unknown][] }).stops
    if ((value as Json).property !== undefined) return undefined
    let pick = stops[0]?.[1]
    for (const [z, v] of stops) if (z <= READ_AT_ZOOM) pick = v
    return pick
  }
  if (
    Array.isArray(value) &&
    (value[0] === 'interpolate' || value[0] === 'interpolate-hcl' || value[0] === 'interpolate-lab')
  ) {
    if (JSON.stringify(value[2]) !== '["zoom"]') return undefined
    const stops = value.slice(3)
    let lo: [number, unknown] | null = null,
      hi: [number, unknown] | null = null
    for (let i = 0; i + 1 < stops.length; i += 2) {
      const z = stops[i] as number
      if (z <= READ_AT_ZOOM) lo = [z, stops[i + 1]]
      else if (!hi) hi = [z, stops[i + 1]]
    }
    if (lo && hi && typeof lo[1] === 'number' && typeof hi[1] === 'number')
      return lo[1] + ((hi[1] - lo[1]) * (READ_AT_ZOOM - lo[0])) / (hi[0] - lo[0])
    return (lo ?? hi)?.[1]
  }
  if (Array.isArray(value) && value[0] === 'step' && JSON.stringify(value[1]) === '["zoom"]') {
    let pick = value[2]
    for (let i = 3; i + 1 < value.length; i += 2) if ((value[i] as number) <= READ_AT_ZOOM) pick = value[i + 1]
    return pick
  }
  return undefined
}

/** A constant paint value, reading zoom functions at `READ_AT_ZOOM`; undefined with a diagnostic otherwise. */
function constant(value: unknown, what: string, add: Diagnose, subject: string): unknown {
  if (value === undefined) return undefined
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value
  if (Array.isArray(value) && value[0] === 'literal') return value[1]
  if (Array.isArray(value) && value.every((v) => typeof v === 'number')) return value
  const zoomed = atZoom(value)
  if (zoomed !== undefined) {
    add('warning', `${what} changes with zoom; it is read at zoom ${READ_AT_ZOOM}.`, subject)
    return constant(zoomed, what, () => undefined, subject)
  }
  add('warning', `${what} is an expression PGMaps does not read; the default is used.`, subject)
  return undefined
}

const num = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
/** A CSS colour as hex; colours PGMaps cannot parse (hsl, named) fall back. */
const colorOf = (value: unknown, fallback: string) => {
  const parsed = typeof value === 'string' ? parseColor(value) : null
  return parsed ? toHexAlpha(parsed) : fallback
}

/** Paint colours that split one style layer into rules: `case` and `match` on a field. */
function colorBranches(
  value: unknown,
  add: Diagnose,
  subject: string,
): { filter: RuleFilter | null; color: unknown }[] | null {
  if (!Array.isArray(value)) return null
  if (value[0] === 'case' && value.length >= 4 && value.length % 2 === 0) {
    const out: { filter: RuleFilter | null; color: unknown }[] = []
    for (let i = 1; i + 1 < value.length; i += 2) {
      const read = readFilter(value[i], [], add, subject)
      if ('error' in read) {
        add('warning', `A colour case is not read (${read.error})`, subject)
        continue
      }
      out.push({ filter: read.filter, color: value[i + 1] })
    }
    out.push({ filter: null, color: value[value.length - 1] })
    return out
  }
  if (value[0] === 'match' && value.length >= 5 && value.length % 2 === 1) {
    const field =
      fieldOf(value[1], false) ??
      (Array.isArray(value[1]) && value[1][0] === 'to-string' ? fieldOf(value[1][1], false) : null)
    if (!field) return null
    const out: { filter: RuleFilter | null; color: unknown }[] = []
    for (let i = 2; i + 1 < value.length; i += 2) {
      const labels = Array.isArray(value[i]) ? value[i] : [value[i]]
      if (!labels.every(isPrimitive)) return null
      out.push({
        filter: labels.length === 1 ? { field, op: 'eq', value: labels[0] } : { field, op: 'in', values: labels },
        color: value[i + 1],
      })
    }
    out.push({ filter: null, color: value[value.length - 1] })
    return out
  }
  return null
}

/* ------------------------------------------------------------------------------------------ */
/* Reading layers                                                                              */
/* ------------------------------------------------------------------------------------------ */

function lineStroke(
  layer: StyleLayerJson,
  color: unknown,
  add: Diagnose,
  subject: string,
): StrokeStyle & { offset?: number } {
  const paint = layer.paint ?? {}
  const layout = layer.layout ?? {}
  const width = num(constant(paint['line-width'], 'The line width', add, subject), 1) / PX_PER_PT
  const dash = constant(paint['line-dasharray'], 'The dash pattern', add, subject)
  const offset = num(constant(paint['line-offset'], 'The line offset', add, subject), 0) / PX_PER_PT
  const opacity = constant(paint['line-opacity'], 'The line opacity', add, subject)
  const cap = constant(layout['line-cap'], 'The line cap', add, subject)
  const join = constant(layout['line-join'], 'The line join', add, subject)
  if (paint['line-pattern'])
    add('error', 'A line pattern from the sprite is not read; the line is drawn plain.', subject)
  if (paint['line-gradient']) add('warning', 'A line gradient is read as one colour.', subject)
  if (paint['line-blur']) add('warning', 'A line blur is not read.', subject)
  if (paint['line-gap-width']) add('warning', 'A line gap width (a casing drawn as two lines) is not read.', subject)
  return {
    color: colorOf(color, '#000000'),
    width: round(width),
    ...(Array.isArray(dash) && dash.length && dash.some((d) => d > 0)
      ? { dash: (dash as number[]).map((d) => round(d * width)) }
      : {}),
    // Butt caps and mitre joins are the defaults on both sides.
    ...(cap === 'round' || cap === 'square' ? { cap } : {}),
    ...(join === 'round' || join === 'bevel' ? { join } : {}),
    ...(typeof opacity === 'number' && opacity < 1 ? { opacity } : {}),
    ...(offset ? { offset: round(offset) } : {}),
  }
}

type Built = { label: string; filter: RuleFilter | null; symbol: SheetSymbol }

/** One readable source: its style layers as rules, and its label. */
function readGroup(
  name: string,
  styleLayers: StyleLayerJson[],
  ids: Set<string>,
  add: Diagnose,
  geometry: GeometryKind,
): StyledLayer | null {
  const rules: Built[] = []
  const earlier: RuleFilter[] = []
  let label: LabelStyle | undefined
  const ruleFor = (filter: RuleFilter | null, title: string): Built => {
    let rule = rules.find((r) => sameFilter(r.filter, filter))
    if (!rule) {
      const symbol: SheetSymbol =
        geometry === 'polygon'
          ? { kind: 'area', label: title, outline: [] }
          : geometry === 'line'
            ? { kind: 'line', label: title, layers: [] }
            : { kind: 'point', label: title, icon: 'dot', size: 0, color: '#000000' }
      rule = { label: title, filter, symbol }
      rules.push(rule)
    }
    return rule
  }
  for (const styleLayer of styleLayers) {
    const subject = `${name}: ${styleLayer.id}`
    if (styleLayer.minzoom !== undefined || styleLayer.maxzoom !== undefined)
      add('warning', 'The layer draws only at some zooms; PGMaps draws it at every scale.', subject)
    if ((styleLayer.layout ?? {}).visibility === 'none') add('info', 'The layer is hidden in the style.', subject)
    const read = readFilter(styleLayer.filter, earlier, add, subject)
    if ('error' in read) {
      add('error', `${read.error} The layer is not read.`, subject)
      continue
    }
    const paint = styleLayer.paint ?? {}
    const layout = styleLayer.layout ?? {}
    if (styleLayer.type === 'symbol' && layout['text-field'] !== undefined && layout['icon-image'] === undefined) {
      const found = readLabel(styleLayer, add, subject)
      if (found && !label) label = found
      else if (found) add('warning', 'Only the first label layer of a source is read.', subject)
      continue
    }
    const colorKey =
      styleLayer.type === 'fill'
        ? 'fill-color'
        : styleLayer.type === 'line'
          ? 'line-color'
          : styleLayer.type === 'circle'
            ? 'circle-color'
            : null
    const branches = colorKey ? colorBranches(paint[colorKey], add, subject) : null
    if (branches && read.filter)
      add('warning', 'A data-driven colour on a filtered layer is read from its last branch only.', subject)
    const variants =
      branches && !read.filter
        ? branches.map((b) => ({ filter: b.filter, color: b.color }))
        : [{ filter: read.filter, color: branches ? branches[branches.length - 1].color : paint[colorKey ?? ''] }]
    if (read.filter) earlier.push(read.filter)
    for (const variant of variants) {
      const title = variant.filter ? describe(variant.filter) : styleLayers.length > 1 ? 'Other' : name
      const rule = ruleFor(variant.filter, title)
      const color = constant(variant.color, 'The colour', add, subject)
      addPart(rule, styleLayer, color, geometry, add, subject)
    }
  }
  const usable = rules.filter((rule) => {
    const s = rule.symbol
    const empty =
      (s.kind === 'area' && !s.fill && !s.hatches?.length && !s.markerFill && !s.outline.length) ||
      (s.kind === 'line' && !s.layers.length && !s.markers?.length) ||
      (s.kind === 'point' && s.size === 0)
    if (empty) add('warning', `"${rule.label}" draws nothing PGMaps reads; it is not read.`, name)
    return !empty
  })
  if (!usable.length) {
    if (label) add('warning', `${name} has only labels; it is not read as a layer.`, name)
    return null
  }
  const ordered = sortedRules(usable, add, name)
  warnOverlaps(ordered, add, name)
  return {
    id: safeLayerId(name, ids),
    name,
    geometry,
    fields: fieldsFromRules(ordered, label?.field),
    rules: ordered,
    ...(label ? { label } : {}),
  }
}

const describe = (filter: RuleFilter) =>
  filter.op === 'eq'
    ? `${filter.field} = ${filter.value}`
    : filter.op === 'in'
      ? `${filter.field} in ${filter.values.join(', ')}`
      : `${filter.field} ${filter.min ?? ''}–${filter.max ?? ''}`

function addPart(
  rule: Built,
  styleLayer: StyleLayerJson,
  color: unknown,
  geometry: string,
  add: Diagnose,
  subject: string,
) {
  const paint = styleLayer.paint ?? {}
  const layout = styleLayer.layout ?? {}
  const symbol = rule.symbol
  if (styleLayer.type === 'fill' && symbol.kind === 'area') {
    if (paint['fill-pattern'] !== undefined) {
      add('error', 'A fill pattern from the sprite is not read; choose a PGMaps hatch.', subject)
      return
    }
    if (symbol.fill) add('warning', 'A second fill on the same rule is not read.', subject)
    else {
      symbol.fill = colorOf(color, '#000000')
      const opacity = num(constant(paint['fill-opacity'], 'The fill opacity', add, subject), 1)
      if (opacity < 1) symbol.fillOpacity = round(opacity)
    }
    if (paint['fill-outline-color'] !== undefined)
      symbol.outline.push({
        color: colorOf(constant(paint['fill-outline-color'], 'The outline colour', add, subject), '#000000'),
        width: round(1 / PX_PER_PT),
      })
    return
  }
  if (styleLayer.type === 'line') {
    const stroke = lineStroke(styleLayer, color, add, subject)
    if (symbol.kind === 'area') {
      if (stroke.offset) add('warning', 'An outline offset is not read.', subject)
      const { offset: _offset, ...outline } = stroke
      void _offset
      symbol.outline.push(outline)
    } else if (symbol.kind === 'line') symbol.layers.push(stroke)
    return
  }
  if (styleLayer.type === 'circle' && symbol.kind === 'point') {
    const radius = num(constant(paint['circle-radius'], 'The circle radius', add, subject), 5)
    const strokeWidth = num(constant(paint['circle-stroke-width'], 'The circle outline width', add, subject), 0)
    Object.assign(symbol, {
      icon: 'dot',
      size: round((radius * 2) / 0.9 / PX_PER_PT),
      color: colorOf(color, '#000000'),
    })
    if (strokeWidth > 0) {
      symbol.halo = {
        color: colorOf(constant(paint['circle-stroke-color'], 'The circle outline colour', add, subject), '#000000'),
        width: round(strokeWidth / PX_PER_PT),
      }
      add('warning', 'A circle outline is read as a halo round the dot.', subject)
    }
    return
  }
  if (styleLayer.type === 'symbol' && layout['icon-image'] !== undefined) {
    add(
      'error',
      `The icon "${JSON.stringify(layout['icon-image']).slice(0, 60)}" comes from the style's sprite; a dot stands in for it. Choose a PGMaps icon.`,
      subject,
    )
    const size = num(constant(layout['icon-size'], 'The icon size', add, subject), 1) * 6
    if (symbol.kind === 'line')
      symbol.markers = [
        ...(symbol.markers ?? []),
        {
          icon: 'dot',
          size,
          color: '#000000',
          spacing: round(num(constant(layout['symbol-spacing'], 'The marker spacing', add, subject), 250) / PX_PER_PT),
        },
      ]
    else if (symbol.kind === 'point') Object.assign(symbol, { icon: 'dot', size, color: '#000000' })
    else add('warning', 'Icons on a polygon layer are not read.', subject)
    return
  }
  add('warning', `A ${styleLayer.type} layer on a ${geometry} source is not read.`, subject)
}

function readLabel(styleLayer: StyleLayerJson, add: Diagnose, subject: string): LabelStyle | null {
  const layout = styleLayer.layout ?? {}
  const paint = styleLayer.paint ?? {}
  const text = layout['text-field']
  const unwrap = (v: unknown): unknown =>
    Array.isArray(v) && (v[0] === 'to-string' || v[0] === 'coalesce') ? unwrap(v[1]) : v
  const inner = unwrap(text)
  const token = typeof text === 'string' ? /^\{([^{}]+)\}$/.exec(text) : null
  const field = token ? token[1] : fieldOf(inner, false)
  if (!field) {
    add('warning', 'A label made of an expression or fixed text is not read; PGMaps labels show one field.', subject)
    return null
  }
  const halo = num(constant(paint['text-halo-width'], 'The halo width', add, subject), 0)
  const font = constant(layout['text-font'], 'The font', add, subject)
  return {
    field,
    size: round(num(constant(layout['text-size'], 'The text size', add, subject), 16) / PX_PER_PT),
    color: colorOf(constant(paint['text-color'], 'The text colour', add, subject), '#000000'),
    ...(halo > 0
      ? {
          halo: {
            color: colorOf(constant(paint['text-halo-color'], 'The halo colour', add, subject), '#ffffff'),
            width: round(halo / PX_PER_PT),
          },
        }
      : {}),
    placement: layout['symbol-placement'] === 'line' || layout['symbol-placement'] === 'line-center' ? 'line' : 'point',
    ...(Array.isArray(font) && font.some((f) => /bold/i.test(String(f))) ? { bold: true } : {}),
  }
}

/** Largest style read. */
export const MAX_STYLE_JSON_BYTES = 64 * 1024 * 1024

/** The PGMaps layers a style's metadata names, when their style layers are unchanged. */
function trustedLayers(layers: StyleLayerJson[], add: Diagnose): { layers: StyledLayer[]; used: Set<StyleLayerJson> } {
  const used = new Set<StyleLayerJson>()
  const out: StyledLayer[] = []
  layers.forEach((styleLayer, index) => {
    const meta = (styleLayer.metadata ?? {})[MAPLIBRE_METADATA_KEY] as Json | undefined
    if (!meta || !meta.layer) return
    try {
      const layer = checkedLayer(meta.layer, checkedSheetSymbol)
      const labels = layers.some((l) => l.id === `${layer.id}-label`)
      const font = layers.find((l) => l.id === `${layer.id}-label`)?.layout?.['text-font']
      const fonts = Array.isArray(font) ? { regular: font as string[], bold: font as string[] } : undefined
      const expected = styleLayersFor(layer, () => undefined, { labels, fonts })
      const actual = layers.slice(index, index + expected.length).map(({ metadata: _m, ...rest }) => {
        void _m
        return rest
      })
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error('changed')
      layers.slice(index, index + expected.length).forEach((l) => used.add(l))
      out.push(layer)
    } catch {
      add(
        'info',
        `The style's PGMaps details for "${styleLayer.source}" no longer match its layers (it was edited); they are read from the layers.`,
      )
    }
  })
  return { layers: out, used }
}

/** Reads a MapLibre (or Mapbox GL) style v8, conservatively; every loss is a diagnostic. */
export function readMaplibreStyle(json: string): ReadResult {
  const { list, add } = diagnostics('maplibre')
  const result: ReadResult = { format: 'maplibre', layers: [], symbols: [], layouts: [], diagnostics: list }
  if (json.length > MAX_STYLE_JSON_BYTES) {
    add('error', `The style is larger than ${MAX_STYLE_JSON_BYTES / 1048576} MB.`)
    return result
  }
  let style: Json
  try {
    style = JSON.parse(json) as Json
  } catch {
    add('error', 'The file is not JSON.')
    return result
  }
  if (!style || typeof style !== 'object' || !Array.isArray(style.layers)) {
    add('error', 'The file is not a MapLibre style: it has no layers.')
    return result
  }
  if (style.version !== 8) add('warning', `Style version ${String(style.version)} is read as version 8.`)
  const layers = (style.layers as unknown[]).filter(
    (l): l is StyleLayerJson =>
      !!l && typeof l === 'object' && typeof (l as Json).id === 'string' && typeof (l as Json).type === 'string',
  )
  const trusted = trustedLayers(layers, add)
  result.layers.push(...trusted.layers)
  const ids = new Set(result.layers.map((l) => l.id))
  const groups = new Map<string, StyleLayerJson[]>()
  for (const layer of layers) {
    if (trusted.used.has(layer)) continue
    if (!['fill', 'line', 'circle', 'symbol'].includes(layer.type)) {
      add(
        layer.type === 'background' ? 'info' : 'warning',
        `The ${layer.type} layer "${layer.id}" is not read; PGMaps styles fill, line, circle and symbol layers.`,
      )
      continue
    }
    if (layer.type === 'fill' && Object.keys(layer.paint ?? {}).some((k) => k.startsWith('fill-extrusion'))) continue
    const key = layer['source-layer'] ? `${layer.source}/${layer['source-layer']}` : String(layer.source ?? layer.id)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(layer)
  }
  for (const [key, group] of groups) {
    const name = key.includes('/') ? key.slice(key.indexOf('/') + 1) : key
    // A source drawn as more than one geometry (roads and road areas) becomes one layer per geometry.
    const byGeometry = new Map<GeometryKind, StyleLayerJson[]>()
    const fallback: GeometryKind = group.some((l) => l.type === 'fill' && geometryTested(l.filter) !== 'line')
      ? 'polygon'
      : 'line'
    for (const layer of group) {
      const geometry =
        geometryTested(layer.filter) ??
        (layer.type === 'fill'
          ? 'polygon'
          : layer.type === 'circle'
            ? 'point'
            : layer.type === 'line'
              ? fallback
              : null)
      const kind =
        geometry ??
        (String((layer.layout ?? {})['symbol-placement'] ?? 'point').startsWith('line')
          ? 'line'
          : group.some((l) => l.type !== 'symbol')
            ? fallback
            : 'point')
      if (!byGeometry.has(kind)) byGeometry.set(kind, [])
      byGeometry.get(kind)!.push(layer)
    }
    for (const [geometry, layers] of byGeometry) {
      const named =
        byGeometry.size > 1
          ? `${name} (${geometry === 'polygon' ? 'areas' : geometry === 'line' ? 'lines' : 'points'})`
          : name
      const read = readGroup(named, layers, ids, add, geometry)
      if (read) result.layers.push(read)
    }
  }
  if (!result.layers.length && !list.some((d) => d.severity === 'error'))
    add('error', 'The style has no layer PGMaps can read.')
  return result
}
