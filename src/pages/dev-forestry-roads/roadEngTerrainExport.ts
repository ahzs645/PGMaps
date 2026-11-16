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
 * - **D-lines with their cable settings**: a `d-line` feature given a `dLine` gets an attribute
 *   group (type 52) and RoadEng's D-line chunks (`roadEngDLines.ts`), so RoadEng opens it as a
 *   D-line on its logging system.
 * - **Logging systems** in section 8 (`roadEngLoggingSystems.ts`) and **map notes** in the tail
 *   (`roadEngMapNotes.ts`), when given.
 *
 * **Writing back what PG Maps does not model.** Given the `source` a terrain was read with
 * (`readRoadEngTerrainArchive`), the writer keeps
 *
 * - `Terrain1.tlt` merged key by key: `[main] CoordSys` (kept as read when it names the same EPSG
 *   code), `[main] units` and `[TerLayers]` are the writer's (the source's layers first, then any of
 *   the writer's it lacks), and so are the `[EQUIPn]` equipment sections when logging systems are
 *   given; every other line keeps its text, its place and its CRLF;
 * - `Terrain1.te1`, the symbol library, byte for byte;
 * - section 0's code table and the fields after it and after the bounding box;
 * - section 3's schema (type 100) and defaults entry, ahead of the features' groups;
 * - section 8 as read, unless logging systems are given;
 * - the map-notes tail as read, unless notes are given.
 *
 * Features, points and the TIN are the same with a source as without one: the source adds parts,
 * it never changes the ground or what was drawn.
 *
 * **Writing over RoadEng's own `Terrain1.ter`** (`original`, `roadEngTerrainOriginal.ts`): the file
 * as read is the base and the grid is not written. Its TIN, points and every feature with its codes
 * and attribute chunks are copied byte for byte; only the features the caller names are rewritten
 * in their place or left out, and the other features given are added after the file's own
 * ({@link roadEngTerLayout} and `spliceTer` below). Section 8 and the map-notes tail are the file's
 * own unless systems or notes are given. With nothing changed, `Terrain1.ter` comes back as read.
 *
 * Fields neither the reader nor the format study interprets get these values:
 *
 * - Header block: the two −1 "current feature/point" slots as every sample but one has them; the
 *   `u32` at +12 is the number of attribute chunks (it equals the chunk count in all four samples);
 *   the `u32` after the code table is 1, as in `RangeRoadTopo` (the sample most like this one, a
 *   gridded DEM); the eight bytes after the bounding box are zero.
 * - Feature records: +8 and +82 zero, `kind` 3 for the ground and 1 for drawn features, colours
 *   per kind (Windows COLORREF), points' flags and padding zero, the station origin 0.
 * - Without a source, section 3 holds only type-52 groups and D-line chunks: no type-100 schema
 *   (RoadEng's own catalogue of its built-in fields, which this writes nothing into) and no type-58
 *   format chunks. The header's `u32` at +12 counts every chunk written.
 * - TIN header: 1, the vertex count with the three (−1, −1) placeholders, the triangle count, −1
 *   at +20, 0.5 at +48 and the longest side at +56, as in `RangeRoadTopo`; zero elsewhere.
 * - Section 8, the logging-system library: the systems given, else the source's, else empty (size
 *   0). Its records are 312 bytes each with no count stored elsewhere, so an empty section reads as
 *   a library of no systems; RoadEng's own samples always hold four or more, and an empty one has
 *   not been opened in RoadEng (zeros, as written before, would have read as four unnamed systems).
 * - The tail is the map-notes block: the notes given, else the source's, else the bare 24 bytes
 *   `0c 00 01 00` and zeros (the samples end with a stale pointer instead).
 * - No `Terrain1.te1` without a source: it is RoadEng's symbol library, an AutoCAD R14 drawing this
 *   cannot make (the design export leaves out `.ds3` for the same reason); RoadEng should fall back
 *   to its default symbols, as for a design without its `.ds3`.
 *
 * None of these choices has been opened in RoadEng itself; they keep every framing check of
 * `roadEngTerrain.ts` passing, and its tests read every archive this writes.
 *
 * Pure: no DOM or network access.
 */
import { strToU8, zipSync } from 'fflate'
import { csrsUtmZone } from '@/lib/geo/projectedCrs'
import type { LocalRaster } from '../dev-forestry/types'
import {
  encodeRoadEngDLineChunks,
  roadEngDLineChunkCount,
  ROADENG_DLINE_CHUNKS,
  type RoadEngDLine,
} from './roadEngDLines'
import { parseRoadEngDesign } from './roadEngImport'
import {
  encodeRoadEngLoggingSystems,
  roadEngEquipmentEdits,
  ROADENG_LOGGING_SYSTEM_BYTES,
  type RoadEngLoggingSystem,
} from './roadEngLoggingSystems'
import { encodeRoadEngMapNotes, type RoadEngMapNote } from './roadEngMapNotes'
import {
  classifyRoadEngFeature,
  parseRoadEngCoordSys,
  roadEngLayerMatches,
  ROADENG_CODE_TABLE_BYTES,
  ROADENG_FLAG_NOT_MODELLED,
  ROADENG_FLAG_POINT_SET,
  ROADENG_FORMAT_CHUNK,
  ROADENG_TER_VERSION,
  type RoadEngFeatureClass,
  type RoadEngLayer,
  type RoadEngTerrainFeature,
  type RoadEngTerrainSource,
} from './roadEngTerrain'
import {
  base64ToBytes,
  cString,
  editRoadEngIni,
  putCString,
  readRoadEngIni,
  roadEngIniValue,
  type RoadEngIniEdit,
} from './roadEngText'

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
  /**
   * A `d-line` only: RoadEng's cable settings (`roadEngDLineFor`), whose spar stations run along
   * these points from the first. The yarder is the first point.
   */
  dLine?: RoadEngDLine
  /** The record's colour as a Windows COLORREF (`roadEngLookFromStyle`); the kind's colour when absent. */
  colorRef?: number
  /** The feature's display format, a type-58 chunk payload (`patchRoadEngFormatChunk`), written in its group. */
  formatChunk?: Uint8Array
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
  /** What PG Maps kept of the RoadEng terrain this came from (`readRoadEngTerrainArchive`). */
  source?: RoadEngTerrainSource | null
  /** Logging systems for section 8; absent: the source's library, or none. */
  loggingSystems?: readonly RoadEngLoggingSystem[] | null
  /** Map notes for the tail, in the target grid; absent: the source's notes, or none. */
  mapNotes?: readonly RoadEngMapNote[] | null
  /**
   * RoadEng's own `Terrain1.ter` to write back as the base: its ground and features stay as read
   * and `raster` and `corridor` are not used. See {@link RoadEngOriginalBase}.
   */
  original?: RoadEngOriginalBase | null
}

/** RoadEng's own `Terrain1.ter` and what changes in it (`roadEngTerrainOriginal.ts`). */
export interface RoadEngOriginalBase {
  ter: Uint8Array
  /**
   * Its features that change, by index in the file: the index in `features` of what is written in
   * its place, or null to leave it out. Every other given feature is added after the file's own.
   */
  replaced: ReadonlyMap<number, number | null>
  /**
   * Replaced features whose place did not change (only their settings or look did): their record
   * and points stay as read, with the colour given, and only their group is rewritten.
   */
  keepGeometry?: ReadonlySet<number>
}

/** How a terrain written over RoadEng's own came out. */
export interface RoadEngOriginalSummary {
  /** Features written back byte for byte. */
  kept: number
  /** Features rewritten in their place. */
  rewritten: number
  /** Features left out. */
  removed: number
  /** Features added after the file's own. */
  added: number
  /** Triangles of RoadEng's TIN, kept as read. */
  triangles: number
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
  /** Set when the terrain was written over RoadEng's own `Terrain1.ter`. */
  original: RoadEngOriginalSummary | null
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
  /** Its index in the features given. */
  source: number
  name: string
  kind: RoadEngExportFeatureKind
  xyz: Float64Array
  /** the user's name was replaced to keep the kind */
  renamed: boolean
  /** PGMaps will not read it back as its kind whatever its name (a one-point "other") */
  mismatch: boolean
  dLine?: RoadEngDLine
  colorRef?: number
  formatChunk?: Uint8Array
}

/** Whether PGMaps reads a feature of this name and shape back as the kind it was written as. */
function readsBackAs(
  name: string,
  xyz: Float64Array,
  kind: RoadEngExportFeatureKind,
  layers: readonly RoadEngLayer[],
  dLine?: RoadEngDLine,
): boolean {
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
    ...(dLine ? { dLine } : {}),
  }
  if (classifyRoadEngFeature(feature, [...layers]) !== KIND_CLASS[kind]) return false
  // roadEngProject.ts: a closed boundary whose name says "fall" is a felling boundary.
  if (kind === 'boundary' && closed && /fall/i.test(name)) return false
  if (kind === 'falling-boundary' && !/fall/i.test(name)) return false
  return true
}

function drawnFeatures(
  features: readonly RoadEngExportFeature[],
  notes: string[],
  layers: readonly RoadEngLayer[],
): DrawnFeature[] {
  const out: DrawnFeature[] = []
  let unusable = 0
  for (const [source, f] of features.entries()) {
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
    // A D-line with cable settings reads back as one by its settings, whatever its name.
    const dLine = f.kind === 'd-line' ? f.dLine : undefined
    const preferred = dLine
      ? own || code!
      : code
        ? own && !own.toLowerCase().startsWith(code.toLowerCase())
          ? `${code} - ${own}`
          : own || code
        : own || 'Feature'
    // Its own name first, when that already reads back as its kind (a feature read from RoadEng).
    const candidates = [
      ...(own && own !== preferred ? [own.slice(0, LONG_NAME_CHARS).trim()] : []),
      preferred.slice(0, LONG_NAME_CHARS).trim(),
      code ?? 'Feature',
    ]
    const name = candidates.find((c) => readsBackAs(c, xyz, f.kind, layers, dLine))
    const coded = preferred.slice(0, LONG_NAME_CHARS).trim()
    out.push({
      source,
      name: name ?? coded,
      kind: f.kind,
      xyz,
      renamed: name !== undefined && name !== coded && name !== candidates[0],
      mismatch: name === undefined,
      ...(f.kind === 'd-line' && f.dLine ? { dLine: f.dLine } : {}),
      ...(f.colorRef !== undefined ? { colorRef: f.colorRef } : {}),
      ...(f.formatChunk ? { formatChunk: f.formatChunk } : {}),
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
  /** the full name, or the D-line's chunks, need an attribute group */
  group: boolean
  /** D-line chunks following the group */
  extra: Uint8Array | null
}

/** The parts of `Terrain1.ter` that come from a source terrain or are given whole. */
interface TerParts {
  /** code count and code table, {@link ROADENG_CODE_TABLE_BYTES} bytes */
  codeTable: Uint8Array | null
  /** the u32 after the code table and the 8 bytes after the bounding box */
  headerExtra: Uint8Array | null
  /** chunks that belong to no feature, written first in section 3 */
  attributeChunks: { bytes: Uint8Array; count: number } | null
  section8: Uint8Array
  tail: Uint8Array
}

/** A feature's type-58 format chunk with its header, as the samples hold it (second word 2, tag −1). */
function formatChunkBytes(payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + payload.length)
  const v = new DataView(out.buffer)
  v.setUint32(0, out.length, true)
  v.setUint32(4, 2, true)
  v.setUint32(8, ROADENG_FORMAT_CHUNK, true)
  v.setInt32(12, -1, true)
  out.set(payload, 16)
  return out
}

/** Chunks back to back; null for none. */
function joinChunks(parts: readonly Uint8Array[]): Uint8Array | null {
  if (!parts.length) return null
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** `Terrain1.ter`, laid out as `parseRoadEngTer` reads format version 12. */
function writeTer(ground: Ground | null, drawn: readonly DrawnFeature[], parts: TerParts): Uint8Array {
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
        extra: null,
      })
  const subIds = new Map<string, number>()
  for (const f of drawn) {
    const key = f.name.toLowerCase()
    const sub = subIds.get(key) ?? 0
    subIds.set(key, sub + 1)
    const extra = joinChunks([
      ...(f.dLine ? [encodeRoadEngDLineChunks(f.dLine)] : []),
      ...(f.formatChunk ? [formatChunkBytes(f.formatChunk)] : []),
    ])
    records.push({
      name: f.name,
      subId: sub,
      colorRef: f.colorRef ?? KIND_COLORREF[f.kind],
      flags: ROADENG_FLAG_NOT_MODELLED,
      kind: 1,
      xyz: f.xyz,
      group: f.name.length > RECORD_NAME_CHARS || extra !== null,
      extra,
    })
  }
  if (!records.length) throw Error('There is nothing to write: no terrain cell with a level and no drawn feature.')

  const pointTotal = records.reduce((s, r) => s + r.xyz.length / 3, 0)
  const groups = records.filter((r) => r.group).length
  const extraBytes = records.reduce((s, r) => s + (r.extra?.length ?? 0), 0)
  const kept = parts.attributeChunks
  const chunkCount =
    (kept?.count ?? 0) + groups + records.reduce((s, r) => s + (r.extra ? roadEngDLineChunkCount(r.extra) : 0), 0)
  const tin = ground && ground.summary.triangles ? ground : null
  const sizes = [
    HEADER_BLOCK_BYTES,
    FEATURE_BYTES * records.length,
    POINT_BYTES * pointTotal,
    (kept?.bytes.length ?? 0) + GROUP_BYTES * groups + extraBytes,
    TIN_HEADER_BYTES,
    tin ? 8 * (tin.summary.vertices + TIN_PLACEHOLDERS) : 0,
    tin ? 16 * tin.summary.triangles : 0,
    tin ? 16 * tin.summary.triangles : 0,
    parts.section8.length,
  ]
  const offsets: number[] = []
  let end = HEADER_BYTES
  for (const size of sizes) {
    offsets.push(end)
    end += size
  }
  const bytes = new Uint8Array(end + parts.tail.length)
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
  view.setUint32(h + 12, chunkCount, true)
  const after = h + 20 + CODE_SLOTS * CODE_SLOT_BYTES
  if (parts.codeTable) bytes.set(parts.codeTable, h + 16)
  else {
    view.setUint32(h + 16, ROADENG_DEFAULT_CODES.length, true)
    ROADENG_DEFAULT_CODES.forEach((code, k) => {
      const o = h + 20 + k * CODE_SLOT_BYTES
      view.setUint16(o, 1, true)
      text(o + 2, code, CODE_SLOT_BYTES - 2)
    })
  }
  if (parts.headerExtra) {
    bytes.set(parts.headerExtra.subarray(0, 4), after)
    bytes.set(parts.headerExtra.subarray(4, 12), after + 4 + 48)
  } else view.setUint32(after, 1, true)
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

  // Section 3: the kept chunks, then an attribute group (type 52) holding each long name in full,
  // followed by the feature's D-line chunks.
  let chunk = offsets[3]
  if (kept) {
    bytes.set(kept.bytes, chunk)
    chunk += kept.bytes.length
  }
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
    if (record.extra) {
      bytes.set(record.extra, chunk)
      chunk += record.extra.length
    }
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
  // Section 8 and the tail.
  bytes.set(parts.section8, offsets[8])
  bytes.set(parts.tail, end)
  return bytes
}

// ---- Over RoadEng's own Terrain1.ter -----------------------------------------------------------------

interface TerChunk {
  at: number
  length: number
  type: number
  tag: number
  /** The feature whose group (type 52) it follows; −1 before any group or in the defaults entry, −2 in a group naming no feature. */
  owner: number
}

/** Where each part of a `Terrain1.ter` is, as {@link roadEngTerLayout} finds it. */
export interface RoadEngTerLayout {
  sizes: number[]
  offsets: number[]
  /** Where section 8 ends and the map-notes tail begins. */
  end: number
  featureCount: number
  /** Each feature's first point, then the point total. */
  pointStart: Uint32Array
  chunks: TerChunk[]
  /** 1 for each feature the TIN takes points from. */
  inTin: Uint8Array
}

/**
 * The framing of RoadEng's own `Terrain1.ter`, checked as `parseRoadEngTer` checks it: the sections,
 * feature records, point runs and attribute chunks, and which features the TIN uses. A file whose
 * framing does not add up is refused.
 */
export function roadEngTerLayout(ter: Uint8Array): RoadEngTerLayout {
  const fail = (why: string): never => {
    throw Error(`RoadEng's own terrain file cannot be written back: ${why}`)
  }
  if (ter.length < HEADER_BYTES + HEADER_BLOCK_BYTES + 24) fail('it is too short.')
  const view = new DataView(ter.buffer, ter.byteOffset, ter.byteLength)
  if (view.getUint16(0, true) !== ROADENG_TER_VERSION) fail(`it is not format version ${ROADENG_TER_VERSION}.`)
  const sizes: number[] = [],
    offsets: number[] = []
  let end = HEADER_BYTES
  for (let i = 0; i < SECTION_COUNT; i++) {
    sizes.push(view.getUint32(2 + 4 * i, true))
    offsets.push(end)
    end += sizes[i]
  }
  const notesBytes = end + 12 <= ter.length ? view.getUint32(end + 8, true) : 0
  if (end + 24 + notesBytes !== ter.length || sizes[0] !== HEADER_BLOCK_BYTES) fail('its sections do not add up.')
  const featureCount = view.getUint32(offsets[0], true)
  if (sizes[1] !== featureCount * FEATURE_BYTES || sizes[2] % POINT_BYTES) fail('its feature records do not add up.')
  const pointStart = new Uint32Array(featureCount + 1)
  let points = 0
  for (let i = 0; i < featureCount; i++) {
    pointStart[i] = points
    points += view.getUint32(offsets[1] + i * FEATURE_BYTES, true)
  }
  pointStart[featureCount] = points
  if (points !== sizes[2] / POINT_BYTES) fail('its features do not own its points.')
  const chunks: TerChunk[] = []
  let owner = -1
  for (let o = offsets[3], stop = offsets[3] + sizes[3]; o < stop; ) {
    const length = o + 16 <= stop ? view.getUint32(o, true) : 0
    if (length < 16 || o + length > stop) fail('its attribute chunks are damaged.')
    const type = view.getUint32(o + 8, true)
    if (type === 52 && length >= 20) {
      const index = view.getInt32(o + 16, true)
      owner = index < 0 ? -1 : index < featureCount ? index : -2
    }
    chunks.push({ at: o, length, type, tag: view.getInt32(o + 12, true), owner })
    o += length
  }
  const inTin = new Uint8Array(featureCount)
  for (let k = 0; k < sizes[5] / 8; k++) {
    const f = view.getInt32(offsets[5] + 8 * k, true)
    if (f >= 0 && f < featureCount) inTin[f] = 1
  }
  return { sizes, offsets, end, featureCount, pointStart, chunks, inTin }
}

/** A chunk's bytes with its 16-byte header. */
function chunkOf(type: number, tag: number, payload: Uint8Array, header?: Uint8Array): Uint8Array {
  const out = new Uint8Array(16 + payload.length)
  const v = new DataView(out.buffer)
  if (header) out.set(header.subarray(4, 16), 4)
  else {
    v.setUint32(4, 2, true)
    v.setUint32(8, type, true)
    v.setInt32(12, tag, true)
  }
  v.setUint32(0, out.length, true)
  out.set(payload, 16)
  return out
}

/** An attribute group (type 52) holding a feature's full name, as `writeTer` writes one. */
function groupChunk(index: number, name: string, subId: number): Uint8Array {
  const out = new Uint8Array(GROUP_BYTES)
  const v = new DataView(out.buffer)
  v.setUint32(0, GROUP_BYTES, true)
  v.setUint32(4, 2, true)
  v.setUint32(8, 52, true)
  v.setInt32(12, -1, true)
  v.setInt32(16, index, true)
  putCString(out, 20, 256, name)
  v.setUint32(280, subId, true)
  return out
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * RoadEng's own `Terrain1.ter` written again with some of its features changed: every byte of what
 * did not change is copied as read (records with their stale name bytes, points with their padding,
 * attribute chunks, the TIN, the header's unexplained fields), so with nothing changed the file comes
 * back byte for byte.
 *
 * - A rewritten feature keeps its record's sub ID, flags, `kind`, station origin and colour (unless
 *   given another), and its points' flags and padding while it keeps its point count. Its group
 *   keeps every chunk but these: the type-52 and type-67 names become its own name where it changed,
 *   a format chunk given replaces type 58, its D-line settings replace types 63, 12, 6 and 69, and
 *   point-level chunks go when its point count changes.
 * - A left-out feature takes its record, points and group with it; later features' indices in the
 *   groups, the header's current-feature slot and the TIN's vertex table follow.
 * - Added features follow the file's own, drawn as `writeTer` draws them (left out of the TIN), their
 *   groups after the file's chunks.
 * - The header's chunk count follows the chunks written (where it counted them as read), and its
 *   bounding box is the union of the records' boxes when anything changed.
 *
 * A feature the TIN takes points from is never rewritten or left out: the TIN would point at
 * changed or missing points. The caller writes the grid instead.
 */
function spliceTer(
  ter: Uint8Array,
  layout: RoadEngTerLayout,
  drawn: readonly DrawnFeature[],
  replaced: ReadonlyMap<number, number | null>,
  keepGeometry: ReadonlySet<number>,
  parts: { section8: Uint8Array; tail: Uint8Array },
): Omit<RoadEngOriginalSummary, 'triangles'> & { bytes: Uint8Array } {
  const { offsets, sizes, featureCount: n, pointStart } = layout
  for (const i of replaced.keys())
    if (layout.inTin[i]) throw Error(`Feature ${i + 1} of RoadEng's terrain makes its TIN and cannot be rewritten.`)
  const used = new Set([...replaced.values()].filter((d): d is number => d !== null))
  const added = drawn.map((_, d) => d).filter((d) => !used.has(d))
  const newIndex = new Int32Array(n).fill(-1)
  let kept = 0
  for (let i = 0; i < n; i++) if (replaced.get(i) !== null) newIndex[i] = kept++
  const total = kept + added.length
  if (!total) throw Error('There is nothing to write: every feature of the terrain was left out.')
  const record = (i: number) => ter.subarray(offsets[1] + i * FEATURE_BYTES, offsets[1] + (i + 1) * FEATURE_BYTES)
  const pointsOf = (i: number) =>
    ter.subarray(offsets[2] + pointStart[i] * POINT_BYTES, offsets[2] + pointStart[i + 1] * POINT_BYTES)
  /** The name a feature was read with: its type-67 chunk's, else its group's, else its record's. */
  const readNames = new Map<number, string>()
  for (const c of layout.chunks) {
    if (c.owner < 0 || (c.type !== 52 && c.type !== 67) || c.length < 21) continue
    if (c.type === 52 && readNames.has(c.owner)) continue
    const name = cString(ter, c.at + 20, Math.min(256, c.length - 20)).trim()
    if (name) readNames.set(c.owner, name)
  }
  const readName = (i: number) => readNames.get(i) ?? cString(record(i), 86, RECORD_NAME_CHARS + 1)
  const subIdOf = (i: number) =>
    new DataView(ter.buffer, ter.byteOffset + offsets[1] + i * FEATURE_BYTES).getUint32(4, true)

  // Sub IDs of added features count on from the file's own features of the same name.
  const subIds = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const key = cString(record(i), 86, RECORD_NAME_CHARS + 1).toLowerCase()
    subIds.set(key, Math.max(subIds.get(key) ?? 0, subIdOf(i) + 1))
  }

  /**
   * A record and its points for a drawn feature, over the record it replaces when there is one; with
   * `inPlace`, the replaced record's points and box stay as read.
   */
  const encode = (
    f: DrawnFeature,
    base: Uint8Array | null,
    basePoints: Uint8Array | null,
    subId: number,
    { inPlace = false, renamed = true } = {},
  ) => {
    if (base && basePoints && inPlace) {
      const out = base.slice()
      const v = new DataView(out.buffer)
      if (f.colorRef !== undefined && (v.getUint32(12, true) & 0xffffff) !== f.colorRef)
        v.setUint32(12, f.colorRef, true)
      return { record: out, points: basePoints }
    }
    const count = f.xyz.length / 3
    const out = base ? base.slice() : new Uint8Array(FEATURE_BYTES)
    const v = new DataView(out.buffer)
    const pts = new Uint8Array(count * POINT_BYTES)
    const pv = new DataView(pts.buffer)
    const sameCount = basePoints !== null && basePoints.length === pts.length
    if (sameCount) pts.set(basePoints)
    let sameGeometry = sameCount
    for (let k = 0; k < count; k++) {
      for (let j = 0; j < 3; j++) {
        if (sameGeometry && pv.getFloat64(k * POINT_BYTES + 8 * j, true) !== f.xyz[3 * k + j]) sameGeometry = false
        pv.setFloat64(k * POINT_BYTES + 8 * j, f.xyz[3 * k + j], true)
      }
    }
    if (!base) {
      v.setUint32(4, subId, true)
      v.setUint32(12, f.colorRef ?? KIND_COLORREF[f.kind], true)
      v.setUint16(80, ROADENG_FLAG_NOT_MODELLED, true)
      v.setUint16(84, 1, true)
    } else if (f.colorRef !== undefined && (v.getUint32(12, true) & 0xffffff) !== f.colorRef)
      v.setUint32(12, f.colorRef, true)
    if (!sameGeometry) {
      v.setUint32(0, count, true)
      const origin = base ? v.getFloat64(16, true) : 0
      v.setFloat64(24, origin + planLength(f.xyz), true)
      bboxOf(f.xyz).forEach((x, k) => v.setFloat64(32 + 8 * k, x, true))
    }
    const short = f.name.slice(0, RECORD_NAME_CHARS)
    if (!base || (renamed && cString(out, 86, RECORD_NAME_CHARS + 1) !== short))
      putCString(out, 86, RECORD_NAME_CHARS + 1, short)
    return { record: out, points: sameGeometry ? basePoints! : pts }
  }

  // Sections 1 and 2.
  const records: Uint8Array[] = [],
    pointRuns: Uint8Array[] = []
  const changed = replaced.size > 0 || added.length > 0
  for (let i = 0; i < n; i++) {
    const r = replaced.get(i)
    if (r === null) continue
    if (r === undefined) {
      records.push(record(i))
      pointRuns.push(pointsOf(i))
    } else {
      const made = encode(drawn[r], record(i), pointsOf(i), 0, {
        inPlace: keepGeometry.has(i),
        renamed: drawn[r].name !== readName(i),
      })
      records.push(made.record)
      pointRuns.push(made.points)
    }
  }
  const addedSubId = new Map<number, number>()
  for (const d of added) {
    const key = drawn[d].name.slice(0, RECORD_NAME_CHARS).toLowerCase()
    const sub = subIds.get(key) ?? 0
    subIds.set(key, sub + 1)
    addedSubId.set(d, sub)
    const made = encode(drawn[d], null, null, sub)
    records.push(made.record)
    pointRuns.push(made.points)
  }

  // Section 3: the file's chunks in their order, groups of changed features rewritten.
  const chunks: Uint8Array[] = []
  let chunkCount = 0
  const push = (bytes: Uint8Array, count = 1) => {
    chunks.push(bytes)
    chunkCount += count
  }
  const extras = (f: DrawnFeature, skip: { dLine: boolean; format: boolean }) => {
    if (f.dLine && !skip.dLine) {
      const encoded = encodeRoadEngDLineChunks(f.dLine)
      push(encoded, roadEngDLineChunkCount(encoded))
    }
    if (f.formatChunk && !skip.format) push(formatChunkBytes(f.formatChunk))
  }
  const needsGroup = (f: DrawnFeature) => f.name.length > RECORD_NAME_CHARS || !!f.dLine || !!f.formatChunk
  const grouped = new Set(layout.chunks.filter((c) => c.owner >= 0).map((c) => c.owner))
  const pending = [...replaced]
    .filter(([i, d]) => d !== null && !grouped.has(i) && needsGroup(drawn[d]))
    .map(([i]) => i)
    .sort((a, b) => a - b)
  let next = 0
  const flushBefore = (index: number) => {
    for (; next < pending.length && pending[next] < index; next++) {
      const i = pending[next]
      const f = drawn[replaced.get(i)!]
      push(groupChunk(newIndex[i], f.name, subIdOf(i)))
      extras(f, { dLine: false, format: false })
    }
  }
  const slice = (c: TerChunk) => ter.subarray(c.at, c.at + c.length)
  for (let c = 0; c < layout.chunks.length; ) {
    const first = layout.chunks[c]
    if (first.owner < 0) {
      push(slice(first))
      c++
      continue
    }
    flushBefore(first.owner)
    let e = c + 1
    while (e < layout.chunks.length && layout.chunks[e].owner === first.owner && layout.chunks[e].type !== 52) e++
    const group = layout.chunks.slice(c, e)
    c = e
    const i = first.owner
    const r = replaced.get(i)
    if (r === null) continue
    if (r === undefined) {
      for (const g of group) {
        if (g.type === 52 && newIndex[i] !== i) {
          const bytes = slice(g).slice()
          new DataView(bytes.buffer).setInt32(16, newIndex[i], true)
          push(bytes)
        } else push(slice(g))
      }
      continue
    }
    // A rewritten feature's group: its chunks, changed only where the feature changed.
    const f = drawn[r]
    const pointsChanged = !keepGeometry.has(i) && f.xyz.length / 3 !== pointStart[i + 1] - pointStart[i]
    const longName = group.some((g) => g.type === 67)
    const renamed = f.name !== readName(i)
    let dLineDone = false,
      formatDone = false
    for (const g of group) {
      const bytes = slice(g)
      if (g.type === 52) {
        const out = bytes.slice()
        new DataView(out.buffer).setInt32(16, newIndex[i], true)
        const name = longName ? f.name.slice(0, RECORD_NAME_CHARS) : f.name
        if (renamed && out.length >= 20 + 256 && cString(out, 20, 256) !== name) putCString(out, 20, 256, name)
        push(out)
      } else if (g.type === 67) {
        const width = Math.min(256, g.length - 20)
        const out = bytes.slice()
        if (renamed && width > 1 && cString(out, 20, width) !== f.name) putCString(out, 20, width, f.name)
        push(out)
      } else if (ROADENG_DLINE_CHUNKS.includes(g.type) && f.dLine) {
        if (!dLineDone) extras({ ...f, formatChunk: undefined }, { dLine: false, format: true })
        dLineDone = true
      } else if (g.type === ROADENG_FORMAT_CHUNK && f.formatChunk) {
        push(sameBytes(bytes.subarray(16), f.formatChunk) ? bytes : chunkOf(g.type, g.tag, f.formatChunk, bytes))
        formatDone = true
      } else if (g.tag >= 0 && pointsChanged) continue
      else push(bytes)
    }
    extras(f, { dLine: dLineDone, format: formatDone })
  }
  flushBefore(Infinity)
  for (const d of added) {
    const f = drawn[d]
    if (!needsGroup(f)) continue
    push(groupChunk(kept + added.indexOf(d), f.name, addedSubId.get(d)!))
    extras(f, { dLine: false, format: false })
  }

  // Section 0: the header as read, with the counts, the current feature and the box following.
  const header = ter.slice(offsets[0], offsets[0] + sizes[0])
  const hv = new DataView(header.buffer)
  hv.setUint32(0, total, true)
  const current = hv.getInt32(4, true)
  if (current >= 0 && current < n) hv.setInt32(4, newIndex[current], true)
  // The u32 at +12 counts the chunks in RoadEng's own files; one that does not is kept as read.
  if (hv.getUint32(12, true) === layout.chunks.length) hv.setUint32(12, chunkCount, true)
  if (changed) {
    const box = [Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity]
    for (const r of records) {
      const rv = new DataView(r.buffer, r.byteOffset, r.byteLength)
      if (!rv.getUint32(0, true)) continue
      for (let k = 0; k < 6; k++) {
        const x = rv.getFloat64(32 + 8 * k, true)
        box[k] = k % 2 ? Math.max(box[k], x) : Math.min(box[k], x)
      }
    }
    const at = 20 + CODE_SLOTS * CODE_SLOT_BYTES + 4
    if (box.every(Number.isFinite)) box.forEach((x, k) => hv.setFloat64(at + 8 * k, x, true))
  }
  // Section 5: the TIN's feature indices follow the features left out before them.
  let vertexTable = ter.subarray(offsets[5], offsets[5] + sizes[5])
  if ([...replaced.values()].some((d) => d === null)) {
    vertexTable = vertexTable.slice()
    const tv = new DataView(vertexTable.buffer)
    for (let k = 0; k < vertexTable.length / 8; k++) {
      const f = tv.getInt32(8 * k, true)
      if (f >= 0 && f < n) tv.setInt32(8 * k, newIndex[f], true)
    }
  }

  const join = (list: readonly Uint8Array[]) => {
    const out = new Uint8Array(list.reduce((s, b) => s + b.length, 0))
    let o = 0
    for (const b of list) {
      out.set(b, o)
      o += b.length
    }
    return out
  }
  const sections = [
    header,
    join(records),
    join(pointRuns),
    join(chunks),
    ter.subarray(offsets[4], offsets[4] + sizes[4]),
    vertexTable,
    ter.subarray(offsets[6], offsets[6] + sizes[6]),
    ter.subarray(offsets[7], offsets[7] + sizes[7]),
    parts.section8,
  ]
  const bytes = new Uint8Array(HEADER_BYTES + sections.reduce((s, b) => s + b.length, 0) + parts.tail.length)
  const out = new DataView(bytes.buffer)
  bytes.set(ter.subarray(0, 2))
  let o = HEADER_BYTES
  sections.forEach((section, k) => {
    out.setUint32(2 + 4 * k, section.length, true)
    bytes.set(section, o)
    o += section.length
  })
  bytes.set(parts.tail, o)
  const rewritten = [...replaced.values()].filter((d) => d !== null).length
  return { bytes, kept: kept - rewritten, rewritten, removed: n - kept, added: added.length }
}

/** The layers written: the source's in their order, then each of the writer's the source lacks. */
function mergedLayers(source: readonly RoadEngLayer[]): RoadEngLayer[] {
  const have = new Set(source.map((l) => l.pattern.trim().toLowerCase()))
  return [...source, ...LAYERS.filter((l) => !have.has(l.pattern.toLowerCase()))]
}

/** The `.tlt`'s layer list, as `readRoadEngTerrainArchive` reads it. */
function tltLayers(tlt: string): RoadEngLayer[] {
  const section = readRoadEngIni(tlt).find((s) => s.name.toLowerCase() === 'terlayers')
  return (section?.entries ?? [])
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
}

/**
 * `Terrain1.tlt`: without a source, the software, the coordinate system, the units and the layer
 * patterns; with one, the source's text with only those (and the equipment library, when logging
 * systems are given) edited.
 */
function writeTlt(
  coordSys: string,
  layers: readonly RoadEngLayer[],
  sourceTlt: string | null,
  systems: readonly RoadEngLoggingSystem[] | null,
  keepUnits = false,
): string {
  const layerLines = (from: number) =>
    layers.slice(from).map((l, k) => `Layer${from + k}=${l.pattern},${l.description},`)
  if (sourceTlt === null) {
    const text = [
      ...SOFTWARE,
      '[main]',
      `CoordSys=${coordSys}`,
      'units=10000',
      '[TerLayers]',
      ...layerLines(0),
      '',
    ].join('\r\n')
    return systems ? editRoadEngIni(text, roadEngEquipmentEdits([], systems)) : text
  }
  const sourceLayers = tltLayers(sourceTlt)
  const edits: RoadEngIniEdit[] = [
    {
      section: 'main',
      set: [
        ['CoordSys', coordSys],
        ...(keepUnits && roadEngIniValue(sourceTlt, 'main', 'units') !== null
          ? []
          : [['units', '10000'] as [string, string]]),
      ],
    },
  ]
  // The source's layer lines stay as they are; the writer's missing ones follow them.
  if (layers.length > sourceLayers.length) {
    const section = readRoadEngIni(sourceTlt).find((s) => s.name.toLowerCase() === 'terlayers')
    const next =
      (section?.entries ?? []).reduce((m, [k]) => {
        const n = /^Layer(\d+)$/i.exec(k)
        return n ? Math.max(m, Number(n[1]) + 1) : m
      }, 0) || sourceLayers.length
    edits.push({
      section: section?.name ?? 'TerLayers',
      set: layers.slice(sourceLayers.length).map((l, k) => [`Layer${next + k}`, `${l.pattern},${l.description},`]),
    })
  }
  if (systems) edits.push(...roadEngEquipmentEdits(readRoadEngIni(sourceTlt), systems))
  return editRoadEngIni(sourceTlt, edits)
}

const PART_LABEL: Record<string, string> = {
  tlt: 'its display settings (Terrain1.tlt)',
  te1: 'its symbol library (Terrain1.te1)',
  codeTable: 'its feature-code table',
  attributeChunks: 'its attribute schema and default formats',
}

/** A project's terrain grid and drawn features as a RoadEng `.terx`; the module comment has the layout. */
export function roadEngTerrainArchive(input: RoadEngTerrainInput): RoadEngTerrainArchive {
  const notes: string[] = []
  const source = input.source ?? null
  const part = (value: string | undefined) => (value === undefined ? null : base64ToBytes(value))
  const sourceTlt = source?.tlt ?? null
  const layers = sourceTlt !== null ? mergedLayers(tltLayers(sourceTlt)) : LAYERS
  const base = input.original ?? null
  const layout = base ? roadEngTerLayout(base.ter) : null
  const ground = base ? null : buildGround(input, notes)
  const drawn = drawnFeatures(input.features ?? [], notes, layers)
  const dLines = drawn.filter((f) => f.dLine).length
  if (dLines)
    notes.push(
      `${dLines === 1 ? '1 D-line carries' : `${dLines.toLocaleString('en-CA')} D-lines carry`} RoadEng cable settings.`,
    )

  const codeTable = part(source?.codeTable)
  const headerExtra = part(source?.headerExtra)
  const attributeBytes = part(source?.attributeChunks)
  // Over RoadEng's own file, its section 8 and tail are the ones kept as read.
  const sourceSection8 = layout
    ? base!.ter.subarray(layout.offsets[8], layout.offsets[8] + layout.sizes[8])
    : part(source?.loggingSystems)
  const sourceTail = layout ? base!.ter.subarray(layout.end) : part(source?.tail)
  const systems = input.loggingSystems ?? null
  const section8 = systems ? encodeRoadEngLoggingSystems(systems) : (sourceSection8 ?? new Uint8Array(0))
  const tail = input.mapNotes
    ? encodeRoadEngMapNotes(input.mapNotes, sourceTail)
    : (sourceTail ?? encodeRoadEngMapNotes([], null))
  let original: RoadEngOriginalSummary | null = null
  let ter: Uint8Array
  if (base && layout) {
    const replaced = new Map<number, number | null>()
    for (const [i, given] of base.replaced) {
      if (!Number.isInteger(i) || i < 0 || i >= layout.featureCount)
        throw Error(`RoadEng's terrain has no feature ${i + 1} to replace.`)
      const d = given === null ? -1 : drawn.findIndex((f) => f.source === given)
      replaced.set(i, d < 0 ? null : d)
    }
    const spliced = spliceTer(base.ter, layout, drawn, replaced, base.keepGeometry ?? new Set(), { section8, tail })
    ter = spliced.bytes
    original = {
      kept: spliced.kept,
      rewritten: spliced.rewritten,
      removed: spliced.removed,
      added: spliced.added,
      triangles: layout.sizes[6] / 16,
    }
    const fmt = (n: number) => n.toLocaleString('en-CA')
    const changes = [
      spliced.rewritten ? `${fmt(spliced.rewritten)} rewritten` : '',
      spliced.removed ? `${fmt(spliced.removed)} left out` : '',
      spliced.added ? `${fmt(spliced.added)} added` : '',
    ].filter(Boolean)
    notes.push(
      `The ground is RoadEng's own terrain file: its TIN of ${fmt(original.triangles)} triangles and ` +
        `${fmt(spliced.kept)} of its features as read${changes.length ? `; ${changes.join(', ')}` : ''}.`,
    )
  } else
    ter = writeTer(ground, drawn, {
      codeTable: codeTable && codeTable.length === ROADENG_CODE_TABLE_BYTES ? codeTable : null,
      headerExtra: headerExtra && headerExtra.length === 12 ? headerExtra : null,
      attributeChunks:
        attributeBytes && source?.attributeChunkCount !== undefined
          ? { bytes: attributeBytes, count: source.attributeChunkCount }
          : null,
      section8,
      tail,
    })
  const systemCount = Math.floor(section8.length / ROADENG_LOGGING_SYSTEM_BYTES)
  const noteCount = new DataView(tail.buffer, tail.byteOffset, tail.byteLength).getUint32(4, true)
  const held = [
    systemCount ? `${systemCount === 1 ? '1 logging system' : `${systemCount} logging systems`}` : '',
    noteCount ? `${noteCount === 1 ? '1 map note' : `${noteCount} map notes`}` : '',
  ].filter(Boolean)
  if (held.length) notes.push(`The terrain holds ${held.join(' and ')}.`)

  const epsg = input.coordSys?.epsg ?? null
  let coordSys = roadEngCoordSys(epsg)
  const sourceCoord = sourceTlt !== null ? roadEngIniValue(sourceTlt, 'main', 'CoordSys') : null
  // Over RoadEng's own file on the flat plane, the coordinates are the file's own, so its CoordSys,
  // whatever this workspace makes of it, still describes them.
  if (sourceCoord !== null && (epsg === null ? base !== null : parseRoadEngCoordSys(sourceCoord).epsg === epsg))
    coordSys = { value: sourceCoord, written: true }
  else if (epsg === null) notes.push('The terrain states no coordinate system: RoadEng will show it as not set.')
  else if (!coordSys.written)
    notes.push(`EPSG:${epsg} has no RoadEng form here, so the terrain states no coordinate system.`)
  else if (!(epsg >= 26901 && epsg <= 26923))
    notes.push(`EPSG:${epsg} is written as its WKT alone; RoadEng's own code for it is not known.`)
  // A kept .tlt gains only the writer's layers a drawn feature is named for, so an unchanged
  // terrain keeps its layer list as it was.
  const sourceLayerCount = sourceTlt !== null ? tltLayers(sourceTlt).length : 0
  const tltLayerList =
    sourceTlt === null
      ? layers
      : [
          ...layers.slice(0, sourceLayerCount),
          ...layers.slice(sourceLayerCount).filter((l) => drawn.some((f) => roadEngLayerMatches(l.pattern, f.name))),
        ]
  // RoadEng's own file keeps its unit (a terrain in feet stays in feet); the grid is written in metres.
  const tlt = writeTlt(coordSys.value, tltLayerList, sourceTlt, systems, base !== null)
  const te1 = part(source?.te1)
  const keptParts = (['tlt', 'te1', 'codeTable', 'attributeChunks'] as const).filter((k) => source?.[k] !== undefined)
  if (keptParts.length)
    notes.push(`Kept from the RoadEng terrain it came from: ${keptParts.map((k) => PART_LABEL[k]).join(', ')}.`)
  if (source?.omitted?.length) notes.push(`Not kept on import, so left out: ${source.omitted.join(', ')}.`)
  const bytes = zipSync(
    {
      'Terrain1.ter': ter,
      'Terrain1.tlt': strToU8(tlt, true),
      ...(te1 ? { 'Terrain1.te1': te1 } : {}),
    },
    { mtime: ZIP_TIME },
  )
  return { bytes, notes, ground: ground?.summary ?? null, original }
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
  terrainName,
  layouts,
  surveys,
}: {
  name: string
  /** The design, or null for a project that is its terrain alone. */
  design: Uint8Array | null
  terrain: Uint8Array | null
  /** The terrain's file name, when not `<name>.terx`: the one a kept design names (`[design] surface`). */
  terrainName?: string
  /** Window layouts (`.ilt`) to put beside the design and terrain, by file name. */
  layouts?: Readonly<Record<string, Uint8Array>>
  /** P-line traverses (`.tr1`, `.tr2`) a design names, by file name, as read (`roadEngPLine.ts`). */
  surveys?: Readonly<Record<string, Uint8Array>>
}): Uint8Array {
  const files = roadEngProjectFileNames(name)
  const terrainFile = terrainName ?? files.terrain
  if (!design && !terrain) throw Error('A RoadEng project needs a design or a terrain.')
  const named = design ? parseRoadEngDesign(design).terrain : terrainFile
  if (design && terrain && named?.toLowerCase() !== terrainFile.toLowerCase())
    throw Error(
      `The design ${named ? `names its terrain ${named}` : 'names no terrain'}; write it with the terrain name ${terrainFile}.`,
    )
  // Both parts are archives already: stored, not compressed again.
  return zipSync(
    {
      ...(design ? { [files.design]: [design, { level: 0 }] } : {}),
      ...(terrain ? { [terrainFile]: [terrain, { level: 0 }] } : {}),
      ...Object.fromEntries(Object.entries(layouts ?? {}).map(([n, bytes]) => [n, [bytes, { level: 6 }]])),
      ...Object.fromEntries(Object.entries(surveys ?? {}).map(([n, bytes]) => [n, [bytes, { level: 6 }]])),
    },
    { mtime: ZIP_TIME },
  )
}
