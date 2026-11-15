/**
 * AutoCAD DXF drawings read as plan features, in the drawing's own coordinates and units.
 *
 * Written here from Autodesk's public DXF reference (_AutoCAD Release 12 DXF reference_ and the
 * _DXF Reference_ for AutoCAD 2012–2018): the ASCII group-code format of R12 (AC1009) through 2018
 * (AC1032). It reads the HEADER (`$ACADVER`, `$INSUNITS`, `$EXTMIN`/`$EXTMAX`), the LAYER table
 * (name, colour, off, frozen), BLOCKS and the model-space ENTITIES:
 *
 * - POINT, LINE, LWPOLYLINE (bulges densified as arcs), POLYLINE/VERTEX/SEQEND (2D with bulges and
 *   3D; polyface and polygon meshes are skipped), ARC, CIRCLE, ELLIPSE, SPLINE (its fit points, else
 *   a sampled B-spline from its control points, knots and weights);
 * - TEXT and MTEXT as labelled points, MTEXT formatting codes stripped;
 * - INSERT expanded through its block (insertion point, scale, rotation, MINSERT arrays), nested to
 *   {@link DXF_MAX_INSERT_DEPTH}; attributes are not read.
 *
 * Everything else (3DFACE, SOLID, HATCH, DIMENSION, …), paper space (group 67 = 1), invisible
 * entities and entities on off or frozen layers are left out and counted in `skipped`. Entity
 * coordinate systems (OCS, extrusion 210/220/230) are resolved with the arbitrary axis algorithm.
 *
 * Nothing here decides what a feature is or where the drawing is: a DXF states no coordinate system,
 * so the caller places it. Only a ring the drawing itself closes (closed flag, circle, full ellipse,
 * closed spline) becomes a polygon; a ring of separate lines stays a line.
 *
 * Pure: no DOM or network access. Binary DXF is refused.
 */

export type XYZ = [number, number, number]
export type DxfShape = 'point' | 'line' | 'polygon'

/** Longest text this reader takes, in characters (the spatial import's byte limit). */
export const DXF_MAX_BYTES = 120_000_000
/** Most entities read, counting every copy an INSERT makes. */
export const DXF_MAX_ENTITIES = 250_000
/** Most vertices produced, after arcs and splines are densified. */
export const DXF_MAX_VERTICES = 2_000_000
/** Deepest chain of blocks inserted in blocks; deeper ones (or a block inserting itself) are skipped. */
export const DXF_MAX_INSERT_DEPTH = 8
/** Most copies one MINSERT array makes. */
export const DXF_MAX_INSERT_CELLS = 10_000
/** Arcs, circles, ellipses and bulges are drawn with a vertex at least every this many degrees. */
export const DXF_ARC_SEGMENT_DEGREES = 2
/** Vertices per knot span of a B-spline drawn from its control points. */
export const DXF_SPLINE_SEGMENTS_PER_SPAN = 8
/** Line pieces on one layer whose ends meet within this distance are joined, in metres. */
export const DXF_JOIN_TOLERANCE_M = 0.005

/** `$INSUNITS` codes with a length: metres per drawing unit. 0 (unitless) and other codes state no usable length. */
export const DXF_UNITS: Readonly<Record<number, { name: string; metres: number }>> = {
  1: { name: 'inches', metres: 0.0254 },
  2: { name: 'feet', metres: 0.3048 },
  3: { name: 'miles', metres: 1609.344 },
  4: { name: 'millimetres', metres: 0.001 },
  5: { name: 'centimetres', metres: 0.01 },
  6: { name: 'metres', metres: 1 },
  7: { name: 'kilometres', metres: 1000 },
  10: { name: 'yards', metres: 0.9144 },
  14: { name: 'decimetres', metres: 0.1 },
  21: { name: 'US survey feet', metres: 1200 / 3937 },
}

/**
 * Layers PGMaps' own DXF export (`dxfExport.ts`) draws the profile and cross-sections on, in their
 * own true-scale frames below the plan. Their coordinates are chainage and offset, not the map.
 */
export const PGMAPS_DXF_FRAME_LAYERS: ReadonlySet<string> = new Set([
  'PROF_GROUND',
  'PROF_DESIGN',
  'PROF_GRID',
  'PROF_TEXT',
  'SECT_GROUND',
  'SECT_DESIGN',
  'SECT_GRID',
  'SECT_TEXT',
])

export interface DxfLayer {
  name: string
  /** AutoCAD colour index, 1–255; null when the table gives none. */
  colour: number | null
  off: boolean
  frozen: boolean
}

export interface DxfFeature {
  shape: DxfShape
  /** Positions in drawing units: x, y, z. A polygon's ring is closed (last equals first). */
  points: XYZ[]
  /** The layer it is drawn on (a block's layer-0 entity takes the INSERT's layer). */
  layer: string
  /** The DXF entity type, e.g. `LWPOLYLINE`; joined pieces list theirs, `LINE+ARC`. */
  entity: string
  /** The text of a TEXT or MTEXT, else the model-space INSERT's block name, else the layer. */
  name: string
  /** Resolved AutoCAD colour index (BYLAYER and BYBLOCK followed); null when nothing gives one. */
  colour: number | null
  /** True colour (group 420) as `#rrggbb`, when the entity has one. */
  rgb?: string
  /** Label text, with MTEXT formatting removed; paragraphs are kept as line breaks. */
  text?: string
  /** Block name of the model-space INSERT this came from. */
  block?: string
}

export interface DxfDrawing {
  /** `$ACADVER`, e.g. `AC1009` (R12) or `AC1032` (2018). */
  version: string | null
  /** `$INSUNITS` as written; null when the header has none. */
  insUnits: number | null
  /** Metres per drawing unit from `$INSUNITS`; null when unstated (0, absent) or not a length. */
  unitM: number | null
  unitName: string | null
  /** `$EXTMIN`/`$EXTMAX`, as the header states them (often stale; not used for placement). */
  extents: { min: XYZ; max: XYZ } | null
  layers: DxfLayer[]
  /** Layers that are off or frozen and held entities, which were left out. */
  hiddenLayers: string[]
  /** Group 999 comments. */
  comments: string[]
  features: DxfFeature[]
  /** What was not read, by entity type or reason (`paperSpace`, `hiddenLayer`, `polyfaceMesh`, …). */
  skipped: Record<string, number>
}

/** A DXF this reader cannot read; the message says why, without the file's name. */
export class DxfError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DxfError'
  }
}

const BINARY_SENTINEL = 'AutoCAD Binary DXF'

/** True when the bytes are a binary DXF, which this reader refuses. */
export function isBinaryDxf(bytes: Uint8Array): boolean {
  if (bytes.length < BINARY_SENTINEL.length) return false
  for (let i = 0; i < BINARY_SENTINEL.length; i++) if (bytes[i] !== BINARY_SENTINEL.charCodeAt(i)) return false
  return true
}

/** True when the text opens with DXF group pairs: optional 999 comments, then `0` / `SECTION`. */
export function isDxfText(text: string): boolean {
  const lines = text.slice(0, 8192).split(/\r\n|\r|\n/)
  let i = 0
  while (i < lines.length && lines[i].trim() === '') i++
  while (i + 1 < lines.length) {
    const code = lines[i].trim()
    if (code === '999') {
      i += 2
      continue
    }
    return code === '0' && lines[i + 1].trim() === 'SECTION'
  }
  return false
}

/**
 * The text of a DXF file. Drawings from AutoCAD 2007 (AC1021) on are UTF-8; older ones are in the
 * code page `$DWGCODEPAGE` names, read as Windows-1252 when that page is not one the decoder knows.
 */
export function decodeDxfBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  if (!utf8.includes('�')) return utf8
  const head = utf8.slice(0, 50_000)
  const version = /\$ACADVER\s*[\r\n]+\s*1\s*[\r\n]+\s*(AC\d{4})/.exec(head)?.[1]
  if (version && version >= 'AC1021') return utf8
  const page = /\$DWGCODEPAGE\s*[\r\n]+\s*3\s*[\r\n]+\s*ANSI_(\d+)/i.exec(head)?.[1] ?? '1252'
  try {
    return new TextDecoder(`windows-${page}`).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

// --- group pairs -----------------------------------------------------------------------------------

type Pair = [code: number, value: string]
interface Rec {
  type: string
  pairs: Pair[]
}

function readPairs(text: string): Pair[] {
  const lines = text.split(/\r\n|\r|\n/)
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()
  let start = 0
  while (start < lines.length && lines[start].trim() === '') start++
  if ((lines.length - start) % 2 !== 0) {
    // A file that ends on a group code with no value was cut short.
    throw new DxfError('it ends in the middle of a group code pair; the file is incomplete.')
  }
  const pairs: Pair[] = []
  for (let i = start; i < lines.length; i += 2) {
    const code = lines[i].trim()
    if (!/^-?\d+$/.test(code))
      throw new DxfError(`line ${i + 1} should hold a group code but reads "${code.slice(0, 24)}".`)
    pairs.push([Number(code), lines[i + 1]])
  }
  return pairs
}

/** Pairs from `from` up to `to`, split into records at each group code 0. */
function records(pairs: Pair[], from: number, to: number): Rec[] {
  const out: Rec[] = []
  let current: Rec | null = null
  for (let i = from; i < to; i++) {
    const [code, value] = pairs[i]
    if (code === 0) {
      current = { type: value.trim().toUpperCase(), pairs: [] }
      out.push(current)
    } else if (current) current.pairs.push(pairs[i])
  }
  return out
}

const valueOf = (r: Rec, code: number) => r.pairs.find((p) => p[0] === code)?.[1]
function numberOf(r: Rec, code: number, fallback: number): number {
  const value = valueOf(r, code)
  if (value === undefined) return fallback
  const n = Number(value.trim())
  return Number.isFinite(n) ? n : fallback
}
const pointOf = (r: Rec, code: number, fallback: XYZ = [0, 0, 0]): XYZ => [
  numberOf(r, code, fallback[0]),
  numberOf(r, code + 10, fallback[1]),
  numberOf(r, code + 20, fallback[2]),
]

// --- transformations -------------------------------------------------------------------------------

/** A 3×4 affine matrix, row-major: x' = m0 x + m1 y + m2 z + m3, and so on. */
type Matrix = number[]
const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]
const apply = (m: Matrix, [x, y, z]: XYZ): XYZ => [
  m[0] * x + m[1] * y + m[2] * z + m[3],
  m[4] * x + m[5] * y + m[6] * z + m[7],
  m[8] * x + m[9] * y + m[10] * z + m[11],
]
/** `a` after `b`. */
function multiply(a: Matrix, b: Matrix): Matrix {
  const out: number[] = []
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 4; col++)
      out.push(
        a[row * 4] * b[col] +
          a[row * 4 + 1] * b[4 + col] +
          a[row * 4 + 2] * b[8 + col] +
          (col === 3 ? a[row * 4 + 3] : 0),
      )
  return out
}
const translate = ([x, y, z]: XYZ): Matrix => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z]
const scale = (sx: number, sy: number, sz: number): Matrix => [sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, sz, 0]
function rotateZ(degrees: number): Matrix {
  const a = (degrees * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a)
  return [c, -s, 0, 0, s, c, 0, 0, 0, 0, 1, 0]
}
const cross = (a: XYZ, b: XYZ): XYZ => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
function unit(v: XYZ): XYZ | null {
  const length = Math.hypot(v[0], v[1], v[2])
  return length > 0 && Number.isFinite(length) ? [v[0] / length, v[1] / length, v[2] / length] : null
}
const extrusionOf = (r: Rec): XYZ => unit(pointOf(r, 210, [0, 0, 1])) ?? [0, 0, 1]

/** Object coordinates to world coordinates, by the DXF reference's arbitrary axis algorithm; null for the world plane. */
function ocsMatrix(normal: XYZ): Matrix | null {
  if (Math.abs(normal[0]) < 1e-12 && Math.abs(normal[1]) < 1e-12 && normal[2] > 0) return null
  const ax = unit(
    Math.abs(normal[0]) < 1 / 64 && Math.abs(normal[1]) < 1 / 64 ? cross([0, 1, 0], normal) : cross([0, 0, 1], normal),
  )!
  const ay = cross(normal, ax)
  return [ax[0], ay[0], normal[0], 0, ax[1], ay[1], normal[1], 0, ax[2], ay[2], normal[2], 0]
}

// --- curves ----------------------------------------------------------------------------------------

const STEP = (DXF_ARC_SEGMENT_DEGREES * Math.PI) / 180

/** Points along a circular arc in its plane, counter-clockwise from `start` through `sweep` radians. */
function arc(centre: XYZ, radius: number, start: number, sweep: number): XYZ[] {
  const n = Math.max(1, Math.ceil(Math.abs(sweep) / STEP - 1e-9))
  const points = Array.from({ length: n + 1 }, (_, i): XYZ => {
    const a = start + (sweep * i) / n
    return [centre[0] + radius * Math.cos(a), centre[1] + radius * Math.sin(a), centre[2]]
  })
  // A full turn ends exactly where it began, not a rounding error away.
  if (Math.abs(sweep) >= 2 * Math.PI - 1e-12) points[n] = [...points[0]]
  return points
}

interface BulgeVertex {
  x: number
  y: number
  z: number
  bulge: number
}
/**
 * A polyline's points with every bulged segment drawn as its arc. A bulge is tan(θ/4) of the
 * segment's included angle, positive counter-clockwise; heights run linearly along a segment.
 */
function bulgedPoints(vertices: BulgeVertex[], closed: boolean): XYZ[] {
  if (!vertices.length) return []
  const out: XYZ[] = [[vertices[0].x, vertices[0].y, vertices[0].z]]
  const segments = closed ? vertices.length : vertices.length - 1
  for (let i = 0; i < segments; i++) {
    const a = vertices[i],
      b = vertices[(i + 1) % vertices.length]
    const dx = b.x - a.x,
      dy = b.y - a.y,
      chord = Math.hypot(dx, dy)
    if (Math.abs(a.bulge) > 1e-12 && chord > 0 && Number.isFinite(a.bulge)) {
      const theta = 4 * Math.atan(a.bulge)
      const k = (1 - a.bulge * a.bulge) / (4 * a.bulge)
      const centre: XYZ = [a.x + dx / 2 - k * dy, a.y + dy / 2 + k * dx, 0]
      const radius = Math.hypot(a.x - centre[0], a.y - centre[1])
      const start = Math.atan2(a.y - centre[1], a.x - centre[0])
      const points = arc(centre, radius, start, theta)
      for (let j = 1; j < points.length - 1; j++)
        out.push([points[j][0], points[j][1], a.z + ((b.z - a.z) * j) / (points.length - 1)])
    }
    out.push([b.x, b.y, b.z])
  }
  return out
}

function clampedKnots(count: number, degree: number): number[] {
  const knots: number[] = []
  for (let i = 0; i <= degree; i++) knots.push(0)
  for (let i = 1; i < count - degree; i++) knots.push(i)
  for (let i = 0; i <= degree; i++) knots.push(count - degree)
  return knots
}

/** A (rational) B-spline sampled {@link DXF_SPLINE_SEGMENTS_PER_SPAN} times per knot span, by de Boor's algorithm. */
export function bSplinePoints(control: XYZ[], degreeIn: number, knotsIn: number[], weightsIn: number[] = []): XYZ[] {
  const n = control.length
  if (n < 2) return control.slice()
  const p = Math.max(1, Math.min(Math.round(degreeIn) || 3, n - 1))
  const valid =
    knotsIn.length === n + p + 1 && knotsIn.every((k, i) => Number.isFinite(k) && (i === 0 || k >= knotsIn[i - 1]))
  const knots = valid ? knotsIn : clampedKnots(n, p)
  const weights = weightsIn.length === n && weightsIn.every((w) => w > 0 && Number.isFinite(w)) ? weightsIn : null
  const at = (span: number, u: number): XYZ => {
    const d = Array.from({ length: p + 1 }, (_, j) => {
      const c = control[j + span - p],
        w = weights ? weights[j + span - p] : 1
      return [c[0] * w, c[1] * w, c[2] * w, w]
    })
    for (let r = 1; r <= p; r++)
      for (let j = p; j >= r; j--) {
        const lo = knots[j + span - p],
          hi = knots[j + 1 + span - r]
        const alpha = hi - lo > 0 ? (u - lo) / (hi - lo) : 0
        d[j] = d[j].map((value, k) => (1 - alpha) * d[j - 1][k] + alpha * value)
      }
    const [x, y, z, w] = d[p]
    return [x / w, y / w, z / w]
  }
  const out: XYZ[] = []
  for (let span = p; span < n; span++) {
    const a = knots[span],
      b = knots[span + 1]
    if (!(b > a)) continue
    for (let s = out.length ? 1 : 0; s <= DXF_SPLINE_SEGMENTS_PER_SPAN; s++)
      out.push(at(span, a + ((b - a) * s) / DXF_SPLINE_SEGMENTS_PER_SPAN))
  }
  return out.length ? out : [control[0], control[n - 1]]
}

// --- text ------------------------------------------------------------------------------------------

const unicodeEscapes = (value: string) =>
  value.replace(/\\U\+([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))

/** TEXT control codes: %%d degree, %%p plus/minus, %%c diameter, %%nnn a character; underline and overline toggles dropped. */
export function plainText(value: string): string {
  return unicodeEscapes(value)
    .replace(/%%(\d{3})/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[cC]/g, '⌀')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%%/g, '%')
}

/**
 * MTEXT without its formatting codes: `\P` is a line break, `\~` a space, `\S a^b;` stacked text
 * `a/b`; font, height, width, colour, tracking, oblique and alignment codes and grouping braces go.
 */
export function plainMText(value: string): string {
  const source = unicodeEscapes(value)
  let out = ''
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '{' || c === '}') continue
    if (c !== '\\') {
      out += c
      continue
    }
    const code = source[i + 1]
    if (code === undefined) break
    i++
    if (code === 'P' || code === 'X') out += '\n'
    else if (code === '~') out += ' '
    else if (code === '\\' || code === '{' || code === '}') out += code
    else if (code === 'S') {
      const end = source.indexOf(';', i + 1)
      const stacked = source.slice(i + 1, end < 0 ? undefined : end)
      out += stacked.replace(/[\^#]/g, '/')
      i = end < 0 ? source.length : end
    } else if ('fFHWQTACcp'.includes(code)) {
      const end = source.indexOf(';', i + 1)
      i = end < 0 ? source.length : end
    }
    // \L \l \O \o \K \k \N: toggles with no argument.
  }
  return out
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .trim()
}

// --- reading ---------------------------------------------------------------------------------------

interface Block {
  name: string
  base: XYZ
  xref: boolean
  entities: Entity[]
}
interface Entity {
  rec: Rec
  vertices?: Rec[]
}
interface Piece {
  shape: DxfShape
  points: XYZ[]
  text?: string
}

/** Records grouped into entities: a POLYLINE takes its VERTEX records, an INSERT its ATTRIBs, up to SEQEND. */
function assemble(recs: Rec[]): Entity[] {
  const out: Entity[] = []
  for (let i = 0; i < recs.length; i++) {
    const rec = recs[i]
    if (rec.type === 'POLYLINE') {
      const vertices: Rec[] = []
      while (i + 1 < recs.length && recs[i + 1].type === 'VERTEX') vertices.push(recs[++i])
      if (i + 1 < recs.length && recs[i + 1].type === 'SEQEND') i++
      out.push({ rec, vertices })
    } else if (rec.type === 'INSERT') {
      let attributes = false
      while (i + 1 < recs.length && recs[i + 1].type === 'ATTRIB') {
        attributes = true
        i++
      }
      if ((attributes || valueOf(rec, 66)?.trim() === '1') && i + 1 < recs.length && recs[i + 1].type === 'SEQEND') i++
      out.push({ rec })
    } else if (rec.type === 'VERTEX' || rec.type === 'SEQEND' || rec.type === 'ATTRIB') continue
    else out.push({ rec })
  }
  return out
}

/** Reads an ASCII DXF drawing. Throws {@link DxfError} for binary, truncated or malformed files. */
export function readDxf(text: string): DxfDrawing {
  if (text.startsWith(BINARY_SENTINEL))
    throw new DxfError('it is a binary DXF. Save it from the CAD program as an ASCII DXF and import it again.')
  if (text.length > DXF_MAX_BYTES)
    throw new DxfError(`it is over ${DXF_MAX_BYTES / 1_000_000} MB. Crop the drawing to the job and import it again.`)
  const pairs = readPairs(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)
  const comments: string[] = []
  const header = new Map<string, Rec>()
  const layers = new Map<string, DxfLayer>()
  const blocks = new Map<string, Block>()
  let entities: Entity[] = []
  let sections = 0
  for (let i = 0; i < pairs.length; ) {
    const [code, raw] = pairs[i]
    const value = raw.trim()
    if (code === 999) {
      comments.push(raw.trim())
      i++
      continue
    }
    if (code === 0 && value === 'EOF') break
    if (code !== 0 || value !== 'SECTION')
      throw new DxfError(`a SECTION was expected at group pair ${i + 1}, but it reads ${code} "${value.slice(0, 24)}".`)
    if (pairs[i + 1]?.[0] !== 2) throw new DxfError(`the section at group pair ${i + 1} has no name.`)
    const name = pairs[i + 1][1].trim().toUpperCase()
    let end = i + 2
    while (end < pairs.length && !(pairs[end][0] === 0 && pairs[end][1].trim() === 'ENDSEC')) end++
    if (end >= pairs.length) throw new DxfError(`it ends inside its ${name} section; the file is incomplete.`)
    sections++
    if (name === 'HEADER') readHeader(pairs, i + 2, end, header)
    else if (name === 'TABLES') readLayers(records(pairs, i + 2, end), layers)
    else if (name === 'BLOCKS') readBlocks(records(pairs, i + 2, end), blocks)
    else if (name === 'ENTITIES') entities = assemble(records(pairs, i + 2, end))
    i = end + 1
  }
  if (!sections) throw new DxfError('it holds no DXF sections.')

  const variable = (name: string) => header.get(name)
  const version = variable('$ACADVER') ? (valueOf(variable('$ACADVER')!, 1)?.trim() ?? null) : null
  const insRec = variable('$INSUNITS')
  const insUnits = insRec ? numberOf(insRec, 70, NaN) : NaN
  const known = Number.isFinite(insUnits) ? DXF_UNITS[insUnits] : undefined
  const extMin = variable('$EXTMIN'),
    extMax = variable('$EXTMAX')
  const drawing: DxfDrawing = {
    version,
    insUnits: Number.isFinite(insUnits) ? insUnits : null,
    unitM: known?.metres ?? null,
    unitName: known?.name ?? null,
    extents: extMin && extMax ? { min: pointOf(extMin, 10), max: pointOf(extMax, 10) } : null,
    layers: [...layers.values()],
    hiddenLayers: [],
    comments,
    features: [],
    skipped: {},
  }
  new Expander(drawing, layers, blocks).run(entities)
  return drawing
}

function readHeader(pairs: Pair[], from: number, to: number, header: Map<string, Rec>) {
  let current: Rec | null = null
  for (let i = from; i < to; i++) {
    const [code, value] = pairs[i]
    if (code === 9) {
      current = { type: value.trim().toUpperCase(), pairs: [] }
      header.set(current.type, current)
    } else current?.pairs.push(pairs[i])
  }
}

function readLayers(recs: Rec[], layers: Map<string, DxfLayer>) {
  let table = ''
  for (const rec of recs) {
    if (rec.type === 'TABLE') table = (valueOf(rec, 2) ?? '').trim().toUpperCase()
    else if (rec.type === 'ENDTAB') table = ''
    else if (table === 'LAYER' && rec.type === 'LAYER') {
      const name = unicodeEscapes((valueOf(rec, 2) ?? '').trim())
      if (!name) continue
      const colour = numberOf(rec, 62, NaN)
      layers.set(name.toUpperCase(), {
        name,
        colour: Number.isFinite(colour) && colour !== 0 && Math.abs(colour) <= 255 ? Math.abs(colour) : null,
        off: Number.isFinite(colour) && colour < 0,
        frozen: (numberOf(rec, 70, 0) & 1) === 1,
      })
    }
  }
}

function readBlocks(recs: Rec[], blocks: Map<string, Block>) {
  for (let i = 0; i < recs.length; i++) {
    if (recs[i].type !== 'BLOCK') continue
    const head = recs[i]
    let end = i + 1
    while (end < recs.length && recs[end].type !== 'ENDBLK') end++
    const name = (valueOf(head, 2) ?? valueOf(head, 3) ?? '').trim()
    const flags = numberOf(head, 70, 0)
    if (name)
      blocks.set(name.toUpperCase(), {
        name,
        base: pointOf(head, 10),
        xref: (flags & 4) === 4,
        entities: assemble(recs.slice(i + 1, end)),
      })
    i = end
  }
}

interface Context {
  matrix: Matrix
  /** Effective layer and colour of the INSERT whose block this is; absent in model space. */
  insertLayer?: string
  insertColour?: number | null
  /** The model-space INSERT's block name. */
  block?: string
  depth: number
}

const READ = new Set(['POINT', 'LINE', 'LWPOLYLINE', 'POLYLINE', 'ARC', 'CIRCLE', 'ELLIPSE', 'SPLINE', 'TEXT', 'MTEXT'])

class Expander {
  private entityCount = 0
  private vertexCount = 0
  private hidden = new Set<string>()
  constructor(
    private drawing: DxfDrawing,
    private layers: Map<string, DxfLayer>,
    private blocks: Map<string, Block>,
  ) {}

  run(entities: Entity[]) {
    for (const entity of entities) {
      if (valueOf(entity.rec, 67)?.trim() === '1') {
        this.skip('paperSpace')
        continue
      }
      this.entity(entity, { matrix: IDENTITY, depth: 0 })
    }
    this.drawing.hiddenLayers = [...this.hidden]
  }

  private skip(reason: string, count = 1) {
    this.drawing.skipped[reason] = (this.drawing.skipped[reason] ?? 0) + count
  }

  private layerOf(rec: Rec, context: Context) {
    const own = unicodeEscapes((valueOf(rec, 8) ?? '0').trim()) || '0'
    return own === '0' && context.insertLayer !== undefined ? context.insertLayer : own
  }

  private colourOf(rec: Rec, layer: string, context: Context): number | null {
    const own = numberOf(rec, 62, 256)
    if (own === 0) return context.insertColour ?? null
    if (own >= 1 && own <= 255) return own
    return this.layers.get(layer.toUpperCase())?.colour ?? null
  }

  private entity({ rec, vertices }: Entity, context: Context) {
    if (++this.entityCount > DXF_MAX_ENTITIES)
      throw new DxfError(
        `it has more than ${DXF_MAX_ENTITIES.toLocaleString('en-CA')} entities, counting block copies. Crop the drawing to the job and import it again.`,
      )
    if (valueOf(rec, 60)?.trim() === '1') return this.skip('invisible')
    const layer = this.layerOf(rec, context)
    const state = this.layers.get(layer.toUpperCase())
    if (state && (state.frozen || (state.off && rec.type !== 'INSERT'))) {
      this.hidden.add(state.name)
      return this.skip('hiddenLayer')
    }
    const colour = this.colourOf(rec, layer, context)
    if (rec.type === 'INSERT') return this.insert(rec, layer, colour, context)
    if (!READ.has(rec.type)) return this.skip(rec.type || 'unnamed')
    const pieces = this.pieces(rec, vertices ?? [])
    if (!pieces) return
    const truecolour = numberOf(rec, 420, NaN)
    for (const piece of pieces) {
      const points = dedupe(piece.points.map((p) => apply(context.matrix, p)))
      if (!points.every((p) => p.every(Number.isFinite))) {
        this.skip('invalidCoordinates')
        continue
      }
      let shape = piece.shape
      if (shape === 'polygon') {
        if (!same(points[0], points[points.length - 1])) points.push([...points[0]])
        if (points.length < 4) shape = 'line'
      }
      // A line, or a ring too small to be a polygon, with every point the same has no length.
      if (shape === 'line' && points.every((p) => same(p, points[0]))) {
        this.skip('degenerate')
        continue
      }
      this.vertexCount += points.length
      if (this.vertexCount > DXF_MAX_VERTICES)
        throw new DxfError(
          `it has more than ${DXF_MAX_VERTICES.toLocaleString('en-CA')} vertices once arcs and splines are drawn. Crop or simplify the drawing and import it again.`,
        )
      const label = piece.text?.replace(/\s+/g, ' ').trim()
      this.drawing.features.push({
        shape,
        points,
        layer,
        entity: rec.type,
        name: (label || context.block || layer).slice(0, 200),
        colour,
        ...(Number.isInteger(truecolour) && truecolour >= 0
          ? { rgb: `#${(truecolour & 0xffffff).toString(16).padStart(6, '0')}` }
          : {}),
        ...(piece.text !== undefined ? { text: piece.text } : {}),
        ...(context.block ? { block: context.block } : {}),
      })
    }
  }

  private insert(rec: Rec, layer: string, colour: number | null, context: Context) {
    const name = (valueOf(rec, 2) ?? '').trim()
    const block = this.blocks.get(name.toUpperCase())
    if (!block) return this.skip('missingBlock')
    if (block.xref) return this.skip('xref')
    if (context.depth >= DXF_MAX_INSERT_DEPTH) return this.skip('insertDepth')
    const columns = Math.max(1, Math.round(numberOf(rec, 70, 1))),
      rows = Math.max(1, Math.round(numberOf(rec, 71, 1)))
    if (columns * rows > DXF_MAX_INSERT_CELLS) return this.skip('insertArray')
    const ocs = ocsMatrix(extrusionOf(rec))
    const placed = multiply(ocs ?? IDENTITY, multiply(translate(pointOf(rec, 10)), rotateZ(numberOf(rec, 50, 0))))
    const scaled = multiply(
      scale(numberOf(rec, 41, 1), numberOf(rec, 42, 1), numberOf(rec, 43, 1)),
      translate([-block.base[0], -block.base[1], -block.base[2]]),
    )
    const columnSpacing = numberOf(rec, 44, 0),
      rowSpacing = numberOf(rec, 45, 0)
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const cell = multiply(placed, multiply(translate([column * columnSpacing, row * rowSpacing, 0]), scaled))
        const child: Context = {
          matrix: multiply(context.matrix, cell),
          insertLayer: layer,
          insertColour: colour,
          block: context.block ?? block.name,
          depth: context.depth + 1,
        }
        for (const entity of block.entities) this.entity(entity, child)
      }
  }

  /** The entity's geometry in its block's (or the world's) coordinates; null when skipped. */
  private pieces(rec: Rec, vertices: Rec[]): Piece[] | null {
    const ocs = ocsMatrix(extrusionOf(rec))
    const world = (points: XYZ[]) => (ocs ? points.map((p) => apply(ocs, p)) : points)
    switch (rec.type) {
      case 'POINT':
        return [{ shape: 'point', points: [pointOf(rec, 10)] }]
      case 'LINE':
        return [{ shape: 'line', points: [pointOf(rec, 10), pointOf(rec, 11)] }]
      case 'LWPOLYLINE': {
        const list: BulgeVertex[] = []
        let flags = 0,
          elevation = 0
        for (const [code, raw] of rec.pairs) {
          const value = Number(raw.trim())
          if (code === 70) flags = value
          else if (code === 38) elevation = value
          else if (code === 10) list.push({ x: value, y: NaN, z: 0, bulge: 0 })
          else if (code === 20 && list.length) list[list.length - 1].y = value
          else if (code === 42 && list.length) list[list.length - 1].bulge = value
        }
        for (const v of list) v.z = Number.isFinite(elevation) ? elevation : 0
        const closed = (flags & 1) === 1
        return [{ shape: closed ? 'polygon' : 'line', points: world(bulgedPoints(list, closed)) }]
      }
      case 'POLYLINE': {
        const flags = numberOf(rec, 70, 0)
        if (flags & (16 | 64)) {
          this.skip('polyfaceMesh')
          return null
        }
        const threeD = (flags & 8) === 8
        const elevation = numberOf(rec, 30, 0)
        const list: BulgeVertex[] = vertices
          // Spline frame control points (vertex flag 16) are not on the curve.
          .filter((v) => (numberOf(v, 70, 0) & 16) === 0)
          .map((v) => ({
            x: numberOf(v, 10, NaN),
            y: numberOf(v, 20, NaN),
            z: threeD ? numberOf(v, 30, 0) : elevation,
            bulge: threeD ? 0 : numberOf(v, 42, 0),
          }))
        const closed = (flags & 1) === 1
        const points = bulgedPoints(list, closed)
        return [{ shape: closed ? 'polygon' : 'line', points: threeD ? points : world(points) }]
      }
      case 'ARC': {
        const start = (numberOf(rec, 50, 0) * Math.PI) / 180
        let sweep = (((numberOf(rec, 51, 360) - numberOf(rec, 50, 0)) % 360) + 360) % 360
        if (sweep < 1e-9) sweep = 360
        return [
          {
            shape: 'line',
            points: world(arc(pointOf(rec, 10), numberOf(rec, 40, 0), start, (sweep * Math.PI) / 180)),
          },
        ]
      }
      case 'CIRCLE':
        return [{ shape: 'polygon', points: world(arc(pointOf(rec, 10), numberOf(rec, 40, 0), 0, 2 * Math.PI)) }]
      case 'ELLIPSE': {
        const centre = pointOf(rec, 10),
          major = pointOf(rec, 11)
        const ratio = numberOf(rec, 40, 1)
        const minorDirection = cross(extrusionOf(rec), major)
        const minor: XYZ = [minorDirection[0] * ratio, minorDirection[1] * ratio, minorDirection[2] * ratio]
        const start = numberOf(rec, 41, 0)
        let sweep = numberOf(rec, 42, 2 * Math.PI) - start
        sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
        const full = sweep < 1e-9 || Math.abs(sweep - 2 * Math.PI) < 1e-9
        if (full) sweep = 2 * Math.PI
        const n = Math.max(1, Math.ceil(sweep / STEP - 1e-9))
        const points = Array.from({ length: n + 1 }, (_, i): XYZ => {
          const t = start + (sweep * i) / n,
            c = Math.cos(t),
            s = Math.sin(t)
          return [
            centre[0] + c * major[0] + s * minor[0],
            centre[1] + c * major[1] + s * minor[1],
            centre[2] + c * major[2] + s * minor[2],
          ]
        })
        if (full) points[n] = [...points[0]]
        return [{ shape: full ? 'polygon' : 'line', points }]
      }
      case 'SPLINE': {
        const control: XYZ[] = [],
          fit: XYZ[] = [],
          knots: number[] = [],
          weights: number[] = []
        for (const [code, raw] of rec.pairs) {
          const value = Number(raw.trim())
          if (code === 10) control.push([value, 0, 0])
          else if (code === 20 && control.length) control[control.length - 1][1] = value
          else if (code === 30 && control.length) control[control.length - 1][2] = value
          else if (code === 11) fit.push([value, 0, 0])
          else if (code === 21 && fit.length) fit[fit.length - 1][1] = value
          else if (code === 31 && fit.length) fit[fit.length - 1][2] = value
          else if (code === 40) knots.push(value)
          else if (code === 41) weights.push(value)
        }
        const closed = (numberOf(rec, 70, 0) & 1) === 1
        const points = fit.length >= 2 ? fit : bSplinePoints(control, numberOf(rec, 71, 3), knots, weights)
        return [{ shape: closed ? 'polygon' : 'line', points }]
      }
      case 'TEXT': {
        const text = plainText(valueOf(rec, 1) ?? '').trim()
        if (!text) {
          this.skip('emptyText')
          return null
        }
        const aligned = (numberOf(rec, 72, 0) !== 0 || numberOf(rec, 73, 0) !== 0) && valueOf(rec, 11) !== undefined
        return [{ shape: 'point', points: world([pointOf(rec, aligned ? 11 : 10)]), text }]
      }
      case 'MTEXT': {
        const raw = rec.pairs
          .filter(([code]) => code === 3 || code === 1)
          .map(([, value]) => value)
          .join('')
        const text = plainMText(raw)
        if (!text) {
          this.skip('emptyText')
          return null
        }
        return [{ shape: 'point', points: [pointOf(rec, 10)], text }]
      }
    }
    return null
  }
}

const same = (a: XYZ, b: XYZ) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
function dedupe(points: XYZ[]): XYZ[] {
  const out: XYZ[] = []
  for (const p of points) if (!out.length || !same(out[out.length - 1], p)) out.push(p)
  return out
}

// --- joining ---------------------------------------------------------------------------------------

/**
 * Line pieces joined where exactly two pieces of the same layer and block meet within `tolerance`
 * drawing units: a centreline drawn as LINE, ARC and POLYLINE pieces comes back as one line, in
 * the direction of its first piece in the file. A junction of three or more pieces is never
 * joined through, and a ring of pieces stays a line. Points and polygons pass through unchanged,
 * in file order.
 */
export function joinDxfLines(features: readonly DxfFeature[], tolerance: number): DxfFeature[] {
  const cell = tolerance > 0 && Number.isFinite(tolerance) ? tolerance : 1e-9
  const groupOf = (f: DxfFeature) => `${f.layer}\u0000${f.block ?? ''}\u0000${f.name}`
  const lines = features.map((_, i) => i).filter((i) => features[i].shape === 'line')
  // Ends clustered into nodes per group.
  const grids = new Map<string, Map<string, number[]>>()
  const nodes: Array<[number, number]> = []
  const nodeOf = new Map<number, [number, number]>()
  const incident = new Map<number, Array<[number, 0 | 1]>>()
  const node = (group: string, [x, y]: XYZ) => {
    const grid = grids.get(group) ?? new Map<string, number[]>()
    grids.set(group, grid)
    const gx = Math.floor(x / cell),
      gy = Math.floor(y / cell)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const id of grid.get(`${gx + dx},${gy + dy}`) ?? [])
          if (Math.hypot(nodes[id][0] - x, nodes[id][1] - y) <= tolerance) return id
    nodes.push([x, y])
    const key = `${gx},${gy}`
    grid.set(key, [...(grid.get(key) ?? []), nodes.length - 1])
    return nodes.length - 1
  }
  for (const i of lines) {
    const f = features[i],
      group = groupOf(f)
    const ends: [number, number] = [node(group, f.points[0]), node(group, f.points[f.points.length - 1])]
    nodeOf.set(i, ends)
    ends.forEach((id, end) => incident.set(id, [...(incident.get(id) ?? []), [i, end as 0 | 1]]))
  }
  const other = (id: number, piece: number, end: 0 | 1): [number, 0 | 1] | null => {
    const list = incident.get(id)!
    if (list.length !== 2) return null
    const o = list[0][0] === piece && list[0][1] === end ? list[1] : list[0]
    return o[0] === piece ? null : o
  }
  const used = new Set<number>()
  const out: DxfFeature[] = []
  features.forEach((feature, start) => {
    if (feature.shape !== 'line') return void out.push(feature)
    if (used.has(start)) return
    // Back to the head of the chain.
    let head = start,
      enter: 0 | 1 = 0
    const seen = new Set([start])
    for (;;) {
      const o = other(nodeOf.get(head)![enter], head, enter)
      if (!o || used.has(o[0])) break
      if (seen.has(o[0])) {
        head = start
        enter = 0
        break
      }
      head = o[0]
      enter = (1 - o[1]) as 0 | 1
      seen.add(head)
    }
    // Forward along it.
    const chain: Array<{ piece: number; reversed: boolean }> = []
    let piece = head
    for (;;) {
      used.add(piece)
      chain.push({ piece, reversed: enter === 1 })
      const exit = (1 - enter) as 0 | 1
      const o = other(nodeOf.get(piece)![exit], piece, exit)
      if (!o || used.has(o[0])) break
      piece = o[0]
      enter = o[1]
    }
    if (chain.length === 1 && !chain[0].reversed) return void out.push(features[head])
    const points: XYZ[] = []
    for (const { piece: index, reversed } of chain) {
      const part = reversed ? [...features[index].points].reverse() : features[index].points
      points.push(...(points.length ? part.slice(1) : part))
    }
    const first = features[chain[0].piece]
    out.push({
      ...first,
      points,
      entity: [...new Set(chain.map(({ piece: index }) => features[index].entity))].join('+'),
    })
  })
  return out
}

// --- describing ------------------------------------------------------------------------------------

const SKIPPED_NOUNS: Record<string, [string, string]> = {
  paperSpace: ['paper-space entity', 'paper-space entities'],
  hiddenLayer: ['entity on an off or frozen layer', 'entities on off or frozen layers'],
  invisible: ['invisible entity', 'invisible entities'],
  polyfaceMesh: ['polyface or mesh', 'polyfaces and meshes'],
  insertDepth: ['block nested too deeply', 'blocks nested too deeply'],
  insertArray: ['block array too large', 'block arrays too large'],
  missingBlock: ['insert of an undefined block', 'inserts of undefined blocks'],
  xref: ['external reference', 'external references'],
  emptyText: ['empty text', 'empty texts'],
  degenerate: ['zero-length entity', 'zero-length entities'],
  invalidCoordinates: ['entity with unreadable coordinates', 'entities with unreadable coordinates'],
  '3DFACE': ['3D face', '3D faces'],
  SOLID: ['solid fill', 'solid fills'],
  HATCH: ['hatch', 'hatches'],
  DIMENSION: ['dimension', 'dimensions'],
}

/** One sentence naming what the reader left out, or null when it read everything. */
export function describeDxfSkipped(skipped: Record<string, number>): string | null {
  const parts = Object.entries(skipped)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, n]) => {
      const [one, many] = SKIPPED_NOUNS[key] ?? [`${key} entity`, `${key} entities`]
      return `${n.toLocaleString('en-CA')} ${n === 1 ? one : many}`
    })
  return parts.length ? `Not read from the drawing: ${parts.join(', ')}.` : null
}

/** The EPSG code PGMaps' own DXF export names in its 999 comment ("Plan in EPSG:… grid metres"), or null. */
export function pgmapsDxfEpsg(comments: readonly string[]): number | null {
  for (const comment of comments) {
    const match = /^PG Maps forest road design: .*Plan in EPSG:(\d+) grid metres/.exec(comment)
    if (match) return Number(match[1])
  }
  return null
}
