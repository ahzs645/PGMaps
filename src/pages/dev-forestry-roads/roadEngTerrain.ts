/**
 * Softree RoadEng terrain files (`.terx`) brought in as terrain features and a TIN, read-only.
 *
 * A `.terx` is a ZIP of `Terrain1.ter` (binary: features, points, attributes and the TIN),
 * `Terrain1.tlt` (INI display settings: the coordinate system and the layer name patterns) and
 * `Terrain1.te1` (an AutoCAD R14 symbol library, not read). The `.ter` layout was worked out from
 * Softree's published sample projects (format version 12, RoadEng 8–11), not from a
 * specification:
 *
 * - `u16` version 12, then nine `u32` section sizes, the nine sections back to back and a 24-byte
 *   trailer. The sizes must add up to the file's length exactly, or the file is refused.
 * - Section 0 (8,336 bytes): feature count, a 32-slot feature-code table (`u16` used flag and
 *   `char[256]`) and the file's bounding box.
 * - Section 1: 104-byte feature records (point count, sub ID, colour, station origin, origin plus
 *   plan length, bounding box, flags, `char[18]` name). Section 2: 40-byte points (`f64` X, Y, Z,
 *   then flags and padding), concatenated in feature order. Every point count must fill the section.
 * - Section 3: length-prefixed attribute chunks. Type 100 is the schema text, type 52 opens one
 *   feature's group (its index and 256-character name), and types from 10000 are user-table rows
 *   (an imported shapefile's attributes) as `|`-separated text.
 * - Sections 4–7: the TIN, when the terrain has been modelled. There is a 64-byte header, then
 *   vertices as (feature index, point index) pairs whose first three entries are (−1, −1)
 *   placeholders, then triangles of three vertex indices stored clockwise, then their
 *   neighbours. Section 8, a cable-logging library, is not read.
 *
 * Coordinates stay in the file's own grid and units. The `.ter` names no coordinate system; the
 * `.tlt`'s `[main] CoordSys` line does ({@link parseRoadEngCoordSys}).
 *
 * Checked against the samples: the bounding boxes and plan lengths of all 18,550 features
 * recompute exactly; `contour.terx` repeats `contours.SHP` vertex for vertex; the cul-de-sac
 * C-Line lands on its design's stations to 5 µm; RoadEng's own contours lie on the decoded TIN.
 *
 * Flag meanings are inferred from those samples, not documented by Softree:
 * - 0x40: the feature is left out of the TIN. In every sample, features with it supply no TIN
 *   vertex and features without it supply all their points.
 * - 0x08 (always seen with 0x01): an unconnected point set, such as LiDAR returns or DEM posts
 *   read in raster rows.
 * - 0x80: seen only on a closed `bound` ring, the TIN boundary.
 *
 * {@link classifyRoadEngFeature} applies these rules, in order:
 * 1. `tin-boundary`: closed with flag 0x80.
 * 2. `contour`: RoadEng's generated contours, meaning a `CNTR*` name or a layer described as
 *    "Contours from model", with flag 0x40.
 * 3. The code library's classes, by name or the description of a `.tlt` layer pattern the name
 *    matches: `stream` (Sml/Med/Lrg Stream, `STREAM*`), `road` (Road CL, `ROAD*`, C-Line, CL),
 *    `d-line`, `landing`, `rock-bluff`, `boundary` (Boundary, Falling BDY, `BOUND*`) and
 *    `breakline` (`BREAK*`).
 * 4. `source-contour`: a supplied contour (name or layer says contour, one elevation throughout)
 *    that the TIN was built from.
 * 5. `mass-points`: flag 0x08, or a single point.
 * 6. `other`.
 *
 * Pure: no DOM or network access.
 */
import { strFromU8, unzipSync } from 'fflate'

/** Largest `.terx` archive read, compressed. */
export const MAX_ROADENG_TERRAIN_BYTES = 200_000_000
/** Largest `Terrain1.ter` read once unpacked: 16 MB holds 170,000 points and 198,000 triangles. */
export const MAX_ROADENG_TER_BYTES = 500_000_000
/** The only `.ter` format version this reader has been checked against. */
export const ROADENG_TER_VERSION = 12

const SECTION_COUNT = 9
const HEADER_BYTES = 2 + 4 * SECTION_COUNT
const TRAILER_BYTES = 24
const HEADER_BLOCK_BYTES = 8336
const CODE_SLOTS = 32
const CODE_SLOT_BYTES = 258
const FEATURE_BYTES = 104
const POINT_BYTES = 40
const TIN_HEADER_BYTES = 64
const TIN_PLACEHOLDERS = 3

export const ROADENG_FLAG_POINT_SET = 0x08
export const ROADENG_FLAG_NOT_MODELLED = 0x40
export const ROADENG_FLAG_BOUNDARY = 0x80
/** Feature flag bits seen in the samples; others are reported. */
const KNOWN_FLAGS = 0x01 | 0x02 | ROADENG_FLAG_POINT_SET | ROADENG_FLAG_NOT_MODELLED | ROADENG_FLAG_BOUNDARY

export type RoadEngFeatureType = 'point' | 'points' | 'line' | 'closed-line' | 'polygon'

export interface RoadEngTerrainFeature {
  index: number
  /** The feature's ID; the 256-character name from its attribute group when it has one. */
  name: string
  subId: number
  /** 0xRRGGBB, or null where the file leaves the colour unset (0). */
  color: number | null
  flags: number
  /** The record's `u16` at +84 (1, 2 or 3 in the samples); its meaning is not known. */
  kind: number
  type: RoadEngFeatureType
  /** x, y, z triples in the file's own grid and units */
  points: Float64Array
  /** true when the TIN uses its points */
  inTin: boolean
  /** user-table attribute values when the file stores any, field name -> text */
  attributes?: Record<string, string>
  /** Station at which the feature's chainage starts (0 except features made from a design). */
  stationOrigin: number
  /** Plan length, as the file states it. */
  lengthM: number
  bbox: RoadEngBbox
}

export type RoadEngBbox = [minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number]

export interface RoadEngTin {
  /** x, y pairs */
  coords: Float64Array
  z: Float64Array
  /** counter-clockwise triangles, 3 vertex indices each */
  triangles: Uint32Array
  /** The longest triangle side RoadEng allowed when it built the TIN; null when unlimited. */
  maxSideM: number | null
}

export interface RoadEngCoordSys {
  raw: string
  epsg: number | null
  wkt: string | null
  source: 'wkt' | 'code' | 'none'
}

export interface RoadEngTerrain {
  version: number
  bbox: RoadEngBbox
  codes: string[]
  features: RoadEngTerrainFeature[]
  tin: RoadEngTin | null
  /** Parts of the file that were read with a doubt, for the import notice. */
  warnings: string[]
}

export interface RoadEngLayer {
  pattern: string
  description: string
}

export type RoadEngFeatureClass =
  | 'contour'
  | 'source-contour'
  | 'mass-points'
  | 'tin-boundary'
  | 'stream'
  | 'road'
  | 'd-line'
  | 'landing'
  | 'boundary'
  | 'rock-bluff'
  | 'breakline'
  | 'other'

/**
 * Whether the opening of a file is a RoadEng terrain: a ZIP whose first entry is one of a
 * terrain's parts. The content decides the reader, never the file's name.
 */
export function isRoadEngTerrain(head: Uint8Array): boolean {
  if (head.length < 30 || head[0] !== 0x50 || head[1] !== 0x4b || head[2] !== 0x03 || head[3] !== 0x04) return false
  const nameLength = head[26] | (head[27] << 8)
  const name = strFromU8(head.subarray(30, Math.min(head.length, 30 + nameLength)), true)
  return /^Terrain\d*\.(ter|tlt|te1)$/i.test(name)
}

const cString = (bytes: Uint8Array, start: number, length: number) => {
  const slice = bytes.subarray(start, start + length)
  const end = slice.indexOf(0)
  return strFromU8(end < 0 ? slice : slice.subarray(0, end), true)
}

const refuse = (detail: string): never => {
  throw Error(`This RoadEng terrain could not be read: ${detail}`)
}

/** Reads the raw `Terrain1.ter`. Anything whose framing does not add up is refused. */
export function parseRoadEngTer(bytes: Uint8Array): RoadEngTerrain {
  if (bytes.length > MAX_ROADENG_TER_BYTES)
    throw Error(`The RoadEng terrain is over ${MAX_ROADENG_TER_BYTES / 1e6} MB unpacked; split it in RoadEng first.`)
  if (bytes.length < HEADER_BYTES + HEADER_BLOCK_BYTES + TRAILER_BYTES)
    refuse('the file is too short to be a terrain. It may be truncated: copy it again from RoadEng.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const version = view.getUint16(0, true)
  if (version !== ROADENG_TER_VERSION)
    refuse(
      `its format version is ${version}, and only version ${ROADENG_TER_VERSION} has been checked. ` +
        'Open and save it in RoadEng 8 or later, or export the surface as LandXML.',
    )
  const sizes: number[] = []
  const offsets: number[] = []
  let end = HEADER_BYTES
  for (let i = 0; i < SECTION_COUNT; i++) {
    sizes.push(view.getUint32(2 + 4 * i, true))
    offsets.push(end)
    end += sizes[i]
  }
  if (end + TRAILER_BYTES !== bytes.length)
    refuse(
      `its sections add up to ${end + TRAILER_BYTES} bytes but the file is ${bytes.length}. ` +
        'It is truncated or damaged: copy it again from RoadEng.',
    )
  if (sizes[0] !== HEADER_BLOCK_BYTES) refuse(`its header block is ${sizes[0]} bytes, not ${HEADER_BLOCK_BYTES}.`)

  // Section 0: header block.
  const h = offsets[0]
  const featureCount = view.getUint32(h, true)
  const codeCount = view.getUint32(h + 16, true)
  const codes: string[] = []
  for (let k = 0; k < CODE_SLOTS; k++) {
    const o = h + 20 + k * CODE_SLOT_BYTES
    const name = cString(bytes, o + 2, CODE_SLOT_BYTES - 2)
    if ((k < codeCount || view.getUint16(o, true)) && name) codes.push(name)
  }
  const boxAt = (o: number): RoadEngBbox => [
    view.getFloat64(o, true),
    view.getFloat64(o + 8, true),
    view.getFloat64(o + 16, true),
    view.getFloat64(o + 24, true),
    view.getFloat64(o + 32, true),
    view.getFloat64(o + 40, true),
  ]
  const bbox = boxAt(h + 20 + CODE_SLOTS * CODE_SLOT_BYTES + 4)

  // Sections 1 and 2: feature records and their points.
  if (sizes[1] !== featureCount * FEATURE_BYTES)
    refuse(`it lists ${featureCount} features but holds ${sizes[1]} bytes of feature records.`)
  if (sizes[2] % POINT_BYTES) refuse('its point section is not a whole number of points.')
  const pointTotal = sizes[2] / POINT_BYTES
  const coords = new Float64Array(pointTotal * 3)
  const pointStart = new Uint32Array(featureCount + 1)
  const warnings: string[] = []
  const features: RoadEngTerrainFeature[] = []
  let cursor = 0
  let badBoxes = 0
  const oddFlags = new Set<number>()
  for (let i = 0; i < featureCount; i++) {
    const r = offsets[1] + i * FEATURE_BYTES
    const count = view.getUint32(r, true)
    if (cursor + count > pointTotal) refuse(`feature ${i + 1}'s points run past the point section.`)
    pointStart[i] = cursor
    const points = coords.subarray(cursor * 3, (cursor + count) * 3)
    let p = offsets[2] + cursor * POINT_BYTES
    for (let k = 0; k < count; k++, p += POINT_BYTES) {
      points[3 * k] = view.getFloat64(p, true)
      points[3 * k + 1] = view.getFloat64(p + 8, true)
      points[3 * k + 2] = view.getFloat64(p + 16, true)
    }
    cursor += count
    const colorRef = view.getUint32(r + 12, true) & 0xffffff
    const origin = view.getFloat64(r + 16, true)
    const flags = view.getUint16(r + 80, true)
    if (flags & ~KNOWN_FLAGS) oddFlags.add(flags)
    const box = boxAt(r + 32)
    if (count && !bboxMatches(points, box)) badBoxes++
    features.push({
      index: i,
      name: cString(bytes, r + 86, 18),
      subId: view.getUint32(r + 4, true),
      color: colorRef ? ((colorRef & 0xff) << 16) | (colorRef & 0xff00) | (colorRef >> 16) : null,
      flags,
      kind: view.getUint16(r + 84, true),
      type: featureType(points, flags),
      points,
      inTin: false,
      stationOrigin: origin,
      lengthM: view.getFloat64(r + 24, true) - origin,
      bbox: box,
    })
  }
  pointStart[featureCount] = cursor
  if (cursor !== pointTotal) refuse(`its features own ${cursor} points but the point section holds ${pointTotal}.`)
  if (badBoxes)
    warnings.push(`${badBoxes} feature${badBoxes === 1 ? "'s" : "s'"} stored extent differs from its points.`)
  if (oddFlags.size)
    warnings.push(
      `Feature flags ${[...oddFlags].map((f) => '0x' + f.toString(16)).join(', ')} were not seen in RoadEng's ` +
        'samples; those features are typed from their shape.',
    )

  readAttributes(bytes, view, offsets[3], sizes[3], features, warnings)
  const tin = readTin(view, offsets, sizes, features, pointStart, coords)
  return { version, bbox, codes, features, tin, warnings }
}

function bboxMatches(points: Float64Array, box: RoadEngBbox): boolean {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity
  for (let k = 0; k < points.length; k += 3) {
    const x = points[k],
      y = points[k + 1],
      z = points[k + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  const tol = 1e-6
  return (
    Math.abs(minX - box[0]) <= tol &&
    Math.abs(maxX - box[1]) <= tol &&
    Math.abs(minY - box[2]) <= tol &&
    Math.abs(maxY - box[3]) <= tol &&
    Math.abs(minZ - box[4]) <= tol &&
    Math.abs(maxZ - box[5]) <= tol
  )
}

function featureType(points: Float64Array, flags: number): RoadEngFeatureType {
  const n = points.length / 3
  if (n === 1) return 'point'
  if (flags & ROADENG_FLAG_POINT_SET) return 'points'
  const closed = n >= 4 && points[0] === points[3 * n - 3] && points[1] === points[3 * n - 2]
  if (closed && flags & ROADENG_FLAG_BOUNDARY) return 'polygon'
  return closed ? 'closed-line' : 'line'
}

/** Section 3. Damage here costs the attributes, never the geometry. */
function readAttributes(
  bytes: Uint8Array,
  view: DataView,
  start: number,
  size: number,
  features: RoadEngTerrainFeature[],
  warnings: string[],
) {
  const tables = new Map<number, string[]>()
  let current: RoadEngTerrainFeature | null = null
  let o = start
  const end = start + size
  while (o < end) {
    const length = o + 16 <= end ? view.getUint32(o, true) : 0
    if (length < 16 || o + length > end) {
      warnings.push('Part of the attribute table is damaged; the features after it come in without attributes.')
      return
    }
    const type = view.getUint32(o + 8, true)
    const payload = bytes.subarray(o + 16, o + length)
    if (type === 100) {
      for (const line of cString(payload, 0, payload.length).split('\n')) {
        const tok = line.split('|')
        const id = Number(tok[0])
        if (tok.length < 8 || !(id >= 10000)) continue
        const fields: string[] = []
        for (let k = 0; k < Number(tok[1]) && 8 + 5 * k < tok.length; k++) fields.push(tok[8 + 5 * k])
        tables.set(id, fields)
      }
    } else if (type === 52 && payload.length >= 4) {
      const index = view.getInt32(o + 16, true)
      current = index >= 0 && index < features.length ? features[index] : null
      const longName = cString(payload, 4, 256).trim()
      if (current && longName) current.name = longName
    } else if (type >= 10000 && current && view.getInt32(o + 12, true) < 0) {
      const fields = tables.get(type) ?? []
      const lines = cString(payload, 0, payload.length).split('\n')
      const tok = lines[lines.length - 1].split('|')
      const values = /^\d+$/.test(tok[0]) ? tok.slice(1, 1 + Number(tok[0])) : tok
      const attributes: Record<string, string> = (current.attributes ??= {})
      values.forEach((value, k) => {
        const field = fields[k] ?? `field${k + 1}`
        attributes[field in attributes ? `${type}.${field}` : field] = value
      })
    }
    o += length
  }
}

/** Sections 4–7. A TIN that does not add up is refused, since every triangle would be suspect. */
function readTin(
  view: DataView,
  offsets: number[],
  sizes: number[],
  features: RoadEngTerrainFeature[],
  pointStart: Uint32Array,
  coords: Float64Array,
): RoadEngTin | null {
  if (!sizes[5] && !sizes[6]) return null
  if (sizes[4] !== TIN_HEADER_BYTES || sizes[5] % 8 || sizes[6] % 16 || (sizes[7] && sizes[7] !== sizes[6]))
    refuse('its TIN sections do not have the sizes a TIN takes.')
  const tableCount = sizes[5] / 8
  const triangleCount = sizes[6] / 16
  const h = offsets[4]
  if (view.getUint32(h + 4, true) !== tableCount || view.getUint32(h + 16, true) !== triangleCount)
    refuse('its TIN header does not match the TIN it holds.')
  const maxSide = view.getFloat64(h + 56, true)
  // Vertex table: (feature, point) pairs; placeholders map to nothing.
  const outIndex = new Int32Array(tableCount).fill(-1)
  const source = new Uint32Array(tableCount)
  let vertexCount = 0
  for (let k = 0; k < tableCount; k++) {
    const f = view.getInt32(offsets[5] + 8 * k, true)
    const p = view.getInt32(offsets[5] + 8 * k + 4, true)
    if (f < 0) {
      if (k >= TIN_PLACEHOLDERS) refuse(`TIN vertex ${k} refers to no point.`)
      continue
    }
    if (f >= features.length || p < 0 || p >= features[f].points.length / 3)
      refuse(`TIN vertex ${k} refers to a point the file does not hold.`)
    features[f].inTin = true
    source[vertexCount] = pointStart[f] + p
    outIndex[k] = vertexCount++
  }
  const xy = new Float64Array(vertexCount * 2)
  const z = new Float64Array(vertexCount)
  for (let v = 0; v < vertexCount; v++) {
    const s = source[v] * 3
    xy[2 * v] = coords[s]
    xy[2 * v + 1] = coords[s + 1]
    z[v] = coords[s + 2]
  }
  const triangles = new Uint32Array(triangleCount * 3)
  for (let t = 0; t < triangleCount; t++) {
    const o = offsets[6] + 16 * t
    const a = view.getInt32(o, true),
      b = view.getInt32(o + 4, true),
      c = view.getInt32(o + 8, true)
    const ia = a >= 0 && a < tableCount ? outIndex[a] : -1
    const ib = b >= 0 && b < tableCount ? outIndex[b] : -1
    const ic = c >= 0 && c < tableCount ? outIndex[c] : -1
    if (ia < 0 || ib < 0 || ic < 0) refuse(`TIN triangle ${t} refers to a vertex the file does not hold.`)
    // Stored clockwise; written counter-clockwise.
    triangles[3 * t] = ia
    triangles[3 * t + 1] = ic
    triangles[3 * t + 2] = ib
  }
  return {
    coords: xy,
    z,
    triangles,
    maxSideM: Number.isFinite(maxSide) && maxSide > 0 && maxSide < 1e30 ? maxSide : null,
  }
}

/**
 * The `.tlt`'s `CoordSys` value (with or without `CoordSys=`). A WKT's own `PROJCS` authority wins;
 * otherwise `a|51|100ZZ` is NAD83 / UTM zone ZZ north (EPSG 269ZZ), the pattern LongRoad's
 * `10000|51|10015|…EPSG 26915` shows; anything else, `1|-1|-1` included, names no system.
 */
export function parseRoadEngCoordSys(line: string): RoadEngCoordSys {
  const raw = line.replace(/^\s*CoordSys\s*=\s*/i, '').trim()
  const parts = raw.split('|')
  const wktPart = parts.find((p) => /^\s*(PROJCS|GEOGCS|PROJCRS|GEOGCRS)\s*\[/i.test(p))
  const wkt = wktPart?.trim() ?? null
  if (wkt) return { raw, epsg: topAuthority(wkt), wkt, source: 'wkt' }
  const code = codeEpsg(parts)
  return code === null ? { raw, epsg: null, wkt: null, source: 'none' } : { raw, epsg: code, wkt: null, source: 'code' }
}

function codeEpsg(parts: string[]): number | null {
  const zone = /^100(\d\d)$/.exec(parts[2]?.trim() ?? '')
  if (parts[1]?.trim() !== '51' || !zone) return null
  const n = Number(zone[1])
  return n >= 1 && n <= 60 ? 26900 + n : null
}

/** The EPSG code in the outermost object's own AUTHORITY, never one nested in its GEOGCS. */
function topAuthority(wkt: string): number | null {
  let depth = 0
  for (let i = 0; i < wkt.length; i++) {
    const ch = wkt[i]
    if (ch === '[' || ch === '(') depth++
    else if (ch === ']' || ch === ')') depth--
    else if (depth === 1 && /^(AUTHORITY|ID)\s*\[/i.test(wkt.slice(i, i + 12))) {
      const m = /^(?:AUTHORITY|ID)\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?/i.exec(wkt.slice(i))
      if (m) return Number(m[1])
    }
  }
  return null
}

/** Reads a `.terx` archive: the terrain, its coordinate system and its layer patterns. */
export function readRoadEngTerrainArchive(bytes: Uint8Array): {
  terrain: RoadEngTerrain
  coordSys: RoadEngCoordSys
  /** .tlt layer name patterns, e.g. { pattern: 'CNTR*', description: 'Contours from model' } */
  layers: RoadEngLayer[]
  /** what was read and anything suspicious, for the import notice */
  warnings: string[]
} {
  if (bytes.length > MAX_ROADENG_TERRAIN_BYTES)
    throw Error(`The RoadEng terrain archive is over ${MAX_ROADENG_TERRAIN_BYTES / 1e6} MB.`)
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, {
      filter: (file) => /^Terrain\d*\.(ter|tlt)$/i.test(file.name) && file.originalSize <= MAX_ROADENG_TER_BYTES,
    })
  } catch {
    throw Error('This RoadEng terrain could not be unpacked: the archive is damaged or not a .terx.')
  }
  const names = Object.keys(entries).sort()
  const terName = names.find((n) => /\.ter$/i.test(n))
  if (!terName) throw Error('The RoadEng archive holds no terrain (no Terrain1.ter inside, or it is over 500 MB).')
  const terrain = parseRoadEngTer(entries[terName])
  const tltName = names.find((n) => n.toLowerCase() === terName.toLowerCase().replace(/\.ter$/, '.tlt'))
  const tlt = tltName ? readIni(strFromU8(entries[tltName], true)) : null
  const coordLine = tlt?.get('main')?.get('CoordSys')
  const coordSys = parseRoadEngCoordSys(coordLine ?? '')
  const layers: RoadEngLayer[] = [...(tlt?.get('TerLayers') ?? new Map<string, string>())]
    .map(([key, value]) => ({ n: /^Layer(\d+)$/i.exec(key), value }))
    .filter((e): e is { n: RegExpExecArray; value: string } => e.n !== null)
    .sort((a, b) => Number(a.n[1]) - Number(b.n[1]))
    .map(({ value }) => {
      const comma = value.indexOf(',')
      return comma < 0
        ? { pattern: value.trim(), description: '' }
        : {
            pattern: value.slice(0, comma).trim(),
            description: value
              .slice(comma + 1)
              .replace(/,\s*$/, '')
              .trim(),
          }
    })
    .filter((l) => l.pattern)

  const warnings: string[] = []
  const { features, tin } = terrain
  const points = features.reduce((s, f) => s + f.points.length / 3, 0)
  warnings.push(
    `Read ${plural(features.length, 'feature')} with ${plural(points, 'point')}` +
      (tin
        ? ` and a TIN of ${tin.z.length.toLocaleString('en-CA')} vertices and ${(tin.triangles.length / 3).toLocaleString('en-CA')} triangles` +
          ` from ${plural(features.filter((f) => f.inTin).length, 'feature')}.`
        : '; the terrain holds no TIN.'),
  )
  if (!tltName) warnings.push('The archive has no Terrain1.tlt, so its coordinate system and layers are unknown.')
  if (coordSys.source === 'none')
    warnings.push(
      coordLine && coordLine.trim()
        ? `The terrain names no coordinate system (CoordSys ${coordSys.raw}); say which one its grid is in.`
        : 'The terrain states no coordinate system; say which one its grid is in.',
    )
  else if (coordSys.source === 'code')
    warnings.push(
      `The terrain's coordinate system is NAD83 / UTM zone ${coordSys.epsg! - 26900}N (EPSG ${coordSys.epsg}), from RoadEng code ${coordSys.raw}.`,
    )
  else if (coordSys.epsg === null)
    warnings.push('The terrain gives its coordinate system as WKT with no EPSG code; check it before use.')
  else {
    const code = codeEpsg(coordSys.raw.split('|'))
    if (code !== null && code !== coordSys.epsg)
      warnings.push(
        `The terrain's coordinate system code says EPSG ${code} but its WKT says ${coordSys.epsg}; the WKT is used.`,
      )
  }
  return { terrain, coordSys, layers, warnings: [...warnings, ...terrain.warnings] }
}

const plural = (n: number, noun: string) => `${n.toLocaleString('en-CA')} ${noun}${n === 1 ? '' : 's'}`

function readIni(text: string): Map<string, Map<string, string>> {
  const sections = new Map<string, Map<string, string>>()
  let current: Map<string, string> | null = null
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    const header = /^\[(.+)\]$/.exec(line)
    if (header) {
      current = sections.get(header[1]) ?? new Map()
      sections.set(header[1], current)
    } else if (current) {
      const eq = line.indexOf('=')
      if (eq > 0) current.set(line.slice(0, eq).trim(), line.slice(eq + 1).trim())
    }
  }
  return sections
}

/**
 * Whether a feature name matches a `.tlt` layer pattern. Case is ignored; `*` matches any run and
 * `?` at most one character (RoadEng pads patterns to eight with `?`: `ROAD????` matches `ROAD`).
 */
export function roadEngLayerMatches(pattern: string, name: string): boolean {
  let compiled = layerPatterns.get(pattern)
  if (!compiled) {
    let re = ''
    for (const ch of pattern) re += ch === '*' ? '.*' : ch === '?' ? '.?' : ch.replace(/[\\^$.|+()[\]{}]/g, '\\$&')
    compiled = new RegExp(`^${re}$`, 'i')
    // A terrain lists a few dozen patterns; the cap only guards against a pathological file.
    if (layerPatterns.size > 1000) layerPatterns.clear()
    layerPatterns.set(pattern, compiled)
  }
  return compiled.test(name.trim())
}
/** Compiled once per pattern: classifying LongRoad's 18,266 features against 19 patterns took 0.9 s compiling them. */
const layerPatterns = new Map<string, RegExp>()

const CLASS_RULES: [RoadEngFeatureClass, RegExp][] = [
  ['stream', /\b(sml|med|lrg) stream\b|^stream|streams/i],
  ['road', /^road\b|road cl|^c-?line$|^cl$|^roads$/i],
  ['d-line', /^d-?line/i],
  ['landing', /^landing/i],
  ['rock-bluff', /^rock bluff/i],
  ['boundary', /^boundary|^falling bdy|^bound/i],
  ['breakline', /^break/i],
]

/** The feature's class for the importer; the rules are in the module comment. */
export function classifyRoadEngFeature(feature: RoadEngTerrainFeature, layers: RoadEngLayer[]): RoadEngFeatureClass {
  const matched = layers.filter((l) => roadEngLayerMatches(l.pattern, feature.name))
  const evidence = [feature.name, ...matched.map((l) => l.description)]
  const closed = feature.type === 'polygon' || feature.type === 'closed-line'
  if (closed && feature.flags & ROADENG_FLAG_BOUNDARY) return 'tin-boundary'
  const generated = /^cntr/i.test(feature.name) || matched.some((l) => /contours from model/i.test(l.description))
  if (generated && feature.flags & ROADENG_FLAG_NOT_MODELLED) return 'contour'
  for (const [cls, re] of CLASS_RULES) if (evidence.some((text) => re.test(text.trim()))) return cls
  const [, , , , minZ, maxZ] = feature.bbox
  if (feature.inTin && minZ === maxZ && feature.points.length > 3 && evidence.some((t) => /contour/i.test(t)))
    return 'source-contour'
  if (feature.flags & ROADENG_FLAG_POINT_SET || feature.type === 'point') return 'mass-points'
  return 'other'
}
