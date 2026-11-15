/**
 * A project's terrain written as a Softree RoadEng terrain (`.terx`), and a design and its terrain
 * as one zipped RoadEng project: the inverse of `roadEngTerrain.ts` and `roadEngProject.ts`.
 *
 * The `.terx` holds `Terrain1.ter` (format version 12, laid out as `roadEngTerrain.ts` reads it) and
 * `Terrain1.tlt`. It carries
 *
 * - **Ground**: the terrain grid's cells as mass points (flags 0x09 and `kind` 3, as RoadEng holds a
 *   gridded DEM read in rows, in point sets of at most {@link ROADENG_POINT_SET_SIZE}, the largest
 *   any sample holds), and a TIN of two triangles per cell whose four corners all have a level and
 *   one per cell with three (so a strip of terrain keeps its edges), stored clockwise with its
 *   neighbour table (−1 on hull edges) and a longest side of the cell's diagonal. A grid clipped
 *   to a corridor keeps the cells whose centres lie within its half-width of a corridor line; a
 *   grid still over the vertex budget keeps every n-th cell each way, and the notes say both.
 *   Levels are the grid's own at the cells kept, never averaged.
 * - **Drawn features**, left out of the TIN (flag 0x40) with their own levels (0 where none is
 *   given). Each is named for RoadEng's default feature code of its kind, followed by its own name
 *   (`Sml Stream - Willow Creek`, `Road CL - Spur 3`, `D-Line - DL 4`, `Boundary - …`,
 *   `Falling BDY - …`, `Landing - …`; anything else keeps its own name), with a sub ID counting
 *   features of the same name. The record holds the first 17 characters and an attribute group
 *   (chunk type 52) the full name when it is longer, as RoadEng does. `.tlt` layer patterns put
 *   each code on a layer. Every name is checked against `classifyRoadEngFeature` (and the felling
 *   rule of `roadEngProject.ts`), so PGMaps reads each feature back as the kind it was; a name that
 *   would read as another kind is replaced by the bare code (`Feature` for other kinds) and the
 *   notes say so.
 * - **The coordinate system**, in `.tlt` `[main] CoordSys` ({@link roadEngCoordSys}).
 *
 * Fields neither the reader nor the format study interprets get these values:
 *
 * - Header block: the two −1 "current feature/point" slots as every sample but one has them; the
 *   `u32` at +12 is the number of attribute chunks (it equals the chunk count in all four samples);
 *   the `u32` after the code table is 1, as in `RangeRoadTopo` (the sample most like this one, a
 *   gridded DEM); the eight bytes after the bounding box are zero.
 * - Feature records: +8 and +82 zero, `kind` 3 for the ground and 1 for drawn features, colours
 *   per kind (Windows COLORREF), points' flags and padding zero, the station origin 0.
 * - Section 3 holds only type-52 groups: no type-100 schema (RoadEng's own catalogue of its
 *   built-in fields, which this writes nothing into) and no type-58 format chunks.
 * - TIN header: 1, the vertex count with the three (−1, −1) placeholders, the triangle count, −1
 *   at +20, 0.5 at +48 and the longest side at +56, as in `RangeRoadTopo`; zero elsewhere.
 * - Section 8, RoadEng's cable-logging library, is 1,248 zero bytes: every sample's is that size,
 *   and its contents (yarder names among stale buffer text) are Softree's data, not terrain.
 * - The 24-byte trailer is `0c 00 01 00` and zeros; the samples end with a heap pointer instead.
 * - No `Terrain1.te1`: it is RoadEng's symbol library, an AutoCAD R14 drawing this cannot make
 *   (the design export leaves out `.ds3` for the same reason); RoadEng should fall back to its
 *   default symbols, as for a design without its `.ds3`.
 *
 * None of these choices has been opened in RoadEng itself; they keep every framing check of
 * `roadEngTerrain.ts` passing, and its tests read every archive this writes.
 *
 * Pure: no DOM or network access.
 */
import { strToU8, zipSync } from 'fflate'
import { csrsUtmZone } from '@/lib/geo/projectedCrs'
import type { LocalRaster } from '../dev-forestry/types'
import { parseRoadEngDesign } from './roadEngImport'
import {
  classifyRoadEngFeature,
  ROADENG_FLAG_NOT_MODELLED,
  ROADENG_FLAG_POINT_SET,
  ROADENG_TER_VERSION,
  type RoadEngFeatureClass,
  type RoadEngLayer,
  type RoadEngTerrainFeature,
} from './roadEngTerrain'

/** Ground points written at most; a grid over it keeps every n-th cell each way. */
export const ROADENG_EXPORT_MAX_VERTICES = 250_000
/** Points in one ground point set: the most any RoadEng sample holds in one. */
export const ROADENG_POINT_SET_SIZE = 1000
/** RoadEng's default feature-code library, the 11 codes every sample carries. */
export const ROADENG_DEFAULT_CODES = [
  'Sml Stream',
  'Med Stream',
  'Lrg Stream',
  'Road CL',
  'Backline',
  'D-Line',
  'BST',
  'Rock Bluff',
  'Boundary',
  'Falling BDY',
  'Landing',
] as const

const SECTION_COUNT = 9
const HEADER_BYTES = 2 + 4 * SECTION_COUNT
const HEADER_BLOCK_BYTES = 8336
const CODE_SLOTS = 32
const CODE_SLOT_BYTES = 258
const FEATURE_BYTES = 104
const POINT_BYTES = 40
const GROUP_BYTES = 16 + 4 + 256 + 8
const TIN_HEADER_BYTES = 64
const TIN_PLACEHOLDERS = 3
const CABLE_LIBRARY_BYTES = 1248
const TRAILER_BYTES = 24
const RECORD_NAME_CHARS = 17
const LONG_NAME_CHARS = 255
const FLT_MAX = 3.4028234663852886e38
const GROUND_NAME = 'DEM'
const ZIP_TIME = new Date(2000, 0, 1)
const SOFTWARE = ['[Software]', 'Version=11.000', 'Version2=11.0.673.0']

export type RoadEngExportFeatureKind =
  | 'stream'
  | 'road'
  | 'd-line'
  | 'boundary'
  | 'falling-boundary'
  | 'landing'
  | 'other'

export interface RoadEngExportFeature {
  name: string
  kind: RoadEngExportFeatureKind
  /** Grid metres; a level when known. */
  points: ReadonlyArray<readonly [number, number, number?]>
  /** A ring: written with its first point repeated at the end, as RoadEng closes a feature. */
  closed?: boolean
}

export interface RoadEngCorridor {
  /** Polylines in grid metres, such as the roads being exported. */
  lines: ReadonlyArray<ReadonlyArray<readonly [number, number]>>
  /** Cells whose centres lie within this of a line are kept, m. */
  halfWidthM: number
}

export interface RoadEngTerrainInput {
  /** The terrain grid in the target grid, metres: north-up, origin at the top-left cell's centre. */
  raster: Pick<LocalRaster, 'origin' | 'pixelSize' | 'width' | 'height' | 'values'> | null
  corridor?: RoadEngCorridor | null
  /** Ground points written at most; {@link ROADENG_EXPORT_MAX_VERTICES} by default. */
  maxVertices?: number
  features?: readonly RoadEngExportFeature[]
  /** The grid's CRS; null when it is not known. */
  coordSys: { epsg: number } | null
}

export interface RoadEngTerrainGroundSummary {
  /** Cells with a level in the grid. */
  cells: number
  /** Of those, the cells inside the corridor (all of them without one). */
  cellsInCorridor: number
  /** Every n-th cell each way was kept. */
  stride: number
  vertices: number
  triangles: number
  /** The TIN's longest side, m (the thinned cell's diagonal). */
  maxSideM: number
}

export interface RoadEngTerrainArchive {
  bytes: Uint8Array
  /** One sentence each, for the export notice. */
  notes: string[]
  ground: RoadEngTerrainGroundSummary | null
}

// ---- Coordinate system ----------------------------------------------------------------------------

const GCS_NAD83 =
  'GEOGCS["GCS_North_American_1983",DATUM["North_American_Datum_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG","4269"]]'
const GCS_CSRS =
  'GEOGCS["GCS_North_American_1983_CSRS",DATUM["D_North_American_1983_CSRS",SPHEROID["GRS_1980",6378137.0,298.257222101]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG","4617"]]'
const GCS_WGS84 =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'

const utmWkt = (name: string, gcs: string, zone: number, south: boolean, epsg: number) =>
  `PROJCS["${name}",${gcs},PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],` +
  `PARAMETER["False_Northing",${south ? '10000000.0' : '0.0'}],PARAMETER["Central_Meridian",${(zone * 6 - 183).toFixed(1)}],` +
  `PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0],AUTHORITY["EPSG","${epsg}"]]`

/** The ESRI WKT RoadEng stores for a CRS this workspace converts, or null. */
export function roadEngWkt(epsg: number): string | null {
  if (epsg === 3005)
    return (
      `PROJCS["NAD_1983_BC_Environment_Albers",${GCS_NAD83},PROJECTION["Albers"],PARAMETER["False_Easting",1000000.0],` +
      'PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",-126.0],PARAMETER["Standard_Parallel_1",50.0],' +
      'PARAMETER["Standard_Parallel_2",58.5],PARAMETER["Latitude_Of_Origin",45.0],UNIT["Meter",1.0],AUTHORITY["EPSG","3005"]]'
    )
  const csrs = csrsUtmZone(epsg)
  if (csrs !== null) return utmWkt(`NAD_1983_CSRS_UTM_Zone_${csrs}N`, GCS_CSRS, csrs, false, epsg)
  if (epsg >= 26901 && epsg <= 26923)
    return utmWkt(`NAD_1983_UTM_Zone_${epsg - 26900}N`, GCS_NAD83, epsg - 26900, false, epsg)
  if (epsg >= 32601 && epsg <= 32660)
    return utmWkt(`WGS_1984_UTM_Zone_${epsg - 32600}N`, GCS_WGS84, epsg - 32600, false, epsg)
  if (epsg >= 32701 && epsg <= 32760)
    return utmWkt(`WGS_1984_UTM_Zone_${epsg - 32700}S`, GCS_WGS84, epsg - 32700, true, epsg)
  return null
}

/**
 * The `.tlt` `CoordSys` value for a CRS. NAD83 / UTM zone ZZ takes LongRoad's form,
 * `10000|51|100ZZ|<ESRI WKT>|0`; the samples show no RoadEng code for any other system, so the
 * others carry their WKT with no code (`10000|-1|-1|<WKT>|0`), which `parseRoadEngCoordSys` reads
 * by the WKT's EPSG authority. A CRS without a WKT here, or none, is `1|-1|-1`, RoadEng's "not set".
 */
export function roadEngCoordSys(epsg: number | null): { value: string; written: boolean } {
  const wkt = epsg === null ? null : roadEngWkt(epsg)
  if (epsg === null || !wkt) return { value: '1|-1|-1', written: false }
  const code = epsg >= 26901 && epsg <= 26923 ? `51|100${String(epsg - 26900).padStart(2, '0')}` : '-1|-1'
  return { value: `10000|${code}|${wkt}|0`, written: true }
}

// ---- Ground ----------------------------------------------------------------------------------------

interface Ground {
  /** x, y, z per vertex, in vertex order */
  xyz: Float64Array
  /** clockwise triangles, three vertex indices each */
  triangles: Int32Array
  /** the triangle across each edge (v[j], v[j+1]), −1 on the hull */
  neighbours: Int32Array
  summary: RoadEngTerrainGroundSummary
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** 1 for each cell whose centre lies within the half-width of a corridor line. */
function corridorMask(
  raster: NonNullable<RoadEngTerrainInput['raster']>,
  corridor: RoadEngCorridor,
): { mask: Uint8Array; lines: number } {
  const { width, height } = raster
  const [ox, oy] = raster.origin
  const [px, py] = raster.pixelSize
  const w = corridor.halfWidthM
  const mask = new Uint8Array(width * height)
  let lines = 0
  // The capsule round one segment, cut by the row y = y0: an interval, the hull of the two end
  // discs' chords and the band's, since the capsule is convex.
  const mark = (ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax,
      dy = by - ay
    const len2 = dx * dx + dy * dy,
      len = Math.sqrt(len2)
    const r0 = Math.max(0, Math.ceil((oy - (Math.max(ay, by) + w)) / -py - 1e-9))
    const r1 = Math.min(height - 1, Math.floor((oy - (Math.min(ay, by) - w)) / -py + 1e-9))
    for (let r = r0; r <= r1; r++) {
      const y0 = oy + r * py
      let lo = Infinity,
        hi = -Infinity
      for (const [cx, cy] of [
        [ax, ay],
        [bx, by],
      ]) {
        const h = w * w - (y0 - cy) ** 2
        if (h >= 0) {
          const s = Math.sqrt(h)
          lo = Math.min(lo, cx - s)
          hi = Math.max(hi, cx + s)
        }
      }
      if (len > 0) {
        // |cross| ≤ w·len: C − dy·x; 0 ≤ dot ≤ len²: dx·x + D.
        const band = solve(-dy, dx * (y0 - ay) + dy * ax, -w * len, w * len)
        const along = solve(dx, -dx * ax + dy * (y0 - ay), 0, len2)
        const l = Math.max(band[0], along[0]),
          u = Math.min(band[1], along[1])
        if (l <= u) {
          lo = Math.min(lo, l)
          hi = Math.max(hi, u)
        }
      }
      if (!(lo <= hi)) continue
      const c0 = Math.max(0, Math.ceil((lo - ox) / px - 1e-9))
      const c1 = Math.min(width - 1, Math.floor((hi - ox) / px + 1e-9))
      if (c0 <= c1) mask.fill(1, r * width + c0, r * width + c1 + 1)
    }
  }
  for (const line of corridor.lines) {
    const pts = line.filter((p) => finite(p[0]) && finite(p[1]))
    if (!pts.length) continue
    lines++
    if (pts.length === 1) mark(pts[0][0], pts[0][1], pts[0][0], pts[0][1])
    for (let k = 1; k < pts.length; k++) mark(pts[k - 1][0], pts[k - 1][1], pts[k][0], pts[k][1])
  }
  return { mask, lines }
}

/** The x with lo ≤ a·x + b ≤ hi, as an interval (everything or nothing when a is 0). */
function solve(a: number, b: number, lo: number, hi: number): [number, number] {
  if (a === 0) return lo <= b && b <= hi ? [-Infinity, Infinity] : [Infinity, -Infinity]
  const p = (lo - b) / a,
    q = (hi - b) / a
  return p <= q ? [p, q] : [q, p]
}

type Side = 'top' | 'right' | 'bottom' | 'left' | 'diagonal'
/** Corners 0 TL, 1 TR, 2 BL, 3 BR. Each triangle is clockwise; `sides[j]` is the edge (j, j + 1). */
interface CellTriangle {
  corners: [number, number, number]
  sides: [Side, Side, Side]
}
const A: CellTriangle = { corners: [0, 1, 2], sides: ['top', 'diagonal', 'left'] }
const B: CellTriangle = { corners: [1, 3, 2], sides: ['right', 'bottom', 'diagonal'] }
/** By corner pattern (TL 1, TR 2, BL 4, BR 8): the triangles a cell makes, or none. */
const CELL_TRIANGLES: (CellTriangle[] | null)[] = Array.from({ length: 16 }, () => null)
CELL_TRIANGLES[15] = [A, B]
CELL_TRIANGLES[1 | 2 | 4] = [A]
CELL_TRIANGLES[2 | 4 | 8] = [B]
CELL_TRIANGLES[1 | 4 | 8] = [{ corners: [0, 3, 2], sides: ['diagonal', 'bottom', 'left'] }]
CELL_TRIANGLES[1 | 2 | 8] = [{ corners: [0, 1, 3], sides: ['top', 'right', 'diagonal'] }]

function buildGround(input: RoadEngTerrainInput, notes: string[]): Ground | null {
  const raster = input.raster
  if (!raster) {
    notes.push('No terrain grid was given, so the terrain holds only the drawn features.')
    return null
  }
  const { width, height, values } = raster
  const [ox, oy] = raster.origin
  const [px, py] = raster.pixelSize
  if (!(Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0))
    throw Error('The terrain grid has no cells to export.')
  if (values.length !== width * height) throw Error('The terrain grid holds a different number of cells than its size.')
  if (!(px > 0 && py < 0 && finite(ox) && finite(oy)))
    throw Error('The terrain grid must be north-up, with cells running east and south from its top-left cell.')
  const budget = Math.max(4, Math.floor(input.maxVertices ?? ROADENG_EXPORT_MAX_VERTICES))
  const corridor = input.corridor && input.corridor.halfWidthM > 0 ? corridorMask(raster, input.corridor) : null
  const valid = new Uint8Array(width * height)
  let cells = 0,
    inCorridor = 0
  for (let i = 0; i < values.length; i++) {
    if (!finite(values[i])) continue
    cells++
    if (corridor && !corridor.mask[i]) continue
    valid[i] = 1
    inCorridor++
  }
  const count = (s: number) => {
    let n = 0
    for (let r = 0; r < height; r += s) for (let c = 0, i = r * width; c < width; c += s, i += s) n += valid[i]
    return n
  }
  let stride = 1
  if (inCorridor > budget) {
    stride = Math.max(2, Math.ceil(Math.sqrt(inCorridor / budget)))
    while (count(stride) > budget) stride++
  }
  const fmt = (n: number) => n.toLocaleString('en-CA')
  if (corridor)
    notes.push(
      `${fmt(inCorridor)} of the terrain's ${fmt(cells)} cells lie within ${num(input.corridor!.halfWidthM)} m of ` +
        `the ${corridor.lines === 1 ? 'corridor line' : `${corridor.lines} corridor lines`}; the rest are left out.`,
    )
  const tw = Math.ceil(width / stride),
    th = Math.ceil(height / stride)
  const ids = new Int32Array(tw * th).fill(-1)
  let vertices = 0
  for (let r = 0; r < th; r++)
    for (let c = 0; c < tw; c++) if (valid[r * stride * width + c * stride]) ids[r * tw + c] = vertices++
  const xyz = new Float64Array(vertices * 3)
  for (let r = 0; r < th; r++)
    for (let c = 0; c < tw; c++) {
      const v = ids[r * tw + c]
      if (v < 0) continue
      xyz[3 * v] = ox + c * stride * px
      xyz[3 * v + 1] = oy + r * stride * py
      xyz[3 * v + 2] = values[r * stride * width + c * stride] as number
    }
  if (stride > 1)
    notes.push(
      `To stay within ${fmt(budget)} points, every ${ordinal(stride)} cell each way is kept (${num(stride * px)} m by ` +
        `${num(-stride * py)} m): ${fmt(vertices)} of ${fmt(inCorridor)} cells, at their own levels.`,
    )

  // Clockwise triangles per cell, from the corners that have a level (TL, TR, BL, BR as bits 1, 2,
  // 4, 8): all four make A = (TL, TR, BL) and B = (TR, BR, BL), split on the TR–BL diagonal; three
  // make the one triangle they span. Each side of a cell then belongs to at most one triangle, so
  // the triangle across a side is the one owning the same side of the next cell.
  const cw = Math.max(0, tw - 1),
    ch = Math.max(0, th - 1)
  const cellTri = new Int32Array(cw * ch).fill(-1)
  const pattern = (c: number, r: number) => {
    const i = r * tw + c
    return (
      (ids[i] >= 0 ? 1 : 0) | (ids[i + 1] >= 0 ? 2 : 0) | (ids[i + tw] >= 0 ? 4 : 0) | (ids[i + tw + 1] >= 0 ? 8 : 0)
    )
  }
  let triangleCount = 0,
    partial = 0
  for (let r = 0; r < ch; r++)
    for (let c = 0; c < cw; c++) {
      const made = CELL_TRIANGLES[pattern(c, r)]
      if (!made) continue
      cellTri[r * cw + c] = triangleCount
      triangleCount += made.length
      if (made.length === 1) partial++
    }
  /** The triangle owning one side of a cell, or −1. */
  const owner = (c: number, r: number, side: Side) => {
    if (c < 0 || r < 0 || c >= cw || r >= ch) return -1
    const first = cellTri[r * cw + c]
    if (first < 0) return -1
    const k = CELL_TRIANGLES[pattern(c, r)]!.findIndex((t) => t.sides.includes(side))
    return k < 0 ? -1 : first + k
  }
  const across: Record<Side, (c: number, r: number) => number> = {
    top: (c, r) => owner(c, r - 1, 'bottom'),
    bottom: (c, r) => owner(c, r + 1, 'top'),
    left: (c, r) => owner(c - 1, r, 'right'),
    right: (c, r) => owner(c + 1, r, 'left'),
    diagonal: () => -1,
  }
  const triangles = new Int32Array(triangleCount * 3)
  const neighbours = new Int32Array(triangleCount * 3)
  for (let r = 0; r < ch; r++)
    for (let c = 0; c < cw; c++) {
      const first = cellTri[r * cw + c]
      if (first < 0) continue
      const i = r * tw + c
      const corner = [ids[i], ids[i + 1], ids[i + tw], ids[i + tw + 1]]
      const made = CELL_TRIANGLES[pattern(c, r)]!
      made.forEach((t, k) => {
        const o = 3 * (first + k)
        for (let j = 0; j < 3; j++) {
          triangles[o + j] = corner[t.corners[j]]
          const side = t.sides[j]
          // A complete cell's two triangles meet on its diagonal.
          neighbours[o + j] = side === 'diagonal' ? (made.length === 2 ? first + 1 - k : -1) : across[side](c, r)
        }
      })
    }
  const maxSideM = Math.ceil(Math.hypot(stride * px, stride * py) * 1000) / 1000
  if (triangleCount)
    notes.push(
      `The ground is ${fmt(vertices)} mass points and a TIN of ${fmt(triangleCount)} triangles: two to each ` +
        `cell with a level at all four corners${partial ? `, one to each of ${fmt(partial)} cells with three` : ''}; ` +
        `the longest side is ${num(maxSideM)} m.`,
    )
  else if (vertices)
    notes.push(`No cell has a level at three of its corners, so the ${fmt(vertices)} points have no TIN.`)
  else notes.push('No cell with a level lies in the corridor, so the terrain has no ground.')
  return {
    xyz,
    triangles,
    neighbours,
    summary: { cells, cellsInCorridor: inCorridor, stride, vertices, triangles: triangleCount, maxSideM },
  }
}

const num = (v: number) => {
  const text = v.toFixed(3).replace(/\.?0+$/, '')
  return text === '-0' ? '0' : text
}
const ordinal = (n: number) => {
  const tens = n % 100
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')
  return `${n}${suffix}`
}

// ---- Drawn features ---------------------------------------------------------------------------------

const KIND_CODE: Record<RoadEngExportFeatureKind, string | null> = {
  stream: 'Sml Stream',
  road: 'Road CL',
  'd-line': 'D-Line',
  boundary: 'Boundary',
  'falling-boundary': 'Falling BDY',
  landing: 'Landing',
  other: null,
}
const KIND_CLASS: Record<RoadEngExportFeatureKind, RoadEngFeatureClass> = {
  stream: 'stream',
  road: 'road',
  'd-line': 'd-line',
  boundary: 'boundary',
  'falling-boundary': 'boundary',
  landing: 'landing',
  other: 'other',
}
/** Windows COLORREF, 0x00BBGGRR. */
const KIND_COLORREF: Record<RoadEngExportFeatureKind, number> = {
  stream: 0xff0000, // blue
  road: 0x0000ff, // red
  'd-line': 0xff00ff, // magenta
  boundary: 0x000080, // dark red, as the samples' boundary
  'falling-boundary': 0x008000, // green
  landing: 0x00ffff, // yellow
  other: 0x7f7f7f, // grey
}
const KIND_LABEL: Record<RoadEngExportFeatureKind, [string, string]> = {
  stream: ['stream', 'streams'],
  road: ['road', 'roads'],
  'd-line': ['D-line', 'D-lines'],
  boundary: ['boundary', 'boundaries'],
  'falling-boundary': ['felling boundary', 'felling boundaries'],
  landing: ['landing', 'landings'],
  other: ['other feature', 'other features'],
}

/**
 * The `.tlt` layer patterns: RoadEng's six default layers, one for each code written and one for
 * the ground. Each description reads as its own kind (or none) under `classifyRoadEngFeature`.
 */
const LAYERS: RoadEngLayer[] = [
  { pattern: 'CNTR*', description: 'Contours from model' },
  { pattern: 'ROAD*', description: 'Roads' },
  { pattern: 'STREAM*', description: 'Streams Rivers Creeks' },
  { pattern: 'BREAK*', description: 'Break Lines' },
  { pattern: 'BOUND*', description: 'Boundary' },
  { pattern: 'SSCT', description: 'Surface Intersections' },
  { pattern: 'SML STREAM*', description: 'Small streams' },
  { pattern: 'D-LINE*', description: 'D-Lines' },
  { pattern: 'FALLING BDY*', description: 'Falling boundaries' },
  { pattern: 'LANDING*', description: 'Landings' },
  { pattern: `${GROUND_NAME}*`, description: 'Ground points from PG Maps' },
]
export const ROADENG_EXPORT_LAYERS: readonly RoadEngLayer[] = LAYERS

/** Text RoadEng's Latin-1 fields can hold: other characters become "?", controls a space. */
const latin1 = (text: string) =>
  Array.from(text, (ch) => {
    const code = ch.charCodeAt(0)
    return code < 0x20 || code === 0x7f ? ' ' : ch.length > 1 || code > 0xff ? '?' : ch
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()

interface DrawnFeature {
  name: string
  kind: RoadEngExportFeatureKind
  xyz: Float64Array
  /** the user's name was replaced to keep the kind */
  renamed: boolean
  /** PGMaps will not read it back as its kind whatever its name (a one-point "other") */
  mismatch: boolean
}

/** Whether PGMaps reads a feature of this name and shape back as the kind it was written as. */
function readsBackAs(name: string, xyz: Float64Array, kind: RoadEngExportFeatureKind): boolean {
  const n = xyz.length / 3
  const closed = n >= 4 && xyz[0] === xyz[3 * n - 3] && xyz[1] === xyz[3 * n - 2]
  const feature: RoadEngTerrainFeature = {
    index: 0,
    name,
    subId: 0,
    color: null,
    flags: ROADENG_FLAG_NOT_MODELLED,
    kind: 1,
    type: n === 1 ? 'point' : closed ? 'closed-line' : 'line',
    points: xyz,
    inTin: false,
    stationOrigin: 0,
    lengthM: 0,
    bbox: bboxOf(xyz),
  }
  if (classifyRoadEngFeature(feature, LAYERS) !== KIND_CLASS[kind]) return false
  // roadEngProject.ts: a closed boundary whose name says "fall" is a felling boundary.
  if (kind === 'boundary' && closed && /fall/i.test(name)) return false
  if (kind === 'falling-boundary' && !/fall/i.test(name)) return false
  return true
}

function drawnFeatures(features: readonly RoadEngExportFeature[], notes: string[]): DrawnFeature[] {
  const out: DrawnFeature[] = []
  let unusable = 0
  for (const f of features) {
    const pts = f.points.filter((p) => finite(p[0]) && finite(p[1]))
    if (!pts.length) {
      unusable++
      continue
    }
    const distinct = new Set(pts.map((p) => `${p[0]},${p[1]}`)).size
    const first = pts[0],
      last = pts[pts.length - 1]
    const close = f.closed === true && distinct >= 3 && (first[0] !== last[0] || first[1] !== last[1])
    const all = close ? [...pts, first] : pts
    const xyz = new Float64Array(all.length * 3)
    all.forEach((p, k) => {
      xyz[3 * k] = p[0]
      xyz[3 * k + 1] = p[1]
      xyz[3 * k + 2] = finite(p[2]) ? p[2] : 0
    })
    const own = latin1(f.name)
    const code = KIND_CODE[f.kind]
    const preferred = code
      ? own && !own.toLowerCase().startsWith(code.toLowerCase())
        ? `${code} - ${own}`
        : own || code
      : own || 'Feature'
    const candidates = [preferred.slice(0, LONG_NAME_CHARS).trim(), code ?? 'Feature']
    const name = candidates.find((c) => readsBackAs(c, xyz, f.kind))
    out.push({
      name: name ?? candidates[0],
      kind: f.kind,
      xyz,
      renamed: name !== undefined && name !== candidates[0],
      mismatch: name === undefined,
    })
  }
  const fmt = (n: number) => n.toLocaleString('en-CA')
  const tally = new Map<RoadEngExportFeatureKind, number>()
  for (const f of out) tally.set(f.kind, (tally.get(f.kind) ?? 0) + 1)
  if (out.length)
    notes.push(
      `Drawn features, left out of the TIN: ${[...tally].map(([kind, n]) => `${fmt(n)} ${KIND_LABEL[kind][n === 1 ? 0 : 1]}`).join(', ')}.`,
    )
  const renamed = out.filter((f) => f.renamed)
  if (renamed.length) {
    const names = [...new Set(renamed.map((f) => f.name))]
    notes.push(
      `${renamed.length === 1 ? '1 feature is' : `${fmt(renamed.length)} features are`} written as ` +
        `${names.slice(0, 3).join(', ')}${names.length > 3 ? ' and others' : ''}: ` +
        `${renamed.length === 1 ? 'its own name reads' : 'their own names read'} as another kind.`,
    )
  }
  const mismatched = out.filter((f) => f.mismatch).length
  if (mismatched)
    notes.push(
      `${mismatched === 1 ? '1 single-point feature' : `${fmt(mismatched)} single-point features`} of no RoadEng code ` +
        'will read back into PG Maps as terrain points.',
    )
  if (unusable) notes.push(`${fmt(unusable)} drawn features without coordinates are left out.`)
  return out
}

// ---- Terrain1.ter -------------------------------------------------------------------------------------

function bboxOf(xyz: Float64Array): [number, number, number, number, number, number] {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity
  for (let k = 0; k < xyz.length; k += 3) {
    const x = xyz[k],
      y = xyz[k + 1],
      z = xyz[k + 2]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
    if (z < minZ) minZ = z
    if (z > maxZ) maxZ = z
  }
  return [minX, maxX, minY, maxY, minZ, maxZ]
}

function planLength(xyz: Float64Array): number {
  let length = 0
  for (let k = 3; k < xyz.length; k += 3) length += Math.hypot(xyz[k] - xyz[k - 3], xyz[k + 1] - xyz[k - 2])
  return length
}

interface TerRecord {
  name: string
  subId: number
  colorRef: number
  flags: number
  kind: number
  xyz: Float64Array
  /** the full name needs an attribute group */
  group: boolean
}

/** `Terrain1.ter`, laid out as `parseRoadEngTer` reads format version 12. */
function writeTer(ground: Ground | null, drawn: readonly DrawnFeature[]): Uint8Array {
  const records: TerRecord[] = []
  if (ground)
    for (let start = 0, sub = 0; start < ground.summary.vertices; start += ROADENG_POINT_SET_SIZE, sub++)
      records.push({
        name: GROUND_NAME,
        subId: sub,
        colorRef: 0,
        flags: ROADENG_FLAG_POINT_SET | 0x01,
        kind: 3,
        xyz: ground.xyz.subarray(3 * start, 3 * Math.min(ground.summary.vertices, start + ROADENG_POINT_SET_SIZE)),
        group: false,
      })
  const subIds = new Map<string, number>()
  for (const f of drawn) {
    const key = f.name.toLowerCase()
    const sub = subIds.get(key) ?? 0
    subIds.set(key, sub + 1)
    records.push({
      name: f.name,
      subId: sub,
      colorRef: KIND_COLORREF[f.kind],
      flags: ROADENG_FLAG_NOT_MODELLED,
      kind: 1,
      xyz: f.xyz,
      group: f.name.length > RECORD_NAME_CHARS,
    })
  }
  if (!records.length) throw Error('There is nothing to write: no terrain cell with a level and no drawn feature.')

  const pointTotal = records.reduce((s, r) => s + r.xyz.length / 3, 0)
  const groups = records.filter((r) => r.group).length
  const tin = ground && ground.summary.triangles ? ground : null
  const sizes = [
    HEADER_BLOCK_BYTES,
    FEATURE_BYTES * records.length,
    POINT_BYTES * pointTotal,
    GROUP_BYTES * groups,
    TIN_HEADER_BYTES,
    tin ? 8 * (tin.summary.vertices + TIN_PLACEHOLDERS) : 0,
    tin ? 16 * tin.summary.triangles : 0,
    tin ? 16 * tin.summary.triangles : 0,
    CABLE_LIBRARY_BYTES,
  ]
  const offsets: number[] = []
  let end = HEADER_BYTES
  for (const size of sizes) {
    offsets.push(end)
    end += size
  }
  const bytes = new Uint8Array(end + TRAILER_BYTES)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string, width: number) => {
    const encoded = strToU8(value, true)
    bytes.set(encoded.subarray(0, Math.min(encoded.length, width - 1)), at)
  }
  view.setUint16(0, ROADENG_TER_VERSION, true)
  sizes.forEach((size, i) => view.setUint32(2 + 4 * i, size, true))

  // Section 0: header block.
  const h = offsets[0]
  view.setUint32(h, records.length, true)
  view.setInt32(h + 4, -1, true)
  view.setInt32(h + 8, -1, true)
  view.setUint32(h + 12, groups, true)
  view.setUint32(h + 16, ROADENG_DEFAULT_CODES.length, true)
  ROADENG_DEFAULT_CODES.forEach((code, k) => {
    const o = h + 20 + k * CODE_SLOT_BYTES
    view.setUint16(o, 1, true)
    text(o + 2, code, CODE_SLOT_BYTES - 2)
  })
  const after = h + 20 + CODE_SLOTS * CODE_SLOT_BYTES
  view.setUint32(after, 1, true)
  const fileBox = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]

  // Sections 1 and 2: records and points.
  let point = offsets[2]
  records.forEach((record, i) => {
    const r = offsets[1] + i * FEATURE_BYTES
    const count = record.xyz.length / 3
    const box = bboxOf(record.xyz)
    for (let k = 0; k < 6; k++) fileBox[k] = k % 2 ? Math.max(fileBox[k], box[k]) : Math.min(fileBox[k], box[k])
    view.setUint32(r, count, true)
    view.setUint32(r + 4, record.subId, true)
    view.setUint32(r + 12, record.colorRef, true)
    view.setFloat64(r + 16, 0, true)
    view.setFloat64(r + 24, planLength(record.xyz), true)
    box.forEach((v, k) => view.setFloat64(r + 32 + 8 * k, v, true))
    view.setUint16(r + 80, record.flags, true)
    view.setUint16(r + 84, record.kind, true)
    text(r + 86, record.name.slice(0, RECORD_NAME_CHARS), RECORD_NAME_CHARS + 1)
    for (let k = 0; k < count; k++, point += POINT_BYTES) {
      view.setFloat64(point, record.xyz[3 * k], true)
      view.setFloat64(point + 8, record.xyz[3 * k + 1], true)
      view.setFloat64(point + 16, record.xyz[3 * k + 2], true)
    }
  })
  fileBox.forEach((v, k) => view.setFloat64(after + 4 + 8 * k, v, true))

  // Section 3: an attribute group (type 52) holding each long name in full.
  let chunk = offsets[3]
  records.forEach((record, i) => {
    if (!record.group) return
    view.setUint32(chunk, GROUP_BYTES, true)
    view.setUint32(chunk + 4, 2, true)
    view.setUint32(chunk + 8, 52, true)
    view.setInt32(chunk + 12, -1, true)
    view.setInt32(chunk + 16, i, true)
    text(chunk + 20, record.name, 256)
    view.setUint32(chunk + 280, record.subId, true)
    chunk += GROUP_BYTES
  })

  // Sections 4–7: the TIN over the ground records, which come first and in vertex order.
  const t = offsets[4]
  view.setUint32(t, tin ? 1 : 0, true)
  view.setUint32(t + 4, tin ? tin.summary.vertices + TIN_PLACEHOLDERS : 0, true)
  view.setUint32(t + 16, tin ? tin.summary.triangles : 0, true)
  view.setInt32(t + 20, -1, true)
  view.setFloat64(t + 48, 0.5, true)
  view.setFloat64(t + 56, tin ? tin.summary.maxSideM : FLT_MAX, true)
  if (tin) {
    let o = offsets[5]
    for (let k = 0; k < TIN_PLACEHOLDERS; k++, o += 8) {
      view.setInt32(o, -1, true)
      view.setInt32(o + 4, -1, true)
    }
    for (let v = 0; v < tin.summary.vertices; v++, o += 8) {
      view.setInt32(o, Math.floor(v / ROADENG_POINT_SET_SIZE), true)
      view.setInt32(o + 4, v % ROADENG_POINT_SET_SIZE, true)
    }
    for (let k = 0; k < tin.summary.triangles; k++) {
      const a = offsets[6] + 16 * k,
        b = offsets[7] + 16 * k
      for (let j = 0; j < 3; j++) {
        view.setInt32(a + 4 * j, tin.triangles[3 * k + j] + TIN_PLACEHOLDERS, true)
        view.setInt32(b + 4 * j, tin.neighbours[3 * k + j], true)
      }
    }
  }
  // Section 8 stays zero; the trailer opens as the samples' does.
  const trailer = end
  view.setUint16(trailer, 0x0c, true)
  view.setUint16(trailer + 2, 1, true)
  return bytes
}

/** `Terrain1.tlt`: the software, the coordinate system, the units and the layer patterns. */
function writeTlt(coordSys: string): string {
  return [
    ...SOFTWARE,
    '[main]',
    `CoordSys=${coordSys}`,
    'units=10000',
    '[TerLayers]',
    ...LAYERS.map((l, k) => `Layer${k}=${l.pattern},${l.description},`),
    '',
  ].join('\r\n')
}

/** A project's terrain grid and drawn features as a RoadEng `.terx`; the module comment has the layout. */
export function roadEngTerrainArchive(input: RoadEngTerrainInput): RoadEngTerrainArchive {
  const notes: string[] = []
  const ground = buildGround(input, notes)
  const drawn = drawnFeatures(input.features ?? [], notes)
  const ter = writeTer(ground, drawn)
  const epsg = input.coordSys?.epsg ?? null
  const coordSys = roadEngCoordSys(epsg)
  if (epsg === null) notes.push('The terrain states no coordinate system: RoadEng will show it as not set.')
  else if (!coordSys.written)
    notes.push(`EPSG:${epsg} has no RoadEng form here, so the terrain states no coordinate system.`)
  else if (!(epsg >= 26901 && epsg <= 26923))
    notes.push(`EPSG:${epsg} is written as its WKT alone; RoadEng's own code for it is not known.`)
  const bytes = zipSync(
    { 'Terrain1.ter': ter, 'Terrain1.tlt': strToU8(writeTlt(coordSys.value), true) },
    { mtime: ZIP_TIME },
  )
  return { bytes, notes, ground: ground?.summary ?? null }
}

// ---- Zipped project -----------------------------------------------------------------------------------

/** The file names a zipped RoadEng project uses for a name: pass `terrain` to `roadEngDesign` as `terrainName`. */
export function roadEngProjectFileNames(name: string): { stem: string; design: string; terrain: string; zip: string } {
  const stem =
    latin1(name)
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120)
      .trim() || 'PG Maps road'
  return { stem, design: `${stem}.dsnx`, terrain: `${stem}.terx`, zip: `${stem}.zip` }
}

/**
 * A zipped RoadEng project, as RoadEng's "Zipped RoadEng Project" holds one: `<name>.dsnx` and,
 * when given, `<name>.terx`. The design must name that terrain (`[design] surface`, written by
 * `roadEngDesign` from its `terrainName`), or RoadEng would open it on no ground.
 */
export function roadEngProjectZip({
  name,
  design,
  terrain,
}: {
  name: string
  design: Uint8Array
  terrain: Uint8Array | null
}): Uint8Array {
  const files = roadEngProjectFileNames(name)
  const named = parseRoadEngDesign(design).terrain
  if (terrain && named?.toLowerCase() !== files.terrain.toLowerCase())
    throw Error(
      `The design ${named ? `names its terrain ${named}` : 'names no terrain'}; write it with the terrain name ${files.terrain}.`,
    )
  // Both parts are archives already: stored, not compressed again.
  return zipSync(
    {
      [files.design]: [design, { level: 0 }],
      ...(terrain ? { [files.terrain]: [terrain, { level: 0 }] } : {}),
    },
    { mtime: ZIP_TIME },
  )
}
