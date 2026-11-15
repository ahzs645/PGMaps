/**
 * Softree RoadEng's private line-type and symbol tables, read from a Location's `.ds3` or a
 * terrain's `.te1`.
 *
 * Both files are AutoCAD R14 drawings (`AC1014`) with an empty model space. RoadEng keeps its own
 * tables in two XRECORD objects as text, each split into binary (group 310) chunks of at most 255
 * bytes: `RS 310`, `RC length`, the bytes. R13–R2000 drawings store objects uncompressed, so the
 * text is found by scanning the file for `<LINETYPETABLE>` and `<SYMBOLTABLE>` and following the
 * chunk run from the chunk that starts with it; the scan tries all eight bit alignments, because a
 * DWG object is a bit stream. No DWG library is needed: `@node-projects/acad-ts` reads the same
 * XRECORDs, and its dump of every sample matches this scan byte for byte.
 *
 * The text is one tag per line, CRLF-terminated: a container line `<TAG>`, a leaf
 * `<TAG>value</TAG>`, a closing line `</TAG>`. {@link parseRoadEngTableText} keeps it as a tree and
 * {@link writeRoadEngTableText} writes the identical bytes back.
 *
 * Read into types ({@link decodeRoadEngLineTypes}, {@link decodeRoadEngSymbols}). Units: lengths in
 * hundredths of a millimetre and line widths in tenths, as a printed map measures them.
 *
 * - **Verified** in every sample: the grammar; that each `LINEITEM` has 25 numbers and each drawn
 *   symbol item 8 + 3 × n; that the AutoCAD line types Softree copied in (`DASHED`, `HIDDEN`,
 *   `ACAD_ISO02W100`, …) carry AutoCAD's own dash lengths in 1/100 mm (DASHED 12.7 / 6.35 mm), and
 *   `HOT_WATER_SUPPLY`'s text spacing equals its dash plus gap (22.86 mm) with the text 0.7 of the
 *   way along, as AutoCAD's definition places it; that the item width in tenths of a millimetre
 *   matches every description (`Solid (.3 mm)` = 3, `Dash (1.4 mm)` = 14); that pen flag 0 moves
 *   and 1 draws (`Circle /w +` draws its cross as two separate strokes); and that every typed item
 *   writes back to its exact text ({@link encodeRoadEngLineItem} and friends).
 * - **Inferred** from the samples and the tutorial's description of the editors (an item has a
 *   scale, a fill, a perpendicular offset, a pen width, and is placed by distance or on the line's
 *   points): `LINEITEM` = width, offset, dash count, two unused numbers, ten dash lengths, ten gap
 *   lengths; a drawn symbol item `B` = scale, filled, pen width, spacing, phase (a fraction of the
 *   spacing), offset, placement, point count, then (x, y, pen) triples, y up; a text item = scale,
 *   angle in tenths of a degree, a flag, spacing, phase, offset, text. Placement 0 is by distance;
 *   otherwise bit 1 is the first point, 2 the last and 4 the points between (`dimension` = 3,
 *   `Arrows on points` = 6). Symbol coordinates are taken as 1/100 mm too, which makes the stock
 *   circle 2 mm across and the arrow head 2.4 mm long.
 * - **Not interpreted, kept as read**: `WIDTH`, `MAXLINE`/`MAXSYMBOL`/`MAXTEXT`, `ISYMBOL`,
 *   `DELETEPEN`, `B_FONT`, a text item's third number and a line item's fourth and fifth.
 *
 * Writing a changed table back into the drawing is not done: the drawing's object map and CRCs
 * would have to be rebuilt. A round-tripped project keeps the original `.ds3`/`.te1` bytes, and a
 * style PGMaps changes goes back through the feature colour and the format strings
 * (`roadEngSymbols.ts`).
 *
 * The drawings are the person's own file, read at run time. Nothing here stores Softree's symbols
 * or line types; tests build their own tables and read the samples in place.
 *
 * Pure: no DOM or network access.
 */

/** Largest `.ds3`/`.te1` read (the samples are 84–215 KB). */
export const MAX_ROADENG_SYMBOL_FILE_BYTES = 20_000_000
/** Largest table text accepted (the samples' are 26–50 KB). */
export const MAX_ROADENG_TABLE_TEXT_BYTES = 2_000_000
/** Most line types or symbols read from one table. */
export const MAX_ROADENG_TABLE_ENTRIES = 4096
/** Most items (line, symbol or text) in one entry. */
export const MAX_ROADENG_ENTRY_ITEMS = 64
/** Most points in one drawn item (the editor allows 20; the samples hold up to 19). */
export const MAX_ROADENG_ITEM_POINTS = 1000
/** Dash slots in a line item. */
export const ROADENG_LINE_DASH_SLOTS = 10
/** A line item's width unit, millimetres. */
export const ROADENG_WIDTH_UNIT_MM = 0.1
/** Every other length (offsets, dashes, spacing, symbol coordinates), millimetres. */
export const ROADENG_LENGTH_UNIT_MM = 0.01

const LINE_ITEM_FIELDS = 5 + 2 * ROADENG_LINE_DASH_SLOTS
const SYMBOL_ITEM_HEAD = 8
const TEXT_ITEM_HEAD = 6
const CHUNK_CODE = [0x36, 0x01] // group code 310, little-endian
const LINETYPE_ROOT = 'LINETYPETABLE'
const SYMBOL_ROOT = 'SYMBOLTABLE'

// ---------------------------------------------------------------------------------------------
// The drawing

export interface RoadEngTableTexts {
  /** The drawing's version string, e.g. `AC1014`. */
  version: string
  lineTypes: string | null
  symbols: string | null
  warnings: string[]
}

/** Whether the bytes start like a drawing this can read (`AC1012`–`AC1015`, R13 to 2000). */
export function isRoadEngSymbolFile(head: Uint8Array): boolean {
  const v = latin1(head.subarray(0, 6))
  return /^AC101[2-5]$/.test(v)
}

/** The two table texts from a `.ds3`/`.te1`; a table that is not there is null with a warning. */
export function extractRoadEngTableTexts(bytes: Uint8Array): RoadEngTableTexts {
  if (bytes.length > MAX_ROADENG_SYMBOL_FILE_BYTES)
    throw Error(`The symbol file is ${bytes.length.toLocaleString('en-CA')} bytes, over the limit.`)
  const version = latin1(bytes.subarray(0, 6))
  if (!isRoadEngSymbolFile(bytes))
    throw Error(
      `This is not a RoadEng symbol file: it starts "${version.replace(/[^\x20-\x7e]/g, '?')}", ` +
        'and only AutoCAD R13–2000 drawings (AC1012–AC1015) are read.',
    )
  const warnings: string[] = []
  const find = (root: string) => {
    const whole = (t: string) => t.trimEnd().endsWith(`</${root}>`)
    const texts = chunkRuns(bytes, `<${root}>`, whole).filter(whole)
    const distinct = [...new Set(texts)]
    if (!distinct.length) {
      warnings.push(`The file holds no ${root === LINETYPE_ROOT ? 'line-type' : 'symbol'} table.`)
      return null
    }
    if (distinct.length > 1)
      warnings.push(
        `The file holds ${distinct.length} different ${root === LINETYPE_ROOT ? 'line-type' : 'symbol'} tables; ` +
          'the first is read.',
      )
    return distinct[0]
  }
  return { version, lineTypes: find(LINETYPE_ROOT), symbols: find(SYMBOL_ROOT), warnings }
}

/** Every chunk run that starts with `marker`, at any bit alignment. */
function chunkRuns(bytes: Uint8Array, marker: string, complete: (text: string) => boolean): string[] {
  const needle = Uint8Array.from(marker, (c) => c.charCodeAt(0))
  const found: string[] = []
  for (let shift = 0; shift < 8; shift++) {
    const s = shift ? shifted(bytes, shift) : bytes
    for (let at = indexOf(s, needle, 3); at >= 0; at = indexOf(s, needle, at + 1)) {
      if (s[at - 3] !== CHUNK_CODE[0] || s[at - 2] !== CHUNK_CODE[1]) continue
      const parts: Uint8Array[] = []
      let size = 0
      for (let q = at - 3; q + 3 <= s.length && s[q] === CHUNK_CODE[0] && s[q + 1] === CHUNK_CODE[1]; ) {
        const length = s[q + 2]
        if (q + 3 + length > s.length) break
        parts.push(s.subarray(q + 3, q + 3 + length))
        size += length
        if (size > MAX_ROADENG_TABLE_TEXT_BYTES) throw Error('A RoadEng table is over the size limit.')
        q += 3 + length
      }
      found.push(parts.map(latin1).join(''))
    }
    // The other alignments are only searched when this one holds no whole table.
    if (found.some(complete)) break
  }
  return found
}

function shifted(bytes: Uint8Array, k: number): Uint8Array {
  const out = new Uint8Array(Math.max(0, bytes.length - 1))
  for (let i = 0; i < out.length; i++) out[i] = ((bytes[i] << k) | (bytes[i + 1] >> (8 - k))) & 0xff
  return out
}

function indexOf(hay: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0]
  outer: for (
    let i = hay.indexOf(first, from);
    i >= 0 && i + needle.length <= hay.length;
    i = hay.indexOf(first, i + 1)
  ) {
    for (let k = 1; k < needle.length; k++) if (hay[i + k] !== needle[k]) continue outer
    return i
  }
  return -1
}

/** Bytes as Latin-1, one character per byte, so the text writes back to the same bytes. */
function latin1(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000))
  return s
}

/** The text as the bytes RoadEng stores; a character outside Latin-1 is refused. */
export function roadEngTableBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c > 0xff) throw Error(`"${text[i]}" cannot be written into a RoadEng table.`)
    out[i] = c
  }
  return out
}

// ---------------------------------------------------------------------------------------------
// The tag text

export type RoadEngTableNode = { tag: string; value: string } | { tag: string; children: RoadEngTableNode[] }

export interface RoadEngTableTree {
  root: Extract<RoadEngTableNode, { children: RoadEngTableNode[] }>
  /** The line ending the text uses. */
  eol: '\r\n' | '\n'
}

const LEAF = /^<([A-Za-z_][A-Za-z0-9_]*)>(.*)<\/\1>$/
const OPEN = /^<([A-Za-z_][A-Za-z0-9_]*)>$/
const CLOSE = /^<\/([A-Za-z_][A-Za-z0-9_]*)>$/

/** The table text as a tree; anything off the grammar is an error naming the line. */
export function parseRoadEngTableText(text: string): RoadEngTableTree {
  if (text.length > MAX_ROADENG_TABLE_TEXT_BYTES) throw Error('A RoadEng table is over the size limit.')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(eol)
  if (lines[lines.length - 1] === '') lines.pop()
  const stack: Extract<RoadEngTableNode, { children: RoadEngTableNode[] }>[] = []
  let root: RoadEngTableTree['root'] | null = null
  lines.forEach((line, k) => {
    const where = `line ${k + 1} of the RoadEng table`
    const leaf = LEAF.exec(line)
    const open = leaf ? null : OPEN.exec(line)
    const close = leaf || open ? null : CLOSE.exec(line)
    if (leaf) {
      if (!stack.length) throw Error(`${where} is outside the table.`)
      stack[stack.length - 1].children.push({ tag: leaf[1], value: leaf[2] })
    } else if (open) {
      if (root && !stack.length) throw Error(`${where} starts a second table.`)
      const node = { tag: open[1], children: [] as RoadEngTableNode[] }
      if (stack.length) stack[stack.length - 1].children.push(node)
      else root = node
      stack.push(node)
    } else if (close) {
      const top = stack.pop()
      if (!top || top.tag !== close[1]) throw Error(`${where} closes <${close[1]}>, which is not open.`)
    } else throw Error(`${where} is not a tag: "${line.slice(0, 60)}".`)
  })
  if (!root || stack.length) throw Error('The RoadEng table is not closed.')
  return { root, eol }
}

/** The tree as text, byte for byte as it was read when nothing changed. */
export function writeRoadEngTableText(tree: RoadEngTableTree): string {
  const out: string[] = []
  const walk = (node: RoadEngTableNode) => {
    if ('value' in node) out.push(`<${node.tag}>${node.value}</${node.tag}>`)
    else {
      out.push(`<${node.tag}>`)
      node.children.forEach(walk)
      out.push(`</${node.tag}>`)
    }
  }
  walk(tree.root)
  return out.join(tree.eol) + tree.eol
}

// ---------------------------------------------------------------------------------------------
// Items

export interface RoadEngDash {
  onMm: number
  offMm: number
}

export interface RoadEngLineItem {
  widthMm: number
  /** Perpendicular offset from the feature's line; parallel lines have one each. */
  offsetMm: number
  /** Empty for a solid line. */
  dashes: RoadEngDash[]
  /** All 25 numbers as read; slots past the dash count keep whatever the file left there. */
  raw: number[]
}

export interface RoadEngPathPoint {
  /** Millimetres before the item's scale, y up. */
  x: number
  y: number
  /** false: move here; true: draw a line to here. */
  draw: boolean
}

export interface RoadEngSymbolItem {
  /** The item's leading letter: `B` (drawn) in every sample. */
  kind: string
  scale: number
  filled: boolean
  /** Pen width of the item's strokes (0 = the thinnest). */
  pen: number
  spacingMm: number
  /** Where the first copy falls, as a fraction of the spacing. */
  phase: number
  offsetMm: number
  /** 0: every `spacingMm`; otherwise bits 1 first point, 2 last point, 4 the points between. */
  placement: number
  path: RoadEngPathPoint[]
}

export interface RoadEngTextItem {
  scale: number
  angleDeg: number
  /** The third number, not interpreted (1 or 2 in the samples). */
  flag: number
  spacingMm: number
  phase: number
  offsetMm: number
  text: string
}

/** A Windows LOGFONT as the table spells it (`LFFACE`, `LFHEIG`, …), every field kept. */
export interface RoadEngFont {
  face: string
  /** Negative: character height in logical units (−34 throughout the samples). */
  height: number
  weight: number
  italic: boolean
  fields: Record<string, string>
}

const num = (token: string, where: string) => {
  const v = Number(token)
  if (token.trim() === '' || !Number.isFinite(v)) throw Error(`${where} has "${token}" where a number belongs.`)
  return v
}
/** A length in file units as millimetres, without float noise (2286 → 22.86). */
const mm = (units: number, unit: number) => Number((units * unit).toFixed(6))
const units = (mmValue: number, unit: number) => Number((mmValue / unit).toFixed(6))

export function decodeRoadEngLineItem(value: string, where = 'A line item'): RoadEngLineItem {
  const raw = value.split(',').map((t) => num(t, where))
  if (raw.length !== LINE_ITEM_FIELDS) throw Error(`${where} has ${raw.length} numbers, not ${LINE_ITEM_FIELDS}.`)
  const n = raw[2]
  if (!Number.isInteger(n) || n < 0 || n > ROADENG_LINE_DASH_SLOTS) throw Error(`${where} has ${n} dashes.`)
  const dashes = Array.from({ length: n }, (_, i) => ({
    onMm: mm(raw[5 + i], ROADENG_LENGTH_UNIT_MM),
    offMm: mm(raw[5 + ROADENG_LINE_DASH_SLOTS + i], ROADENG_LENGTH_UNIT_MM),
  }))
  return {
    widthMm: mm(raw[0], ROADENG_WIDTH_UNIT_MM),
    offsetMm: mm(raw[1], ROADENG_LENGTH_UNIT_MM),
    dashes,
    raw,
  }
}

export function encodeRoadEngLineItem(item: RoadEngLineItem): string {
  if (item.dashes.length > ROADENG_LINE_DASH_SLOTS) throw Error('A RoadEng line holds at most ten dashes.')
  const raw = item.raw.length === LINE_ITEM_FIELDS ? [...item.raw] : new Array<number>(LINE_ITEM_FIELDS).fill(0)
  raw[0] = units(item.widthMm, ROADENG_WIDTH_UNIT_MM)
  raw[1] = units(item.offsetMm, ROADENG_LENGTH_UNIT_MM)
  raw[2] = item.dashes.length
  item.dashes.forEach((d, i) => {
    raw[5 + i] = units(d.onMm, ROADENG_LENGTH_UNIT_MM)
    raw[5 + ROADENG_LINE_DASH_SLOTS + i] = units(d.offMm, ROADENG_LENGTH_UNIT_MM)
  })
  return raw.map(String).join(',')
}

export function decodeRoadEngSymbolItem(value: string, where = 'A symbol item'): RoadEngSymbolItem {
  const kind = /^[A-Za-z]*/.exec(value)![0]
  const t = value.slice(kind.length).split(',')
  const v = t.map((x) => num(x, where))
  if (v.length < SYMBOL_ITEM_HEAD) throw Error(`${where} is too short.`)
  const n = v[7]
  if (!Number.isInteger(n) || n < 0 || n > MAX_ROADENG_ITEM_POINTS) throw Error(`${where} has ${n} points.`)
  if (v.length !== SYMBOL_ITEM_HEAD + 3 * n) throw Error(`${where} has ${v.length} numbers for ${n} points.`)
  if (v[1] !== 0 && v[1] !== 1) throw Error(`${where} has fill ${v[1]}.`)
  const path: RoadEngPathPoint[] = []
  for (let k = 0; k < n; k++) {
    const [x, y, pen] = v.slice(SYMBOL_ITEM_HEAD + 3 * k, SYMBOL_ITEM_HEAD + 3 * k + 3)
    if (pen !== 0 && pen !== 1) throw Error(`${where} point ${k + 1} has pen ${pen}.`)
    path.push({ x: mm(x, ROADENG_LENGTH_UNIT_MM), y: mm(y, ROADENG_LENGTH_UNIT_MM), draw: pen === 1 })
  }
  return {
    kind,
    scale: v[0],
    filled: v[1] === 1,
    pen: v[2],
    spacingMm: mm(v[3], ROADENG_LENGTH_UNIT_MM),
    phase: v[4],
    offsetMm: mm(v[5], ROADENG_LENGTH_UNIT_MM),
    placement: v[6],
    path,
  }
}

export function encodeRoadEngSymbolItem(item: RoadEngSymbolItem): string {
  if (item.path.length > MAX_ROADENG_ITEM_POINTS) throw Error('A RoadEng symbol item has too many points.')
  const head = [
    item.scale,
    item.filled ? 1 : 0,
    item.pen,
    units(item.spacingMm, ROADENG_LENGTH_UNIT_MM),
    item.phase,
    units(item.offsetMm, ROADENG_LENGTH_UNIT_MM),
    item.placement,
    item.path.length,
  ]
  const points = item.path.flatMap((p) => [
    units(p.x, ROADENG_LENGTH_UNIT_MM),
    units(p.y, ROADENG_LENGTH_UNIT_MM),
    p.draw ? 1 : 0,
  ])
  return item.kind + [...head, ...points].map(String).join(',')
}

export function decodeRoadEngTextItem(value: string, where = 'A text item'): RoadEngTextItem {
  const t = value.split(',')
  if (t.length < TEXT_ITEM_HEAD + 1) throw Error(`${where} is too short.`)
  const v = t.slice(0, TEXT_ITEM_HEAD).map((x) => num(x, where))
  return {
    scale: v[0],
    angleDeg: v[1] / 10,
    flag: v[2],
    spacingMm: mm(v[3], ROADENG_LENGTH_UNIT_MM),
    phase: v[4],
    offsetMm: mm(v[5], ROADENG_LENGTH_UNIT_MM),
    text: t.slice(TEXT_ITEM_HEAD).join(','),
  }
}

export function encodeRoadEngTextItem(item: RoadEngTextItem): string {
  const head = [
    item.scale,
    Number((item.angleDeg * 10).toFixed(6)),
    item.flag,
    units(item.spacingMm, ROADENG_LENGTH_UNIT_MM),
    item.phase,
    units(item.offsetMm, ROADENG_LENGTH_UNIT_MM),
  ]
  return [...head.map(String), item.text].join(',')
}

// ---------------------------------------------------------------------------------------------
// The tables

export interface RoadEngLineType {
  /** `system` lines are RoadEng's own and fixed; `user` lines can be edited. */
  group: 'system' | 'user'
  /** Position within its group. */
  index: number
  description: string
  /** The `COLOR` field: 0 (every sample) draws in the feature's colour. */
  color: number
  lines: RoadEngLineItem[]
  symbols: RoadEngSymbolItem[]
  texts: RoadEngTextItem[]
  font: RoadEngFont | null
  /** Every leaf of the entry as read, items included, by tag. */
  fields: Record<string, string>
}

export interface RoadEngLineTypeTable {
  system: RoadEngLineType[]
  user: RoadEngLineType[]
}

export interface RoadEngSymbol {
  index: number
  description: string
  /** 0 draws in the feature's colour. */
  color: number
  scale: number
  penWidth: number
  rotatable: boolean
  scalable: boolean
  items: RoadEngSymbolItem[]
  texts: RoadEngTextItem[]
  font: RoadEngFont | null
  fields: Record<string, string>
}

export interface RoadEngSymbolTables {
  lineTypes: RoadEngLineTypeTable | null
  symbols: RoadEngSymbol[] | null
  warnings: string[]
}

const containers = (node: RoadEngTableNode) => ('children' in node ? node.children : [])
const leaves = (node: RoadEngTableNode) => {
  const fields: Record<string, string> = {}
  for (const child of containers(node)) if ('value' in child) fields[child.tag] = child.value
  return fields
}
const itemsOf = <T>(
  fields: Record<string, string>,
  prefix: string,
  decode: (v: string, where: string) => T,
  where: string,
) => {
  const keys = Object.keys(fields)
    .filter((k) => new RegExp(`^${prefix}\\d+$`).test(k))
    .sort((a, b) => Number(a.slice(prefix.length)) - Number(b.slice(prefix.length)))
  if (keys.length > MAX_ROADENG_ENTRY_ITEMS) throw Error(`${where} has more than ${MAX_ROADENG_ENTRY_ITEMS} items.`)
  return keys.map((k) => decode(fields[k], `${where} ${k}`))
}
const fontOf = (fields: Record<string, string>): RoadEngFont | null => {
  if (fields.LFFACE === undefined) return null
  const lf = Object.fromEntries(Object.entries(fields).filter(([k]) => k.startsWith('LF')))
  return {
    face: fields.LFFACE,
    height: Number(fields.LFHEIG ?? 0),
    weight: Number(fields.LFWEIG ?? 400),
    italic: Number(fields.LFITAL ?? 0) !== 0,
    fields: lf,
  }
}
const entryCount = (n: number) => {
  if (n > MAX_ROADENG_TABLE_ENTRIES) throw Error(`A RoadEng table has more than ${MAX_ROADENG_TABLE_ENTRIES} entries.`)
}

/** The line-type table's entries, system and user, in table order. */
export function decodeRoadEngLineTypes(tree: RoadEngTableTree): RoadEngLineTypeTable {
  if (tree.root.tag !== LINETYPE_ROOT) throw Error(`Expected <${LINETYPE_ROOT}>, found <${tree.root.tag}>.`)
  const table: RoadEngLineTypeTable = { system: [], user: [] }
  const entries = tree.root.children.filter((c) => 'children' in c && /^(SYSTEM|USER)\d+$/.test(c.tag))
  entryCount(entries.length)
  for (const node of entries) {
    const group = node.tag.startsWith('SYSTEM') ? 'system' : 'user'
    const index = Number(node.tag.replace(/^\D+/, ''))
    const fields = leaves(node)
    const where = `Line type ${node.tag}`
    table[group].push({
      group,
      index,
      description: fields.DESC ?? '',
      color: Number(fields.COLOR ?? 0),
      lines: itemsOf(fields, 'LINEITEM', decodeRoadEngLineItem, where),
      symbols: itemsOf(fields, 'SYMBOLITEM', decodeRoadEngSymbolItem, where),
      texts: itemsOf(fields, 'TEXTITEM', decodeRoadEngTextItem, where),
      font: fontOf(fields),
      fields,
    })
  }
  for (const list of [table.system, table.user]) list.sort((a, b) => a.index - b.index)
  return table
}

/** The symbol table's entries in table order. */
export function decodeRoadEngSymbols(tree: RoadEngTableTree): RoadEngSymbol[] {
  if (tree.root.tag !== SYMBOL_ROOT) throw Error(`Expected <${SYMBOL_ROOT}>, found <${tree.root.tag}>.`)
  const entries = tree.root.children.filter((c) => 'children' in c && /^SYMBOL\d+$/.test(c.tag))
  entryCount(entries.length)
  return entries
    .map((node) => {
      const fields = leaves(node)
      const where = `Symbol ${node.tag}`
      return {
        index: Number(node.tag.slice(6)),
        description: fields.DESC ?? '',
        color: Number(fields.COLOR ?? 0),
        scale: Number(fields.SCALE ?? 1),
        penWidth: Number(fields.PENWIDTH ?? 0),
        rotatable: Number(fields.ROTATABLE ?? 0) !== 0,
        scalable: Number(fields.SCALABLE ?? 0) !== 0,
        items: itemsOf(fields, 'SYMBOLITEM', decodeRoadEngSymbolItem, where),
        texts: itemsOf(fields, 'TEXTITEM', decodeRoadEngTextItem, where),
        font: fontOf(fields),
        fields,
      }
    })
    .sort((a, b) => a.index - b.index)
}

/** Both tables from a `.ds3`/`.te1`, each null (with a warning) when the file lacks it. */
export function readRoadEngSymbolFile(bytes: Uint8Array): RoadEngSymbolTables {
  const texts = extractRoadEngTableTexts(bytes)
  return {
    lineTypes: texts.lineTypes === null ? null : decodeRoadEngLineTypes(parseRoadEngTableText(texts.lineTypes)),
    symbols: texts.symbols === null ? null : decodeRoadEngSymbols(parseRoadEngTableText(texts.symbols)),
    warnings: texts.warnings,
  }
}

/**
 * The line type a format's line-type number names: the n-th user line. The format strings in the
 * samples use 0–7, matching the stock user lines by width (`IsectFormat` 1 = `Solid (.1 mm)`,
 * `SecLLineFormat` 3 = `Solid (.3 mm)`); larger numbers (1045 in one sample) are not resolved.
 */
export function roadEngLineTypeAt(table: RoadEngLineTypeTable | null, index: number): RoadEngLineType | null {
  return table?.user.find((l) => l.index === index) ?? null
}

/** The n-th symbol of the table, or null. */
export function roadEngSymbolAt(symbols: readonly RoadEngSymbol[] | null, index: number): RoadEngSymbol | null {
  return symbols?.find((s) => s.index === index) ?? null
}

// ---------------------------------------------------------------------------------------------
// Drawing a symbol

export interface RoadEngSymbolDrawing {
  /** SVG `viewBox` in millimetres, y down, centred on the symbol's insertion point. */
  viewBox: [number, number, number, number]
  parts: { d: string; filled: boolean; penWidth: number }[]
  texts: { text: string; x: number; y: number; sizeMm: number; angleDeg: number }[]
  /** Half the larger extent from the insertion point, millimetres. */
  radiusMm: number
}

/**
 * A symbol's items as SVG paths in millimetres (y flipped to point down), scaled by the item's and
 * the symbol's scale. For showing the person's own symbol where they choose to; the plan draws
 * PGMaps' icons by default (`roadEngSymbols.ts`).
 */
export function roadEngSymbolDrawing(
  symbol: Pick<RoadEngSymbol, 'items' | 'texts' | 'scale' | 'font'>,
): RoadEngSymbolDrawing {
  let r = 0
  const f = (n: number) => Number(n.toFixed(4))
  const parts = symbol.items.map((item) => {
    const k = item.scale * symbol.scale
    const d = item.path
      .map((p) => {
        r = Math.max(r, Math.abs(p.x * k), Math.abs(p.y * k))
        return `${p.draw ? 'L' : 'M'}${f(p.x * k)} ${f(-p.y * k)}`
      })
      .join(' ')
      // A path that opens with a draw starts at the insertion point, as the editor's pen does.
      .replace(/^L/, 'M0 0 L')
    return { d: item.filled ? `${d} Z` : d, filled: item.filled, penWidth: item.pen }
  })
  // Text height: the LOGFONT height in logical units read as tenths of a millimetre (−34 → 3.4 mm).
  const fontMm = symbol.font ? Math.abs(symbol.font.height) / 10 : 3.4
  const texts = symbol.texts.map((t) => {
    const sizeMm = f(fontMm * t.scale * symbol.scale)
    r = Math.max(r, sizeMm / 2)
    return { text: t.text, x: 0, y: f(-t.offsetMm), sizeMm, angleDeg: t.angleDeg }
  })
  const half = r || 1
  return { viewBox: [-half, -half, 2 * half, 2 * half], parts, texts, radiusMm: f(r) }
}
