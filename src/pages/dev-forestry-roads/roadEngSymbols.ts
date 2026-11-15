/**
 * How a RoadEng feature looks, read into PGMaps' layer looks and written back.
 *
 * Read from three places:
 *
 * 1. **Colours** as Windows COLORREF (`0x00BBGGRR`): a terrain feature's record (`.ter`, read as
 *    `RoadEngTerrainFeature.color`), and the INI format strings of the `.tlt`, `.dsn` and `.ilt`.
 * 2. **Format strings** (`FormatMajor=0,8355711,0,-1,0,-1,-16777216,-16777216,255,0[,0]`, and
 *    `IsectFormat`, `CutFormat`, `PlnLineType`, `TinDispDraw…`, `OptParms_Format-…`, …): ten or
 *    eleven integers ({@link parseRoadEngFormat}). Label formats (`[TerLabels] formatN=`) and
 *    background formats (`BckgrdFormat…`) are read for their colours, description and font.
 *    `[TerLayers] LayerN=pattern,description,` carries no look.
 * 3. **The line-type and symbol tables** of the `.ds3`/`.te1` (`roadEngSymbolTables.ts`).
 *
 * What each format field means:
 *
 * - Verified: field 1 is the line colour (the green optimiser lines, the grey contours, the blue
 *   boundary all match RoadEng's screens); −1 and the `0xFF000000` sentinel are "automatic".
 * - Inferred: field 0 is the line type (a user line's number: 1 and 3 where RoadEng draws its .1
 *   and .3 mm lines), field 2 the symbol (0 = none, n = the table's symbol n − 1; one sample
 *   has 14), field 3 the hatch (−1 =
 *   none; 2, 106 and 1002 in hatched cut, fill and mass-haul areas), field 5 the symbol colour,
 *   fields 6 and 7 the hatch fore- and background, field 8 an opacity (255). Fields 4, 9 and 10 are
 *   kept as read.
 * - A `.ter` type-58 attribute chunk is the same group per feature ({@link parseRoadEngFormatChunk}):
 *   line type at +0, colour at +4 (−1: the record's colour), symbol at +8, hatch at +12 and the
 *   symbol scale as an `f64` at +40 (1.0 in every sample). Inferred from two samples.
 *
 * Into PGMaps ({@link roadEngFeatureLook}): a feature's look is a `SymbolStyle`, the same type a
 * person sets on a reference layer, so the plan, the legend and the block sheet draw it through
 * the existing symbol modules (`referenceStyles.ts`, `mapSymbols.ts`), and nothing here draws.
 * Colour: the feature's own, else the format's. Line: the line type's main stroke (the item at
 * no offset, else the first) as a width in points and, when dashed, a custom dash in line widths
 * (MapLibre's `line-dasharray` unit). Repeated symbols become the nearest PGMaps line mark
 * (arrow, tick or dot). Points take PGMaps' own icon for the symbol's name ({@link
 * ROADENG_SYMBOL_ICONS}), sized to the symbol's drawn extent; Softree's drawings are never copied
 * into PGMaps' icon set. Every part a style cannot show (parallel strokes, text along a line, a
 * hatch pattern, a symbol with no matching icon) is listed in `left`.
 *
 * Back out ({@link roadEngLookFromStyle}): a style becomes a feature colour (COLORREF) and the
 * nearest line type and symbol of the file's own tables, which the terrain writer can put in the
 * record and a format chunk, and {@link setRoadEngIniValue} writes a changed format string into
 * the `.tlt` text, changing that one line.
 *
 * Pure: no DOM or network access.
 */
import {
  DASH_PATTERN_LIMITS,
  SYMBOL_SIZE_LIMITS,
  SYMBOL_WIDTH_LIMITS,
  symbolStyleForShape,
  type LineMarkerKind,
  type PointIcon,
  type SymbolStyle,
} from '@/lib/mapSheet/symbolStyle'
import type { ReferenceShape } from './referenceFeatures'
import type { ReferenceLayerStyle } from './referenceStyles'
import {
  roadEngLineTypeAt,
  roadEngSymbolAt,
  roadEngSymbolDrawing,
  type RoadEngLineType,
  type RoadEngLineTypeTable,
  type RoadEngSymbol,
  type RoadEngSymbolItem,
} from './roadEngSymbolTables'

/** Points per millimetre. */
export const PT_PER_MM = 72 / 25.4
/** COLORREF value RoadEng writes for "automatic" in the hatch colour fields. */
export const ROADENG_AUTO_COLOR = -16777216
/** Most reference layers made from one RoadEng file's looks (the project keeps 500 in all). */
export const MAX_ROADENG_STYLE_LAYERS = 200
/** Fill opacity given to a hatched RoadEng area, whose hatch pattern is not read. */
export const ROADENG_HATCH_OPACITY = 0.25
/** The reference-layer folder RoadEng terrain features are filed under. */
export const ROADENG_LAYER_FOLDER = 'RoadEng terrain'
/** Black as written: RoadEng reads COLORREF 0 as "no colour set", so black goes out as 0x010101. */
export const ROADENG_BLACK = 0x010101

// ---------------------------------------------------------------------------------------------
// Colours

/** A COLORREF as 0xRRGGBB, or null for "automatic" (negative or past 24 bits). */
export function rgbFromColorRef(ref: number): number | null {
  if (!Number.isInteger(ref) || ref < 0 || ref > 0xffffff) return null
  return ((ref & 0xff) << 16) | (ref & 0xff00) | ((ref >> 16) & 0xff)
}

/** 0xRRGGBB as a COLORREF; the inverse of {@link rgbFromColorRef}. */
export function colorRefFromRgb(rgb: number): number {
  return ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff)
}

export const hexFromRgb = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`
export function rgbFromHex(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw Error(`"${hex}" is not a #rrggbb colour.`)
  return parseInt(hex.slice(1), 16)
}
export const hexFromColorRef = (ref: number) => {
  const rgb = rgbFromColorRef(ref)
  return rgb === null ? null : hexFromRgb(rgb)
}
export const colorRefFromHex = (hex: string) => colorRefFromRgb(rgbFromHex(hex))

// ---------------------------------------------------------------------------------------------
// Format strings

export interface RoadEngFormat {
  lineType: number
  /** COLORREF; negative = automatic. */
  color: number
  symbol: number
  hatch: number
  symbolColor: number
  hatchForeground: number
  hatchBackground: number
  opacity: number
  /** Every token as read; fields not named above are written back from here. */
  tokens: string[]
}

const FORMAT_SHAPE = /^-?\d+(,-?\d+){9,10}$/
const FORMAT_FIELD_AT: Record<Exclude<keyof RoadEngFormat, 'tokens'>, number> = {
  lineType: 0,
  color: 1,
  symbol: 2,
  hatch: 3,
  symbolColor: 5,
  hatchForeground: 6,
  hatchBackground: 7,
  opacity: 8,
}

/** A feature format string, or null when the value is not one (ten or eleven integers). */
export function parseRoadEngFormat(value: string): RoadEngFormat | null {
  const v = value.trim()
  if (!FORMAT_SHAPE.test(v)) return null
  const tokens = v.split(',')
  const n = tokens.map(Number)
  if (!(n[8] >= 0 && n[8] <= 255)) return null
  return {
    lineType: n[0],
    color: n[1],
    symbol: n[2],
    hatch: n[3],
    symbolColor: n[5],
    hatchForeground: n[6],
    hatchBackground: n[7],
    opacity: n[8],
    tokens,
  }
}

/** The format as its string: named fields from the object, every other token as read. */
export function formatRoadEngFormat(format: RoadEngFormat): string {
  const tokens = [...format.tokens]
  while (tokens.length < 10) tokens.push('0')
  for (const [key, at] of Object.entries(FORMAT_FIELD_AT) as [keyof typeof FORMAT_FIELD_AT, number][]) {
    const value = format[key]
    if (!Number.isInteger(value)) throw Error(`A RoadEng format's ${key} must be a whole number.`)
    tokens[at] = String(value)
  }
  return tokens.join(',')
}

/** A label format (`[TerLabels]`/`[LocLabels] formatN=`): its colour, name and font. */
export interface RoadEngLabelFormat {
  color: number
  description: string
  font: { height: number; weight: number; italic: boolean; face: string } | null
  tokens: string[]
}

/** The label format, or null. The font is the last eleven fields, as `[Fonts]` spells one. */
export function parseRoadEngLabelFormat(value: string): RoadEngLabelFormat | null {
  const tokens = value.split(',')
  if (tokens.length < 14 || !/^-?\d+$/.test(tokens[1])) return null
  const f = tokens.slice(-11)
  const font =
    f.slice(0, 10).every((t) => /^-?\d+$/.test(t)) && f[10]
      ? { height: Number(f[0]), weight: Number(f[2]), italic: f[3] !== '0', face: f[10] }
      : null
  return { color: Number(tokens[1]), description: tokens[2], font, tokens }
}

/** Background formats carry colours at fields 3 and 13 (both the stock grey in every sample). */
export const ROADENG_BACKGROUND_COLOR_FIELDS = [3, 13] as const

export type RoadEngIniStyleKind = 'feature' | 'label' | 'background'

export interface RoadEngIniStyle {
  section: string
  key: string
  kind: RoadEngIniStyleKind
  value: string
  /** The format's colours as #rrggbb (automatic left out). */
  colors: string[]
  format?: RoadEngFormat
  label?: RoadEngLabelFormat
}

export interface RoadEngIniEntry {
  section: string
  key: string
  value: string
  /** Zero-based line number. */
  line: number
}

/** Every `key=value` line with its section, in file order (duplicates kept). */
export function readRoadEngIniEntries(text: string): RoadEngIniEntry[] {
  const entries: RoadEngIniEntry[] = []
  let section = ''
  text.split(/\r?\n/).forEach((raw, line) => {
    const head = /^\s*\[([^\]]*)\]\s*$/.exec(raw)
    if (head) section = head[1]
    else {
      const eq = raw.indexOf('=')
      if (eq > 0) entries.push({ section, key: raw.slice(0, eq).trim(), value: raw.slice(eq + 1), line })
    }
  })
  return entries
}

const FEATURE_KEY = /format|linetype|disp|^line\d|^border$/i
const LABEL_SECTION = /^(terlabels|loclabels)$/i

/** The looks an INI file (`.tlt`, `.dsn`, `.ilt`) sets, with each one's colours. */
export function readRoadEngIniStyles(text: string): RoadEngIniStyle[] {
  const styles: RoadEngIniStyle[] = []
  for (const { section, key, value } of readRoadEngIniEntries(text)) {
    if (/^BckgrdFormat\d*$/i.test(key)) {
      const t = value.split(',')
      const colors = ROADENG_BACKGROUND_COLOR_FIELDS.map((i) => hexFromColorRef(Number(t[i]))).filter(
        (c): c is string => c !== null,
      )
      styles.push({ section, key, kind: 'background', value, colors })
    } else if (LABEL_SECTION.test(section) && /^format\d+$/i.test(key)) {
      const label = parseRoadEngLabelFormat(value)
      if (label) {
        const c = hexFromColorRef(label.color)
        styles.push({ section, key, kind: 'label', value, colors: c ? [c] : [], label })
      }
    } else if (FEATURE_KEY.test(key)) {
      const format = parseRoadEngFormat(value)
      if (format) {
        const colors = [format.color, format.symbolColor, format.hatchForeground, format.hatchBackground]
          .map(hexFromColorRef)
          .filter((c): c is string => c !== null)
        styles.push({ section, key, kind: 'feature', value, colors: [...new Set(colors)], format })
      }
    }
  }
  return styles
}

/**
 * The INI text with one key's value replaced in its section (the first match, sections and keys
 * matched without case), or added at the end of the section, or in a new section at the end.
 * Every other byte, line endings included, is kept.
 */
export function setRoadEngIniValue(text: string, section: string, key: string, value: string): string {
  if (/[\r\n]/.test(value)) throw Error('An INI value cannot hold a line break.')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()
  let inSection = false
  let lastInSection = -1
  for (let i = 0; i < lines.length; i++) {
    const head = /^\s*\[([^\]]*)\]\s*$/.exec(lines[i])
    if (head) {
      inSection = same(head[1], section)
      if (inSection) lastInSection = i
      continue
    }
    if (!inSection) continue
    const eq = lines[i].indexOf('=')
    if (eq > 0 && same(lines[i].slice(0, eq).trim(), key)) {
      lines[i] = `${lines[i].slice(0, eq)}=${value}`
      return lines.join(eol)
    }
    if (lines[i].trim()) lastInSection = i
  }
  if (lastInSection >= 0) lines.splice(lastInSection + 1, 0, `${key}=${value}`)
  else {
    const at = lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
    lines.splice(at, 0, `[${section}]`, `${key}=${value}`)
  }
  return lines.join(eol)
}

// ---------------------------------------------------------------------------------------------
// The `.ter` format chunk (type 58)

/** Bytes of a type-58 payload the samples hold. */
export const ROADENG_FORMAT_CHUNK_BYTES = 56

export interface RoadEngFormatChunk {
  lineType: number
  /** COLORREF; −1: the feature record's colour. */
  color: number
  symbol: number
  hatch: number
  symbolScale: number
}

/** A type-58 chunk's payload (after the 16-byte chunk header), or null when it is too short. */
export function parseRoadEngFormatChunk(payload: Uint8Array): RoadEngFormatChunk | null {
  if (payload.length < 48) return null
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return {
    lineType: view.getInt32(0, true),
    color: view.getInt32(4, true),
    symbol: view.getInt32(8, true),
    hatch: view.getInt32(12, true),
    symbolScale: view.getFloat64(40, true),
  }
}

/** A copy of a type-58 payload with the given fields changed and every other byte kept. */
export function patchRoadEngFormatChunk(payload: Uint8Array, changes: Partial<RoadEngFormatChunk>): Uint8Array {
  if (payload.length < 48) throw Error('A RoadEng format chunk is at least 48 bytes.')
  const out = payload.slice()
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength)
  const int = (at: number, v: number | undefined) => {
    if (v === undefined) return
    if (!Number.isInteger(v)) throw Error('A RoadEng format chunk holds whole numbers.')
    view.setInt32(at, v, true)
  }
  int(0, changes.lineType)
  int(4, changes.color)
  int(8, changes.symbol)
  int(12, changes.hatch)
  if (changes.symbolScale !== undefined) view.setFloat64(40, changes.symbolScale, true)
  return out
}

// ---------------------------------------------------------------------------------------------
// Into PGMaps

/**
 * PGMaps' own icon for a RoadEng symbol, by the symbol's description (tested in order, without
 * case). Names only: the drawings stay the person's.
 */
export const ROADENG_SYMBOL_ICONS: readonly [RegExp, PointIcon][] = [
  [/^circle \(solid\)|^p\.i\./i, 'dot'],
  [/^circle \/w/i, 'plot-circle'],
  [/benchmark|monument|reference point/i, 'spot-height'],
  [/bridge/i, 'bridge'],
  [/tower/i, 'tower'],
  [/borrow pit|waste area/i, 'pit'],
  [/logged|tree/i, 'tree'],
  [/rock|boulder|slide|windfall|falling corner/i, 'warning'],
  [/^tick/i, 'cross'],
  [/culvert/i, 'culvert'],
  [/gate/i, 'gate'],
]

/** Block-sheet catalogue symbols that mean what a RoadEng symbol or line type means. */
export const ROADENG_CATALOGUE_MATCHES: readonly [RegExp, string][] = [
  [/borrow pit/i, 'gravel-pit'],
  [/swamp/i, 'wetland'],
  [/fenceline/i, 'fence'],
]

export interface RoadEngFeatureLookInput {
  shape: ReferenceShape
  /** The feature record's colour, 0xRRGGBB, or null when the record leaves it unset. */
  color: number | null
  /** The feature's format (a type-58 chunk, or the format string of the layer drawing it). */
  format?: Pick<RoadEngFormat, 'lineType' | 'color' | 'symbol' | 'hatch'> | null
}

export interface RoadEngFeatureLook {
  /** Only what RoadEng states; an empty style keeps PGMaps' layer default. */
  style: SymbolStyle
  lineType: RoadEngLineType | null
  symbol: RoadEngSymbol | null
  /** A block-sheet catalogue symbol of the same meaning, for the lead's choice of drawing. */
  catalogueId: string | null
  /** What the style cannot show, in plain words. */
  left: string[]
}

const snapWidth = (pt: number) => {
  const { min, max, step } = SYMBOL_WIDTH_LIMITS
  return Math.min(max, Math.max(min, Math.round(pt / step) * step))
}

/** The stroke a line type draws as: width in points, dash in line widths, the mark it repeats. */
export function roadEngLineTypeStyle(lineType: RoadEngLineType): { style: SymbolStyle; left: string[] } {
  const left: string[] = []
  const style: SymbolStyle = {}
  const main = lineType.lines.find((l) => l.offsetMm === 0) ?? lineType.lines[0]
  if (lineType.lines.length > 1)
    left.push(`"${lineType.description}" draws ${lineType.lines.length} parallel strokes; one is drawn.`)
  if (!main) left.push(`"${lineType.description}" has no stroke of its own; a thin line is drawn under its marks.`)
  const width = snapWidth((main?.widthMm ?? 0) * PT_PER_MM)
  style.width = width
  const dashes = main?.dashes ?? []
  if (!dashes.length) style.dash = 'solid'
  else {
    let pattern = dashes.flatMap((d) => [d.onMm, d.offMm]).map((v) => (v * PT_PER_MM) / width)
    const { minParts, maxParts, min, max } = DASH_PATTERN_LIMITS
    if (pattern.length > maxParts) {
      pattern = pattern.slice(0, maxParts)
      left.push(`"${lineType.description}" repeats ${dashes.length} dashes; the first ${maxParts / 2} are drawn.`)
    }
    const longest = Math.max(...pattern)
    if (longest > max) {
      pattern = pattern.map((v) => (v * max) / longest)
      left.push(`"${lineType.description}" has dashes longer than a line can draw; the pattern is shortened.`)
    }
    pattern = pattern.map((v) => Number(Math.min(max, Math.max(min, v)).toFixed(2)))
    if (pattern.length >= minParts) {
      style.dash = 'custom'
      style.dashPattern = pattern
    } else style.dash = 'solid'
  }
  const marker = lineMarker(lineType)
  if (marker) style.marker = marker
  else if (lineType.symbols.length) left.push(`"${lineType.description}" repeats a symbol PGMaps has no line mark for.`)
  if (lineType.texts.length)
    left.push(
      `"${lineType.description}" writes ${lineType.texts.map((t) => `"${t.text.trim()}"`).join(', ')} along the line.`,
    )
  return { style, left }
}

/** The PGMaps line mark nearest a line type's repeated symbol. */
function lineMarker(lineType: RoadEngLineType): LineMarkerKind | undefined {
  const item = lineType.symbols[0]
  if (!item) return undefined
  if (/arrow/i.test(lineType.description) || isArrowHead(item)) return 'arrow'
  const strokes = segments(item)
  if (strokes.length && strokes.every(([a, b]) => Math.abs(a.x - b.x) < 1e-9)) return 'tick'
  if (item.filled || isRound(item)) return 'dot'
  return undefined
}

const segments = (item: RoadEngSymbolItem) => {
  const out: [{ x: number; y: number }, { x: number; y: number }][] = []
  let at = { x: 0, y: 0 }
  for (const p of item.path) {
    if (p.draw) out.push([at, p])
    at = p
  }
  return out
}
const isArrowHead = (item: RoadEngSymbolItem) => {
  const corners = new Set(item.path.map((p) => `${p.x},${p.y}`))
  return item.filled && corners.size === 3
}
const isRound = (item: RoadEngSymbolItem) => {
  if (item.path.length < 8) return false
  const r = item.path.map((p) => Math.hypot(p.x, p.y))
  return Math.max(...r) - Math.min(...r) < 0.15 * Math.max(...r)
}

/** A point symbol as PGMaps' icon and size; the icon is null when no PGMaps icon means the same. */
export function roadEngSymbolStyle(symbol: RoadEngSymbol): { icon: PointIcon | null; size: number } {
  const icon = ROADENG_SYMBOL_ICONS.find(([re]) => re.test(symbol.description))?.[1] ?? null
  const { min, max } = SYMBOL_SIZE_LIMITS
  const size = Math.min(max, Math.max(min, Math.round(2 * roadEngSymbolDrawing(symbol).radiusMm * PT_PER_MM)))
  return { icon, size }
}

/**
 * A RoadEng feature's look as a PGMaps layer look. `tables` are the file's own (`.te1`/`.ds3`);
 * without them only the colour is read.
 */
export function roadEngFeatureLook(
  input: RoadEngFeatureLookInput,
  tables: { lineTypes: RoadEngLineTypeTable | null; symbols: readonly RoadEngSymbol[] | null },
): RoadEngFeatureLook {
  const left: string[] = []
  let style: SymbolStyle = {}
  const formatRgb = input.format ? rgbFromColorRef(input.format.color) : null
  const rgb = input.color ?? formatRgb
  if (rgb !== null) style.color = hexFromRgb(rgb)
  const lineType =
    input.format && input.shape !== 'point' ? roadEngLineTypeAt(tables.lineTypes, input.format.lineType) : null
  if (input.format && input.shape !== 'point' && !lineType && tables.lineTypes)
    left.push(`Line type ${input.format.lineType} is not in the file's table.`)
  if (lineType) {
    const read = roadEngLineTypeStyle(lineType)
    style = { ...read.style, ...style }
    if (lineType.color && style.color === undefined) {
      const own = rgbFromColorRef(lineType.color)
      if (own !== null) style.color = hexFromRgb(own)
    }
    left.push(...read.left)
  }
  // Symbol 0 is "none" in the format strings; a format chunk's symbol number counts the same way.
  const symbolIndex = input.format && input.format.symbol > 0 ? input.format.symbol - 1 : -1
  const symbol = input.shape === 'point' && symbolIndex >= 0 ? roadEngSymbolAt(tables.symbols, symbolIndex) : null
  if (symbol) {
    const { icon, size } = roadEngSymbolStyle(symbol)
    if (icon) style.icon = icon
    else left.push(`"${symbol.description}" has no PGMaps icon; the default point is drawn.`)
    style.size = size
  }
  if (input.shape === 'area') {
    if (input.format && input.format.hatch >= 0) {
      style.pattern = 'solid'
      style.opacity = ROADENG_HATCH_OPACITY
      left.push(`Hatch ${input.format.hatch} is drawn as a tint.`)
    } else if (input.format) style.noFill = true
  }
  const names = [symbol?.description, lineType?.description].filter((n): n is string => !!n)
  const catalogueId = ROADENG_CATALOGUE_MATCHES.find(([re]) => names.some((n) => re.test(n)))?.[1] ?? null
  return { style: symbolStyleForShape(style, input.shape), lineType, symbol, catalogueId, left }
}

// ---------------------------------------------------------------------------------------------
// Reference layers

export interface RoadEngStyledFeature {
  id: string
  /** The group it is filed under: its `.tlt` layer description, else its feature code. */
  group: string
  shape: ReferenceShape
  look: RoadEngFeatureLook
}

/** A group name as a layer file name: no folder separators, no dot the picker would read as an extension. */
const layerName = (s: string) =>
  s
    .replace(/[./\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'Features'

const lookKey = (shape: ReferenceShape, style: SymbolStyle) =>
  `${shape}|${JSON.stringify(Object.entries(style).sort(([a], [b]) => a.localeCompare(b)))}`

/**
 * Reference layers for RoadEng features: one per group and look, under {@link ROADENG_LAYER_FOLDER}.
 * A group whose features share a look is one layer named for the group; one with several looks
 * gets a layer per look, named for the group and the look's colour. Features over
 * {@link MAX_ROADENG_STYLE_LAYERS} layers stay in the plain folder layer with no look.
 */
export function roadEngReferenceLayers(features: readonly RoadEngStyledFeature[]): {
  /** Feature id → the `source` to give the reference feature. */
  layerOf: Map<string, string>
  styles: ReferenceLayerStyle[]
  notes: string[]
} {
  const byGroup = new Map<string, Map<string, RoadEngStyledFeature[]>>()
  for (const f of features) {
    const group = layerName(f.group)
    const looks = byGroup.get(group) ?? new Map<string, RoadEngStyledFeature[]>()
    const key = lookKey(f.shape, f.look.style)
    looks.set(key, [...(looks.get(key) ?? []), f])
    byGroup.set(group, looks)
  }
  const layerOf = new Map<string, string>()
  const styles: ReferenceLayerStyle[] = []
  const used = new Set<string>()
  let overflow = 0
  for (const [group, looks] of byGroup) {
    for (const members of looks.values()) {
      const { style } = members[0].look
      let name = group
      if (looks.size > 1) {
        const parts = [style.color, members[0].shape].filter(Boolean)
        name = `${group} (${parts.join(', ')})`
      }
      for (let n = 2; used.has(name); n++) name = `${group} ${n}`
      const key = `${ROADENG_LAYER_FOLDER}/${name}`.slice(0, 200)
      if (styles.length >= MAX_ROADENG_STYLE_LAYERS) {
        overflow += members.length
        for (const m of members) layerOf.set(m.id, ROADENG_LAYER_FOLDER)
        continue
      }
      used.add(name)
      for (const m of members) layerOf.set(m.id, key)
      if (Object.keys(style).length) styles.push({ layer: key, ...style })
    }
  }
  const notes = overflow
    ? [`${overflow} features are over ${MAX_ROADENG_STYLE_LAYERS} looks and are drawn in the folder's default look.`]
    : []
  return { layerOf, styles, notes }
}

// ---------------------------------------------------------------------------------------------
// Back out

export interface RoadEngLookOut {
  /** The feature record's colour (COLORREF), or null to keep the original. */
  colorRef: number | null
  /** A user line type of the file's table, or null to keep the original. */
  lineType: number | null
  /** A symbol number as formats count them (table index + 1), or null to keep the original. */
  symbol: number | null
  notes: string[]
}

/** How far a line type's stroke is from a style's: 0 when they draw alike. */
function strokeDistance(a: SymbolStyle, b: SymbolStyle): number {
  let d = Math.abs((a.width ?? 1) - (b.width ?? 1))
  const dashed = (s: SymbolStyle) => (s.dash ?? 'solid') !== 'solid'
  if (dashed(a) !== dashed(b)) d += 10
  else if (dashed(a)) {
    const pa = a.dashPattern ?? [],
      pb = b.dashPattern ?? []
    d += Math.abs(pa.length - pb.length) * 2
    for (let i = 0; i < Math.min(pa.length, pb.length); i++) d += Math.abs(pa[i] - pb[i]) / 4
  }
  if ((a.marker ?? null) !== (b.marker ?? null)) d += 5
  return d
}

/**
 * A layer look as RoadEng values: the colour as a COLORREF, the file's nearest line type for a
 * line or area and its first symbol with the same PGMaps icon for a point. A value the look does
 * not set is null, so the original stays.
 */
export function roadEngLookFromStyle(
  style: SymbolStyle,
  shape: ReferenceShape,
  tables: { lineTypes: RoadEngLineTypeTable | null; symbols: readonly RoadEngSymbol[] | null },
): RoadEngLookOut {
  const notes: string[] = []
  // RoadEng reads colour 0 as "unset": black is written one step off it.
  const exact = style.color ? colorRefFromHex(style.color) : null
  const colorRef = exact === 0 ? ROADENG_BLACK : exact
  let lineType: number | null = null
  const wantsStroke = style.dash !== undefined || style.width !== undefined || style.marker !== undefined
  if (shape !== 'point' && wantsStroke) {
    if (!tables.lineTypes) notes.push('The line style is not written: the project holds no RoadEng line-type table.')
    else {
      let best: { index: number; d: number } | null = null
      for (const candidate of tables.lineTypes.user) {
        if (candidate.texts.length) continue
        const d = strokeDistance(roadEngLineTypeStyle(candidate).style, style)
        if (!best || d < best.d) best = { index: candidate.index, d }
      }
      lineType = best?.index ?? null
    }
  }
  let symbol: number | null = null
  if (shape === 'point' && style.icon) {
    const match = tables.symbols?.find((s) => roadEngSymbolStyle(s).icon === style.icon)
    if (match) symbol = match.index + 1
    else notes.push(`No symbol in the file's table matches the ${style.icon} icon; the original symbol is kept.`)
  }
  return { colorRef, lineType, symbol, notes }
}

/** A format string with a look written into it: colour, line type and symbol where the look sets them. */
export function roadEngFormatWithStyle(
  format: RoadEngFormat,
  style: SymbolStyle,
  shape: ReferenceShape,
  tables: { lineTypes: RoadEngLineTypeTable | null; symbols: readonly RoadEngSymbol[] | null },
): { format: RoadEngFormat; notes: string[] } {
  const out = roadEngLookFromStyle(style, shape, tables)
  return {
    format: {
      ...format,
      ...(out.colorRef !== null ? { color: out.colorRef } : {}),
      ...(out.lineType !== null ? { lineType: out.lineType } : {}),
      ...(out.symbol !== null ? { symbol: out.symbol } : {}),
    },
    notes: out.notes,
  }
}
