/**
 * Softree's documented ASCII exchange files for terrain and location designs, read and written:
 *
 * - **Terrain ASCII** (RoadEng help, *Terrain ASCII File Format*): one line per point, six delimited
 *   fields: the feature's name and sub ID joined by a hyphen (`Creek-21`), the station along the
 *   feature (0 for a single point), X, Y, Z and a comment whose delimiters RoadEng replaces with `~`.
 *   Read into features of the same shape as `RoadEngTerrainFeature` (`roadEngTerrain.ts`), so the
 *   project assembly can class them as it classes a `.terx`'s, and written from such features.
 * - **Location ASCII coordinate file** (RoadEng help, *ASCII Coordinate Files* and *Ascii Export
 *   Options*): one line per section point with fields the person picks and orders: P- and
 *   L-station, the surface flag (`OG`, `STRIP`, `SG`, `SRF1`–`SRF3`), X, Y, Z, the template point
 *   code, the horizontal offset (negative left, as in PGMaps) and vertical offset from the
 *   centreline, a sequence number and static text. Read into stations and their points, and written
 *   from a PGMaps road's calculated stations ({@link softreeLocationStationsFromAnalysis}).
 *
 * Neither file states its units or its coordinate system. Both readers return `unitM: null` and
 * `epsg: null`, and the caller asks: nothing here guesses either. Values stay in the file's units.
 * The content decides the reader ({@link isSoftreeTerrainAscii}, {@link isSoftreeLocationAscii}),
 * never the file's name.
 *
 * What the help does not say, and what this module therefore takes as given (each checked only by
 * this module's own round trips, not against a file RoadEng wrote):
 *
 * - Terrain ASCII: the delimiter is a comma, tab or semicolon, found from the first lines; a first
 *   line that is not a point is a header, kept as text. Consecutive lines with the same name and sub
 *   ID and non-decreasing stations are one feature, split at the last hyphen followed by digits (a
 *   name may hold hyphens of its own). A line without a sub ID gets sub ID 0. A multi-point feature
 *   whose stations are all 0 is a point set (`points`, flags 0x09 as `roadEngTerrain.ts` reads point
 *   sets), and the writer writes point sets that way; one whose first and last points coincide is a
 *   closed line. The first station is the feature's station origin. Feature flags, colours, layers,
 *   attributes and the TIN are not in the format: features come back unflagged (except point sets),
 *   uncoloured and outside any TIN (`inTin` false), so a ground model must be built from the points.
 * - Location ASCII: when the caller gives no layout, {@link inferSoftreeLocationLayout} recognises the
 *   help's two example layouts by their values: the flag column (a surface flag on every line), the
 *   three numbers after it as X, Y and Z, two numbers before it as P- and L-station, or static text
 *   and a sequence number before it; then a code and two numbers (H and V offset) after Z. Anything
 *   else must be given. With *single line per station* the station fields (P-station, L-station,
 *   sequence, static text) come once, in layout order, and the point fields repeat for every point.
 *   Lines with the same P- and L-station are one station. The code `-` is no code. The point codes
 *   written for PGMaps' named points (`CL`, `REL`/`RER` formation edges, `DIL`/`DIR` ditch bottoms,
 *   `SSL`/`SSR` slope stakes) follow the help's example section, whose code figure has no text.
 *   The vertical offset is from the subgrade centreline, as in that example (SG `CL` 0.00, SRF1 `CL`
 *   0.75). The writer writes `OG` (ground), `STRIP` (ground after site preparation, where prepared)
 *   and `SG` (PGMaps' design is the subgrade); the surfacing layers are not written. A PGMaps road
 *   has no P-line, so its P-station is its L-station.
 *
 * Limits: {@link MAX_SOFTREE_ASCII_BYTES} of text, {@link MAX_SOFTREE_TERRAIN_ASCII_POINTS} terrain
 * points, {@link MAX_SOFTREE_LOCATION_POINTS} section points, {@link MAX_SOFTREE_LOCATION_FIELDS}
 * fields on a single-line station.
 *
 * Re-implemented from the published help text only. Pure: no DOM or network access.
 */
import { offsetCoordinate } from './engine'
import {
  ROADENG_FLAG_POINT_SET,
  type RoadEngBbox,
  type RoadEngFeatureType,
  type RoadEngTerrain,
  type RoadEngTerrainFeature,
} from './roadEngTerrain'
import { sectionCodePoints } from './sectionGeometry'
import type { Coordinate, ResolvedTemplate, RoadStation, RoadTemplate } from './types'

/** Largest ASCII file read, in characters. */
export const MAX_SOFTREE_ASCII_BYTES = 200_000_000
/** Most points a terrain ASCII file may hold. */
export const MAX_SOFTREE_TERRAIN_ASCII_POINTS = 10_000_000
/** Most section points a location coordinate file may hold. */
export const MAX_SOFTREE_LOCATION_POINTS = 2_000_000
/** Most fields on one line of a single-line-per-station location file. */
export const MAX_SOFTREE_LOCATION_FIELDS = 5_000
/** Decimals written by default (millimetres in a metric project). */
export const SOFTREE_ASCII_DECIMALS = 3
/** Lines looked at to recognise a file. */
const DETECT_LINES = 20

export type SoftreeDelimiter = ',' | '\t' | ';'
export const SOFTREE_DELIMITERS: readonly SoftreeDelimiter[] = [',', '\t', ';']

// ─── shared text helpers ───────────────────────────────────────────────────────────────────────

/** Lines of a text file, without the line ends; a final empty line is dropped. */
export function asciiLines(text: string): string[] {
  if (text.length > MAX_SOFTREE_ASCII_BYTES)
    throw Error(`The file is over ${MAX_SOFTREE_ASCII_BYTES / 1e6} MB of text.`)
  const lines = text.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines
}

/** A number field: null when blank, undefined when it is not a number. */
export function asciiNumber(field: string | undefined): number | null | undefined {
  const s = (field ?? '').trim()
  if (!s) return null
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return undefined
  return Number(s)
}

const isNumber = (field: string | undefined) => {
  const v = asciiNumber(field)
  return typeof v === 'number'
}

/** A fixed-decimal number, never `-0`; blank for null. */
export function asciiFixed(value: number | null | undefined, decimals: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ''
  const s = value.toFixed(decimals)
  return /^-0\.?0*$/.test(s) ? s.slice(1) : s
}

const replaceDelimiter = (text: string, delimiter: string) =>
  text
    .replace(/\r\n|\r|\n/g, ' ')
    .split(delimiter)
    .join('~')

// ─── Terrain ASCII ─────────────────────────────────────────────────────────────────────────────

/** A terrain ASCII feature: a `RoadEngTerrainFeature` plus what only the ASCII file carries. */
export interface SoftreeTerrainAsciiFeature extends RoadEngTerrainFeature {
  /** The station on each line, as the file gives it. */
  stations: Float64Array
  /** Each point's comment ('' for none), with `~` where RoadEng replaced a delimiter. */
  comments: string[]
}

export interface SoftreeTerrainAscii {
  delimiter: SoftreeDelimiter
  /** A first line that is not a point (column headings), kept as written. */
  header: string | null
  features: SoftreeTerrainAsciiFeature[]
  bbox: RoadEngBbox
  /** The file states no units: the caller asks. */
  unitM: null
  /** The file states no coordinate system: the caller asks. */
  epsg: null
  warnings: string[]
}

const TERRAIN_KEY = /^(.*)-(\d+)$/

function terrainFields(line: string, delimiter: SoftreeDelimiter): string[] | null {
  const f = line.split(delimiter)
  if (f.length < 5 || f.length > 6) return null
  if (!f[0].trim() || ![1, 2, 3, 4].every((k) => isNumber(f[k]))) return null
  return f
}

function terrainDelimiter(lines: string[]): { delimiter: SoftreeDelimiter; header: boolean } | null {
  const sample = lines.slice(0, DETECT_LINES + 1).filter((l) => l.trim())
  if (!sample.length) return null
  for (const delimiter of SOFTREE_DELIMITERS)
    for (const header of [false, true]) {
      const data = header ? sample.slice(1) : sample
      if (!data.length || (header && terrainFields(sample[0], delimiter))) continue
      // Every line a point, and most named `name-subID` as RoadEng writes them.
      const named = data.filter((l) => TERRAIN_KEY.test(l.split(delimiter)[0].trim())).length
      if (data.every((l) => terrainFields(l, delimiter)) && named * 2 >= data.length) return { delimiter, header }
    }
  return null
}

/**
 * Whether a text file is a Softree terrain ASCII export: every one of its first lines (after at
 * most one header line) has a name, four numbers and at most a comment, and most names end in a
 * `-subID`.
 */
export function isSoftreeTerrainAscii(text: string): boolean {
  const lines = text
    .slice(0, 64_000)
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .slice(0, DETECT_LINES + 1)
  if (text.length > 64_000) lines.pop() // possibly cut mid-line
  return terrainDelimiter(lines.filter((l) => l.trim())) !== null
}

const emptyBbox = (): RoadEngBbox => [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
function grow(b: RoadEngBbox, x: number, y: number, z: number) {
  if (x < b[0]) b[0] = x
  if (x > b[1]) b[1] = x
  if (y < b[2]) b[2] = y
  if (y > b[3]) b[3] = y
  if (z < b[4]) b[4] = z
  if (z > b[5]) b[5] = z
}
const finishBbox = (b: RoadEngBbox): RoadEngBbox => (Number.isFinite(b[0]) ? b : [0, 0, 0, 0, 0, 0])

function planLength(points: ArrayLike<number>): number {
  let length = 0
  for (let i = 3; i < points.length; i += 3)
    length += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2])
  return length
}

/** Reads a terrain ASCII export. Throws on a line that is not a point. */
export function parseSoftreeTerrainAscii(text: string): SoftreeTerrainAscii {
  const lines = asciiLines(text)
  const found = terrainDelimiter(lines.filter((l) => l.trim()))
  if (!found) throw Error('This is not a Softree terrain ASCII file: its lines are not name-ID, station, X, Y, Z.')
  const { delimiter } = found
  const warnings: string[] = []
  let header: string | null = null
  type Draft = { key: string; name: string; subId: number; xyz: number[]; stations: number[]; comments: string[] }
  const drafts: Draft[] = []
  let total = 0
  let first = true
  let noSubId = 0
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (first && found.header) {
      header = line
      first = false
      continue
    }
    first = false
    const f = terrainFields(line, delimiter)
    if (!f) throw Error(`Line ${i + 1} is not name-ID, station, X, Y, Z and a comment.`)
    if (++total > MAX_SOFTREE_TERRAIN_ASCII_POINTS)
      throw Error(`The file has over ${MAX_SOFTREE_TERRAIN_ASCII_POINTS.toLocaleString('en-CA')} points.`)
    const key = f[0].trim()
    const m = TERRAIN_KEY.exec(key)
    if (!m) noSubId++
    const station = asciiNumber(f[1]) as number,
      x = asciiNumber(f[2]) as number,
      y = asciiNumber(f[3]) as number,
      z = asciiNumber(f[4]) as number
    const last = drafts[drafts.length - 1]
    if (last && last.key === key && station >= last.stations[last.stations.length - 1]) {
      last.xyz.push(x, y, z)
      last.stations.push(station)
      last.comments.push(f[5] ?? '')
    } else
      drafts.push({
        key,
        name: m ? m[1] : key,
        subId: m ? Number(m[2]) : 0,
        xyz: [x, y, z],
        stations: [station],
        comments: [f[5] ?? ''],
      })
  }
  if (!drafts.length) throw Error('The terrain ASCII file has no points.')
  if (noSubId) warnings.push(`${noSubId} lines name no sub ID; they take sub ID 0.`)
  const bbox = emptyBbox()
  let offStation = 0
  const features = drafts.map((d, index): SoftreeTerrainAsciiFeature => {
    const points = Float64Array.from(d.xyz)
    const fb = emptyBbox()
    for (let k = 0; k < points.length; k += 3) {
      grow(fb, points[k], points[k + 1], points[k + 2])
      grow(bbox, points[k], points[k + 1], points[k + 2])
    }
    const n = d.stations.length
    const pointSet = n > 1 && d.stations.every((s) => s === 0)
    const closed =
      !pointSet &&
      n >= 4 &&
      d.xyz[0] === d.xyz[3 * n - 3] &&
      d.xyz[1] === d.xyz[3 * n - 2] &&
      d.xyz[2] === d.xyz[3 * n - 1]
    const type: RoadEngFeatureType = n === 1 ? 'point' : pointSet ? 'points' : closed ? 'closed-line' : 'line'
    const lengthM = pointSet ? 0 : planLength(points)
    if (!pointSet && n > 1) {
      let along = d.stations[0]
      for (let k = 1; k < n; k++) {
        along += Math.hypot(points[3 * k] - points[3 * k - 3], points[3 * k + 1] - points[3 * k - 2])
        if (Math.abs(along - d.stations[k]) > 0.01 + 1e-6 * Math.abs(along)) {
          offStation++
          break
        }
      }
    }
    return {
      index,
      name: d.name,
      subId: d.subId,
      color: null,
      flags: pointSet ? ROADENG_FLAG_POINT_SET | 0x01 : 0,
      kind: pointSet ? 3 : 1,
      type,
      points,
      inTin: false,
      stationOrigin: d.stations[0],
      lengthM,
      bbox: finishBbox(fb),
      stations: Float64Array.from(d.stations),
      comments: d.comments,
    }
  })
  if (offStation)
    warnings.push(
      `${offStation} features have stations that are not their plan distances; the stations are kept as read.`,
    )
  return { delimiter, header, features, bbox: finishBbox(bbox), unitM: null, epsg: null, warnings }
}

/**
 * The file as a `RoadEngTerrain` (no TIN, no feature codes, version 0: not a `.ter`), for the
 * assembly that classes a `.terx`'s features.
 */
export function softreeTerrainAsciiTerrain(file: SoftreeTerrainAscii): RoadEngTerrain {
  return { version: 0, bbox: file.bbox, codes: [], features: file.features, tin: null, warnings: [...file.warnings] }
}

/** A feature to write: any `RoadEngTerrainFeature`, or the fields the ASCII file needs. */
export interface SoftreeTerrainAsciiWriteFeature {
  name: string
  subId: number
  /** x, y, z triples in the units the file is written in */
  points: ArrayLike<number>
  type?: RoadEngFeatureType
  stationOrigin?: number
  /** Stations as read from a file; written as they are when they match the point count. */
  stations?: ArrayLike<number>
  comments?: readonly string[]
}

export interface SoftreeTerrainAsciiWriteOptions {
  delimiter?: SoftreeDelimiter
  decimals?: number
  /** A header line to write first (as read), or none. */
  header?: string | null
  /** CRLF (RoadEng's line end, the default) or LF. */
  lineEnd?: '\r\n' | '\n'
}

/** Writes features as a terrain ASCII file; notes say what had to change. */
export function writeSoftreeTerrainAscii(
  features: readonly SoftreeTerrainAsciiWriteFeature[],
  options: SoftreeTerrainAsciiWriteOptions = {},
): { text: string; notes: string[] } {
  const delimiter = options.delimiter ?? ','
  const decimals = options.decimals ?? SOFTREE_ASCII_DECIMALS
  const eol = options.lineEnd ?? '\r\n'
  const out: string[] = []
  const notes: string[] = []
  let renamed = 0,
    total = 0
  if (options.header) out.push(options.header.replace(/\r\n|\r|\n/g, ' '))
  for (const f of features) {
    const n = Math.floor(f.points.length / 3)
    if (!n || f.points.length !== 3 * n) throw Error(`${f.name} has no whole x, y, z points.`)
    if (!Number.isInteger(f.subId) || f.subId < 0)
      throw Error(`${f.name} has sub ID ${f.subId}; it must be a whole number.`)
    total += n
    if (total > MAX_SOFTREE_TERRAIN_ASCII_POINTS)
      throw Error(`Over ${MAX_SOFTREE_TERRAIN_ASCII_POINTS.toLocaleString('en-CA')} points to write.`)
    const name = replaceDelimiter(f.name, delimiter)
    if (name !== f.name) renamed++
    const pointSet = f.type === 'points' && n > 1
    const own = f.stations && f.stations.length === n ? f.stations : null
    let station = f.stationOrigin ?? 0
    for (let k = 0; k < n; k++) {
      const x = f.points[3 * k],
        y = f.points[3 * k + 1],
        z = f.points[3 * k + 2]
      if (![x, y, z].every(Number.isFinite)) throw Error(`${f.name} has a point without a level or position.`)
      if (k > 0) station += Math.hypot(x - f.points[3 * k - 3], y - f.points[3 * k - 2])
      const s = own ? own[k] : pointSet || n === 1 ? 0 : station
      const comment = replaceDelimiter(f.comments?.[k] ?? '', delimiter)
      out.push(
        [
          `${name}-${f.subId}`,
          asciiFixed(s, decimals),
          asciiFixed(x, decimals),
          asciiFixed(y, decimals),
          asciiFixed(z, decimals),
          comment,
        ].join(delimiter),
      )
    }
  }
  if (renamed) notes.push(`${renamed} feature names held the delimiter; it was written as ~.`)
  return { text: out.join(eol) + eol, notes }
}

// ─── Location ASCII coordinate file ────────────────────────────────────────────────────────────

export const SOFTREE_SURFACE_FLAGS = ['OG', 'STRIP', 'SG', 'SRF1', 'SRF2', 'SRF3'] as const
export type SoftreeSurfaceFlag = (typeof SOFTREE_SURFACE_FLAGS)[number]
const isFlag = (s: string | undefined): s is SoftreeSurfaceFlag =>
  (SOFTREE_SURFACE_FLAGS as readonly string[]).includes((s ?? '').trim())

export type SoftreeLocationField =
  | 'pStation'
  | 'lStation'
  | 'flag'
  | 'x'
  | 'y'
  | 'z'
  | 'code'
  | 'hOffset'
  | 'vOffset'
  | 'sequence'
  | 'static'
const STATION_FIELDS: readonly SoftreeLocationField[] = ['pStation', 'lStation', 'sequence', 'static']
const ALL_FIELDS: readonly SoftreeLocationField[] = [
  'pStation',
  'lStation',
  'flag',
  'x',
  'y',
  'z',
  'code',
  'hOffset',
  'vOffset',
  'sequence',
  'static',
]

export interface SoftreeLocationLayout {
  fields: SoftreeLocationField[]
  /** RoadEng's *Single line per station*: station fields once, then every point's fields. */
  singleLine: boolean
  delimiter: SoftreeDelimiter
}

/** The help's *All Surfaces* example layout. */
export const SOFTREE_LOCATION_DEFAULT_LAYOUT: SoftreeLocationLayout = {
  fields: ['pStation', 'lStation', 'flag', 'x', 'y', 'z', 'code', 'hOffset', 'vOffset'],
  singleLine: false,
  delimiter: ',',
}

export interface SoftreeLocationPoint {
  flag: SoftreeSurfaceFlag
  x: number | null
  y: number | null
  z: number | null
  /** Template point code; null for none (`-`). */
  code: string | null
  hOffset: number | null
  vOffset: number | null
  /** The line's own sequence number, where it differs from its station's. */
  sequence?: number | null
}

export interface SoftreeLocationStation {
  pStation: number | null
  lStation: number | null
  sequence: number | null
  staticText: string | null
  points: SoftreeLocationPoint[]
}

export interface SoftreeLocationAscii {
  layout: SoftreeLocationLayout
  /** True when the layout was recognised from the values rather than given. */
  inferred: boolean
  /** A first line that is not a point (column headings), kept as written. */
  header: string | null
  stations: SoftreeLocationStation[]
  /** The file states no units: the caller asks. */
  unitM: null
  /** The file states no coordinate system: the caller asks. */
  epsg: null
  warnings: string[]
}

function checkLayout(layout: SoftreeLocationLayout) {
  const seen = new Set<string>()
  for (const f of layout.fields) {
    if (!ALL_FIELDS.includes(f)) throw Error(`${f} is not a location coordinate field.`)
    if (seen.has(f)) throw Error(`The layout names ${f} twice.`)
    seen.add(f)
  }
  if (!seen.has('flag')) throw Error('A location coordinate layout needs the surface flag.')
  if (!SOFTREE_DELIMITERS.includes(layout.delimiter)) throw Error('Choose a comma, tab or semicolon delimiter.')
}

/**
 * The layout of a location coordinate file, recognised from its first lines when they match one of
 * the help's example layouts; null otherwise (the caller then asks for the fields).
 */
export function inferSoftreeLocationLayout(text: string): SoftreeLocationLayout | null {
  const all = text
    .slice(0, 64_000)
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .filter((l) => l.trim())
  if (text.length > 64_000) all.pop()
  for (const delimiter of SOFTREE_DELIMITERS)
    for (const skip of [0, 1]) {
      const rows = all.slice(skip, skip + DETECT_LINES).map((l) => l.split(delimiter))
      if (!rows.length) continue
      const width = rows[0].length
      if (width < 4 || rows.some((r) => r.length !== width)) continue
      const flagAt = [...Array(width).keys()].find((c) => rows.every((r) => isFlag(r[c])))
      if (flagAt === undefined || flagAt + 3 >= width || flagAt > 2) continue
      if (![1, 2, 3].every((k) => rows.every((r) => isNumber(r[flagAt + k])))) continue
      const before: SoftreeLocationField[] =
        flagAt === 0
          ? []
          : flagAt === 1
            ? rows.every((r) => isNumber(r[0]))
              ? ['lStation']
              : ['static']
            : rows.every((r) => isNumber(r[0]) && isNumber(r[1]))
              ? ['pStation', 'lStation']
              : rows.every((r) => isNumber(r[1]))
                ? ['static', 'sequence']
                : []
      if (before.length !== flagAt) continue
      const after: SoftreeLocationField[] = []
      let c = flagAt + 4
      if (c < width && !rows.every((r) => isNumber(r[c]))) {
        after.push('code')
        c++
      }
      const numeric: SoftreeLocationField[] = ['hOffset', 'vOffset', 'sequence']
      while (c < width && numeric.length && rows.every((r) => isNumber(r[c]))) {
        const next = numeric.shift()!
        if (next === 'sequence' && before.includes('sequence')) break
        after.push(next)
        c++
      }
      if (c !== width) continue
      return { fields: [...before, 'flag', 'x', 'y', 'z', ...after], singleLine: false, delimiter }
    }
  return null
}

/** Whether a text file looks like a location ASCII coordinate file (a layout is recognised). */
export function isSoftreeLocationAscii(text: string): boolean {
  return inferSoftreeLocationLayout(text) !== null
}

type Row = Partial<Record<SoftreeLocationField, string>>

/** Reads a location coordinate file in the given layout, or in the one its values show. */
export function parseSoftreeLocationAscii(text: string, layout?: SoftreeLocationLayout): SoftreeLocationAscii {
  const inferred = !layout
  const used = layout ?? inferSoftreeLocationLayout(text)
  if (!used)
    throw Error('The fields of this coordinate file are not ones RoadEng exports by default; choose its fields.')
  checkLayout(used)
  const lines = asciiLines(text)
  const stationFields = used.fields.filter((f) => STATION_FIELDS.includes(f))
  const pointFields = used.fields.filter((f) => !STATION_FIELDS.includes(f))
  const warnings: string[] = []
  const stations: SoftreeLocationStation[] = []
  let header: string | null = null
  let count = 0
  const num = (row: Row, field: SoftreeLocationField, line: number) => {
    const v = asciiNumber(row[field])
    if (v === undefined) throw Error(`Line ${line}: ${field} is not a number.`)
    return v
  }
  const point = (row: Row, line: number): SoftreeLocationPoint => {
    const flag = (row.flag ?? '').trim()
    if (!isFlag(flag)) throw Error(`Line ${line}: ${flag || 'a blank'} is not a surface flag.`)
    if (++count > MAX_SOFTREE_LOCATION_POINTS)
      throw Error(`The file has over ${MAX_SOFTREE_LOCATION_POINTS.toLocaleString('en-CA')} section points.`)
    const code = (row.code ?? '').trim()
    return {
      flag,
      x: num(row, 'x', line),
      y: num(row, 'y', line),
      z: num(row, 'z', line),
      code: code && code !== '-' ? code : null,
      hOffset: num(row, 'hOffset', line),
      vOffset: num(row, 'vOffset', line),
    }
  }
  const stationOf = (row: Row, line: number): Omit<SoftreeLocationStation, 'points'> => ({
    pStation: num(row, 'pStation', line),
    lStation: num(row, 'lStation', line),
    sequence: num(row, 'sequence', line),
    staticText: row.static !== undefined ? row.static : null,
  })
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const f = line.split(used.delimiter)
    if (used.singleLine) {
      if (f.length > MAX_SOFTREE_LOCATION_FIELDS)
        throw Error(`Line ${i + 1} has over ${MAX_SOFTREE_LOCATION_FIELDS} fields.`)
      const rest = f.length - stationFields.length
      if (rest < 0 || rest % pointFields.length) {
        if (header === null && !stations.length) {
          header = line
          continue
        }
        throw Error(`Line ${i + 1} does not hold whole points of ${pointFields.length} fields.`)
      }
      const row: Row = {}
      stationFields.forEach((name, k) => (row[name] = f[k]))
      if (
        !stations.length &&
        header === null &&
        pointFields.length &&
        !isFlag(f[stationFields.length + pointFields.indexOf('flag')])
      ) {
        header = line
        continue
      }
      const station: SoftreeLocationStation = { ...stationOf(row, i + 1), points: [] }
      for (let p = stationFields.length; p < f.length; p += pointFields.length) {
        const pr: Row = {}
        pointFields.forEach((name, k) => (pr[name] = f[p + k]))
        station.points.push(point(pr, i + 1))
      }
      stations.push(station)
      continue
    }
    if (f.length !== used.fields.length || !isFlag(f[used.fields.indexOf('flag')])) {
      if (header === null && !stations.length) {
        header = line
        continue
      }
      throw Error(`Line ${i + 1} does not have the layout's ${used.fields.length} fields and a surface flag.`)
    }
    const row: Row = {}
    used.fields.forEach((name, k) => (row[name] = f[k]))
    const s = stationOf(row, i + 1)
    const p = point(row, i + 1)
    const last = stations[stations.length - 1]
    const same =
      last &&
      last.pStation === s.pStation &&
      last.lStation === s.lStation &&
      last.staticText === s.staticText &&
      (s.pStation !== null || s.lStation !== null || last.sequence === s.sequence)
    if (same) {
      if (s.sequence !== last.sequence) p.sequence = s.sequence
      last.points.push(p)
    } else stations.push({ ...s, points: [p] })
  }
  if (!stations.length) throw Error('The coordinate file has no section points.')
  if (!used.fields.includes('lStation') && !used.fields.includes('pStation'))
    warnings.push('The file gives no stations; its points are grouped by sequence number only.')
  return { layout: used, inferred, header, stations, unitM: null, epsg: null, warnings }
}

export interface SoftreeLocationWriteOptions {
  decimals?: number
  /** The text written in a `static` field. */
  staticText?: string
  header?: string | null
  lineEnd?: '\r\n' | '\n'
}

/** Writes stations as a location coordinate file in the given layout. */
export function writeSoftreeLocationAscii(
  stations: readonly SoftreeLocationStation[],
  layout: SoftreeLocationLayout = SOFTREE_LOCATION_DEFAULT_LAYOUT,
  options: SoftreeLocationWriteOptions = {},
): string {
  checkLayout(layout)
  const decimals = options.decimals ?? SOFTREE_ASCII_DECIMALS
  const eol = options.lineEnd ?? '\r\n'
  const d = layout.delimiter
  const stationFields = layout.fields.filter((f) => STATION_FIELDS.includes(f))
  const pointFields = layout.fields.filter((f) => !STATION_FIELDS.includes(f))
  const out: string[] = options.header ? [options.header] : []
  const value = (
    field: SoftreeLocationField,
    s: SoftreeLocationStation,
    p: SoftreeLocationPoint | null,
    index: number,
  ) => {
    switch (field) {
      case 'pStation':
        return asciiFixed(s.pStation, decimals)
      case 'lStation':
        return asciiFixed(s.lStation, decimals)
      case 'sequence': {
        const n = p?.sequence ?? s.sequence ?? index + 1
        return String(n)
      }
      case 'static':
        return replaceDelimiter(s.staticText ?? options.staticText ?? '', d)
      case 'flag':
        return p!.flag
      case 'code':
        return p!.code ? replaceDelimiter(p!.code, d) : '-'
      case 'x':
      case 'y':
      case 'z':
      case 'hOffset':
      case 'vOffset':
        return asciiFixed(p![field], decimals)
    }
  }
  let count = 0
  stations.forEach((s, index) => {
    count += s.points.length
    if (count > MAX_SOFTREE_LOCATION_POINTS)
      throw Error(`Over ${MAX_SOFTREE_LOCATION_POINTS.toLocaleString('en-CA')} section points to write.`)
    if (layout.singleLine) {
      if (stationFields.length + s.points.length * pointFields.length > MAX_SOFTREE_LOCATION_FIELDS)
        throw Error(`A station has over ${MAX_SOFTREE_LOCATION_FIELDS} fields on one line.`)
      out.push(
        [
          ...stationFields.map((f) => value(f, s, null, index)),
          ...s.points.flatMap((p) => pointFields.map((f) => value(f, s, p, index))),
        ].join(d),
      )
    } else for (const p of s.points) out.push(layout.fields.map((f) => value(f, s, p, index)).join(d))
  })
  return out.join(eol) + eol
}

/**
 * The centreline in a location file: at each station, the point coded `CL` (or at offset 0) on
 * the subgrade, else on the first surface that has one, and every surface's level there.
 */
export function softreeLocationCentreline(
  file: Pick<SoftreeLocationAscii, 'stations'>,
): Array<{ station: number | null; x: number; y: number; z: Partial<Record<SoftreeSurfaceFlag, number>> }> {
  const rows: Array<{ station: number | null; x: number; y: number; z: Partial<Record<SoftreeSurfaceFlag, number>> }> =
    []
  for (const s of file.stations) {
    const centre = s.points.filter(
      (p) => (p.code === 'CL' || (p.code === null && p.hOffset === 0)) && p.x !== null && p.y !== null,
    )
    const plan = centre.find((p) => p.flag === 'SG') ?? centre[0]
    if (!plan) continue
    const z: Partial<Record<SoftreeSurfaceFlag, number>> = {}
    for (const p of centre) if (p.z !== null && z[p.flag] === undefined) z[p.flag] = p.z
    rows.push({ station: s.lStation ?? s.pStation, x: plan.x!, y: plan.y!, z })
  }
  return rows
}

/** RoadEng point codes for PGMaps' named section points (`sectionGeometry.ts`). */
export const SOFTREE_POINT_CODES: Readonly<Record<string, string>> = {
  centreline: 'CL',
  'left-formation-edge': 'REL',
  'right-formation-edge': 'RER',
  'left-ditch-bottom': 'DIL',
  'right-ditch-bottom': 'DIR',
  'left-daylight': 'SSL',
  'right-daylight': 'SSR',
}
/** PGMaps' name for a RoadEng point code, or the code itself. */
export function pgmapsPointCode(code: string): string {
  return Object.entries(SOFTREE_POINT_CODES).find(([, c]) => c === code)?.[0] ?? code
}

export interface SoftreeLocationFromAnalysisOptions {
  /** Longitude/latitude to the file's grid, in metres. */
  toGrid: (coordinate: Coordinate) => [number, number]
  /** Metres per file unit: 1 for metres, 0.3048 for feet. */
  unitM: number
  /** Added to every chainage (PGMaps' chainage starts at 0). */
  startStation?: number
  /** The surfaces written; the default is all three PGMaps holds. */
  surfaces?: ReadonlyArray<'OG' | 'STRIP' | 'SG'>
}

/**
 * A PGMaps road's calculated stations as location coordinate stations: the subgrade's named points
 * (`sectionCodePoints`) with RoadEng's codes, the ground at every section sample, and the prepared
 * ground where it differs. Positions follow each station's bearing, as the engine lays sections.
 */
export function softreeLocationStationsFromAnalysis(
  stations: readonly RoadStation[],
  template: RoadTemplate | ResolvedTemplate,
  options: SoftreeLocationFromAnalysisOptions,
): SoftreeLocationStation[] {
  const { toGrid, unitM } = options
  if (!(unitM > 0)) throw Error('Give the file unit in metres.')
  const surfaces = new Set(options.surfaces ?? ['OG', 'STRIP', 'SG'])
  const start = options.startStation ?? 0
  return stations.map((station) => {
    const cl = station.designElevation
    const at = (offset: number) =>
      toGrid(offset === 0 ? station.coordinate : offsetCoordinate(station.coordinate, station.bearing + 90, offset))
    const make = (flag: SoftreeSurfaceFlag, offset: number, z: number, code: string | null): SoftreeLocationPoint => {
      const [x, y] = at(offset)
      return {
        flag,
        x: x / unitM,
        y: y / unitM,
        z: z / unitM,
        code,
        hOffset: offset / unitM,
        vOffset: cl === null ? null : (z - cl) / unitM,
      }
    }
    const points: SoftreeLocationPoint[] = []
    if (surfaces.has('OG'))
      for (const s of station.section)
        if (s.ground !== null && Number.isFinite(s.ground))
          points.push(make('OG', s.offset, s.ground, s.offset === 0 ? 'CL' : null))
    if (surfaces.has('STRIP'))
      for (const s of station.section)
        if (s.preparedGround != null && Number.isFinite(s.preparedGround) && s.preparedGround !== s.ground)
          points.push(make('STRIP', s.offset, s.preparedGround, s.offset === 0 ? 'CL' : null))
    if (surfaces.has('SG'))
      for (const p of sectionCodePoints(station, template))
        if (p.design !== null && Number.isFinite(p.design))
          points.push(make('SG', p.offset, p.design, SOFTREE_POINT_CODES[p.code] ?? p.code))
    const s = (station.chainage + start) / unitM
    return { pStation: s, lStation: s, sequence: station.index + 1, staticText: null, points }
  })
}
