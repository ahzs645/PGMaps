/**
 * Ground points (and optional breaklines) to a triangulated surface, and that surface to a
 * `GroundGrid` that drops into the same terrain path as `buildGroundGrid`. Breaklines are hard
 * edges — a ditch invert, a ridge, a road shoulder — that a triangle must not cut across; without
 * them a TIN of scattered points shaves the top off every ridge and fills every ditch.
 * Pure: projected metres in, typed arrays out, no DOM or network access.
 */
import Constrainautor from '@kninnug/constrainautor'
import Delaunator from 'delaunator'
import type { GroundGrid } from './lasSurface'
import { strategicPointIndices, type PointPreservation } from './terrainPreparation'

/** Projected metres. A null z takes its height from the TIN of the points under that vertex. */
export interface Breakline {
  id?: string
  points: Array<[number, number, number | null]>
}
export interface Tin {
  /** x, y pairs: the ground points used, then the breakline vertices. */
  coords: Float64Array
  z: Float64Array
  /** Vertex indices, three per triangle. */
  triangles: Uint32Array
  /** Breakline segments (after densifying) held as triangle edges. */
  constrained: number
  /** Breaklines, or parts of them, that could not be held, and crossings whose given z was overruled. */
  skipped: Array<{ id?: string; reason: string }>
  /** Breakline crossings split into a shared vertex. */
  split: number
  /** Ground points in the TIN, after thinning, deduplication and clearing around breaklines. */
  cloudPoints: number
  /** Points supplied. */
  totalPoints: number
  /** The thinning cell, when the cloud was thinned; null when every point was kept. */
  thinCellM: number | null
}
export interface TinOptions {
  preserve?: PointPreservation
  /** Thinning cell, 0.5 m; grown if one point per cell would still exceed `maxPoints`. */
  thinCellM?: number
  /** Thin only above this many points: 1.5 M. */
  maxPoints?: number
  /**
   * Breakline segments longer than this get intermediate vertices: twice the thinning cell. Close
   * enough that a null-z line samples the ground every metre or so, and that the triangles along
   * it stay short enough for `rasterizeTin`'s edge limit.
   */
  densifyM?: number
}
export interface RasterOptions {
  /** 1 m, grown (like `buildGroundGrid`) until the grid fits `maxCells`. */
  cellM?: number
  maxCells?: number
  /** Triangles with a longer edge stay missing; eight of the cells actually used. */
  maxEdgeM?: number
  /** [minX, minY, maxX, maxY]; defaults to the TIN's extent. */
  bounds?: [number, number, number, number]
}

/**
 * 1.5 M points triangulates in about a second (Node, M-series Mac) and bounds Delaunator's and
 * Constrainautor's working arrays to a size a browser tab holds comfortably. A 1 m ground grid
 * has one cell per square metre, so more points than that rarely change it.
 */
const MAX_POINTS = 1_500_000
const THIN_CELL_M = 0.5
/** Coordinates closer than this are the same point; LAS stores millimetres at best. */
const SAME_M = 0.001
/**
 * Ground points this close to a breakline are dropped: one lying exactly on a constraint stops
 * Constrainautor ("intersects point"), and one a hair off it only makes sliver triangles.
 */
const CLEAR_M = 0.02

interface Vertex {
  x: number
  y: number
  z: number | null
}
interface Line {
  id?: string
  vertices: Vertex[]
}

/**
 * Delaunay-triangulate the points with the breaklines as constrained edges. Bad breaklines are
 * reported in `skipped`, never thrown; too few points (or all collinear) do throw.
 */
export function buildTin(
  points: { x: Float64Array; y: Float64Array; z: Float64Array },
  breaklines: Breakline[] = [],
  { thinCellM = THIN_CELL_M, maxPoints = MAX_POINTS, densifyM, preserve }: TinOptions = {},
): Tin {
  const { x, y, z } = points
  const total = Math.min(x.length, y.length, z.length)
  let finite = 0
  for (let i = 0; i < total; i++) if (Number.isFinite(x[i]) && Number.isFinite(y[i]) && Number.isFinite(z[i])) finite++
  const valid = new Uint32Array(finite)
  for (let i = 0, k = 0; i < total; i++)
    if (Number.isFinite(x[i]) && Number.isFinite(y[i]) && Number.isFinite(z[i])) valid[k++] = i
  const protectedThin =
    finite > maxPoints && preserve
      ? strategicPointIndices(
          {
            x: Float64Array.from(valid, (i) => x[i]),
            y: Float64Array.from(valid, (i) => y[i]),
            z: Float64Array.from(valid, (i) => z[i]),
          },
          maxPoints,
          preserve,
        )
      : null
  const thinned = protectedThin
    ? { kept: Uint32Array.from(protectedThin.indices, (i) => valid[i]), cellM: protectedThin.cellM ?? thinCellM }
    : finite > maxPoints
      ? thinLowest(x, y, z, valid, Math.max(SAME_M, thinCellM), maxPoints)
      : null
  const kept = thinned ? thinned.kept : dedupeLowest(x, y, z, valid)
  let cx = new Float64Array(kept.length),
    cy = new Float64Array(kept.length),
    cz = new Float64Array(kept.length)
  kept.forEach((i, k) => {
    cx[k] = x[i]
    cy[k] = y[i]
    cz[k] = z[i]
  })
  const step = densifyM ?? 2 * (thinned?.cellM ?? thinCellM)
  const skipped: Tin['skipped'] = []
  const lines = cleanBreaklines(breaklines, skipped)
  const split = splitCrossings(lines)
  const { bx, by, bz, edges, owner } = densify(lines, step, skipped)

  // A null-z breakline vertex samples the TIN of the ground points alone.
  if (bz.some((v) => v === null)) {
    const cloud = interleave(cx, cy)
    const del = cloud.length >= 6 ? new Delaunator(cloud) : null
    let from = 0
    for (let v = 0; v < bz.length; v++) {
      if (bz[v] !== null) continue
      const hit = del && del.triangles.length ? locate(del, bx[v], by[v], from) : -1
      if (hit < 0) continue
      from = hit
      bz[v] = planeAt(cloud, cz, del!.triangles, hit, bx[v], by[v])
    }
  }
  const unresolved = new Map<number, number>()
  const held: Array<[number, number, number]> = []
  edges.forEach(([a, b], k) => {
    if (bz[a] === null || bz[b] === null) unresolved.set(owner[k], (unresolved.get(owner[k]) ?? 0) + 1)
    else held.push([a, b, owner[k]])
  })
  for (const [line, count] of unresolved)
    skipped.push({
      id: lines[line].id,
      reason: `${count} segment${count === 1 ? '' : 's'} off the point cloud, with no z given and no ground to take it from`,
    })

  if (held.length) {
    const clear = clearAround(cx, cy, bx, by, held)
    if (clear) {
      const keep = Array.from(clear.keys()).filter((i) => !clear[i])
      cx = Float64Array.from(keep, (i) => cx[i])
      cy = Float64Array.from(keep, (i) => cy[i])
      cz = Float64Array.from(keep, (i) => cz[i])
    }
  }
  // Breakline vertices go in only if some held segment uses them, so a skipped line adds nothing.
  const used = new Int32Array(bx.length).fill(-1)
  let next = cx.length
  for (const [a, b] of held) for (const v of [a, b]) if (used[v] < 0) used[v] = next++
  const coords = new Float64Array(next * 2),
    zs = new Float64Array(next)
  coords.set(interleave(cx, cy))
  zs.set(cz)
  used.forEach((at, v) => {
    if (at < 0) return
    coords[at * 2] = bx[v]
    coords[at * 2 + 1] = by[v]
    zs[at] = bz[v]!
  })
  if (next < 3) throw Error('A TIN needs at least three ground points.')
  const del = new Delaunator(coords)
  if (!del.triangles.length) throw Error('The ground points are collinear; there is no surface to triangulate.')

  let constrained = 0
  if (held.length) {
    const failed = new Map<number, Map<string, number>>()
    const con = new Constrainautor(del)
    con.flips = new FlipSet(del.triangles.length) as unknown as typeof con.flips
    const onSegment = vertexIndex(bx, by, used, step)
    const fail = (line: number, error: unknown) => {
      const reasons = failed.get(line) ?? new Map<string, number>()
      const reason = error instanceof Error ? error.message : String(error)
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
      failed.set(line, reasons)
    }
    for (const [a, b, line] of held) {
      try {
        con.constrainOne(used[a], used[b])
        constrained++
      } catch (error) {
        // Where two breaklines overlap, one's vertex sits on the other's segment: go through it.
        const via = error instanceof Error && /intersects point/.test(error.message) ? onSegment(a, b) : []
        if (!via.length) {
          fail(line, error)
          continue
        }
        const chain = [a, ...via, b]
        for (let k = 0; k + 1 < chain.length; k++)
          try {
            con.constrainOne(used[chain[k]], used[chain[k + 1]])
            constrained++
          } catch (inner) {
            fail(line, inner)
          }
      }
    }
    for (const [line, reasons] of failed)
      for (const [reason, count] of reasons)
        skipped.push({
          id: lines[line].id,
          reason: `${count} segment${count === 1 ? '' : 's'} not held: ${reason.charAt(0).toLowerCase()}${reason.slice(1)}`,
        })
  }
  return {
    coords,
    z: zs,
    triangles: del.triangles,
    constrained,
    skipped,
    split,
    cloudPoints: cx.length,
    totalPoints: total,
    thinCellM: thinned ? thinned.cellM : null,
  }
}

/**
 * Each cell centre takes the plane of the triangle it falls in. A triangle with any edge longer
 * than `maxEdgeM` is left missing: Delaunay fills the whole convex hull, so without the limit a
 * lake, a no-return patch or a concave edge of the survey would be bridged with invented ground.
 * The default, eight cells, is just beyond the three-pass gap fill `buildGroundGrid` does (about
 * six cells), so the two importers leave the same voids open.
 */
export function rasterizeTin(
  tin: Pick<Tin, 'coords' | 'z' | 'triangles' | 'cloudPoints' | 'totalPoints'>,
  { cellM = 1, maxCells = 4_194_304, maxEdgeM, bounds }: RasterOptions = {},
): GroundGrid {
  const { coords, z, triangles } = tin
  let [minX, minY, maxX, maxY] = bounds ?? [Infinity, Infinity, -Infinity, -Infinity]
  if (!bounds)
    for (let i = 0; i < coords.length; i += 2) {
      minX = Math.min(minX, coords[i])
      maxX = Math.max(maxX, coords[i])
      minY = Math.min(minY, coords[i + 1])
      maxY = Math.max(maxY, coords[i + 1])
    }
  const spanX = maxX - minX,
    spanY = maxY - minY
  if (!(spanX > 0 && spanY > 0)) throw Error('The surface has no horizontal extent.')
  let cell = Math.max(0.1, cellM)
  while ((Math.floor(spanX / cell) + 1) * (Math.floor(spanY / cell) + 1) > maxCells) cell *= 1.25
  const width = Math.floor(spanX / cell) + 1,
    height = Math.floor(spanY / cell) + 1
  const ox = minX + cell / 2,
    oy = maxY - cell / 2
  const longest = (maxEdgeM ?? 8 * cell) ** 2
  const values = new Float64Array(width * height).fill(NaN)
  for (let t = 0; t < triangles.length; t += 3) {
    const a = triangles[t],
      b = triangles[t + 1],
      c = triangles[t + 2]
    const x0 = coords[a * 2],
      y0 = coords[a * 2 + 1],
      x1 = coords[b * 2],
      y1 = coords[b * 2 + 1],
      x2 = coords[c * 2],
      y2 = coords[c * 2 + 1]
    const ux = x1 - x0,
      uy = y1 - y0,
      vx = x2 - x0,
      vy = y2 - y0
    if (ux * ux + uy * uy > longest || vx * vx + vy * vy > longest || (x2 - x1) ** 2 + (y2 - y1) ** 2 > longest)
      continue
    const det = ux * vy - vx * uy
    if (!det) continue
    // Barycentric weights of b and c, and the plane z = z0 + gx·dx + gy·dy.
    const dz1 = z[b] - z[a],
      dz2 = z[c] - z[a]
    const gx = (dz1 * vy - dz2 * uy) / det,
      gy = (ux * dz2 - vx * dz1) / det
    // Cell centres on a shared edge belong to both triangles; the tolerance keeps them from both missing.
    const tol = -1e-9
    const c0 = Math.max(0, Math.ceil((Math.min(x0, x1, x2) - ox) / cell - 1e-9)),
      c1 = Math.min(width - 1, Math.floor((Math.max(x0, x1, x2) - ox) / cell + 1e-9)),
      r0 = Math.max(0, Math.ceil((oy - Math.max(y0, y1, y2)) / cell - 1e-9)),
      r1 = Math.min(height - 1, Math.floor((oy - Math.min(y0, y1, y2)) / cell + 1e-9))
    for (let row = r0; row <= r1; row++) {
      const dy = oy - row * cell - y0
      for (let col = c0; col <= c1; col++) {
        const dx = ox + col * cell - x0
        const wb = (dx * vy - vx * dy) / det,
          wc = (ux * dy - dx * uy) / det
        if (wb < tol || wc < tol || 1 - wb - wc < tol) continue
        values[row * width + col] = z[a] + gx * dx + gy * dy
      }
    }
  }
  return {
    epsg: null,
    origin: [ox, oy],
    pixelSize: [cell, -cell],
    width,
    height,
    values: Array.from(values, (v) => (Number.isNaN(v) ? null : Math.round(v * 1000) / 1000)),
    groundPoints: tin.cloudPoints,
    totalPoints: tin.totalPoints,
    filledCells: 0,
    cellM: cell,
  }
}

/** `buildTin` then `rasterizeTin`; the TIN comes back too for its breakline report. */
export function gridFromPoints(
  points: { x: Float64Array; y: Float64Array; z: Float64Array },
  breaklines: Breakline[] = [],
  options: TinOptions & RasterOptions = {},
): { grid: GroundGrid; tin: Tin } {
  const tin = buildTin(points, breaklines, options)
  return { grid: rasterizeTin(tin, options), tin }
}

/**
 * GeoJSON LineString, MultiLineString, Polygon and MultiPolygon features (rings become closed
 * breaklines) to breaklines in the grid's projection. z comes from a third coordinate, else the
 * first finite number among the `z`, `Z`, `elevation`, `ELEVATION` and `elev` properties, else null
 * (taken from the ground).
 */
export function readBreaklines(geojson: unknown, toGrid: (lon: number, lat: number) => [number, number]): Breakline[] {
  const out: Breakline[] = []
  const features: unknown[] = []
  const root = geojson as { type?: string; features?: unknown[] } | null
  if (root?.type === 'FeatureCollection' && Array.isArray(root.features)) features.push(...root.features)
  else if (root?.type === 'Feature') features.push(root)
  else if (root?.type) features.push({ type: 'Feature', geometry: root, properties: {} })
  features.forEach((value, f) => {
    const feature = value as {
      id?: string | number
      geometry?: { type?: string; coordinates?: unknown }
      properties?: Record<string, unknown> | null
    }
    const props = feature.properties ?? {}
    const named = feature.id ?? props.id ?? props.name
    const id = named === undefined || named === null ? `feature ${f + 1}` : String(named)
    const fallback = [props.z, props.Z, props.elevation, props.ELEVATION, props.elev].find(
      (v) => typeof v === 'number' && Number.isFinite(v),
    ) as number | undefined
    const { type, coordinates } = feature.geometry ?? {}
    const parts =
      type === 'LineString'
        ? [coordinates]
        : type === 'MultiLineString' || type === 'Polygon'
          ? (coordinates as unknown[])
          : type === 'MultiPolygon'
            ? (coordinates as unknown[][]).flat()
            : []
    if (!Array.isArray(parts)) return
    parts.forEach((part, k) => {
      if (!Array.isArray(part)) return
      const points: Breakline['points'] = []
      for (const position of part as unknown[]) {
        if (!Array.isArray(position) || !Number.isFinite(position[0]) || !Number.isFinite(position[1])) continue
        const [gx, gy] = toGrid(position[0], position[1])
        const gz = Number.isFinite(position[2]) ? (position[2] as number) : (fallback ?? null)
        points.push([gx, gy, gz])
      }
      out.push({ id: parts.length > 1 ? `${id} · part ${k + 1}` : id, points })
    })
  })
  return out
}

/** Lowest point per cell, cells in row order; the cell grows until the kept count fits. */
function thinLowest(
  x: Float64Array,
  y: Float64Array,
  z: Float64Array,
  valid: Uint32Array,
  cellM: number,
  maxPoints: number,
): { kept: Uint32Array; cellM: number } {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (const i of valid) {
    minX = Math.min(minX, x[i])
    maxX = Math.max(maxX, x[i])
    minY = Math.min(minY, y[i])
    maxY = Math.max(maxY, y[i])
  }
  // Start no finer than four cells per kept point, so the cell index stays a bounded array.
  let cell = Math.max(cellM, Math.sqrt(((maxX - minX) * (maxY - minY)) / (4 * maxPoints)))
  for (;;) {
    const width = Math.floor((maxX - minX) / cell) + 1,
      height = Math.floor((maxY - minY) / cell) + 1
    const best = new Int32Array(width * height).fill(-1)
    let count = 0
    for (const i of valid) {
      const at = Math.floor((maxY - y[i]) / cell) * width + Math.floor((x[i] - minX) / cell)
      const j = best[at]
      if (j < 0) count++
      // Lowest, because these are ground returns and the lowest is the least likely to be low
      // vegetation, a log or a misclassified canopy hit; ties keep the earlier point.
      if (j < 0 || z[i] < z[j]) best[at] = i
    }
    if (count <= maxPoints) {
      const kept = new Uint32Array(count)
      for (let at = 0, k = 0; at < best.length; at++) if (best[at] >= 0) kept[k++] = best[at]
      return { kept, cellM: cell }
    }
    cell *= 1.25
  }
}

/** One point per millimetre position, the lowest; input order is kept. */
function dedupeLowest(x: Float64Array, y: Float64Array, z: Float64Array, valid: Uint32Array): Uint32Array {
  let size = 1
  while (size < valid.length * 2) size *= 2
  const table = new Int32Array(size).fill(-1)
  const mask = size - 1
  let count = 0
  for (const i of valid) {
    const qx = Math.round(x[i] / SAME_M),
      qy = Math.round(y[i] / SAME_M)
    let h = (Math.imul(qx | 0, 0x9e3779b1) ^ Math.imul(qy | 0, 0x85ebca77)) & mask
    for (;;) {
      const j = table[h]
      if (j < 0) {
        table[h] = i
        count++
        break
      }
      if (Math.round(x[j] / SAME_M) === qx && Math.round(y[j] / SAME_M) === qy) {
        if (z[i] < z[j]) table[h] = i
        break
      }
      h = (h + 1) & mask
    }
  }
  const kept = new Uint32Array(count)
  for (let h = 0, k = 0; h < size; h++) if (table[h] >= 0) kept[k++] = table[h]
  return kept.sort()
}

/**
 * Constrainautor 4.1 keeps its flipped edges in a bit set and walks the whole set after every
 * `constrainOne`. With 6 M half-edges that walk is most of the cost — 20 k short breakline
 * segments took 12 s. This set has the same methods (add, delete, set, has, forEach) but also
 * lists what was added, so `forEach` visits only those; constraining then costs what it flips.
 */
class FlipSet {
  private readonly marked: Uint8Array
  /** Whether an index is in `added`, so it is listed once however often it is re-added. */
  private readonly listed: Uint8Array
  private added: number[] = []
  constructor(length: number) {
    this.marked = new Uint8Array(length)
    this.listed = new Uint8Array(length)
  }
  add(i: number) {
    this.marked[i] = 1
    if (!this.listed[i]) {
      this.listed[i] = 1
      this.added.push(i)
    }
    return this
  }
  delete(i: number) {
    this.marked[i] = 0
    return this
  }
  set(i: number, value: boolean) {
    if (value) this.add(i)
    else this.marked[i] = 0
    return value
  }
  has(i: number) {
    return this.marked[i] === 1
  }
  /** Like the bit set, `fn` may delete or add while iterating; an addition may wait for the next call. */
  forEach(fn: (i: number) => void) {
    const pending = this.added
    this.added = []
    for (const i of pending) this.listed[i] = 0
    for (const i of pending) if (this.marked[i]) fn(i)
    // Anything still marked and not re-listed during the pass stays pending.
    for (const i of pending)
      if (this.marked[i] && !this.listed[i]) {
        this.listed[i] = 1
        this.added.push(i)
      }
    return this
  }
}

function cleanBreaklines(breaklines: Breakline[], skipped: Tin['skipped']): Line[] {
  const lines: Line[] = []
  for (const line of breaklines) {
    const vertices: Vertex[] = []
    for (const p of line.points ?? []) {
      if (!Array.isArray(p) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) continue
      const v = { x: p[0], y: p[1], z: Number.isFinite(p[2]) ? (p[2] as number) : null }
      const last = vertices[vertices.length - 1]
      if (last && Math.hypot(v.x - last.x, v.y - last.y) < SAME_M) continue
      vertices.push(v)
    }
    if (vertices.length < 2) skipped.push({ id: line.id, reason: 'fewer than two distinct vertices' })
    else lines.push({ id: line.id, vertices })
  }
  return lines
}

/**
 * Where two breakline segments cross (or one ends on another), both get a vertex at the crossing
 * so neither constraint has to pass through the other. Parallel overlaps are left for
 * Constrainautor to refuse and the caller to report. Returns the number of crossings split.
 */
function splitCrossings(lines: Line[]): number {
  interface Segment {
    line: number
    k: number
    ax: number
    ay: number
    bx: number
    by: number
    minX: number
    maxX: number
    cuts: Array<{ t: number; x: number; y: number }>
  }
  const segments: Segment[] = []
  lines.forEach((line, l) => {
    for (let k = 0; k + 1 < line.vertices.length; k++) {
      const a = line.vertices[k],
        b = line.vertices[k + 1]
      segments.push({
        line: l,
        k,
        ax: a.x,
        ay: a.y,
        bx: b.x,
        by: b.y,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        cuts: [],
      })
    }
  })
  segments.sort((p, q) => p.minX - q.minX)
  let split = 0
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]
    for (let j = i + 1; j < segments.length && segments[j].minX <= s.maxX + SAME_M; j++) {
      const r = segments[j]
      const sx = s.bx - s.ax,
        sy = s.by - s.ay,
        rx = r.bx - r.ax,
        ry = r.by - r.ay
      const lenS = Math.hypot(sx, sy),
        lenR = Math.hypot(rx, ry)
      const den = sx * ry - sy * rx
      if (Math.abs(den) <= 1e-12 * lenS * lenR) continue
      const qx = r.ax - s.ax,
        qy = r.ay - s.ay
      const t = (qx * ry - qy * rx) / den,
        u = (qx * sy - qy * sx) / den
      const tolS = SAME_M / lenS,
        tolR = SAME_M / lenR
      if (t < -tolS || t > 1 + tolS || u < -tolR || u > 1 + tolR) continue
      const sEnd = t <= tolS ? 0 : t >= 1 - tolS ? 1 : null,
        rEnd = u <= tolR ? 0 : u >= 1 - tolR ? 1 : null
      if (sEnd !== null && rEnd !== null) continue
      // An end touching the other segment is the crossing point exactly, so both share it.
      const [px, py] =
        sEnd !== null
          ? sEnd
            ? [s.bx, s.by]
            : [s.ax, s.ay]
          : rEnd !== null
            ? rEnd
              ? [r.bx, r.by]
              : [r.ax, r.ay]
            : [s.ax + t * sx, s.ay + t * sy]
      if (sEnd === null) s.cuts.push({ t, x: px, y: py })
      if (rEnd === null) r.cuts.push({ t: u, x: px, y: py })
      split++
    }
  }
  if (!split) return 0
  const bySegment = new Map(segments.map((s) => [`${s.line}:${s.k}`, s]))
  lines.forEach((line, l) => {
    const vertices: Vertex[] = [line.vertices[0]]
    for (let k = 0; k + 1 < line.vertices.length; k++) {
      const a = line.vertices[k],
        b = line.vertices[k + 1]
      const cuts = bySegment.get(`${l}:${k}`)!.cuts.sort((p, q) => p.t - q.t)
      for (const cut of cuts) vertices.push({ x: cut.x, y: cut.y, z: lerp(a.z, b.z, cut.t) })
      vertices.push(b)
    }
    line.vertices = vertices
  })
  return split
}

/**
 * Breakline vertices (shared where lines meet, the first given z winning) and the segments
 * between them, at most `step` long. A densified vertex between two given heights is graded
 * between them; next to a null-z vertex it is null too, and samples the ground.
 */
function densify(lines: Line[], step: number, skipped: Tin['skipped']) {
  const bx: number[] = [],
    by: number[] = [],
    bz: Array<number | null> = []
  const index = new Map<string, number>()
  const conflicts = new Map<number, number>()
  const edges: Array<[number, number]> = [],
    owner: number[] = []
  const vertex = (x: number, y: number, z: number | null, line: number) => {
    const key = `${Math.round(x / SAME_M)},${Math.round(y / SAME_M)}`
    const at = index.get(key)
    if (at === undefined) {
      index.set(key, bx.length)
      bx.push(x)
      by.push(y)
      bz.push(z)
      return bx.length - 1
    }
    if (bz[at] === null) bz[at] = z
    else if (z !== null && Math.abs(z - bz[at]!) > 0.01)
      conflicts.set(line, Math.max(conflicts.get(line) ?? 0, Math.abs(z - bz[at]!)))
    return at
  }
  lines.forEach((line, l) => {
    let prev = vertex(line.vertices[0].x, line.vertices[0].y, line.vertices[0].z, l)
    for (let k = 0; k + 1 < line.vertices.length; k++) {
      const a = line.vertices[k],
        b = line.vertices[k + 1]
      const pieces = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
      for (let p = 1; p <= pieces; p++) {
        const t = p / pieces
        const v =
          p === pieces
            ? vertex(b.x, b.y, b.z, l)
            : vertex(a.x + t * (b.x - a.x), a.y + t * (b.y - a.y), lerp(a.z, b.z, t), l)
        if (v !== prev) {
          edges.push([prev, v])
          owner.push(l)
        }
        prev = v
      }
    }
  })
  for (const [line, dz] of conflicts)
    skipped.push({
      id: lines[line].id,
      reason: `meets an earlier breakline whose z differs by ${dz.toFixed(2)} m; the earlier z was kept`,
    })
  return { bx, by, bz, edges, owner }
}

/**
 * Flags ground points within `CLEAR_M` of a held breakline segment, through a bucket grid of the
 * points; null when none are that close.
 */
function clearAround(
  cx: Float64Array,
  cy: Float64Array,
  bx: number[],
  by: number[],
  held: Array<[number, number, number]>,
): Uint8Array | null {
  const n = cx.length
  if (!n) return null
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, cx[i])
    maxX = Math.max(maxX, cx[i])
    minY = Math.min(minY, cy[i])
    maxY = Math.max(maxY, cy[i])
  }
  // About four points per bucket.
  const size = Math.max(SAME_M, Math.sqrt(((maxX - minX) * (maxY - minY) * 4) / n) || 1)
  const width = Math.floor((maxX - minX) / size) + 1,
    height = Math.floor((maxY - minY) / size) + 1
  const start = new Uint32Array(width * height + 1)
  const bucketOf = (i: number) => Math.floor((cy[i] - minY) / size) * width + Math.floor((cx[i] - minX) / size)
  for (let i = 0; i < n; i++) start[bucketOf(i) + 1]++
  for (let b = 0; b < width * height; b++) start[b + 1] += start[b]
  const fill = start.slice(0, -1),
    order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[fill[bucketOf(i)]++] = i
  const flags = new Uint8Array(n)
  let any = false
  for (const [a, b] of held) {
    const ax = bx[a],
      ay = by[a],
      dx = bx[b] - ax,
      dy = by[b] - ay
    const len2 = dx * dx + dy * dy
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx[b]) - CLEAR_M - minX) / size)),
      c1 = Math.min(width - 1, Math.floor((Math.max(ax, bx[b]) + CLEAR_M - minX) / size)),
      r0 = Math.max(0, Math.floor((Math.min(ay, by[b]) - CLEAR_M - minY) / size)),
      r1 = Math.min(height - 1, Math.floor((Math.max(ay, by[b]) + CLEAR_M - minY) / size))
    for (let row = r0; row <= r1; row++)
      for (let col = c0; col <= c1; col++) {
        const bucket = row * width + col
        for (let k = start[bucket]; k < start[bucket + 1]; k++) {
          const i = order[k]
          const t = len2 ? Math.max(0, Math.min(1, ((cx[i] - ax) * dx + (cy[i] - ay) * dy) / len2)) : 0
          if (Math.hypot(cx[i] - ax - t * dx, cy[i] - ay - t * dy) <= CLEAR_M) {
            flags[i] = 1
            any = true
          }
        }
      }
  }
  return any ? flags : null
}

/**
 * For a breakline segment a→b, the other breakline vertices in the TIN lying on it (within
 * `SAME_M`), ordered from a. Segments are at most `step` long, so a bucket grid of that size
 * finds them by looking in the few buckets the segment spans.
 */
function vertexIndex(bx: number[], by: number[], used: Int32Array, step: number) {
  const size = Math.max(SAME_M, step)
  const buckets = new Map<string, number[]>()
  used.forEach((at, v) => {
    if (at < 0) return
    const key = `${Math.floor(bx[v] / size)},${Math.floor(by[v] / size)}`
    const list = buckets.get(key)
    if (list) list.push(v)
    else buckets.set(key, [v])
  })
  return (a: number, b: number): number[] => {
    const dx = bx[b] - bx[a],
      dy = by[b] - by[a],
      len = Math.hypot(dx, dy)
    if (!len) return []
    const found: Array<[number, number]> = []
    for (let col = Math.floor(Math.min(bx[a], bx[b]) / size); col <= Math.floor(Math.max(bx[a], bx[b]) / size); col++)
      for (let row = Math.floor(Math.min(by[a], by[b]) / size); row <= Math.floor(Math.max(by[a], by[b]) / size); row++)
        for (const v of buckets.get(`${col},${row}`) ?? []) {
          if (v === a || v === b) continue
          const t = ((bx[v] - bx[a]) * dx + (by[v] - by[a]) * dy) / (len * len)
          const off = Math.abs((bx[v] - bx[a]) * dy - (by[v] - by[a]) * dx) / len
          if (t * len > SAME_M && (1 - t) * len > SAME_M && off <= SAME_M) found.push([t, v])
        }
    return found.sort((p, q) => p[0] - q[0]).map(([, v]) => v)
  }
}

/** The triangle (first half-edge index) containing (px, py), by a visibility walk; -1 off the hull. */
function locate(del: Delaunator<Float64Array>, px: number, py: number, from: number): number {
  const { coords, triangles, halfedges } = del
  const side = (a: number, b: number) =>
    (coords[b * 2] - coords[a * 2]) * (py - coords[a * 2 + 1]) -
    (coords[b * 2 + 1] - coords[a * 2 + 1]) * (px - coords[a * 2])
  let t = from - (from % 3)
  for (let steps = 0; steps < triangles.length; steps++) {
    let moved = false
    for (let k = 0; k < 3; k++) {
      // Rotating the first edge tried keeps the walk from cycling on degenerate ground.
      const e = t + ((k + steps) % 3)
      const a = triangles[e],
        b = triangles[e - (e % 3) + ((e + 1) % 3)]
      // Delaunator's triangles turn the same way, so outside one edge is the same sign for all.
      const c = triangles[e - (e % 3) + ((e + 2) % 3)]
      const inward = side(a, b) * orient(coords, a, b, c)
      if (inward < 0) {
        const twin = halfedges[e]
        if (twin < 0) return -1
        t = twin - (twin % 3)
        moved = true
        break
      }
    }
    if (!moved) return t
  }
  return -1
}

function orient(coords: ArrayLike<number>, a: number, b: number, c: number) {
  return (
    (coords[b * 2] - coords[a * 2]) * (coords[c * 2 + 1] - coords[a * 2 + 1]) -
    (coords[b * 2 + 1] - coords[a * 2 + 1]) * (coords[c * 2] - coords[a * 2])
  )
}

function planeAt(coords: Float64Array, z: Float64Array, triangles: Uint32Array, t: number, px: number, py: number) {
  const a = triangles[t],
    b = triangles[t + 1],
    c = triangles[t + 2]
  const ux = coords[b * 2] - coords[a * 2],
    uy = coords[b * 2 + 1] - coords[a * 2 + 1],
    vx = coords[c * 2] - coords[a * 2],
    vy = coords[c * 2 + 1] - coords[a * 2 + 1]
  const dx = px - coords[a * 2],
    dy = py - coords[a * 2 + 1]
  const det = ux * vy - vx * uy
  const wb = (dx * vy - vx * dy) / det,
    wc = (ux * dy - dx * uy) / det
  return z[a] + wb * (z[b] - z[a]) + wc * (z[c] - z[a])
}

function interleave(x: Float64Array, y: Float64Array) {
  const out = new Float64Array(x.length * 2)
  for (let i = 0; i < x.length; i++) {
    out[i * 2] = x[i]
    out[i * 2 + 1] = y[i]
  }
  return out
}

function lerp(a: number | null, b: number | null, t: number) {
  return a === null || b === null ? null : a + t * (b - a)
}
