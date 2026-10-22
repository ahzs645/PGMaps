/**
 * LAS and LAZ point clouds, and ground classification, for the road terrain. LAS 1.0–1.4 is
 * decoded here; LAZ goes through `whitebox-wasm`'s LiDAR reader, and ground filtering runs the
 * WhiteboxTools CLI (`whitebox-wasm/tools`, a WASI binary over an in-memory filesystem). Both wasm
 * pieces are imported only when first needed. No DOM or network access beyond the wasm fetches,
 * and `setWhiteboxSources` lets a test hand the bytes in directly.
 *
 * The LAS header and VLRs are uncompressed in LAZ too, so the CRS always comes from them: the
 * GeoTIFF keys VLR (34735) or OGC WKT (2112), in a VLR or a LAS 1.4 EVLR.
 */
type Whitebox = typeof import('whitebox-wasm')
type WhiteboxTools = typeof import('whitebox-wasm/tools')
type WasmSource = BufferSource | URL | string

export interface PointCloud {
  x: Float64Array
  y: Float64Array
  z: Float64Array
  /** ASPRS class per point: 2 ground, 1 unclassified, 7 and 18 noise. */
  classification: Uint8Array
  count: number
  epsg: number | null
  verticalEpsg: number | null
  version: string
  format: 'las' | 'laz'
  /** Of the points kept: [minX, minY, minZ, maxX, maxY, maxZ]. */
  bounds: [number, number, number, number, number, number]
  /** Points in the file; more than `count` when the cloud was thinned. */
  sourceCount: number
  /** Cell of the lowest-point thinning, or null when every point was kept. */
  thinCellM: number | null
}

export interface PointCloudHeader {
  version: string
  /** Point data record format with the compression bits removed. */
  pointFormat: number
  pointLength: number
  pointOffset: number
  points: number
  scale: [number, number, number]
  offset: [number, number, number]
  min: [number, number, number]
  max: [number, number, number]
  compressed: boolean
  epsg: number | null
  verticalEpsg: number | null
}

export interface GroundPointFilterParams {
  /** Neighbourhood radius, m. */
  searchRadius: number
  /** The radius grows until this many neighbours are found; 0 keeps it fixed. */
  minNeighbours: number
  /** Degrees (WhiteboxTools caps it at 88). A lower neighbour steeper than this flags the point… */
  slopeThreshold: number
  /** …when it is also at least this many metres higher. */
  heightThreshold: number
  /** Remove the hillside's trend with a top-hat transform before the slope test. */
  slopeNorm: boolean
}

export interface SegmentationFilterParams {
  /** Neighbourhood radius for growing connected low-relief segments, m. */
  searchRadius: number
  /** Largest elevation step a segment may grow across, m. */
  maxZDiff: number
}

export type GroundMethod = 'ground_point_filter' | 'segmentation'

/**
 * Defaults for ~1 m-spaced (1–10 points/m²) forestry LiDAR on steep BC hillsides, checked against
 * synthetic 20–130 % hillsides under conifer crowns with a road bench and 6 % low-shrub returns:
 * - Slope threshold 65° with the top-hat normalisation off, not WhiteboxTools' 45° with it on.
 *   Hillsides here run 80–130 % (39–52°) and cut slopes 1.5:1 (56°); at 45° a true ground point
 *   below a steep neighbour reads as off-ground and recall fell to 92 % on 130 %. 65° raw kept
 *   97–98 % at 70–130 % with no crown return taken as ground. The top-hat (on, 60°) scored much
 *   the same but ran 2–2.5× slower and always lost a search-radius strip along the cloud's upslope
 *   edge; its one gain is fewer shrub returns kept on gentle ground.
 * - Height threshold 0.5 m, not 1 m: shrub, slash and down-wood returns 0.5–2 m up are common in
 *   cutblocks and would otherwise lift the surface; 1 m LiDAR ground noise is about 0.1–0.15 m.
 * - Search radius 2 m (two to three pulse spacings); wider radii were slower and lost ground on
 *   convex breaks.
 * Segmentation: 2 m radius, 0.5 m largest step. Similar recall, more shrubs kept, about 1.5–2×
 * slower than the slope filter.
 */
export const GROUND_FILTER_DEFAULTS = {
  ground_point_filter: {
    searchRadius: 2,
    minNeighbours: 0,
    slopeThreshold: 65,
    heightThreshold: 0.5,
    slopeNorm: false,
  } satisfies GroundPointFilterParams,
  segmentation: { searchRadius: 2, maxZDiff: 0.5 } satisfies SegmentationFilterParams,
}

/** Past this, `readPointCloud` thins to the lowest point per cell (25 bytes/point once read). */
export const DEFAULT_MAX_POINTS = 3_000_000

const NOISE = new Set([7, 18])
const decoder = new TextDecoder()

// --- wasm loading -------------------------------------------------------------------------------

let sources: { lidar?: WasmSource; tools?: WasmSource } = {}
let whitebox: Promise<Whitebox> | null = null
let tools: Promise<WhiteboxTools> | null = null

/** Hand the wasm bytes (or URLs) in, e.g. from node_modules in a test. Call before first use. */
export function setWhiteboxSources(next: { lidar?: WasmSource; tools?: WasmSource }) {
  sources = next
}

function loadWhitebox(): Promise<Whitebox> {
  whitebox ??= import('whitebox-wasm').then(async (module) => {
    await module.default(sources.lidar === undefined ? undefined : { module_or_path: sources.lidar })
    return module
  })
  whitebox.catch(() => (whitebox = null))
  return whitebox
}

function loadTools(): Promise<WhiteboxTools> {
  tools ??= import('whitebox-wasm/tools').then(async (module) => {
    await module.initTools(sources.tools)
    return module
  })
  tools.catch(() => (tools = null))
  return tools
}

// --- header ---------------------------------------------------------------------------------------

function asBytes(data: Uint8Array | ArrayBuffer) {
  return data instanceof Uint8Array ? data : new Uint8Array(data)
}

/** LAZ marks bit 7 of the point-format byte (bit 6 in some writers) and carries the LASzip VLR. */
export function isLaz(data: Uint8Array | ArrayBuffer): boolean {
  const bytes = asBytes(data)
  if (bytes.byteLength < 227 || decoder.decode(bytes.subarray(0, 4)) !== 'LASF') return false
  if (bytes[104] & 0xc0) return true
  return vlrs(bytes).some((v) => v.user === 'laszip encoded' && v.record === 22204)
}

interface Vlr {
  user: string
  record: number
  data: Uint8Array
}

function vlrs(bytes: Uint8Array): Vlr[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const out: Vlr[] = []
  const name = (at: number) => decoder.decode(bytes.subarray(at, at + 16)).replace(/\0.*$/s, '')
  let at = view.getUint16(94, true)
  const count = view.getUint32(100, true)
  for (let i = 0; i < count && at + 54 <= bytes.byteLength; i++) {
    const length = view.getUint16(at + 20, true)
    if (at + 54 + length > bytes.byteLength) break
    out.push({
      user: name(at + 2),
      record: view.getUint16(at + 18, true),
      data: bytes.subarray(at + 54, at + 54 + length),
    })
    at += 54 + length
  }
  // LAS 1.4 extended VLRs sit after the points (uncompressed in LAZ as well).
  if (bytes[24] === 1 && bytes[25] >= 4 && view.getUint16(94, true) >= 375) {
    let evlr = Number(view.getBigUint64(235, true))
    const evlrs = view.getUint32(243, true)
    for (let i = 0; i < evlrs && evlr > 0 && evlr + 60 <= bytes.byteLength; i++) {
      const length = Number(view.getBigUint64(evlr + 20, true))
      if (evlr + 60 + length > bytes.byteLength) break
      out.push({
        user: name(evlr + 2),
        record: view.getUint16(evlr + 18, true),
        data: bytes.subarray(evlr + 60, evlr + 60 + length),
      })
      evlr += 60 + length
    }
  }
  return out
}

interface WktNode {
  keyword: string
  args: Array<string | number | WktNode>
}

function parseWkt(text: string): WktNode | null {
  const tokens = text.match(/"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_]*|[-+]?[0-9.]+(?:[eE][-+]?\d+)?|[[\](),]/g) ?? []
  let i = 0
  const node = (): WktNode | null => {
    const keyword = tokens[i++]
    if (!keyword || !/^[A-Za-z_]/.test(keyword)) return null
    const out: WktNode = { keyword: keyword.toUpperCase(), args: [] }
    if (tokens[i] !== '[' && tokens[i] !== '(') return out
    i++
    while (i < tokens.length && tokens[i] !== ']' && tokens[i] !== ')') {
      const token = tokens[i]
      if (token !== ',' && !token.startsWith('"') && !/^[-+0-9.]/.test(token)) {
        const child = node()
        if (!child) return out
        out.args.push(child)
        continue
      }
      if (token.startsWith('"')) out.args.push(token.slice(1, -1).replace(/""/g, '"'))
      else if (token !== ',') out.args.push(Number(token))
      i++
    }
    i++
    return out
  }
  return node()
}

function wktEpsg(text: string, keywords: string[]): number | null {
  const root = parseWkt(text)
  const find = (n: WktNode): WktNode | null => {
    if (keywords.includes(n.keyword)) return n
    for (const a of n.args)
      if (typeof a === 'object') {
        const hit = find(a)
        if (hit) return hit
      }
    return null
  }
  const crs = root && find(root)
  if (!crs) return null
  for (const a of crs.args)
    if (
      typeof a === 'object' &&
      (a.keyword === 'AUTHORITY' || a.keyword === 'ID') &&
      String(a.args[0]).toUpperCase() === 'EPSG'
    ) {
      const code = Number(a.args[1])
      if (Number.isInteger(code) && code > 0) return code
    }
  // Some writers (WhiteboxTools among them) leave AUTHORITY out and name the code instead.
  const named = typeof crs.args[0] === 'string' && /EPSG\s*:\s*(\d+)/i.exec(crs.args[0])
  return named ? Number(named[1]) : null
}

/** The LAS/LAZ public header and CRS. Accepts LAZ; checks record bounds only for LAS. */
export function readPointCloudHeader(data: Uint8Array | ArrayBuffer): PointCloudHeader {
  const bytes = asBytes(data)
  if (bytes.byteLength < 227) throw Error('The file is too short to be a LAS or LAZ point cloud.')
  if (decoder.decode(bytes.subarray(0, 4)) !== 'LASF')
    throw Error('Not a LAS or LAZ file: the LASF signature is missing.')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const major = bytes[24],
    minor = bytes[25]
  const headerSize = view.getUint16(94, true)
  let points = view.getUint32(107, true)
  if (major === 1 && minor >= 4 && headerSize >= 375) points = Number(view.getBigUint64(247, true)) || points
  const double = (at: number) => view.getFloat64(at, true)
  const header: PointCloudHeader = {
    version: `${major}.${minor}`,
    pointFormat: bytes[104] & 0x3f,
    pointLength: view.getUint16(105, true),
    pointOffset: view.getUint32(96, true),
    points,
    scale: [double(131), double(139), double(147)],
    offset: [double(155), double(163), double(171)],
    max: [double(179), double(195), double(211)],
    min: [double(187), double(203), double(219)],
    compressed: isLaz(bytes),
    epsg: null,
    verticalEpsg: null,
  }
  const records = vlrs(bytes)
  for (const v of records) {
    if (v.user !== 'LASF_Projection' || v.record !== 34735 || v.data.byteLength < 8) continue
    // GeoKeyDirectory: ProjectedCSTypeGeoKey 3072, VerticalCSTypeGeoKey 4096.
    const keys = new DataView(v.data.buffer, v.data.byteOffset, v.data.byteLength)
    const count = keys.getUint16(6, true)
    for (let k = 0; k < count && 8 + k * 8 + 8 <= v.data.byteLength; k++) {
      const base = 8 + k * 8
      if (keys.getUint16(base + 2, true) !== 0) continue
      const id = keys.getUint16(base, true),
        value = keys.getUint16(base + 6, true)
      if (id === 3072 && value > 0 && value < 32767) header.epsg = value
      if (id === 4096 && value > 0 && value < 32767) header.verticalEpsg = value
    }
  }
  for (const v of records) {
    if (v.user !== 'LASF_Projection' || v.record !== 2112) continue
    const wkt = decoder.decode(v.data).replace(/\0+$/, '')
    header.epsg ??= wktEpsg(wkt, ['PROJCS', 'PROJCRS', 'PROJECTEDCRS'])
    header.verticalEpsg ??= wktEpsg(wkt, ['VERT_CS', 'VERTCRS', 'VERTICALCRS'])
  }
  if (
    !header.compressed &&
    (header.pointLength < 20 || header.pointOffset + points * header.pointLength > bytes.byteLength)
  )
    throw Error('The LAS point records are truncated or their length is not recognised.')
  return header
}

// --- reading --------------------------------------------------------------------------------------

function decodeLas(bytes: Uint8Array, h: PointCloudHeader) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const n = h.points
  const x = new Float64Array(n),
    y = new Float64Array(n),
    z = new Float64Array(n),
    classification = new Uint8Array(n)
  // Classification: low five bits of byte 15 in formats 0–5, the whole byte 16 in formats 6–10.
  const classAt = h.pointFormat >= 6 ? 16 : 15,
    classMask = h.pointFormat >= 6 ? 0xff : 0x1f
  const [sx, sy, sz] = h.scale,
    [ox, oy, oz] = h.offset
  for (let i = 0, at = h.pointOffset; i < n; i++, at += h.pointLength) {
    x[i] = view.getInt32(at, true) * sx + ox
    y[i] = view.getInt32(at + 4, true) * sy + oy
    z[i] = view.getInt32(at + 8, true) * sz + oz
    classification[i] = view.getUint8(at + classAt) & classMask
  }
  return { x, y, z, classification }
}

function boundsOf(x: Float64Array, y: Float64Array, z: Float64Array): PointCloud['bounds'] {
  const b: PointCloud['bounds'] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (let i = 0; i < x.length; i++) {
    if (x[i] < b[0]) b[0] = x[i]
    if (y[i] < b[1]) b[1] = y[i]
    if (z[i] < b[2]) b[2] = z[i]
    if (x[i] > b[3]) b[3] = x[i]
    if (y[i] > b[4]) b[4] = y[i]
    if (z[i] > b[5]) b[5] = z[i]
  }
  return b
}

/**
 * Keep one point per square cell, growing the cell until no more than `maxPoints` remain: a
 * ground point where the cell has one, else the lowest non-noise point, else the lowest point.
 * Ties go to the earlier point, and kept points stay in file order, so it is deterministic.
 */
export function thinLowest(cloud: Pick<PointCloud, 'x' | 'y' | 'z' | 'classification'>, maxPoints: number) {
  const { x, y, z, classification } = cloud
  const n = x.length
  const [minX, minY, , maxX, maxY] = boundsOf(x, y, z)
  const area = Math.max(maxX - minX, 1e-3) * Math.max(maxY - minY, 1e-3)
  let cell = Math.max(0.01, Math.sqrt(area / maxPoints))
  const rank = (i: number) => (classification[i] === 2 ? 0 : NOISE.has(classification[i]) ? 2 : 1)
  for (;;) {
    const cols = Math.floor((maxX - minX) / cell) + 1,
      rows = Math.floor((maxY - minY) / cell) + 1
    const best = new Int32Array(cols * rows).fill(-1)
    let kept = 0
    for (let i = 0; i < n; i++) {
      const c = Math.floor((y[i] - minY) / cell) * cols + Math.floor((x[i] - minX) / cell)
      const j = best[c]
      if (j < 0) {
        best[c] = i
        kept++
      } else if (rank(i) < rank(j) || (rank(i) === rank(j) && z[i] < z[j])) best[c] = i
    }
    if (kept <= maxPoints) {
      const keep = new Uint8Array(n)
      for (const i of best) if (i >= 0) keep[i] = 1
      const out = {
        x: new Float64Array(kept),
        y: new Float64Array(kept),
        z: new Float64Array(kept),
        classification: new Uint8Array(kept),
      }
      for (let i = 0, k = 0; i < n; i++)
        if (keep[i]) {
          out.x[k] = x[i]
          out.y[k] = y[i]
          out.z[k] = z[i]
          out.classification[k++] = classification[i]
        }
      return { ...out, cellM: cell }
    }
    cell *= 1.15
  }
}

/**
 * Decode a LAS or LAZ file (detected from the header, not the name). Clouds over `maxPoints` are
 * thinned with `thinLowest`; `sourceCount` and `thinCellM` say so.
 */
export async function readPointCloud(
  data: Uint8Array | ArrayBuffer,
  { maxPoints = DEFAULT_MAX_POINTS }: { maxPoints?: number } = {},
): Promise<PointCloud> {
  const bytes = asBytes(data)
  const header = readPointCloudHeader(bytes)
  const format = header.compressed ? 'laz' : 'las'
  let x: Float64Array, y: Float64Array, z: Float64Array, classification: Uint8Array
  if (format === 'las') ({ x, y, z, classification } = decodeLas(bytes, header))
  else {
    const wb = await loadWhitebox()
    let xyz: Float64Array
    try {
      xyz = wb.lidar_read_xyz(bytes, 'laz')
      classification = wb.lidar_read_classification(bytes, 'laz')
    } catch (error) {
      throw Error(`The LAZ could not be decoded: ${error instanceof Error ? error.message : String(error)}`)
    }
    const n = classification.length
    if (xyz.length !== n * 3) throw Error('The LAZ decoder returned mismatched coordinates and classes.')
    x = new Float64Array(n)
    y = new Float64Array(n)
    z = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      x[i] = xyz[i * 3]
      y[i] = xyz[i * 3 + 1]
      z[i] = xyz[i * 3 + 2]
    }
    if (header.epsg === null) {
      const info = JSON.parse(wb.lidar_info(bytes, 'laz')) as { epsg?: number | null }
      header.epsg = info.epsg ?? null
    }
  }
  const sourceCount = x.length
  if (!sourceCount) throw Error('The point cloud has no points.')
  let thinCellM: number | null = null
  if (sourceCount > maxPoints) {
    const thinned = thinLowest({ x, y, z, classification }, maxPoints)
    ;({ x, y, z, classification } = thinned)
    thinCellM = thinned.cellM
  }
  return {
    x,
    y,
    z,
    classification,
    count: x.length,
    epsg: header.epsg,
    verticalEpsg: header.verticalEpsg,
    version: header.version,
    format,
    bounds: boundsOf(x, y, z),
    sourceCount,
    thinCellM,
  }
}

/**
 * A LAS 1.2, point format 0 file of the given points (all of them, or `indices`), with a GeoTIFF
 * keys VLR when the CRS codes fit one. Coordinates are stored to the millimetre. The result also
 * reads with `buildGroundGrid` in lasSurface.ts.
 */
export function encodeLas(
  cloud: Pick<PointCloud, 'x' | 'y' | 'z' | 'classification'> & Partial<Pick<PointCloud, 'epsg' | 'verticalEpsg'>>,
  indices?: ArrayLike<number>,
): Uint8Array {
  const n = indices ? indices.length : cloud.x.length
  const at = (k: number) => (indices ? indices[k] : k)
  const keys: Array<[number, number]> = []
  if (cloud.epsg && cloud.epsg < 32767) keys.push([3072, cloud.epsg])
  if (cloud.verticalEpsg && cloud.verticalEpsg < 32767) keys.push([4096, cloud.verticalEpsg])
  const headerSize = 227,
    vlrLength = keys.length ? 8 + keys.length * 8 : 0,
    offset = headerSize + (keys.length ? 54 + vlrLength : 0),
    record = 20
  const bytes = new Uint8Array(offset + n * record)
  const view = new DataView(bytes.buffer)
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity]
  for (let k = 0; k < n; k++) {
    const i = at(k)
    const p = [cloud.x[i], cloud.y[i], cloud.z[i]]
    for (let d = 0; d < 3; d++) {
      if (p[d] < min[d]) min[d] = p[d]
      if (p[d] > max[d]) max[d] = p[d]
    }
  }
  if (!n) {
    min.fill(0)
    max.fill(0)
  }
  const scale = 0.001,
    origin = min.map((v) => Math.floor(v))
  bytes.set(new TextEncoder().encode('LASF'), 0)
  view.setUint8(24, 1)
  view.setUint8(25, 2)
  bytes.set(new TextEncoder().encode('PGMaps'), 58)
  view.setUint16(94, headerSize, true)
  view.setUint32(96, offset, true)
  view.setUint32(100, keys.length ? 1 : 0, true)
  view.setUint8(104, 0)
  view.setUint16(105, record, true)
  view.setUint32(107, n, true)
  view.setUint32(111, n, true)
  for (let d = 0; d < 3; d++) {
    view.setFloat64(131 + d * 8, scale, true)
    view.setFloat64(155 + d * 8, origin[d], true)
    view.setFloat64(179 + d * 16, max[d], true)
    view.setFloat64(187 + d * 16, min[d], true)
  }
  if (keys.length) {
    bytes.set(new TextEncoder().encode('LASF_Projection'), headerSize + 2)
    view.setUint16(headerSize + 18, 34735, true)
    view.setUint16(headerSize + 20, vlrLength, true)
    const dir = headerSize + 54
    ;[1, 1, 0, keys.length].forEach((v, i) => view.setUint16(dir + i * 2, v, true))
    keys.forEach(([id, value], k) =>
      [id, 0, 1, value].forEach((v, i) => view.setUint16(dir + 8 + k * 8 + i * 2, v, true)),
    )
  }
  for (let k = 0, p = offset; k < n; k++, p += record) {
    const i = at(k)
    view.setInt32(p, Math.round((cloud.x[i] - origin[0]) / scale), true)
    view.setInt32(p + 4, Math.round((cloud.y[i] - origin[1]) / scale), true)
    view.setInt32(p + 8, Math.round((cloud.z[i] - origin[2]) / scale), true)
    view.setUint8(p + 14, 0b001_001) // return 1 of 1
    view.setUint8(p + 15, cloud.classification[i] & 0x1f)
  }
  return bytes
}

// --- ground classification ------------------------------------------------------------------------

export interface ClassifyGroundOptions {
  method?: GroundMethod
  params?: Partial<GroundPointFilterParams> | Partial<SegmentationFilterParams>
  /**
   * Points per tool run. WhiteboxTools' filters slow down faster than linearly with the points in
   * one run (the slope filter: ~70 k points/s at 100 k, ~39 k at 400 k), so larger clouds go
   * through in overlapping tiles: ~55 k points/s overall at 1 M, identical classes to one run.
   */
  tilePoints?: number
  onProgress?: (done: number, total: number) => void
}

function toolArgs(method: GroundMethod, params: ClassifyGroundOptions['params']) {
  const io = ['--input=/work/tile.las', '--output=/work/ground.las', '--classify']
  if (method === 'segmentation') {
    const p = { ...GROUND_FILTER_DEFAULTS.segmentation, ...(params as Partial<SegmentationFilterParams>) }
    return {
      tool: 'lidar_segmentation_based_filter',
      radius: p.searchRadius,
      args: [...io, `--search_radius=${p.searchRadius}`, `--max_z_diff=${p.maxZDiff}`],
    }
  }
  const p = { ...GROUND_FILTER_DEFAULTS.ground_point_filter, ...(params as Partial<GroundPointFilterParams>) }
  return {
    tool: 'lidar_ground_point_filter',
    radius: p.searchRadius,
    args: [
      ...io,
      `--search_radius=${p.searchRadius}`,
      `--min_neighbours=${p.minNeighbours}`,
      `--slope_threshold=${Math.min(88, p.slopeThreshold)}`,
      `--height_threshold=${p.heightThreshold}`,
      `--slope_norm=${p.slopeNorm}`,
    ],
  }
}

/**
 * Ground (2) or not (1) for every point, in the cloud's own order. Noise (7, 18) is left out of
 * the filter, where a low outlier would pull the surface down, and keeps its class. Existing
 * classes are otherwise replaced. Large clouds run in tiles that overlap by several search radii
 * and keep each point's class from the tile whose core holds it.
 */
export async function classifyGround(
  input: Uint8Array | ArrayBuffer | PointCloud,
  { method = 'ground_point_filter', params, tilePoints = 40_000, onProgress }: ClassifyGroundOptions = {},
): Promise<Uint8Array> {
  const cloud =
    input instanceof Uint8Array || input instanceof ArrayBuffer
      ? await readPointCloud(input, { maxPoints: Infinity })
      : input
  const { tool, radius, args } = toolArgs(method, params)
  const { runTool } = await loadTools()
  const out = cloud.classification.slice()
  const candidates: number[] = []
  for (let i = 0; i < cloud.count; i++) if (!NOISE.has(cloud.classification[i])) candidates.push(i)
  if (!candidates.length) return out

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const i of candidates) {
    minX = Math.min(minX, cloud.x[i])
    maxX = Math.max(maxX, cloud.x[i])
    minY = Math.min(minY, cloud.y[i])
    maxY = Math.max(maxY, cloud.y[i])
  }
  const buffer = Math.max(6, 3 * radius)
  const area = Math.max(maxX - minX, 1) * Math.max(maxY - minY, 1)
  const single = candidates.length <= tilePoints * 1.5
  const side = single ? Infinity : Math.max(2 * buffer, Math.sqrt((tilePoints * area) / candidates.length))
  const cols = single ? 1 : Math.floor((maxX - minX) / side) + 1,
    rows = single ? 1 : Math.floor((maxY - minY) / side) + 1
  const tileOf = (i: number) =>
    single ? 0 : Math.floor((cloud.y[i] - minY) / side) * cols + Math.floor((cloud.x[i] - minX) / side)
  // Bucket the candidates by tile (a counting sort keeps file order within each tile).
  const starts = new Int32Array(cols * rows + 1)
  for (const i of candidates) starts[tileOf(i) + 1]++
  for (let t = 0; t < cols * rows; t++) starts[t + 1] += starts[t]
  const fill = starts.slice(0, -1),
    sorted = new Int32Array(candidates.length)
  for (const i of candidates) sorted[fill[tileOf(i)]++] = i

  const tiles = []
  for (let t = 0; t < cols * rows; t++) if (starts[t + 1] > starts[t]) tiles.push(t)
  const unclassified = { ...cloud, classification: new Uint8Array(cloud.count).fill(1) }
  for (const [done, t] of tiles.entries()) {
    onProgress?.(done, tiles.length)
    const core = sorted.subarray(starts[t], starts[t + 1])
    const members = Array.from(core)
    if (!single) {
      const col = t % cols,
        row = Math.floor(t / cols)
      const x0 = minX + col * side - buffer,
        x1 = minX + (col + 1) * side + buffer,
        y0 = minY + row * side - buffer,
        y1 = minY + (row + 1) * side + buffer
      for (let r = row - 1; r <= row + 1; r++)
        for (let c = col - 1; c <= col + 1; c++) {
          if ((r === row && c === col) || r < 0 || c < 0 || r >= rows || c >= cols) continue
          const n = r * cols + c
          for (let k = starts[n]; k < starts[n + 1]; k++) {
            const i = sorted[k]
            if (cloud.x[i] >= x0 && cloud.x[i] < x1 && cloud.y[i] >= y0 && cloud.y[i] < y1) members.push(i)
          }
        }
    }
    const tile = encodeLas(unclassified, members)
    const result = await runTool(tool, { args, input: { 'tile.las': tile } })
    const written = result.files['ground.las']
    if (result.exitCode !== 0 || !written)
      throw Error(`${tool} failed: ${result.stdout.slice(-3).join(' ') || `exit code ${result.exitCode}`}`)
    const header = readPointCloudHeader(written)
    const back = decodeLas(written, header)
    if (back.x.length !== members.length) throw Error(`${tool} returned ${back.x.length} of ${members.length} points.`)
    // The tools keep the input order; check it rather than trust it.
    for (let k = 0; k < members.length; k++) {
      const i = members[k]
      if (Math.abs(back.x[k] - cloud.x[i]) > 0.002 || Math.abs(back.y[k] - cloud.y[i]) > 0.002)
        throw Error(`${tool} reordered the points; the classification cannot be mapped back.`)
    }
    for (let k = 0; k < core.length; k++) out[core[k]] = back.classification[k] === 2 ? 2 : 1
  }
  onProgress?.(tiles.length, tiles.length)
  return out
}

export interface GroundSummary {
  total: number
  ground: number
  noise: number
  /** Points per ASPRS class, ascending by class. */
  byClass: Array<{ cls: number; count: number }>
}

export function groundSummary(cloud: Pick<PointCloud, 'classification'>): GroundSummary {
  const counts = new Uint32Array(256)
  for (const c of cloud.classification) counts[c]++
  const byClass: GroundSummary['byClass'] = []
  counts.forEach((count, cls) => count && byClass.push({ cls, count }))
  return { total: cloud.classification.length, ground: counts[2], noise: counts[7] + counts[18], byClass }
}
